import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readVerdicts } from "@/lib/scan/anthropic";
import { selectAll } from "@/lib/supabase/page";

/**
 * Comparison verdicts (Danny, 18 Nov 2026; migration 20261118010000): each answer to a comparison prompt read once by
 * the small model for who it recommends - the client, no one ("it depends"), or a rival, by name - and kept on the
 * answer, so it is never read again. Run every ten minutes beside the brand batches (api/cron/brand-batches), at most
 * PER_RUN answers a time, newest first: the backfill of the stored answers clears in a few runs, and after that each
 * day's new comparison answers are read within ten minutes of their brands. A failed read leaves the answer unread
 * for the next run.
 */
export const PER_RUN = 120;
const PER_CALL = 10;
const DAYS = 90;

type Row = { id: string; client_domain_id: string; question_id: string; response_text: string | null };

export async function readDueVerdicts(db: SupabaseClient, deadline = Date.now() + 120_000): Promise<{ read: number; calls: number; errors: string[] }> {
  const errors: string[] = [];
  let qs: { id: string; text: string }[];
  try {
    // every client's comparison prompts, paged past PostgREST's thousand-row ceiling (supabase/page.ts)
    qs = await selectAll<{ id: string; text: string }>((from, to) => db
      .from("tracked_questions")
      .select("id, text")
      .or("prompt_type.eq.comparison,and(prompt_type.is.null,prompt_type_auto.eq.comparison)")
      .order("id")
      .range(from, to));
  } catch (err) {
    return { read: 0, calls: 0, errors: [`comparison prompts not read: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const question = new Map(qs.map((q) => [q.id, q.text]));
  if (!question.size) return { read: 0, calls: 0, errors };
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: rows, error: aErr } = await db
    .from("tracking_answers")
    .select("id, client_domain_id, question_id, response_text")
    .in("question_id", [...question.keys()])
    .eq("answered", true)
    .is("verdict", null)
    .gte("run_date", since)
    .order("run_date", { ascending: false })
    .limit(PER_RUN);
  if (aErr) return { read: 0, calls: 0, errors: [`answers not read: ${aErr.message}`] };
  const due = ((rows ?? []) as Row[]).filter((r) => (r.response_text ?? "").trim());
  if (!due.length) return { read: 0, calls: 0, errors };
  const clients = [...new Set(due.map((r) => r.client_domain_id))];
  const { data: cs, error: cErr } = await db.from("client_domains").select("id, brand_name, domain").in("id", clients);
  if (cErr) return { read: 0, calls: 0, errors: [`clients not read: ${cErr.message}`] };
  const brand = new Map(((cs ?? []) as { id: string; brand_name: string | null; domain: string }[]).map((c) => [c.id, c.brand_name ?? c.domain]));

  const billed = { calls: 0 };
  let read = 0;
  for (const cid of clients) {
    const mine = due.filter((r) => r.client_domain_id === cid);
    for (let i = 0; i < mine.length && Date.now() < deadline; i += PER_CALL) {
      const part = mine.slice(i, i + PER_CALL);
      try {
        const out = await readVerdicts(brand.get(cid) ?? "", part.map((r, k) => ({ n: k + 1, question: question.get(r.question_id) ?? "", text: r.response_text ?? "" })), billed);
        for (const v of out) {
          const r = part[v.n - 1];
          if (!r) continue;
          // the verdict columns only, never response_text (reading-retention.test.mts pins this payload)
          const verdictOnly = { verdict: v.verdict, verdict_rival: v.verdict === "rival" ? (v.rival ?? "").slice(0, 120) || null : null, verdict_at: new Date().toISOString() };
          const { error } = await db.from("tracking_answers").update(verdictOnly).eq("id", r.id);
          if (error) errors.push(`verdict not kept on ${r.id}: ${error.message}`);
          else read += 1;
        }
      } catch (err) {
        errors.push(`verdicts for ${cid}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
      }
    }
  }
  return { read, calls: billed.calls, errors };
}
