import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { type GridConfig, type GridSummary, type MapsHit, type PointRead, summariseGrid } from "./grid.ts";

/**
 * A client's map pack grids for the dashboards host (22 Oct 2026): each grid,
 * its latest full read drawn point by point, and one summary line per read
 * day for the trend. Read with the service role, scoped to client_domain_id;
 * the page has already found the client in the session's own list.
 */

export const GRID_HISTORY_DAYS = 180;

export type GridDay = { day: string; summary: GridSummary };
export type GridView = {
  grid: GridConfig;
  /** The latest day every point was read, drawn on the heatmap; null before the first full read. */
  latest: { day: string; points: PointRead[]; summary: GridSummary } | null;
  /** Every full read in the window, oldest first. */
  days: GridDay[];
};

type PointRow = { grid_id: string; run_date: string; row_idx: number; col_idx: number; lat: number; lng: number; rank: number | null; top: MapsHit[] | null };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function absent(e: { code?: string; message: string } | null): boolean {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(e.message));
}

export async function loadGrids(clientId: string, today: string, db: SupabaseClient = supabaseAdmin()): Promise<GridView[]> {
  const { data: gridRows, error } = await db
    .from("local_grids")
    .select("id, label, keyword, gbp_cid, center_lat, center_lng, size, spacing_km, zoom, depth, cadence")
    .eq("client_domain_id", clientId)
    .eq("active", true)
    .order("created_at");
  if (error) {
    if (absent(error)) return [];
    throw new Error(`could not read the grids: ${error.message}`);
  }
  const grids = (gridRows ?? []).map((g) => ({ ...g, center_lat: Number(g.center_lat), center_lng: Number(g.center_lng), spacing_km: Number(g.spacing_km) })) as GridConfig[];
  if (!grids.length) return [];

  const rows: PointRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error: pErr } = await db
      .from("local_grid_points")
      .select("grid_id, run_date, row_idx, col_idx, lat, lng, rank, top")
      .eq("client_domain_id", clientId)
      .gte("run_date", addDays(today, -GRID_HISTORY_DAYS))
      .order("run_date")
      .order("id")
      .range(from, from + 999);
    if (pErr) throw new Error(`could not read the grid points: ${pErr.message}`);
    rows.push(...((data ?? []) as PointRow[]));
    if (!data || data.length < 1000) break;
  }

  return grids.map((grid) => {
    const byDay = new Map<string, PointRead[]>();
    for (const r of rows) {
      if (r.grid_id !== grid.id) continue;
      const list = byDay.get(r.run_date) ?? [];
      list.push({ row: r.row_idx, col: r.col_idx, lat: Number(r.lat), lng: Number(r.lng), rank: r.rank, top: Array.isArray(r.top) ? r.top : [] });
      byDay.set(r.run_date, list);
    }
    // Only full reads are drawn or trended: a half-read grid would read as a rank change that is only missing points.
    const full = [...byDay].filter(([, pts]) => pts.length >= grid.size * grid.size).sort(([a], [b]) => a.localeCompare(b));
    const days = full.map(([day, pts]) => ({ day, summary: summariseGrid(pts, grid.depth) }));
    const last = full[full.length - 1];
    return {
      grid,
      latest: last ? { day: last[0], points: [...last[1]].sort((a, b) => a.row - b.row || a.col - b.col), summary: days[days.length - 1]!.summary } : null,
      days,
    };
  });
}
