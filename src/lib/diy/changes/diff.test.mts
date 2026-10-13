import assert from "node:assert/strict";
import { test } from "node:test";

import { CHANGE_ORDER, type DiffAnswer, type DiffInput, MAX_LINES, diffChecks, failedCounts, ordinal } from "./diff.ts";

/**
 * diffChecks (13 Oct 2026, DIY P4; spec 10 section 6.8). Made-up Tallyroo and
 * its made-up rivals, as the tracking fixture's world. Today is 14 Oct; the
 * window is 8-14 Oct.
 */

const TODAY = "2026-10-14";
const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

const ans = (d: number, q: string, engine: string, named: boolean, over: Partial<DiffAnswer> = {}): DiffAnswer => ({
  run_date: day(d),
  question_id: q,
  engine,
  answered: true,
  named,
  brands: named ? ["Tallyroo"] : [],
  citations: [],
  ...over,
});

const base = (answers: DiffAnswer[], over: Partial<DiffInput> = {}): DiffInput => ({
  today: TODAY,
  answers,
  serp: [],
  runs: [12, 13, 14].map((d) => ({ run_date: day(d), status: "complete", error: null })),
  prompts: [
    { id: "q1", text: "best invoicing app for freelancers" },
    { id: "q2", text: "best accounting app for sole traders" },
    { id: "q3", text: "invoicing software for small agencies" },
    { id: "q4", text: "best payroll for sole traders" },
    { id: "q5", text: "cheap bookkeeping app" },
  ],
  keywords: [
    { id: "k1", keyword: "invoicing software" },
    { id: "k2", keyword: "accounting app for freelancers" },
  ],
  brand: "Tallyroo",
  domain: "tallyroo.com",
  engines: ENGINES,
  ...over,
});

/** Three days of checks with no change: every prompt named on Gemini, none on ChatGPT. */
const steady = (days = [12, 13, 14]) => days.flatMap((d) => ["q1", "q2", "q3", "q4", "q5"].flatMap((q) => [ans(d, q, "gemini", true), ans(d, q, "chatgpt", false)]));

const ok = (input: DiffInput) => {
  const r = diffChecks(input);
  assert.equal(r.state, "ok");
  return r as Extract<ReturnType<typeof diffChecks>, { state: "ok" }>;
};

test("fewer than 3 days of checks: changes start later", () => {
  assert.deepEqual(diffChecks(base(steady([13, 14]))), { state: "early", days: 2 });
  assert.deepEqual(diffChecks(base([])), { state: "early", days: 0 });
  // A day outside the window is not a day of checks.
  assert.deepEqual(diffChecks(base(steady([7, 13, 14]))), { state: "early", days: 2 });
  assert.deepEqual(ok(base(steady())).lines, []);
});

test("the held rule: d0 and d1 agree and differ from d2, per prompt-engine pair", () => {
  // Lost on ChatGPT: named on 12, not on 13 or 14. Held.
  const lost = [ans(12, "q1", "chatgpt", true), ans(13, "q1", "chatgpt", false), ans(14, "q1", "chatgpt", false)];
  assert.deepEqual(ok(base([...steady().filter((a) => !(a.question_id === "q1" && a.engine === "chatgpt")), ...lost])).lines, [
    { kind: "lost", text: "ChatGPT stopped naming you for 'best invoicing app for freelancers'.", link: { to: "answer", question: "q1", day: day(14), engine: "chatgpt" } },
  ]);
  // Glimpsed: named on 12 and 14, not 13 - d0 and d1 disagree, so no line.
  const glimpse = [ans(12, "q1", "chatgpt", false), ans(13, "q1", "chatgpt", true), ans(14, "q1", "chatgpt", false)];
  assert.deepEqual(ok(base([...steady().filter((a) => !(a.question_id === "q1" && a.engine === "chatgpt")), ...glimpse])).lines, []);
  // Won on Perplexity: not named on 12, named on 13 and 14.
  const won = [ans(12, "q2", "perplexity", false), ans(13, "q2", "perplexity", true), ans(14, "q2", "perplexity", true)];
  assert.deepEqual(ok(base([...steady(), ...won])).lines, [
    { kind: "won", text: "Perplexity started naming you for 'best accounting app for sole traders'.", link: { to: "answer", question: "q2", day: day(14), engine: "perplexity" } },
  ]);
});

test("a missing read is skipped, never read as a change: readings are the days the engine answered", () => {
  // Gemini did not answer q3 on 13 Oct (a partial check). Its readings are 10, 12 and 14: named, named, named - no change,
  // where reading the silent 13th as "not named" would have written a loss and a win.
  const rows = [ans(10, "q3", "gemini", true), ans(12, "q3", "gemini", true), ans(13, "q3", "gemini", false, { answered: false, brands: [] }), ans(14, "q3", "gemini", true)];
  const input = base([...steady().filter((a) => !(a.question_id === "q3" && a.engine === "gemini")), ...rows]);
  assert.deepEqual(ok(input).lines, []);
  // And the held rule runs over those readings: named on 10, not on 12 or 14, with the 13th silent - lost, d2 = 10 Oct.
  const held = [ans(10, "q3", "gemini", true), ans(12, "q3", "gemini", false), ans(13, "q3", "gemini", false, { answered: false }), ans(14, "q3", "gemini", false)];
  const lines = ok(base([...steady().filter((a) => !(a.question_id === "q3" && a.engine === "gemini")), ...held])).lines;
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.kind, "lost");
  // A pair with only two readings in the window is skipped.
  const two = [ans(13, "q5", "perplexity", true), ans(14, "q5", "perplexity", false)];
  assert.deepEqual(ok(base([...steady(), ...two])).lines, []);
});

test("the brand line: the first brand named at d0 that was not at d2, and left off when there is none", () => {
  const rows = [
    ans(12, "q1", "chatgpt", true, { brands: ["Tallyroo", "Brightbook"] }),
    ans(13, "q1", "chatgpt", false, { brands: ["Ledgerline", "Brightbook"] }),
    ans(14, "q1", "chatgpt", false, { brands: ["Brightbook", "Ledgerline", "Sumly"] }),
  ];
  const text = (r: DiffAnswer[]) => ok(base([...steady().filter((a) => !(a.question_id === "q1" && a.engine === "chatgpt")), ...r])).lines[0]!.text;
  assert.equal(text(rows), "ChatGPT stopped naming you for 'best invoicing app for freelancers'. Ledgerline is named there now; it wasn't on 12 Oct.");
  // Nobody new at d0: the second sentence is left off.
  assert.equal(text([rows[0]!, rows[1]!, { ...rows[2]!, brands: ["Brightbook"] }]), "ChatGPT stopped naming you for 'best invoicing app for freelancers'.");
  // Brands not read at d0 or at d2: no claim about who is named.
  assert.equal(text([rows[0]!, rows[1]!, { ...rows[2]!, brands_ok: false }]), "ChatGPT stopped naming you for 'best invoicing app for freelancers'.");
  assert.equal(text([{ ...rows[0]!, brands_ok: false }, rows[1]!, rows[2]!]), "ChatGPT stopped naming you for 'best invoicing app for freelancers'.");
  // Spellings fold: "Ledger Line" at d2 is the Ledgerline at d0.
  assert.equal(text([{ ...rows[0]!, brands: ["Tallyroo", "Brightbook", "Ledger Line"] }, rows[1]!, rows[2]!]),"ChatGPT stopped naming you for 'best invoicing app for freelancers'. Sumly is named there now; it wasn't on 12 Oct.");
  // It never says the rival took the client's place.
  assert.doesNotMatch(text(rows), /in your place|instead of you|replaced/i);
});

test("keywords leaving and entering page 1, held over their own readings", () => {
  const serp = [
    { run_date: day(12), keyword_id: "k1", position: 8 },
    { run_date: day(13), keyword_id: "k1", position: 12 },
    { run_date: day(14), keyword_id: "k1", position: 13 },
    { run_date: day(11), keyword_id: "k2", position: null },
    { run_date: day(13), keyword_id: "k2", position: 9 },
    { run_date: day(14), keyword_id: "k2", position: 7 },
  ];
  assert.deepEqual(
    ok(base(steady(), { serp })).lines.map((l) => [l.kind, l.text]),
    [
      ["left_page1", "'invoicing software' left page 1: 8th to 13th."],
      ["entered_page1", "'accounting app for freelancers' entered page 1: outside the top 20 to 7th."],
    ],
  );
  // Two readings only: skipped. One flip back: not held.
  assert.deepEqual(ok(base(steady(), { serp: serp.filter((s) => s.run_date !== day(12)) })).lines.map((l) => l.kind), ["entered_page1"]);
  assert.deepEqual(ok(base(steady(), { serp: [...serp.filter((s) => !(s.keyword_id === "k1" && s.run_date === day(14))), { run_date: day(14), keyword_id: "k1", position: 6 }] })).lines.map((l) => l.kind), ["entered_page1"]);
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(12), "12th");
  assert.equal(ordinal(22), "22nd");
});

test("a new brand: 3 or more answers on each of the latest two days of checks, none the day before", () => {
  const add = (d: number, q: string, brands: string[]) => ans(d, q, "perplexity", false, { brands });
  const rows = [
    ...steady(),
    add(12, "q1", ["Ledgerline"]),
    ...["q1", "q2", "q3", "q4"].map((q) => add(13, q, ["Countwise"])),
    ...["q1", "q2", "q3"].map((q) => add(14, q, ["Countwise", "Ledgerline"])),
  ];
  assert.deepEqual(ok(base(rows)).lines, [{ kind: "new_brand", text: "Countwise was named in 3 answers on 14 Oct and 4 on 13 Oct, and in none on 12 Oct.", link: { to: "named", key: "countwise" } }]);
  // The client is never a new brand, however it is spelled.
  const self = [...steady(), ...["q1", "q2", "q3"].flatMap((q) => [add(13, q, ["TallyRoo"]), add(14, q, ["TallyRoo"])])];
  assert.deepEqual(ok(base(self)).lines, []);
  // A day whose brands were not read says nothing about "none".
  const unread = rows.map((a) => (a.run_date === day(12) ? { ...a, brands_ok: false } : a));
  assert.deepEqual(ok(base(unread)).lines, []);
});

test("the client's own page started or stopped being cited, held over the latest three days of checks", () => {
  const cite = (url: string) => [{ source_domain: new URL(url).hostname, url }];
  const rows = [
    ...steady(),
    ans(12, "q1", "perplexity", false, { citations: cite("https://www.tallyroo.com/pricing/") }),
    ans(13, "q2", "perplexity", false, { citations: cite("https://tallyroo.com/freelancers") }),
    ans(14, "q2", "perplexity", false, { citations: cite("https://tallyroo.com/freelancers") }),
    // Someone else's page is not the client's.
    ans(13, "q3", "perplexity", false, { citations: cite("https://ledgerline.example/pricing") }),
    ans(14, "q3", "perplexity", false, { citations: cite("https://ledgerline.example/pricing") }),
  ];
  assert.deepEqual(
    ok(base(rows)).lines.map((l) => l.text),
    ["Engines started citing tallyroo.com/freelancers: cited on 13 Oct and 14 Oct, not on 12 Oct.", "Engines stopped citing tallyroo.com/pricing: cited on 12 Oct, not on 13 Oct or 14 Oct."],
  );
});

test("the latest check, partial or failed, comes first", () => {
  const runs = [
    { run_date: day(12), status: "complete", error: null },
    { run_date: day(13), status: "complete", error: null },
    { run_date: day(14), status: "partial", error: "5 of 40 reads failed - gemini: 3 x HTTP 429; gemini: 1 x timeout; keyword: 1 x timeout" },
  ];
  const lost = [ans(12, "q1", "chatgpt", true), ans(13, "q1", "chatgpt", false), ans(14, "q1", "chatgpt", false)];
  const rows = [...steady().filter((a) => !(a.question_id === "q1" && a.engine === "chatgpt")), ...lost];
  assert.deepEqual(
    ok(base(rows, { runs })).lines.map((l) => [l.kind, l.text]),
    [
      ["check", "Your check on 14 Oct was partial: Gemini did not answer 4 prompts and 1 Google keyword position was not read."],
      ["lost", "ChatGPT stopped naming you for 'best invoicing app for freelancers'."],
    ],
  );
  assert.deepEqual([...failedCounts(runs[2]!.error)], [["gemini", 4], ["keyword", 1]]);
  // Partial only for a brand gap lost no read: no line.
  const brandOnly = runs.map((r) => (r.run_date === day(14) ? { ...r, error: "brand extraction failed for 12 of 40 answers - chatgpt: 12 x language model error" } : r));
  assert.deepEqual(ok(base(steady(), { runs: brandOnly })).lines, []);
  // Failed, with and without answers stored that day.
  const failed = runs.map((r) => (r.run_date === day(14) ? { ...r, status: "failed", error: "could not store" } : r));
  assert.equal(ok(base(steady(), { runs: failed })).lines[0]!.text, "Your check on 14 Oct did not finish, so some of its reads may be missing.");
  const nothing = [...steady([11, 12, 13])];
  assert.equal(ok(base(nothing, { runs: failed })).lines[0]!.text, "Your check on 14 Oct failed: none of its reads came back.");
  // A run still going is not the latest check.
  const running = [...runs.slice(0, 2), { run_date: day(14), status: "running", error: null }];
  assert.deepEqual(ok(base(steady(), { runs: running })).lines, []);
});

test("order, grouping above 3, and the cap of 8 with a count", () => {
  // ChatGPT stops naming all five prompts; Gemini stops naming q1; Perplexity starts naming q1 and q2.
  const rows: DiffAnswer[] = [];
  for (const q of ["q1", "q2", "q3", "q4", "q5"]) rows.push(ans(12, q, "chatgpt", true), ans(13, q, "chatgpt", false), ans(14, q, "chatgpt", false));
  rows.push(ans(12, "q1", "gemini", true), ans(13, "q1", "gemini", false), ans(14, "q1", "gemini", false));
  for (const q of ["q1", "q2"]) rows.push(ans(12, q, "perplexity", false), ans(13, q, "perplexity", true), ans(14, q, "perplexity", true));
  const serp = [12, 13, 14].map((d, i) => ({ run_date: day(d), keyword_id: "k1", position: [5, 14, 15][i]! }));
  const r = ok(base(rows, { serp }));
  assert.deepEqual(
    r.lines.map((l) => l.text),
    [
      "ChatGPT stopped naming you for 5 prompts.",
      "Gemini stopped naming you for 'best invoicing app for freelancers'.",
      "'invoicing software' left page 1: 5th to 15th.",
      "Perplexity started naming you for 'best invoicing app for freelancers'.",
      "Perplexity started naming you for 'best accounting app for sole traders'.",
    ],
  );
  assert.deepEqual(r.lines[0]!.link, { to: "engine", engine: "chatgpt" });
  assert.equal(r.more, 0);
  // Every kind is in the recorded order.
  const kinds = r.lines.map((l) => CHANGE_ORDER.indexOf(l.kind));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));

  // Twelve lines: eight shown, four counted. Lost on Gemini and won on ChatGPT, three each (not grouped), and keywords.
  const many: DiffAnswer[] = [];
  for (const q of ["q1", "q2", "q3"]) many.push(ans(12, q, "gemini", true), ans(13, q, "gemini", false), ans(14, q, "gemini", false));
  for (const q of ["q3", "q4", "q5"]) many.push(ans(12, q, "chatgpt", false), ans(13, q, "chatgpt", true), ans(14, q, "chatgpt", true));
  const kws = Array.from({ length: 6 }, (_, i) => ({ id: `k${i + 1}`, keyword: `keyword ${i + 1}` }));
  const moves = kws.flatMap((k, i) => [12, 13, 14].map((d, j) => ({ run_date: day(d), keyword_id: k.id, position: i % 2 ? [15, 9, 8][j]! : [4, 12, 13][j]! })));
  const capped = ok(base(many, { keywords: kws, serp: moves }));
  assert.equal(capped.lines.length, MAX_LINES);
  assert.equal(capped.more, 12 - MAX_LINES);
  assert.deepEqual(capped.lines.map((l) => l.kind), ["lost", "lost", "lost", "left_page1", "left_page1", "left_page1", "won", "won"]);
});

test("watched pages (W2): first cited inside the window", () => {
  const watched = [
    { urlKey: "smallbizstack.example/best-invoicing-apps", label: "smallbizstack.example's list", href: "/app/tallyroo/opportunities/o1", firstCited: { day: day(13), engine: "perplexity" } },
    { urlKey: "old.example/page", label: "old.example's page", href: null, firstCited: { day: day(1), engine: "chatgpt" } },
    { urlKey: "never.example/page", label: "never.example's page", href: null, firstCited: null },
  ];
  assert.deepEqual(ok(base(steady(), { watched })).lines, [
    { kind: "watched", text: "smallbizstack.example's list was first cited by Perplexity for one of your prompts on 13 Oct.", link: { to: "href", href: "/app/tallyroo/opportunities/o1" } },
  ]);
});

test("no line uses a causal word", () => {
  const rows: DiffAnswer[] = [];
  for (const q of ["q1", "q2"]) rows.push(ans(12, q, "chatgpt", true, { brands: ["Tallyroo"] }), ans(13, q, "chatgpt", false), ans(14, q, "chatgpt", false, { brands: ["Ledgerline"] }));
  const lines = ok(base(rows)).lines;
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.doesNotMatch(l.text, /\b(caused|drove|because of|thanks to|resulted in|delivered)\b/i);
});
