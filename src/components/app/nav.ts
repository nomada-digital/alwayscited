/**
 * Where each dashboard nav item goes (R130, Danny, 30 Sep 2026, danny.md 119).
 * A string is the route under /app/[client] ("" is the overview); SOON is an
 * item whose page is not built, drawn disabled with "Coming soon". Every item
 * the sidebar or the phone tabs draw has an entry here, and nav.test.mts
 * (R131) holds each string to a real route and each built route to an item.
 *
 * Plain module, relative imports only, so node --test can load it.
 */

import { appPath } from "../../lib/app-host.ts";

export const SOON = null;

// R97 part 3 (30 Sep 2026; BRIEF-2 T13): Placements shows only on a client with
// a placed cluster - the Sidebar drops it otherwise (PLACEMENTS_ITEM).
export const PLACEMENTS_ITEM = "Placements";

/**
 * 13 Oct 2026, DIY P5 (spec 10 section 3.1, "after W1"): the nav in groups.
 * Overview stands alone, then Results, Do and Manage. A group label is a
 * label in MICRO and sentence case, never a link and never an item.
 * "Actions" is the client's word for the Plan (spec section 1.1 row 33): the
 * route stays /plan, and nav.test.mts pins the word. Wave 2 adds Google to
 * Results and Opportunities and Your pages to Do; wave 3 adds Links to Do -
 * each only once its page is built (R146).
 * 13 Oct 2026, DIY P9 (spec 10 section 3.1, "after W2"): Google sits second
 * in Results, after AI visibility; Opportunities follows Actions in Do, then
 * Your pages, then Placements, leaving Links' place (wave 3) between
 * Opportunities and Your pages.
 */
export const GROUPS: readonly { label: string | null; items: readonly string[] }[] = [
  { label: null, items: ["Overview"] },
  { label: "Results", items: ["AI visibility", "Google", "Who is named", "Cited pages"] },
  { label: "Do", items: ["Actions", "Opportunities", "Your pages", PLACEMENTS_ITEM] },
  { label: "Manage", items: ["Clusters", "Reports", "Settings"] },
];

// R141 (1 Oct 2026; BRIEF-4 P1): the flat client's Google keywords / Keywords
// item is gone. Every client is grouped or has the Overview's ungrouped state
// (R138), and the keyword lives on its cluster card.
// 13 Oct 2026, DIY P5: both lists are the groups read in order; the flat
// client's leaves Placements out, as it always has. Same groups, same order.
export const CLUSTER_NAV: readonly string[] = GROUPS.flatMap((g) => g.items);
export const NAV: readonly string[] = CLUSTER_NAV.filter((n) => n !== PLACEMENTS_ITEM);

/**
 * The phone's four tabs, then More (spec 10 section 3.2, after W1: Overview,
 * AI, Actions, Clusters). The tab for AI visibility reads "AI" (TAB_LABEL):
 * it is the same item and the same page, so it is current on the AI
 * visibility page. 13 Oct 2026, DIY P5: Reports and Settings move into More.
 * 13 Oct 2026, DIY P9 (spec 10 section 3.2, final): Overview, AI, Google,
 * Actions. Clusters moves into More, under Manage.
 */
export const TABS: readonly string[] = ["Overview", "AI visibility", "Google", "Actions"];
export const CLUSTER_TABS: readonly string[] = TABS;

/** A tab's shorter word, where the item's own does not fit a fifth of a phone. */
export const TAB_LABEL: Readonly<Record<string, string>> = { "AI visibility": "AI" };

/** The group an item sits in, or null for Overview's ungrouped head. */
export function groupOf(item: string): string | null {
  return GROUPS.find((g) => g.items.includes(item))?.label ?? null;
}

export const NAV_TARGET: Record<string, string | typeof SOON | undefined> = {
  Overview: "",
  // 13 Oct 2026, DIY P5: AI visibility (P4, spec 10 section 4.2).
  "AI visibility": "/ai",
  // R143 (1 Oct 2026; BRIEF-4 P3).
  "Who is named": "/named",
  // R144 (1 Oct 2026; BRIEF-4 P4).
  "Cited pages": "/cited",
  // 13 Oct 2026, DIY P9: Google (P6, spec 10 section 4.3).
  Google: "/google",
  // 13 Oct 2026, DIY P5: Actions, internally the Plan (P3, spec 10 section 4.6).
  Actions: "/plan",
  // 13 Oct 2026, DIY P9: Opportunities (P7, spec 10 section 4.7) and Your pages (P8, spec 10 section 4.9).
  Opportunities: "/opportunities",
  "Your pages": "/pages",
  Placements: "/placements",
  Clusters: "/clusters",
  // R145 (1 Oct 2026; BRIEF-4 P5).
  Reports: "/reports",
  Settings: "/settings",
};

/** The href for an item on this client, or null when it is not built. */
export function navHref(item: string, slug: string): string | null {
  const t = NAV_TARGET[item];
  return typeof t === "string" ? appPath(`/${slug}${t}`) : null;
}

/**
 * R132 (Danny, 30 Sep 2026, danny.md 121): the Overview cards whose full page
 * is a nav item. Each links there once the page is built and until then shows
 * "Coming soon" unlinked, as the sidebar does; nav.test.mts holds the pairing.
 */
export const SEE_ALL = { "Who is named instead": "Who is named", "Pages the engines cite most": "Cited pages" } as const;

/** The same, from a path already under the client (`/app/<slug>`). */
export function navFrom(item: string, clientPath: string): string | null {
  const t = NAV_TARGET[item];
  return typeof t === "string" ? `${clientPath}${t}` : null;
}

/**
 * The "+ Add" menu (13 Oct 2026, DIY P5; spec 10 section 3.1): links to forms
 * that already exist, so it adds no route. Wave 1's three. Wave 2 adds "Add a
 * page to check" (/pages#add) and "Log a site I found" (/opportunities#log).
 *
 * "Add a prompt" goes to Clusters, not to the spec's `/clusters#free-slot`: a
 * free slot is drawn only inside an opened cluster card, so there is no one
 * anchor to land on before the swap explainer arrives with P7 in wave 2.
 * 13 Oct 2026, DIY P9: still Clusters. P7's swap picker lives on one
 * opportunity (its prompt step), not on Clusters, so there is still no single
 * free-slot anchor to land on.
 *
 * 13 Oct 2026, DIY P9: wave 2's two. "Add a page to check" lands on Your pages'
 * add form (paths.ts ADD_ANCHOR, `id="add"`); "Log a site I found" on
 * Opportunities' Log a site form (`id="log"`). nav.test.mts holds both anchors.
 */
/** Your pages' add form's id (P8's paths.ts ADD_ANCHOR), spelt here so this module stays node-loadable; nav.test.mts holds the two equal. */
export const PAGES_ADD_ANCHOR = "add";

export const ADD_ITEMS: readonly { label: string; route: string; query?: Record<string, string>; hash?: string }[] = [
  { label: "Add a keyword", route: "/clusters", query: { add: "1" } },
  { label: "Add a prompt", route: "/clusters" },
  { label: "Add a task", route: "/plan", query: { view: "list" }, hash: "#new-task" },
  { label: "Add a page to check", route: "/pages", hash: `#${PAGES_ADD_ANCHOR}` },
  { label: "Log a site I found", route: "/opportunities", hash: "#log" },
];

/**
 * An Add item's href on this client. `keep` is the sidebar's stated range
 * (rangeQuery's "?from=&to=&compare=" or ""), carried as every nav link
 * carries it (DS38), so Add a keyword on a 7-day Clusters stays on 7 days.
 */
export function addHref(item: (typeof ADD_ITEMS)[number], slug: string, keep = ""): string {
  const q = new URLSearchParams({ ...item.query, ...Object.fromEntries(new URLSearchParams(keep.replace(/^\?/, ""))) }).toString();
  return appPath(`/${slug}${item.route}${q ? `?${q}` : ""}${item.hash ?? ""}`);
}
