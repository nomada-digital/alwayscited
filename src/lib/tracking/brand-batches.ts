import "server-only";

import { brandBatchResults, brandBatchState, cancelBrandBatch, describeAnthropicError, extractBrands, labelled, submitBrandBatch, type BrandBatchRequest } from "@/lib/scan/anthropic";
import { brandKey, subjectKeys } from "@/lib/scan/brand-name";
import { type Engine } from "@/lib/scan/engines";
import { batchBlocks } from "@/lib/scan/prose-batches";
import { recordModelCallDebit } from "@/lib/scan/spend";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { creditCompetitors } from "./brand-credit.ts";
import { liveOn } from "./decide.ts";

/**
 * The daily tracking's brand extraction through the Message Batches API (8 Nov 2026, the prompt-caching audit).
 *
 * The extraction is the largest model spend tracking has - up to ~15k tokens of answers a call, every client and
 * engine every morning - and it cannot be cached (a short system prompt over new answers each time). Nobody waits on
 * it: the run is at 05:00 and the dashboard leaves an answer's brands out until they are read. So the cron's pass sends
 * the requests extractBrands would make as one batch, at half the price, and stores its answers brands_ok=false;
 * collectBrandBatches, every ten minutes (api/cron/brand-batches), reads the names when the batch has ended and credits
 * each answer exactly as the run would have (brand-credit.ts).
 *
 * The fallback is the call it replaced: a request that errored or did not parse is extracted with extractBrands on the
 * stored text, and a batch still running after BATCH_WAIT_MS is cancelled and extracted the same way, so an answer's
 * brands are never more than about an hour late. A batch that cannot be sent at all is extracted in the run, as
 * before. TRACKING_BRANDS_INLINE=1 turns the batch off.
 */

export const BATCH_WAIT_MS = 60 * 60 * 1000;

export function brandsByBatch(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRACKING_BRANDS_INLINE !== "1";
}

type Answer = { question_id: string; engine: Engine; answered: boolean; response_text: string | null };
/** custom_id -> the engine and, block by block, the answer each text came from. */
type RequestMap = Record<string, { engine: Engine; qids: string[] }>;

/** The batch for one run's answers; null when there is nothing to read or it could not be sent. */
export async function sendBrandBatch(
  answers: readonly Answer[],
  engines: readonly Engine[],
  context: { topic: string; brand: string },
  runId: string,
): Promise<{ batchId: string; requests: RequestMap; count: number } | null> {
  const requests: BrandBatchRequest[] = [];
  const map: RequestMap = {};
  for (const engine of engines) {
    const read = answers.filter((a) => a.engine === engine && a.answered && a.response_text);
    batchBlocks(read.map((a) => a.response_text!)).forEach((batch, n) => {
      const id = `${engine}-${n}`;
      requests.push({ custom_id: id, texts: batch.map((b) => b.text), context });
      map[id] = { engine, qids: batch.map((b) => read[b.at]!.question_id) };
    });
  }
  if (!requests.length) return null;
  try {
    const batchId = await labelled("extract_brands_batch", () => submitBrandBatch(requests, { calls: 0 }));
    console.log(`[track] ${runId} brand extraction sent as batch ${batchId} (${requests.length} requests)`);
    return { batchId, requests: map, count: requests.length };
  } catch (err) {
    console.warn(`[track] ${runId} brand batch not sent, so extracting now: ${describeAnthropicError(err)}`);
    return null;
  }
}

/** The batch's row, written as soon as it is sent. False when it could not be: the batch is cancelled and the run extracts. */
export async function recordBrandBatch(
  db: ReturnType<typeof supabaseAdmin>,
  p: { runId: string; clientId: string; batchId: string; requests: RequestMap; count: number },
): Promise<boolean> {
  const { error } = await db.from("tracking_brand_batches").insert({ run_id: p.runId, client_domain_id: p.clientId, batch_id: p.batchId, requests: p.requests, request_count: p.count });
  if (!error) return true;
  console.warn(`[track] ${p.runId} brand batch ${p.batchId} not recorded (${error.message}); cancelling it and extracting now`);
  await cancelBrandBatch(p.batchId, { calls: 0 }).catch(() => undefined);
  return false;
}

export type CollectReport = { checked: number; collected: number; fellBack: number; waiting: number; errors: string[] };

/** The collector's budget against the route's 300 s: a batch not reached is collected on the next pass. */
export const COLLECT_BUDGET_MS = 240_000;

/** Every pending batch: credited when it has ended, extracted directly when it errored or ran past the wait. */
export async function collectBrandBatches(now: number = Date.now()): Promise<CollectReport> {
  const started = Date.now();
  const db = supabaseAdmin();
  const report: CollectReport = { checked: 0, collected: 0, fellBack: 0, waiting: 0, errors: [] };
  const { data: rows, error } = await db.from("tracking_brand_batches").select("id, run_id, client_domain_id, batch_id, requests, created_at").eq("status", "pending").order("created_at").limit(50);
  if (error) {
    report.errors.push(`could not read the pending batches: ${error.message}`);
    return report;
  }
  for (const row of rows ?? []) {
    if (Date.now() - started > COLLECT_BUDGET_MS) break;
    report.checked += 1;
    try {
      const done = await collectOne(db, row as PendingRow, now);
      if (done === "waiting") report.waiting += 1;
      else if (done === "fallback") report.fellBack += 1;
      else report.collected += 1;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      report.errors.push(`${String(row.run_id)}: ${why}`);
      console.warn(`[track] brand batch ${String(row.batch_id)} for run ${String(row.run_id)} not collected: ${why}`);
    }
  }
  return report;
}

type PendingRow = { id: string; run_id: string; client_domain_id: string; batch_id: string; requests: RequestMap; created_at: string };

async function collectOne(db: ReturnType<typeof supabaseAdmin>, row: PendingRow, now: number): Promise<"waiting" | "collected" | "fallback"> {
  // The run stores its answers after the batch is sent: nothing is read until the run has closed.
  const { data: open, error: oErr } = await db.from("tracking_runs").select("status").eq("id", row.run_id).single();
  if (oErr) throw new Error(`could not read the run: ${oErr.message}`);
  if (open.status === "queued" || open.status === "running") return "waiting";
  const scratch = { calls: 0 };
  const state = await brandBatchState(row.batch_id, scratch);
  const late = now - Date.parse(row.created_at) >= BATCH_WAIT_MS;
  if (!state.ended && !late) return "waiting";
  const results = state.ended ? await brandBatchResults(row.batch_id, scratch) : new Map<string, null>();
  if (!state.ended) await cancelBrandBatch(row.batch_id, scratch).catch(() => undefined);

  const [{ data: run, error: rErr }, { data: client, error: cErr }, { data: answers, error: aErr }] = await Promise.all([
    db.from("tracking_runs").select("id, run_date, error").eq("id", row.run_id).single(),
    db.from("client_domains").select("id, domain, brand_name, topic").eq("id", row.client_domain_id).single(),
    db.from("tracking_answers").select("question_id, engine, answered, response_text").eq("run_id", row.run_id),
  ]);
  if (rErr || cErr || aErr) throw new Error(`could not read the run: ${(rErr ?? cErr ?? aErr)!.message}`);
  const { data: ks, error: kErr } = await db.from("tracked_keywords").select("keyword, added_on, stopped_on").eq("client_domain_id", row.client_domain_id);
  if (kErr) throw new Error(`could not read the keywords: ${kErr.message}`);
  const domain = client.domain as string;
  const brand = (client.brand_name as string | null) ?? domain;
  const context = { topic: (client.topic as string | null) ?? "", brand };
  const text = new Map((answers ?? []).map((a) => [`${a.question_id}|${a.engine}`, a.response_text as string | null]));

  // The names per engine: the batch's, and for a request it did not answer, a direct extraction of the same texts.
  const billed = { calls: 0 };
  const names = new Map<Engine, string[]>();
  const unread = new Set<string>();
  let fellBack = !state.ended;
  for (const [id, req] of Object.entries(row.requests)) {
    let got = results.get(id) ?? null;
    if (!got) {
      fellBack = true;
      const texts = req.qids.map((q) => text.get(`${q}|${req.engine}`) ?? "");
      const out = await extractBrands(texts, context, { billed }).catch(() => null);
      got = out && !out.failedBatches ? out.brands : null;
      if (!got) for (const q of req.qids) unread.add(`${q}|${req.engine}`);
    }
    if (got) names.set(req.engine, [...(names.get(req.engine) ?? []), ...got.map((b) => b.brand)]);
  }
  const subject = subjectKeys(brand, domain);
  const others = new Map<Engine, string[]>();
  for (const [engine, list] of names) {
    const seen = new Map<string, string>();
    for (const n of list) {
      const key = brandKey(n.trim());
      if (key && !subject.has(key) && !seen.has(key)) seen.set(key, n.trim());
    }
    others.set(engine, [...seen.values()]);
  }
  const day = run.run_date as string;
  const terms = [client.topic as string | null, ...(ks ?? []).filter((k) => liveOn(k as { added_on: string; stopped_on: string | null }, day)).map((k) => k.keyword as string | null)];
  const credit = await creditCompetitors(others, { terms, brand, runId: row.run_id, billed });

  for (const req of Object.values(row.requests)) {
    for (const q of req.qids) {
      const key = `${q}|${req.engine}`;
      if (unread.has(key)) continue;
      const brands = credit({ engine: req.engine, response_text: text.get(key) ?? null });
      const { error } = await db.from("tracking_answers").update({ brands, brands_ok: true }).eq("run_id", row.run_id).eq("question_id", q).eq("engine", req.engine);
      if (error) throw new Error(`could not store the brands: ${error.message}`);
    }
  }
  // An answer still unread stays brands_ok=false, which the brand figures leave out, and the run says so.
  if (unread.size) {
    const line = `brands not read in ${unread.size} answer${unread.size === 1 ? "" : "s"} (batch and direct extraction failed)`;
    const { error } = await db.from("tracking_runs").update({ status: "partial", error: [run.error as string | null, line].filter(Boolean).join("; ") }).eq("id", row.run_id);
    if (error) console.warn(`[track] ${row.run_id} run not marked partial: ${error.message}`);
  }
  const { error: sErr } = await db.from("tracking_brand_batches").update({ status: fellBack ? "fallback" : "collected", settled_at: new Date(now).toISOString(), fallback_calls: billed.calls, unread: unread.size }).eq("id", row.id);
  if (sErr) throw new Error(`could not settle the batch row: ${sErr.message}`);
  // The batch's requests and any direct calls ride on the run's model_calls, as the run's own extraction did.
  const calls = billed.calls + Object.keys(row.requests).length;
  const { data: mc, error: mErr } = await db.from("tracking_runs").select("model_calls").eq("id", row.run_id).single();
  if (mErr) console.warn(`[track] ${row.run_id} model calls not read: ${mErr.message}`);
  else {
    const { error: uErr } = await db.from("tracking_runs").update({ model_calls: (Number(mc.model_calls) || 0) + calls }).eq("id", row.run_id);
    if (uErr) console.warn(`[track] ${row.run_id} model calls not added: ${uErr.message}`);
  }
  await recordModelCallDebit({ calls, reason: "tracking_run", domain });
  console.log(`[track] ${row.run_id} brands credited from batch ${row.batch_id}${fellBack ? ` (fallback: ${billed.calls} direct calls)` : ""}; ${unread.size} unread`);
  return fellBack ? "fallback" : "collected";
}
