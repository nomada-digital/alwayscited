import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The bound on the daily position retry (3 Nov 2026). `cluster-rank.ts` is
 * server-only, so its source is read rather than imported: the spend census
 * (spend-gates.test.mts, cron/reap-stalled-scans) points here for the cap.
 */
const src = readFileSync(new URL("./cluster-rank.ts", import.meta.url), "utf8");

test("the retry pass is capped in reads and in age, and the query uses both", () => {
  const per = Number(src.match(/export const RETRIES_PER_PASS = (\d+);/)?.[1]);
  const days = Number(src.match(/export const RETRY_DAYS = (\d+);/)?.[1]);
  assert.ok(per > 0 && per <= 50, `RETRIES_PER_PASS is ${per}`);
  assert.ok(days > 0 && days <= 30, `RETRY_DAYS is ${days}`);
  assert.match(src, /\.limit\(RETRIES_PER_PASS\)/);
  assert.match(src, /\.gte\("created_at", since\)/);
  assert.match(src, /\.eq\("cluster_keyword_rank_unchecked", true\)/);
});

test("an unmeasured read is stored unchecked, never as a plain null rank", () => {
  assert.match(src, /if \(read\.rank === undefined\) return \{ rank: null, unchecked: true/);
  assert.match(src, /return \{ rank: null, unchecked: true, cost:/);
});
