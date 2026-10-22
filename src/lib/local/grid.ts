/**
 * Map pack geo-grids (22 Oct 2026, Danny: "we'll also need to add this to his dashboard").
 *
 * A local grid reads one keyword on Google Maps from a square of points around
 * a centre, the way BrightLocal or Local Falcon do it, because the map pack
 * moves street by street and one read from a city name says little. The
 * client's listing is matched by its Google CID, never by its name: two
 * photographers can share a name, a CID is one listing.
 *
 * Everything here is decided without a socket, so it is tested
 * (grid.test.mts). The reads are `readMapsPoint` in scan/dataforseo.ts and the
 * weekly pass is run.ts.
 */

export type GridConfig = {
  id: string;
  label: string;
  keyword: string;
  gbp_cid: string;
  center_lat: number;
  center_lng: number;
  size: number;
  spacing_km: number;
  zoom: number;
  depth: number;
  cadence: "weekly" | "monthly";
};

export type GridPoint = { row: number; col: number; lat: number; lng: number };

/** One listing in a Maps read: its place in the results, and enough to name it. */
export type MapsHit = { rank: number; title: string; cid: string | null; reviews: number | null };

/** A stored point: where the client ranked there (null: not inside depth) and the top three. */
export type PointRead = GridPoint & { rank: number | null; top: MapsHit[] };

const KM_PER_DEGREE = 111.32;

/**
 * The points of a size x size grid, row 0 the northernmost and col 0 the
 * westernmost, spacing_km apart. Longitude degrees shrink towards the poles,
 * so the east-west step is divided by cos(latitude): a 5 km step is 5 km on
 * the ground in York as in Madrid. Rounded to 5 decimals, about a metre.
 */
export function gridPoints(g: Pick<GridConfig, "center_lat" | "center_lng" | "size" | "spacing_km">): GridPoint[] {
  const size = Math.trunc(g.size);
  if (size < 1 || size % 2 === 0) throw new Error(`grid size must be odd, got ${g.size}`);
  const half = (size - 1) / 2;
  const dLat = Number(g.spacing_km) / KM_PER_DEGREE;
  const dLng = Number(g.spacing_km) / (KM_PER_DEGREE * Math.cos((g.center_lat * Math.PI) / 180));
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  const out: GridPoint[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      out.push({ row, col, lat: round(g.center_lat + (half - row) * dLat), lng: round(g.center_lng + (col - half) * dLng) });
    }
  }
  return out;
}

/**
 * The listings in a Google Maps SERP result, in order. Only `maps_search`
 * items count: a `maps_paid_item` is an ad, and an ad is not a ranking.
 * Anything without a numeric rank_group is dropped rather than guessed at.
 */
export function parseMapsResult(result: unknown): MapsHit[] {
  const items = (result as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  const out: MapsHit[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    if (it?.type !== "maps_search" || typeof it.rank_group !== "number") continue;
    const votes = (it.rating as { votes_count?: unknown } | null | undefined)?.votes_count;
    out.push({
      rank: it.rank_group,
      title: typeof it.title === "string" ? it.title : "",
      cid: typeof it.cid === "string" && it.cid ? it.cid : null,
      reviews: typeof votes === "number" ? votes : null,
    });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** Where the listing with this CID ranks, or null when it is not in the results. */
export function rankOfCid(hits: MapsHit[], cid: string): number | null {
  return hits.find((h) => h.cid === cid)?.rank ?? null;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * Whether a grid is read today. Weekly: 7 days after its last full read;
 * monthly: 28. A grid never fully read is due, so a read cut short by the
 * run's budget is tried again the next morning rather than left half-drawn.
 */
export function gridDue(cadence: GridConfig["cadence"], lastFullDay: string | null, today: string): boolean {
  if (!lastFullDay) return true;
  return daysBetween(lastFullDay, today) >= (cadence === "monthly" ? 28 : 7);
}

/** The latest day on which every point of the grid was read, from the days and counts stored. */
export function lastFullDay(counts: { run_date: string; points: number }[], size: number): string | null {
  const full = counts.filter((c) => c.points >= size * size).map((c) => c.run_date).sort();
  return full.length ? full[full.length - 1]! : null;
}

export type GridSummary = {
  points: number;
  /** Points where the listing is in the pack, ranks 1-3. */
  inPack: number;
  /** Points where it shows at all, inside depth. */
  found: number;
  /** Mean rank, counting a point outside depth as depth + 1 - so a listing nowhere reads as worse than depth, never as no figure. */
  avgRank: number | null;
  /** Who holds the pack across the grid: each listing's count of top-3 appearances, most first. */
  owners: { title: string; cid: string | null; points: number; reviews: number | null }[];
};

export function summariseGrid(reads: Pick<PointRead, "rank" | "top">[], depth: number): GridSummary {
  const points = reads.length;
  const found = reads.filter((r) => r.rank !== null).length;
  const inPack = reads.filter((r) => r.rank !== null && r.rank <= 3).length;
  const avgRank = points ? Math.round((reads.reduce((s, r) => s + (r.rank ?? depth + 1), 0) / points) * 10) / 10 : null;
  const tally = new Map<string, { title: string; cid: string | null; points: number; reviews: number | null }>();
  for (const r of reads) {
    for (const h of r.top.slice(0, 3)) {
      const key = h.cid ?? `title:${h.title}`;
      const t = tally.get(key) ?? { title: h.title, cid: h.cid, points: 0, reviews: h.reviews };
      t.points += 1;
      tally.set(key, t);
    }
  }
  const owners = [...tally.values()].sort((a, b) => b.points - a.points || a.title.localeCompare(b.title));
  return { points, inPack, found, avgRank, owners };
}

/** The colour band a rank falls in on the heatmap: 1-3 the pack, 4-10, 11-depth, and not found. */
export function rankBand(rank: number | null): "pack" | "near" | "far" | "none" {
  if (rank === null) return "none";
  if (rank <= 3) return "pack";
  if (rank <= 10) return "near";
  return "far";
}
