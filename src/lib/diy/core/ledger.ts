import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { billedCost, readFailureReason, readRetryDelay } from "../../tracking/decide.ts";

import { allowanceMonth } from "./allowances.ts";
import { type CapCode, type DiySpend, type Refusal, CAP_CODES, decideReservation } from "./caps.ts";
import { ctxRuntime } from "./ctx.ts";
import type { ReadCtx } from "./jobs.ts";
import { type Door, type ModelUsage, modelCost, round5 } from "./prices.ts";
import { readDiySettings } from "./settings.ts";

/**
 * The DIY ledger (13 Oct 2026, DIY P1; spec 10 sections 5.6 and 5.8):
 * reserve before a paid read, settle after it, and every sum a reservation
 * checks from one `diy_spend` call.
 *
 * The order is the whole point, and ledger.test.mts holds it on the fake
 * database:
 *
 * 1. read the settings and the sums - a failure of either refuses, because an
 *    unreadable ledger is never read as zero;
 * 2. decide (caps.ts) - a cap refusal is written as a `refused` row, which
 *    counts 0, so the run-health line can say a cap paused the night;
 * 3. write the reservation - status `reserved`, `estimate` the request's
 *    maximum - and refuse if that write fails;
 * 4. read;
 * 5. settle at what the vendor billed. A task DataForSEO failed keeps its
 *    billed cost (`billedCost`); a model call that threw after its request
 *    went out keeps its reservation's estimate, because its usage was lost
 *    with the throw and the estimate is the most it could have cost.
 *
 * Reservation is not atomic: concurrent reserves can overshoot a cap by the
 * estimates in flight, at most about $2 (section 5.6 item 9). Accepted; an
 * atomic `for update` function can come later, additively.
 *
 * Loadable by node --test: relative imports, the database on the ctx.
 */

/** A read is not started with less than this left before the caller's deadline: it would be abandoned mid-flight. */
export const MIN_READ_MS = 5_000;

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** A short, stable hash of what was asked, so two reads of one request can be told apart from two of different ones. Holds no text. */
export function paramsHash(params: unknown): string {
  return createHash("sha256").update(JSON.stringify(params ?? null)).digest("hex").slice(0, 32);
}

/** The start of the UTC day `now` falls in: the global caps' day. */
export function utcDayStart(now: number): string {
  return `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(`diy_spend answered ${JSON.stringify(v)} where a number belongs`);
  return n;
};

/** One `diy_spend` row, read strictly: anything malformed is an unreadable ledger, never a zero. */
export function parseDiySpend(data: unknown): DiySpend {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("diy_spend answered no row");
  const r = row as Record<string, unknown>;
  const obj = (v: unknown, what: string): Record<string, unknown> => {
    if (v === null || v === undefined) return {};
    if (typeof v !== "object" || Array.isArray(v)) throw new Error(`diy_spend's ${what} is not an object`);
    return v as Record<string, unknown>;
  };
  const counts = obj(r.door_counts, "door_counts");
  const sums = obj(r.month_sums, "month_sums");
  return {
    globalDfsToday: num(r.global_dfs_today ?? 0),
    globalModelToday: num(r.global_model_today ?? 0),
    doorCounts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, num(v)])),
    monthSums: { scheduled: num(sums.scheduled ?? 0), on_demand: num(sums.on_demand ?? 0), model: num(sums.model ?? 0) },
  };
}

/** Every sum a reservation checks, in one round trip. Throws on a failed or malformed answer. */
export async function readDiySpend(db: SupabaseClient, clientId: string, dayStart: string, monthStart: string): Promise<DiySpend> {
  const { data, error } = await db.rpc("diy_spend", { p_client: clientId, p_day_start: dayStart, p_month_start: monthStart });
  if (error) throw new Error(`could not read the DIY ledger: ${error.message}`);
  return parseDiySpend(data);
}

/** What one read is, as the ledger records it. */
export type ReadSpec = {
  door: Door;
  /** `diy_reads.endpoint`: prices.ts DIY_ENDPOINTS for the launch reads. */
  endpoint: string;
  /** The most it can cost (prices.ts). */
  estimate: number;
  /** What was asked, hashed into `params_hash`; never stored. */
  params: unknown;
};

/** What a vendor door hands back: the allow-listed value, what the task billed, and how many rows came back. */
export type VendorAnswer<T> = { value: T; cost: number; rows: number | null; partial: boolean };

export type ReadResult<T> =
  | { kind: "read"; value: T; cost: number; partial: boolean; readId: string }
  | { kind: "refused"; refusal: Refusal }
  | { kind: "failed"; reason: string; cost: number | null; readId: string };

type Row = Record<string, unknown>;

function baseRow(ctx: ReadCtx, spec: ReadSpec): Row {
  return {
    client_domain_id: ctx.client.id,
    door: spec.door,
    endpoint: spec.endpoint,
    trigger: ctx.trigger,
    action: ctx.action,
    params_hash: paramsHash(spec.params),
    estimate: round5(spec.estimate),
  };
}

/** A cap refusal, written so it can be counted. Never throws: the refusal stands whether or not its row lands. */
async function writeRefused(db: SupabaseClient, ctx: ReadCtx, spec: ReadSpec, refusal: Refusal): Promise<void> {
  try {
    const { error } = await db.from("diy_reads").insert({ ...baseRow(ctx, spec), status: "refused", code: refusal.code });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[diy] ledger: could not record a ${refusal.code} refusal for ${spec.endpoint}: ${msg(err)}`);
  }
}

/** Writes the reservation and answers its id, or throws. */
export async function reserveRead(db: SupabaseClient, ctx: ReadCtx, spec: ReadSpec): Promise<string> {
  const { data, error } = await db.from("diy_reads").insert({ ...baseRow(ctx, spec), status: "reserved" }).select("id").single();
  if (error) throw new Error(`could not reserve a DIY read: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== "string" && typeof id !== "number") throw new Error("the reservation came back with no id");
  return String(id);
}

export type Settlement = {
  status: "ok" | "partial" | "failed";
  /** What was billed. Null keeps the estimate as the cost (`coalesce(cost, estimate)` in diy_spend). */
  cost: number | null;
  rows?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  code?: string | null;
};

/**
 * Settles a reservation. Never throws: the read has happened and its result is
 * worth keeping. A settle that does not land leaves the row `reserved` at its
 * estimate, which over-counts - the safe direction - and is logged.
 */
export async function settleRead(db: SupabaseClient, id: string, s: Settlement, now: number): Promise<boolean> {
  try {
    const { error } = await db
      .from("diy_reads")
      .update({
        status: s.status,
        cost: s.cost === null ? null : round5(s.cost),
        rows: s.rows ?? null,
        tokens_in: s.tokensIn ?? null,
        tokens_out: s.tokensOut ?? null,
        code: s.code ?? null,
        settled_at: new Date(now).toISOString(),
      })
      .eq("id", id)
      .eq("status", "reserved");
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.warn(`[diy] ledger: could not settle read ${id} (${s.status}): ${msg(err)}`);
    return false;
  }
}

/**
 * Steps 1-3: read, decide, reserve. Answers the reservation's id or the
 * refusal. `modelCalls` is the model door's headroom reading; `allowance`
 * the on-demand allowance the minting runOnDemand checked.
 */
async function reserve(
  ctx: ReadCtx,
  spec: ReadSpec,
  extra: { modelCalls?: { last24h: number; perDay: number } | null },
): Promise<{ id: string } | { refusal: Refusal }> {
  const rt = ctxRuntime(ctx);
  if (!rt) throw new Error("a ReadCtx must be minted by the DIY worker or runOnDemand");
  if (rt.fixture) return { refusal: { code: "fixture", reason: "the fixture makes no paid read" } };
  const now = rt.now();
  if (ctx.deadlineMs - now < MIN_READ_MS) return { refusal: { code: "deadline", reason: `under ${MIN_READ_MS / 1000}s left before the caller's deadline` } };

  let refusal: Refusal | null;
  try {
    const settings = await readDiySettings(rt.db);
    const spend = await readDiySpend(rt.db, ctx.client.id, utcDayStart(now), allowanceMonth(ctx.client.market, now).start);
    refusal = decideReservation({
      settings,
      door: spec.door,
      trigger: ctx.trigger,
      estimate: spec.estimate,
      trial: ctx.client.trial,
      spend,
      ...(spec.door === "model" ? { modelCalls: extra.modelCalls ?? null } : {}),
    });
  } catch (err) {
    console.warn(`[diy] ledger: ${msg(err)}`);
    return { refusal: { code: "ledger_unreadable", reason: msg(err) } };
  }
  if (refusal) {
    if ((CAP_CODES as readonly string[]).includes(refusal.code as CapCode)) await writeRefused(rt.db, ctx, spec, refusal);
    return { refusal };
  }
  try {
    return { id: await reserveRead(rt.db, ctx, spec) };
  } catch (err) {
    console.warn(`[diy] ledger: ${msg(err)}`);
    return { refusal: { code: "ledger_unreadable", reason: msg(err) } };
  }
}

/**
 * One capped DataForSEO read: reserve, `send` inside the worker's pool of
 * reads in flight, retry on DataForSEO's "not now" codes (40101, 40202,
 * 40209) through the tracking runner's `readRetryDelay`, and settle. Only
 * doors.ts calls this, through `diyRead`; `send` is the vendor door in
 * dataforseo.ts.
 */
export async function paidRead<T>(ctx: ReadCtx, spec: ReadSpec, send: (budgetMs: number) => Promise<VendorAnswer<T>>): Promise<ReadResult<T>> {
  if (spec.door === "model") throw new Error("a model call goes through paidModelCall");
  const got = await reserve(ctx, spec, {});
  if ("refusal" in got) return { kind: "refused", refusal: got.refusal };
  const rt = ctxRuntime(ctx)!;
  const readId = got.id;

  return rt.reads.run(async () => {
    let billed = 0;
    for (let attempt = 0; ; attempt++) {
      const remaining = ctx.deadlineMs - rt.now();
      try {
        const answer = await send(Math.max(MIN_READ_MS, remaining));
        const cost = round5(billed + answer.cost);
        await settleRead(rt.db, readId, { status: answer.partial ? "partial" : "ok", cost, rows: answer.rows }, rt.now());
        return { kind: "read", value: answer.value, cost, partial: answer.partial, readId } as const;
      } catch (err) {
        billed += billedCost(err);
        const delay = readRetryDelay(err, attempt, ctx.deadlineMs - rt.now());
        if (delay !== null) {
          await rt.sleep(delay);
          continue;
        }
        const reason = readFailureReason(err);
        const cost = round5(billed);
        await settleRead(rt.db, readId, { status: "failed", cost, code: reason }, rt.now());
        console.warn(`[diy] ${spec.endpoint} for ${ctx.client.domain} failed: ${reason}`);
        return { kind: "failed", reason, cost, readId } as const;
      }
    }
  });
}

/** What a structured model call answers, as much of it as the ledger reads. */
export type ModelAnswer<T> = { stop_reason: string | null; usage: ModelUsage | null; parsed_output: T | null };

export type ModelSpec = ReadSpec & {
  /** `model_call_debits.reason`: "diy_classify" or "diy_example" (the column has no check constraint). */
  reason: string;
};

/**
 * One capped model call (section 5.3): reserve on the model door with the
 * scan's headroom checked, call one at a time outside the DataForSEO pool,
 * settle from the usage it reported, and debit `model_call_debits` with what
 * went out (`billed.calls`, counted below the SDK by countingFetch) so the
 * whole day's model-call ceiling (`anthropicCallsSince`) sees DIY calls too.
 *
 * A `refusal` or `max_tokens` stop is a failure, and nothing is read from its
 * body. `call` is the anthropic.ts function, handed its billing accumulator.
 */
export async function paidModelCall<T>(
  ctx: ReadCtx,
  spec: ModelSpec,
  modelCalls: { last24h: number; perDay: number } | null,
  call: (billed: { calls: number }) => Promise<ModelAnswer<T>>,
): Promise<ReadResult<T>> {
  if (spec.door !== "model") throw new Error("paidModelCall is the model door");
  const got = await reserve(ctx, spec, { modelCalls });
  if ("refusal" in got) return { kind: "refused", refusal: got.refusal };
  const rt = ctxRuntime(ctx)!;
  const readId = got.id;

  return rt.models.run(async () => {
    const billed = { calls: 0 };
    let res: ModelAnswer<T>;
    try {
      res = await call(billed);
    } catch (err) {
      await debit(rt.db, ctx, spec, billed.calls);
      const reason = readFailureReason(err);
      // Usage went with the throw. If a request went out, its reservation's
      // estimate - the most it could have cost - stands as its cost.
      const cost = billed.calls > 0 ? null : 0;
      await settleRead(rt.db, readId, { status: "failed", cost, code: reason }, rt.now());
      console.warn(`[diy] ${spec.endpoint} for ${ctx.client.domain} failed: ${reason}`);
      return { kind: "failed", reason, cost, readId } as const;
    }
    await debit(rt.db, ctx, spec, billed.calls);
    const cost = modelCost(res.usage);
    const tokens = { tokensIn: res.usage?.input_tokens ?? null, tokensOut: res.usage?.output_tokens ?? null };
    const stop = res.stop_reason;
    const failure = stop === "refusal" ? "refusal" : stop === "max_tokens" ? "max_tokens" : res.parsed_output == null ? "no structured output" : null;
    if (failure) {
      await settleRead(rt.db, readId, { status: "failed", cost, code: failure, ...tokens }, rt.now());
      console.warn(`[diy] ${spec.endpoint} for ${ctx.client.domain} failed: ${failure}`);
      return { kind: "failed", reason: failure, cost, readId } as const;
    }
    await settleRead(rt.db, readId, { status: "ok", cost, ...tokens }, rt.now());
    return { kind: "read", value: res.parsed_output as T, cost, partial: false, readId } as const;
  });
}

/**
 * One `model_call_debits` row per call, with the requests that went out.
 * Never throws, like spend.ts recordModelCallDebit, whose shape this keeps;
 * nothing is written for zero calls (the table's check refuses it).
 */
async function debit(db: SupabaseClient, ctx: ReadCtx, spec: ModelSpec, calls: number): Promise<void> {
  if (calls <= 0) return;
  try {
    const { error } = await db.from("model_call_debits").insert({ calls, reason: spec.reason, domain: ctx.client.domain, ip_hash: null });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[diy] could not record ${calls} model call(s) (${spec.reason}): ${msg(err)}`);
  }
}
