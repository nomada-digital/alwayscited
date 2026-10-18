import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { brandKey } from "../scan/brand-name.ts";
import { clusterCards } from "./cluster-figures.ts";
import { answerAnchor, answerHref, answersByPromptDay, citedEvidence, dayAnswerIn, latestByPrompt, namedEvidence } from "./evidence.ts";
import { type AnswerRow, type CitationRow, type Range, addDays, brandsRead, citedPage, citedPageRows, resolveComparison, firstCheckDay } from "./figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { answerTabs } from "./latest-answers.ts";
import { namedPage } from "./named-figures.ts";

/**
 * DB-2 (9 Oct 2026): every figure and row opens the answers that produced it.
 * Each picker is held to the figure it serves, on the fixture: the answer a
 * Who is named prompt opens named that brand, on the latest day the row
 * counts, under the row's own filters; a Cited pages prompt's cited that
 * page; a heat-map cell's is one of the answers the cell counts, and a name
 * whenever the cell counted one. Then the census: the pages build those links
 * with these pickers, and no prompt link drops the day and engine again.
 */

const base = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];
const row = (p: Partial<AnswerRow>): AnswerRow => ({ run_date: "2026-09-10", question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: [], ...p });

test("a link that names an answer carries the range, the prompt, the day and the engine, and ends on the engine's anchor", () => {
  const q = { from: "2026-09-02", to: "2026-09-29", prompt: "2" };
  assert.equal(answerAnchor("gemini"), "answer-gemini");
  assert.equal(answerHref("/app/tallyroo/clusters/c1", q, { day: "2026-09-22", engine: "gemini" }), "/app/tallyroo/clusters/c1?from=2026-09-02&to=2026-09-29&prompt=2&day=2026-09-22&engine=gemini#answer-gemini");
  assert.equal(answerHref("/app/tallyroo/clusters/c1", q, null), "/app/tallyroo/clusters/c1?from=2026-09-02&to=2026-09-29&prompt=2", "no answer to open: the page on its latest, as before");
  assert.equal(answerHref("", q, { day: "2026-09-22", engine: "chatgpt" }), "?from=2026-09-02&to=2026-09-29&prompt=2&day=2026-09-22&engine=chatgpt#answer-chatgpt", "on the page itself");
});

test("the latest answer per prompt: the latest day in range, then the tier's engine order; unanswered and out-of-range rows are never opened", () => {
  const rows = [
    row({ run_date: "2026-09-10", engine: "perplexity" }),
    row({ run_date: "2026-09-11", engine: "perplexity" }),
    row({ run_date: "2026-09-11", engine: "chatgpt" }),
    row({ run_date: "2026-09-12", engine: "google_aio", answered: false }),
    row({ run_date: "2026-09-13", engine: "google_aio" }),
    row({ run_date: "2026-09-11", engine: "gemini", question_id: "q2" }),
  ];
  const got = latestByPrompt(rows, { from: "2026-09-10", to: "2026-09-12" }, ENGINES, () => true);
  assert.deepEqual(Object.fromEntries(got), { q1: { day: "2026-09-11", engine: "chatgpt" }, q2: { day: "2026-09-11", engine: "gemini" } });
  assert.equal(latestByPrompt(rows, { from: "2026-09-10", to: "2026-09-12" }, ENGINES, (a) => a.engine === "perplexity").get("q1")?.engine, "perplexity");
  assert.equal(latestByPrompt(rows, { from: "2026-09-14", to: "2026-09-20" }, ENGINES, () => true).size, 0);
});

const r28 = (today: string): Range => ({ from: addDays(today, -27), to: today });
const answerAt = (answers: readonly (AnswerRow & CitationRow)[], q: string, day: string, engine: string) => answers.find((a) => a.question_id === q && a.run_date === day && a.engine === engine);

test("Who is named: each prompt under an open row opens the latest answer in range that named that brand, on the row's filters", () => {
  let checked = 0;
  for (const state of ["default", "long", "brands-unread", "young"]) {
    const f = fixtureState(base, { TRACKING_FIXTURE_STATE: state });
    const range = r28(f.today);
    const before = resolveComparison(range, "prev", f.client.started_on, firstCheckDay(f.client.started_on, f.data.questions)).range;
    const c1 = new Set(f.data.questions.filter((q) => q.cluster_id === "c1").map((q) => q.id));
    for (const [only, engine] of [[null, null], [null, "gemini"], [c1, null]] as const) {
      const page = namedPage({ answers: f.data.answers, range, before, you: f.client.brand, only, engine });
      for (const r of page.rows.slice(0, 12)) {
        const opens = namedEvidence({ answers: f.data.answers, range, key: r.key, you: f.client.brand, only, engine, engines: ENGINES });
        assert.deepEqual([...opens.keys()].sort(), r.prompts.map((p) => p.id).sort(), `${state} ${r.name}: a prompt the row lists has no answer to open, or one it does not list has`);
        for (const p of r.prompts) {
          const at = opens.get(p.id)!;
          const a = answerAt(f.data.answers, p.id, at.day, at.engine)!;
          const names = (x: AnswerRow) => (x.named && r.you) || x.brands.some((b) => brandKey(b) === r.key);
          assert.ok(a && a.answered && brandsRead(a) && names(a), `${state} ${r.name} ${p.id}: the answer opened does not name it`);
          assert.ok(at.day >= range.from && at.day <= range.to && (!engine || at.engine === engine) && (!only || only.has(p.id)), `${state} ${r.name} ${p.id}: outside the row's filters`);
          // The latest such day, and on it the first engine in the tab order that named it.
          const days = f.data.answers.filter((x) => x.question_id === p.id && x.answered && brandsRead(x) && names(x) && x.run_date >= range.from && x.run_date <= range.to && (!engine || x.engine === engine));
          assert.equal(at.day, days.map((x) => x.run_date).sort().at(-1), `${state} ${r.name} ${p.id}: not the latest day`);
          assert.equal(at.engine, ENGINES.find((e) => days.some((x) => x.run_date === at.day && x.engine === e)), `${state} ${r.name} ${p.id}: not the first engine that day`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 300, `only ${checked} prompt links checked`);
});

test("Cited pages: each prompt under an open row opens the latest answer in range that cited that page, on the row's filters", () => {
  let checked = 0;
  for (const state of ["default", "long", "young"]) {
    const f = fixtureState(base, { TRACKING_FIXTURE_STATE: state });
    const range = r28(f.today);
    for (const engine of [null, "perplexity"] as const) {
      const rows = citedPageRows(f.data.answers.filter((a) => !engine || a.engine === engine), range, f.client.domain);
      for (const p of rows.slice(0, 25)) {
        const opens = citedEvidence({ answers: f.data.answers, range, page: p.page, engine, engines: ENGINES });
        for (const q of p.prompts) {
          const at = opens.get(q.id);
          assert.ok(at, `${state} ${p.page} ${q.id}: no answer to open`);
          const a = answerAt(f.data.answers, q.id, at.day, at.engine)!;
          assert.ok(a.answered && a.citations.some((c) => citedPage(c)?.page === p.page), `${state} ${p.page} ${q.id}: the answer opened does not cite it`);
          // Review of 95a8747 (9 Oct 2026): and the panel it lands on lists the page under the row's own name.
          const [tab] = answerTabs([{ ...a, text: null, at: null }], [at.engine], f.client.brand, f.client.market);
          assert.ok(tab!.pages.includes(p.page), `${state} ${p.page} ${q.id}: the panel names it ${JSON.stringify(tab!.pages)}`);
          assert.ok(!engine || at.engine === engine);
          assert.equal(at.day, f.data.answers.filter((x) => x.question_id === q.id && x.answered && (!engine || x.engine === engine) && x.run_date >= range.from && x.run_date <= range.to && x.citations.some((c) => citedPage(c)?.page === p.page)).map((x) => x.run_date).sort().at(-1));
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 200, `only ${checked} prompt links checked`);
  // The key is the row's: a citation with www, a query and a trailing slash opens on the row it counts in.
  const answers = [{ ...row({}), citations: [{ source_domain: "www.softwarecritic.com", url: "https://www.softwarecritic.com/best/?utm_source=x" }] }];
  assert.equal(citedEvidence({ answers, range: { from: "2026-09-10", to: "2026-09-10" }, page: "softwarecritic.com/best", engines: ENGINES }).get("q1")?.engine, "chatgpt");
});

test("the Overview's heat cell opens one of the answers it counts, and a name whenever it counted one", () => {
  let cells = 0;
  let named = 0;
  for (const state of ["default", "long", "young", "partial", "failed"]) {
    const f = fixtureState(base, { TRACKING_FIXTURE_STATE: state });
    const range = r28(f.today);
    const cards = clusterCards({ clusters: f.data.clusters, questions: f.data.questions, keywords: f.data.keywords, answers: f.data.answers, serp: f.data.serp, range, before: null, today: f.today, engines: ENGINES });
    // Review of 95a8747 (9 Oct 2026): only the days the grid draws are indexed.
    const index = answersByPromptDay(f.data.answers, range);
    assert.ok([...index.values()].flat().every((a) => a.run_date >= range.from && a.run_date <= range.to), "a day outside the grid was indexed");
    assert.ok(index.size < answersByPromptDay(f.data.answers).size || state === "young", `${state}: the whole read was indexed`);
    for (const c of cards.filter((x) => x.status !== "pending")) {
      const ids = c.prompts.map((p) => p.id);
      c.heat.forEach((cell, i) => {
        const day = addDays(range.from, i);
        const at = dayAnswerIn(index, ids, day, ENGINES);
        if (!cell) return assert.equal(at, null, `${state} ${c.id} ${day}: an empty cell opens an answer`);
        assert.ok(at, `${state} ${c.id} ${day}: a cell with a reading opens nothing`);
        const a = answerAt(f.data.answers, ids[at.prompt]!, day, at.engine)!;
        assert.ok(a && a.answered, `${state} ${c.id} ${day}: not an answer the cell counts`);
        assert.equal(a.named, cell.num > 0, `${state} ${c.id} ${day}: ${cell.num} named, and the answer opened ${a.named ? "named" : "did not name"} the client`);
        cells++;
        if (a.named) named++;
      });
    }
  }
  assert.ok(cells >= 1000 && named >= 500, `${cells} cells, ${named} opening a name`);
});

// 18 Oct 2026, brief 2d: "census: every figure that opens answers builds its link with evidence.ts" retired with /app.
// It held Named.tsx, Cited.tsx, Overview.tsx and OneCluster.tsx under src/components/app, all gone; every /app
// address 308s to the dashboards host, whose click-through views link answers their own way (lib/dash/clickthrough,
// with its own tests). evidence.ts's pickers above still hold.
