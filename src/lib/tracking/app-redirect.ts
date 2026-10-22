import { appHost, appOrigin, appPath } from "../app-host.ts";
import { dashLinkOrigin } from "../dash/host.ts";

/**
 * Where a dashboard route handler sends somebody (M1, 5 Oct 2026).
 *
 * Every writer under /api/app answers a request with no session by sending it
 * to the login page, and the login page is at `/app/login` on the marketing
 * host and `/login` on the dashboard's own. Which one is a property of the
 * deployment rather than of this request - see appPath - so `req` is taken
 * only to keep the call sites reading as redirects and is not inspected.
 *
 * With APP_HOST unset this returns the `/app`-prefixed path it always did.
 */
export function dashPath(_req: Request, rest: string): string {
  return appPath(rest);
}

/**
 * The absolute URL a dashboard route redirects to (8 Oct 2026, audit
 * interactions-1). Built on the dashboard's own origin once it has one, never
 * on req.url alone: a server's req.url can carry the host it listens on rather
 * than the one the browser asked, and a 303 to the marketing host after a form
 * post on the dashboard's host is refused by the CSP's form-action 'self'
 * there - Stop, Undo, Invite, login and logout all failed silently on
 * app.localhost. With APP_HOST unset this is `new URL(path, req.url)`, as
 * every call site wrote before.
 */
export function dashUrl(req: Request, path: string, env?: { APP_HOST?: string }): URL {
  return new URL(path, appHost(env) ? appOrigin(new URL(req.url).origin, env) : req.url);
}

/**
 * The dashboards host's sign-in, for a route under /api/app that answers a plain form post (cut-over, 22 Oct 2026):
 * /login there is the only sign-in page, whichever host the form was posted from. The origin is the configured
 * one (dashLinkOrigin), never the Host header as sent. `query` is the fixed codes the page reads.
 */
export function signInUrl(req: Request, query: URLSearchParams): URL {
  return new URL(`/login?${query}`, dashLinkOrigin(req.headers.get("host")));
}
