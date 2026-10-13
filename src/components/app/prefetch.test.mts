/**
 * Instant tab switching (13 Oct 2026, dashboard speed work; fresh.ts has the
 * design). Four things hold it, and each is a fact here:
 *
 *  1. Only the sidebar is prefetched whole. prefetch={true} sits on exactly
 *     three Links - the desktop nav, the phone tabs and More's sheet - and on
 *     nothing else under src/components/app or src/app/app. A Full prefetch
 *     is a whole render, 20-25 PostgREST reads; on the other 171 Links (chip rows,
 *     table rows, detail links) it would be dozens of renders a view.
 *     The rest keep Next's default, which on these pages is a route-tree read
 *     with no render (walk-tree-with-flight-router-state.js 77-117). No
 *     router.prefetch, no unstable_dynamicOnHover, and no Link to /api, whose
 *     one GET writes a usage row.
 *  2. The windows agree: every page under /app/[client] exports
 *     unstable_dynamicStaleTime, next.config.ts's staleTimes.static and
 *     FreshGuard's max age are all FRESH_SECONDS. The page export has to be a
 *     literal (Next reads it at build), so this is where the copies are held
 *     to the one number.
 *  3. FreshGuard is mounted, once, in the /app layout.
 *  4. Nothing streams before the pages' checks: no loading.tsx between the
 *     root and a dashboard page, and no <Suspense> in the dashboard (R151,
 *     AppLink.tsx: a signed-out visit must redirect and a stranger's slug
 *     404, and with JS off a Suspense boundary's content stays hidden - the
 *     measurement is in ai/page.tsx's header).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

import ts from "typescript";

import { FRESH_SECONDS } from "./fresh.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const CLIENT = join(ROOT, "src", "app", "app", "[client]");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const SOURCES = [join(ROOT, "src", "components", "app"), join(ROOT, "src", "app", "app")].flatMap(walk).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

type Jsx = { file: string; line: number; tag: string; attrs: Map<string, string>; isLink: boolean };

/** Every JSX element in the dashboard's source, with its attributes as written, and whether its tag is next/link's Link or AppLink. */
function elements(): Jsx[] {
  const out: Jsx[] = [];
  for (const file of SOURCES) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const links = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && st.importClause?.name && /^(next\/link|@\/components\/app\/AppLink|(\.\.?\/)+AppLink)$/.test((st.moduleSpecifier as ts.StringLiteral).text)) links.add(st.importClause.name.text);
    }
    const visit = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const attrs = new Map<string, string>();
        for (const a of n.attributes.properties) if (ts.isJsxAttribute(a)) attrs.set(a.name.getText(sf), a.initializer ? a.initializer.getText(sf) : "{true}");
        const tag = n.tagName.getText(sf);
        out.push({ file: rel(file), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, tag, attrs, isLink: links.has(tag) });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

const JSX = elements();

/**
 * Floors, 13 Oct 2026: 106 .ts/.tsx files walked; 175 Link elements - the
 * 174 dashboard Links with an href, and AppLink's own <Link {...props}>.
 */
const FILE_FLOOR = 106;
const LINK_FLOOR = 175;

test("census floor: the walk still sees the dashboard's Links", () => {
  assert.ok(SOURCES.length >= FILE_FLOOR, `${SOURCES.length} files, floor ${FILE_FLOOR}`);
  const links = JSX.filter((j) => j.isLink).length;
  assert.ok(links >= LINK_FLOOR, `${links} Link elements, floor ${LINK_FLOOR}`);
});

test("prefetch={true} is on the sidebar's three nav Links and nowhere else", () => {
  const sites = JSX.filter((j) => j.attrs.has("prefetch")).map((j) => ({ at: `${j.file}:${j.line}`, file: j.file, link: j.isLink, value: j.attrs.get("prefetch"), key: j.attrs.get("key") }));
  // Floor and ceiling both: 3. Fewer is a tab gone slow again; more is a full render per extra link in view.
  assert.equal(sites.length, 3, `prefetch props found: ${JSON.stringify(sites)}`);
  for (const s of sites) {
    assert.equal(s.file, "src/components/app/Sidebar.tsx", `${s.at}: only the sidebar is prefetched whole`);
    assert.ok(s.link, `${s.at}: prefetch on something that is not a Link`);
    assert.equal(s.value, "{true}", `${s.at}`);
    // The nav items, not "+ Add" (key={a.label}) - its links carry ?add=1 and are not tabs.
    assert.equal(s.key, "{item}", `${s.at}: prefetch={true} on a Link that is not a nav item`);
  }
});

test("no hover-prefetch, no router.prefetch, and no Link to /api", () => {
  assert.deepEqual(JSX.filter((j) => j.attrs.has("unstable_dynamicOnHover")).map((j) => `${j.file}:${j.line}`), []);
  const prefetchCalls = SOURCES.filter((f) => /\.prefetch\(/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(prefetchCalls, [], "router.prefetch renders a page whole, outside the three Links this file counts");
  // The one GET under /api/app is the CSV, which writes a usage row and is reached by <a download> only.
  const toApi = JSX.filter((j) => j.isLink && /\/api\b/.test(j.attrs.get("href") ?? "")).map((j) => `${j.file}:${j.line}`);
  assert.deepEqual(toApi, []);
});

test("one window: every page's unstable_dynamicStaleTime, staleTimes.static and FreshGuard's max age are FRESH_SECONDS", () => {
  const pages = walk(CLIENT).filter((f) => /[\\/]page\.tsx$/.test(f));
  // Floor: the 18 pages under /app/[client] on 13 Oct 2026 (nav.test.mts ROUTE_FLOOR).
  assert.ok(pages.length >= 18, `${pages.length} pages, floor 18`);
  const wrong = pages
    .map((f) => [rel(f), [...readFileSync(f, "utf8").matchAll(/^export const unstable_dynamicStaleTime = (\d+);$/gm)].map((m) => Number(m[1]))] as const)
    .filter(([, v]) => v.length !== 1 || v[0] !== FRESH_SECONDS);
  assert.deepEqual(wrong, [], `each page exports unstable_dynamicStaleTime = ${FRESH_SECONDS} once, as a literal`);
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  const st = /staleTimes: \{ dynamic: (\d+), static: (\d+) \}/.exec(config);
  assert.ok(st, "next.config.ts no longer states experimental.staleTimes");
  assert.equal(Number(st[2]), FRESH_SECONDS, "staleTimes.static is how long a sidebar prefetch is held");
  // Global, so it stays Next's default of 0: the marketing site and checkout are dynamic routes too.
  assert.equal(Number(st[1]), 0);
  assert.ok(FRESH_SECONDS >= 30, "Next floors staleTimes.static at 30");
  const guard = readFileSync(join(ROOT, "src", "components", "app", "FreshGuard.tsx"), "utf8");
  assert.ok(guard.includes('import { FRESH_SECONDS } from "./fresh";') && guard.includes("const MAX_AGE = FRESH_SECONDS * 1000;"), "FreshGuard's max age is not FRESH_SECONDS");
});

test("FreshGuard is mounted once in the /app layout, on the dashboard's slug test", () => {
  const layout = readFileSync(join(ROOT, "src", "app", "app", "layout.tsx"), "utf8");
  assert.equal(layout.match(/<FreshGuard \/>/g)?.length, 1);
  const guard = readFileSync(join(ROOT, "src", "components", "app", "FreshGuard.tsx"), "utf8");
  assert.ok(guard.includes("usageSlug(dashPath(pathname))"), "FreshGuard's routes are not UsageBeacon's");
  for (const on of ['addEventListener("pageshow"', 'addEventListener("visibilitychange"', "router.refresh()"]) assert.ok(guard.includes(on), `FreshGuard lost ${on}`);
});

test("nothing streams before a dashboard page's checks: no loading file, no <Suspense>", () => {
  const app = join(ROOT, "src", "app");
  const loading = [
    ...["tsx", "ts", "jsx", "js"].map((x) => join(app, `loading.${x}`)).filter(existsSync),
    ...walk(join(app, "app")).filter((f) => /[\\/]loading\.(tsx|ts|jsx|js)$/.test(f)),
  ].map(rel);
  assert.deepEqual(loading, [], "a loading boundary above /app/[client] answers 200 before the session and slug checks (R151)");
  const rootLayout = ts.createSourceFile("layout.tsx", readFileSync(join(app, "layout.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let rootSuspense = false;
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /(^|\.)Suspense$/.test(n.tagName.getText(rootLayout))) rootSuspense = true;
    ts.forEachChild(n, visit);
  };
  visit(rootLayout);
  const suspense = JSX.filter((j) => /(^|\.)Suspense$/.test(j.tag)).map((j) => `${j.file}:${j.line}`);
  assert.deepEqual([rootSuspense, suspense], [false, []], "a Suspense boundary streams its content hidden until script runs - with JS off it stays on the fallback");
});
