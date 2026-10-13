import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterSummary } from "../../tracking/cluster-figures.ts";
import { type Fixture, expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";
import { addDays, keywordsIn, overview } from "../../tracking/figures.ts";
import { engineRates } from "../ai/engine-rates.ts";
import { promptRows } from "../ai/prompt-table.ts";
import { diffChecks } from "./diff.ts";
import { headline, whatItMeans } from "./meaning.ts";

/**
 * Every tracking fixture state P4 draws (13 Oct 2026, DIY P4; spec 10
 * section 7.5 "Fixture states"): default, new, young, partial, failed,
 * uncited, long and ended, plus a zero state made from uncited - no answer
 * names the client and no keyword is in the top 20. The Overview's and the AI
 * page's rules run on each, the way the pages feed them, and say something
 * whole: no NaN, no "undefined", no causal word; zero reads as a reading.
 */

const fx = expandFixture(JSON.parse(readFileSync(new URL("../../tracking/fixture.json", import.meta.url), "utf8")));
const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];

function zero(f: Fixture): Fixture {
  return { ...f, data: { ...f.data, answers: f.data.answers.map((a) => ({ ...a, named: false, brands: a.brands.filter((b) => b !== f.client.brand), citations: [] })), serp: f.data.serp.map((s) => ({ ...s, position: null })) } };
}

const STATES = ["default", "new", "young", "partial", "failed", "uncited", "long", "ended", "zero"] as const;

function run(state: (typeof STATES)[number]) {
  const f = state === "zero" ? zero(fixtureState(fx, { TRACKING_FIXTURE_STATE: "uncited" })) : fixtureState(fx, { TRACKING_FIXTURE_STATE: state });
  const d = f.data;
  const today = f.today;
  const range = { from: addDays(today, -27), to: today };
  const o = overview({ range, compare: "prev", startedOn: f.client.started_on, engines: ENGINES, questions: d.questions, answers: d.answers, serp: d.serp, keywordCount: keywordsIn(d.keywords, range), keywords: d.keywords, runs: d.runs });
  const cards = d.clusters.length ? clusterCards({ clusters: d.clusters, questions: d.questions, keywords: d.keywords, answers: d.answers, serp: d.serp, range, before: o.compare, today, engines: ENGINES }) : null;
  const cs = cards ? clusterSummary(cards) : null;
  const days = new Set(d.answers.filter((a) => a.answered).map((a) => a.run_date));
  const said = headline({
    named: cs ? cs.now : o.named,
    prompts: cs ? cs.prompts : o.questions.den,
    range,
    today,
    firstReading: days.size === 1 && !o.compare ? [...days][0]! : null,
    lfl: cs && cs.lflBefore ? { now: cs.lfl, before: cs.lflBefore, basis: "clusters", count: cs.clustersLfl } : null,
    compareKind: o.compareKind,
    keywords: cs ? { onPage1: cs.page1.num, of: cs.page1.den, before: cs.page1Before, cluster: true } : null,
  });
  const bullets = whatItMeans({
    first: false,
    engines: engineRates(d.answers, range, ENGINES, cs ? cs.ids : null),
    keywords: (cards ?? []).filter((c) => c.status !== "pending" && c.keywordId && c.keyword).map((c) => ({ id: c.keywordId!, keyword: c.keyword!, position: c.position, read: c.positionRead })),
    cluster: true,
    clusters: null,
  });
  const diff = diffChecks({ today, answers: d.answers, serp: d.serp, runs: d.runs, prompts: d.questions, keywords: (cards ?? []).filter((c) => c.keywordId && c.keyword).map((c) => ({ id: c.keywordId!, keyword: c.keyword! })), brand: f.client.brand, domain: f.client.domain, engines: ENGINES });
  const rows = promptRows({ prompts: d.questions, clusters: (cards ?? []).map((c) => ({ id: c.id, label: c.keyword ?? c.name })), answers: d.answers, range, loadedFrom: addDays(range.from, -28), engines: ENGINES, origins: new Map(), brand: f.client.brand, domain: f.client.domain });
  return { said, bullets, diff, rows, hasData: o.named.den > 0 };
}

for (const state of STATES) {
  test(`${state}: the rules say something whole`, () => {
    const r = run(state);
    const words = [r.said.text, ...r.bullets.map((b) => b.text), ...(r.diff.state === "ok" ? r.diff.lines.map((l) => l.text) : [])];
    for (const w of words) {
      assert.doesNotMatch(w, /NaN|undefined|null|\[object/, `${state}: "${w}"`);
      assert.doesNotMatch(w, /\b(caused|drove|because of|thanks to|resulted in|delivered|in your place)\b/i, `${state}: "${w}"`);
    }
    if (r.diff.state === "ok") assert.ok(r.diff.lines.length <= 8);
    for (const row of r.rows) assert.ok(!row.latest || row.latest.named <= row.latest.of, `${state} ${row.id}`);
  });
}

test("new: nothing read - no change list yet, and no row has a reading", () => {
  const r = run("new");
  assert.equal(r.hasData, false);
  assert.deepEqual(r.diff, { state: "early", days: 0 });
  assert.ok(r.rows.every((x) => x.latest === null));
});

test("partial and failed: the change list opens on the latest check", () => {
  const p = run("partial");
  assert.equal(p.diff.state, "ok");
  if (p.diff.state === "ok") assert.match(p.diff.lines[0]!.text, /^Your check on 29 Sep was partial: Google AI Overviews did not answer \d+ prompts\.$/);
  const f = run("failed");
  if (f.diff.state === "ok") assert.match(f.diff.lines[0]!.text, /^Your check on 29 Sep failed: none of its reads came back\.$/);
});

test("zero: stated as a reading, and Google says none is in the top 20", () => {
  const r = run("zero");
  assert.match(r.said.text, /^Named in 0 of [\d,]+ AI answers to your \d+ prompts in the last 28 days \(0%\)/);
  assert.ok(r.bullets.some((b) => b.text === "None of your cluster keywords is in Google's top 20 yet."));
  assert.ok(r.rows.every((x) => x.answers.num === 0));
});
