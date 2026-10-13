import "server-only";

import { type DiyModelInput, classifyPages as classifyCall, writeReoptExample as exampleCall } from "@/lib/scan/anthropic";
import { getSettings } from "@/lib/scan/settings";
import { anthropicCallsSince } from "@/lib/scan/spend";

import { ctxRuntime } from "./ctx.ts";
import type { ReadCtx } from "./jobs.ts";
import { paidModelCall, type ReadResult } from "./ledger.ts";
import { modelEstimate } from "./prices.ts";

/**
 * The DIY model door's two wrappers (13 Oct 2026, DIY P1; spec 10 section
 * 5.3). Not callers: the calls are `classifyPages` and `writeReoptExample` in
 * `anthropic.ts`, the one file allowed to call a model. Each wrapper:
 *
 * 1. reads the site's model calls in the last 24 hours and its
 *    `anthropic_calls_per_day`, so the reservation can refuse a DIY call above
 *    half of it - the free scan keeps the other half (an unreadable count
 *    refuses);
 * 2. reserves on the ledger's model door at the call's ceiling (its input
 *    sized from its characters, plus 16,000 output tokens);
 * 3. calls, one at a time, with a fresh `billed = { calls: 0 }`;
 * 4. settles from `usage`, and debits `model_call_debits` with
 *    `calls = billed.calls` and reason `diy_classify` or `diy_example`, which
 *    puts DIY calls under `anthropicCallsSince`.
 *
 * P7 and P8 pass the system prompt, the user message and the zod schema; they
 * never import the SDK. ledger.ts paidModelCall is where this is tested.
 */

/** Items per classify call. Never more: the token-ceiling gotcha in AGENTS.md (one call over 223 sources truncated mid-JSON). */
export const CLASSIFY_CHUNK = 50;

async function headroom(now: number): Promise<{ last24h: number; perDay: number } | null> {
  try {
    const [last24h, settings] = await Promise.all([anthropicCallsSince(new Date(now - 86_400_000).toISOString()), getSettings()]);
    return { last24h, perDay: settings.anthropic_calls_per_day };
  } catch (err) {
    console.warn(`[diy] model: could not read the model-call ceiling: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const now = (ctx: ReadCtx) => ctxRuntime(ctx)?.now() ?? Date.now();

/** Page and domain types for at most CLASSIFY_CHUNK items (P7's classify job). `items` is how many the message carries. */
export async function classifyPages<T>(ctx: ReadCtx, input: DiyModelInput<T> & { items: number }): Promise<ReadResult<T>> {
  if (!Number.isInteger(input.items) || input.items < 1 || input.items > CLASSIFY_CHUNK) {
    throw new Error(`a classify call carries 1-${CLASSIFY_CHUNK} items, not ${input.items}`);
  }
  const estimate = modelEstimate(input.system.length + input.user.length);
  return paidModelCall(ctx, { door: "model", endpoint: "diy_classify", estimate, params: { items: input.items }, reason: "diy_classify" }, await headroom(now(ctx)), (billed) =>
    classifyCall({ system: input.system, user: input.user, schema: input.schema }, billed),
  );
}

/** One drafted re-optimisation example (P8, on demand, in `after()`). */
export async function writeReoptExample<T>(ctx: ReadCtx, input: DiyModelInput<T>): Promise<ReadResult<T>> {
  const estimate = modelEstimate(input.system.length + input.user.length);
  return paidModelCall(ctx, { door: "model", endpoint: "diy_example", estimate, params: { chars: input.user.length }, reason: "diy_example" }, await headroom(now(ctx)), (billed) =>
    exampleCall({ system: input.system, user: input.user, schema: input.schema }, billed),
  );
}
