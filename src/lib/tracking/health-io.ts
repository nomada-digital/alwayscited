import "server-only";

import { SITE_URL } from "@/config/schema";
import { diyAttention } from "@/lib/diy/core/health";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { addDays } from "@/lib/tracking/figures";
import { sendRunHealth } from "@/lib/tracking/health-mail";
import { type HealthIo, type ReportOutcome, reportRunHealth } from "@/lib/tracking/run-health";

/**
 * The live wiring of run-health.ts (9 Oct 2026, audit reliability-6): the
 * report takes its database and sender as arguments so node --test can run it
 * against a fake (run-health.test.mts), and this is the one place the real
 * ones are handed in - the service-role client, Resend through
 * sendRunHealth, and the canonical origin, never a request's host (the
 * lesson of 30 Sep, dispatch.ts) - and, since 13 Oct 2026 (DIY P1), the DIY
 * night's attention line, so a clean tracking day still mails a DIY problem.
 */
export function runHealthIo(): HealthIo {
  return { send: sendRunHealth, adminUrl: `${SITE_URL}/admin/tracking`, diyAttention: (now) => diyAttention(supabaseAdmin, now) };
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** One day's report, never thrown: a run has closed and the cron has answered whatever this does. */
export async function reportRunHealthSafely(day: string, now: number = Date.now(), note?: string | null): Promise<ReportOutcome | { error: string }> {
  try {
    const out = await reportRunHealth(supabaseAdmin(), runHealthIo(), { day, now, note });
    if (out === "sent" || out === "unsent") console.log(`[track] run-health summary for ${day}: ${out}`);
    return out;
  } catch (err) {
    const error = msg(err);
    console.warn(`[track] run-health report for ${day} failed: ${error}`);
    return { error };
  }
}

/**
 * The daily cron's call, after its dispatch: the day before first - sent only
 * if it never was, which is a day a killed run kept open until the stall
 * sweep closed it - then today, which sends at once only when nothing is in
 * flight, i.e. when nothing was dispatched. `note` says why.
 */
export async function runHealthAfterDispatch(note?: string | null, now: number = Date.now()): Promise<Record<string, ReportOutcome | { error: string }>> {
  const today = trackingDay(new Date(now));
  return {
    yesterday: await reportRunHealthSafely(addDays(today, -1), now),
    today: await reportRunHealthSafely(today, now, note),
  };
}
