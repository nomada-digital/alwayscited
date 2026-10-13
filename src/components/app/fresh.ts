/**
 * How long, in seconds, a dashboard page the browser already holds may be
 * drawn again without asking the server (13 Oct 2026, dashboard speed work).
 *
 * Measured on production that day: a page render costs 0.7-1.9 s, about 20-25
 * PostgREST round trips, and every sidebar click paid it in full, because
 * every /app/[client] page is force-dynamic and Next 16.3.5 keeps a dynamic
 * page in the client router for 0 s. The cure has three parts, and the
 * number is written in three places that must agree (next.config.ts, every
 * page, FreshGuard via this constant):
 *
 *  - The sidebar's nav links (Sidebar.tsx: desktop nav, phone tabs, More's
 *    sheet) are `prefetch={true}`. As each comes into view its whole page is
 *    rendered and held complete, so the click makes no request at all
 *    (segment-cache/cache.js 1955-1958; ppr-navigations.js 696-705). A Full
 *    prefetch lives for `experimental.staleTimes.static`, which next.config.ts
 *    states as this number (cache.js 2575-2597: a dynamic response carries no
 *    stale time of its own, so the static one applies).
 *  - Every page under /app/[client] exports `unstable_dynamicStaleTime` as
 *    this number, so a page reached any other way - a chip, a row, a detail -
 *    is redrawn from memory on a revisit inside the window (bfcache.js 50-51;
 *    ppr-navigations.js 563-576). It has to be a numeric literal in each page:
 *    Next reads it statically at build (get-page-static-info.js 459-466), and
 *    an imported name is an "unsupported value" there. So the pages repeat
 *    300 and src/components/app/prefetch.test.mts holds them equal to this.
 *    Per page rather than a global staleTimes.dynamic, which would also reach
 *    the marketing site and checkout.
 *  - FreshGuard.tsx calls router.refresh() once this long has passed since the
 *    last purge, so nothing drawn from memory is much older than this, however
 *    a member hops between cached pages (cache.js 774-801 lets a Full prefetch
 *    re-use a visited page's data, restamped on each visit).
 *
 * Measured on the production build on the fixture, 13 Oct 2026: at 1280 wide
 * the Overview's load sends one Full prefetch per visible nav item - 12, the
 * page on screen included - and none for the hidden phone shell; at 390 wide,
 * 4, the tabs, and none for More's closed sheet. A tab click then draws in about 75 ms with no request to the
 * server, Back and a revisit inside the window with none either. The cost to
 * know: nav hrefs carry the stated range (`keep`), and the in-page chips state
 * it even when it is the default, so the first chip clicked re-prefetches all
 * 12 under the range's URLs.
 *
 * What it does not change: a member's own change is a native form POST that
 * ends in a 303 and a whole new document, which starts every client cache
 * empty. Back and forward were already drawn from memory before this. With JS
 * off none of it exists, and every click is a full server render as before.
 */
export const FRESH_SECONDS = 300;
