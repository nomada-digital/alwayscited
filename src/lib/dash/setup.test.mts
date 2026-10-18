import assert from "node:assert/strict";
import { test } from "node:test";

import { rankOfPage, setupClusters, setupGaps, stepOf, topOverlap } from "./setup.ts";

const live = { stopped_on: null };
const rows = (tier: string, target: boolean) => ({
  clusters: [{ id: "c1", name: "B2B SEO agency", tier, keyword_id: "k1", ...live }],
  keywords: [{ id: "k1", keyword: "b2b seo agency", ...live }, { id: "k2", keyword: "b2b seo agencies", pair_of: "k1", ...live }],
  prompts: [{ cluster_id: "c1", ...live }],
  keyPages: target ? [{ url: "https://ledgerline.com/blog/best-seo-agency-for-b2b", origin: "member", cluster_ids: ["c1"], added_on: "2026-10-18", removed_on: null }] : [],
});

test("a worked cluster cannot be confirmed without its target page (brief 2b)", () => {
  for (const tier of ["mentioned", "cited", "everywhere"]) {
    const [c] = setupClusters(rows(tier, false));
    assert.equal(stepOf(c), "target", tier);
    assert.match(setupGaps([c]).join(" "), /choose its target page/, tier);
  }
  const [done] = setupClusters(rows("cited", true));
  assert.equal(done.pair, "b2b seo agencies");
  assert.equal(done.target, "https://ledgerline.com/blog/best-seo-agency-for-b2b");
  assert.deepEqual(setupGaps([done]), []);
});

test("a tracking-only cluster may go without a target page", () => {
  const [c] = setupClusters(rows("tracked", false));
  assert.equal(stepOf(c), "done");
  assert.deepEqual(setupGaps([c]), []);
});

test("a cluster with no keyword or no prompts is named as a gap; no clusters is a gap", () => {
  const r = rows("tracked", false);
  const [c] = setupClusters({ ...r, clusters: [{ ...r.clusters[0], keyword_id: null }], prompts: [] });
  assert.equal(stepOf(c), "keyword");
  assert.equal(setupGaps([c]).length, 2);
  assert.deepEqual(setupGaps([]), ["Add a cluster first."]);
});

test("where a chosen page ranks, and how much two keywords' top 10 overlap", () => {
  const top = [{ rank: 1, url: "https://tallyroo.com/" }, { rank: 4, url: "https://ledgerline.com/blog/x/" }];
  assert.equal(rankOfPage(top, "https://www.ledgerline.com/blog/x"), 4);
  assert.equal(rankOfPage(top, "https://ledgerline.com/"), null);
  const a = Array.from({ length: 10 }, (_, i) => ({ url: `https://s${i}.com/` }));
  const b = [...a.slice(0, 8), { url: "https://x.com/" }, { url: "https://y.com/" }];
  assert.equal(topOverlap(a, b), 0.8);
  assert.equal(topOverlap([], b), null);
});
