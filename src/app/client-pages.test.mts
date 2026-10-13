/**
 * /app/[client] page census (R146 part 2, BRIEF-4 P6; Danny, 30 Sep 2026,
 * danny.md line 134). Walks every page.tsx under src/app/app/[client]/ and
 * holds, for each one:
 *  (a) noindex in its own metadata, as well as the layout's (the header rule
 *      and robots.txt are route-closure.test.mts's);
 *  (b) no session is a redirect to /app/login, never a render;
 *  (c) the membership 404: the client is found only among the session's own
 *      clients, and a slug that is not one of them is notFound();
 *  (d) every query key the page reads is registered below with the line in the
 *      page that bounds it - a whitelist, a match against this client's own
 *      rows, a clamp, or a named reader whose own test owns the bound. A new
 *      key, or a bound that stops being in the file, fails;
 *  (e) a page that hands the whole query to a helper names that helper in
 *      READERS, so no key is read where this census cannot see it.
 * Write affordances are role-gated in the routes (spend-gates, route-callers,
 * refuseRole); a page's own role reads are held under (f).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CLIENT = join(ROOT, "src", "app", "app", "[client]");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** "" for the overview, "/named", "/clusters/[cluster]". */
const PAGES = new Map(
  walk(CLIENT)
    .filter((f) => /[\\/]page\.tsx$/.test(f))
    .map((f) => {
      const segs = relative(CLIENT, f).split(sep).slice(0, -1);
      return [segs.length ? "/" + segs.join("/") : "", readFileSync(f, "utf8")] as const;
    }),
);

/** Helpers a page may hand the whole query to, and the keys each owns, with the test that holds the bound. */
const READERS: Record<string, string> = {
  // 8 Oct 2026 (audit perf-8): a stated from is also held to the first of the month a year back, or of tracking's
  // first month when older - read-shape.test.mts. The month, not the day, so Reports' month cards' CSV links are never cut (review, same day).
  "rangeFrom(sp,": "from, to, compare - clamped to real days, the three compare modes and rangeFloor; read-shape.test.mts holds the floor",
  // DS38, 2 Oct 2026 (R173 pass 4): the nav's links carry the stated range - rangeFrom's own reading, re-serialised.
  "rangeQuery(sp,": "from, to, compare again, through rangeFrom, written back only where stated, for the nav links",
  "placementsScreen(repo, client, sp,": "from, to, cluster - the cluster must be one of this client's; placements-screen's own test",
  "verdictFromQuery(one,": "the Check keyword verdict, read back only as a whole verdict; add-cluster's own test, and the HMAC in the cluster route",
};

/**
 * Every query key, per page, and a substring of that page that bounds it.
 * Registered 1 Oct 2026 with the routes as built through R145.
 */
const KEYS: Record<string, Record<string, string>> = {
  "": {
    cluster: 'typeof sp.cluster === "string" ? sp.cluster : undefined', // matched against its cards in Overview.tsx, held below
    // 2 Oct 2026, R173 pass 2: the setup route's 303 after Confirm; the line shows only when the confirm reads back.
    setup: 'sp.setup === "confirmed" && confirmed === true',
    // 13 Oct 2026, DIY P5 (spec 10 section 4.1 row 6): This week's Start and Not now post to the plan route with
    // back=overview, which answers ?plan=<code>. overviewPlanToast (transitions.ts) draws planToast's fixed words for a
    // known done code or refused-<why>, else nothing; nothing is echoed.
    plan: 'overviewPlanToast(typeof sp.plan === "string" ? sp.plan : null)',
  },
  // 13 Oct 2026, DIY P5 (spec 10 sections 3.5 and 4.2): AI visibility (P4). Each key a whitelist, a match against this
  // client's own rows, or a clamp, as P4 handed them over; prompt-table.ts's pick* functions own their lists and tests.
  "/ai": {
    cluster: '(data.clusters ?? []).some((c) => c.id === one("cluster"))',
    angle: 'pickAngle(one("angle"))',
    origin: 'pickOrigin(one("origin"))',
    eng: 'engines.find((e) => e === one("eng"))',
    lfl: 'one("lfl") === "1"',
    missing: 'one("missing") === "1"',
    q: 'clusterSearch(one("q"))',
    sort: 'pickSort(one("sort"))',
    dir: 'pickDir(one("dir"))',
    page: 'pickPage(one("page"))',
    // Review of P4 (13 Oct 2026): U1's Hide and Ask return here (surface=ai), so the page reads Clusters' toast keys -
    // each a fixed code drawn as fixed words, nothing echoed.
    hid: 'one("hid") === "1" && !ask',
    ask: 'ask === "sent" ? askToast(',
    via: 'one("via") === "agency"',
    n: "n > 0 && n <= ASK_ITEMS_MAX",
    of: '(of === "prompts" || of === "keywords")',
  },
  // 13 Oct 2026, DIY P5 (spec 10 sections 3.5 and 4.6): Actions, internally the Plan (P3). board.ts's pick* functions
  // hold view, status and kind to their lists; cluster must be one of this client's live clusters; done and why are
  // the plan route's codes, drawn through planToast's fixed words.
  "/plan": {
    view: 'pickView(one("view"))',
    status: 'pickStatus(one("status"))',
    kind: 'pickGroup(one("kind"))',
    cluster: 'pickCluster(one("cluster"), clusters.map((c) => c.id))',
    done: 'planToast(one("done"), one("why"))',
    why: 'planToast(one("done"), one("why"))',
  },
  // 13 Oct 2026, DIY P9 (spec 10 sections 3.5 and 4.3): Google (P6). keys.ts's pick* functions hold view, band,
  // intent, sort, dir and page to their lists; cluster must be one of this client's clusters; row one of this client's
  // tracked keywords; done and why the keywords route's codes, drawn through write.ts's fixed words (readDone,
  // readWhy). done and why are P6's additions to section 3.5, for the Dismiss and Restore toasts.
  "/google": {
    view: 'pickView(one("view"))',
    gaining: 'one("gaining") === "1"',
    cluster: '(data.clusters ?? []).some((c) => c.id === one("cluster"))',
    band: 'pickBand(one("band"))',
    intent: 'pickIntent(one("intent"))',
    q: 'clusterSearch(one("q"))',
    sort: 'pickSort(one("sort"))',
    dir: 'pickDir(one("dir"))',
    page: 'pickPage(one("page"))',
    row: "rowId && data.keywords.some((k) => k.id === rowId)",
    done: 'readDone(one("done"))',
    why: 'readWhy(one("why"))',
  },
  // 13 Oct 2026, DIY P9 (spec 10 sections 3.5 and 4.7): Opportunities (P7). view and lens are whitelists in the page,
  // cluster one of this client's clusters, engine one of its tier's, q cut as every search is, page 1-50; done and
  // why the opportunity and prompt-offer routes' codes, drawn through oppToast's fixed words. The spec's `status`
  // key is not read: the Pursuing view is the status filter.
  "/opportunities": {
    view: 'pickView(one("view"))',
    lens: 'pickLens(one("lens"))',
    cluster: 'structure.clusters.some((c) => c.id === one("cluster"))',
    engine: 'engines.find((e) => e === one("engine"))',
    q: 'clusterSearch(one("q"))',
    page: 'pickPage(one("page"))',
    done: 'oppToast(one("done"), one("why"),',
    why: 'oppToast(one("done"), one("why"),',
  },
  // 13 Oct 2026, DIY P9 (spec 10 section 3.5): one opportunity (P7). [id] must be one of this client's rows, else 404
  // (world.rows.find); swap opens the swap picker only on the exact word; done and why through oppToast.
  "/opportunities/[id]": {
    swap: 'one("swap") === "1"',
    done: 'oppToast(one("done"), one("why"),',
    why: 'oppToast(one("done"), one("why"),',
  },
  // 13 Oct 2026, DIY P9 (spec 10 sections 3.5 and 4.9): Your pages (P8). view and issue are paths.ts whitelists,
  // cluster one of this client's clusters, url a key on the client's own domain of at most 500 characters (else
  // nothing is focused); done and why the pages route's codes, drawn through pagesToast's fixed words.
  "/pages": {
    view: 'pickView(one("view"))',
    issue: 'pickIssue(one("issue"))',
    cluster: 'pickCluster(one("cluster"), clusterIds)',
    url: "rawUrl && rawUrl.length <= 500 && isOwnUrl(",
    done: 'pagesToast(one("done"), one("why"),',
    why: 'pagesToast(one("done"), one("why"),',
  },
  // 13 Oct 2026, DIY P9 (spec 10 section 3.5): one key page (P8). [page] must be a live key page of this client, else
  // 404; tab a paths.ts whitelist, cluster one this page serves, done and why through pagesToast.
  "/pages/[page]": {
    tab: 'pickTab(one("tab"))',
    cluster: 'pickCluster(one("cluster"), served.map((c) => c.id))',
    done: 'pagesToast(one("done"), one("why"),',
    why: 'pagesToast(one("done"), one("why"),',
  },
  "/clusters": {
    filter: 'f === "named" || f === "never" ? f : "all"',
    // "moved" added 2 Oct 2026 (R170 part 2): the /group route's 303 after Move into a cluster.
    // "unselected" added 2 Oct 2026 (DS13, R173 pass 2): the bulk bar posted with nothing ticked or no cluster picked.
    // "rekeyed" added 2 Oct 2026 (R179): the keyword route's 303 after Use this keyword on a pending card.
    done: '(done === "stopped" || done === "undone" || done === "added" || done === "saved" || done === "moved" || done === "refused" || done === "unselected" || done === "rekeyed")',
    kind: '(kind === "prompt" || kind === "cluster")',
    // R151, 3 Oct 2026: the toast also carries `why`'s words, so the recorded line grew; the bound is unchanged.
    id: "? { done, kind, id, count, why:", // a toast only names a row the list already has, or id=selected for a batch
    // DS13, 2 Oct 2026: a bulk stop or move's counts, drawn only beside id=selected and as whole numbers within BULK_MAX.
    ok: "ok >= 0 && ok <= ticked && ticked <= BULK_MAX",
    ticked: "Number.isInteger(ticked)",
    kw: '(one("kw") ?? "").slice(0, 200)',
    add: 'one("add") === "1"',
    sig: '(one("sig") ?? "").slice(0, 64)',
    ask: 'ask === "sent"',
    n: "n > 0 && n <= ASK_ITEMS_MAX",
    of: '(of === "prompts" || of === "keywords")',
    // DS29, 2 Oct 2026: the ask's recipient was `to`, which overwrote the range's `to` on a sent ask from Clusters; now `via`.
    via: 'one("via") === "agency"',
    open: "open={one(\"open\")}", // matched by c.id === openId in Clusters.tsx, nothing is echoed
    q: 'clusterSearch(one("q"))',
    // R179, 2 Oct 2026: Change keyword on a pending card. `rk` is the check route's 303 naming the card (drawn only on
    // the card whose id matches, its verdict rebuilt by verdictFromQuery); `redraft` names the card whose inputs take drafts.
    rk: '(one("rk") ?? "").slice(0, 64)',
    redraft: '(one("redraft") ?? "").slice(0, 64)',
    // DS29, 2 Oct 2026 (R173 pass 2): the hide route's 303 after a recorded "Hide for 30 days"; a flag, nothing echoed.
    hid: 'one("hid") === "1" && !ask',
    // R151, 3 Oct 2026: the prompt route's refusal code; slotRefusal maps it to SLOT_WHY's fixed words, own keys only.
    why: 'slotRefusal(one("why"))',
    // 13 Oct 2026, DIY P9 (spec 10 section 3.5, P6): `src` is read as the exact word gaining or nothing, and rides the
    // add panel as a hidden field so the drafted prompts get the Momentum origin (cluster/route.ts momentumOrigin).
    src: 'one("src") === "gaining" ? "gaining" : null',
  },
  "/clusters/[cluster]": {
    prompt: "promptIndex(sp.prompt, detail.card.prompts.length)",
    // R151 (3 Oct 2026): note.ts noteState - NOTE_SAID's own keys only (saved, empty, long, refused).
    note: "noteState(sp.note)",
    engine: "engineTab(sp.engine, engines)",
    // DB-2 (9 Oct 2026): the check whose answers the panel shows - a real day up to today, else none
    // (latest-answers.test.mts; tracking's start dropped as a floor in review, same day). Only the date: the read
    // keeps the page's client and prompt (read-shape.test.mts).
    day: "pickedDay(sp.day, today)",
  },
  "/named": {
    cluster: '(data.clusters ?? []).some((c) => c.id === one("cluster"))',
    engine: 'engines.find((e) => e === one("engine"))',
    all: 'one("all") === "1"',
    open: "openKey(sp.open)",
    // DS21, 2 Oct 2026 (R173 pass 2, "lists over 10 rows have search"): the brand search, cut as the Clusters search is.
    q: 'clusterSearch(one("q"))',
  },
  "/cited": {
    cluster: '(data.clusters ?? []).some((c) => c.id === one("cluster"))',
    engine: 'engines.find((e) => e === one("engine"))',
    kind: 'k === "yours" || k === "others" ? k : "all"',
    all: 'one("all") === "1"',
    open: 'openPage(one("open"))',
    // DS20, 2 Oct 2026 (R173 pass 2, "lists over 10 rows have search"): the page search, cut as the Clusters search is.
    q: 'clusterSearch(one("q"))',
    // 13 Oct 2026, DIY P9 (spec 10 sections 3.5 and 4.5, P7): `type` a domain type from DOMAIN_TYPES (cited.ts
    // pickCitedType), else none; `leaves` the exact flag 1. `kind` keeps its own meaning (yours, others, all).
    type: 'pickCitedType(one("type"))',
    leaves: 'one("leaves") === "1"',
  },
  "/reports": {},
  "/settings": {
    ask: 'sp.ask === "sent"',
    via: 'sp.via === "agency"', // DS29, 2 Oct 2026: renamed from `to` with Clusters' (the range's key)
    team: "teamToast(sp.team, sp.who,", // teamToast answers only invited, removed, role or refused
    who: "teamToast(sp.team, sp.who,", // readEmail: trimmed, format-checked, at most EMAIL_MAX
    // R151, 3 Oct 2026: a refusal's code from the member route; teamWhy matches it against TEAM_WHY's keys, nothing is echoed.
    why: "inviteRefusal(sp.team, sp.why)",
    // 8 Oct 2026: the trial route's 303 back - only "cancelled" or "refused" draw a toast, nothing is echoed.
    trial: 'sp.trial === "cancelled"',
  },
  "/placements": {
    type: 'pickKind(typeof sp.type === "string" ? sp.type : null)',
    sel: "screen.view.rows.some((r) => r.id === sp.sel)",
  },
  // 1 Oct 2026, R166 part 3b: the setup page's one key, the confirm route's way back on a failed write.
  "/setup": {
    confirm: 'sp.confirm === "failed"',
    // 2 Oct 2026, R166 part 5: Check keyword on a setup card - the check route's 303 back to that card.
    card: 'cards.find((c) => c.id === one("card"))',
    kw: '(one("kw") ?? "").slice(0, 200)',
    sig: '(one("sig") ?? "").slice(0, 64)',
    // 2 Oct 2026, R179: the keyword route's 303 after Use this keyword - one of two words, on the card `card` names.
    rekey: 'rekey === "rekeyed" ? "Keyword set on this cluster.',
    // 9 Oct 2026, ON-1 (LB8): the prompt route's 303 after a card's five drafted prompts are saved. draftsLine draws
    // fixed words for "saved" or "refused" only, on the card `card` names; `why` only through slotRefusal's own keys.
    drafts: 'draftsLine(one("drafts"), one("why"),',
    why: 'draftsLine(one("drafts"), one("why"),',
    // 9 Oct 2026, ON-1 review: which of the five fields a refused Save is about - draftAt takes one digit under five, else none.
    at: 'draftAt(one("at"))',
  },
  // 2 Oct 2026, R173 pass 3, DS36: the catch-all reads no key; its query rides only into loginHref's next.
  "/[...rest]": {},
};

/** Role reads on a page, and what each may decide. A page reading a role anywhere else fails. */
const ROLE_READS: Record<string, string[]> = {
  // DS10 (2 Oct 2026): the setup-outstanding line tells a viewer an owner or editor confirms.
  // 8 Oct 2026 (review of 2379757): writes are judged by writeRole(client), which makes an ended client read-only.
  // 9 Oct 2026 (ON-3, LB8): the activation checklist's wording only - an owner is sent to invite, anyone else told
  // who can, an editor to finish setup. It writes nothing, and is never drawn for an ended client (activationShown).
  "": ["const canWrite = refuseRole(writeRole(client)) === null;", "role: client.role,"],
  "/clusters": ["canWrite={refuseRole(writeRole(client)) === null}"],
  "/clusters/[cluster]": ['canWrite={writeRole(client) === "owner" || writeRole(client) === "editor"}'],
  "/settings": ['owner={client.role === "owner"}'],
  // R166 part 3b: viewers see the cards but not Confirm; the route refuses them too.
  "/setup": ["const canWrite = refuseRole(writeRole(client)) === null;"],
  // 13 Oct 2026, DIY P5: Actions' controls are drawn disabled with the reason for a viewer and on an ended client
  // (writeRole); the plan route refuses them too (transitions.ts decide).
  "/plan": ["const canWrite = refuseRole(writeRole(client)) === null;"],
  // 13 Oct 2026, DIY P9: wave 2's pages draw their controls disabled with the reason for a viewer and on an ended
  // client (writeRole), as Actions does; each page's route refuses them too (keywords, opportunity, prompt-offer, pages).
  "/google": ["canWrite={refuseRole(writeRole(client)) === null}"],
  "/opportunities": ["const canWrite = refuseRole(writeRole(client)) === null;"],
  "/opportunities/[id]": ["const canWrite = refuseRole(writeRole(client)) === null;"],
  "/pages": ["const canWrite = refuseRole(writeRole(client)) === null;"],
  "/pages/[page]": ["const canWrite = refuseRole(writeRole(client)) === null;"],
};

/**
 * Floors, 1 Oct 2026: 8 pages (overview, clusters, one cluster, placements,
 * and BRIEF-4's named, cited, reports, settings) and 32 registered keys.
 * Raised 1 Oct 2026 (R166 part 3b): 9 pages and 33 keys - /setup and its confirm.
 * Raised 2 Oct 2026 (R166 part 5): 36 keys - /setup's card, kw and sig.
 * Raised 2 Oct 2026 (R173 pass 2): 37 keys - the Overview's setup.
 * Raised 2 Oct 2026 (R173 pass 3, DS36): 10 pages - the [...rest] catch-all.
 * Raised 8 Oct 2026: 38 keys - Settings' trial, the Cancel trial route's way back.
 * Raised 9 Oct 2026 (DB-2): 39 keys - the one-cluster page's day.
 * Raised 9 Oct 2026 (ON-1, LB8): 40 keys - /setup's drafts and why, the prompt route's way back after a card's drafts.
 * Raised 9 Oct 2026 (ON-1 review): 41 keys - /setup's at, the refused field.
 * 9 Oct 2026, wave 2b merged: 42 keys - DB-2's day and ON-1's three, counted together.
 * Raised 13 Oct 2026 (DIY P5, wave 1 of the DIY platform): 12 pages - /ai (P4) and /plan (P3); 64 keys - /ai's 15
 * (ten view keys and U1's five way-back keys), /plan's 6, and the Overview's plan, This week's way back.
 * Raised 13 Oct 2026 (DIY P9, wave 2 of the DIY platform): 17 pages - /google (P6), /opportunities and
 * /opportunities/[id] (P7), /pages and /pages/[page] (P8); 110 keys - the 74 registered before (the floor
 * had stayed at 64) and wave 2's 36: /google's 12, /opportunities' 8, /opportunities/[id]'s 3, /pages' 6,
 * /pages/[page]'s 4, /cited's type and leaves, and /clusters' src.
 */
const PAGE_FLOOR = 17;
const KEY_FLOOR = 110;

/** The query keys a page reads by name, as written. */
export function keysRead(src: string): string[] {
  const keys = new Set<string>();
  for (const [, k] of src.matchAll(/\bsp\.(\w+)/g)) keys.add(k!);
  for (const [, k] of src.matchAll(/\bsp\["(\w+)"\]/g)) keys.add(k!);
  for (const [, k] of src.matchAll(/\bone\("(\w+)"\)/g)) keys.add(k!);
  return [...keys].sort();
}

/** Places the whole query object leaves the page, other than `one`'s own body. */
export function queryHandoffs(src: string): string[] {
  return [...src.matchAll(/[\w.]+\([^()]*\bsp\b[,)]/g)].map((m) => m[0]).filter((s) => !Object.keys(READERS).some((r) => s.includes(r.slice(0, -1))));
}

test("census floor: the walk still finds the pages and the keys", () => {
  const keys = Object.values(KEYS).reduce((n, k) => n + Object.keys(k).length, 0);
  assert.ok(PAGES.size >= PAGE_FLOOR, `${PAGES.size} pages walked, floor ${PAGE_FLOOR}`);
  assert.ok(keys >= KEY_FLOOR, `${keys} keys registered, floor ${KEY_FLOOR}`);
});

test("the probes fire: an unregistered key and an unnamed hand-off are both seen", () => {
  assert.deepEqual(keysRead('const a = sp.x; one("y"); sp["z"]; one(k)'), ["x", "y", "z"]);
  assert.deepEqual(queryHandoffs("rangeFrom(sp, today); leak(sp); f(a, sp)"), ["leak(sp)", "f(a, sp)"]);
});

test("every page is registered, and every registered page exists", () => {
  assert.deepEqual([...PAGES.keys()].sort(), Object.keys(KEYS).sort());
});

for (const [route, src] of PAGES) {
  const name = `/app/[client]${route}`;

  test(`${name}: (a) noindex, (b) login redirect, (c) membership 404`, () => {
    assert.match(src, /robots: \{ index: false, follow: false \}/, "no noindex in the page's own metadata");
    // R164 (1 Oct 2026, danny.md line 173): to the login page carrying next,
    // through loginHref (next-path.ts, its own tests).
    // M1 (6 Oct 2026): the page is built through appPath(), because on
    // app.alwayscited.com it has no /app prefix. The rule is unchanged.
    assert.match(src, /if \(!email\) redirect\(loginHref\(appPath\(`\/\$\{\(await params\)\.client\}/, "no session must redirect to the login page with next");
    assert.match(src, /const clients = await repo\.clientsFor\(email\);/, "the client must come from the session's own clients");
    assert.match(src, /const client = clients\.find\(\(c\) => c\.slug === slug\);\s*if \(!client\) notFound\(\);/, "a slug not among them must 404");
  });

  test(`${name}: (d) every query key is registered with its bound, (e) no unnamed hand-off`, () => {
    const want = KEYS[route] ?? {};
    assert.deepEqual(keysRead(src), Object.keys(want).sort(), "the keys read differ from the keys registered");
    const missing = Object.entries(want)
      .filter(([, needs]) => !src.includes(needs))
      .map(([k, needs]) => `${k}: ${needs}`);
    assert.deepEqual(missing, [], "a registered bound is no longer in the page");
    assert.deepEqual(queryHandoffs(src), [], "the query is handed to a helper not named in READERS");
  });

  test(`${name}: (f) role reads are only the registered ones`, () => {
    const reads = [...src.matchAll(/[^\n]*(?:client\.role\b|writeRole\(client\))[^\n]*/g)]
      .map((m) => m[0])
      .filter((l) => !l.includes("role={client.role}")); // the Sidebar's own badge
    const allowed = ROLE_READS[route] ?? [];
    const stray = reads.filter((l) => !allowed.some((a) => l.includes(a)));
    assert.deepEqual(stray, [], "a role read the census does not know about");
    for (const a of allowed) assert.ok(src.includes(a), `registered role read gone: ${a}`);
  });
}

test("the overview's cluster pick is matched against its own cards", () => {
  // The page passes the raw string; the bound lives in Overview.tsx.
  const overview = readFileSync(join(ROOT, "src", "components", "app", "Overview.tsx"), "utf8");
  assert.ok(overview.includes("cards.find((c) => c.id === selected)"), "Overview no longer matches ?cluster= against its cards");
});
