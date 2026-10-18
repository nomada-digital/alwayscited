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
