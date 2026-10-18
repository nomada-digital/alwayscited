import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { askLabel, historyLines, movesFor, statusLine } from "./detail.ts";
import { brief, criteria, pitchOutline, targetPage, unreadableLine, whatItIs } from "./brief.ts";
import { checkLogUrl, loggedRoute } from "./logsite.ts";
import { EMPTY_ALL_NAME_YOU, EMPTY_NO_CITATIONS, EMPTY_NONE_NEW, LIST_ROW_KEYS, PURSUING_ROW_KEYS, citedEmpty, firstCitedLines, freshLines, headerLine, listRow, namesLine, pursuingRow, u3LeavesOut, whyFacts, whyLine } from "./payload.ts";
import { U3_ROUTES } from "./routes.ts";
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

test("the target page a person chose wins over the ranking page and the blog rule (18 Oct 2026)", () => {
  assert.deepEqual(targetPage({ domain: "tallyroo.com", chosen: "https://tallyroo.com/blog/best-invoicing", ranking: "https://tallyroo.com/invoicing", keyPage: null, intent: "commercial" }), { url: "https://tallyroo.com/blog/best-invoicing", how: "chosen" });
  assert.deepEqual(targetPage({ domain: "tallyroo.com", chosen: null, ranking: "https://tallyroo.com/invoicing", keyPage: null, intent: "commercial" }), { url: "https://tallyroo.com/invoicing", how: "ranking" });
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
  // 13 Oct 2026, review of DIY P7: an ended client has no ask or upgrade surface (spec 10 section 2.2).
  assert.equal(askLabel({ placed: true, mode: "nomada", ended: true }), null);
  assert.equal(askLabel({ placed: false, mode: "agency", ended: true }), null);
});

test("U3 only from the page as read: two or more competitors on it and not you (review of DIY P7, 13 Oct 2026)", () => {
  const p = { dark: false, clusterOpen: 3, routes: U3_ROUTES };
  const fired = u3LeavesOut(opp(), facts(), p);
  assert.deepEqual(fired?.names, ["Brightly", "Ledgerly"], "the brands found on the page, never the answers' competitors");
  assert.equal(fired?.answers, 12);
  assert.equal(u3LeavesOut(opp(), null, p), undefined, "unread: the answers' brands say nothing about the page");
  assert.equal(u3LeavesOut(opp({ route: "send_correction" }), facts({ namesClient: true, brandsFound: ["Brightly", "Ledgerly"] }), p), undefined, "a page that names you");
  assert.equal(u3LeavesOut(opp(), facts({ via: "content_parsing", namesClient: null }), p), undefined, "a fallback read that could not tell");
  assert.equal(u3LeavesOut(opp(), facts({ brandsFound: ["Brightly"] }), p), undefined, "one competitor is not two");
  assert.equal(u3LeavesOut(opp(), facts({ status: "error", http: 403 }), p), undefined, "a page we could not read");
  assert.equal(u3LeavesOut(opp(), facts(), { ...p, dark: true }), undefined);
  assert.equal(u3LeavesOut(opp({ status: "won" }), facts(), p), undefined);
  assert.equal(u3LeavesOut(opp({ route: "answer_thread" }), facts(), p), undefined, "not a U3 route");
});

test("the cited tab's empty state says only what the reads show (review of DIY P7, 13 Oct 2026)", () => {
  assert.equal(citedEmpty({ pages: 0, readNamingYou: 0, own: 0 }, []), EMPTY_NO_CITATIONS);
  assert.equal(citedEmpty({ pages: 4, readNamingYou: 4, own: 1 }, []), EMPTY_ALL_NAME_YOU, "every cited page read, and every read names you");
  // One read naming you, three pages never read or not naming you: not "every page names you".
  const none = citedEmpty({ pages: 4, readNamingYou: 1, own: 0 }, []);
  assert.ok(none.startsWith(EMPTY_NONE_NEW));
  assert.match(none, /in the other tabs\.$/);
  // Every page set aside or pursued: never "names you"; the line says where they went.
  const worked = citedEmpty({ pages: 4, readNamingYou: 1, own: 0 }, [opp({ status: "dismissed" }), opp({ id: "o2", status: "pursuing" })]);
  assert.match(worked, /under Pursuing; pages you marked not for us stay out of this list\.$/);
  assert.ok(!worked.includes("names you"));
  assert.ok(citedEmpty(null, []).startsWith(EMPTY_NONE_NEW), "a summary that could not be read is never a claim");
});

test("History's first cited, per engine; the publish_own why line says only what we know", () => {
  const prompts = new Map([["q1", "best invoicing apps"]]);
  assert.deepEqual(firstCitedLines(opp({ first_cited: { perplexity: { day: "2026-11-09", prompt: "q1" }, chatgpt: { day: "2026-11-11", prompt: "q2" } }, pursued_on: "2026-11-01" }), prompts), ["First cited by Perplexity for 'best invoicing apps' on 9 Nov.", "First cited by ChatGPT on 11 Nov."]);
  assert.deepEqual(firstCitedLines(opp({ pursued_on: "2026-11-01" }), prompts), ["Not cited since you started on 1 Nov."]);
  assert.deepEqual(firstCitedLines(opp(), prompts), []);
  const own = opp({ lens: "own", route: "publish_own", evidence: { to: TODAY, keyword: "invoicing software", own_type: "best_of", own_seen: 5 } });
  assert.equal(whyLine(own), "The answers and Google's top 10 for 'invoicing software' show 5 best-of lists; none of yours ranks or is cited for it.");
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
  // Typed within 500 characters, but longer once the parser encodes it: refused, never kept cut short.
  assert.deepEqual(checkLogUrl(`https://consult.example/${"あ".repeat(100)}`, p), { ok: false, why: "url" });
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
  assert.match(body, /if \(client\.status === "ended"\) return back\("refused", "ended"\);/, "an ended client cannot ask (spec 10 section 2.2)");
});

test("a type the rules did not settle was written by a model, and says so", async () => {
  const { typesLine, byModel } = await import("./payload.ts");
  const base = { url: "https://lists.example/best-invoicing-apps", domain: "lists.example", title: null };
  // 13 Oct 2026, review of DIY P7: the label sits on the half the model wrote, never on a blank ("Publisher · not
  // classified yet · classified automatically" read as if the blank were the model's).
  assert.equal(typesLine({ ...base, domainType: "publisher", pageType: "best_of" }), "Publisher (classified automatically) · Best-of list", "the domain type is the model's");
  assert.equal(typesLine({ ...base, url: "https://lists.example/roundup", domainType: "publisher", pageType: null }), "Publisher (classified automatically) · not classified yet");
  assert.equal(typesLine({ ...base, url: "https://g2.com/roundup", domain: "g2.com", domainType: "review_platform", pageType: "best_of" }), "Review site · Best-of list (classified automatically)", "the page type is the model's");
  assert.equal(typesLine({ ...base, url: "https://g2.com/categories/x", domain: "g2.com", domainType: "review_platform", pageType: "category" }), "Review site · Category page", "both by rule");
  assert.equal(byModel({ ...base, url: "https://lists.example/roundup", domainType: null, pageType: "best_of" }), true);
  assert.equal(typesLine({ domainType: null, pageType: null }), "not classified yet");
  assert.equal(typesLine({ lens: "own", domainType: null, pageType: "best_of", url: "https://tallyroo.com/", domain: "tallyroo.com" }), "Your site · Best-of list");
});
