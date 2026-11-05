import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildShortlist } from "./shortlist";
import { unitsLeft } from "./usage";

/**
 * The shortlist's automatic runs (5 Nov 2026), from the 03:45 UTC cron. A client route may not reach the agency code
 * (csm-isolation.test.mts), so onboarding and a keyword change are found here the next night rather than at the moment:
 * - onboarded: a live cluster on a paying placements client that has never had a run;
 * - cluster_changed: the same, on a client that has had runs before (a keyword change makes a new cluster);
 * - month_end: on the 1st, every live cluster whose last run is from before the month.
 * Never past the cap: each run is cut to what the month has left, and the night stops when nothing is left or after
 * MAX_RUNS_A_NIGHT. Kev runs one by hand from the agency view whenever he likes, inside the same caps.
 */
export const MAX_RUNS_A_NIGHT = 6;

export async function autoShortlists(db: SupabaseClient, now = new Date()): Promise<{ runs: string[]; skipped: string | null }> {
  const runs: string[] = [];
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const firstOfMonth = now.getUTCDate() === 1;
  const { data: paying, error: pErr } = await db.from("orders").select("client_domain_id").not("client_domain_id", "is", null);
  if (pErr) throw new Error(`could not read the paying clients: ${pErr.message}`);
  const payingIds = [...new Set((paying ?? []).map((o) => o.client_domain_id as string))];
  if (!payingIds.length) return { runs, skipped: null };
  const { data: clients, error: cErr } = await db.from("client_domains").select("id, domain").in("id", payingIds).eq("status", "active").is("archived_at", null).in("tier", ["mentioned", "cited"]);
  if (cErr) throw new Error(`could not read the clients: ${cErr.message}`);
  for (const client of clients ?? []) {
    const [{ data: clusters, error: kErr }, { data: last, error: rErr }] = await Promise.all([
      db.from("tracked_clusters").select("id").eq("client_domain_id", client.id).is("stopped_on", null),
      db.from("shortlist_runs").select("cluster_id, created_at").eq("client_domain_id", client.id).order("created_at", { ascending: false }).limit(200),
    ]);
    if (kErr ?? rErr) throw new Error(`could not read ${client.domain}'s clusters or runs: ${(kErr ?? rErr)!.message}`);
    const latest = new Map<string, string>();
    for (const r of last ?? []) if (r.cluster_id && !latest.has(r.cluster_id as string)) latest.set(r.cluster_id as string, r.created_at as string);
    for (const c of clusters ?? []) {
      const ran = latest.get(c.id as string);
      const reason = !ran ? ((last ?? []).length ? "cluster_changed" : "onboarded") : firstOfMonth && ran < monthStart ? "month_end" : null;
      if (!reason) continue;
      if (runs.length >= MAX_RUNS_A_NIGHT) return { runs, skipped: `stopped at ${MAX_RUNS_A_NIGHT} runs a night` };
      if ((await unitsLeft(db)) < 1) return { runs, skipped: "the month's Fatgrid units are used" };
      const r = await buildShortlist(db, { clientId: client.id as string, clusterId: c.id as string, reason });
      runs.push(`${client.domain} ${reason}: ${r.outcome}, ${r.items.length} items, ${r.units} units`);
      if (r.outcome === "no_key") return { runs, skipped: "FATGRID_API_KEY is not set" };
    }
  }
  return { runs, skipped: null };
}
