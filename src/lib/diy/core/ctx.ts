import type { SupabaseClient } from "@supabase/supabase-js";

import type { DiyClient } from "./client.ts";
import type { OnDemandAction, ReadCtx, ReadTrigger } from "./jobs.ts";

/**
 * Minting a ReadCtx, and what each one carries out of sight (13 Oct 2026, DIY
 * P1; spec 10 section 5.6 item 1).
 *
 * `ReadCtx` (jobs.ts) is branded, so it cannot be written as an object
 * literal. It is minted here, and `gating.test.mts` holds the callers of
 * `mintReadCtx` to the two the spec names: the worker (scheduled and
 * onboarding jobs) and `runOnDemand` (a member's button). A ctx minted any
 * other way - a cast - carries no runtime, and every paid door refuses it.
 *
 * The runtime is what the doors need and a feature package must not choose:
 * the database the ledger is written to, the clock, the worker's pool of
 * DataForSEO reads in flight, and, on demand, the allowance this action was
 * checked against. It is held in a WeakMap keyed by the ctx, so it goes when
 * the ctx does.
 */

/** A pool of at most `size` tasks at once. Shared by every ctx a worker mints, so one worker never has more than WORKER_POOL reads in flight. */
export type Pool = { size: number; run<T>(task: () => Promise<T>): Promise<T> };

export function pool(size: number): Pool {
  if (!Number.isInteger(size) || size < 1) throw new Error(`a pool needs a size from 1, not ${size}`);
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    size,
    async run<T>(task: () => Promise<T>): Promise<T> {
      // A freed slot is handed straight to the next waiter rather than
      // released and re-taken, so a caller arriving in between cannot slip in
      // and make it size + 1.
      if (active < size) active += 1;
      else await new Promise<void>((resolve) => waiting.push(resolve));
      try {
        return await task();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      }
    },
  };
}

export type ReadRuntime = {
  db: SupabaseClient;
  now: () => number;
  /** Waits between retries (readRetryDelay); a test passes one that does not wait. */
  sleep: (ms: number) => Promise<void>;
  /** DataForSEO reads in flight: WORKER_POOL per worker (section 5.6 item 8). */
  reads: Pool;
  /** Model calls run one at a time, outside the DataForSEO pool (section 5.7). */
  models: Pool;
  /** The fixture never reaches a vendor: every paid door refuses a fixture ctx with `fixture`. */
  fixture: boolean;
};

const RUNTIMES = new WeakMap<object, ReadRuntime>();

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A new ReadCtx. Only `runDiyWorker` and `runOnDemand` call this
 * (gating.test.mts); tests mint their own with a fake runtime.
 */
export function mintReadCtx(
  fields: { client: DiyClient; trigger: ReadTrigger; action: OnDemandAction | null; deadlineMs: number },
  runtime: ReadRuntime,
): ReadCtx {
  if (fields.trigger === "on_demand" ? fields.action === null : fields.action !== null) {
    throw new Error(`a ${fields.trigger} read ${fields.trigger === "on_demand" ? "needs" : "takes no"} on-demand action`);
  }
  const ctx = Object.freeze({ client: fields.client, trigger: fields.trigger, action: fields.action, deadlineMs: fields.deadlineMs });
  RUNTIMES.set(ctx, runtime);
  return ctx as unknown as ReadCtx;
}

/** The runtime a ctx was minted with, or null for one that was not minted here. */
export function ctxRuntime(ctx: ReadCtx): ReadRuntime | null {
  return RUNTIMES.get(ctx as unknown as object) ?? null;
}

/** Whether a ctx is the fixture's, so a package's on-demand work can serve its canned read instead of calling a door. */
export function isFixtureCtx(ctx: ReadCtx): boolean {
  return ctxRuntime(ctx)?.fixture === true;
}
