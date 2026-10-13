import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPage } from "../../scan/dataforseo-request.ts";

import { dayOf, factsFromHtml, factsFromParsed, linkToClient, pageHeadings, snippetAround, updatedOn, visibleText } from "./read-page.ts";
import { readRow } from "./data.ts";

/**
 * Page reads (13 Oct 2026, DIY P7; spec 10 section 6.2, "Page reads"): the
 * brand matcher is checked before its verdict is trusted (Nomada's W19: a
 * read reported no mention where an engine had named the brand), with the
 * brand in a heading, in alt text, in a table and in a link; the snippet is
 * at most 200 characters; no body text is stored; and a content_parsing read
 * never says "doesn't name you". Illustrative: every brand here is made up.
 */

const SUBJECT = { brand: "Tallyroo", domain: "tallyroo.com", aliases: ["Tally Roo"] };
const AT = "2026-09-29T03:40:00Z";
const TODAY = "2026-09-29";

const page = (body: string, head = "<title>The 9 best invoicing apps</title>") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const facts = (html: string, competitors: string[] = ["Brightly", "Ledgerly"]) =>
  factsFromHtml({ url: "https://lists.example/best-invoicing-apps", urlKey: "lists.example/best-invoicing-apps", at: AT, today: TODAY, read: { status: 200, html }, subject: SUBJECT, competitors });

test("names_client: the brand in a heading, in alt text, in a table and in a link (W19)", () => {
  assert.equal(facts(page("<h2>Tallyroo</h2><p>An app for invoices.</p>")).namesClient, true, "a heading");
  assert.equal(facts(page('<p>Our picks:</p><img src="/logo.png" alt="Tallyroo logo">')).namesClient, true, "alt text");
  assert.equal(facts(page("<table><tr><th>App</th><th>Score</th></tr><tr><td>Tallyroo</td><td>9</td></tr></table>")).namesClient, true, "a table cell");
  assert.equal(facts(page('<p>See <a href="https://other.example">Tallyroo</a> for more.</p>')).namesClient, true, "link text");
  assert.equal(facts(page("<p>Try Tally Roo for freelancers.</p>")).namesClient, true, "an alias");
  assert.equal(facts(page("<p>Brightly and Ledgerly lead the list.</p>")).namesClient, false, "read in full, not named");
  assert.equal(facts(page("<script>var x = 'Tallyroo';</script><p>Brightly leads.</p>")).namesClient, false, "script text is not visible text");
});

test("the snippet is at most 200 characters around the first mention, and no body text is stored", () => {
  const long = `<p>${"Invoicing apps compared for small teams. ".repeat(20)}Tallyroo stands out for freelancers who bill weekly. ${"More words follow here. ".repeat(20)}</p>`;
  const f = facts(page(long));
  assert.ok(f.snippet && f.snippet.length <= 200, `snippet ${f.snippet?.length}`);
  assert.ok(f.snippet!.includes("Tallyroo"));
  const row = readRow("client-1", f);
  // 13 Oct 2026, review of DIY P7: attempted_at joins the row (null when a read replaces it), so the night waits from a failed try.
  assert.deepEqual(Object.keys(row).sort(), ["attempted_at", "brands_found", "client_domain_id", "client_snippet", "h1", "headings", "http_status", "link_anchor", "link_rel", "links_to_client", "names_client", "read_at", "read_id", "status", "title", "updated_on", "url", "url_key", "via"].sort());
  assert.ok(!JSON.stringify(row).includes("More words follow here. More words follow here. More words follow here."), "the body is not in the row");
  assert.equal(snippetAround("No mention at all.", SUBJECT), null);
});

test("title, h1, headings (at most 40, each at most 120), competitors found, and the client link with its rel", () => {
  const hs = Array.from({ length: 45 }, (_, i) => `<h2>Criterion ${i} ${"x".repeat(i === 0 ? 150 : 1)}</h2>`).join("");
  const html = page(`<h1>Best invoicing apps</h1>${hs}<h3>Ease of use</h3><p>Brightly is fine.</p><a rel="nofollow ugc" href="https://www.tallyroo.com/pricing?ref=x">Try Tallyroo</a>`);
  const f = facts(html);
  assert.equal(f.title, "The 9 best invoicing apps");
  assert.equal(f.h1, "Best invoicing apps");
  assert.equal(f.headings.length, 40);
  assert.ok(f.headings.every((h) => h.length <= 120));
  assert.deepEqual(f.brandsFound, ["Brightly"]);
  assert.equal(f.linksToClient, true);
  assert.equal(f.linkRel, "not_followed");
  assert.equal(f.linkAnchor, "Try Tallyroo");
  const sub = ["app", "tallyroo", "com"].join(".");
  assert.deepEqual(linkToClient(`<a href="https://${sub}/signup" rel="noopener">Sign up</a>`, "tallyroo.com"), { found: true, rel: "followed", anchor: "Sign up" });
  assert.deepEqual(linkToClient('<a href="https://tallyroo.com.evil.example/">x</a>', "tallyroo.com"), { found: false, rel: null, anchor: null });
  assert.equal(pageHeadings("<h4>not kept</h4><h2>kept</h2>").length, 1);
});

test("the last-updated date: the modified meta first, then a date near 'updated' or 'published', never in the future", () => {
  assert.equal(updatedOn('<meta property="article:modified_time" content="2026-09-02T10:00:00Z">', "", TODAY), "2026-09-02");
  assert.equal(updatedOn("", "Last updated: 2 September 2026. Our picks", TODAY), "2026-09-02");
  assert.equal(updatedOn("", "Published Aug 14, 2026 by the team", TODAY), "2026-08-14");
  assert.equal(updatedOn("", "Updated December 2026", TODAY), null, "after today is not a date we believe");
  assert.equal(updatedOn("", "No date here", TODAY), null);
  assert.equal(dayOf("31 Feb 2026"), null);
  assert.equal(dayOf("Sep 2026"), "2026-09-01");
});

test("an error page and a non-HTML answer keep no facts", () => {
  const err = factsFromHtml({ url: "https://x.example/a", urlKey: "x.example/a", at: AT, today: TODAY, read: { status: 403, html: "<p>Tallyroo</p>" }, subject: SUBJECT, competitors: [] });
  assert.equal(err.status, "error");
  assert.equal(err.http, 403);
  assert.equal(err.namesClient, null, "a page we could not read never reads as 'doesn't name you'");
  const pdf = factsFromHtml({ url: "https://x.example/a.pdf", urlKey: "x.example/a.pdf", at: AT, today: TODAY, read: { status: 200, html: "%PDF", contentType: "application/pdf" }, subject: SUBJECT, competitors: [] });
  assert.equal(pdf.status, "not_html");
});

test("content_parsing: named from title, headings and anchors; otherwise not known, never 'doesn't name you'; no rel", () => {
  const parsed = (over: Partial<ParsedPage>): ParsedPage => ({ status: 200, title: "Best invoicing apps", h1: "Invoicing apps", headings: [{ level: 2, text: "Brightly" }], dates: ["2 Sep 2026"], links: [], wordCount: 900, ...over });
  const base = { url: "https://x.example/a", urlKey: "x.example/a", at: AT, today: TODAY, subject: SUBJECT, competitors: ["Brightly"] };
  const none = factsFromParsed({ ...base, parsed: parsed({}) });
  assert.equal(none.namesClient, null);
  assert.equal(none.via, "content_parsing");
  assert.equal(none.updatedOn, "2026-09-02");
  assert.deepEqual(none.brandsFound, ["Brightly"]);
  const inHeading = factsFromParsed({ ...base, parsed: parsed({ headings: [{ level: 2, text: "3. Tallyroo" }] }) });
  assert.equal(inHeading.namesClient, true);
  const link = factsFromParsed({ ...base, parsed: parsed({ links: [{ url: "https://tallyroo.com/", anchor: "an invoicing app" }] }) });
  assert.equal(link.linksToClient, true);
  assert.equal(link.linkRel, null, "content_parsing returns no rel");
  assert.equal(factsFromParsed({ ...base, parsed: null }).status, "error");
});

test("visible text keeps alt text and table cells and drops scripts, styles and comments", () => {
  const t = visibleText('<style>.a{}</style><!-- Tallyroo --><p>One</p><img alt="Two"><table><tr><td>Three</td></tr></table><noscript>Four</noscript>');
  assert.match(t, /One/);
  assert.match(t, /Two/);
  assert.match(t, /Three/);
  assert.doesNotMatch(t, /Tallyroo|Four|\.a/);
});
