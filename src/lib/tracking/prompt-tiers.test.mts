import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PROMPT_TIER_LABEL, WIN_ENGINES, WIN_READINGS, WIN_SHARE, isGrowthTier, promptTierOf } from "./prompt-tiers.ts";

const SQL = readFileSync(new URL("../../../supabase/migrations/20261118000000_prompt_tiers.sql", import.meta.url), "utf8");

test("the win rule's numbers are the ones prompt_broaden() uses", () => {
  const rule = SQL.match(/'rule', jsonb_build_object\('share', ([\d.]+), 'engines', (\d+), 'readings', (\d+)\)/);
  assert.ok(rule, "prompt_broaden() reports its rule");
  assert.deepEqual([Number(rule[1]), Number(rule[2]), Number(rule[3])], [WIN_SHARE, WIN_ENGINES, WIN_READINGS]);
  // the reported rule is the rule applied: half the answers, two engines, the last two readings
  assert.match(SQL, /named \* 2 >= n and engines_won >= 2/);
  assert.match(SQL, /where rn <= 2/);
  assert.match(SQL, /rt\.readings = 2 and rt\.all_won/);
});

test("four tiers, existing prompts are tier 1", () => {
  assert.deepEqual(Object.keys(PROMPT_TIER_LABEL), ["1", "2", "3", "4"]);
  assert.match(SQL, /prompt_tier smallint not null default 1/);
  assert.match(SQL, /check \(prompt_tier between 1 and 4\)/);
});

test("tier parsing and growth tiers", () => {
  assert.equal(promptTierOf("3"), 3);
  assert.equal(promptTierOf(5), null);
  assert.equal(promptTierOf(null), null);
  assert.equal(isGrowthTier(1), false);
  assert.equal(isGrowthTier(null), false);
  assert.equal(isGrowthTier(2), true);
  assert.equal(isGrowthTier(4), true);
});
