import assert from "node:assert/strict";
import { test } from "node:test";

import { diagnostics, hasKeyword, promptHeadings, sharedMissing } from "./diagnostics.ts";
import { CHECK_FIGURE, type CallResult, countedExamples, draftExample, exampleMessage, exampleState, guardExample, numberGuard } from "./example.ts";
import { basics } from "./fake-pages.mts";
import type { ExampleBody, TopStructure } from "./types.ts";

/**
 * The diagnostics and the drafted example (13 Oct 2026, DIY P8; spec 10
 * sections 5.3 and 6.5): the rows; the input carrying the top 3's structure
 * and never their text; guardExample's number, claim and length guards;
 * regenerate once; a failure not counted; a pending row over 10 minutes
 * read as failed and not counted.
 */

const top = (rank: number, over: Partial<TopStructure> = {}): TopStructure => ({ clusterId: "c8", keywordId: "k8", readOn: "2026-09-10", rank, url: `https://rival-${rank}.example/cloud`, urlKey: `rival-${rank}.example/cloud`, status: "ok", title: "Cloud accounting software", h1: "Cloud accounting software", headings: [{ level: 2, text: "Which cloud accounting software is most secure?" }, { level: 2, text: "Pricing plans" }], dateShown: true, wordCount: 2000, ...over });
const PROMPTS = ["Which cloud accounting software is most secure?", "What's the best cloud accounting software?"];

test("the diagnostics rows: you against each of the top 3, the price and table rows not read for them, and the length flag under 40% of their median", () => {
  const rows = diagnostics({ keyword: "cloud accounting software", prompts: PROMPTS, you: { basics: basics({ title: "Tallyroo", h1: ["Cloud accounting"], hasTable: true, facts: { ...basics().facts, price: true } }), wordCount: 600 }, top: [top(1), top(2), top(3, { status: "unreadable", title: null })], internalLinks: 2 });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(by.kw_title!.top, [true, true, null]);
  assert.equal(by.kw_title!.you, false);
  assert.equal(by.kw_title!.flag, true, "you lack it and two of the read top 3 have it");
  assert.equal(by.kw_h1!.you, false, "'Cloud accounting' lacks 'software'");
  assert.deepEqual(by.price!.top, [null, null, null], "not read for the top 3, never 'no'");
  assert.equal(by.table!.you, true);
  assert.deepEqual(by.headings!.top, [1, 1, null]);
  assert.equal(by.length!.flag, true, "600 is under 40% of 2000");
  assert.equal(by.internal!.you, 2);
  assert.equal(hasKeyword("Cloud Accounting Softwares for teams", "cloud accounting software"), true, "plural-insensitive, any order");
  assert.equal(promptHeadings([{ text: "How secure is cloud accounting software?" }], PROMPTS), 1);
  assert.deepEqual(sharedMissing([top(1), top(2)], [{ text: "Pricing plans" }]), ["Which cloud accounting software is most secure?"]);
});

test("the example input carries the top 3's structure only - headings and flags - and never their text", () => {
  const msg = exampleMessage({
    brand: "Tallyroo",
    pageUrl: "https://tallyroo.com/cloud",
    pageText: "Tallyroo keeps your books in the cloud. Plans from $29 a month.",
    keyword: "cloud accounting software",
    prompts: PROMPTS,
    top: [top(1), top(2)],
    answer: { sentence: "Ledgerline is a popular choice for small teams.", cites: "https://ledgerline.com/cloud" },
    diagnostics: [],
    otherPages: ["https://tallyroo.com/pricing"],
  });
  assert.match(msg, /h2: Which cloud accounting software is most secure\?/);
  assert.match(msg, /date shown: yes/);
  assert.match(msg, /Plans from \$29 a month/, "the client's own page is in it");
  const t = top(1) as unknown as Record<string, unknown>;
  assert.ok(!("text" in t) && !("body" in t), "a TopStructure has no text to send");
  assert.equal((msg.match(/rival-1\.example/g) ?? []).length, 1, "a top result appears as its address and its structure only");
});

const body = (over: Partial<ExampleBody> = {}): ExampleBody => ({
  title: "Cloud accounting software for small teams | Tallyroo",
  h1: "Cloud accounting software your team can use",
  opening: "Tallyroo keeps your books in the cloud. Plans from $29 a month.",
  missing_section: { heading: "How secure is it?", bullets: ["Where data is stored", "How sign-in works", "Who can see what"] },
  link_sentence: { from_url: "https://tallyroo.com/pricing", sentence: "See Tallyroo's cloud accounting.", anchor: "Tallyroo's cloud accounting" },
  facts_used: [],
  placeholders: [],
  ...over,
});
const PAGE = "Tallyroo keeps your books in the cloud. Plans from $29 a month. Used by 4,000 teams.";

test("the number guard: a figure not in the page text becomes [ADD: check this figure] and is recorded; one in it, or in a placeholder, stays", () => {
  const hits: { field: string; token: string }[] = [];
  assert.equal(numberGuard("Trusted by 10,000 teams, from $29 a month, 99% uptime.", PAGE, "opening", hits), `Trusted by ${CHECK_FIGURE} teams, from $29 a month, ${CHECK_FIGURE} uptime.`);
  assert.deepEqual(hits, [
    { field: "opening", token: "10,000" },
    { field: "opening", token: "99%" },
  ]);
  assert.equal(numberGuard("Used by 4000 teams. [ADD: 3 customer quotes]", PAGE, "x", []), "Used by 4000 teams. [ADD: 3 customer quotes]", "4,000 is 4000, and a placeholder's own number is left");
  const g = guardExample(body({ opening: "Join 50,000 teams. Plans from $29 a month." }), PAGE);
  assert.ok(g.ok);
  assert.equal(g.ok && g.example.opening, `Join ${CHECK_FIGURE} teams. Plans from $29 a month.`);
  assert.deepEqual(g.ok && g.hits, [{ field: "opening", token: "50,000" }]);
});

test("the claim guard rejects a ranking, a guarantee, a will-be-cited, an engine claim and each causal word", () => {
  const claims = ["We rank #1 for cloud accounting.", "Results guaranteed.", "This page will be cited.", "ChatGPT loves Tallyroo.", "AI Overviews prefer it.", "Growth caused by Tallyroo.", "Sales rose thanks to Tallyroo.", "It drove more sign-ups.", "Savings because of automation.", "It resulted in faster close.", "We delivered results."];
  for (const c of claims) {
    const g = guardExample(body({ opening: c }), PAGE);
    assert.equal(g.ok, false, c);
  }
  assert.ok(guardExample(body(), PAGE).ok, "a plain draft passes");
});

test("the length limits: cut at 60, 80 and 100 words; an empty element or fewer than 3 bullets rejects", () => {
  const long = guardExample(body({ title: "Cloud accounting software for small teams and growing businesses | Tallyroo", h1: "x ".repeat(60), opening: "word ".repeat(140) }), PAGE);
  assert.ok(long.ok);
  assert.ok(long.ok && long.example.title.length <= 60 && long.example.h1.length <= 80);
  assert.equal(long.ok && long.example.opening.split(" ").length, 100);
  assert.deepEqual(guardExample(body({ title: "   " }), PAGE), { ok: false, reason: "empty title" });
  assert.equal(guardExample(body({ missing_section: { heading: "H", bullets: ["one", "two"] } }), PAGE).ok, false);
});

test("a reject is written again once; a second reject fails; a refused or failed call fails without a second call", async () => {
  let calls = 0;
  const bad: CallResult = { kind: "read", value: body({ opening: "We rank #1." }), readId: "r1" };
  const good: CallResult = { kind: "read", value: body(), readId: "r2" };
  const once = await draftExample(async () => (++calls === 1 ? bad : good), PAGE);
  assert.equal(once.status, "ready");
  assert.equal(once.attempts, 2);
  calls = 0;
  const twice = await draftExample(async () => (calls++, bad), PAGE);
  assert.deepEqual([twice.status, twice.attempts, calls], ["failed", 2, 2]);
  assert.match((twice as { error: string }).error, /rejected twice: claim in opening/);
  calls = 0;
  const refused = await draftExample(async () => (calls++, { kind: "refused", reason: "this month's allowance is used" }), PAGE);
  assert.deepEqual([refused.status, calls], ["failed", 1]);
});

test("a failed example and a pending one over 10 minutes are not counted; only ready ones are", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  assert.equal(exampleState({ status: "pending", requestedAt: "2026-09-29T11:58:00Z" }, now), "pending");
  assert.equal(exampleState({ status: "pending", requestedAt: "2026-09-29T11:40:00Z" }, now), "failed", "20 minutes: the work died");
  const rows = [
    { status: "ready" as const, requestedAt: "2026-09-25T09:00:00Z" },
    { status: "failed" as const, requestedAt: "2026-09-20T09:00:00Z" },
    { status: "pending" as const, requestedAt: "2026-09-29T11:40:00Z" },
    { status: "ready" as const, requestedAt: "2026-08-31T09:00:00Z" },
  ];
  assert.equal(countedExamples(rows, "2026-09-01T00:00:00Z"), 1);
});
