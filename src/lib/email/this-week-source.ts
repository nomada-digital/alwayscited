import "server-only";

import { enginesFor } from "@/config/pricing";
import { type Diff, diffChecks, recentRange } from "@/lib/diy/changes/diff";
import { diyDay } from "@/lib/diy/core/jobs";
import { readPlan } from "@/lib/diy/plan/data";
import type { ThisWeekClient } from "@/lib/email/lifecycle-sweep";
import { type ThisWeekChanges, type ThisWeekItem, thisWeekChanges, thisWeekItems } from "@/lib/email/this-week-mail";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { firstCheckDay } from "@/lib/tracking/figures";
import { loadOverview } from "@/lib/tracking/overview-data";

/**
 * The This week email's content for one client (13 Oct 2026, DIY P9; spec 10
 * section 7.10), read through the same readers the app draws from, so the
 * mail and the dashboard cannot say two things: the week's Actions items
 * (P3's readPlan, cut by thisWeek to this Monday's pins) and Since last check
 * (P4's diffChecks over the last 7 days of checks, as the Overview runs it,
 * on the cluster keywords when the client has clusters).
 *
 * A failed plan read throws, so the client is skipped this Monday and logged;
 * a failed change read leaves the changes out of the mail ("unread") rather
 * than saying there were none. Handed to the sweep as io.thisWeek by
 * lifecycle-cron.ts; the sweep asks email_this_week_enabled first, so none of
 * this is read while the flag is off.
 */
export async function thisWeekContent(c: ThisWeekClient, today: string): Promise<{ items: ThisWeekItem[]; changes: ThisWeekChanges }> {
  const items = thisWeekItems(await readPlan(() => supabaseAdmin(), c.id), diyDay(Date.now()));
  let diff: Diff | null = null;
  try {
    const data = await loadOverview(c.id, recentRange(today), "none");
    const clusterKeywords = new Set((data.clusters ?? []).filter((k) => k.stopped_on === null && k.keyword_id).map((k) => k.keyword_id as string));
    const keywords = clusterKeywords.size ? data.keywords.filter((k) => clusterKeywords.has(k.id)) : data.keywords.filter((k) => k.stopped_on === null);
    diff = diffChecks({
      today,
      firstCheck: firstCheckDay(c.startedOn, data.questions),
      answers: data.answers,
      serp: data.serp,
      runs: data.runs,
      prompts: data.questions.map((q) => ({ id: q.id, text: q.text })),
      keywords: keywords.map((k) => ({ id: k.id, keyword: k.keyword })),
      brand: c.brand,
      domain: c.domain,
      engines: enginesFor(c.tier),
    });
  } catch (err) {
    console.warn(`[mail] this_week changes for ${c.id} not read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { items, changes: thisWeekChanges(diff) };
}
