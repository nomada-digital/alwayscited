/**
 * The second source for a keyword position (Danny, 15 Nov 2026). DataForSEO, our daily read, sometimes gets a
 * degraded Google page: Volunteero, the first organic result in the UK for "volunteer management software" on
 * Ahrefs, read "not in the top 100" on 9 and 15 Nov. So a keyword that reads absent, or 10 or more places worse than
 * its last reading, is read again on Ahrefs (crosscheck.ts) - only those, to keep Ahrefs units down.
 *
 * Ahrefs' SERP lists Google's page 1 (its top 10 organic results, plus the features), from its own latest crawl of
 * that keyword. So it can confirm or correct a page-1 position; its silence means "not on page 1", never "not in the
 * top 100". Pure.
 */

export const DROP_PLACES = 10;

/** Whether a read needs the second source: absent, or DROP_PLACES or more worse than the keyword's last reading. */
export function needsCheck(position: number | null, previous: number | null | undefined): boolean {
  if (position === null) return true;
  return typeof previous === "number" && position - previous >= DROP_PLACES;
}

type AhrefsPosition = { position: number | null; url: string | null; type: unknown };

/**
 * The site's organic rank in an Ahrefs SERP, on our scale: the count of organic results down to it. Ahrefs numbers
 * every block, so an AI Overview is its position 1 and the first organic result its 2; DataForSEO's rank_group, which
 * tracking_serp holds, counts organic results only. Null when the site is not among them.
 */
export function ahrefsRank(positions: AhrefsPosition[], domain: string): { rank: number; url: string | null } | null {
  const want = domain.toLowerCase().replace(/^www\./, "");
  const seen = new Set<number>();
  for (const p of positions) {
    const types = Array.isArray(p.type) ? (p.type as unknown[]) : [p.type];
    if (!types.includes("organic") || typeof p.position !== "number") continue;
    seen.add(p.position);
    let host = "";
    try {
      host = p.url ? new URL(p.url).hostname.toLowerCase().replace(/^www\./, "") : "";
    } catch {
      host = "";
    }
    if (host && (host === want || host.endsWith(`.${want}`))) return { rank: seen.size, url: p.url };
  }
  return null;
}

export type CheckOutcome = { position: number | null; url: string | null; varies: boolean };

/**
 * The position to show when the two sources are read. Never "not ranking" while Ahrefs has the site on page 1: an
 * absent read takes Ahrefs' rank. A drop of DROP_PLACES or more that Ahrefs does not bear out (it has the site
 * DROP_PLACES or more away) takes whichever reading is nearer the keyword's last one - the better-supported of the
 * two. `varies` is the dashboard's "readings vary" note.
 */
export function decideCheck(
  read: { position: number | null; url: string | null },
  previous: number | null | undefined,
  ahrefs: { rank: number; url: string | null } | null,
): CheckOutcome {
  if (read.position === null) {
    return ahrefs ? { position: ahrefs.rank, url: ahrefs.url, varies: true } : { ...read, varies: false };
  }
  if (!ahrefs || Math.abs(ahrefs.rank - read.position) < DROP_PLACES) return { ...read, varies: false };
  const prev = typeof previous === "number" ? previous : ahrefs.rank;
  return Math.abs(ahrefs.rank - prev) < Math.abs(read.position - prev)
    ? { position: ahrefs.rank, url: ahrefs.url, varies: true }
    : { ...read, varies: true };
}
