import type { MetadataRoute } from "next";

import { ROBOTS_AGENTS } from "@/config/robots-agents";

/**
 * What a crawler may read.
 *
 * Two kinds of path are closed here, and the reason is different for each.
 *
 * `/scan/<token>` is somebody's own result. The page server-renders their
 * brand, domain, positioning and - once unlocked - the whole paid report into
 * the HTML. It has carried a noindex, nofollow tag since it was built, and
 * that is the right tag, but a meta tag is a directive about indexing,
 * addressed to search engines. The eight agents named below are governed by
 * this file, and until now this file said Allow / to every one of them by
 * name. A scan link that reached anywhere public - an unfurl, a forwarded
 * mail in an archived list - was fetchable by all of them.
 *
 * The disallow is on /scan/ with the trailing slash, so the /scan entry page
 * itself stays open: it is the target of the no-JS GET forms on the home page
 * and the posts, and a disallowed URL that is linked from the site gets
 * listed as a bare address, which is worse than the noindex it already
 * carries.
 *
 * `/coverage-check/<token>` is the same page one product along, and it was
 * missing from this list until 20 September. Its own source says "Every one of
 * these is somebody's own campaign, with a client brand and an uploaded
 * coverage list on it" - word for word the exposure the paragraph above
 * describes - and it shipped with the noindex meta tag alone, because the
 * campaign benchmark was built after this file and nothing here can see a
 * route appear. Closed on the same trailing slash and for the same reason, so
 * the bare `/coverage-check` entry page stays open and in the sitemap.
 * `route-closure.test.mts` now derives the whole set from source and fails
 * when the next private route arrives with one of its three closures.
 *
 * /api/ returns the same data as JSON and carries no tag at all.
 *
 * /admin/ answers 401 to everyone via proxy.ts, so that line changes nothing
 * today. It is here so that the day the auth moves, the crawl rule does not
 * have to be remembered separately.
 *
 * `/app` is the alwaystracked client dashboard (T3, 29 Sep 2026): a client's
 * own figures behind a login. No trailing slash, so `/app` itself is closed
 * as well as everything under it; nothing public on this site starts with it.
 *
 * `/checkout` is an order in progress (R91, 29 Sep 2026): the order form and,
 * after payment, its confirmation. Closed the same way as `/app`.
 */
// `/blog-preview/` (16 Oct 2026) is a hub blog post's draft, reachable only by its preview key.
// `/partners` (29 Oct 2026) is an agency's own landing page, linked to by that agency and never by this site.
const CLOSED = ["/scan/", "/coverage-check/", "/blog-preview/", "/api/", "/admin/", "/app", "/checkout", "/dashboards", "/partners"];

// The named crawlers, shared with the dashboard host's robots.txt in proxy.ts (8 Oct 2026).
const AGENTS = ROBOTS_AGENTS;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: AGENTS.map((userAgent) => ({
      userAgent,
      allow: "/",
      disallow: CLOSED,
    })),
    sitemap: "https://alwayscited.com/sitemap.xml",
  };
}
