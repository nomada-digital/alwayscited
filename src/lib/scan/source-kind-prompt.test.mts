import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { sourceKindRequest, sourceKindSystem, trimUrl } from "./source-kind-prompt.ts";

/**
 * N9, 25 September 2026: category vendors cited for their own blog posts were
 * on the placement list. These hold the two halves of the fix - the rule in
 * the prompt, and the leaderboard actually reaching it.
 */

test("the prompt says a seller in the category is a competitor even when the page is a listicle", () => {
  // 8 Nov 2026 (prompt caching): the topic moved to the request's context block, so the prompt is the same for every
  // scan and caches; the request test below holds the category, and this one that the prompt carries none.
  const sys = sourceKindSystem();
  assert.match(sys, /the category named in the request/);
  assert.doesNotMatch(sys, /virtual receptionist/);
  assert.match(sys, /sells a product or service in this category is a competitor/);
  assert.match(sys, /EVEN WHEN the cited page is a blog post, a guide, a listicle or a\s+comparison/);
  assert.match(sys, /Judge\s+what the company sells, not what the page looks like/);
  // A placement is only a site that does not itself sell here.
  assert.match(sys, /placement: an independent publication/);
  assert.match(sys, /does not itself sell in this category/);
  // The old wording made any "blog" a placement on sight.
  assert.doesNotMatch(sys, /trade title, blog,/);
});

test("the request carries the topic and every leaderboard brand", () => {
  const req = sourceKindRequest(
    { topic: "call answering", brand: "Moneypenny", competitors: ["Nextiva", "CloudTalk", "Ruby"] },
    [{ domain: "nextiva.com", pages: [{ url: "https://nextiva.com/blog/best-answering?utm=x", title: "Best answering services" }] }],
  );
  assert.match(req, /^Subject brand: Moneypenny$/m);
  assert.match(req, /^Category: call answering$/m);
  assert.match(req, /Named competitors .*: Nextiva, CloudTalk, Ruby$/m);
  assert.match(req, /^- nextiva\.com$/m);
  assert.match(req, /Best answering services {2}https:\/\/nextiva\.com\/blog\/best-answering$/m);
});

test("an empty leaderboard says so rather than printing nothing", () => {
  const req = sourceKindRequest({ topic: "", brand: "X", competitors: [] }, []);
  assert.match(req, /: none identified$/m);
  assert.match(req, /^Category: not stated$/m);
});

test("trimUrl drops the query and caps the length", () => {
  assert.equal(trimUrl(null), "");
  assert.equal(trimUrl("https://a.com/p?q=1#h"), "https://a.com/p");
  assert.equal(trimUrl("https://a.com/" + "x".repeat(200)).length, 123);
});

/**
 * The rule is only worth anything if the list arrives. classifySources starts
 * before the brand chain has written scan_brands, so the judged suppliers
 * have to be handed to it - read from the source, because a pipeline run
 * needs a database and four engines.
 */
test("the pipeline hands the judged suppliers to the source classification", () => {
  const pipeline = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");
  const sources = readFileSync(new URL("./sources.ts", import.meta.url), "utf8");
  assert.match(pipeline, /classifySources\(scanId, sourceCalls, leaderboard\)/);
  const resolved = pipeline.indexOf("nameLeaderboard([...suppliers]");
  assert.ok(resolved > 0, "the leaderboard promise is never resolved with the suppliers");
  assert.ok(
    resolved < pipeline.indexOf("await timed(timings, \"sources\""),
    "the leaderboard is resolved after the source kinds are awaited - that is a deadlock",
  );
  assert.match(sources, /\.\.\.\(await leaderboard\)/);
});
