/**
 * The basis lines for prompts added from placements (13 Oct 2026 review;
 * spec 10 section 6.7, "Honesty"). Illustrative: every prompt shown is made up.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { includesLine, leftOutLine, placementBasis, placementBasisLine } from "./basis.ts";
import { originMap } from "./origins.ts";

const origins = originMap([
  { id: "a1", source: "client" },
  { id: "a2", source: "scan" },
  { id: "pl1", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement" },
  { id: "pl2", source: "nomada", origin_kind: "placement", origin_ref: "p2", allowance: "placement" },
]);
const t = (id: string, num: number, den: number) => ({ id, now: { num, den } });

test("a card with placement prompts read in its range says so, with its figure over the chosen prompts alone", () => {
  const b = placementBasis([t("a1", 4, 20), t("a2", 2, 20), t("pl1", 15, 20), t("pl2", 0, 0)], origins);
  assert.deepEqual(b, { count: 1, chosen: { num: 6, den: 40, pct: 15 } }, "pl2 has no answer yet, so the figure does not count it");
  assert.equal(placementBasisLine(b!), "Includes 1 prompt added from placements. Without them, 6 of 40 answers named you (15%).");
  assert.equal(includesLine(3), "Includes 3 prompts added from placements.");
});

test("no basis line where no prompt added from a placement is in the figure", () => {
  assert.equal(placementBasis([t("a1", 4, 20), t("a2", 2, 20)], origins), null);
  assert.equal(placementBasis([t("a1", 4, 20), t("pl1", 0, 0)], origins), null, "a placement prompt not yet read");
  assert.equal(placementBasis([t("pl1", 4, 20)], new Map()), null, "origins not read: nothing to say, nothing claimed");
});

test("a cluster with only placement prompts read says there is nothing to compare without them", () => {
  const b = placementBasis([t("a1", 0, 0), t("pl1", 3, 10)], origins);
  assert.equal(placementBasisLine(b!), "Includes 1 prompt added from placements. Without them there are no answers in this range.");
});

test("the Placements line says what its named figures leave out and what its citation counts keep", () => {
  assert.equal(leftOutLine(3, 8), "“Answers naming you” and the named spans leave out the 3 prompts added from placements. The citation counts read answers to all 8 prompts.");
  assert.match(leftOutLine(1, 6), /the 1 prompt added from placements/);
});

test("no line says a placement moved a figure (causal-copy), names Nomada, or calls a prompt a question", () => {
  for (const line of [placementBasisLine({ count: 2, chosen: { num: 1, den: 3, pct: 33 } }), includesLine(2), leftOutLine(2, 7)]) {
    assert.doesNotMatch(line, /caused|drove|because of|thanks to|resulted in|delivered|nomada|question/i, line);
  }
});

test("the pages that draw these figures draw the line: Clusters, one cluster and Placements", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(src("../../../components/app/Clusters.tsx"), /placementBasis\(card\.prompts, origins\)/);
  assert.match(src("../../../components/app/OneCluster.tsx"), /placementBasis\(c\.prompts, origins\)/);
  assert.match(src("../../../components/app/Placements.tsx"), /leftOutLine\(placementPrompts, prompts \+ placementPrompts\)/);
  // The Placements named figures are drawn from the cluster's prompts less the placement ones; its citations from all.
  const screen = src("../../tracking/placements-screen.ts");
  assert.match(screen, /const named = data\.questions\.filter\(\(q\) => !isPlacementPrompt\(byId, q\.id\)\);/);
  assert.match(screen, /clusterChart\(\{ clusters, questions: named,/);
  assert.match(screen, /placementFirstCited\(rows, cluster\.id, citeRows\(data\.answers\), questionIds, engines\)/);
});
