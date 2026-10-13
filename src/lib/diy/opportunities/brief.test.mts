import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { askLabel, historyLines, movesFor, statusLine } from "./detail.ts";
import { brief, criteria, pitchOutline, targetPage, unreadableLine, whatItIs } from "./brief.ts";
import { checkLogUrl, loggedRoute } from "./logsite.ts";
import { LIST_ROW_KEYS, PURSUING_ROW_KEYS, freshLines, headerLine, listRow, namesLine, pursuingRow, whyFacts } from "./payload.ts";
import { opportunityOf } from "./status.ts";
import type { PageFacts } from "./types.ts";

/**
 * The brief and the views (13 Oct 2026, DIY P7; spec 10 sections 4.7 and
 * 6.2): the pitch outline's blanks are filled only from our own data; the
 * target page rule; "Log a site" refuses with one set of words; every view
 * carries its allow-listed keys and no more. Illustrative: Tallyroo and every
 * brand and site here are made up.
 */

const TODAY = "2026-11-14";
const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const opp = (over: Record<string, unknown> = {}) =>
  opportunityOf({ id: "opp-1", client_domain_id: "c1", cluster_id: "k1", lens: "cited", url: "https://lists.example/best-invoicing-apps", url_key: "lists.example/best-invoicing-apps", domain: "lists.example", route: "ask_added", status: "new", page_type: "best_of", domain_type: "publisher", evidence: { to: TODAY, answers: 12, leaves_out: 12, others_named: 12, prompts: ["q1", "q2", "q3"], prompt_count: 3, engines: ["chatgpt", "perplexity"], competitors: ["Brightly", "Ledgerly", "Countly", "Sumo"], days_14: 9, days_7: 3, last_cited: TODAY, rank: 4, keyword: "bookkeeping software for sole traders", open: { prompt: "q1", day: TODAY, engine: "chatgpt" } }, first_seen: "2026-10-30", live: true, ...over })!;
const facts = (over: Partial<PageFacts> = {}): PageFacts => ({ urlKey: "lists.example/best-invoicing-apps", url: "https://lists.example/best-invoicing-apps", readAt: "2026-11-03T03:40:00Z", via: "own", status: "ok", http: 200, title: "The 9 best invoicing apps for freelancers", h1: null, updatedOn: "2026-09-02", headings: ["How we chose", "Ease of use", "Invoice templates"], namesClient: false, snippet: null, brandsFound: ["Brightly", "Ledgerly"], linksToClient: false, linkRel: null, linkAnchor: null, ...over });
const TARGET = { url: "https://tallyroo.com/invoicing", how: "ranking" as const };

test("the pitch outline: blanks filled only from our data - their title, their updated date, a heading, the client's brand and target page", () => {
  const p = pitchOutline({ route: "ask_added", facts: facts(), brand: "Tallyroo", target: TARGET })!;
  assert.equal(
    p,
    [
      "Subject: An addition for 'The 9 best invoicing apps for freelancers'",
      "Hi [first name], I read 'The 9 best invoicing apps for freelancers' (2 Sep 2026). You rank tools on [the criterion they use, for example 'Ease of use'].",
      "Tallyroo [the one fact that meets it], shown here: https://tallyroo.com/invoicing.",
      "If it helps your next update, the details are on that page.",
      "[your name, role]",
    ].join("\n"),
  );
  // Nothing we did not read is filled: an unread page keeps every blank.
  const unread = pitchOutline({ route: "ask_added", facts: null, brand: "Tallyroo", target: TARGET })!;
  assert.match(unread, /\[their page title\]/);
  assert.match(unread, /\[the date it was updated\]/);
  assert.match(unread, /\[the criterion they use\]/);
  // Every bracket that is not a blank is one of ours: the outline names nobody and is never send-ready.
  for (const route of ["ask_added", "send_correction", "offer_resource"] as const) {
    const text = pitchOutline({ route, facts: facts(), brand: "Tallyroo", target: TARGET })!;
    assert.match(text, /\[first name\]/);
    assert.match(text, /\[your name, role\]/);
    assert.ok(!/@|http(?!s:\/\/tallyroo\.com)/.test(text), "no address and no URL but the client's own page");
  }
  assert.equal(pitchOutline({ route: "answer_thread", facts: facts(), brand: "Tallyroo", target: TARGET }), null, "a thread gets no pitch");
  assert.equal(pitchOutline({ route: "get_listed", facts: facts(), brand: "Tallyroo", target: TARGET }), null);
});

test("criteria: the page's headings, less the ones about the page itself, at most 8", () => {
  assert.deepEqual(criteria(facts({ headings: ["How we chose", "Our picks", "Ease of use", "FAQ", "Conclusion", "Invoice templates"] })), ["Ease of use", "Invoice templates"]);
  assert.deepEqual(criteria(facts({ headings: Array.from({ length: 12 }, (_, i) => `Criterion ${i}`) })).length, 8);
  assert.deepEqual(criteria(facts({ status: "error" })), []);
});

test("the target page: the ranking page, else the cluster's key page, else the homepage; never a blog post for a buying keyword", () => {
  assert.deepEqual(targetPage({ domain: "tallyroo.com", ranking: "https://tallyroo.com/invoicing", keyPage: null, intent: "commercial" }), { url: "https://tallyroo.com/invoicing", how: "ranking" });
  assert.deepEqual(targetPage({ domain: "tallyroo.com", ranking: "https://tallyroo.com/blog/how-to-invoice", keyPage: "https://tallyroo.com/invoicing", intent: "commercial" }), { url: "https://tallyroo.com/invoicing", how: "key_page" });
  assert.deepEqual(targetPage({ domain: "tallyroo.com", ranking: "https://tallyroo.com/blog/how-to-invoice", keyPage: null, intent: "informational" }), { url: "https://tallyroo.com/blog/how-to-invoice", how: "ranking" });
  assert.deepEqual(targetPage({ domain: "tallyroo.com", ranking: null, keyPage: null, intent: null }), { url: "https://tallyroo.com/", how: "homepage" });
  assert.deepEqual(targetPage({ domain: "", ranking: null, keyPage: null, intent: null }), { url: null, how: "pick" });
});

test("what it is: read, unread, or a page we could not read - never 'doesn't name you'", () => {
  assert.equal(whatItIs(opp(), null).kind, "unread");
  const unreadable = whatItIs(opp(), facts({ status: "error", http: 403 }));
  assert.deepEqual(unreadable, { kind: "unreadable", text: "We couldn't read this page on 3 Nov (HTTP 403)." });
  assert.equal(unreadableLine({ readAt: "2026-11-03T00:00:00Z", http: null, status: "blocked" }), "We couldn't read this page on 3 Nov: it asks crawlers like ours not to.");
  const r = whatItIs(opp(), facts());
  assert.ok(r.kind === "read" && r.pageType === "Best-of list" && r.updated === "2026-09-02" && r.readOn === "2026-11-03");
  const b = brief({ opp: opp(), facts: facts(), brand: "Tallyroo", target: TARGET });
  assert.equal(b.playbook?.route, "ask_added");
  assert.equal(b.targetLabel, "Your page that ranks for this cluster's keyword");
});

const ctx = { today: TODAY, brand: "Tallyroo", clusters: new Map([["k1", "invoicing software"]]), reads: new Map([["lists.example/best-invoicing-apps", facts()]]), dark: false, answerLink: (p: string, d: string, e: string) => `/clusters/k1?prompt=0&day=${d}&engine=${e}#answer-${e}${p ? "" : ""}`, path: (p: string) => `/app/tallyroo${p}` };

test("the list row: allow-listed keys only, our counts, what we read, and the dark rule", () => {
  const row = listRow(opp(), ctx);
  assert.deepEqual(Object.keys(row).sort(), [...LIST_ROW_KEYS].sort());
  assert.equal(row.why, "Cited by ChatGPT and Perplexity for 3 of your prompts in the last 28 days (12 answers).");
  assert.equal(row.whyHref, `/clusters/k1?prompt=0&day=${TODAY}&engine=chatgpt#answer-chatgpt`);
  assert.equal(row.names, "Names Brightly and Ledgerly, not you (read 3 Nov).");
  assert.deepEqual(row.fresh, ["updated on the page: Sep 2026", "still cited this week"]);
  assert.equal(row.title, "The 9 best invoicing apps for freelancers");
  // Dark: page facts are "Not read yet", and the names verdict falls back to the answers.
  const dark = listRow(opp(), { ...ctx, dark: true });
  assert.equal(dark.title, "lists.example/best-invoicing-apps");
  assert.equal(dark.names, "Cited in answers that name Brightly, Ledgerly and 2 others, not you.");
  assert.deepEqual(dark.fresh, ["still cited this week"]);
  assert.equal(namesLine(opp(), facts({ status: "error", http: 403 }), { brand: "Tallyroo", dark: false }), "We couldn't read this page on 3 Nov (HTTP 403).");
  assert.deepEqual(freshLines(opp({ evidence: { to: TODAY, days_7: 0, last_cited: "2026-11-01" } }), null, { today: TODAY, dark: false }), ["last cited 1 Nov"]);
});

test("the pursuing row and the detail's why lines: allow-listed, counts and dates, each count opening its answers", () => {
  const p = pursuingRow(opp({ status: "pursuing", status_at: "2026-11-03T10:00:00Z", prompt_id: "q9", pursued_on: "2026-11-03" }), { ...ctx, prompts: new Map([["q9", "best invoicing apps for freelancers"]]), promptHref: () => "/clusters/k1", domain: "tallyroo.com", addedBy: () => "opp-1" });
  assert.deepEqual(Object.keys(p).sort(), [...PURSUING_ROW_KEYS].sort());
  assert.deepEqual(p.prompt, { text: "best invoicing apps for freelancers", href: "/clusters/k1", added: true });
  assert.equal(p.firstCited, "Not cited since you started on 3 Nov.");
  const why = whyFacts(opp(), ctx);
  assert.equal(why[0]!.text, "Cited by ChatGPT and Perplexity for 3 of your prompts in 12 answers over the 28 days to 14 Nov, on 9 of the last 14 days.");
  assert.ok(why[0]!.href);
  assert.equal(why[1]!.text, "All 12 left you out. The answers that left you out named Brightly, Ledgerly, Countly and Sumo.");
  assert.ok(why.some((w) => w.text === "Ranks #4 on Google for 'bookkeeping software for sole traders'."));
  assert.ok(why.some((w) => w.text === "Updated on the page: 2 Sep 2026."));
  assert.equal(headerLine({ total: 41, lists: 18, threads: 6 }, "2026-10-14"), "41 pages the engines cite leave you out. 18 are best-of lists or comparisons. 6 are threads. Updated overnight from your checks to 14 Oct.");
});

test("the detail page's moves, status line, history and ask", () => {
  assert.deepEqual(movesFor("new"), ["pursue", "dismiss"]);
  assert.deepEqual(movesFor("pursuing"), ["pitched", "won", "decline", "dismiss"]);
  assert.deepEqual(movesFor("won"), ["reopen"]);
  assert.equal(statusLine(opp({ status: "dismissed", dismiss_reason: "not_relevant", status_at: "2026-11-03T10:00:00Z" })), "Not for us: not relevant, since 3 Nov");
  assert.equal(statusLine(opp()), "New, first seen 30 Oct");
  assert.deepEqual(historyLines([{ at: "2026-11-03T10:00:00Z", kind: "status", status: "pursuing", by: "a@example.com" }, { at: "2026-11-04T03:40:00Z", kind: "verify", by: "system", text: "Verified: the page names Tallyroo, 4 Nov" }]).map((h) => h.text), ["Verified: the page names Tallyroo, 4 Nov.", "Pursuing by a@example.com."]);
  assert.equal(askLabel({ placed: true, mode: "nomada" }), "Suggest this to your account lead");
  assert.equal(askLabel({ placed: false, mode: "agency" }), "Ask your agency about this page");
  assert.equal(askLabel({ placed: false, mode: "nomada" }), null);
  assert.equal(askLabel({ placed: true, mode: "off" }), null);
});

test("Log a site: a public http(s) address; one set of words for every refusal, placements included", () => {
  const p = { domain: "tallyroo.com", placedKeys: new Set(["placed.example/best-tools"]) };
  assert.equal(checkLogUrl("https://consult.example/best-tools?x=1", p).ok, true);
  assert.deepEqual(checkLogUrl("ftp://consult.example/x", p), { ok: false, why: "url" });
  assert.deepEqual(checkLogUrl("not a url", p), { ok: false, why: "url" });
  assert.deepEqual(checkLogUrl(`https://consult.example/${"x".repeat(500)}`, p), { ok: false, why: "url" });
  assert.deepEqual(checkLogUrl("https://user:pw@consult.example/x", p), { ok: false, why: "url" });
  assert.deepEqual(checkLogUrl("https://tallyroo.com/pricing", p), { ok: false, why: "cannot_log" });
  assert.deepEqual(checkLogUrl("https://placed.example/best-tools", p), { ok: false, why: "cannot_log" }, "the same words as any other refusal");
  assert.deepEqual(checkLogUrl("https://wikipedia.org/wiki/Invoice", p), { ok: false, why: "cannot_log" });
  assert.deepEqual(checkLogUrl("https://bing.com/search", p), { ok: false, why: "cannot_log" });
  const ok = checkLogUrl("https://consult.example/best-tools", p);
  assert.ok(ok.ok);
  assert.equal(loggedRoute({ ...(ok as { url: string; key: string; host: string }), facts: null, kinds: new Map() })?.route, "ask_added");
});

test("the opportunity ask takes no free text: the route reads the kind, the ids and the cta, and builds the mail from the rows", () => {
  const src = readFileSync(join(ROOT, "src/app/api/app/[client]/ask/route.ts"), "utf8");
  const body = src.slice(src.indexOf("async function opportunityAsk("));
  const fields = [...body.matchAll(/form\?\.get\("(\w+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(fields, ["cta", "items"], "only the ids and the cta come from the form");
  assert.match(body, /from\("opportunities"\)\.select\("id, url, url_key, title, route, evidence"\)\.eq\("client_domain_id", client\.id\)/);
  assert.match(body, /placed\.has\(r\.url_key\)/, "a page where another client was placed is never asked about");
});
