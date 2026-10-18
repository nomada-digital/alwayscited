import type { ChangeLine, Diff } from "../diy/changes/diff.ts";
import type { ItemSeverity, PlanItem } from "../diy/plan/types.ts";
import { thisWeek } from "../diy/plan/week.ts";
import type { Day } from "../tracking/figures.ts";
import type { TierKey } from "../tier-text.ts";
import type { Focus, Position, WeekFigures, Work } from "./merge.ts";

/**
 * The Monday "This week" email (13 Oct 2026, DIY P9; spec 10 sections 7.10
 * and 8.3 Q3), as a pure builder: the week's pinned Actions items (P3's
 * pickWeek, read back as `week_of` = this Monday) and the top three lines of
 * "Since last check" (P4's diffChecks), in the lifecycle emails' conventions.
 * lifecycle.ts `thisWeek` renders it in the approved design (brief 2e, 18 Oct
 * 2026) - the week's figures from merge.ts, what changed, the actions, and on
 * a worked plan the month's work - and the sweep (lifecycle-sweep.ts) sends
 * it, on Mondays, only while email_this_week_enabled is true. It ships false,
 * and nothing is sent until Danny approves the preview at /admin/emails and
 * turns it on.
 *
 * The rules this keeps, pinned in this-week-mail.test.mts:
 *
 * - every sentence is written by a rule from stored rows: an item's title and
 *   its first "why" fact (each with its counts and dates, as the app shows
 *   it - the app's "Shown because" honesty), a change line as diffChecks
 *   wrote it;
 * - no clock time (days only), no causal words, the brand lowercase, a tier
 *   only as TIER_PLAIN;
 * - nothing is promised that is not read: a week with no change to report
 *   says why there is none, and a change list that could not be read is left
 *   out, never said as "no changes".
 *
 * Plain module, relative imports, type-only imports from merge.ts: node --test
 * runs it.
 */

/** Items pinned to one Monday: three, plus any Blocking item new since (spec 10 section 6.1). The email lists at most this many. */
export const THIS_WEEK_ITEMS = 4;
/** "the top 3 diffChecks lines" (spec 10 section 7.10). */
export const THIS_WEEK_CHANGES = 3;

export type ThisWeekItem = { severity: ItemSeverity; title: string; why: string | null };

/** What Since last check had to say: its top lines, why it has none, or that it could not be read. */
export type ThisWeekChanges = { state: "ok"; lines: string[]; more: number } | { state: "early" } | { state: "quiet" } | { state: "unread" };

export type ThisWeekData = {
  tier: TierKey;
  domain: string;
  /** The Monday the items are pinned to. */
  weekOf: Day;
  items: readonly ThisWeekItem[];
  changes: ThisWeekChanges;
  /** The client's This week page. */
  link: string;
  /** This week against last on the dashboard's rows (merge.ts weekFigures); none, and no figure is shown or put in the subject. */
  week?: WeekFigures | null;
  /** The lead cluster: keyword, other form, target page, its Google positions apart (merge.ts focusCluster). */
  focus?: Focus | null;
  /** The month's placements against the plan (merge.ts workThisMonth); null on alwaystracked, where the table is hidden. */
  work?: Work | null;
  /** The client's Email settings, where this email is switched off. */
  settings?: string | null;
  /** This recipient's signed one-click unsubscribe link (unsubscribe.ts), for the footer and List-Unsubscribe. */
  unsubscribe?: string | null;
};

/** The week's items as the email lists them: P3's This week order, done and dropped ones left out. Pure. */
export function thisWeekItems(items: readonly PlanItem[], today: Day): ThisWeekItem[] {
  return thisWeek(items, today)
    .filter((i) => i.status !== "done" && i.status !== "dropped")
    .slice(0, THIS_WEEK_ITEMS)
    .map((i) => ({ severity: i.severity, title: i.title, why: i.why[0]?.text ?? null }));
}

/** A grouped line's own words ("ChatGPT stopped naming you for 4 prompts") stand alone in a mail: no items are listed. */
const lineText = (l: ChangeLine) => l.text;

/** Since last check, cut to its top three lines. Pure. */
export function thisWeekChanges(diff: Diff | null): ThisWeekChanges {
  if (!diff) return { state: "unread" };
  if (diff.state !== "ok") return { state: diff.state };
  const lines = diff.lines.slice(0, THIS_WEEK_CHANGES).map(lineText);
  return { state: "ok", lines, more: Math.max(0, diff.lines.length - lines.length) + diff.more };
}

/** Whether a week has anything to say. An empty week is not mailed. */
export function worthSending(d: Pick<ThisWeekData, "items" | "changes">): boolean {
  return d.items.length > 0 || (d.changes.state === "ok" && d.changes.lines.length > 0);
}

/**
 * #7's subject, from the week's real figures (brief 2e, 18 Oct 2026): "This
 * week: named in 28% of answers, up 6 pts · #7 -> #6". A down week says so
 * plainly ("A harder week. Here's what moved: ..."). With no figure yet - the
 * first week, or a client with no answers - the subject is the week's actions,
 * as it was before the redesign.
 */
export function weekSubject(d: Pick<ThisWeekData, "domain" | "items" | "week">, dir: "up" | "down" | "flat" | null, lead: Pick<Position, "now" | "before"> | null): string {
  const w = d.week ?? null;
  const delta = w && w.pct !== null && w.before !== null ? w.pct - w.before : null;
  const moved = delta === null ? "" : delta === 0 ? ", no change" : `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} pts`;
  const pos = lead && lead.now !== null && lead.before !== null ? ` · #${lead.before} → #${lead.now}` : "";
  if (w && w.pct !== null) {
    return dir === "down" ? `A harder week. Here's what moved: named in ${w.pct}%${moved}${pos}` : `This week: named in ${w.pct}% of answers${moved}${pos}`;
  }
  if (pos) return dir === "down" ? `A harder week. Here's what moved: Google${pos}` : `This week: Google${pos}`;
  const n = d.items.length;
  return n ? `This week for ${d.domain}: ${n} ${n === 1 ? "action" : "actions"}` : `This week for ${d.domain}`;
}

/** A change line's pill: New for a gain, Lost for a loss, Moved otherwise. Read off diffChecks' own words. */
export function changeTone(line: string): { label: string; tone: "good" | "bad" | "quiet" } {
  if (/\b(stopped|dropped|left|lost|fell|no longer)\b/i.test(line)) return { label: "Lost", tone: "bad" };
  if (/\b(started|entered|now cites|new|joined|gained)\b/i.test(line)) return { label: "New", tone: "good" };
  return { label: "Moved", tone: "quiet" };
}
