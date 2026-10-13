import type { MetadataRoute } from "next";

import { SITE_URL as BASE_URL } from "@/config/schema";

/**
 * The sitemap.
 *
 * Every entry used to carry `lastModified: new Date()`, which made all 21
 * URLs report the moment of the build. Today that happens to be true - the
 * whole site was rebuilt on 19 September - and from tomorrow it is a lie that
 * repeats on every deploy. A lastmod that always says "just now" is not a
 * weak signal, it is a discarded one: a crawler that finds the field
 * unreliable stops reading it for the whole site, and this is a site whose
 * product is being read accurately by crawlers.
 *
 * So the dates are literals. Three of the four blog entries show an edit date
 * rather than their April publication date because their copy was edited then
 * - lastmod is the last change, not the byline.
 *
 * The rule, for whoever edits a page next: change the copy on a route,
 * change its date here. A date that is stale by a week says less than one
 * that is wrong by four months, and far more than one that is always now.
 *
 * **That rule went stale in under 24 hours.** Written on 19 September with all
 * 21 entries dated that day; by the morning of the 20th, 19 of the 21 routes
 * had a page file with a newer commit against it and not one date here had
 * moved. So read the list below as maintained by hand and therefore behind,
 * not as measured.
 *
 * Two things were tried and rejected before leaving it hand-written:
 *
 *  - **Deriving lastmod from `git log` on the route's own page file.** Wrong
 *    in both directions at once. It is blind to copy that lives in a shared
 *    component - the tier lockups in `PackagePage` change four package pages
 *    and touch none of their files - and it fires on presentational churn,
 *    because a motion sweep that adds `ac-row` to every page on the site would
 *    bump all 21 dates without a word of copy changing. A field that moves on
 *    every deploy is the `new Date()` failure again, arrived at slowly.
 *  - **Deriving it from the rendered HTML.** Right in principle and it needs a
 *    committed hash manifest plus a test that regenerates it, because there is
 *    no `.git` on Vercel at build time. Worth doing; not done.
 *
 * What IS enforced is the set, in `sitemap.test.mts`: these URLs must be
 * exactly the canonical URLs the site declares indexable, both directions, and
 * none of them may be a path `robots.ts` closes. That closes the silent half -
 * a new page never reaching the sitemap at all - and leaves only the dates
 * approximate. `sitemap.test.mts` deliberately does not check lastmod, for the
 * reasons above; do not "fix" that by wiring it to `git log`.
 */
type Entry = [path: string, lastModified: string, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"], priority: number];

/**
 * The 20 September dates below are the routes whose *copy* changed that day,
 * separated by hand from the ten whose page files changed the same day for
 * motion classes only. Presentation is not a content change and does not earn
 * a lastmod. Where the change was in a shared component the commit is named,
 * because no per-file measurement can find it again:
 *
 *   /                     RequestScanForm engine list 3a6763e, Results d2c6511
 *   the four tier pages   tier lockups in PackagePage, d2c6511
 *   /alwayseverywhere     and its deliverables table, 1d4c980
 *   the three posts       tier lockups d2c6511, the closing CTA 1e19367
 *   .../why-most-...      and the vendor-citation claim, a52b08b
 *   /case-studies/vibe-retail   undated competitor names cut, edc6104
 *   /coverage-check       engine count 922b3aa, CoverageForm a6b6d84/a22129b
 *   /contact              ContactForm refusal copy, a22129b
 */
const ENTRIES: Entry[] = [
  ["", "2026-09-20", "weekly", 1.0],
  ["/packages", "2026-09-28", "monthly", 0.9],
  ["/alwaystracked", "2026-09-20", "monthly", 0.9],
  ["/alwaysmentioned", "2026-09-20", "monthly", 0.9],
  ["/alwayscited", "2026-09-20", "monthly", 0.9],
  ["/alwayseverywhere", "2026-09-20", "monthly", 0.8],
  ["/what-is-aeo", "2026-09-19", "monthly", 0.9],
  ["/how-it-works", "2026-09-19", "monthly", 0.9],
  ["/case-studies", "2026-09-19", "monthly", 0.8],
  ["/case-studies/vibe-retail", "2026-09-20", "monthly", 0.8],
  ["/blog", "2026-09-19", "weekly", 0.7],
  ["/blog/best-ai-seo-agencies", "2026-09-28", "monthly", 0.6],
  ["/blog/how-llms-pick-which-brands-to-recommend", "2026-09-20", "monthly", 0.6],
  ["/blog/aeo-vs-seo-whats-actually-different", "2026-09-20", "monthly", 0.6],
  ["/blog/why-most-aeo-audits-are-a-waste-of-money", "2026-09-20", "monthly", 0.6],
  ["/compare", "2026-09-19", "monthly", 0.8],
  ["/white-label", "2026-09-19", "monthly", 0.8],
  ["/seo-agencies", "2026-09-19", "monthly", 0.8],
  ["/pr-agencies", "2026-09-19", "monthly", 0.8],
  ["/coverage-check", "2026-09-20", "monthly", 0.7],
  ["/llm-visibility-checker", "2026-09-28", "monthly", 0.8],
  // The help centre (MK-2, 9 Oct 2026): written that day from the code.
  ["/help", "2026-10-09", "monthly", 0.6],
  ["/help/getting-started", "2026-10-09", "monthly", 0.5],
  ["/help/clusters", "2026-10-09", "monthly", 0.5],
  ["/help/daily-check", "2026-10-09", "monthly", 0.5],
  ["/help/dashboard", "2026-10-09", "monthly", 0.5],
  ["/help/team", "2026-10-09", "monthly", 0.5],
  ["/help/trial-and-cancelling", "2026-10-09", "monthly", 0.5],
  ["/help/billing", "2026-10-09", "monthly", 0.5],
  // 13 Oct 2026: the walkthrough paragraph now names the name, category and market it stores.
  ["/legal", "2026-10-13", "yearly", 0.3],
  ["/about", "2026-09-19", "yearly", 0.5],
  ["/contact", "2026-09-20", "yearly", 0.5],
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ENTRIES.map(([path, lastModified, changeFrequency, priority]) => ({
    url: BASE_URL + path,
    lastModified: new Date(lastModified),
    changeFrequency,
    priority,
  }));
}
