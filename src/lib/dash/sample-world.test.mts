import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SAMPLE_CLIENT_ID, SAMPLE_DEMO_TOKEN, SAMPLE_SLUG, demoLink, demoSlug, isSampleClient } from "./host.ts";
import { buildWorkspace } from "./model.ts";
// plan.ts reads pricing through the @/ alias, which node --test cannot resolve; the shape dash.test.mts uses.
const PLAN = { promptsPerCluster: 5, keywordsPerCluster: 1 };
import { SAMPLE_BRAND, SAMPLE_DAYS, SAMPLE_DOMAIN, sampleAnswerText, sampleRaw } from "./sample-world.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const TODAY = "2026-10-29";

test("the sample link opens the sample slug and nothing else, with no env set", () => {
  assert.deepEqual(demoLink(SAMPLE_DEMO_TOKEN, {}), { slug: SAMPLE_SLUG, state: null });
  assert.equal(demoSlug(SAMPLE_DEMO_TOKEN, { DASH_DEMO_LINKS: `${SAMPLE_DEMO_TOKEN}:acme-com` }), SAMPLE_SLUG, "a configured pair cannot point the sample token at a real client");
  assert.ok(isSampleClient(SAMPLE_CLIENT_ID));
  assert.equal(isSampleClient("00000000-0000-4000-8000-000000000000"), false);
});

test("the sample slug is answered before the database is asked about it", () => {
  const access = readFileSync(join(ROOT, "src/lib/dash/access.ts"), "utf8");
  const body = access.slice(access.indexOf("export const demoRaw"));
  assert.ok(body.indexOf("SAMPLE_SLUG") < body.indexOf("supabaseAdmin()"), "demoRaw returns the generated rows first");
  const history = readFileSync(join(ROOT, "src/lib/dash/history.ts"), "utf8");
  assert.equal((history.match(/if \(isSampleClient\(clientId\)\)/g) ?? []).length, 4, "every click-through read takes the sample");
});

test("the sample is the same for the same day, and moves on by one day", () => {
  const a = sampleRaw(TODAY);
  const again = sampleRaw(TODAY);
  assert.deepEqual(again.answers.slice(0, 50), a.answers.slice(0, 50));
  const next = sampleRaw("2026-10-30");
  assert.equal(next.runs.length, a.runs.length);
  assert.equal(next.runs.at(-1)?.run_date, "2026-10-30");
  assert.equal(a.runs.length, SAMPLE_DAYS + 1);
});

test("the sample reads as months of work: the named rate and positions improve, placements go live over time", () => {
  const raw = sampleRaw(TODAY);
  const rate = (days: string[]) => {
    const rows = raw.answers.filter((x) => days.includes(x.run_date) && x.answered && x.question_id.startsWith("sample-boutique-"));
    return rows.filter((x) => x.named).length / rows.length;
  };
  const dates = [...new Set(raw.answers.map((x) => x.run_date))].sort();
  assert.ok(rate(dates.slice(0, 14)) < 0.2, `first fortnight ${rate(dates.slice(0, 14))}`);
  assert.ok(rate(dates.slice(-14)) > 0.35, `last fortnight ${rate(dates.slice(-14))}`);
  const head = raw.serp.filter((s) => s.keyword_id === "sample-boutique-k0");
  assert.ok((head[0]!.position ?? 101) > 20 && (head.at(-1)!.position ?? 101) < 12);
  const live = raw.placements.filter((p) => p.status === "live");
  assert.ok(live.length >= 8 && raw.placements.some((p) => p.status !== "live"), "some live, some still coming");
  assert.ok(raw.placements.every((p) => p.sample === true), "every placement is marked sample");

  const ws = buildWorkspace(raw, { plan: PLAN });
  assert.equal(ws.clusters.length, 3);
  assert.equal(ws.engines.length, 5);
  assert.ok(ws.brands.some((b) => b.you && b.name === SAMPLE_BRAND), "the brand is on its own leaderboard as itself");
  assert.ok(ws.sources.some((s) => s.you), "its own site is cited");
  const boutique = ws.clusters.find((c) => c.id === "sample-boutique")!;
  assert.ok((boutique.startRate ?? 1) < (boutique.rate ?? 0), "since we started, the rate went up");
});

test("nothing in the sample names a real hotel, and its own domain does not resolve to anything we claim", () => {
  const src = readFileSync(join(ROOT, "src/lib/dash/sample-world.ts"), "utf8");
  for (const real of ["Sandals", "Couples", "Round Hill", "GoldenEye", "Jamaica Inn", "Rockhouse", "Half Moon", "Beaches"]) {
    assert.ok(!src.includes(real), `the sample names ${real}, a real resort`);
  }
  assert.equal(SAMPLE_DOMAIN, "bluemahoeretreats.com");
  assert.match(sampleAnswerText("a stay", ["A", SAMPLE_BRAND]), /2\. Blue Mahoe Retreats/);
});
