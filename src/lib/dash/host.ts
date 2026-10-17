/**
 * dashboards.alwayscited.com (Danny, 17 Oct 2026): the customer dashboard on
 * its own host, built beside the /app dashboard rather than over it, so the
 * experience on alwayscited.com does not change until the cut-over.
 *
 * The route tree is `src/app/dashboards/`. On the dashboards host the public
 * paths carry no prefix (`/meetlifesciences-com/clusters`) and the proxy
 * rewrites them to `/dashboards/...`; on any other host `/dashboards` is a 404,
 * so the tree has exactly one address.
 *
 * Plain module, no imports, so proxy.ts and `node --test` can both load it.
 * The env read is a literal member access for the reason app-host.ts gives.
 */
const ENV_DASH_HOST = process.env.DASH_HOST;

/**
 * Shareable read-only demo links (17 Oct 2026): `token:slug` pairs, comma
 * separated, set in Vercel and never committed - the token is the only thing
 * that opens a demo, and this repository is public. Literal access for the
 * reason above.
 */
const ENV_DEMO_LINKS = process.env.DASH_DEMO_LINKS;

/** A demo link opens only with a token this long: unguessable, not merely obscure. */
export const DEMO_TOKEN_MIN = 32;

/** The request header the proxy sets on a verified demo request; any copy a client sends is stripped first. */
export const DEMO_HEADER = "x-dash-demo";

/** The plan states a demo link can show a client as (17 Oct 2026), for reviewing each plan's experience. */
export const DEMO_STATES = ["tracked-trial", "tracked", "mentioned", "cited", "everywhere"] as const;
export type DemoState = (typeof DEMO_STATES)[number];

/** A demo token's link: the client it opens and, optionally, the plan state it shows the client as. */
export function demoLink(token: string | null | undefined, env?: { DASH_DEMO_LINKS?: string }): { slug: string; state: DemoState | null } | null {
  if (!token || token.length < DEMO_TOKEN_MIN || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const raw = (env ? env.DASH_DEMO_LINKS : ENV_DEMO_LINKS) ?? "";
  for (const entry of raw.split(",")) {
    const [t, slug, state] = entry.trim().split(":");
    if (!t || !slug || t.length < DEMO_TOKEN_MIN || t !== token || !/^[a-z0-9-]{1,80}$/.test(slug)) continue;
    if (state !== undefined && !(DEMO_STATES as readonly string[]).includes(state)) return null;
    return { slug, state: (state as DemoState | undefined) ?? null };
  }
  return null;
}

/** The client slug a demo token opens, or null. */
export function demoSlug(token: string | null | undefined, env?: { DASH_DEMO_LINKS?: string }): string | null {
  return demoLink(token, env)?.slug ?? null;
}

/** `/demo/<token>/<rest>` split apart, or null for any other path. */
export function demoPath(pathname: string): { token: string; rest: string } | null {
  const m = /^\/demo\/([^/]+)(\/.*)?$/.exec(pathname);
  return m ? { token: m[1]!, rest: m[2] ?? "" } : null;
}

/** The production host. DASH_HOST overrides it (a preview, or `dashboards.localhost:3100` in e2e). */
export const DASH_HOST_DEFAULT = "dashboards.alwayscited.com";

export const DASH_PREFIX = "/dashboards";

export function dashHost(env?: { DASH_HOST?: string }): string {
  const raw = ((env ? env.DASH_HOST : ENV_DASH_HOST) ?? "").trim().toLowerCase();
  return raw || DASH_HOST_DEFAULT;
}

/**
 * Is this request on the dashboards host? The production name always counts;
 * so does `dashboards.localhost` on any port, which Chromium resolves, for a
 * local run with no configuration.
 */
export function isDashHost(host: string | null | undefined, env?: { DASH_HOST?: string }): boolean {
  const h = (host ?? "").trim().toLowerCase();
  if (!h) return false;
  if (h === dashHost(env) || h === DASH_HOST_DEFAULT) return true;
  return h.split(":")[0] === "dashboards.localhost";
}

/** The internal route for a path on the dashboards host. `/api` and `/_next` never reach here (proxy skip). */
const PASS = ["/favicon", "/icon", "/apple-icon", "/manifest"];
export function dashInternal(pathname: string): string {
  if (PASS.some((p) => pathname.startsWith(p))) return pathname;
  if (pathname === "/") return DASH_PREFIX;
  return `${DASH_PREFIX}${pathname}`;
}

/** `/dashboards/x` as it is spelled on its own host, or null when the path has no prefix. */
export function dashStrip(pathname: string): string | null {
  if (pathname === DASH_PREFIX) return "/";
  if (pathname.startsWith(`${DASH_PREFIX}/`)) return pathname.slice(DASH_PREFIX.length);
  return null;
}

/** The dashboards host's origin, for a link in an email. http for a local host. */
export function dashOrigin(env?: { DASH_HOST?: string }): string {
  const h = dashHost(env);
  const local = h.split(":")[0]!.endsWith("localhost");
  return `${local ? "http" : "https"}://${h}`;
}

/**
 * The origin a login link points at, for a request that arrived on the
 * dashboards host. A local host keeps its port and http; anything else is the
 * configured production origin, never the Host header as sent, so a forged
 * header cannot put another origin into a sign-in email.
 */
export function dashLinkOrigin(host: string | null, env?: { DASH_HOST?: string }): string {
  const h = (host ?? "").trim().toLowerCase();
  if (h.split(":")[0] === "dashboards.localhost") return `http://${h}`;
  return dashOrigin(env);
}

/**
 * The path prefix links carry on this request's host: none on the dashboards
 * host, `/dashboards` on the marketing host, where the same tree is open to a
 * signed-in member as a preview until the subdomain's DNS exists (17 Oct 2026).
 */
export function dashBase(host: string | null | undefined, env?: { DASH_HOST?: string }): string {
  return isDashHost(host, env) ? "" : DASH_PREFIX;
}
