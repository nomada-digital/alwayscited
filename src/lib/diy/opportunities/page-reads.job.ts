import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, addDays } from "../../tracking/figures.ts";
import { type Subject, readSubject } from "../../tracking/limits.ts";
import { jobOutcomeFor, type RefusalCode } from "../core/caps.ts";
import { readGuardedPage } from "../core/fetch.ts";
import type { JobContext, JobHandler, JobResult, ReadCtx } from "../core/jobs.ts";

import { readOpportunityRows, readPageReads } from "./data.ts";
import { readPlacedKeys, withoutPlaced } from "./derive.ts";
import { type OppIO, liveIO } from "./io.ts";
import { compareOrder, orderKey } from "./order.ts";
import { blockedFacts, factsFromHtml, factsFromParsed } from "./read-page.ts";
import { recordVerification, writePageRead } from "./record.ts";
import type { Opportunity, PageFacts } from "./types.ts";
import { verificationFromFacts } from "./verify.ts";

/**
 * `page_reads` (13 Oct 2026, DIY P7; spec 10 sections 5.2, 5.4, 5.7 and
 * 6.2): paid, daily, so it runs only while diy_enabled is on and the client's
 * setup is confirmed. Two parts, the paid fallbacks first:
 *
 * 1. **Watch fallbacks** (at most FALLBACKS_PER_NIGHT): pursued and won pages
 *    the free `watch` could not read because robots.txt keeps our crawler
 *    out, read through `content_parsing` - links and anchors, no `rel`.
 * 2. **Cited-page reads** (at most READS_PER_NIGHT): listed pages never
 *    read, or read more than STALE_DAYS ago, in list order. Our own fetch
 *    first, which costs nothing, where robots.txt lets our crawler in;
 *    otherwise `content_parsing`.
 *
 * At a cap the paid reads stop and the free ones go on: a month budget
 * stops re-reads and fallbacks (spec 5.6, "cited re-reads stop"), a daily
 * cap defers what is left to tomorrow. Every count is in the job's note.
 */

export const READS_PER_NIGHT = 40;
export const FALLBACKS_PER_NIGHT = 20;
export const STALE_DAYS = 14;

const READ_LENSES = new Set(["cited", "threads", "profiles", "lists", "logged"]);

/** The pages to read tonight: listed and new, never read or read STALE_DAYS ago, in list order. Pure. */
export function pickReads(rows: readonly Opportunity[], reads: ReadonlyMap<string, PageFacts>, today: Day, max = READS_PER_NIGHT): Opportunity[] {
  const stale = addDays(today, -STALE_DAYS);
  return rows
    .filter((o) => o.status === "new" && o.live && READ_LENSES.has(o.lens) && /^https?:\/\//.test(o.url))
    .filter((o) => {
      const r = reads.get(o.urlKey);
      return !r || r.readAt.slice(0, 10) <= stale;
    })
    .sort((a, b) => {
      const unread = Number(reads.has(a.urlKey)) - Number(reads.has(b.urlKey));
      return unread || compareOrder({ key: orderKey(a.evidence, a.pageType, a.firstSeen), urlKey: a.urlKey }, { key: orderKey(b.evidence, b.pageType, b.firstSeen), urlKey: b.urlKey });
    })
    .slice(0, max);
}

/** Pursued and won pages whose free watch is waiting for a fallback read. Pure. */
export function pickFallbacks(rows: readonly Opportunity[], max = FALLBACKS_PER_NIGHT): Opportunity[] {
  return rows.filter((o) => (o.status === "pursuing" || o.status === "pitched" || o.status === "won") && o.verified?.fallback === true && o.lens !== "link_domain").slice(0, max);
}

type Counts = { own: number; parsed: number; unreadable: number; fallbacks: number; skipped: number };

/** One cited page read: our fetch first, the paid read when robots.txt keeps us out and a paid read may be made. */
async function readOne(io: OppIO, ctx: ReadCtx, o: Opportunity, subject: Subject & { brand: string }, today: Day, paid: { stop: RefusalCode | null }, counts: Counts): Promise<{ facts: PageFacts; readId: string | null } | null> {
  const at = new Date().toISOString();
  const competitors = o.evidence.competitors;
  const own = await readGuardedPage(o.url, { get: io.get, thirdParty: true });
  if (own.ok) {
    counts.own++;
    return { facts: factsFromHtml({ url: o.url, urlKey: o.urlKey, at, today, read: { status: own.status, html: own.html, contentType: own.headers["content-type"] ?? null }, subject, competitors }), readId: null };
  }
  if (own.why !== "robots") {
    counts.unreadable++;
    return { facts: blockedFacts({ url: o.url, urlKey: o.urlKey, at, why: own.why }), readId: null };
  }
  if (paid.stop) {
    counts.skipped++;
    return null;
  }
  const r = await io.parse(ctx, o.url);
  if (r.kind === "refused") {
    paid.stop = r.refusal.code;
    counts.skipped++;
    return null;
  }
  if (r.kind === "failed") {
    counts.unreadable++;
    return { facts: { ...blockedFacts({ url: o.url, urlKey: o.urlKey, at, why: "network" }), via: "content_parsing" }, readId: r.readId };
  }
  counts.parsed++;
  return { facts: factsFromParsed({ url: o.url, urlKey: o.urlKey, at, today, parsed: r.value, subject, competitors }), readId: r.readId };
}

export async function runPageReads(db: SupabaseClient, ctx: ReadCtx, io: OppIO, today: Day, deadlineMs: number): Promise<JobResult> {
  const subject = await readSubject(db, ctx.client.id);
  if (typeof subject === "string") throw new Error(subject);
  const subj = { ...subject, brand: subject.brand ?? ctx.client.brand };
  const [rows, reads, placed] = await Promise.all([readOpportunityRows(db, ctx.client.id), readPageReads(db, ctx.client.id), readPlacedKeys(db, ctx.client.id)]);
  const kept = withoutPlaced(rows, placed);
  const counts: Counts = { own: 0, parsed: 0, unreadable: 0, fallbacks: 0, skipped: 0 };
  const paid: { stop: RefusalCode | null } = { stop: null };
  const now = () => new Date().toISOString();

  for (const o of pickFallbacks(kept)) {
    if (Date.now() > deadlineMs || paid.stop) break;
    const r = await io.parse(ctx, o.url);
    if (r.kind === "refused") {
      paid.stop = r.refusal.code;
      break;
    }
    const facts = r.kind === "read" ? factsFromParsed({ url: o.url, urlKey: o.urlKey, at: now(), today, parsed: r.value, subject: subj, competitors: o.evidence.competitors }) : { ...blockedFacts({ url: o.url, urlKey: o.urlKey, at: now(), why: "network" }), via: "content_parsing" as const };
    await recordVerification(db, ctx.client.id, o, verificationFromFacts(facts, today, o.verified, subj), { now: now(), by: "system", today });
    await writePageRead(db, ctx.client.id, facts, reads.get(o.urlKey) ?? null, r.readId);
    counts.fallbacks++;
  }

  for (const o of pickReads(kept, reads, today)) {
    if (Date.now() > deadlineMs) break;
    const got = await readOne(io, ctx, o, subj, today, paid, counts);
    if (got) await writePageRead(db, ctx.client.id, got.facts, reads.get(o.urlKey) ?? null, got.readId);
  }

  const note = `read ${counts.own + counts.parsed} (${counts.own} own, ${counts.parsed} content_parsing), ${counts.unreadable} unreadable, ${counts.fallbacks} watch fallbacks${counts.skipped ? `, ${counts.skipped} left for a paid read` : ""}${paid.stop ? `; paid reads stopped: ${paid.stop}` : ""}`;
  if (paid.stop) {
    const outcome = jobOutcomeFor(paid.stop);
    return { outcome: outcome === "failed" ? "failed" : outcome, note };
  }
  return { outcome: "ok", note };
}

/** The handler. Paid: queued only while diy_enabled is on, and handed a ReadCtx. `io` is the tests' fakes; the live reads otherwise. */
export function pageReadsHandler(io?: OppIO): JobHandler {
  return {
    kind: "page_reads",
    paid: true,
    cadence: "daily",
    priority: 4,
    onboarding: true,
    async run(ctx: JobContext): Promise<JobResult> {
      if (!ctx.read) return { outcome: "skipped", note: "no ReadCtx: a paid kind run without one" };
      return runPageReads(ctx.db, ctx.read, io ?? (await liveIO()), ctx.today, ctx.deadlineMs);
    },
  };
}
