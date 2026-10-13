/**
 * /app wiring census (R131, Danny, 30 Sep 2026, danny.md 120). Walks every
 * page under src/app/app/[client]/ and fails if
 *  (a) a built static route has no nav item pointing at it,
 *  (b) a nav or tab item is neither a link to a built route nor explicitly
 *      SOON (drawn disabled, "Coming soon"), or the sidebar draws an item
 *      some other way than those two,
 *  (c) an in-page link to /app/<client>/... in the dashboard's code points at
 *      a route that does not exist.
 * Dynamic detail routes ([cluster]) need no nav item; they are reached from
 * their list page, which (c) holds.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ADD_ITEMS, CLUSTER_NAV, CLUSTER_TABS, GROUPS, NAV, NAV_TARGET, PLACEMENTS_ITEM, SEE_ALL, SOON, TABS, TAB_LABEL, groupOf } from "./nav.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const CLIENT = join(ROOT, "src", "app", "app", "[client]");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Routes under /app/[client], as suffixes with dynamic segments as "[]": "", "/clusters", "/clusters/[]". */
const ROUTES = walk(CLIENT)
  .filter((f) => /[\\/]page\.tsx$/.test(f))
  .map((f) => relative(CLIENT, f).split(sep).slice(0, -1))
  .map((segs) => segs.map((s) => (/^\[.+\]$/.test(s) ? "[]" : s)))
  .map((segs) => (segs.length ? "/" + segs.join("/") : ""));
/**
 * Static routes that are deliberately not in the nav, each with its reason.
 * 1 Oct 2026, R166 part 3b: /setup is a one-off step a new client passes
 * through after sign-in (danny.md line 175), not a page to return to.
 */
const OFF_NAV: Record<string, string> = {
  "/setup": "onboarding step reached from the sign-in landing, not a dashboard page",
};
const STATIC = ROUTES.filter((r) => !r.includes("[]") && !Object.hasOwn(OFF_NAV, r));

test("every off-nav route is a built route", () => {
  assert.deepEqual(Object.keys(OFF_NAV).filter((r) => !ROUTES.includes(r)), []);
});

/**
 * Floors, 30 Sep 2026: 3 routes (overview, clusters, one cluster), 8 distinct nav and tab items (the 7 nav plus the phone's Keywords).
 * Raised 30 Sep 2026 (R97 part 3, T13): 4 routes (placements) and 9 items (Placements, cluster nav only).
 * Lowered 1 Oct 2026 (R141, BRIEF-4 P1): 7 items - Google keywords and the phone's Keywords are removed
 * on purpose (the keyword lives on its cluster card); the test below holds that they stay gone.
 * Raised 13 Oct 2026 (DIY P5, wave 1): 12 routes - the eight static pages, /setup, the one-cluster page, the
 * catch-all, and the DIY wave's /ai and /plan; 9 items - AI visibility and Actions join the seven.
 */
const ROUTE_FLOOR = 12;
const ITEM_FLOOR = 9;

const ITEMS = [...new Set<string>([...NAV, ...TABS, ...CLUSTER_NAV, ...CLUSTER_TABS])];

test("census floor: the walk still finds the routes and the items", () => {
  assert.ok(ROUTES.length >= ROUTE_FLOOR, `${ROUTES.length} routes walked, floor ${ROUTE_FLOOR}`);
  assert.ok(ITEMS.length >= ITEM_FLOOR, `${ITEMS.length} items, floor ${ITEM_FLOOR}`);
});

test("(a) every built static route under /app/[client] has a nav item", () => {
  const targeted = new Set(Object.values(NAV_TARGET).filter((t): t is string => typeof t === "string"));
  const orphans = STATIC.filter((r) => !targeted.has(r));
  assert.deepEqual(orphans, [], `built routes with no nav item: ${orphans.join(", ")}`);
});

test("(b) every nav and tab item is a link to a built route or explicitly Coming soon", () => {
  const bad = ITEMS.filter((item) => {
    const t = NAV_TARGET[item];
    if (t === SOON && Object.hasOwn(NAV_TARGET, item)) return false;
    return typeof t !== "string" || !ROUTES.includes(t);
  });
  assert.deepEqual(bad, [], `items neither linked nor disabled: ${bad.join(", ")}`);
});

// R146 (1 Oct 2026; BRIEF-4 P6): with Who is named, Cited pages, Reports and
// Settings built (R142-R145), no sidebar item or phone tab is Coming soon any
// more. A new item arrives linked or not at all.
test("(b) R146: no sidebar item or phone tab is Coming soon", () => {
  const soon = ITEMS.filter((item) => NAV_TARGET[item] === SOON);
  assert.ok(ITEMS.length >= 7, `${ITEMS.length} items, floor 7`);
  assert.deepEqual(soon, [], `still Coming soon: ${soon.join(", ")}`);
  for (const p of ["/named", "/cited", "/reports", "/settings"]) assert.ok(ROUTES.includes(p), `${p} is not built`);
});

test("(b) the sidebar draws an item only as a link or as a disabled Coming soon", () => {
  const src = readFileSync(join(ROOT, "src", "components", "app", "Sidebar.tsx"), "utf8");
  assert.doesNotMatch(src, /href \? "a" : "span"/, "the old plain-text fallback is back");
  assert.match(src, /navHref\(/, "hrefs come from nav.ts");
  assert.match(src, /aria-disabled/, "an unbuilt item is marked disabled");
  assert.match(src, /Coming soon/);
});

/** In-page /app links in the dashboard's code, as route suffixes. */
function inPageLinks(): { file: string; route: string }[] {
  const dirs = [join(ROOT, "src", "components", "app"), join(ROOT, "src", "app", "app")];
  const out: { file: string; route: string }[] = [];
  for (const f of dirs.flatMap(walk).filter((f) => /\.tsx?$/.test(f))) {
    const text = readFileSync(f, "utf8");
    // M1 (6 Oct 2026): a dashboard link is appPath(`/${slug}/...`) rather
    // than a `/app/${slug}/...` literal, because the prefix comes off on
    // app.alwayscited.com. The route this sweep reads is the part after the
    // slug, which has not moved.
    for (const m of text.matchAll(/appPath\(`\/\$\{[^}]+\}((?:\/(?:[a-z-]+|\$\{[^}]+\}))*)/g)) {
      const route = m[1].replace(/\$\{[^}]+\}/g, "[]");
      out.push({ file: relative(ROOT, f), route });
    }
  }
  return out;
}

test("(c) every in-page /app/<client>/... link points at a built route", () => {
  const links = inPageLinks();
  assert.ok(links.length >= 4, `${links.length} in-page links found; the matcher has drifted`);
  const dead = links.filter((l) => !ROUTES.includes(l.route)).map((l) => `${l.file}: /app/[client]${l.route}`);
  assert.deepEqual(dead, [], `links to routes that do not exist:\n${dead.join("\n")}`);
});

/**
 * R132 (Danny, 30 Sep 2026, danny.md 121): the Overview's own links. They are
 * built from the clustersPath prop rather than a `/app/${slug}` literal, so (c)
 * cannot see them; this holds them to the one-cluster route instead.
 */
test("(c) R132: Overview cluster cards and prompt rows open the one-cluster page", () => {
  const src = readFileSync(join(ROOT, "src", "components", "app", "Overview.tsx"), "utf8");
  const page = readFileSync(join(CLIENT, "page.tsx"), "utf8");
  assert.match(page, /clustersPath=\{appPath\(`\/\$\{slug\}\/clusters`\)\}/, "the Overview is handed the Clusters route");
  assert.ok(ROUTES.includes("/clusters/[]"), "the one-cluster route is built");
  // `${clustersPath}/${encodeURIComponent(id)}?...` is /clusters/[]: the chart's Open cluster and R132's detailHref.
  const detail = src.match(/`\$\{clustersPath\}\/\$\{encodeURIComponent\([^)]+\)\}\?/g) ?? [];
  assert.ok(detail.length >= 2, `${detail.length} one-cluster links built in Overview.tsx, floor 2`);
  assert.match(src, /href=\{detail\(c\.id\)\}/, "a cluster card opens its cluster");
  assert.match(src, /href=\{detail\(c\.id, i\)\}/, "a prompt row opens its cluster on that prompt");
  assert.match(src, /href=\{detailHref \?\? clusterHref\}/, "a phone cluster row opens its cluster");
});

test("(b) R132: each Overview card with a full page links to it, or says Coming soon unlinked", () => {
  const src = readFileSync(join(ROOT, "src", "components", "app", "Overview.tsx"), "utf8");
  const cards = Object.entries(SEE_ALL);
  assert.ok(cards.length >= 2, `${cards.length} cards, floor 2`);
  for (const [card, item] of cards) {
    assert.ok(Object.hasOwn(NAV_TARGET, item), `${card} points at nav item ${item}, which nav.ts does not know`);
    const t = NAV_TARGET[item];
    assert.ok(t === SOON || ROUTES.includes(t!), `${item} is neither built nor Coming soon`);
    assert.ok(src.includes(`<SeeAll card="${card}"`), `the ${card} card draws no link to its page`);
  }
  assert.match(src, /navFrom\(SEE_ALL\[card\]/, "the card link comes from nav.ts");
  assert.match(src, /aria-disabled="true"[\s\S]{0,400}Coming soon/, "an unbuilt page is drawn disabled");
});

test("R141: no Keywords item on a flat or a cluster client", () => {
  for (const list of [NAV, TABS, CLUSTER_NAV, CLUSTER_TABS] as readonly (readonly string[])[]) {
    assert.ok(!list.some((n) => /keywords/i.test(n)), `a keywords item is back: ${list.join(", ")}`);
  }
  assert.ok(!Object.keys(NAV_TARGET).some((n) => /keywords/i.test(n)), "NAV_TARGET still routes a keywords item");
});

/**
 * 13 Oct 2026, DIY P5 (spec 10 sections 1.1 row 33, 3.1 and 3.2): the wave 1 nav, recorded. Overview alone,
 * then Results, Do and Manage, each a label and never a link. Wave 2 adds Google to Results and Opportunities
 * and Your pages to Do, and moves this fact with its date; wave 3 adds Links to Do.
 */
test("DIY W1: the nav is in its groups, in order, and a group label is never an item", () => {
  assert.deepEqual(
    GROUPS.map((g) => [g.label, [...g.items]]),
    [
      [null, ["Overview"]],
      ["Results", ["AI visibility", "Who is named", "Cited pages"]],
      ["Do", ["Actions", PLACEMENTS_ITEM]],
      ["Manage", ["Clusters", "Reports", "Settings"]],
    ],
  );
  assert.deepEqual([...CLUSTER_NAV], GROUPS.flatMap((g) => g.items), "the clustered client's nav is the groups read in order");
  assert.deepEqual([...NAV], CLUSTER_NAV.filter((n) => n !== PLACEMENTS_ITEM), "the flat client's nav is the same groups, Placements aside");
  for (const item of ITEMS) assert.equal(GROUPS.filter((g) => g.items.includes(item)).length, 1, `${item} is in one group exactly`);
  for (const g of GROUPS) {
    if (g.label === null) continue;
    assert.ok(!Object.hasOwn(NAV_TARGET, g.label), `the group label ${g.label} is routed like an item`);
    assert.match(g.label, /^[A-Z][a-z ]*$/, `${g.label}: group labels are sentence case, never upper case`);
  }
  assert.equal(groupOf("Actions"), "Do");
  assert.equal(groupOf("Overview"), null);
});

test("DIY W1: Actions is the client's word for the Plan, and the route keeps /plan", () => {
  assert.equal(NAV_TARGET.Actions, "/plan");
  assert.ok(ROUTES.includes("/plan"), "the Actions page is built");
  for (const list of [NAV, TABS, CLUSTER_NAV, CLUSTER_TABS] as readonly (readonly string[])[]) {
    assert.ok(list.includes("Actions"), `Actions is missing from ${list.join(", ")}`);
    assert.ok(!list.some((n) => /^plan$/i.test(n) || /^your plan$/i.test(n)), "the nav says Plan, which the sidebar's plan card and the alwayscited plan already use");
  }
  assert.equal(NAV_TARGET["AI visibility"], "/ai");
  assert.ok(ROUTES.includes("/ai"), "the AI visibility page is built");
});

test("DIY W1: the phone's tabs are Overview, AI, Actions, Clusters, then More", () => {
  assert.deepEqual([...TABS], ["Overview", "AI visibility", "Actions", "Clusters"]);
  assert.deepEqual([...CLUSTER_TABS], [...TABS]);
  assert.deepEqual(TABS.map((t) => TAB_LABEL[t] ?? t), ["Overview", "AI", "Actions", "Clusters"]);
  for (const t of Object.keys(TAB_LABEL)) assert.ok(TABS.includes(t), `TAB_LABEL shortens ${t}, which is not a tab`);
  const src = readFileSync(join(ROOT, "src", "components", "app", "Sidebar.tsx"), "utf8");
  assert.ok(src.includes("{TAB_LABEL[item] ?? item}"), "the tab draws its short word");
  assert.ok(src.includes("moreGroups.map("), "More's sheet lists the groups");
});

test("DIY W1: every + Add item opens a built page, and the sidebar gates it on writeRole", () => {
  assert.deepEqual(
    ADD_ITEMS.map((a) => a.label),
    ["Add a keyword", "Add a prompt", "Add a task"],
  );
  for (const a of ADD_ITEMS) assert.ok(ROUTES.includes(a.route), `${a.label} opens ${a.route}, which is not built`);
  const src = readFileSync(join(ROOT, "src", "components", "app", "Sidebar.tsx"), "utf8");
  assert.ok(src.includes("const canAdd = refuseRole(writeRole({ role, status: client.status })) === null;"), "+ Add is not gated as the writes are");
  assert.match(src, /aria-disabled="true" aria-describedby="add-why"/, "a viewer's + Add is not drawn disabled with its reason");
  assert.ok(src.includes('{item === "Actions" && client.id ? <ActionsBadge clientId={client.id} /> : null}'), "the Actions badge is not drawn");
});

test("census probe: an orphan route, a plain item and a dead link each fire", () => {
  assert.ok(!Object.hasOwn(NAV_TARGET, "Nowhere"), "an item with no entry is neither linked nor disabled");
  // 1 Oct 2026, R145: /reports is built now, so the probe's unbuilt page is one nobody has planned.
  assert.ok(ROUTES.includes("/reports"), "R145 built /reports");
  assert.ok(!ROUTES.includes("/nowhere"), "a link to an unbuilt page is dead");
  assert.ok(STATIC.includes("/clusters"));
});
