import assert from "node:assert/strict";
import test from "node:test";

import { analyseKeywordResult } from "./keyword-read.ts";
import { isGoto, limitedResolver, plainTarget, resolveGoto } from "./goto.ts";

const names = (t: string) => /\bCOMMON\b/.test(t);
const wrap = (n: number) => `https://google.co.uk/goto?url=CAESd${n}`;
const org = (rank: number, url: string, extra: Record<string, unknown> = {}) => ({ type: "organic", rank_group: rank, rank_absolute: rank, domain: new URL(url).hostname, url, title: `Page ${rank}`, description: "", ...extra });
const wrapped = (rank: number, crumb: string, extra: Record<string, unknown> = {}) => ({ type: "organic", rank_group: rank, rank_absolute: rank, domain: "google.co.uk", url: wrap(rank), breadcrumb: crumb, title: `Page ${rank}`, description: "", ...extra });

test("only organic items are results, and a wrapped result is the site from its breadcrumb with no invented url", () => {
  const r = analyseKeywordResult({ items: [
    { type: "people_also_ask", items: [] },
    wrapped(1, "https://craftcms.com › partners › common", { title: "COMMON - Craft CMS partner", description: "Craft CMS agency in York" }),
    wrapped(2, "https://expression37.co.uk › Blog"),
    wrapped(3, "https://www.common.agency › craft-cms"),
    org(4, "https://www.example.com/a"),
    { type: "video", rank_group: 5, url: "https://www.youtube.com/x" },
  ] }, { domain: "common.agency", market: "UK", partial: false, names });
  assert.deepEqual(r.detail.map((d) => [d.rank, d.domain, d.url]), [[1, "craftcms.com", null], [2, "expression37.co.uk", null], [3, "common.agency", null], [4, "example.com", "https://www.example.com/a"]]);
  assert.equal(r.rank, 3, "common.agency is found at 3 from the breadcrumb");
  assert.ok(r.detail[0]!.goto?.includes("goto?url="));
});

test("a third-party page that names the client in the top 10 is a listing, never the client's own position", () => {
  const r = analyseKeywordResult({ items: [
    wrapped(1, "https://craftcms.com › partners › common", { title: "COMMON - Craft CMS partner" }),
    org(2, "https://other.example/agency", { title: "Common mistakes in agency choice" }),
    wrapped(3, "https://www.common.agency › craft-cms", { title: "COMMON | Craft CMS agency" }),
  ] }, { domain: "common.agency", market: "UK", partial: false, names });
  assert.deepEqual(r.candidates.map((c) => [c.rank, c.domain]), [[1, "craftcms.com"]], "own site is not a listing; 'Common mistakes' does not name COMMON as written");
  assert.equal(r.rank, 3);
});

test("the AI Overview names the client by its text or by its source, and is shown without naming", () => {
  const aio = (text: string, refs: { domain: string }[] = []) => ({ type: "ai_overview", items: [{ text, references: refs }], references: [] });
  const base = [org(1, "https://www.example.com/")];
  assert.deepEqual(analyseKeywordResult({ items: [...base, aio("COMMON is a Craft CMS agency in York.")] }, { domain: "common.agency", market: "UK", partial: false, names }).aio, { shown: true, named: true });
  assert.deepEqual(analyseKeywordResult({ items: [...base, aio("Several agencies exist.", [{ domain: "www.common.agency" }])] }, { domain: "common.agency", market: "UK", partial: false, names }).aio, { shown: true, named: true });
  assert.deepEqual(analyseKeywordResult({ items: [...base, aio("Several agencies exist.")] }, { domain: "common.agency", market: "UK", partial: false, names }).aio, { shown: true, named: false });
  assert.deepEqual(analyseKeywordResult({ items: base }, { domain: "common.agency", market: "UK", partial: false, names }).aio, { shown: false, named: false });
});

test("goto links resolve through one redirect and never fetch the target", async () => {
  assert.equal(isGoto(wrap(1)), true);
  assert.equal(plainTarget("https://www.google.com/url?q=https://a.example/x&sa=U"), "https://a.example/x");
  const calls: string[] = [];
  const ok = (async (u: string) => { calls.push(u); return new Response(null, { status: 302, headers: { location: "https://craftcms.com/partners/common" } }); }) as unknown as typeof fetch;
  assert.equal(await resolveGoto(wrap(1), ok), "https://craftcms.com/partners/common");
  assert.equal(calls[0]!.startsWith("https://www.google.com/goto?"), true);
  const toGoogle = (async () => new Response(null, { status: 302, headers: { location: "https://www.google.com/sorry" } })) as unknown as typeof fetch;
  assert.equal(await resolveGoto(wrap(2), toGoogle), null);
  const ok200 = (async () => new Response("x", { status: 200 })) as unknown as typeof fetch;
  assert.equal(await resolveGoto(wrap(3), ok200), null);
  const lim = limitedResolver(1, ok, 0);
  assert.equal(await lim(wrap(1)), "https://craftcms.com/partners/common");
  assert.equal(await lim(wrap(1)), "https://craftcms.com/partners/common", "asked once, remembered");
  assert.equal(await lim(wrap(9)), null, "past the ceiling it stays unknown");
});

import { foreignCount, serpFault } from "./engines.ts";
test("a UK page of Swiss and Australian sites is the wrong page, never 'not in the top 100' (Common, 27 Nov 2026)", () => {
  const hit = (rank: number, domain: string) => ({ rank, domain, url: null as string | null });
  const york = [hit(1, "sidora.ch"), hit(2, "klarplan.ch"), hit(3, "sortlist.co.uk"), hit(4, "preview.coysh.digital"), hit(5, "fraserclark.com"), hit(6, "medium.com"), hit(7, "thedigitalembassy.com.au"), hit(8, "firmbase.co"), hit(9, "agencies.co"), hit(10, "a.example.com"), hit(11, "b.example.com")];
  assert.equal(foreignCount(york, "UK"), 3, ".ch, .ch and .au count; .co does not");
  assert.equal(serpFault(york, "UK"), "foreign");
  const fine = [hit(1, "craftcms.com"), hit(2, "clutch.co"), hit(3, "firmbase.co"), hit(4, "thedigitalembassy.com.au"), ...Array.from({ length: 8 }, (_, i) => hit(5 + i, `s${i}.co.uk`))];
  assert.equal(serpFault(fine, "UK"), null, "one .com.au among UK results is an ordinary SERP");
});

test("the resolver stops asking after two answers that were not a redirect (a throttle is respected, not worked around)", async () => {
  let calls = 0;
  const throttled = (async () => { calls += 1; return new Response("checking", { status: 200 }); }) as unknown as typeof fetch;
  const r = limitedResolver(10, throttled, 0);
  for (const n of [1, 2, 3, 4]) assert.equal(await r(`https://google.com/goto?url=CAES${n}`), null);
  assert.equal(calls, 2);
});
