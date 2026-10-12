import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { addDays } from "../../tracking/figures.ts";
import { FIXTURE_STATES, expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";
import { shapeRead } from "../../tracking/read-shape.ts";
import { type ReadoutData, TOO_EARLY_DAYS, WINDOW_CHECKS, googleLine, otherWork, promptsLine, readout, readoutRange } from "./readout.ts";

const DONE = "2026-11-03";
const TODAY = "2026-12-12";

/** One answer per prompt per check day, named per `named(day, prompt)`. */
function answers(days: string[], prompts: string[], named: (d: string, p: string) => boolean, answered: (d: string, p: string) => boolean = () => true) {
  return days.flatMap((d) => prompts.map((p) => ({ run_date: d, question_id: p, answered: answered(d, p), named: answered(d, p) && named(d, p) })));
}
const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

const data = (o: Partial<ReadoutData> = {}): ReadoutData => ({
  today: TODAY,
  clusters: [{ id: "c1", keyword_id: "k1" }],
  keywords: [{ id: "k1", keyword: "invoicing software" }],
  prompts: [
    { id: "p1", cluster_id: "c1" },
    { id: "p2", cluster_id: "c1" },
    { id: "x", cluster_id: "c2" },
  ],
  answers: answers(span("2026-10-20", TODAY), ["p1", "p2", "x"], (d) => d >= "2026-12-01"),
  serp: [
    { run_date: DONE, keyword_id: "k1", position: 14 },
    { run_date: TODAY, keyword_id: "k1", position: 9 },
  ],
  placements: [],
  items: [],
  ...o,
});
const done = { id: "i1", status: "done" as const, doneOn: DONE, clusterId: "c1" };

test("the spec's readout: two dated positions, two windows' counts with their denominators, same prompts", () => {
  const r = readout(done, data());
  assert.equal(r?.kind, "read");
  // 7 checks before 3 Nov: 27 Oct - 2 Nov, none named; the last 7 checks: 6-12 Dec, all named. 2 prompts x 7 checks = 14 answers each.
  assert.equal(r?.text, "Done 3 Nov. 'invoicing software': 14th on 3 Nov, 9th on 12 Dec. Its prompts named you in 0 of 14 answers in the 7 checks before 3 Nov, and 14 of 14 in the last 7 checks, same prompts.");
  assert.equal(WINDOW_CHECKS, 7);
});

test("each count is over the answers actually read: a missing read lowers the denominator and is never a miss", () => {
  const d = data({ answers: answers(span("2026-10-20", TODAY), ["p1", "p2"], (day) => day >= "2026-12-01", (day, p) => !(p === "p2" && day >= "2026-12-10")) });
  assert.match(promptsLine("c1", DONE, d)!, /and 11 of 11 in the last 7 checks, same prompts\./, "3 of p2's answers were not read: 14 - 3");
});

test("a check is a day something was answered; days with no check are not counted as checks", () => {
  const sparse = ["2026-10-01", "2026-10-05", "2026-10-09", "2026-10-15", "2026-10-20", "2026-10-25", "2026-10-30", "2026-11-01", "2026-12-10", "2026-12-12"];
  const d = data({ answers: answers(sparse, ["p1"], () => false) });
  assert.equal(promptsLine("c1", DONE, d), "Its prompts named you in 0 of 7 answers in the 7 checks before 3 Nov, and 0 of 7 in the last 7 checks, same prompts.");
});

test("same prompts: a prompt not read in both windows is left out of both", () => {
  // p2 is added after the item was done: no reading before 3 Nov.
  const d = data({ answers: [...answers(span("2026-10-20", TODAY), ["p1"], () => false), ...answers(span("2026-11-20", TODAY), ["p2"], () => true)] });
  assert.equal(promptsLine("c1", DONE, d), "Its prompts named you in 0 of 7 answers in the 7 checks before 3 Nov, and 0 of 7 in the last 7 checks, same prompts.");
  assert.equal(promptsLine("c1", DONE, data({ answers: answers(span("2026-11-20", TODAY), ["p1"], () => true) })), null, "nothing before: nothing to compare");
});

test("the Google line: a missing reading says 'not measured that day'; outside the top 20 is said as a reading", () => {
  assert.equal(googleLine("k1", DONE, data({ serp: [{ run_date: TODAY, keyword_id: "k1", position: 9 }] })), "'invoicing software': not measured that day, 9th on 12 Dec.");
  assert.equal(googleLine("k1", DONE, data({ serp: [{ run_date: DONE, keyword_id: "k1", position: null }, { run_date: TODAY, keyword_id: "k1", position: 12 }] })), "'invoicing software': not in the top 20 on 3 Nov, 12th on 12 Dec.");
  assert.equal(googleLine("k1", DONE, data({ serp: [] })), null, "never read: no line");
  assert.equal(googleLine(null, DONE, data()), null);
});

test("under 21 days it is too early to read, with the days to go", () => {
  assert.deepEqual(readout({ ...done, doneOn: "2026-12-03" }, data()), { kind: "early", daysLeft: 12, text: "Too early to read: 12 days to go" });
  assert.deepEqual(readout({ ...done, doneOn: "2026-11-22" }, data()), { kind: "early", daysLeft: 1, text: "Too early to read: 1 day to go" });
  assert.equal(readout({ ...done, doneOn: "2026-11-21" }, data())?.kind, "read", "21 days on, it reads");
  assert.equal(TOO_EARLY_DAYS, 21);
  assert.equal(readout({ ...done, status: "doing" }, data()), null);
});

test("other work on the cluster since is listed with it, as sharing one movement", () => {
  const d = data({
    placements: [
      { cluster_id: "c1", status: "live", live_on: "2026-11-12" },
      { cluster_id: "c1", status: "removed", live_on: "2026-11-13" },
      { cluster_id: "c2", status: "live", live_on: "2026-11-14" },
    ],
    items: [done, { id: "i2", clusterId: "c1", status: "done", doneOn: "2026-11-20" }, { id: "i3", clusterId: "c1", status: "doing", doneOn: null }, { id: "i4", clusterId: "c1", status: "done", doneOn: "2026-10-01" }],
  });
  assert.equal(otherWork(done, "c1", DONE, d), "Other work on this cluster since: 1 other action done 20 Nov and 1 placement live 12 Nov.");
  assert.equal(otherWork(done, "c1", DONE, data()), null);
  assert.match(readout(done, d)!.text, /same prompts\. Other work on this cluster since: /);
});

test("a done item with no cluster reads its date only", () => {
  assert.equal(readout({ ...done, clusterId: null }, data())?.text, "Done 3 Nov.");
});

test("the copy holds no derived figure, no adjective of size and no causal word", () => {
  const text = readout(done, data())!.text;
  assert.doesNotMatch(text, /%|\b(caused|drove|because|thanks|resulted|delivered|improved|better|worse|up|down)\b/i);
});

test("the range a page reads: from room for 7 checks before the oldest readable item to today, held to the client's start", () => {
  assert.equal(readoutRange([{ status: "done", doneOn: "2026-12-03" }], TODAY, null), null, "nothing old enough");
  assert.deepEqual(readoutRange([{ status: "done", doneOn: DONE }, { status: "todo", doneOn: null }], TODAY, null), { from: "2026-10-13", to: TODAY });
  assert.deepEqual(readoutRange([{ status: "done", doneOn: DONE }], TODAY, "2026-10-30"), { from: "2026-10-30", to: TODAY });
});

/**
 * The page reads verdicts only (repo.loadOverview with answers: "verdicts").
 * As read-shape.test.mts does for Reports and Placements: every readout is the
 * same on the verdicts-only read as on the whole read, on every tracking
 * fixture state.
 */
test("every readout is the same on the verdicts-only read as on the whole read, on every fixture state", () => {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "tracking", "fixture.json"), "utf8"));
  for (const state of FIXTURE_STATES) {
    if (state === "unreadable") continue;
    const f = fixtureState(expandFixture(raw), { TRACKING_FIXTURE_STATE: state, TRACKING_FIXTURE_ROLE: "owner" });
    const views = [shapeRead(f.data), shapeRead(f.data, { answers: "verdicts" })].map((d) =>
      (["c1", "c3", "c4"] as const).map((c) =>
        readout({ id: "i", status: "done", doneOn: addDays(f.today, -28), clusterId: c }, { today: f.today, clusters: d.clusters, keywords: d.keywords, prompts: d.questions, answers: d.answers, serp: d.serp, placements: f.placements, items: [] }),
      ),
    );
    assert.deepEqual(views[1], views[0], state);
  }
});
