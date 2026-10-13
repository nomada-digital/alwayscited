import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, addDays } from "../../tracking/figures.ts";
import { readSubject } from "../../tracking/limits.ts";
import { ALLOWANCES, WON_WATCH_MONTHS } from "../core/allowances.ts";
import type { GuardedGet } from "../core/fetch.ts";
import type { JobContext, JobHandler, JobResult } from "../core/jobs.ts";

import { readOpportunityRows, readPageReads } from "./data.ts";
import { readPlacedKeys, withoutPlaced } from "./derive.ts";
import { liveIO } from "./io.ts";
import { recordVerification, writePageRead } from "./record.ts";
import type { Opportunity } from "./types.ts";
import { verifyPage } from "./verify.ts";

/**
 * `watch` (13 Oct 2026, DIY P7; spec 10 sections 2.3, 2.5, 5.7 and 6.9):
 * free, daily, our own fetch only - it runs whatever diy_enabled says, as
 * "verification of pursued pages (weekly)" is free and unmetered. Each page
 * is due on its own cadence:
 *
 * - pursuing and pitched: weekly (WEEK_DAYS since its last verification);
 * - won: monthly, for WON_WATCH_MONTHS after it was won, only the
 *   `won_watched` (30) most recently won;
 * - never lens `link_domain`: a domain has no page to verify, and fetching
 *   its homepage would raise false Slipping items; never an `own` row, which
 *   is the client's own page.
 *
 * A page robots.txt keeps us out of is marked for the paid fallback, which
 * the `page_reads` job reads through content_parsing when DIY is on. A link
 * or mention found before and gone now is flagged `removed`: the Slipping
 * candidate (candidates.ts).
 */

export const WEEK_DAYS = 7;
export const MONTH_DAYS = 30;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** The pages due a verification today, oldest verification first. Pure. */
export function dueForWatch(rows: readonly Opportunity[], today: Day): Opportunity[] {
  const watchable = (o: Opportunity) => o.lens !== "link_domain" && o.lens !== "own" && /^https?:\/\//.test(o.url);
  const lastAt = (o: Opportunity) => o.verified?.at ?? "0000-00-00";
  const active = rows.filter((o) => (o.status === "pursuing" || o.status === "pitched") && watchable(o) && lastAt(o) <= addDays(today, -WEEK_DAYS));
  const wonSince = addDays(today, -Math.round(WON_WATCH_MONTHS * 30.44));
  const won = rows
    .filter((o) => o.status === "won" && watchable(o) && (day(o.statusAt) ?? "0000-00-00") >= wonSince)
    .sort((a, b) => (b.statusAt ?? "").localeCompare(a.statusAt ?? ""))
    .slice(0, ALLOWANCES.won_watched.full)
    .filter((o) => lastAt(o) <= addDays(today, -MONTH_DAYS));
  return [...active, ...won].sort((a, b) => lastAt(a).localeCompare(lastAt(b)));
}

export async function runWatch(db: SupabaseClient, client: { id: string; brand: string }, get: GuardedGet, today: Day, deadlineMs: number, now: () => number = Date.now): Promise<JobResult> {
  const subject = await readSubject(db, client.id);
  if (typeof subject === "string") throw new Error(subject);
  const subj = { ...subject, brand: subject.brand ?? client.brand };
  const [rows, reads, placed] = await Promise.all([readOpportunityRows(db, client.id), readPageReads(db, client.id), readPlacedKeys(db, client.id)]);
  const due = dueForWatch(withoutPlaced(rows, placed), today);
  let read = 0;
  let waiting = 0;
  let removed = 0;
  for (const o of due) {
    if (now() > deadlineMs) break;
    const r = await verifyPage({ url: o.url, urlKey: o.urlKey }, subj, o.verified, { get, fallback: null, today, now: now() }, o.evidence.competitors);
    const v = await recordVerification(db, client.id, o, r.verification, { now: new Date(now()).toISOString(), by: "system", today });
    await writePageRead(db, client.id, r.facts, reads.get(o.urlKey) ?? null);
    read++;
    if (v.fallback) waiting++;
    if (v.removed) removed++;
  }
  return { outcome: "ok", note: `verified ${read} of ${due.length} due${waiting ? `; ${waiting} wait for a fallback read` : ""}${removed ? `; ${removed} found removed` : ""}` };
}

/** The handler. Free, so it gets no ReadCtx and makes own fetches only. `get` is the tests' fake; crawl.ts's guarded read otherwise. */
export function watchHandler(get?: GuardedGet): JobHandler {
  return {
    kind: "watch",
    paid: false,
    cadence: "daily",
    priority: 5,
    onboarding: false,
    async run(ctx: JobContext): Promise<JobResult> {
      return runWatch(ctx.db, ctx.client, get ?? (await liveIO()).get, ctx.today, ctx.deadlineMs);
    },
  };
}
