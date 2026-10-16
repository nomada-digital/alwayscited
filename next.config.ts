import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * The site was serving none of these. HSTS comes from Vercel; everything
 * below had to be asked for.
 *
 * The one that is not boilerplate is the X-Robots-Tag on /api and /scan.
 * robots.txt now closes both to crawlers, but robots.txt governs fetching and
 * says nothing to anything that has already fetched. The scan pages carry a
 * noindex meta tag; the JSON under /api returns the same brand, domain and
 * placement data and cannot carry a meta tag at all, because it is not HTML.
 * The header is the only form of the directive that reaches it.
 *
 * `:path+` on /scan, not `:path*`. The docs for this version are explicit that
 * `*` is zero or more and that `/blog/:slug*` matches `/blog`, so `/scan`
 * itself was picking up the header. What is protected is a scan result, which
 * always has a token under it, so "one or more segments" is the rule that was
 * meant. /api keeps `*`: there is no page at bare /api, so the extra match
 * costs nothing and a 404 is better off noindexed anyway.
 *
 * CORRECTION, 19 Sep, read off the live page rather than the headers. The
 * commit that made this change (7541ba2) said it was un-indexing /scan and
 * that src/app/robots.ts wanted /scan indexable. Neither is so, and the check
 * behind it only read response headers.
 *
 * robots.ts keeps /scan *crawlable*, which is not the same thing, and its own
 * sentence says why - "a linked URL that is closed gets listed as a bare
 * address, which is worse than the noindex it already carries". It is the
 * action of seven `<form method="get">` across the site, so it must be
 * fetchable; it carries `noindex, nofollow` in its own page metadata, and
 * still does today. Crawlable plus noindex is the pairing that was intended
 * and the one that is live: the crawler fetches it, reads the tag, and does
 * not list the bare URL.
 *
 * So this rule change removed a header that duplicated a meta tag, and /scan
 * is not and was never made indexable by it. That is the right outcome - the
 * page renders the home page's hero with the domain field prefilled, carries
 * `?domain=` and `?verify=` state, has no description of its own and is
 * deliberately absent from sitemap.ts. Indexing it would put a near-duplicate
 * of the home page into the index against the home page's own canonical.
 */
const BASELINE = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-frame-options", "SAMEORIGIN"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=()"],
];

const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy.
 *
 * WHAT THIS BUYS AND WHAT IT DOES NOT, because a CSP is easy to overstate.
 *
 * script-src keeps 'unsafe-inline'. This policy therefore does NOT stop an
 * injected inline script. It is not XSS protection and must not be described
 * as such in a commit message or to a customer.
 *
 * That is forced by Next's own output rather than chosen. A statically
 * generated page in this app carries four inline script tags with no
 * integrity attribute, one of them the RSC flight payload
 * (self.__next_f.push) - checked in .next/server/app/*.html, not assumed.
 * Dropping 'unsafe-inline' therefore needs a per-request nonce or a hash.
 *
 * The nonce is the documented route and it costs more here than it returns:
 * the Next docs are explicit that a nonce forces every page to render
 * dynamically, which for the static marketing pages means no CDN caching and
 * a server render per view. (Counted here as 21 when this was written; the
 * build says 20 today, because /blog reads searchParams for its filter pills
 * and buys a per-request render with it. Stated as "the static pages" rather
 * than as a number, because the number moves and nothing depends on it.) It
 * would be buying that against an injection
 * vector the site does not currently have - every dangerouslySetInnerHTML
 * here is JSON-LD built from static config, none of it from a crawled site
 * or from a visitor.
 *
 * What it does buy are the four directives that need no nonce and cannot
 * break a render:
 *   base-uri 'self'    an injected <base> cannot re-point every relative URL
 *   form-action        an injected form cannot post the contact form or a
 *                      scan email address to someone else. 'self' plus
 *                      Stripe's two hosted pages, because Chrome enforces
 *                      form-action on the redirect a form submission
 *                      follows: /checkout's form posts to /api/checkout,
 *                      which 303s to checkout.stripe.com, and with 'self'
 *                      alone the browser blocked "Continue to payment"
 *                      (R155, severity 1, Danny, 1 Oct 2026, danny.md line
 *                      155). billing.stripe.com is the billing portal's
 *                      host, named in the same fix. Navigation targets, not
 *                      subresources - nothing is fetched from them by a page
 *                      here - so the third-party censuses read them apart
 *                      (FORM_TARGETS in src/app/privacy-claims.test.mts).
 *   object-src 'none'  no plugin-embedded script
 *   frame-ancestors    clickjacking, and the directive browsers honour in
 *                      preference to the X-Frame-Options above
 *
 * When the inline-script hole is worth closing, the upgrade is SRI
 * (experimental.sri), not a nonce, because it keeps static rendering. It
 * hashes files and not inline scripts, so it does not close this on its own
 * today.
 *
 * challenges.cloudflare.com is Turnstile on the scan form - its script and
 * the widget's iframe. It is the site's only third-party origin.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' https://challenges.cloudflare.com${isDev ? " ws:" : ""}`,
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  "object-src 'none'",
  "frame-ancestors 'self'",
  // Omitted in development: it upgrades http subresources, which is not
  // what a localhost dev server wants.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/** The dashboard's host name, without a port, when APP_HOST names one (src/lib/app-host.ts). */
const APP_HOSTNAME = (process.env.APP_HOST ?? "").trim().toLowerCase().split(":")[0] || null;

const nextConfig: NextConfig = {
  /**
   * 16 Oct 2026: the one remote image source - the agency hub's blog-images
   * bucket, for posts published from it (lib/hub-posts.ts HUB_IMAGE_ROOT).
   * Served through next/image, so the browser only ever loads them from this
   * origin and the CSP's img-src stays 'self' blob: data:.
   */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "qpsrvmnmtozvailsyqqz.supabase.co", port: "", pathname: "/storage/v1/object/public/blog-images/**", search: "" },
    ],
  },
  /**
   * Off because it was shipping a stale stylesheet to production.
   *
   * Next 16.3 puts content-addressed assets under /_next/static/immutable/,
   * drops the ?dpl= deployment query from them and serves them
   * `max-age=31536000, immutable`, on the promise that a given filename can
   * only ever hold one set of bytes. Observed on production at e65d6eb, which
   * is what this flag is being set for: the HTML was that commit's - the new
   * classes were in it, and /api/version agreed - and the one stylesheet it
   * loaded was /_next/static/immutable/chunks/0baq_3elvlaml.css, serving
   * Last-Modified 12:27 with an Age of seven hours and none of that commit's
   * rules in it. A query string does not reach past it either: the same URL
   * with ?bust=1 returned the identical cached body. So the markup shipped and
   * the CSS behind it did not, which is worse than neither shipping, because
   * every check short of reading the served stylesheet says it worked.
   *
   * What is not established is why - whether Vercel skipped the upload for a
   * path already in the shared namespace, or two builds truncated to the same
   * hash, which is the collision the adapter docs warn about and give
   * outputHashSalt for. Both are upstream of us and neither changes what to do
   * here. The filename is content-addressed - verified by rebuilding with one
   * real rule added and watching the hash move, after a first attempt with
   * only a comment proved nothing because the minifier strips those.
   *
   * Cost of turning it off: assets carry ?dpl= again and a returning visitor
   * re-downloads them after each deploy. On a site with almost no traffic that
   * is not a cost. Getting the stylesheet you just shipped is not optional.
   *
   * Reverse by deleting this line, but only alongside a check that reads the
   * served CSS rather than the HTML.
   */
  supportsImmutableAssets: false,

  /**
   * A salt per commit, because the flag above was not enough - 25 Sep 2026.
   *
   * Observed on production at 3ac41a6: /api/version and the HTML were that
   * commit's (proc-stage, proc-foot in the markup), and the one stylesheet the
   * HTML loaded, /_next/static/chunks/0ny167djlbgig.css, was 27,530 bytes with
   * none of the .proc-head/.proc-stage/.proc-qrow rules 3ac41a6 added. A local
   * build of the same tree makes a 30,024-byte sheet that has them. The chunk
   * came back `max-age=31536000, immutable` with no ?dpl= on the URL, so the
   * homepage's four tiers rendered as one unstyled column with the question
   * grid run together - and every check short of reading the served CSS said
   * it had shipped.
   *
   * Salting with the commit gives every deploy filenames no earlier deploy can
   * have used, which closes the reuse whatever its cause. Empty off Vercel, so
   * local builds and their census readings are unchanged. Verify by reading
   * the served stylesheet for a rule the commit added, not by reading the HTML.
   */
  outputHashSalt: process.env.VERCEL_GIT_COMMIT_SHA ?? "",

  /**
   * The salt above did not close it. 15710d1 (25 Sep 2026) deployed with a
   * fresh salted stylesheet name, Last-Modified that deploy, and still without
   * one rule of the block that commit appended to globals.css - every rule up
   * to the one before it was there, and a local build of the same tree has
   * them all. So the bytes were stale, not the filename: a CSS transform from
   * an earlier build was reused. Next 16.3 turned on Turbopack's filesystem
   * cache for `next build` by default, in .next/cache/turbopack, and Vercel
   * restores .next/cache between deploys - the one place an earlier build's
   * work can come from. Off, so every production build compiles from source.
   * Costs build time only.
   */
  experimental: {
    turbopackFileSystemCacheForBuild: false,
    /**
     * Next 16.3.5's own defaults (server/config-shared.js 260-263), stated so
     * a change of default cannot move the dashboard's window unseen - 13 Oct
     * 2026, dashboard speed work; src/components/app/fresh.ts has the design.
     * `static` is how long the sidebar's prefetch={true} pages are held, and
     * must equal FRESH_SECONDS there (prefetch.test.mts reads both); Next
     * floors it at 30. `dynamic` stays 0 because it is global: the marketing
     * site and checkout are dynamic routes too. The dashboard's pages each
     * set their own instead (unstable_dynamicStaleTime).
     *
     * If partialPrefetching or cacheComponents is ever turned on, re-read
     * this: with partial prefetching on, prefetch={true} is ignored
     * (segment-cache/scheduler.js 522-538) and the sidebar is slow again.
     */
    staleTimes: { dynamic: 0, static: 300 },
  },

  /**
   * /example is gone - Danny, 19 Sep 2026: "We no longer need example you
   * can remove this." It was live for weeks and may be linked from
   * somewhere neither of us can see, so it redirects rather than 404s.
   */
  async redirects() {
    return [
      {
        source: "/example",
        destination: "/",
        permanent: true,
      },
    ];
  },

  async headers() {
    const baseline = BASELINE.map(([key, value]) => ({ key, value }));
    const csp = { key: "content-security-policy", value: CSP };
    const noIndex = { key: "x-robots-tag", value: "noindex, nofollow" };

    /**
     * `/coverage-check/:path+` and `/admin/:path*` joined this list on
     * 20 September, both found by `route-closure.test.mts` rather than by
     * reading.
     *
     * The coverage-check one is the live gap: a campaign reading renders a
     * client brand and an uploaded coverage list, exactly as `/scan/<token>`
     * does, and it had the noindex meta tag and nothing else. `:path+` for the
     * same reason /scan uses it - the bare `/coverage-check` page is public,
     * indexable and in the sitemap, and only the states with a token under
     * them are private.
     *
     * The admin one changes nothing today, because proxy.ts answers 401 before
     * anything renders. It is here on the argument robots.ts already makes for
     * its own `/admin/` line: the day the auth moves, the directive should not
     * have to be remembered separately.
     */
    return [
      { source: "/:path*", headers: [...baseline, csp] },
      { source: "/api/:path*", headers: [noIndex] },
      { source: "/scan/:path+", headers: [noIndex] },
      { source: "/coverage-check/:path+", headers: [noIndex] },
      // A hub blog post's draft, read by its preview key (16 Oct 2026, lib/hub-posts.ts).
      { source: "/blog-preview/:path+", headers: [noIndex] },
      { source: "/admin/:path*", headers: [noIndex] },
      // The client dashboard (T3, 29 Sep 2026). `:path*` so /app itself is covered.
      { source: "/app/:path*", headers: [noIndex] },
      // The order form and its confirmation (R91, 29 Sep 2026): an order in progress.
      { source: "/checkout/:path*", headers: [noIndex] },
      /**
       * The dashboard's own host (APP_HOST, 8 Oct 2026): nothing on it is
       * meant to be framed, the marketing site included, so frame-ancestors
       * is 'none' there. Last, so it overrides the site-wide CSP above. Read
       * at build: absent while APP_HOST is unset, which is production today;
       * setting APP_HOST in Vercel takes a redeploy, and that build adds it.
       * The proxy could not do this - this header is applied after it runs.
       */
      ...(APP_HOSTNAME
        ? [{ source: "/:path*", has: [{ type: "host" as const, value: APP_HOSTNAME.replace(/\./g, "\\.") }], headers: [{ key: "content-security-policy", value: CSP.replace("frame-ancestors 'self'", "frame-ancestors 'none'") }, noIndex] }]
        : []),
    ];
  },
};

export default nextConfig;
