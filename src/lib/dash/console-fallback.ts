/**
 * Search Console as the rankings fallback (Danny, 16 Nov 2026: DataForSEO reads are unreliable). When the live read failed, found
 * nothing or disagreed with the cross-check, and Search Console has an average position for the search and page, that is shown instead,
 * labelled with the days it covers. Null when the live read stands. Pure, so a test can read it.
 *
 * 27 Nov 2026: an average over a handful of impressions is not a position worth showing ("84" on Common's Yorkshire keyword was
 * one impression), so it needs CONSOLE_FALLBACK_MIN_IMPRESSIONS.
 */
export const CONSOLE_FALLBACK_MIN_IMPRESSIONS = 5;
export function consoleFallback(p: { pos: number | null; read?: boolean; varies?: boolean; gsc?: { pos: number | null; impr: number } | null }): number | null {
  const doubtful = p.read === false || p.pos === null || !!p.varies;
  return doubtful && p.gsc && p.gsc.pos != null && p.gsc.impr >= CONSOLE_FALLBACK_MIN_IMPRESSIONS ? Math.round(p.gsc.pos) : null;
}
