import { APP_PREFIX } from "../lib/app-host.ts";
import { DASH_PREFIX, isDashHost } from "../lib/dash/host.ts";

/**
 * Google Analytics 4 on the marketing site (Danny, 15 Oct 2026, in chat: full
 * GA4 behind a cookie consent banner, replacing /legal's old promise of no
 * third-party analytics).
 *
 * The measurement id is public - it is printed into every page that loads
 * gtag.js - so it is a constant here and not an environment variable. That is
 * also what keeps it out of the readiness census: nothing about the product is
 * unready without it.
 *
 * Set to the property's web stream id on 17 Oct 2026 (Danny). `gaIdValid` is
 * still the one gate: with a placeholder here the browser never requests
 * gtag.js and the webhook never posts to the Measurement Protocol.
 */
export const GA_MEASUREMENT_ID = "G-JRTF9CFF18";

/** What a GA4 web stream id looks like. A placeholder such as "G-PENDING_SETUP" deliberately does not. */
export const GA_ID_PATTERN = /^G-[A-Z0-9]{6,}$/;

export function gaIdValid(id: string = GA_MEASUREMENT_ID): boolean {
  return GA_ID_PATTERN.test(id);
}

/** Where the visitor's choice is kept, per browser. 'accepted' or 'declined'; absent means not asked yet. */
export const CONSENT_KEY = "ac-consent";

export type ConsentChoice = "accepted" | "declined";

/**
 * GA4 event names this site sends, in one place so a rename is one edit.
 * `generate_lead`, `begin_checkout` and `purchase` are GA4's recommended
 * names; the rest are ours.
 */
export const GA_EVENTS = [
  "free_scan_start",
  // A free scan a partner site handed over, by its ref (19 Oct 2026).
  "scan_started",
  "free_scan_complete",
  "scan_confirmed",
  "free_scan_email",
  "generate_lead",
  "coverage_check_start",
  "begin_checkout",
  "select_plan",
  "book_call_click",
  "email_click",
  "nomada_click",
] as const;

export type GaEvent = (typeof GA_EVENTS)[number];

/**
 * The page a GA4 event happened on, as a short label rather than a URL. Every
 * event carries one, so a report can be cut by page type without sending
 * paths that hold a scan token.
 */
export type PageType =
  | "home"
  | "plan"
  | "packages"
  | "scan"
  | "coverage"
  | "blog"
  | "checkout"
  | "contact"
  | "agency"
  | "legal"
  | "other";

const PLAN_PATHS = ["/alwaystracked", "/alwaysmentioned", "/alwayscited", "/alwayseverywhere"];
const AGENCY_PATHS = ["/seo-agencies", "/pr-agencies", "/white-label"];

const under = (path: string, base: string) => path === base || path.startsWith(base + "/");

export function pageType(pathname: string | null | undefined): PageType {
  const p = (pathname ?? "").split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  if (PLAN_PATHS.some((b) => under(p, b))) return "plan";
  if (under(p, "/packages")) return "packages";
  if (under(p, "/scan") || under(p, "/llm-visibility-checker")) return "scan";
  if (under(p, "/coverage-check")) return "coverage";
  if (under(p, "/blog")) return "blog";
  if (under(p, "/checkout")) return "checkout";
  if (under(p, "/contact")) return "contact";
  if (AGENCY_PATHS.some((b) => under(p, b))) return "agency";
  if (under(p, "/legal")) return "legal";
  return "other";
}

/** Query parameters GA needs for campaign attribution. Every other one is dropped before a URL reaches GA. */
const KEPT_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "gclid", "gbraid", "wbraid"];

/**
 * A URL as GA may see it. Paths here carry capability tokens - a scan report
 * at /scan/<token>, a campaign reading at /coverage-check/<token> - and query
 * strings carry a scanned domain (/scan?domain=) or a Stripe session id
 * (/checkout/done?session=). A token is a key to somebody's report, and a
 * domain can name a business, so neither leaves the page: any long opaque
 * path segment becomes `:token`, and only the attribution parameters above
 * survive. The hash goes too.
 */
export function gaSafeUrl(href: string): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return "";
  }
  const path = u.pathname
    .split("/")
    // A token is long, unhyphenated and mixes digits and letters; a blog slug
    // ("ai-visibility-2026") is hyphenated, so it is kept.
    .map((s) =>
      /^[0-9a-f]{32,}$/i.test(s) || (/^[A-Za-z0-9_]{16,}$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s)) ? ":token" : s,
    )
    .join("/");
  const kept = new URLSearchParams();
  for (const k of KEPT_PARAMS) {
    const v = u.searchParams.get(k);
    if (v) kept.set(k, v);
  }
  const q = kept.toString();
  return `${u.origin}${path}${q ? `?${q}` : ""}`;
}

/**
 * The dashboard, on the marketing host. GA never runs there and the banner never shows.
 * 17 Oct 2026: /dashboards too - the dashboards host's tree, which the marketing host serves to a signed-in member.
 */
export function isDashboardPath(pathname: string | null | undefined): boolean {
  const p = pathname ?? "";
  return [APP_PREFIX, "/admin", DASH_PREFIX].some((base) => p === base || p.startsWith(`${base}/`));
}

/**
 * dashboards.alwayscited.com (17 Oct 2026): every path on it is a client's dashboard - its sign-in, a client's pages
 * and the /demo/ links - so the host alone decides, whatever the path. GA never runs there and the banner never shows.
 */
export function isDashboardHost(host: string | null | undefined): boolean {
  return isDashHost(host);
}
