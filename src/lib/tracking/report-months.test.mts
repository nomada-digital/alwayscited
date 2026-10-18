import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterSummary } from "./cluster-figures.ts";
import { addDays, overview } from "./figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { monthFigures, reportMonths } from "./report-months.ts";

/**
 * R145 (1 Oct 2026; BRIEF-4 P5): a Reports month card equals the Overview
 * opened on that month's range - the Overview's own calls, written out here
 * as Overview.tsx makes them, so a card that drifts from the Overview fails.
 */

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
const engines = ["google_ai_overview", "chatgpt", "gemini", "perplexity"];

test("months run from tracking's first month to today's, newest first, the current one 'So far'", () => {
  const ms = reportMonths("2026-06-10", "2026-09-29");
  assert.deepEqual(
    ms.map((m) => [m.label, m.range.from, m.range.to, m.soFar]),
    [
      ["September 2026", "2026-09-01", "2026-09-29", true],
      ["August 2026", "2026-08-01", "2026-08-31", false],
      ["July 2026", "2026-07-01", "2026-07-31", false],
      ["June 2026", "2026-06-01", "2026-06-30", false],
    ],
  );
  assert.deepEqual(reportMonths("2025-12-20", "2026-01-31").map((m) => [m.label, m.soFar]), [["January 2026", true], ["December 2025", false]]);
  assert.deepEqual(reportMonths(null, "2026-10-01").map((m) => m.label), ["October 2026"]);
  assert.deepEqual(reportMonths("2026-11-01", "2026-10-01").map((m) => m.label), ["October 2026"], "a start after today reads as this month");
});

test("one month's card equals the Overview on the same range", () => {
  const range = { from: "2026-08-01", to: "2026-08-31" };
  const card = monthFigures(fx.data, range, { startedOn: fx.client.started_on, today: fx.today, engines });
  const o = overview({ range, compare: "prev", startedOn: fx.client.started_on, engines, questions: fx.data.questions, answers: fx.data.answers, serp: fx.data.serp, keywordCount: fx.data.keywords.filter((k) => k.stopped_on === null).length });
  const cs = clusterSummary(clusterCards({ clusters: fx.data.clusters, questions: fx.data.questions, keywords: fx.data.keywords, answers: fx.data.answers, serp: fx.data.serp, range, before: o.compare, today: fx.today, engines }));
  assert.equal(card.basis, "clusters");
  assert.ok(cs.now.den > 0, "the fixture has no August answers");
  assert.deepEqual(card.named, cs.now);
  assert.deepEqual(card.prompts, cs.promptsNamed);
  assert.equal(card.page1.num, cs.page1.num);
  assert.equal(card.page1.den, cs.page1.den);
  assert.equal(card.lfl?.delta ?? null, cs.lflBefore ? cs.lflDelta : null);
});

test("DS52: a pilot's card counts its ungrouped prompts' readings, as its Overview headline does", () => {
  const pilot = fixtureState(fx, { TRACKING_FIXTURE_STATE: "pilot-mixed" });
  const range = { from: "2026-09-01", to: pilot.today };
  const card = monthFigures(pilot.data, range, { startedOn: pilot.client.started_on, today: pilot.today, engines });
  const o = overview({ range, compare: "prev", startedOn: pilot.client.started_on, engines, questions: pilot.data.questions, answers: pilot.data.answers, serp: pilot.data.serp, keywordCount: pilot.data.keywords.filter((k) => k.stopped_on === null).length });
  assert.ok(o.named.den > 0, "pilot-mixed has no September answers");
  assert.deepEqual(card.named, o.named, "the card read 0 of 0 - 'No readings this month yet'");
  assert.deepEqual(card.prompts, o.questions);
  assert.equal(card.basis, "clusters");
  assert.equal(card.page1.den, 0, "the pending cluster's keyword has no reading yet");
});

test("an ungrouped client's card reads flat, as its Overview does", () => {
  const flat = { ...fx.data, clusters: [], questions: fx.data.questions.map((q) => ({ ...q, cluster_id: null })) };
  const range = { from: "2026-09-01", to: fx.today };
  const card = monthFigures(flat, range, { startedOn: fx.client.started_on, today: fx.today, engines });
  const o = overview({ range, compare: "prev", startedOn: fx.client.started_on, engines, questions: flat.questions, answers: flat.answers, serp: flat.serp, keywordCount: flat.keywords.filter((k) => k.stopped_on === null).length });
  assert.equal(card.basis, "keywords");
  assert.deepEqual(card.named, o.named);
  assert.deepEqual(card.prompts, o.questions);
  assert.equal(card.page1.num, o.keywords.num);
});

test("8 Oct 2026 (audit data-10): a young client's month compares with its first week, and says so; an older one's with the period before", () => {
  const young = fixtureState(fx, { TRACKING_FIXTURE_STATE: "young" });
  const sept = { from: "2026-09-01", to: young.today };
  const card = monthFigures(young.data, sept, { startedOn: young.client.started_on, today: young.today, engines });
  assert.ok(card.lfl, "its first month had no change: the period before it was before tracking began");
  assert.equal(card.lfl!.firstWeek, true);
  const older = monthFigures(fx.data, sept, { startedOn: fx.client.started_on, today: fx.today, engines });
  assert.equal(older.lfl?.firstWeek, false);
  assert.equal(card.lfl!.firstReading, false);
  // ON-3 (9 Oct 2026): a month that ends inside the first week is compared with the first reading, and says so.
  const start = young.client.started_on;
  const early = monthFigures(young.data, { from: "2026-09-01", to: addDays(start, 3) }, { startedOn: start, today: young.today, engines });
  assert.equal(early.lfl?.firstReading, true);
  assert.equal(early.lfl?.firstWeek, false);
  // Review of ON-3 (9 Oct 2026): a partial or failed first check is never the reading a card compares with.
  for (const status of ["partial", "failed"]) {
    const runs = (young.data.runs ?? []).map((r) => (r.run_date === start ? { ...r, status } : r));
    const card = monthFigures({ ...young.data, runs }, { from: "2026-09-01", to: addDays(start, 3) }, { startedOn: start, today: young.today, engines });
    assert.equal(card.lfl, null, `${status}: no change against a first check that did not read every engine`);
  }
  // 9 Oct 2026 (ON-3): the line grew a third case, the first reading; the first week's words are unchanged.
  // 18 Oct 2026, brief 2d: the page half (components/app/Reports.tsx saying which period a card is against) retired
  // with /app; every /app address 308s to the dashboards host, which has no Reports page. monthFigures above holds.
});
