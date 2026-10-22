import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readMapsPoint } from "@/lib/scan/dataforseo";

import { type GridConfig, type PointRead, gridDue, gridPoints, lastFullDay } from "./grid.ts";

/**
 * The weekly map pack pass (22 Oct 2026), run inside a client's daily tracking
 * run (tracking/runner.ts) after the keyword positions are stored. Each active
 * grid that is due (grid.ts gridDue) has every point read on Google Maps at
 * once, and the points that came back are stored in local_grid_points.
 *
 * Never fatal and never on a re-run: the run's own reads are already paid for
 * and stored, so a grid that fails is logged and tried again the next morning
 * (a grid with no full read is still due). A grid is only started with time
 * left for it, so it is not cut off half-read by the function ceiling.
 */

/** Read alongside the run's other reads: a 25-point grid is one wave. */
const GRID_CONCURRENCY = 25;
/** What a grid needs left in the run to start: one Maps read is documented at up to a minute. */
const GRID_MIN_MS = 45_000;
const LOOKBACK_DAYS = 35;

type GridRow = Omit<GridConfig, "cadence"> & { cadence: string; active: boolean };

export type GridPassResult = { grids: number; read: number; failed: number; cost: number };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A missing table reads as no grids: the migration landing after a deploy changes nothing. */
function absent(e: { code?: string; message: string } | null): boolean {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(e.message));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function runLocalGrids(
  db: SupabaseClient,
  args: { clientId: string; runId: string; day: string; remainingMs: () => number; billed: (err: unknown) => number },
): Promise<GridPassResult> {
  const result: GridPassResult = { grids: 0, read: 0, failed: 0, cost: 0 };
  const { data, error } = await db
    .from("local_grids")
    .select("id, label, keyword, gbp_cid, center_lat, center_lng, size, spacing_km, zoom, depth, cadence, active")
    .eq("client_domain_id", args.clientId)
    .eq("active", true);
  if (error) {
    if (absent(error)) return result;
    throw new Error(`could not read the grids: ${error.message}`);
  }
  const grids = (data ?? []) as GridRow[];
  if (!grids.length) return result;

  const { data: dayRows, error: dayErr } = await db
    .from("local_grid_points")
    .select("grid_id, run_date")
    .eq("client_domain_id", args.clientId)
    .gte("run_date", addDays(args.day, -LOOKBACK_DAYS))
    .limit(5000);
  if (dayErr) throw new Error(`could not read the grid history: ${dayErr.message}`);

  for (const g of grids) {
    const cadence = g.cadence === "monthly" ? "monthly" : "weekly";
    const counts = new Map<string, number>();
    for (const r of (dayRows ?? []) as { grid_id: string; run_date: string }[]) {
      if (r.grid_id === g.id) counts.set(r.run_date, (counts.get(r.run_date) ?? 0) + 1);
    }
    const last = lastFullDay([...counts].map(([run_date, points]) => ({ run_date, points })), g.size);
    if (!gridDue(cadence, last, args.day)) continue;
    if (args.remainingMs() < GRID_MIN_MS) {
      console.warn(`[track] ${args.runId} grid "${g.label}": not started, ${Math.round(args.remainingMs() / 1000)}s left - tried again tomorrow`);
      continue;
    }
    result.grids += 1;
    const points = gridPoints({ center_lat: Number(g.center_lat), center_lng: Number(g.center_lng), size: g.size, spacing_km: Number(g.spacing_km) });
    const reads = await mapLimit(points, GRID_CONCURRENCY, async (p): Promise<(PointRead & { cost: number }) | null> => {
      try {
        const r = await readMapsPoint(g.keyword, p, { zoom: g.zoom, depth: g.depth, cid: g.gbp_cid }, args.remainingMs());
        result.cost += r.cost;
        return { ...p, rank: r.rank, top: r.hits.slice(0, 3), cost: r.cost };
      } catch (err) {
        result.cost += args.billed(err);
        result.failed += 1;
        return null;
      }
    });
    const rows = reads
      .filter((r): r is PointRead & { cost: number } => r !== null)
      .map((r) => ({
        grid_id: g.id,
        client_domain_id: args.clientId,
        run_id: args.runId,
        run_date: args.day,
        row_idx: r.row,
        col_idx: r.col,
        lat: r.lat,
        lng: r.lng,
        rank: r.rank,
        depth: g.depth,
        top: r.top,
        cost: Number(r.cost.toFixed(4)),
      }));
    result.read += rows.length;
    if (rows.length) {
      const { error: wErr } = await db.from("local_grid_points").upsert(rows, { onConflict: "grid_id,run_date,row_idx,col_idx" });
      if (wErr) throw new Error(`could not store grid "${g.label}": ${wErr.message}`);
    }
    console.log(`[track] ${args.runId} grid "${g.label}": ${rows.length} of ${points.length} points read`);
  }
  return result;
}
