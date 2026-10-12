import assert from "node:assert/strict";
import { test } from "node:test";

import { mintReadCtx, pool } from "./ctx.ts";
import { fakeDiyDb, settingsRows, testClient, testCtx } from "./fake-diy.mts";
import type { ReadCtx } from "./jobs.ts";
import { type ModelAnswer, paidModelCall, paidRead, paramsHash, parseDiySpend, utcDayStart } from "./ledger.ts";
import { modelCost } from "./prices.ts";

/**
 * The DIY ledger on the fake database (13 Oct 2026, DIY P1; spec 10 section
 * 5.6 items 2-4): the reservation is written before the read; an unreadable
 * ledger or a failed `diy_spend` refuses and reads nothing; a read settles at
 * what it was billed; a failure keeps its billed cost; a model call settles
 * from its usage, fails on a refusal or a max_tokens stop, and debits
 * `model_call_debits` with every request that went out.
 */

type Rows = Record<string, unknown>[];
const SPEC = { door: "labs" as const, endpoint: "ranked_keywords", estimate: 0.132, params: [{ target: "tallyroo.com" }] };

function world(over: { settings?: Record<string, unknown>; reads?: Rows; failRpc?: boolean; failInsert?: boolean; failSelect?: boolean } = {}) {
  const fake = fakeDiyDb(
    { app_settings: settingsRows(over.settings), diy_reads: [...(over.reads ?? [])], model_call_debits: [] },
    {
      failRpc: over.failRpc,
      failInsert: over.failInsert ? (t) => t === "diy_reads" : undefined,
      failSelect: over.failSelect ? (t) => t === "app_settings" : undefined,
    },
  );
  return fake;
}

const ok = (cost: number, rows = 3) => async () => ({ value: { rows: ["a", "b", "c"] }, cost, rows, partial: false });

test("the reservation is written before the read, and the read settles at what it was billed", async () => {
  const w = world();
  let seenAtSend: Rows = [];
  const ctx = testCtx(w.db, w.clock);
  const out = await paidRead(ctx, SPEC, async () => {
    seenAtSend = (w.tables.diy_reads ?? []).map((r) => ({ ...r }));
    return { value: "read", cost: 0.048, rows: 300, partial: false };
  });
  assert.equal(seenAtSend.length, 1, "one row exists when the read goes out");
  assert.equal(seenAtSend[0]!.status, "reserved");
  assert.equal(seenAtSend[0]!.estimate, 0.132);
  assert.equal(seenAtSend[0]!.params_hash, paramsHash(SPEC.params));
  assert.equal(out.kind, "read");
  const row = w.tables.diy_reads![0]!;
  assert.equal(row.status, "ok");
  assert.equal(row.cost, 0.048, "settled at task.cost, not the estimate");
  assert.equal(row.rows, 300);
  assert.equal(row.trigger, "scheduled");
  assert.equal(row.client_domain_id, "c-tallyroo");
  assert.ok(row.settled_at);
});

test("a failed diy_spend refuses, reads nothing and reserves nothing", async () => {
  const w = world({ failRpc: true });
  let sent = 0;
  const out = await paidRead(testCtx(w.db, w.clock), SPEC, async () => (sent++, { value: 1, cost: 0, rows: 0, partial: false }));
  assert.equal(out.kind, "refused");
  assert.equal(out.kind === "refused" && out.refusal.code, "ledger_unreadable");
  assert.equal(sent, 0);
  assert.equal((w.tables.diy_reads ?? []).length, 0);
});

test("unreadable settings refuse: never read as zero, never as on", async () => {
  const w = world({ failSelect: true });
  let sent = 0;
  const out = await paidRead(testCtx(w.db, w.clock), SPEC, async () => (sent++, { value: 1, cost: 0, rows: 0, partial: false }));
  assert.equal(out.kind === "refused" && out.refusal.code, "ledger_unreadable");
  assert.equal(sent, 0);
});

test("a reservation that cannot be written refuses before the read", async () => {
  const w = world({ failInsert: true });
  let sent = 0;
  const out = await paidRead(testCtx(w.db, w.clock), SPEC, async () => (sent++, { value: 1, cost: 0, rows: 0, partial: false }));
  assert.equal(out.kind === "refused" && out.refusal.code, "ledger_unreadable");
  assert.equal(sent, 0);
});

test("a failed task keeps its billed cost", async () => {
  const w = world();
  const out = await paidRead(testCtx(w.db, w.clock), SPEC, async () => {
    throw Object.assign(new Error("DataForSEO task 40501: Invalid Field"), { taskStatus: 40501, cost: 0.012 });
  });
  assert.equal(out.kind, "failed");
  const row = w.tables.diy_reads![0]!;
  assert.equal(row.status, "failed");
  assert.equal(row.cost, 0.012, "billed, so recorded");
  assert.match(String(row.code), /40501/);
});

test("DataForSEO's 'not now' is retried inside one reservation, on the runner's delays", async () => {
  const w = world();
  const sleeps: number[] = [];
  let attempt = 0;
  const out = await paidRead(testCtx(w.db, w.clock, { sleeps }), SPEC, async () => {
    attempt += 1;
    if (attempt === 1) throw Object.assign(new Error("DataForSEO returned no task (40209 Too many simultaneous queries.)"), { taskStatus: 40209 });
    return { value: "second time", cost: 0.132, rows: 1000, partial: false };
  });
  assert.equal(out.kind, "read");
  assert.deepEqual(sleeps, [1000]);
  assert.equal(w.tables.diy_reads!.length, 1, "one reservation for the retried read");
  assert.equal(w.tables.diy_reads![0]!.cost, 0.132);
});

test("a cap refusal reads nothing and is written as a refused row that counts 0", async () => {
  const today = new Date(Date.parse("2026-10-14T03:31:00Z")).toISOString();
  const w = world({ reads: [{ id: "r0", client_domain_id: "c-other", door: "labs", trigger: "scheduled", status: "ok", estimate: 0.132, cost: 9.95, created_at: today }] });
  let sent = 0;
  const out = await paidRead(testCtx(w.db, w.clock), SPEC, async () => (sent++, { value: 1, cost: 0, rows: 0, partial: false }));
  assert.equal(out.kind === "refused" && out.refusal.code, "global_daily", "9.95 of the $10 cap is spent by another client");
  assert.equal(sent, 0);
  const refused = w.tables.diy_reads!.filter((r) => r.status === "refused");
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.code, "global_daily");
  const spend = parseDiySpend((await w.db.rpc("diy_spend", { p_client: "c-tallyroo", p_day_start: utcDayStart(w.clock.now), p_month_start: "2026-09-30T23:00:00.000Z" })).data);
  assert.equal(spend.globalDfsToday, 9.95, "the refused row adds nothing");
});

test("the kill switch refuses, and a missing switch is off", async () => {
  const w = world({ settings: { diy_enabled: undefined } });
  const out = await paidRead(testCtx(w.db, w.clock), SPEC, ok(0.1));
  assert.equal(out.kind === "refused" && out.refusal.code, "disabled");
});

test("a ctx not minted by the worker or runOnDemand cannot read", async () => {
  const w = world();
  const forged = Object.freeze({ client: testClient(), trigger: "scheduled", action: null, deadlineMs: w.clock.now + 60_000 }) as unknown as ReadCtx;
  await assert.rejects(() => paidRead(forged, SPEC, ok(0.1)), /minted/);
  assert.equal((w.tables.diy_reads ?? []).length, 0);
});

test("the fixture never reaches a vendor, and a read with no time left is not started", async () => {
  const w = world();
  const fixture = await paidRead(testCtx(w.db, w.clock, { fixture: true }), SPEC, ok(0.1));
  assert.equal(fixture.kind === "refused" && fixture.refusal.code, "fixture");
  const late = await paidRead(testCtx(w.db, w.clock, { deadlineMs: w.clock.now + 1_000 }), SPEC, ok(0.1));
  assert.equal(late.kind === "refused" && late.refusal.code, "deadline");
  assert.equal((w.tables.diy_reads ?? []).length, 0);
});

test("a worker never has more reads in flight than its pool", async () => {
  const w = world();
  const shared = pool(4);
  let inFlight = 0;
  let most = 0;
  const ctx = mintReadCtx(
    { client: testClient(), trigger: "scheduled", action: null, deadlineMs: w.clock.now + 270_000 },
    { db: w.db, now: () => w.clock.now, sleep: async () => {}, reads: shared, models: pool(1), fixture: false },
  );
  await Promise.all(
    Array.from({ length: 10 }, () =>
      paidRead(ctx, { ...SPEC, door: "onpage", endpoint: "content_parsing", estimate: 0.00015 }, async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        return { value: 1, cost: 0.00015, rows: 1, partial: false };
      }),
    ),
  );
  assert.equal(most, 4);
});

// ------------------------------------------------------------ the model door

const MODEL_SPEC = { door: "model" as const, endpoint: "diy_classify", estimate: 0.35, params: { items: 50 }, reason: "diy_classify" };
const HEADROOM = { last24h: 10, perDay: 2500 };
const usage = { input_tokens: 7200, output_tokens: 3000 };

function answer<T>(over: Partial<ModelAnswer<T>>): ModelAnswer<T> {
  return { stop_reason: "end_turn", usage, parsed_output: null, ...over };
}

test("a model call settles from its usage and debits model_call_debits with billed.calls", async () => {
  const w = world();
  const out = await paidModelCall(testCtx(w.db, w.clock), MODEL_SPEC, HEADROOM, async (billed) => {
    billed.calls += 2; // countingFetch counts below the SDK: one retry inside the call.
    return answer({ parsed_output: { items: [] } });
  });
  assert.equal(out.kind, "read");
  const row = w.tables.diy_reads![0]!;
  assert.equal(row.status, "ok");
  assert.equal(row.door, "model");
  assert.equal(row.cost, modelCost(usage));
  assert.equal(row.cost, 0.0888, "7.2k in at $4/M plus 3k out at $20/M");
  assert.equal(row.tokens_in, 7200);
  assert.equal(row.tokens_out, 3000);
  assert.deepEqual(
    w.tables.model_call_debits!.map((d) => [d.calls, d.reason, d.domain]),
    [[2, "diy_classify", "tallyroo.com"]],
  );
});

test("a max_tokens stop is a failure, and nothing is read from its body", async () => {
  const w = world();
  const out = await paidModelCall(testCtx(w.db, w.clock), MODEL_SPEC, HEADROOM, async (billed) => {
    billed.calls += 1;
    return answer({ stop_reason: "max_tokens", usage: { input_tokens: 7200, output_tokens: 16000 }, parsed_output: { items: ["half"] } });
  });
  assert.equal(out.kind, "failed");
  assert.equal(out.kind === "failed" && out.reason, "max_tokens");
  assert.equal(w.tables.diy_reads![0]!.status, "failed");
  assert.equal(w.tables.diy_reads![0]!.cost, modelCost({ input_tokens: 7200, output_tokens: 16000 }), "billed for what it used");
  assert.equal(w.tables.model_call_debits!.length, 1);
});

test("a refusal stop is a failure", async () => {
  const w = world();
  const out = await paidModelCall(testCtx(w.db, w.clock), MODEL_SPEC, HEADROOM, async (billed) => {
    billed.calls += 1;
    return answer({ stop_reason: "refusal", parsed_output: null });
  });
  assert.equal(out.kind === "failed" && out.reason, "refusal");
});

test("a call that throws after its request went out keeps its estimate as its cost, and is still debited", async () => {
  const w = world();
  const out = await paidModelCall(testCtx(w.db, w.clock), MODEL_SPEC, HEADROOM, async (billed) => {
    billed.calls += 3;
    throw new Error("Failed to parse structured output: SyntaxError");
  });
  assert.equal(out.kind, "failed");
  const row = w.tables.diy_reads![0]!;
  assert.equal(row.cost, null, "diy_spend counts coalesce(cost, estimate): the ceiling stands");
  assert.equal(row.estimate, 0.35);
  assert.equal(w.tables.model_call_debits![0]!.calls, 3);
});

test("the model door refuses when the scan's headroom could not be read, and makes no call", async () => {
  const w = world();
  let called = 0;
  const out = await paidModelCall(testCtx(w.db, w.clock), MODEL_SPEC, null, async () => (called++, answer({ parsed_output: {} })));
  assert.equal(out.kind === "refused" && out.refusal.code, "model_headroom");
  assert.equal(called, 0);
  assert.equal(w.tables.model_call_debits!.length, 0);
});

test("the two doors do not cross", async () => {
  const w = world();
  await assert.rejects(() => paidRead(testCtx(w.db, w.clock), { ...SPEC, door: "model" }, ok(0.1)), /paidModelCall/);
  await assert.rejects(() => paidModelCall(testCtx(w.db, w.clock), { ...MODEL_SPEC, door: "labs" }, HEADROOM, async () => answer({})), /model door/);
});

test("diy_spend's answer is read strictly: a malformed row is unreadable, never zero", () => {
  assert.deepEqual(parseDiySpend([{ global_dfs_today: "1.5", global_model_today: 0, door_counts: { "scheduled:labs": 2 }, month_sums: { model: "0.4" } }]), {
    globalDfsToday: 1.5,
    globalModelToday: 0,
    doorCounts: { "scheduled:labs": 2 },
    monthSums: { scheduled: 0, on_demand: 0, model: 0.4 },
  });
  assert.throws(() => parseDiySpend([]), /no row/);
  assert.throws(() => parseDiySpend(null), /no row/);
  assert.throws(() => parseDiySpend([{ global_dfs_today: "lots" }]), /number/);
  assert.throws(() => parseDiySpend([{ door_counts: [1] }]), /object/);
  assert.equal(paramsHash({ a: 1 }), paramsHash({ a: 1 }));
  assert.notEqual(paramsHash({ a: 1 }), paramsHash({ a: 2 }));
});
