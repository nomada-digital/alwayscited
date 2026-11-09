import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlacementsView } from "./placement-figures.ts";
import { BRANDS_NOT_READ, answersCsv, csvField, isReportKind, keywordsCsv, placementsCsv, reportFilename } from "./report-csv.ts";

test("R97 part 4: the placements CSV is the table, Whole cluster first, blanks for a row not live, footnote last", () => {
  const view: PlacementsView = {
    live: 1,
    inProgress: 1,
    weekly: false,
    whole: { from: "2026-08-05", named: { from: 30, to: 50 }, google: { from: 10, to: 4 }, cited: 3 },
    rows: [
      { id: "a", kind: "guest_post", url: "https://example.com/one", url_key: "example.com/one", live: true, when: "12 Aug", liveOn: "2026-08-12", cited: 3, citedBy: ["chatgpt", "claude"], named: { from: 30, to: 50 }, google: { from: 9, to: 4 } },
      { id: "b", kind: "link_insertion", url: "https://example.com/two", url_key: "example.com/two", live: false, when: "Writing", liveOn: null, cited: 0, citedBy: [], named: { from: null, to: null }, google: { from: null, to: null } },
    ],
  };
  assert.equal(
    placementsCsv(view, "accounting app", "Footnote, quoted."),
    [
      "cluster,page,type,status,live on,answers citing it,engines citing it,named % at go-live,named % now,google at go-live,google now",
      "accounting app,Whole cluster,,1 live,2026-08-05,3,,30,50,10,4",
      "accounting app,https://example.com/one,Placement,Live,2026-08-12,3,chatgpt claude,30,50,9,4",
      "accounting app,https://example.com/two,Link insertion,Writing,,,,,,,",
      "",
      '"Footnote, quoted."',
      "",
    ].join("\r\n"),
  );
  assert.equal(isReportKind("placements"), true);
});

// R90 T8 v1 (30 Sep 2026): the two CSVs. Tallyroo is the fixture's made-up client.

const R = { from: "2026-09-02", to: "2026-09-29" };

test("a field is quoted when it must be, and a formula lead is defused", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField('a "b", c'), '"a ""b"", c"');
  assert.equal(csvField("line\nbreak"), '"line\nbreak"');
  assert.equal(csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvField(null), "");
  assert.equal(csvField(7), "7");
});

test("answers: one row per prompt, engine and day in range, sorted, with the cluster and angle", () => {
  const csv = answersCsv(
    {
      clusters: [{ id: "c1", name: "invoicing app", keyword_id: "k1", tier: "alwaystracked", started_on: "2026-09-01", stopped_on: null }],
      keywords: [{ id: "k1", keyword: "invoicing app for studios", added_on: "2026-09-01", stopped_on: null, search_volume: 480, intent: "commercial" }],
      questions: [{ id: "q1", text: "Which invoicing app is best, for a studio?", added_on: "2026-09-01", stopped_on: null, cluster_id: "c1", angle: "category" }],
      answers: [
        { run_date: "2026-09-03", question_id: "q1", engine: "gemini", answered: true, named: false, brands: ["Ledgerline"], citations: [] },
        { run_date: "2026-09-03", question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: [], citations: [{ source_domain: "tallyroo.com", url: "https://tallyroo.com/a" }] },
        { run_date: "2026-09-01", question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: [], citations: [] },
        { run_date: "2026-09-04", question_id: "q1", engine: "claude", answered: false, named: false, brands: [], citations: [] },
      ],
    },
    R,
  );
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "date,cluster,cluster keyword,angle,prompt,engine,answered,named you,brands named,pages cited");
  assert.equal(lines.length, 4, "the 1 Sep reading is outside the range");
  assert.equal(lines[1], '2026-09-03,invoicing app,invoicing app for studios,category,"Which invoicing app is best, for a studio?",chatgpt,yes,yes,,https://tallyroo.com/a');
  assert.equal(lines[2], '2026-09-03,invoicing app,invoicing app for studios,category,"Which invoicing app is best, for a studio?",gemini,yes,no,Ledgerline,');
  assert.equal(lines[3], '2026-09-04,invoicing app,invoicing app for studios,category,"Which invoicing app is best, for a studio?",claude,no,,,', "no answer: named is blank, not no");
});

test("BRIEF-3 T8: a prompt outside any cluster, or a cluster with no keyword, leaves those cells blank", () => {
  const csv = answersCsv(
    {
      clusters: [{ id: "c1", name: "invoicing app", keyword_id: null, tier: "alwaystracked", started_on: "2026-09-01", stopped_on: null }],
      keywords: [],
      questions: [
        { id: "q1", text: "one", added_on: "2026-09-01", stopped_on: null, cluster_id: "c1", angle: "category" },
        { id: "q2", text: "two", added_on: "2026-09-01", stopped_on: null, cluster_id: null, angle: null },
      ],
      answers: [
        { run_date: "2026-09-03", question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: [], citations: [] },
        { run_date: "2026-09-03", question_id: "q2", engine: "chatgpt", answered: true, named: true, brands: [], citations: [] },
      ],
    },
    R,
  );
  assert.deepEqual(csv.trimEnd().split("\r\n").slice(1), ["2026-09-03,invoicing app,,category,one,chatgpt,yes,yes,,", "2026-09-03,,,,two,chatgpt,yes,yes,,"]);
});

test("keywords: one row per keyword and day, the cluster it heads, a blank position outside the top 20", () => {
  const csv = keywordsCsv(
    {
      clusters: [{ id: "c1", name: "invoicing app", keyword_id: "k1", tier: "alwaystracked", started_on: "2026-09-01", stopped_on: null }],
      keywords: [
        { id: "k1", keyword: "invoicing software", added_on: "2026-09-01", stopped_on: null, search_volume: null, intent: null },
        { id: "k2", keyword: "loose keyword", added_on: "2026-09-01", stopped_on: null, search_volume: null, intent: null },
      ],
      serp: [
        { run_date: "2026-09-05", keyword_id: "k1", position: null },
        { run_date: "2026-09-04", keyword_id: "k1", position: 7 },
        { run_date: "2026-09-04", keyword_id: "k2", position: 3 },
      ],
    },
    R,
  );
  assert.deepEqual(csv.trimEnd().split("\r\n"), [
    "date,cluster,keyword,google position (blank: not in top 20)",
    "2026-09-04,invoicing app,invoicing software,7",
    "2026-09-04,,loose keyword,3",
    "2026-09-05,invoicing app,invoicing software,",
  ]);
});

test("the kind is one of two words, and the filename carries slug, kind and range", () => {
  assert.equal(isReportKind("answers"), true);
  assert.equal(isReportKind("pdf"), false);
  assert.equal(isReportKind(null), false);
  assert.equal(reportFilename("tallyroo", "answers", R), "tallyroo-answers-2026-09-02-to-2026-09-29.csv");
  assert.equal(reportFilename('ev"il/..', "keywords", R), "evil-keywords-2026-09-02-to-2026-09-29.csv");
});

test("8 Oct 2026 (audit data-6): an answer whose other brands were not read says so in brands named, after any it did attribute", () => {
  const csv = answersCsv(
    {
      clusters: [],
      keywords: [],
      questions: [{ id: "q1", text: "one", added_on: "2026-09-01", stopped_on: null, cluster_id: null, angle: null }],
      answers: [
        { run_date: "2026-09-03", question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: [], brands_ok: false, citations: [] },
        { run_date: "2026-09-03", question_id: "q1", engine: "gemini", answered: true, named: false, brands: ["Ledgerline"], brands_ok: false, citations: [] },
        { run_date: "2026-09-03", question_id: "q1", engine: "perplexity", answered: true, named: false, brands: [], brands_ok: true, citations: [] },
      ],
    },
    R,
  );
  assert.deepEqual(csv.trimEnd().split("\r\n").slice(1), [
    `2026-09-03,,,,one,chatgpt,yes,yes,${BRANDS_NOT_READ},`,
    `2026-09-03,,,,one,gemini,yes,no,Ledgerline; ${BRANDS_NOT_READ},`,
    "2026-09-03,,,,one,perplexity,yes,no,,",
  ]);
});
