import type { SupabaseClient } from "@supabase/supabase-js";

import type { Day } from "../../tracking/figures.ts";
import { jobOutcomeFor } from "../core/caps.ts";
import { DIY_MODEL_PRICES } from "../core/prices.ts";
import type { JobContext, JobHandler, JobResult, ReadCtx } from "../core/jobs.ts";

import { CLASSIFY_SYSTEM, type ClassifyAnswer, classifyUser } from "./classify-prompt.ts";
import { domainKey, pageKey } from "./classify-rules.ts";
import { type Unclassified, derive } from "./derive.ts";
import { type OppIO, liveIO } from "./io.ts";
import { readDeriveInput } from "./refresh.job.ts";
import { DOMAIN_TYPES, type DomainType, PAGE_TYPES, type PageType } from "./types.ts";

/**
 * `classify` (13 Oct 2026, DIY P7; spec 10 sections 5.3 and 6.2): paid (the
 * model door), daily. The pages the rules left without a domain or page
 * type, sent to P1's `classifyPages` in chunks of at most CHUNK - never more,
 * the AGENTS.md token-ceiling gotcha (one call over 223 sources truncated
 * mid-JSON) - one call at a time, and cached globally in source_kinds with
 * `set_by` 'model'. The types are read by the next night's refresh.
 *
 * **Never fatal, never silent.** A call that fails - a `max_tokens` stop, a
 * refusal, no structured output - counts every item of its chunk as failed
 * in the job's note, writes nothing for them, and leaves them unclassified,
 * so the competitor rule keeps failing closed for them. An item missing from
 * an answer stays unclassified too. A cap stops the night's calls.
 */

export const CHUNK = 50;
/** At most this many chunks a night: the model door's scheduled count per client a day (caps.ts DOOR_DAILY.scheduled.model). */
export const CHUNKS_PER_NIGHT = 4;

/** The pages in chunks of at most CHUNK. Pure. */
export function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > CHUNK) throw new Error(`a chunk is 1-${CHUNK} items, not ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The rows one answer gives source_kinds: only for keys in its chunk, only the types each item asked for, only enum values. Pure. */
export function kindsFromAnswer(chunk: readonly Unclassified[], answer: ClassifyAnswer, now: string): { rows: Record<string, unknown>[]; typed: number } {
  const byKey = new Map(chunk.map((i) => [i.urlKey, i]));
  const rows = new Map<string, Record<string, unknown>>();
  let typed = 0;
  for (const a of answer.items) {
    const item = byKey.get(a.key);
    if (!item) continue;
    byKey.delete(a.key);
    const dt = (DOMAIN_TYPES as readonly string[]).includes(a.domain_type ?? "") ? (a.domain_type as DomainType) : null;
    const pt = (PAGE_TYPES as readonly string[]).includes(a.page_type ?? "") ? (a.page_type as PageType) : null;
    if (item.needs.includes("domain") && dt && !rows.has(domainKey(item.domain))) rows.set(domainKey(item.domain), { key: domainKey(item.domain), level: "domain", domain_type: dt, page_type: null, set_by: "model", model: DIY_MODEL_PRICES.model, classified_at: now });
    if (item.needs.includes("page") && pt) rows.set(pageKey(item.urlKey), { key: pageKey(item.urlKey), level: "page", domain_type: null, page_type: pt, set_by: "model", model: DIY_MODEL_PRICES.model, classified_at: now });
    if (dt || pt) typed++;
  }
  return { rows: [...rows.values()], typed };
}

/** Writes model types, never over a rule's: a key the rules have settled keeps the rule's type. */
async function writeKinds(db: SupabaseClient, rows: readonly Record<string, unknown>[]): Promise<number> {
  let n = 0;
  for (const row of rows) {
    const { error } = await db.from("source_kinds").insert(row);
    if (!error) {
      n++;
      continue;
    }
    if (error.code !== "23505") throw new Error(`could not store a type: ${error.message}`);
    const { error: uErr } = await db.from("source_kinds").update({ domain_type: row.domain_type, page_type: row.page_type, model: row.model, classified_at: row.classified_at }).eq("key", row.key as string).eq("set_by", "model");
    if (uErr) throw new Error(`could not store a type: ${uErr.message}`);
    n++;
  }
  return n;
}

/**
 * The night's classify calls over what waits for a type: at most
 * CHUNKS_PER_NIGHT chunks of at most CHUNK, one at a time. A failed call
 * counts its whole chunk as failed and writes nothing for it; a cap stops
 * the night. `write` stores one answer's rows and says how many it stored.
 */
export async function classifyAll(io: Pick<OppIO, "classify">, ctx: ReadCtx, unclassified: readonly Unclassified[], write: (rows: Record<string, unknown>[]) => Promise<number>): Promise<JobResult> {
  if (!unclassified.length) return { outcome: "ok", note: "nothing waits for a type" };
  const parts = chunks(unclassified).slice(0, CHUNKS_PER_NIGHT);
  const sent = parts.reduce((n, c) => n + c.length, 0);
  let typed = 0;
  let written = 0;
  let failed = 0;
  const reasons = new Set<string>();
  for (const chunk of parts) {
    const r = await io.classify(ctx, { system: CLASSIFY_SYSTEM, user: classifyUser(chunk), items: chunk.length });
    if (r.kind === "refused") {
      const outcome = jobOutcomeFor(r.refusal.code);
      return { outcome: outcome === "failed" ? "failed" : outcome, note: `typed ${typed}, ${failed} failed; stopped at a cap: ${r.refusal.code}` };
    }
    if (r.kind === "failed") {
      failed += chunk.length;
      reasons.add(r.reason);
      continue;
    }
    const got = kindsFromAnswer(chunk, r.value, new Date().toISOString());
    typed += got.typed;
    written += await write(got.rows);
  }
  const left = unclassified.length - sent;
  const note = `typed ${typed} of ${sent} pages (${written} types stored)${failed ? `; ${failed} failed (${[...reasons].join(", ")})` : ""}${left > 0 ? `; ${left} wait for tomorrow` : ""}`;
  return { outcome: failed && !typed ? "failed" : "ok", note };
}

export async function runClassify(db: SupabaseClient, ctx: ReadCtx, io: OppIO, client: { id: string; domain: string }, today: Day): Promise<JobResult> {
  const input = await readDeriveInput(db, client, today);
  const { unclassified } = derive(input);
  return classifyAll(io, ctx, unclassified, (rows) => writeKinds(db, rows));
}

/** The handler. Paid (the model door): queued only while diy_enabled is on. `io` is the tests' fakes; the live reads otherwise. */
export function classifyHandler(io?: OppIO): JobHandler {
  return {
    kind: "classify",
    paid: true,
    cadence: "daily",
    priority: 6,
    onboarding: false,
    async run(ctx: JobContext): Promise<JobResult> {
      if (!ctx.read) return { outcome: "skipped", note: "no ReadCtx: a paid kind run without one" };
      return runClassify(ctx.db, ctx.read, io ?? (await liveIO()), ctx.client, ctx.today);
    },
  };
}
