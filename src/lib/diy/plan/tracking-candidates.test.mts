import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fakeDb } from "../../tracking/fake-db.mts";
import { addDays } from "../../tracking/figures.ts";
import { expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";
import { KEYWORD_HELD, type TrackingInput, keywordSlips, promptSlips, readTrackingInput, trackingCandidatesFrom } from "./tracking-candidates.ts";
import { cleanCandidate } from "./refresh.ts";
import { TITLE_COPY } from "./types.ts";

const TODAY = "2026-10-13";
const day = (n: number) => addDays(TODAY, -n);

const base = (o: Partial<TrackingInput> = {}): TrackingInput => ({
  today: TODAY,
  clusters: [{ id: "c1", name: "invoicing software", keyword_id: "k1", stopped_on: null }],
  questions: [{ id: "q1", text: "What's the best invoicing software?", cluster_id: "c1", stopped_on: null }],
  keywords: [{ id: "k1", keyword: "invoicing software", search_volume: 9900, stopped_on: null }],
  answers: [],
  serp: [],
  ...o,
});

/** Positions oldest first, one reading a day ending today; undefined is a day with no reading at all. */
const serp = (positions: (number | null | undefined)[]) =>
  positions.flatMap((p, i) => (p === undefined ? [] : [{ run_date: day(positions.length - 1 - i), keyword_id: "k1", position: p }]));

test("a cluster keyword that left page 1, held over its last 3 readings, is Slipping", () => {
  const [c] = keywordSlips(base({ serp: serp([8, 9, 13, 14, null]) }));
  assert.ok(c);
  assert.equal(c.dedupeKey, "kw-left-p1:k1");
  assert.equal(c.kind, "recover_keyword");
  assert.equal(c.severity, "slipping");
  assert.equal(c.clusterId, "c1");
  assert.equal(c.volume, 9900);
  assert.equal(c.grade, "your_data");
  assert.equal(c.why[0]!.text, "'invoicing software' was 9th on Google on 10 Oct; 13th, 14th and not in the top 20 at its last 3 readings, to 13 Oct.");
  assert.equal(c.why[0]!.href, "/clusters/c1");
  assert.equal(KEYWORD_HELD, 3);
});

test("two readings off page 1 are a glimpse, not a slip; a keyword never on page 1 did not leave it", () => {
  assert.deepEqual(keywordSlips(base({ serp: serp([8, 9, 13, 14, 7]) })), []);
  assert.deepEqual(keywordSlips(base({ serp: serp([8, 9, 9, 13, 14]) })), []);
  assert.deepEqual(keywordSlips(base({ serp: serp([12, 13, 13, 14, 15]) })), []);
  assert.deepEqual(keywordSlips(base({ serp: serp([13, 14, 15]) })), [], "three readings with nothing before them");
});

test("a missing read is skipped, never read as a change", () => {
  // Days with no row between: still the last 3 readings, and the one before them on page 1.
  const [c] = keywordSlips(base({ serp: serp([6, undefined, 12, undefined, undefined, 13, 14]) }));
  assert.ok(c, "gaps between readings do not break the hold");
  assert.match(c.why[0]!.text, /was 6th on Google on 7 Oct; 12th, 13th and 14th at its last 3 readings, to 13 Oct\./);
  // And a day with no reading never counts as off page 1.
  assert.deepEqual(keywordSlips(base({ serp: serp([6, 7, 13, undefined, undefined, 14]) })), [], "only 2 readings off page 1, however many days");
});

test("stopped clusters and keywords, and readings older than the window, are left out", () => {
  assert.deepEqual(keywordSlips(base({ serp: serp([8, 13, 14, 15]), clusters: [{ id: "c1", name: "x", keyword_id: "k1", stopped_on: day(1) }] })), []);
  assert.deepEqual(keywordSlips(base({ serp: serp([8, 13, 14, 15]), keywords: [{ id: "k1", keyword: "x", search_volume: null, stopped_on: day(1) }] })), []);
  const old = [{ run_date: day(40), keyword_id: "k1", position: 4 }, ...serp([13, 14, 15])];
  assert.deepEqual(keywordSlips(base({ serp: old })), [], "page 1 more than 28 days ago is not a slip");
});

/** Answers per engine, oldest first: N named, - answered not named, x no answer, undefined no row. */
const answers = (byEngine: Record<string, string>, q = "q1") =>
  Object.entries(byEngine).flatMap(([engine, s]) =>
    [...s].flatMap((ch, i) => (ch === " " ? [] : [{ run_date: day(s.length - 1 - i), question_id: q, engine, answered: ch !== "x", named: ch === "N" }])),
  );

test("a prompt named on 2 or more engines before, and on none at its last 2 readings on each engine, is Slipping", () => {
  const [c] = promptSlips(base({ answers: answers({ chatgpt: "NN--", gemini: "N---", perplexity: "----" }) }));
  assert.ok(c);
  assert.equal(c.dedupeKey, "prompt-lost:q1");
  assert.equal(c.kind, "recover_prompt");
  assert.equal(c.why[0]!.text, "Named by ChatGPT and Gemini earlier in the last 28 days; named by none of the 3 engines that answered, at their last 2 readings each, to 13 Oct.");
  assert.ok(c.title.length <= TITLE_COPY);
});

test("named on one engine before is not enough; named at either of the last 2 readings on any engine is not lost", () => {
  assert.deepEqual(promptSlips(base({ answers: answers({ chatgpt: "NN--", gemini: "----" }) })), []);
  assert.deepEqual(promptSlips(base({ answers: answers({ chatgpt: "NN--", gemini: "NN-N" }) })), []);
  assert.deepEqual(promptSlips(base({ answers: answers({ chatgpt: "NN--", gemini: "NNN-" }) })), []);
});

test("held over 2 readings on each engine: an engine with one reading cannot say so, and a silence is not a miss", () => {
  assert.deepEqual(promptSlips(base({ answers: answers({ chatgpt: "NN--", gemini: "NN--", perplexity: "   -" }) })), [], "one reading on Perplexity");
  // No answer (x) is no reading: the last 2 readings are the last 2 days that engine answered.
  const [c] = promptSlips(base({ answers: answers({ chatgpt: "NN-x-x", gemini: "N--xxx" }) }));
  assert.ok(c, "the days with no answer are skipped");
  assert.deepEqual(promptSlips(base({ answers: answers({ chatgpt: "N-xNx-", gemini: "N--xxx" }) })), [], "ChatGPT's last 2 readings include a named one");
});

test("the candidates are fit to store, and on the tracking fixture the rules find its lost prompts and no keyword slip", () => {
  const f = fixtureState(expandFixture(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "tracking", "fixture.json"), "utf8"))), {});
  const found = trackingCandidatesFrom({ today: f.today, clusters: f.data.clusters, questions: f.data.questions, keywords: f.data.keywords, answers: f.data.answers, serp: f.data.serp });
  assert.deepEqual(
    found.map((c) => c.dedupeKey).sort(),
    ["prompt-lost:q4-4", "prompt-lost:q4-5", "prompt-lost:q8-1", "prompt-lost:q8-4", "prompt-lost:q9-3"],
  );
  for (const c of found) assert.ok(cleanCandidate(c), c.dedupeKey);
});

test("the read: one client's rows only, paged, the last 28 days, verdict columns", async () => {
  const rows = (n: number, o: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => o(i));
  const { db, calls } = fakeDb(
    {
      tracked_clusters: [{ id: "c1", client_domain_id: "me", name: "x", keyword_id: "k1", stopped_on: null }, { id: "c9", client_domain_id: "other", name: "y", keyword_id: null, stopped_on: null }],
      tracked_questions: [{ id: "q1", client_domain_id: "me", text: "t", cluster_id: "c1", stopped_on: null }],
      tracked_keywords: [{ id: "k1", client_domain_id: "me", keyword: "x", search_volume: 1, stopped_on: null }],
      tracking_answers: rows(1500, (i) => ({ id: i, client_domain_id: "me", run_date: day(i % 40), question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: ["secret"] })),
      tracking_serp: [{ id: 1, client_domain_id: "me", run_date: day(1), keyword_id: "k1", position: 4 }, { id: 2, client_domain_id: "other", run_date: day(1), keyword_id: "k1", position: 1 }],
    },
    { maxRows: 1000 },
  );
  const input = await readTrackingInput(db, "me", TODAY);
  assert.deepEqual(input.clusters.map((c) => c.id), ["c1"]);
  assert.equal(input.serp.length, 1);
  assert.ok(input.answers.length > 1000, "paged past the server's 1000-row ceiling");
  assert.ok(input.answers.every((a) => a.run_date >= day(27)), "the window only");
  assert.ok(input.answers.every((a) => !("brands" in a)), "no brand column is read");
  assert.ok(calls.filter((c) => c.table === "tracking_answers").every((c) => c.range !== null), "every page of answers is ranged");
});
