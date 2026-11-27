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
  const lim = limitedResolver(1, ok);
  assert.equal(await lim(wrap(1)), "https://craftcms.com/partners/common");
  assert.equal(await lim(wrap(1)), "https://craftcms.com/partners/common", "asked once, remembered");
  assert.equal(await lim(wrap(9)), null, "past the ceiling it stays unknown");
});
