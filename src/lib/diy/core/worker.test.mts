import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DiyClient } from "./client.ts";
import { ctxRuntime } from "./ctx.ts";
import { fakeDiyDb, testClient } from "./fake-diy.mts";
import { type JobContext, type JobHandler, MAX_ATTEMPTS, STALE_CLAIM_MS } from "./jobs.ts";
import { claimNextJob, expireAbandoned, runDiyWorker } from "./worker.ts";

/**
 * The DIY night worker on the fake database (13 Oct 2026, DIY P1; spec 10
 * section 5.7): the compare-and-swap claim, the stale reclaim after 15
 * minutes, the order jobs are taken in, and every way a row is closed.
 */

const NOW = Date.parse("2026-10-14T03:31:00Z");
const TODAY = "2026-10-14";
type Row = Record<string, unknown>;

function job(over: Row = {}): Row {
  return { id: `j-${Math.random().toString(36).slice(2)}`, client_domain_id: "c-tallyroo", kind: "plan_refresh", due_on: TODAY, priority: 5, payload: { onboarding: false }, claimed_at: null, done_at: null, attempts: 0, outcome: null, note: null, created_at: "2026-10-14T03:30:00Z", ...over };
}

function handler(over: Partial<JobHandler> & { kind: string }, run?: (ctx: JobContext) => Promise<{ outcome: "ok" | "skipped" | "deferred" | "failed"; note?: string }>): JobHandler {
  return { paid: false, cadence: "daily", priority: 5, onboarding: false, run: run ?? (async () => ({ outcome: "ok" })), ...over };
}

const clients = (over: Partial<DiyClient> = {}) => async () => testClient(over);

test("a claim is a compare-and-swap: a claimed job is not taken again while its claim is fresh", async () => {
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1" })] });
  const first = await claimNextJob(fake.db, TODAY, NOW);
  assert.equal(first?.id, "j1");
  assert.equal(first?.attempts, 1);
  assert.equal(fake.tables.diy_jobs![0]!.claimed_at, new Date(NOW).toISOString());
  assert.equal(await claimNextJob(fake.db, TODAY, NOW + 60_000), null, "a second worker finds nothing to take");
  assert.equal(await claimNextJob(fake.db, TODAY, NOW + STALE_CLAIM_MS - 1), null, "still fresh at 15 minutes less a millisecond");
});

test("a claim older than 15 minutes is stale and taken again, counting another attempt", async () => {
  const claimed = new Date(NOW - STALE_CLAIM_MS - 1).toISOString();
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1", claimed_at: claimed, attempts: 1 })] });
  const again = await claimNextJob(fake.db, TODAY, NOW);
  assert.equal(again?.id, "j1");
  assert.equal(fake.tables.diy_jobs![0]!.attempts, 2);
  const spent = fakeDiyDb({ diy_jobs: [job({ claimed_at: claimed, attempts: MAX_ATTEMPTS })] });
  assert.equal(await claimNextJob(spent.db, TODAY, NOW), null, "after three attempts it waits for its next due date");
});

test("a worker that loses the race takes nothing: the update matches only the row as it was read", async () => {
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1" })] });
  // Another worker claims j1 between this worker's read and its update.
  const racing = {
    from(table: string) {
      const b = fake.db.from(table) as unknown as { select: (c: string) => unknown; then: (r: (v: unknown) => unknown, j?: unknown) => unknown };
      let isSelect = false;
      const select = b.select;
      (b as Record<string, unknown>).select = (c: string) => ((isSelect = true), select(c));
      const then = b.then;
      (b as Record<string, unknown>).then = (resolve: (v: unknown) => unknown, reject?: unknown) =>
        then((v: unknown) => {
          const row = fake.tables.diy_jobs![0]!;
          if (isSelect && row.claimed_at === null) Object.assign(row, { claimed_at: new Date(NOW).toISOString(), attempts: 1 });
          return resolve(v);
        }, reject);
      return b;
    },
  } as unknown as SupabaseClient;
  assert.equal(await claimNextJob(racing, TODAY, NOW), null);
  assert.equal(fake.tables.diy_jobs![0]!.attempts, 1, "the other worker's claim stands; nothing counted twice");
});

test("jobs are taken oldest due first, then by priority", async () => {
  const fake = fakeDiyDb({
    diy_jobs: [job({ id: "today-late", priority: 9 }), job({ id: "today-first", priority: 1 }), job({ id: "carried", due_on: "2026-10-13", priority: 9 }), job({ id: "tomorrow", due_on: "2026-10-15", priority: 0 })],
  });
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    const got = await claimNextJob(fake.db, TODAY, NOW);
    if (got) order.push(got.id);
  }
  assert.deepEqual(order, ["carried", "today-first", "today-late"], "a row due tomorrow is not taken today");
});

test("the worker runs each due job and closes its own row with the outcome and note", async () => {
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1" })] });
  const seen: JobContext[] = [];
  const out = await runDiyWorker({
    db: fake.db,
    handlers: [handler({ kind: "plan_refresh" }, async (ctx) => (seen.push(ctx), { outcome: "ok", note: "3 suggestions" }))],
    now: () => NOW,
    loadClient: clients(),
  });
  assert.equal(out.claimed, 1);
  assert.equal(out.stopped, "empty");
  const row = fake.tables.diy_jobs![0]!;
  assert.equal(row.outcome, "ok");
  assert.equal(row.note, "3 suggestions");
  assert.equal(row.done_at, new Date(NOW).toISOString());
  assert.equal(seen[0]!.today, TODAY);
  assert.equal(seen[0]!.read, undefined, "a free kind gets no ReadCtx");
  assert.equal(seen[0]!.deadlineMs, NOW + 270_000);
});

test("a paid kind gets a ReadCtx minted by the worker, an onboarding one marked so", async () => {
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1", kind: "footprint", payload: { onboarding: true } })] });
  let ctx: JobContext | null = null;
  await runDiyWorker({ db: fake.db, handlers: [handler({ kind: "footprint", paid: true, onboarding: true }, async (c) => ((ctx = c), { outcome: "ok" }))], now: () => NOW, loadClient: clients() });
  const got = ctx as unknown as JobContext;
  assert.ok(got.read);
  assert.equal(got.read!.trigger, "onboarding");
  assert.equal(got.read!.action, null);
  assert.equal(got.onboarding, true);
  assert.ok(ctxRuntime(got.read!), "minted, so the doors accept it");
  assert.equal(ctxRuntime(got.read!)!.reads.size, 4, "the worker's pool of four reads");
});

test("a handler that throws fails its job with the message, never swallowed, and retries until the third attempt", async () => {
  const boom = handler({ kind: "plan_refresh" }, async () => {
    throw new Error("could not read tracking_serp: timeout");
  });
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1" })] });
  const out = await runDiyWorker({ db: fake.db, handlers: [boom], now: () => NOW, loadClient: clients() });
  assert.equal(out.outcomes.failed, 1);
  const row = fake.tables.diy_jobs![0]!;
  assert.equal(row.outcome, "failed");
  assert.equal(row.note, "could not read tracking_serp: timeout");
  assert.equal(row.done_at, null, "open, so a later pass retries it");
  const last = fakeDiyDb({ diy_jobs: [job({ id: "j1", attempts: MAX_ATTEMPTS - 1, claimed_at: new Date(NOW - STALE_CLAIM_MS - 1).toISOString() })] });
  await runDiyWorker({ db: last.db, handlers: [boom], now: () => NOW, loadClient: clients() });
  assert.ok(last.tables.diy_jobs![0]!.done_at, "closed after its third attempt");
});

test("a job deferred by a daily cap is closed and queued again for tomorrow, carrying onboarding", async () => {
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1", kind: "footprint", payload: { onboarding: true } })] });
  await runDiyWorker({ db: fake.db, handlers: [handler({ kind: "footprint", paid: true }, async () => ({ outcome: "deferred", note: "global_daily" }))], now: () => NOW, loadClient: clients() });
  const rows = fake.tables.diy_jobs!;
  const j1 = rows.find((r) => r.id === "j1")!;
  assert.equal(j1.outcome, "deferred");
  assert.ok(j1.done_at);
  const tomorrow = rows.find((r) => r.due_on === "2026-10-15");
  assert.ok(tomorrow, "queued for tomorrow");
  assert.deepEqual(tomorrow!.payload, { onboarding: true });
  assert.equal(tomorrow!.kind, "footprint");
});

test("an unknown kind, a gone client and an ended client each close their row with the reason", async () => {
  const fake = fakeDiyDb({
    diy_jobs: [job({ id: "a", kind: "nobody_runs_this" }), job({ id: "b", client_domain_id: "c-gone" }), job({ id: "c", client_domain_id: "c-ended" })],
  });
  await runDiyWorker({
    db: fake.db,
    handlers: [handler({ kind: "plan_refresh" })],
    now: () => NOW,
    loadClient: async (_db, id) => (id === "c-gone" ? null : testClient({ id, status: id === "c-ended" ? "ended" : "active" })),
  });
  const by = Object.fromEntries(fake.tables.diy_jobs!.map((r) => [r.id, r]));
  assert.equal(by.a!.outcome, "failed");
  assert.match(String(by.a!.note), /no handler is registered for nobody_runs_this/);
  assert.equal(by.b!.outcome, "skipped");
  assert.equal(by.c!.outcome, "skipped");
  assert.match(String(by.c!.note), /ended/);
});

test("13 Oct 2026: rows no worker can take never hide one it can - the candidates are chosen claimable in SQL", async () => {
  const stale = new Date(NOW - STALE_CLAIM_MS - 60_000).toISOString();
  const fresh = new Date(NOW - 60_000).toISOString();
  const stuck = Array.from({ length: 100 }, (_, i) => job({ id: `dead-${i}`, due_on: "2026-10-01", attempts: MAX_ATTEMPTS, claimed_at: stale }));
  const failing = Array.from({ length: 100 }, (_, i) => job({ id: `retry-${i}`, due_on: "2026-10-02", attempts: 1, claimed_at: fresh, outcome: "failed" }));
  const fake = fakeDiyDb({ diy_jobs: [...stuck, ...failing, job({ id: "live" })] });
  const out = await runDiyWorker({ db: fake.db, handlers: [handler({ kind: "plan_refresh" })], now: () => NOW, loadClient: clients() });
  assert.equal(out.claimed, 1, "the one claimable job behind 200 that are not");
  assert.equal(fake.tables.diy_jobs!.find((r) => r.id === "live")!.outcome, "ok");
});

test("13 Oct 2026: a row whose third attempt never closed is closed as abandoned, keeping its last note; nothing else is touched", async () => {
  const stale = new Date(NOW - STALE_CLAIM_MS - 60_000).toISOString();
  const fake = fakeDiyDb({
    diy_jobs: [
      job({ id: "dead", attempts: MAX_ATTEMPTS, claimed_at: stale, outcome: "failed", note: "timeout" }),
      job({ id: "running", attempts: MAX_ATTEMPTS, claimed_at: new Date(NOW - 60_000).toISOString() }),
      job({ id: "retrying", attempts: 1, claimed_at: stale }),
      job({ id: "closed", attempts: MAX_ATTEMPTS, claimed_at: stale, done_at: "2026-10-13T03:40:00Z", outcome: "failed" }),
    ],
  });
  assert.equal(await expireAbandoned(fake.db, NOW), 1);
  const by = Object.fromEntries(fake.tables.diy_jobs!.map((r) => [r.id, r]));
  assert.equal(by.dead!.done_at, new Date(NOW).toISOString());
  assert.equal(by.dead!.outcome, "failed");
  assert.match(String(by.dead!.note), /^abandoned: attempt 3 never closed .*; last note: timeout$/);
  assert.equal(by.running!.done_at, null, "its third attempt may still be running");
  assert.equal(by.retrying!.done_at, null, "a later pass takes it again");
  assert.equal(by.closed!.done_at, "2026-10-13T03:40:00Z");
});

test("the worker stops claiming when its budget is nearly spent", async () => {
  const fake = fakeDiyDb({ diy_jobs: [job({ id: "j1" }), job({ id: "j2" })] });
  let t = NOW;
  const out = await runDiyWorker({
    db: fake.db,
    handlers: [handler({ kind: "plan_refresh" }, async () => ((t += 260_000), { outcome: "ok" }))],
    now: () => t,
    loadClient: clients(),
  });
  assert.equal(out.claimed, 1);
  assert.equal(out.stopped, "budget");
  assert.equal(fake.tables.diy_jobs!.filter((r) => r.done_at).length, 1, "the second waits for the next pass");
});

test("a table the worker cannot read stops it with the error", async () => {
  const fake = fakeDiyDb({ diy_jobs: [job()] }, { failSelect: (t) => t === "diy_jobs" });
  const out = await runDiyWorker({ db: fake.db, handlers: [handler({ kind: "plan_refresh" })], now: () => NOW, loadClient: clients() });
  assert.equal(out.stopped, "error");
  assert.match(out.errors[0]!, /could not read the due DIY jobs/);
});
