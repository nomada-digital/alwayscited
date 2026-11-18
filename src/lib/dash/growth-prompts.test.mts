import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkspace } from "./model.ts";
import { sampleRaw } from "./sample-world.ts";

// plan.ts reads pricing through the @/ alias, which node --test cannot resolve; the shape dash.test.mts uses.
const PLAN = { promptsPerCluster: 5, keywordsPerCluster: 1 };
const TODAY = "2026-11-18";

/**
 * Growth prompts (18 Nov 2026, playbook rule 5): tiers 2 to 4 start low, so the headline and every cluster's rate are
 * the core (tier 1) prompts' and the growth prompts are reported apart - month 2 reads as expansion, not a drop.
 */
test("growth prompts are reported apart and kept out of the headline", () => {
  const raw = sampleRaw(TODAY);
  const ws = buildWorkspace(raw, { plan: PLAN });
  const growth = raw.prompts.filter((p) => (p.prompt_tier ?? 1) > 1).map((p) => p.id).sort();
  assert.equal(growth.length, 3, "the sample carries three growth prompts");
  assert.deepEqual(ws.growth.prompts.map((p) => p.id).sort(), growth);
  assert.ok(ws.growth.prompts.every((p) => p.tier > 1));

  // the headline, recomputed by hand over the tier 1 prompts on the latest reading
  const latest = ws.lastRun!.run_date;
  const core = new Set(raw.prompts.filter((p) => (p.prompt_tier ?? 1) === 1).map((p) => p.id));
  const on = raw.answers.filter((a) => a.run_date === latest && core.has(a.question_id) && a.answered);
  assert.equal(ws.rate, on.filter((a) => a.named).length / on.length);
  const all = raw.answers.filter((a) => a.run_date === latest && a.answered);
  assert.notEqual(ws.rate, all.filter((a) => a.named).length / all.length, "with the growth prompts in, the headline would differ");
  assert.ok(ws.growth.rate !== null && ws.growth.rate < ws.rate!, "growth prompts start below the core");

  // still listed in their cluster, so the customer can edit them, but out of its rate
  const boutique = ws.clusters.find((c) => c.name.startsWith("Boutique"))!;
  const listed = [...boutique.groups, boutique.own].flatMap((g) => g.prompts);
  assert.equal(listed.filter((p) => p.tier > 1).length, 3);
  const cOn = raw.answers.filter((a) => a.run_date === latest && a.answered && listed.some((p) => p.id === a.question_id && p.tier === 1));
  assert.equal(boutique.rate, cOn.filter((a) => a.named).length / cOn.length);
});

test("a workspace with no growth prompts has an empty growth group", () => {
  const raw = sampleRaw(TODAY);
  const flat = { ...raw, prompts: raw.prompts.map((p) => ({ ...p, prompt_tier: 1 })) };
  const ws = buildWorkspace(flat, { plan: PLAN });
  assert.deepEqual(ws.growth.prompts, []);
  assert.equal(ws.growth.rate, null);
});
