import type { UpsellMode } from "../../tracking/ask.ts";
import { type Day, formatDay } from "../../tracking/figures.ts";

/**
 * The read-only Placements group at the foot of the Actions list on placed
 * tiers (13 Oct 2026, DIY P3; spec 10 sections 2.2 and 4.6). Pure.
 *
 * The owner is "nomada digital", or "Your account contact" in agency mode:
 * the white-label fence (section 1.2) - in agency mode the app never names
 * Nomada. `off` mode is Nomada's own account with no upgrade prompts, so it
 * names Nomada as nomada mode does.
 */

export const NOMADA_OWNER = "nomada digital";
export const AGENCY_OWNER = "Your account contact";

export function ownerLabel(mode: UpsellMode): string {
  return mode === "agency" ? AGENCY_OWNER : NOMADA_OWNER;
}

export type PlacementGroupRow = { id: string; page: string; cluster: string | null; when: string };

/** Live placements newest first, then scheduled ones soonest first; nothing pitched, being written or removed. */
export function placementsGroup(rows: readonly { id: string; cluster_id: string; url_key: string; url: string; status: string; scheduled_on: Day | null; live_on: Day | null }[], clusterNames: ReadonlyMap<string, string>): PlacementGroupRow[] {
  const live = rows.filter((r) => r.status === "live").sort((a, b) => (b.live_on ?? "").localeCompare(a.live_on ?? ""));
  const scheduled = rows.filter((r) => r.status === "scheduled").sort((a, b) => (a.scheduled_on ?? "9999").localeCompare(b.scheduled_on ?? "9999"));
  return [...live, ...scheduled].map((r) => ({
    id: r.id,
    page: r.url_key || r.url,
    cluster: clusterNames.get(r.cluster_id) ?? null,
    when: r.status === "live" ? (r.live_on ? `Live since ${formatDay(r.live_on)}` : "Live") : r.scheduled_on ? `Scheduled for ${formatDay(r.scheduled_on)}` : "Scheduled",
  }));
}
