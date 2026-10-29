/**
 * Client page census (R146 part 2, BRIEF-4 P6; Danny, 30 Sep 2026,
 * danny.md line 134). Walks every page.tsx under the client's dashboard and
 * holds, for each one:
 *  (a) noindex in its own metadata, as well as the layout's (the header rule
 *      and robots.txt are route-closure.test.mts's);
 *  (b)+(c) the session and the membership 404: the page reads its client only
 *      through pageData(slug), which redirects a visitor with no session to
 *      the sign-in page and 404s a slug that is not one of the session's own
 *      clients (held below against page-data.ts itself);
 *  (d) every query key the page reads is registered below with the line in the
 *      page that bounds it - a whitelist, a match against this client's own
 *      rows, a clamp, or a named reader whose own test owns the bound. A new
 *      key, or a bound that stops being in the file, fails;
 *  (e) a page that hands the whole query to a helper names that helper in
 *      READERS, so no key is read where this census cannot see it.
 * Write affordances are role-gated in the routes (spend-gates, route-callers,
 * refuseRole); a page's own role reads are held under (f).
 *
 * 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards
 * host. Until today this walked src/app/app/[client] (18 pages, 113 keys; its
 * dated history is in git at 442fda2). The rule is unchanged and now walks the
 * live client pages, src/app/dashboards/[client], whose session and
 * membership check is pageData's rather than each page's own; the keys and
 * role reads below are those pages' own, registered today.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CLIENT = join(ROOT, "src", "app", "dashboards", "[client]");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** "" for the overview, "/sources", "/ai/[prompt]". */
const PAGES = new Map(
  walk(CLIENT)
    .filter((f) => /[\\/]page\.tsx$/.test(f))
    .map((f) => {
      const segs = relative(CLIENT, f).split(sep).slice(0, -1);
      return [segs.length ? "/" + segs.join("/") : "", readFileSync(f, "utf8")] as const;
    }),
);

/** Helpers a page may hand the whole query to, and the keys each owns, with the test that holds the bound. */
const READERS: Record<string, string> = {};

/**
 * Every query key, per page, and a substring of that page that bounds it.
 * Registered 18 Oct 2026 (brief 2d) with the dashboards host's client pages as built at 442fda2.
 */
const KEYS: Record<string, Record<string, string>> = {
  "": {},
  "/ai": {},
  // A day the prompt has readings on, else the latest; `vs` the same, and never the day itself.
  "/ai/[prompt]": {
    date: 'typeof sp.date === "string" && DAY.test(sp.date) && dates.includes(sp.date)',
    vs: 'typeof sp.vs === "string" && DAY.test(sp.vs) && dates.includes(sp.vs) && sp.vs !== date',
  },
  "/alwaystracked": {},
  "/clusters": {},
  "/clusters/[cluster]": {},
  "/google": {},
  // As /ai/[prompt]: a day the keyword has readings on.
  "/google/[keyword]": {
    date: 'typeof sp.date === "string" && DAY.test(sp.date) && dates.includes(sp.date)',
    vs: 'typeof sp.vs === "string" && DAY.test(sp.vs) && dates.includes(sp.vs) && sp.vs !== date',
  },
  "/integrations": {},
  // 29 Oct 2026: placements and link insertions from the link team's sheets. No query keys.
  "/links": {},
  // 22 Oct 2026: the map pack grids. No query keys.
  "/local": {},
  "/managed": {},
  "/opportunities": {},
  // The billing and pack routes' 303 codes, drawn only through each table's own fixed words; nothing is echoed.
  "/plan": {
    billing: 'typeof sp.billing === "string" ? (BILLING_WHY[sp.billing] ?? null) : null',
    pack: 'typeof sp.pack === "string" ? (PACK_WHY[sp.pack] ?? null) : null',
    // 22 Oct 2026, the cut-over: the trial route's 303, two codes read only against TRIAL_DONE's fixed words.
    trial: 'sp.trial === "cancelled" ? TRIAL_DONE.cancelled : sp.trial === "refused" ? TRIAL_DONE.refused : null',
  },
  // The member route's 303 (from=dash): a done code through DONE's fixed words, a refusal's code through teamWhy.
  "/settings": {
    team: 'typeof sp.team === "string" ? (DONE[sp.team] ?? null) : null',
    why: 'sp.team === "refused" ? teamWhy(sp.why) : null',
  },
  "/setup": {},
  // One of SOURCE_RANGES, else the page's default.
  "/sources": { range: "(SOURCE_RANGES as readonly number[]).includes(Number(sp.range))" },
  "/sources/[domain]": { range: "(SOURCE_RANGES as readonly number[]).includes(Number(sp.range))" },
};

/** Role reads on a page (the signed-in member's role, `raw.role` or `ws.role`), and what each may decide. */
const ROLE_READS: Record<string, string[]> = {
  // Setup outstanding sends an owner or editor to setup; a viewer cannot confirm, so is not sent.
  "": ['raw.role !== "viewer" && setupOutstanding('],
  // Only an owner sees Invite and Remove; the member route refuses anyone else too.
  "/settings": ['const owner = raw.role === "owner" && !readOnly;'],
  // Only an owner sees Open billing and Track more; the billing and pack routes refuse anyone else too.
  // 22 Oct 2026: the invoice history is read for the owner only, never in a demo or a view-as (lib/dash/invoices.ts).
  "/plan": ['ws.role === "owner" ? (', 'ws.role === "owner" && !demo ? (', 'const inv = ws.role === "owner" && !demo && !viewAs ? await readInvoices(raw.client.id) : null;'],
};

/**
 * Floors, 18 Oct 2026 (brief 2d): 16 pages - the overview and fifteen beneath it - and 10 registered keys.
 * (The /app walk's floors, 18 pages and 113 keys, went with /app.)
 */
const PAGE_FLOOR = 16;
const KEY_FLOOR = 10;

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
  assert.deepEqual(queryHandoffs("rangeFrom(sp, today); leak(sp); f(a, sp)"), ["rangeFrom(sp,", "leak(sp)", "f(a, sp)"]);
});

test("every page is registered, and every registered page exists", () => {
  assert.deepEqual([...PAGES.keys()].sort(), Object.keys(KEYS).sort());
});

test("(b)+(c) pageData redirects no session to sign-in and 404s a slug that is not the session's", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "dash", "page-data.ts"), "utf8");
  assert.match(src, /const email = await dashEmail\(\);\s*\/\/[^\n]*\n\s*if \(!email\) \{\s*if \(base\) notFound\(\);\s*redirect\("\/login"\);/, "no session must go to the sign-in page (a 404 off the dashboards host)");
  assert.match(src, /const raw = await dashRaw\(email, slug\);\s*if \(!raw\) notFound\(\);/, "a slug not among the session's clients must 404");
});

for (const [route, src] of PAGES) {
  const name = `/dashboards/[client]${route}`;

  test(`${name}: (a) noindex, (b)+(c) reads its client through pageData`, () => {
    assert.match(src, /robots: \{ index: false, follow: false \}/, "no noindex in the page's own metadata");
    assert.match(src, /const \{ client: slug\b[^}]*\} = await params;/, "the slug must come from the route's own params");
    assert.match(src, /= await pageData\(slug\);/, "the client must come through pageData, which holds the session and the membership 404");
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
    const reads = [...src.matchAll(/[^\n]*\b(?:raw|ws)\.role\b[^\n]*/g)].map((m) => m[0]);
    const allowed = ROLE_READS[route] ?? [];
    const stray = reads.filter((l) => !allowed.some((a) => l.includes(a)));
    assert.deepEqual(stray, [], "a role read the census does not know about");
    for (const a of allowed) assert.ok(src.includes(a), `registered role read gone: ${a}`);
  });
}
