import { SCAN_LIMITS } from "../../config/contact.ts";

/**
 * A scan handed over from a partner site (18 Oct 2026): nomadadigital.co.uk's
 * scan box GETs alwayscited.com/scan?domain=...&ref=nomada&market=uk. The page
 * starts the scan itself (LiveScanChecker autoStart) and the start route keeps
 * `ref` on the scan, so these leads can be routed to the alwayscited side.
 * Both values come from a URL anyone can type, so each is checked here and
 * dropped, never trusted, when it does not fit. Pure; the page, the checker and
 * the route all use these.
 */

/** A ref is a short lowercase code - letters, digits, '-' and '_' - or nothing. scans.ref's check is the same. */
export const SCAN_REF_PATTERN = new RegExp(`^[a-z0-9][a-z0-9_-]{0,${SCAN_LIMITS.ref - 1}}$`);

export function scanRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const r = raw.trim().toLowerCase();
  return r.length <= SCAN_LIMITS.ref && SCAN_REF_PATTERN.test(r) ? r : null;
}

/** UK or US in any case ("uk" is what the partner form sends), else nothing - the start route then picks the market itself. */
export function handoffMarket(raw: unknown): "UK" | "US" | null {
  const m = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return m === "UK" || m === "US" ? m : null;
}

/**
 * Partners whose hand-off may start a scan by itself, and the hosts their visitors arrive from (19 Oct 2026).
 *
 * The 20 Sep rule was that a GET to /scan never starts a paid scan, because crawlers follow GETs. The hand-off has to
 * break that rule for nomadadigital.co.uk ("one entry and one click", Danny, 18 Oct), and this is how far it breaks
 * it: a known ref AND that partner's own Referer AND a plausible domain, then Turnstile as for a press. A crawler sends
 * no Referer and a link pasted anywhere else carries the wrong one, so both get the prefilled step 1 form instead.
 * The site's own scan cards are unaffected: with JavaScript they start in place and never GET /scan.
 */
export const HANDOFF_PARTNERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["nomada", ["nomadadigital.co.uk", "www.nomadadigital.co.uk"]],
]);

export function handoffMayStart(ref: string | null, referer: string | null | undefined): boolean {
  const hosts = ref ? HANDOFF_PARTNERS.get(ref) : undefined;
  if (!hosts || !referer) return false;
  try {
    return hosts.includes(new URL(referer).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The campaign tags a partner's page was opened with, kept by name, trimmed and capped. Anything else is dropped. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

export function cleanUtm(input: unknown): Utm | null {
  if (!input || typeof input !== "object") return null;
  const out: Utm = {};
  for (const k of UTM_KEYS) {
    const raw = (input as Record<string, unknown>)[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, SCAN_LIMITS.utm);
  }
  return Object.keys(out).length ? out : null;
}
