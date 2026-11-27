/**
 * When the dashboard email goes (27 Nov 2026, Danny), as one pure decision so it can be tested without a database.
 * Never two emails in the same week; new tasks and the connection reminder share one email; the reminder is at most fortnightly,
 * lists only what is missing, and stops when nothing is.
 */
export type Missing = "gsc" | "ga4" | "bing";
export function decideEmail(p: { now: number; lastEmail: number | null; lastReminder: number | null; freshTasks: number; missing: Missing[]; weekMs: number; fortnightMs: number }): { n: number; missing: Missing[] } | null {
  if (p.lastEmail !== null && p.now - p.lastEmail < p.weekMs) return null;
  const reminderDue = p.missing.length > 0 && (p.lastReminder === null || p.now - p.lastReminder >= p.fortnightMs);
  if (p.freshTasks === 0 && !reminderDue) return null;
  return { n: p.freshTasks, missing: reminderDue ? p.missing : [] };
}
