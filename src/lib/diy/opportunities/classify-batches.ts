import "server-only";

import { batchState, cancelBatch, classifyBatchResults, classifyPages, describeAnthropicError, labelled, submitClassifyBatch } from "@/lib/scan/anthropic";
import { supabaseAdmin } from "@/lib/supabase/admin";

import type { Refusal } from "../core/caps.ts";
import type { ReadCtx } from "../core/jobs.ts";
import { debitModelCalls, modelFailure, settleModelAnswer, settleRead } from "../core/ledger.ts";
import { reserveClassify } from "../core/model.ts";
import { modelCost } from "../core/prices.ts";

import { CLASSIFY_SYSTEM, ClassifySchema, classifyUser } from "./classify-prompt.ts";
import { kindsFromAnswer, writeKinds } from "./classify.job.ts";
import type { Unclassified } from "./derive.ts";

/**
 * The nightly classify calls through the Message Batches API (9 Nov 2026, the prompt-caching audit), as the daily
 * tracking's brand extraction already goes (tracking/brand-batches.ts).
 *
 * The classify job (classify.job.ts) reserves each chunk on the DIY ledger exactly as a direct call would - caps and
 * the scan's headroom checked, at the full-price ceiling - then sends the chunks as one batch at half the price and
 * records it in diy_classify_batches. Nobody waits: the types are read by the next night's refresh. The collector,
 * every ten minutes beside the brand batches (api/cron/brand-batches), settles each reservation from its result at
 * the batch rate and stores the types as the direct call would have.
 *
 * The fallback is the call it replaced: a result that errored, was refused (a batch request carries no refusal
 * fallback), stopped at max_tokens or did not parse is classified with classifyPages, refusal fallback on, and a batch
 * still running after BATCH_WAIT_MS is cancelled and classified the same way. The direct call bills against the same
 * reservation, whose full-price estimate covers it. A batch that cannot be sent or recorded leaves the job to call
 * directly, as before. DIY_CLASSIFY_INLINE=1 turns the batch off.
 */

export const BATCH_WAIT_MS = 60 * 60 * 1000;

export function classifyByBatch(env: Record<string, string | undefined> = process.env): boolean {
  return env.DIY_CLASSIFY_INLINE !== "1";
}

/** custom_id -> the chunk's reservation and the items it carries (what kindsFromAnswer and a direct call need). */
type ChunkMap = Record<string, { read_id: string; items: Unclassified[] }>;

/**
 * The night's chunks as one batch: each reserved in turn (a cap stops the rest, as it stops the direct calls), sent,
 * and recorded. Null when nothing went, so the job calls directly: every reservation made is settled first.
 */
export async function sendClassifyBatch(ctx: ReadCtx, parts: readonly Unclassified[][]): Promise<{ sent: number; refusal: Refusal | null } | null> {
  const db = supabaseAdmin();
  // The table first (20261109030000): until it is there, nothing is reserved or sent and the job calls directly, so
  // this can deploy before its migration and starts batching the night after the table lands.
  const { error: tableErr } = await db.from("diy_classify_batches").select("id").limit(1);
  if (tableErr) {
    console.warn(`[diy] classify batches unavailable (${tableErr.message}), so calling directly`);
    return null;
  }
  const chunks: ChunkMap = {};
  let refusal: Refusal | null = null;
  for (const [n, items] of parts.entries()) {
    const got = await reserveClassify(ctx, { system: CLASSIFY_SYSTEM, user: classifyUser(items), items: items.length });
    if ("refusal" in got) {
      refusal = got.refusal;
      break;
    }
    chunks[`chunk-${n}`] = { read_id: got.id, items: [...items] };
  }
  const ids = Object.keys(chunks);
  if (!ids.length) return { sent: 0, refusal };

  let batchId: string;
  try {
    batchId = await labelled("diy_classify_batch", () =>
      submitClassifyBatch(ids.map((id) => ({ custom_id: id, input: { system: CLASSIFY_SYSTEM, user: classifyUser(chunks[id]!.items), schema: ClassifySchema } })), { calls: 0 }),
    );
  } catch (err) {
    // An error the API answered sent nothing; a timeout may have landed, so its estimate stands (cost null).
    const answered = typeof (err as { status?: unknown })?.status === "number";
    for (const c of Object.values(chunks)) await settleRead(db, c.read_id, { status: "failed", cost: answered ? 0 : null, code: "batch_not_sent" }, Date.now());
    console.warn(`[diy] classify batch for ${ctx.client.domain} not sent, so calling directly: ${describeAnthropicError(err)}`);
    return null;
  }

  const { error } = await db.from("diy_classify_batches").insert({ client_domain_id: ctx.client.id, domain: ctx.client.domain, batch_id: batchId, chunks, request_count: ids.length });
  if (error) {
    // Unrecorded, it would never be collected: cancel it and call directly. Its reservations keep their estimates.
    console.warn(`[diy] classify batch ${batchId} for ${ctx.client.domain} not recorded (${error.message}); cancelling it and calling directly`);
    await cancelBatch(batchId, { calls: 0 }).catch(() => undefined);
    for (const c of Object.values(chunks)) await settleRead(db, c.read_id, { status: "failed", cost: null, code: "batch_not_recorded" }, Date.now());
    return null;
  }
  console.log(`[diy] classify for ${ctx.client.domain} sent as batch ${batchId} (${ids.length} calls)`);
  return { sent: ids.length, refusal };
}

export type ClassifyCollectReport = { checked: number; collected: number; fellBack: number; waiting: number; errors: string[] };

type PendingRow = { id: string; domain: string; batch_id: string; chunks: ChunkMap; created_at: string };

/** Every pending classify batch: settled when it has ended, called directly where it failed or ran past the wait. */
export async function collectClassifyBatches(now: number = Date.now(), budgetMs = 120_000): Promise<ClassifyCollectReport> {
  const started = Date.now();
  const db = supabaseAdmin();
  const report: ClassifyCollectReport = { checked: 0, collected: 0, fellBack: 0, waiting: 0, errors: [] };
  const { data: rows, error } = await db.from("diy_classify_batches").select("id, domain, batch_id, chunks, created_at").eq("status", "pending").order("created_at").limit(50);
  if (error) {
    // No table yet (the migration not applied): nothing can have been sent, so nothing waits.
    if (error.code === "PGRST205" || error.code === "42P01") return report;
    report.errors.push(`could not read the pending classify batches: ${error.message}`);
    return report;
  }
  for (const row of (rows ?? []) as PendingRow[]) {
    if (Date.now() - started > budgetMs) break;
    report.checked += 1;
    try {
      const done = await collectOne(db, row, now);
      if (done === "waiting") report.waiting += 1;
      else if (done === "fallback") report.fellBack += 1;
      else report.collected += 1;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      report.errors.push(`${row.domain}: ${why}`);
      console.warn(`[diy] classify batch ${row.batch_id} for ${row.domain} not collected: ${why}`);
    }
  }
  return report;
}

async function collectOne(db: ReturnType<typeof supabaseAdmin>, row: PendingRow, now: number): Promise<"waiting" | "collected" | "fallback"> {
  const scratch = { calls: 0 };
  const state = await batchState(row.batch_id, scratch);
  const late = now - Date.parse(row.created_at) >= BATCH_WAIT_MS;
  if (!state.ended && !late) return "waiting";
  // A cancelled batch's answered requests are billed but not read here: they are classified again directly.
  const results = state.ended ? await classifyBatchResults(row.batch_id, ClassifySchema, scratch) : new Map<string, null>();
  if (!state.ended) await cancelBatch(row.batch_id, scratch).catch(() => undefined);

  const billed = { calls: 0 };
  let fellBack = !state.ended;
  let typed = 0;
  let written = 0;
  let failed = 0;
  const at = new Date(now).toISOString();
  for (const [id, chunk] of Object.entries(row.chunks)) {
    const got = results.get(id) ?? null;
    const p = { endpoint: "diy_classify", domain: row.domain };
    let read;
    if (got && !modelFailure(got)) {
      read = await settleModelAnswer(db, chunk.read_id, got, { ...p, batch: true }, Date.now());
    } else {
      fellBack = true;
      const batchCost = got ? modelCost(got.usage, got.model, true) : 0;
      const before = billed.calls;
      try {
        const res = await classifyPages({ system: CLASSIFY_SYSTEM, user: classifyUser(chunk.items), schema: ClassifySchema }, billed);
        read = await settleModelAnswer(db, chunk.read_id, res, { ...p, extraCost: batchCost }, Date.now());
      } catch (err) {
        // A request went out and its usage was lost with the throw: the estimate stands, as paidModelCall settles it.
        await settleRead(db, chunk.read_id, { status: "failed", cost: billed.calls > before ? null : batchCost, code: describeAnthropicError(err).slice(0, 120) }, Date.now());
        read = null;
      }
    }
    if (read?.kind === "read") {
      const kinds = kindsFromAnswer(chunk.items, read.value, at);
      typed += kinds.typed;
      written += await writeKinds(db, kinds.rows);
    } else failed += chunk.items.length;
  }

  // The batch's requests and any direct calls count against the day's model-call ceiling, as direct calls do.
  await debitModelCalls(db, { domain: row.domain, reason: "diy_classify" }, Object.keys(row.chunks).length + billed.calls);
  const { error } = await db
    .from("diy_classify_batches")
    .update({ status: fellBack ? "fallback" : "collected", settled_at: at, fallback_calls: billed.calls, typed, failed })
    .eq("id", row.id);
  if (error) throw new Error(`could not settle the batch row: ${error.message}`);
  console.log(`[diy] classify batch ${row.batch_id} for ${row.domain}: typed ${typed} (${written} types stored)${failed ? `, ${failed} failed` : ""}${fellBack ? ` (fallback: ${billed.calls} direct calls)` : ""}`);
  return fellBack ? "fallback" : "collected";
}
