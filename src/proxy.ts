import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ROBOTS_AGENTS } from "@/config/robots-agents";
import { appHost, appOrigin, internalPath, isAppHost, passesThrough, stripPrefix } from "@/lib/app-host";
import { constantTimeEqual, decodeBasicAuth } from "@/lib/constant-time";
import { isPrefetch } from "@/lib/prefetch";
import { previewPath } from "@/lib/hub-preview";
import { DEMO_HEADER, VIEW_HEADER, dashInternal, dashOrigin, dashPathForApp, dashStrip, demoPath, demoSlug, isDashHost, viewPath } from "@/lib/dash/host";

/**
 * HTTP Basic auth over /admin. The operations page exposes cost, lead counts
 * and failure detail, so it is never public.
 *
 * Proxy runs before rendering and cannot import server-only modules, so the
 * credentials are read straight from the environment here, and the two helpers
 * it shares with the cron route are plain standard-library JavaScript.
 */
function challenge(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="alwayscited admin", charset="UTF-8"' },
  });
}

function admin(request: NextRequest): NextResponse {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  // With no credentials configured the page stays shut rather than open.
  if (!user || !password) {
    return new NextResponse("Admin access is not configured.", { status: 503 });
  }

  /**
   * Decoded as UTF-8, which is what the charset above asks the browser to
   * send. This used to read the bytes back through atob alone and compare
   * that latin1 string against process.env, so an accented character in
   * ADMIN_PASSWORD reached here as two characters where the environment holds
   * one - a password that could never be typed correctly, failing as an
   * ordinary wrong password with nothing to say it was impossible.
   */
  const creds = decodeBasicAuth(request.headers.get("authorization") ?? "");
  // R162: a prefetch is never a person, so it is never challenged - a 401 with
  // WWW-Authenticate here is what opened Chrome's sign-in box over /app.
  const shut = () => (isPrefetch((n) => request.headers.get(n)) ? new NextResponse(null, { status: 404 }) : challenge());
  if (!creds) return shut();

  /**
   * Both halves are compared, every time.
   *
   * && short-circuits, so a wrong user name returned before the password was
   * looked at - a timing signal that says which of the two is wrong, on the one
   * page that has to stay shut. The reason these two calls do not exit early on
   * the first differing character is defeated by an operator that exits early
   * on the first differing field.
   */
  const userOk = constantTimeEqual(creds.user, user);
  const passwordOk = constantTimeEqual(creds.password, password);
  const ok = userOk && passwordOk;

  return ok ? NextResponse.next() : shut();
}

const ADMIN = (p: string) => p === "/admin" || p.startsWith("/admin/");

/**
 * Host routing for the dashboard (M1, 5 Oct 2026; see src/lib/app-host.ts).
 *
 * With APP_HOST unset every branch below is skipped and this file behaves
 * exactly as it did before the host move: Basic auth over /admin and
 * NextResponse.next() for everything else. That is what lets it ship before
 * the domain exists.
 *
 * With APP_HOST set there are three rules, and they are all about one thing -
 * one address per page:
 *
 *   on the app host   `/tallyroo/clusters` renders `/app/tallyroo/clusters`
 *                     and `/app/tallyroo/clusters` 308s to the clean form,
 *                     because bookmarks and already-sent emails carry it
 *   on the app host   /admin is a 404. The operations page stays on the main
 *                     host, where its Basic auth is
 *   on the main host  `/app/...` 308s to the app host, path and query intact
 *
 * The matcher below runs this on every request that is not a static asset,
 * which is wider than the /admin-only matcher it replaces. It has to be: the
 * rewrite applies to paths that carry no prefix of their own, so there is no
 * pattern short of "everything" that catches them. Each request costs one
 * host comparison when APP_HOST is unset.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Runs on every request, so the cheapest possible exit comes first.
  if (skip(pathname)) return NextResponse.next();

  const host = request.headers.get("host");

  /**
   * dashboards.alwayscited.com (17 Oct 2026, src/lib/dash/host.ts): the new
   * customer dashboard, its own host and its own tree. Nothing else is served
   * there, and its tree is served nowhere else.
   */
  if (isDashHost(host)) {
    if (ADMIN(pathname)) return new NextResponse(null, { status: 404 });
    if (pathname === "/robots.txt") {
      return new NextResponse(`${ROBOTS_AGENTS.map((a) => `User-Agent: ${a}\nDisallow: /`).join("\n\n")}\n`, {
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
      });
    }
    const bare = dashStrip(pathname);
    if (bare !== null) return NextResponse.redirect(new URL(`${bare}${search}`, request.url), 308);
    // The demo header is the proxy's to set: whatever a client sent under that name is dropped.
    const headers = new Headers(request.headers);
    headers.delete(DEMO_HEADER);
    headers.delete(VIEW_HEADER);
    let target = dashInternal(pathname);
    // The hub's "What the customer sees" (18 Oct 2026): /view/<token>/<slug>/... is one client's real pages, read-only.
    // Only the shape is checked here; page-data checks the token against the database on every request.
    const view = viewPath(pathname);
    if (pathname.startsWith("/view/") && !view) return new NextResponse(null, { status: 404, headers: { "x-robots-tag": "noindex, nofollow" } });
    if (view) {
      headers.set(VIEW_HEADER, view.token);
      target = `/dashboards/${view.slug}${view.rest}`;
    }
    // A read-only demo link (17 Oct 2026): /demo/<token>/... is one client's pages, opened by the token alone.
    const demo = demoPath(pathname);
    if (demo) {
      const slug = demoSlug(demo.token);
      if (!slug) return new NextResponse(null, { status: 404, headers: { "x-robots-tag": "noindex, nofollow" } });
      headers.set(DEMO_HEADER, demo.token);
      // The pages link as `${base}/${slug}/...`, so a demo path may carry the slug again; it is the same page.
      const rest = demo.rest === `/${slug}` || demo.rest.startsWith(`/${slug}/`) ? demo.rest.slice(slug.length + 1) : demo.rest;
      target = `/dashboards/${slug}${rest}`;
    }
    const res = NextResponse.rewrite(new URL(`${target}${search}`, request.url), { request: { headers } });
    res.headers.set("x-robots-tag", "noindex, nofollow");
    if (demo || view) res.headers.set("referrer-policy", "no-referrer");
    return res;
  }
  // On the marketing host /dashboards is the same tree, for a signed-in member only (pageData 404s anyone else)
  // and noindex by next.config.ts's header rule: a preview until the subdomain's DNS exists.

  const onApp = isAppHost(host);
  if (ADMIN(pathname)) {
    // The operations page is not served from the dashboard's host at all.
    if (onApp) return new NextResponse(null, { status: 404 });
    return admin(request);
  }

  // 18 Oct 2026 brief 2d: the dashboards host is the one customer dashboard. Every /app address - on the app host,
  // or under /app on this one - answers a 308 to its equivalent there (dash/host.ts dashPathForApp), query kept,
  // so old emails and bookmarks still arrive. Assets and /api pass as before.
  const appBare = onApp ? (passesThrough(pathname) ? null : (stripPrefix(pathname) ?? pathname)) : stripPrefix(pathname);
  if (appBare !== null && pathname !== "/robots.txt") {
    return NextResponse.redirect(new URL(`${dashPathForApp(appBare)}${search}`, dashOrigin()), 308);
  }

  if (onApp) {
    /**
     * The whole host is one client's figures, so every agent is refused all
     * of it. Written here rather than in robots.ts because deciding it there
     * means reading the Host header, which would make the marketing host's
     * robots.txt dynamic too - and that file is prerendered today.
     */
    if (pathname === "/robots.txt") {
      return new NextResponse(`${ROBOTS_AGENTS.map((a) => `User-Agent: ${a}\nDisallow: /`).join("\n\n")}\n`, {
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" },
      });
    }
    const bare = stripPrefix(pathname);
    if (bare !== null) {
      return NextResponse.redirect(new URL(`${bare}${search}`, request.url), 308);
    }
    const res = NextResponse.rewrite(new URL(`${internalPath(pathname)}${search}`, request.url));
    /**
     * Every response from this host is a client's own figures, so the whole
     * host is closed rather than route by route: the header here, the
     * Disallow: / robots.txt above, and the noindex in each page's own
     * metadata.
     *
     * Not here: `frame-ancestors 'none'`. The CSP is next.config.ts's header,
     * applied after this runs, so a rewrite of it here found nothing to
     * rewrite (8 Oct 2026, checked on next start). next.config.ts carries it
     * as a host-conditioned header instead, read at build.
     */
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }

  // The main host keeps serving everything else; the dashboard has moved.
  if (appHost()) {
    const bare = stripPrefix(pathname);
    if (bare !== null) {
      // appOrigin: https for the real host, http for app.localhost in a local run.
      return NextResponse.redirect(new URL(`${bare}${search}`, appOrigin(request.nextUrl.origin)), 308);
    }
  }

  // 16 Oct 2026: a hub post's draft link, /blog/<slug>?preview=<key>, renders its preview route, never indexed.
  const preview = previewPath(pathname, request.nextUrl.searchParams.get("preview"));
  if (preview) {
    const res = NextResponse.rewrite(new URL(preview, request.url));
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }

  return NextResponse.next();
}

/**
 * No matcher, deliberately.
 *
 * `/admin/:path*` was the matcher until 6 Oct 2026, and a path pattern is all
 * this version accepts: path-to-regexp v8 dropped the custom-regex group, so
 * the documented `/((?!api|_next/static|_next/image).*)` form compiles to
 * something that matches nothing here and the proxy silently stops running -
 * no error, no warning, just a middleware that never fires. Checked by
 * setting a header on every response and watching it never arrive.
 *
 * Host routing has to see paths that carry no prefix of their own
 * (`/tallyroo` on the dashboard's host), so there is no path pattern short of
 * everything. Without a config export the proxy runs on every request,
 * including static files, and the first thing it does is hand the static ones
 * straight back. *
 * How this version finds and bundles the file (8 Oct 2026, Next 16.3.5,
 * read off a build rather than assumed): src/proxy.ts becomes the function
 * `/_middleware` in .next/server/functions-config-manifest.json with
 * `"runtime": "nodejs"` - the Edge middleware-manifest.json stays empty. With
 * no config export its matcher is `/:path*`, compiled to `^.*$`, so it runs
 * on every path; proved on `next start` by a temporary header that arrived on
 * all twelve paths checked, /_next/static and /api included. The code is in
 * .next/server/chunks/; .next/server/middleware.js is a 221-byte Turbopack
 * loader stub, which is why grepping it for this file's strings found none.
 */
export function skip(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname.startsWith("/api/");
}
