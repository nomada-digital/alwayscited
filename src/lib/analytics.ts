/**
 * The consent module: the one place an event leaves this site, and the one
 * owner of `window.dataLayer`, the visitor's choice and the GA cookies.
 *
 * ## What changed on 15 October 2026
 *
 * Until then /legal promised "no Google Analytics, no tag manager, and no
 * advertising pixel", and this file kept the promise by refusing to create the
 * data layer: `track()` pushed only into an array a container had already
 * made, and none ever did. Danny approved GA4 with a cookie consent banner in
 * chat on 15 Oct 2026, so the promise became "Google Analytics, only if you
 * say yes", and what this file holds changed with it:
 *
 *   - the data layer is created here, in `initConsent()`, and nowhere else.
 *     The first thing ever pushed onto it is Google's consent default with
 *     every signal denied - basic consent mode - so nothing that loads later
 *     can read it as consent;
 *   - `track()` pushes nothing until the visitor has said yes, now or on an
 *     earlier visit. Before that it is the no-op it always was: nothing is
 *     queued for a later yes;
 *   - gtag.js itself is loaded by components/ConsentBanner.tsx, only after a
 *     yes and only while `GA_MEASUREMENT_ID` is a real id (config/analytics.ts);
 *   - the dashboard (/app, /admin, and the app host) never initialises any of
 *     this, and a visit that walks into it switches GA off for the rest of the
 *     page's life.
 *
 * `analytics-claim.test.mts` holds those rules against the source, and the
 * sentence on /legal against the page. `privacy-claims.test.mts` holds that
 * this file is the only reader and writer of `document.cookie`.
 */

import {
  CONSENT_KEY,
  GA_MEASUREMENT_ID,
  gaIdValid,
  gaSafeUrl,
  isDashboardPath,
  pageType,
  type ConsentChoice,
  type GaEvent,
} from "../config/analytics.ts";

/** The two globals this module touches: the data layer, and GA's per-id off switch. */
type W = { dataLayer?: unknown[] } & Record<string, unknown>;
const win = () => window as unknown as W;

/** initConsent has run: the data layer exists and its first entry is the denied default. */
let ready = false;
/** The visitor said yes, on this page or an earlier visit. */
let granted = false;

/**
 * gtag's own shape. It pushes the `arguments` object rather than an array
 * because gtag.js tells its commands from plain data-layer objects that way.
 */
function gtag(..._args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  win().dataLayer!.push(arguments);
}

const DENIED = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" } as const;
/**
 * What a yes grants. The banner asks about analytics and the site runs no
 * advertising, so the three advertising signals stay denied.
 */
const GRANTED = { ...DENIED, analytics_storage: "granted" } as const;

/** The dashboard is never measured: /app, /admin, or any page drawn inside the /app layout (the app host). */
export function onDashboard(): boolean {
  if (typeof window === "undefined") return true;
  return isDashboardPath(window.location.pathname) || Boolean(document.querySelector("[data-app-tree]"));
}

/** The visitor's stored choice. Storage can throw (private windows, blocked site data), so a throw is "not asked". */
export function readConsent(): ConsentChoice | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

function storeConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    /* not stored: the banner asks again next visit, which is the safe direction */
  }
}

/**
 * Create the data layer and put the denied consent default on it, before
 * anything else can. Idempotent, and a no-op on the dashboard.
 */
export function initConsent(): boolean {
  if (typeof window === "undefined" || onDashboard()) return false;
  if (ready) return true;
  const w = win();
  w.dataLayer = w.dataLayer || [];
  gtag("consent", "default", DENIED);
  ready = true;
  return true;
}

/** GA's own off switch, honoured by gtag.js for every hit. */
function disableGa(off: boolean): void {
  win()[`ga-disable-${GA_MEASUREMENT_ID}`] = off;
}

/**
 * Keep every URL GA sees free of scan tokens and scanned domains, including
 * the page views gtag.js sends by itself on a client-side navigation. Wrapped
 * before gtag.js loads, so gtag's own history hook runs after this one and
 * reads the cleaned location. A navigation into the dashboard switches GA off.
 */
let lastSafe = "";
function followNavigation(): void {
  const update = () => {
    // The path alone: at pushState the old page is still drawn, so the
    // [data-app-tree] marker describes where the visitor was, not where they
    // are going. The app host never gets this far - initConsent refuses it.
    if (isDashboardPath(window.location.pathname)) {
      disableGa(true);
      return;
    }
    disableGa(!granted);
    const next = gaSafeUrl(window.location.href);
    gtag("set", { page_location: next, page_referrer: lastSafe });
    lastSafe = next;
  };
  for (const name of ["pushState", "replaceState"] as const) {
    const original = window.history[name];
    window.history[name] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const out = original.apply(this, args);
      update();
      return out;
    };
  }
  window.addEventListener("popstate", update);
}

/**
 * The visitor said yes (`remember`), or said it on an earlier visit. Grants
 * analytics storage and, with a real measurement id, configures GA. Returns
 * true exactly once, when the caller should now load gtag.js.
 */
export function grantConsent(remember: boolean): boolean {
  if (remember) storeConsent("accepted");
  if (!ready || granted) return false;
  granted = true;
  gtag("consent", "update", GRANTED);
  if (!gaIdValid()) return false;
  disableGa(false);
  lastSafe = gaSafeUrl(window.location.href);
  const referrer = document.referrer.startsWith(window.location.origin) ? gaSafeUrl(document.referrer) : document.referrer;
  gtag("js", new Date());
  gtag("set", { page_location: lastSafe, page_referrer: referrer });
  gtag("config", GA_MEASUREMENT_ID);
  followNavigation();
  return true;
}

/** GA's cookies: _ga, _ga_<container>, _gid and the _gcl family. */
const GA_COOKIE = /^(?:_ga|_ga_[A-Za-z0-9]+|_gid|_gcl_[A-Za-z0-9_]+)$/;

function expireGaCookies(): void {
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]!.trim())
    .filter((n) => GA_COOKIE.test(n));
  const host = window.location.hostname;
  for (const name of names) {
    for (const domain of ["", `; domain=${host}`, `; domain=.${host.replace(/^www\./, "")}`, "; domain=.alwayscited.com"]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
    }
  }
}

/**
 * The visitor said no. After an earlier yes, consent is withdrawn, GA is
 * switched off, its cookies are expired, and the caller reloads so gtag.js
 * leaves the page. Returns whether a reload is needed.
 */
export function denyConsent(): boolean {
  storeConsent("declined");
  if (!granted) return false;
  granted = false;
  gtag("consent", "update", DENIED);
  disableGa(true);
  expireGaCookies();
  return true;
}

/**
 * The GA client id from the _ga cookie ("GA1.1.<id>.<time>" -> "<id>.<time>"),
 * so the webhook's server-side purchase joins the same visitor. Only after a
 * yes: without one there is no cookie to read, and nothing is sent.
 */
export function gaClientId(): string | null {
  if (typeof window === "undefined" || readConsent() !== "accepted") return null;
  const raw = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("_ga="));
  const m = raw?.slice(4).match(/^GA\d\.\d\.(\d{1,12}\.\d{1,12})$/);
  return m ? m[1]! : null;
}

export type TrackParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Send one GA4 event, with the page type it happened on. Nothing is pushed,
 * queued or kept before the visitor has said yes, and nothing on the
 * dashboard. Params are flat values only: never a domain, an email address or
 * anything typed into a form.
 */
export function track(event: GaEvent, params: TrackParams = {}): void {
  if (typeof window === "undefined") return;
  if (!granted || onDashboard()) return;
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) clean[k] = v;
  gtag("event", event, { ...clean, page_type: pageType(window.location.pathname) });
}
