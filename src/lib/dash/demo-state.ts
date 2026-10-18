/**
 * A demo link's plan state (17 Oct 2026): the client's real readings, drawn
 * as if it were on another plan, so each plan's experience can be reviewed on
 * real data before it ships. Applied to the rows in memory only, on a demo
 * request only; nothing is written. Paid states get sample placements, every
 * one marked `sample` so the page labels it - no such placement exists.
 */

import type { DemoState } from "./host.ts";
import type { Raw, RawPlacement, TierKey } from "./types.ts";

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function samples(clusterId: string, today: string, tier: TierKey): RawPlacement[] {
  const month = `${today.slice(0, 7)}-`;
  const day = (n: number) => `${month}${String(Math.min(n, Number(today.slice(8, 10)))).padStart(2, "0")}`;
  const row = (i: number, kind: RawPlacement["kind"], status: RawPlacement["status"], live: string | null): RawPlacement => ({
    id: `sample-${i}`,
    sample: true,
    cluster_id: clusterId,
    kind,
    url: `https://sample-${i}.example/`,
    domain: `sample-${i}.example`,
    status,
    scheduled_on: live ? null : addDays(today, 5),
    live_on: live,
    anchor_text: null,
  });
  const out = [row(1, "guest_post", "live", day(4)), row(2, "guest_post", "live", day(9)), row(3, "guest_post", "writing", null)];
  if (tier === "cited" || tier === "everywhere") out.push(row(4, "link_insertion", "live", day(6)), row(5, "link_insertion", "scheduled", null), row(6, "on_site", "live", day(2)));
  if (tier === "everywhere") out.push(row(7, "coverage", "pitched", null));
  return out;
}

export function demoAs(raw: Raw, state: DemoState | null): Raw {
  if (!state) return raw;
  const tier: TierKey = state === "tracked-trial" ? "tracked" : state;
  const client = {
    ...raw.client,
    tier,
    trial_ends_at: state === "tracked-trial" ? `${addDays(raw.today, 6)}T12:00:00Z` : null,
    payment_status: state === "tracked-trial" ? null : "active",
  };
  if (tier === "tracked") return { ...raw, client, clusters: raw.clusters.map((c) => ({ ...c, tier: "tracked" })), placements: [] };
  const first = raw.clusters.filter((c) => c.stopped_on === null).sort((a, b) => a.started_on.localeCompare(b.started_on))[0];
  return {
    ...raw,
    client,
    clusters: raw.clusters.map((c) => (c.id === first?.id ? { ...c, tier } : { ...c, tier: "tracked" })),
    placements: first ? [...raw.placements, ...samples(first.id, raw.today, tier)] : raw.placements,
  };
}
