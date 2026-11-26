/**
 * A link's stage as the customer sees it (26 Nov 2026): `state`, our own column - set by staff ("Mark as live" in the
 * agency view) and by the daily audit's reading - first, and the sheet's free-text `status` only where `state` is
 * empty. Until today the page read the sheet's status alone and `state`, which the migration that added it calls
 * "what the client view shows", was never read. Pure, no imports.
 */
export type Stage = "live" | "progress" | "off";

export const STATES = ["in_progress", "in_review", "live", "removed"] as const;
export type LinkState = (typeof STATES)[number];

/** The sheet's own status, in three plain stages (17 Nov 2026, Danny): live, not live (lost, removed, declined...) or in progress. */
export function stageOfStatus(status: string | null): Stage {
  const s = (status ?? "").trim();
  if (/^(live|published|indexed|done|complete[d]?)\b/i.test(s)) return "live";
  if (/\b(lost|removed|deleted|declined|rejected|cancel(l)?ed|dropped|dead|not live)\b/i.test(s)) return "off";
  return "progress";
}

/** The stage to show: our state when it is set, else the sheet's status; null when the row has neither. */
export function stageOf(row: { state?: string | null; status: string | null }): Stage | null {
  if (row.state === "live") return "live";
  if (row.state === "removed") return "off";
  if (row.state === "in_progress" || row.state === "in_review") return "progress";
  return row.status ? stageOfStatus(row.status) : null;
}
