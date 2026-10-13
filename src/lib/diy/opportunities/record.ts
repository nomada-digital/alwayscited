import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day } from "../../tracking/figures.ts";
import { itemsByRef, markVerified } from "../plan/write.ts";

import { readRow } from "./data.ts";
import { withEntry } from "./status.ts";
import type { Opportunity, PageFacts, Verification } from "./types.ts";
import { removedSince } from "./verify.ts";

/**
 * Writing what a read found (13 Oct 2026, DIY P7): a page read into
 * page_reads, and a verification onto its opportunity and, for a won page
 * the read confirms, onto its Plan item (P3's markVerified, section 6.9).
 * Each write looks at its own error.
 */

/**
 * One page's latest read, replacing the one before - unless this read could
 * not see the page and the one before could: a page that now blocks us keeps
 * the facts we read when it did not, with the day they were read, and only
 * the try is recorded (`attempted_at`), so the night's picker waits its 14
 * days before trying again rather than spending a read slot on it every
 * night (13 Oct 2026, review of DIY P7). True when the read replaced the row.
 */
export async function writePageRead(db: SupabaseClient, clientId: string, f: PageFacts, had: PageFacts | null, readId: string | null = null): Promise<boolean> {
  if (f.status !== "ok" && had?.status === "ok") {
    const { error } = await db.from("page_reads").update({ attempted_at: f.readAt }).eq("client_domain_id", clientId).eq("url_key", f.urlKey);
    if (error) throw new Error(`could not store the page read's try: ${error.message}`);
    return false;
  }
  const { error } = await db.from("page_reads").upsert(readRow(clientId, f, readId), { onConflict: "client_domain_id,url_key" });
  if (error) throw new Error(`could not store the page read: ${error.message}`);
  return true;
}

/** The line a verified won page gives its Plan item, or null when this read confirms nothing. */
export function planVerifiedText(v: Verification): string | null {
  return v.ok && (v.link === true || v.names === true) ? v.text : null;
}

/**
 * One verification onto its opportunity: the reading, a history line, and a
 * `removed` flag when a link or mention the read before found has gone. A
 * won page the read confirms marks its Plan item verified.
 */
export async function recordVerification(db: SupabaseClient, clientId: string, opp: Pick<Opportunity, "id" | "status" | "verified" | "history">, v: Verification, p: { now: string; by: string; today: Day }): Promise<Verification> {
  const removed = removedSince(opp.verified, v);
  const next: Verification = removed ? { ...v, removed } : { ...v };
  if (!removed) delete next.removed;
  const { error } = await db
    .from("opportunities")
    .update({ verified: next, history: withEntry(opp.history, { at: p.now, kind: "verify", by: p.by, text: next.text }), updated_at: p.now })
    .eq("client_domain_id", clientId)
    .eq("id", opp.id);
  if (error) throw new Error(`could not store the verification: ${error.message}`);
  const text = opp.status === "won" ? planVerifiedText(next) : null;
  if (text) {
    try {
      for (const item of await itemsByRef(db, clientId, "opportunities", opp.id)) await markVerified(db, item.id, { by: p.by, at: p.today, text });
    } catch (err) {
      console.warn(`[diy] opportunity verify plan: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return next;
}
