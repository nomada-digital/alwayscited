/**
 * How long a client's data is kept after its plan ends (Danny, 18 Oct 2026: "customer data should be kept for
 * 90 days"). While it is kept the dashboard stays open, read-only (member.ts writeRole); after it, the nightly
 * retention pass (retention-purge.ts) deletes that client's tracking data and profile - once
 * app_settings.retention_purge_enabled is switched on. Leads, scans and the order and Stripe records stay.
 *
 * The clock starts at client_domains.ended_at, which a trigger sets whenever a client becomes ended and clears if
 * it comes back (migration 20261018040000). Pure: the banner, the plan page, the legal page and the purge read it.
 */
export const RETENTION_DAYS = 90;

/** The last day an ended client's data is kept: ended_at + RETENTION_DAYS, as a UTC calendar day; null when the end is unknown. */
export function keptUntil(endedAt: string | null | undefined, days: number = RETENTION_DAYS): string | null {
  if (!endedAt) return null;
  const at = Date.parse(endedAt);
  if (!Number.isFinite(at)) return null;
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whether an ended client's kept period is over at `now`: strictly after its last kept day. Never for a client that is not ended. */
export function purgeDue(c: { status: string | null; ended_at: string | null }, now: number, days: number = RETENTION_DAYS): boolean {
  if (c.status !== "ended") return false;
  const last = keptUntil(c.ended_at, days);
  return last !== null && now >= Date.parse(`${last}T00:00:00Z`) + 86_400_000;
}
