import type { ChangeLine, Diff } from "../diy/changes/diff.ts";
import { type ItemSeverity, type PlanItem, SEVERITY_LABEL } from "../diy/plan/types.ts";
import { thisWeek } from "../diy/plan/week.ts";
import { type Day, formatDay } from "../tracking/figures.ts";
import type { TierKey } from "../tier-text.ts";
import type { MailLine, MailParts } from "./lifecycle.ts";

/**
 * The Monday "This week" email (13 Oct 2026, DIY P9; spec 10 sections 7.10
 * and 8.3 Q3), as a pure builder: the week's pinned Actions items (P3's
 * pickWeek, read back as `week_of` = this Monday) and the top three lines of
 * "Since last check" (P4's diffChecks), in the lifecycle emails' conventions.
 * lifecycle.ts `thisWeek` renders it through the same shell as every
 * lifecycle email - one button, the help block, the company line - and the
 * sweep (lifecycle-sweep.ts) sends it, on Mondays, only while
 * email_this_week_enabled is true. It ships false, and nothing is sent until
 * Danny approves the preview at /admin/emails and turns it on.
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
 * Plain module, relative imports, type-only imports from lifecycle.ts (which
 * imports this one): node --test runs it.
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
  /** The client's Actions page. */
  link: string;
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

const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

function changeLines(c: ThisWeekChanges): MailLine[] {
  if (c.state === "unread") return [];
  if (c.state === "early") return ["Since your last check: changes start from your second check."];
  if (c.state === "quiet") return ["Since your last check: fewer than three checks finished in the last 7 days, so there are no changes to list."];
  if (!c.lines.length) return ["Since your last check: nothing held a change over your last checks."];
  return ["Since your last check:", ...c.lines.map((l) => `- ${end(l)}`), ...(c.more ? [`${c.more} more ${c.more === 1 ? "change is" : "changes are"} on your dashboard.`] : [])];
}

/** The email's parts, rendered by lifecycle.ts thisWeek. The footnote is the lifecycle emails' own sign-in line. */
export function thisWeekParts(d: ThisWeekData): Omit<MailParts, "footnote"> {
  const n = d.items.length;
  const week = formatDay(d.weekOf);
  return {
    tier: d.tier,
    subject: n ? `This week for ${d.domain}: ${n} ${n === 1 ? "action" : "actions"}` : `This week for ${d.domain}`,
    preheader: n ? end(d.items[0]!.title) : "Nothing is pinned for this week.",
    heading: "This week",
    body: [
      n
        ? `Your actions for the week of ${week} for ${d.domain}, most important first. Each says why it is here.`
        : `Nothing is pinned for the week of ${week} for ${d.domain}. New actions arrive as your checks find them.`,
    ],
    list: d.items.map((i) => `${SEVERITY_LABEL[i.severity]}: ${end(i.title)}${i.why ? ` Why: ${end(i.why)}` : ""}`),
    after: changeLines(d.changes),
    cta: { href: d.link, label: "Open your actions" },
  };
}
