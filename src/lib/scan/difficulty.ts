import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { recordUnits, unitsLeft } from "@/lib/csm/usage";

import { normalizeDomain } from "./domain";
import { type Listing, scoreDifficulty } from "./placement-difficulty";

/**
 * Scores every placeable source on a scan for how hard it is to land -
 * Danny, 25 September 2026. The rule is `placement-difficulty.ts`; this is the
 * half that reads the marketplace and writes the rows.
 *
 * One batched Fatgrid call per scan (`search-domains`, up to 500 domains in a
 * request), keyed on `FATGRID_API_KEY` from the environment and nowhere else.
 * No key, a failed call, or a database without the 20260925000000 columns all
 * end the same way: nothing is written, the report shows "Not scored", and the
 * scan is untouched. Never fatal, by construction - the caller catches too.
 *
 * Fatgrid bills in units (one per domain returned) on the lower plans, so the
 * domains sent are capped at `MAX_DOMAINS`, which is several times the number
 * of placeable sources a real scan has produced.
 */

const FATGRID = "https://api.fatgrid.com/api/public/search-domains";
export const MAX_DOMAINS = 80;

/** The marketplace read. Null means "could not ask", which is not "not listed". */
export async function readListings(domains: string[]): Promise<Map<string, Listing> | null> {
  const key = process.env.FATGRID_API_KEY;
  if (!key || !domains.length) return null;
  try {
    const res = await fetch(FATGRID, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ search: domains.slice(0, MAX_DOMAINS).join(",") }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[scan] placement difficulty: marketplace answered ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { items?: { url?: string; bestPrice?: number | string | null; dr?: number | string | null }[] };
    const out = new Map<string, Listing>();
    for (const item of body.items ?? []) {
      if (!item.url) continue;
      const domain = normalizeDomain(item.url);
      const price = item.bestPrice === null || item.bestPrice === undefined ? null : Number(item.bestPrice);
      const dr = item.dr === null || item.dr === undefined ? null : Number(item.dr);
      out.set(domain, {
        price: price !== null && Number.isFinite(price) ? price : null,
        dr: dr !== null && Number.isFinite(dr) ? dr : null,
      });
    }
    return out;
  } catch (err) {
    console.warn(`[scan] placement difficulty: marketplace read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Score and store. Returns how many rows were scored, for the log. */
export async function scoreScanDifficulty(scanId: string): Promise<number> {
  const db = supabaseAdmin();
  const rows = await selectAll<{ domain: string; kind: string; on_topic: boolean | null }>((from, to) =>
    db
      .from("scan_sources")
      .select("domain, kind, on_topic")
      .eq("scan_id", scanId)
      .in("kind", ["placement", "review"])
      .order("id", { ascending: true })
      .range(from, to),
  );
  const placeable = rows.filter((r) => r.on_topic !== false);
  if (!placeable.length) return 0;

  // Units are the bill on the Pro plan (5 Nov 2026): the scan stays within the month's Fatgrid cap, shared with the
  // agency shortlist, and records what it spends. Past the cap a scan's placements read "Not scored", as with no key.
  const left = await unitsLeft(db);
  if (left < 1) {
    console.warn(`[scan] placement difficulty skipped for ${scanId}: the month's Fatgrid units are used`);
    return 0;
  }
  const listings = await readListings(placeable.slice(0, left).map((r) => r.domain));
  if (!listings) return 0;
  await recordUnits(db, { source: "scan_difficulty", units: listings.size });

  const scored = placeable.slice(0, MAX_DOMAINS).map((r) => {
    const d = scoreDifficulty({ listing: listings.get(r.domain) ?? null, kind: r.kind });
    return { scan_id: scanId, domain: r.domain, kind: r.kind, difficulty: d.score, difficulty_basis: d.basis };
  });
  const { error } = await db.from("scan_sources").upsert(scored, { onConflict: "scan_id,domain" });
  if (error) {
    console.warn(`[scan] placement difficulty not stored for ${scanId}: ${error.message}`);
    return 0;
  }
  return scored.length;
}
