/**
 * Google's redirect links back to the page they point at (27 Nov 2026; the hub's goto_resolve.py does the same).
 *
 * Most organic results now come back from DataForSEO as google.co.uk/goto?url=<encrypted token>, with the site only in the
 * breadcrumb. The breadcrumb shows page titles ("Blog"), not the path, so a URL built from it is a guess: "expression37.co.uk/Blog",
 * "https://craftcms.com/". The token cannot be decoded, but www.google.com/goto answers it with one 302 to the real page. This asks
 * for that redirect and reads its Location; it never fetches the target. Plain /url?q=<url> links carry the target in the link.
 * Nothing here is billed. A result that cannot be resolved stays unknown (null), never invented.
 */
export const GOTO = /^https?:\/\/(www\.)?google\.[a-z.]+\/(goto|url)\?/i;

export const isGoto = (url: string | null | undefined): boolean => !!url && GOTO.test(url);

const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const httpUrl = (u: string) => /^https?:\/\//i.test(u);
const notGoogle = (u: string) => !/(^|\.)google\.[a-z.]+$/.test(hostOf(u));

/** The target when the link carries it plainly (/url?q=https://...), else null. */
export function plainTarget(url: string): string | null {
  try {
    const q = new URL(url).searchParams;
    const t = q.get("q") ?? q.get("url") ?? "";
    return httpUrl(t) && notGoogle(t) ? t : null;
  } catch {
    return null;
  }
}

/** One redirect, asked of www.google.com/goto. Null when it does not answer with a page of another site. */
export async function resolveGoto(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 6_000): Promise<string | null> {
  if (!isGoto(url)) return url;
  const plain = plainTarget(url);
  if (plain) return plain;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  u.protocol = "https:";
  u.hostname = "www.google.com";
  try {
    const res = await fetchImpl(u.toString(), { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Mozilla/5.0 (compatible; alwayscited-rank/1.0)" }, cache: "no-store" });
    const loc = res.headers.get("location") ?? "";
    return res.status >= 300 && res.status < 400 && httpUrl(loc) && notGoogle(loc) ? loc : null;
  } catch {
    return null;
  }
}

/**
 * A resolver with a ceiling on the lookups a run makes, and a memory so one link is asked once.
 *
 * Google answers a quick run of these with a "checking" page instead of the redirect (seen 27 Nov 2026 after four or five in a burst),
 * so lookups are spaced `paceMs` apart, and after two answers in a row that were not a redirect the run stops asking: a throttle is
 * respected, never worked around. What was not resolved stays unknown (null), and the page shows the site without a path.
 */
export function limitedResolver(max: number, fetchImpl: typeof fetch = fetch, paceMs = 1_500): (url: string) => Promise<string | null> {
  let used = 0;
  let misses = 0;
  const seen = new Map<string, string | null>();
  return async (url) => {
    if (seen.has(url)) return seen.get(url)!;
    const plain = isGoto(url) ? plainTarget(url) : url;
    if (plain) return plain;
    if (used >= max || misses >= 2) return null;
    if (used > 0 && paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
    used += 1;
    const t = await resolveGoto(url, fetchImpl);
    misses = t ? 0 : misses + 1;
    seen.set(url, t);
    return t;
  };
}
