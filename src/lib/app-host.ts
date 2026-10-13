/**
 * Where the dashboard lives (M1 of docs/tracked-dashboard-2026-10-05-app/
 * 04-migration-brief.md, decisions 2 and 3; Danny, 5 Oct 2026).
 *
 * The dashboard is moving to its own host. A host name is infrastructure, so
 * it is an env var and not an `app_settings` row - the proxy runs before
 * rendering and cannot cheaply read the database, and the value has to be the
 * same for the proxy and for the pages behind it.
 *
 * Unset is today's behaviour, exactly. With no APP_HOST every function here
 * returns the `/app`-prefixed path the site has always served, so this file
 * can ship and sit dark until the domain exists.
 *
 * The route tree stays at `src/app/app/`. On the app host the public paths
 * drop the prefix (`app.alwayscited.com/tallyroo/clusters`) and the proxy
 * rewrites them back to `/app/...` internally, so nothing under src/app moves
 * and every page keeps its file.
 *
 * Plain module, no imports, so `node --test` can load it and so proxy.ts -
 * which may not import server-only code - can use it too.
 */

/**
 * Read once, at module scope, as a static member access.
 *
 * It has to be spelled exactly like this. proxy.ts runs in the Edge runtime,
 * where `process.env` is not the Node object: the build rewrites each
 * literal member access it can see and nothing else, so a dynamic read -
 * `(env ?? process.env).APP_HOST` - comes back undefined there while working
 * perfectly in every Node-runtime caller. That is the shape this file shipped
 * with for an hour on 6 Oct 2026, and the symptom was the whole host-routing
 * branch silently never running: /admin still answered 401 on the dashboard's
 * host, because the admin branch reads its own two variables the same literal
 * way and those did work.
 */
const ENV_APP_HOST = process.env.APP_HOST;

/** The dashboard's own host, lower-cased, or null when none is configured. */
export function appHost(env?: { APP_HOST?: string }): string | null {
  const raw = ((env ? env.APP_HOST : ENV_APP_HOST) ?? "").trim().toLowerCase();
  return raw || null;
}

/**
 * Is this request on the dashboard's own host?
 *
 * The Host header carries the port in development (`app.localhost:3100`,
 * which is what the e2e run uses because Chromium resolves `*.localhost`), so
 * the comparison is on the whole header and APP_HOST is expected to carry the
 * port too when there is one.
 */
export function isAppHost(host: string | null | undefined, env?: { APP_HOST?: string }): boolean {
  const want = appHost(env);
  if (!want) return false;
  return (host ?? "").trim().toLowerCase() === want;
}

/** Every dashboard path starts here on the main host. */
export const APP_PREFIX = "/app";

/**
 * The public path for a place in the dashboard.
 *
 * `rest` is the path under `/app` and always starts with a slash, or is empty
 * for the dashboard's own root.
 *
 * There is no per-request host to read here, and that is the point. Once
 * APP_HOST is set the proxy 308s `/app/*` on the marketing host to the
 * dashboard's host, so the dashboard only ever renders on one host and the
 * prefix is a property of the deployment rather than of the request. Unset,
 * every path keeps the `/app` it has always had.
 */
export function appPath(rest: string, onAppHost: boolean = appHost() !== null): string {
  const tail = rest === "/" ? "" : rest;
  if (onAppHost) return tail || "/";
  return `${APP_PREFIX}${tail}`;
}

/** True when this deployment serves the dashboard from its own host. */
export function onOwnHost(): boolean {
  return appHost() !== null;
}

/**
 * A development host, which is served over http - a link to `https://` there
 * cannot be opened at all. The port is dropped first: `app.localhost:3100` is
 * what the e2e run uses, because Chromium resolves `*.localhost`.
 */
function isLocal(host: string): boolean {
  const bare = host.split(":")[0] ?? "";
  return bare === "localhost" || bare.endsWith(".localhost") || bare === "127.0.0.1" || bare === "[::1]";
}

/**
 * The same path as an absolute URL, for an email or a redirect that leaves
 * the request behind.
 *
 * Emails are the reason this exists: a login link has no request to be
 * relative to, and it must point at whichever host the dashboard is on, or
 * the member signs in on the main host and the `__Host-` cookie is set for
 * the wrong origin.
 */
export function appUrl(rest: string, origin: string, env?: { APP_HOST?: string }): string {
  const host = appHost(env);
  if (host) {
    const scheme = isLocal(host) ? "http" : "https";
    return `${scheme}://${host}${appPath(rest, true)}`;
  }
  return `${origin.replace(/\/$/, "")}${appPath(rest, false)}`;
}

/**
 * A link from the marketing site into the dashboard - the header's "Log in"
 * (Danny, 13 Oct 2026). The mirror of siteHref: relative while the dashboard
 * shares the site's host (`/app/login`), absolute once it has its own
 * (`https://app.alwayscited.com/login`), because on the marketing host a bare
 * `/login` is no route and `/app/login` would only 308 to the same place.
 *
 * Decided on the server. A client component cannot read APP_HOST - only
 * NEXT_PUBLIC_ variables reach the browser bundle, the rest read as empty - so
 * the site header would render one href on the server and another on
 * hydration. The root layout calls this and hands the header the string.
 */
export function appHref(rest: string, env?: { APP_HOST?: string }): string {
  return appHost(env) ? appUrl(rest, "", env) : appPath(rest, false);
}

/** The dashboard's own origin, for a link that leaves the request behind. */
export function appOrigin(origin: string, env?: { APP_HOST?: string }): string {
  const host = appHost(env);
  if (!host) return origin.replace(/\/$/, "");
  const scheme = isLocal(host) ? "http" : "https";
  return `${scheme}://${host}`;
}

/**
 * The internal route for a path arriving on the app host.
 *
 * `/tallyroo/clusters` is `/app/tallyroo/clusters` to the route tree. The
 * dashboard's own assets and API are left alone: `/_next`, `/api` and the
 * files Next serves from `public/` answer on both hosts under their own
 * names, so a rewrite of those would 404 them.
 */
export const PASS_THROUGH = ["/_next/", "/api/", "/favicon", "/robots.txt", "/sitemap.xml", "/icon", "/apple-icon", "/opengraph-image", "/manifest"];

export function passesThrough(pathname: string): boolean {
  return PASS_THROUGH.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

export function internalPath(pathname: string): string {
  if (passesThrough(pathname)) return pathname;
  if (pathname === "/") return APP_PREFIX;
  return `${APP_PREFIX}${pathname}`;
}

/**
 * A path already carrying the prefix, as it should be spelled on the app host.
 *
 * Nothing should render one - `app-path.test.mts` holds the source to that -
 * but a bookmark, an old email and the two addresses printed in earlier
 * lifecycle mails all exist, so `/app/x` on the app host answers a 308 to
 * `/x` rather than a 404.
 */
export function stripPrefix(pathname: string): string | null {
  if (pathname === APP_PREFIX) return "/";
  if (pathname.startsWith(`${APP_PREFIX}/`)) return pathname.slice(APP_PREFIX.length);
  return null;
}

/** The marketing site's own origin: where checkout, pricing and the tier pages live. */
export const SITE_ORIGIN = "https://alwayscited.com";

/**
 * The marketing site's origin as seen from the dashboard's host.
 *
 * In production that is SITE_ORIGIN. A development app host is the main
 * development server under an `app.` label - `app.localhost:3100` is
 * `localhost:3100`, same port - so a link from it stays on the server the run
 * started, over http, rather than leaving for the live site (8 Oct 2026, audit
 * ia-2: the e2e run has to be able to follow it).
 */
export function siteOrigin(host: string): string {
  const h = host.trim().toLowerCase();
  if (isLocal(h)) return `http://${h.replace(/^app\./, "")}`;
  return SITE_ORIGIN;
}

/**
 * A link from the dashboard to a page on the marketing site (8 Oct 2026,
 * audit ia-2). Relative while the dashboard shares the site's host; absolute
 * once it has its own, where `/contact` or `/alwayscited` would otherwise be
 * rewritten into the dashboard tree and 404 - as the plan card's pack link and
 * the Clusters upgrade button did on app.localhost until they came through
 * here. app-host.test.mts holds every such link in the dashboard to it.
 */
export function siteHref(path: string, env?: { APP_HOST?: string }): string {
  const host = appHost(env);
  return host ? `${siteOrigin(host)}${path}` : path;
}

/**
 * The same, decided in the browser, for a client component - which cannot
 * read APP_HOST, because only NEXT_PUBLIC_ variables reach the client bundle.
 * The page's own address says which host it is on: the dashboard is under
 * `/app` only on the main host, and the proxy 308s that prefix away on the
 * app host.
 */
export function siteHrefAt(path: string, here: { pathname: string; host: string }): string {
  const onMain = here.pathname === APP_PREFIX || here.pathname.startsWith(`${APP_PREFIX}/`);
  return onMain ? path : `${siteOrigin(here.host)}${path}`;
}
