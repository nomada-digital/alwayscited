/**
 * Sample Search Console and Bing figures, for a client with no console
 * connected who asks to see what the columns will hold (the "Preview with
 * sample data" switch on a cluster). Ported from the Nomada prototype's
 * mock_query (nomada-dashboards generators/cluster_view.py, 17 Oct 2026).
 *
 * Never real and never mixed with real rows: model.ts uses these only when
 * the switch is on AND no console row exists, and every surface that draws
 * them says "Sample" beside them. Deterministic per keyword, so a reload does
 * not reshuffle the numbers.
 */

import type { ConsoleFig } from "./types.ts";

/** FNV-1a, 32-bit: stable across server and browser, unlike anything seeded by time. */
function h(s: string, n: number): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x % n;
}

const CTR: Record<number, number> = { 1: 0.28, 2: 0.155, 3: 0.1, 4: 0.072, 5: 0.053, 6: 0.04, 7: 0.031, 8: 0.025, 9: 0.021, 10: 0.018 };

export function sampleConsole(k: string, vol: number | null, pos: number | null, engine: "gsc" | "bing"): ConsoleFig | null {
  if (pos === null || !vol) return null;
  const reach = pos <= 10 ? 1 : pos <= 20 ? 0.32 : pos <= 50 ? 0.07 : 0.012;
  let impr = vol * reach * (0.75 + h(k + engine, 50) / 100);
  let p = Math.max(1, pos + (h(`${k}p${engine}`, 31) - 15) / 10);
  if (engine === "bing") {
    impr *= 0.09 + h(`${k}b`, 6) / 100;
    p = Math.max(1, p + (h(`${k}bp`, 7) - 3));
  }
  const ctr = CTR[Math.round(p)] ?? (p <= 20 ? 0.006 : 0.0015);
  const imprN = Math.round(impr);
  if (imprN === 0) return null;
  const clicks = Math.round(imprN * ctr);
  return { clicks, impr: imprN, ctr: clicks / imprN, pos: Math.round(p * 10) / 10 };
}
