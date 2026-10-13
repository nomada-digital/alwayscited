import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { type Task, firstTask, parseRankedKeywords, rankedKeywordsRequest } from "../../scan/dataforseo-request.ts";
import { fakeDiyDb, settingsRows, testClient, testCtx } from "../core/fake-diy.mts";
import type { JobContext, ReadCtx } from "../core/jobs.ts";
import { paidRead } from "../core/ledger.ts";
import { dfsEstimate } from "../core/prices.ts";

import { FOOTPRINT_MIN_DAYS, compactFootprint, pullDecision, readFootprintRows, readPull } from "./footprint.ts";
import { FOOTPRINT_KIND, footprintHandler, refusalOutcome, runFootprint } from "./footprint.job.ts";

/**
 * The footprint (13 Oct 2026, DIY P6; spec 10 sections 5.2, 5.6 and 6.6):
 * the compaction, the strict read back, the Labs date gate, and the job on
 * P1's real ledger over a fake database, reading DataForSEO's documented
 * ranked_keywords sample (src/lib/diy/core/samples, read from DataForSEO's
 * v3 documentation on 13 Oct 2026). Nothing here reaches a vendor.
 */

const sample = (): Task => firstTask(JSON.parse(readFileSync(new URL("../core/samples/ranked_keywords.json", import.meta.url), "utf8")));
const rawSample = () => readFileSync(new URL("../core/samples/ranked_keywords.json", import.meta.url), "utf8");

/** Every key anywhere in a value. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  return out;
}

test("the compacted footprint keeps the named fields and no keyword_difficulty, though the documented sample carries it", () => {
  assert.match(rawSample(), /"keyword_difficulty"/, "the sample must carry the field the parser drops");
  const fp = compactFootprint(parseRankedKeywords(sample()));
  assert.equal(fp.total, 1342);
  assert.ok(fp.rows.length >= 2);
  assert.deepEqual(fp.rows[0], { k: "payroll software for sole traders", p: 7, u: "/payroll", v: 880, i: "commercial", e: 41.2, pr: 14, n: false });
  const keys = [...keysDeep(fp)];
  assert.deepEqual(keys.filter((k) => /difficulty|^kd$|spam|sponsor/i.test(k)), []);
  for (const r of fp.rows) for (const k of Object.keys(r)) assert.ok(["k", "p", "u", "v", "i", "e", "pr", "n"].includes(k), `a stored row kept ${k}`);
  // A missing previous reading is left off the row, and reads back as none.
  const fresh = fp.rows.find((r) => r.n === true)!;
  assert.ok(!("pr" in fresh));
});

test("a stored row is read back strictly: unknown keys, a kd and wrong types are dropped, never coerced into a figure", () => {
  const rows = readFootprintRows([
    { k: "invoicing app", p: 4, u: "/invoicing", v: 1000, i: "commercial", e: 12.5, pr: 9, n: false, kd: 71, keyword_difficulty: 71 },
    { k: "", p: 3 },
    { k: "weird intent", p: "5", u: 7, v: null, i: "shopping", e: "x" },
    "not a row",
  ]);
  assert.deepEqual(rows, [
    { k: "invoicing app", p: 4, u: "/invoicing", v: 1000, i: "commercial", e: 12.5, pr: 9, n: false },
    { k: "weird intent", p: 5, u: null, v: null, i: null, e: null },
  ]);
  assert.equal(readPull({ pulled_on: "not a day", rows: [] }), null);
  assert.deepEqual(readPull({ pulled_on: "2026-10-12", labs_date: null, total_count: "1342", etv: 10, rows: [] }), { pulledOn: "2026-10-12", labsDate: null, total: 1342, etv: 10, rows: [] });
});

test("the Labs date gate: a first pull always; then only when Labs' Google date has moved, and never within a week", () => {
  const today = "2026-10-14";
  assert.equal(pullDecision({ labsDate: null, last: null, today }).pull, true, "no footprint yet: the onboarding read");
  assert.equal(pullDecision({ labsDate: "2026-10-12", last: { pulledOn: "2026-10-09", labsDate: "2026-10-01" }, today }).pull, false, "five days since the last pull");
  assert.equal(pullDecision({ labsDate: "2026-10-12", last: { pulledOn: `2026-10-0${14 - FOOTPRINT_MIN_DAYS}`, labsDate: "2026-10-01" }, today }).pull, true, "a week on, and the date moved");
  const unchanged = pullDecision({ labsDate: "2026-10-01", last: { pulledOn: "2026-10-01", labsDate: "2026-10-01" }, today });
  assert.deepEqual(unchanged, { pull: false, why: "Labs data unchanged since 2026-10-01; nothing pulled" });
  assert.equal(pullDecision({ labsDate: "2026-09-30", last: { pulledOn: "2026-10-01", labsDate: "2026-10-01" }, today }).pull, false, "an older date is not a moved one");
  assert.equal(pullDecision({ labsDate: null, last: { pulledOn: "2026-10-01", labsDate: "2026-10-01" }, today }).pull, false, "an unread date is not a moved one");
  assert.equal(pullDecision({ labsDate: "2026-10-12", last: { pulledOn: "2026-10-01", labsDate: null }, today }).pull, true, "a pull made before any date was read");
});

// ---- the job, on P1's ledger ----

/** A reader shaped as P1's door: the ledger's paidRead around the documented sample. */
const sampleReader = (calls: { n: number }) => (ctx: ReadCtx) => {
  const req = rankedKeywordsRequest({ target: ctx.client.domain, market: "UK" });
  return paidRead(ctx, { door: "labs", endpoint: "ranked_keywords", estimate: dfsEstimate("ranked_keywords", req.rows), params: req.body }, async () => {
    calls.n++;
    const parsed = parseRankedKeywords(sample());
    return { value: parsed, cost: 0.01236, rows: parsed.rows.length, partial: false };
  });
};

function setup(o: { enabled?: boolean; labs?: string | null; last?: { pulled_on: string; labs_date: string | null } | null } = {}) {
  const f = fakeDiyDb({
    app_settings: settingsRows({ diy_enabled: o.enabled ?? true }),
    diy_reads: [],
    diy_vendor_status: o.labs === null ? [] : [{ kind: "labs_status", read_on: "2026-10-14", google_date: o.labs ?? "2026-10-12", payload: {} }],
    keyword_footprints: o.last ? [{ client_domain_id: "c-tallyroo", ...o.last, total_count: 1, etv: 1, rows: [] }] : [],
  });
  const ctx = (): JobContext => ({ db: f.db, client: testClient(), today: "2026-10-14", deadlineMs: f.clock.now + 270_000, onboarding: false, read: testCtx(f.db, f.clock) });
  return { f, ctx };
}

test("the handler: paid, weekly, onboarding, before plan_refresh, and its door loaded only when it runs", () => {
  const h = footprintHandler();
  assert.deepEqual({ kind: h.kind, paid: h.paid, cadence: h.cadence, onboarding: h.onboarding, priority: h.priority }, { kind: FOOTPRINT_KIND, paid: true, cadence: "weekly", onboarding: true, priority: 0 });
  const src = readFileSync(new URL("./footprint.job.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^import[^;]*doors/m, "a static import of doors.ts would pull the server-only vendor module into wiring.ts's tests");
  assert.match(src, /await import\("\.\.\/core\/doors\.ts"\)\)\.readRankedKeywords\(ctx\)/);
});

test("a moved Labs date: one reservation, one read, one footprint row with the named fields and the ledger row's id", async () => {
  const { f, ctx } = setup({ last: { pulled_on: "2026-10-01", labs_date: "2026-10-01" } });
  const calls = { n: 0 };
  const r = await runFootprint(ctx(), sampleReader(calls));
  assert.equal(r.outcome, "ok", r.note);
  assert.equal(calls.n, 1);
  const reads = f.tables.diy_reads!;
  assert.equal(reads.length, 1);
  assert.equal(reads[0]!.status, "ok");
  assert.equal(reads[0]!.estimate, 0.132, "reserved at 1000 rows");
  const stored = f.tables.keyword_footprints!.find((x) => x.pulled_on === "2026-10-14")!;
  assert.equal(stored.labs_date, "2026-10-12");
  assert.equal(stored.read_id, reads[0]!.id);
  assert.deepEqual([...keysDeep(stored.rows)].filter((k) => /difficulty|kd/i.test(k)), []);
  // Run twice (the worker's stale reclaim): the gate says a week has not passed; no second read, no second row.
  const again = await runFootprint(ctx(), sampleReader(calls));
  assert.equal(again.outcome, "skipped");
  assert.equal(calls.n, 1);
  assert.equal(f.tables.diy_reads!.length, 1);
});

test("no pull when the date is unchanged: skipped with its reason, and nothing reserved or spent", async () => {
  const { f, ctx } = setup({ labs: "2026-10-01", last: { pulled_on: "2026-10-01", labs_date: "2026-10-01" } });
  const calls = { n: 0 };
  const r = await runFootprint(ctx(), sampleReader(calls));
  assert.deepEqual(r, { outcome: "skipped", note: "Labs data unchanged since 2026-10-01; nothing pulled" });
  assert.equal(calls.n, 0);
  assert.deepEqual(f.tables.diy_reads, []);
});

test("dark: with diy_enabled off the ledger refuses before the read, and the job skips; nothing is spent or stored", async () => {
  const { f, ctx } = setup({ enabled: false });
  const calls = { n: 0 };
  const r = await runFootprint(ctx(), sampleReader(calls));
  assert.equal(r.outcome, "skipped");
  assert.match(r.note ?? "", /refused \(disabled\)/);
  assert.equal(calls.n, 0);
  assert.ok(f.tables.diy_reads!.every((x) => x.status === "refused"), "a refusal is a refused row, which counts 0");
  assert.deepEqual(f.tables.keyword_footprints, []);
});

test("refusals: a daily cap defers to tomorrow; the switch, the month's budget or an inactive client skips", () => {
  for (const c of ["global_daily", "door_daily", "deadline", "ledger_unreadable", "tracking_running", "model_headroom"] as const) assert.equal(refusalOutcome(c), "deferred", c);
  for (const c of ["disabled", "month_budget", "client_inactive", "fixture", "allowance"] as const) assert.equal(refusalOutcome(c), "skipped", c);
});

test("a failed read is a failed job with its reason; a store that fails says what the read cost; no ctx is a failure, never a silent skip", async () => {
  const { ctx } = setup();
  const failed = await runFootprint(ctx(), async () => ({ kind: "failed", reason: "40501 invalid field", cost: 0, readId: "r1" }));
  assert.deepEqual(failed, { outcome: "failed", note: "ranked_keywords failed: 40501 invalid field" });
  const threw = await runFootprint(ctx(), async () => {
    throw new Error("socket closed");
  });
  assert.equal(threw.outcome, "failed");
  const { f, ctx: ctx2 } = setup();
  f.tables.keyword_footprints = [];
  const store = fakeDiyDb({ ...f.tables }, { failInsert: (t) => t === "keyword_footprints" });
  const lost = await runFootprint({ ...ctx2(), db: store.db }, async () => ({ kind: "read", value: parseRankedKeywords(sample()), cost: 0.01236, partial: false, readId: "r2" }));
  assert.equal(lost.outcome, "failed");
  assert.match(lost.note ?? "", /read \(\$0\.01236\) but not stored/);
  const noCtx = await runFootprint({ ...ctx(), read: undefined }, sampleReader({ n: 0 }));
  assert.equal(noCtx.outcome, "failed");
});
