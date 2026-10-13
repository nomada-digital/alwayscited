import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, addDays } from "../../tracking/figures.ts";
import { jobOutcomeFor } from "../core/caps.ts";
import type { JobContext, JobHandler, JobResult, ReadCtx } from "../core/jobs.ts";
import type { ReadResult } from "../core/ledger.ts";

import { accessFrom } from "./access.ts";
import { type LinksIO, ask, liveLinksIO } from "./io.ts";
import { NONE_PLACED, type Placed, excludePlacedDomains, readPlacedDomains } from "./nomada-placements.ts";
import type { NewLost } from "./types.ts";
import { writeLinkRead } from "./write.ts";

/**
 * `backlinks_weekly` (13 Oct 2026, DIY P10; spec 10 sections 5.2 and 5.7):
 * paid (the backlinks door), weekly on the client's start weekday, and on
 * onboarding (the summary is part of the first night's reads, section 5.5).
 * Three reads: the profile summary, then the week's new and the week's lost
 * referring domains, one link each. Stored in `backlink_reads` under the
 * night's day; a re-run the same day replaces its own rows.
 *
 * The summary goes first: when it fails with an access code (40204 and the
 * other account refusals, access.ts), the two lists are not asked for that
 * night - the ledger row the summary left is what the page reads access
 * from, and one refused call a week is all an inactive account costs (the
 * job is closed as skipped, so it is not retried the same night).
 *
 * A cap stops the job: a daily cap defers it to tomorrow, the month's
 * scheduled budget or the switch skip it (caps.ts jobOutcomeFor), which is
 * the "backlinks weekly falls back to monthly" step of section 5.6: the page
 * keeps showing the last read's date. A failed read is never silent: the
 * note says which read failed and why.
 *
 * Domains where Nomada has placed another client are left out of the stored
 * lists too, as on every Links list; a placements read that fails leaves
 * them in the store, and the page, which subtracts again on every read,
 * shows nothing it could not check.
 */

export const NEW_LOST_DAYS = 7;

type Step<T> = { ok: true; value: T; readId: string } | { ok: false; stop: JobResult | null; why: string; code?: string };

function step<T>(r: ReadResult<T>, what: string): Step<T> {
  if (r.kind === "read") return { ok: true, value: r.value, readId: r.readId };
  if (r.kind === "refused") {
    const outcome = jobOutcomeFor(r.refusal.code);
    return { ok: false, stop: { outcome, note: `${what} refused: ${r.refusal.code}` }, why: r.refusal.code };
  }
  return { ok: false, stop: null, why: `${what} failed: ${r.reason}`, code: r.reason };
}

async function placedFor(db: SupabaseClient, clientId: string): Promise<{ placed: Placed; note: string | null }> {
  try {
    return { placed: await readPlacedDomains(db, clientId), note: null };
  } catch (err) {
    return { placed: NONE_PLACED, note: `placements not read (${err instanceof Error ? err.message : String(err)}); the page subtracts them on read` };
  }
}

export async function runWeekly(db: SupabaseClient, ctx: ReadCtx, io: LinksIO, client: { id: string }, today: Day): Promise<JobResult> {
  const notes: string[] = [];
  const summary = step(await ask(() => io.summary(ctx)), "summary");
  if (!summary.ok) {
    if (summary.stop) return summary.stop;
    // An access refusal: the lists would be refused too.
    // Skipped, not failed: a retry the same night would be refused the same way. The ledger row is what the page reads.
    if (accessFrom({ status: "failed", code: summary.code ?? null, created_at: "" }).state === "inactive") return { outcome: "skipped", note: `Backlinks access isn't active (${summary.why}); the lists were not asked for` };
    notes.push(summary.why);
  } else {
    await writeLinkRead(db, client.id, { kind: "summary", readOn: today, payload: summary.value ?? {}, readId: summary.readId, total: summary.value?.referringDomains ?? null });
    notes.push("summary read");
  }

  const since = addDays(today, -NEW_LOST_DAYS);
  const added = step(await ask(() => io.newLost(ctx, "new", since)), "new links");
  if (!added.ok && added.stop) return { ...added.stop, note: [...notes, added.stop.note].join("; ") };
  const lost = step(await ask(() => io.newLost(ctx, "lost", since)), "lost links");
  if (!lost.ok && lost.stop) return { ...lost.stop, note: [...notes, lost.stop.note].join("; ") };
  if (added.ok && lost.ok) {
    const { placed, note } = await placedFor(db, client.id);
    if (note) notes.push(note);
    const keep = <R extends { domain: string; urlFrom: string | null }>(rows: readonly R[]): R[] => excludePlacedDomains(rows, placed, (r) => ({ domain: r.domain, url: r.urlFrom }));
    const payload: NewLost = { since, added: keep(added.value.rows), lost: keep(lost.value.rows), addedTotal: added.value.total, lostTotal: lost.value.total };
    await writeLinkRead(db, client.id, { kind: "new_lost", readOn: today, payload, readId: added.readId, total: (added.value.total ?? 0) + (lost.value.total ?? 0) });
    notes.push(`${payload.added.length} new and ${payload.lost.length} lost domains`);
  } else {
    if (!added.ok) notes.push(added.why);
    if (!lost.ok) notes.push(lost.why);
  }
  const failed = !summary.ok && !(added.ok && lost.ok);
  return { outcome: failed ? "failed" : "ok", note: notes.join("; ") };
}

/** The handler. Paid: queued only for a confirmed client while diy_enabled is on. `io` is the tests' fakes; the live reads otherwise. */
export function backlinksWeeklyHandler(io?: LinksIO): JobHandler {
  return {
    kind: "backlinks_weekly",
    paid: true,
    cadence: "weekly",
    priority: 7,
    onboarding: true,
    async run(ctx: JobContext): Promise<JobResult> {
      if (!ctx.read) return { outcome: "skipped", note: "no ReadCtx: a paid kind run without one" };
      return runWeekly(ctx.db, ctx.read, io ?? (await liveLinksIO()), ctx.client, ctx.today);
    },
  };
}
