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
 *    sheet) are NavLinks, `prefetch={true}` but for the page on screen. As
 *    each comes into view its whole page is rendered and held complete, so
 *    the click makes no request at all
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
 * 12 under the range's URLs. Review, same day: NavLink leaves out the page on
 * screen - 11 on that load, 3 at 390 wide, and a FreshGuard purge is the
 * page's own render and 11. The chip's 12 were its own navigation and 11,
 * and still are; the chips stating the default range is the pages' to
 * change, and is not changed here.
 *
 * When a read fails (review, 13 Oct 2026). A render that throws is held like
 * one that did not: the Full prefetch of it answers 200 with the error inside
 * the payload, and Next rejects a prefetch only on a response that is not ok
 * (cache.js 1981-1986). Two shapes:
 *
 *  - The whole page failed, drawn by src/app/app/[client]/error.tsx. As it is
 *    drawn it calls router.refresh(), which empties the router's memory, so
 *    the next click on any page asks the server again. Not in the document's
 *    first render (FreshGuard's firstRenderDone), when the memory is empty and
 *    a refresh answered not-ok would reload the document round and round, and
 *    not when Try again drew it, having just refreshed. Measured on the
 *    unreadable fixture: a click on a failed tab draws the failure, then one
 *    render; the same tab again asks again; Try again is one render.
 *  - One section failed and says so ("We couldn't read this part just now",
 *    or its own words). That page is held as drawn, so leaving it and coming
 *    back inside the window shows the same notice without asking again, for
 *    up to FRESH_SECONDS. A reload asks again, and so does any purge -
 *    FreshGuard's, or the error boundary's. Left so on purpose: a refresh
 *    from a page with the sidebar on it re-renders that page and prefetches
 *    every other nav link in view again, 12 renders at 1280 wide, so
 *    recovering a section by itself would multiply the reads during the very
 *    incident that failed it. prefetch.test.mts holds this paragraph and
 *    error.tsx's refresh.
 *
 * What it does not change: a member's own change is a native form POST that
 * ends in a 303 and a whole new document, which starts every client cache
 * empty. Back and forward were already drawn from memory before this. With JS
 * off none of it exists, and every click is a full server render as before.
 */
export const FRESH_SECONDS = 300;
