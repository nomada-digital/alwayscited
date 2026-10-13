/**
 * Instant tab switching (13 Oct 2026, dashboard speed work; fresh.ts has the
 * design). Five things hold it, and each is a fact here:
 *
 *  1. Only the sidebar is prefetched whole. The one prefetch prop under
 *     src/components/app or src/app/app is NavLink's, `{here ? false : true}`
 *     - whole, but not the page already on screen - and NavLink sits at
 *     exactly three places: the desktop nav, the phone tabs and More's sheet.
 *     A Full prefetch is a whole render, 20-25 PostgREST reads; on the other
 *     171 Links (chip rows, table rows, detail links) it would be dozens of
 *     renders a view. The rest keep Next's default, which on these pages is a
 *     route-tree read with no render (walk-tree-with-flight-router-state.js
 *     77-117). No router.prefetch and no unstable_dynamicOnHover.
 *  2. No Link reaches /api. The one GET there, the CSV, writes a usage row
 *     (report/route.ts, recordUsage), and Next's default prefetch would GET
 *     it. Every /api URL is built in a variable, a function or a prop, never
 *     written in the href, so the rule follows each from where it is built
 *     to the element it lands on (review, 13 Oct 2026).
 *  3. The windows agree: every page under /app/[client] exports
 *     unstable_dynamicStaleTime, next.config.ts's staleTimes.static and
 *     FreshGuard's max age are all FRESH_SECONDS. The page export has to be a
 *     literal (Next reads it at build), so this is where the copies are held
 *     to the one number.
 *  4. FreshGuard is mounted, once, in the /app layout, and a failed page
 *     drawn after the document's first render empties the router's memory
 *     (error.tsx; fresh.ts, "When a read fails").
 *  5. Nothing streams before the pages' checks: no loading.tsx between the
 *     root and a dashboard page, and no <Suspense> in the dashboard (R151,
 *     AppLink.tsx: a signed-out visit must redirect and a stranger's slug
 *     404, and with JS off a Suspense boundary's content stays hidden - the
 *     measurement is in ai/page.tsx's header). FreshGuard's firstRenderDone
 *     leans on it too: with no boundary between the pages and FreshGuard, the
 *     document's first render commits whole.
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

/** next/link, and the two wrappers that render it: AppLink, and NavLink around AppLink. */
const LINK_MODULES = /^(next\/link|@\/components\/app\/(AppLink|NavLink)|(\.\.?\/)+(AppLink|NavLink))$/;

/** Every JSX element in the dashboard's source, with its attributes as written, and whether its tag is next/link's Link, AppLink or NavLink. */
function elements(): Jsx[] {
  const out: Jsx[] = [];
  for (const file of SOURCES) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const links = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && st.importClause?.name && LINK_MODULES.test((st.moduleSpecifier as ts.StringLiteral).text)) links.add(st.importClause.name.text);
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
 * Moved the same day by the review: NavLink.tsx is a file walked, and its
 * own <AppLink {...props}> a Link element - 107 and 176 (the Sidebar's three
 * nav sites are NavLinks now, and count as before).
 */
const FILE_FLOOR = 107;
const LINK_FLOOR = 176;

test("census floor: the walk still sees the dashboard's Links", () => {
  assert.ok(SOURCES.length >= FILE_FLOOR, `${SOURCES.length} files, floor ${FILE_FLOOR}`);
  const links = JSX.filter((j) => j.isLink).length;
  assert.ok(links >= LINK_FLOOR, `${links} Link elements, floor ${LINK_FLOOR}`);
});

test("the one prefetch prop is NavLink's, and NavLink is the sidebar's three nav sites", () => {
  const sites = JSX.filter((j) => j.attrs.has("prefetch")).map((j) => ({ at: `${j.file}:${j.line}`, file: j.file, link: j.isLink, value: j.attrs.get("prefetch") }));
  // Exactly one: a second is a full render per link of it in view.
  assert.equal(sites.length, 1, `prefetch props found: ${JSON.stringify(sites)}`);
  const [s] = sites;
  assert.equal(s!.file, "src/components/app/NavLink.tsx", `${s!.at}: only NavLink prefetches whole`);
  assert.ok(s!.link, `${s!.at}: prefetch on something that is not a Link`);
  // Review, 13 Oct 2026: whole, but not the page on screen - by path, so a detail page's list stays prefetched.
  assert.equal(s!.value, "{here ? false : true}", `${s!.at}`);
  const nav = readFileSync(join(ROOT, "src", "components", "app", "NavLink.tsx"), "utf8");
  assert.ok(nav.includes('const here = usePathname() === props.href.split("?")[0];'), "NavLink's here is no longer the browser's path against the link's");
  const used = JSX.filter((j) => j.tag === "NavLink").map((j) => ({ at: `${j.file}:${j.line}`, file: j.file, key: j.attrs.get("key") }));
  // Floor and ceiling both: 3. Fewer is a tab gone slow again; more is a full render per extra link in view.
  assert.equal(used.length, 3, `NavLinks found: ${JSON.stringify(used)}`);
  for (const u of used) {
    assert.equal(u.file, "src/components/app/Sidebar.tsx", `${u.at}: NavLink outside the sidebar`);
    // The nav items, not "+ Add" (key={a.label}) - its links carry ?add=1 and are not tabs.
    assert.equal(u.key, "{item}", `${u.at}: a NavLink that is not a nav item`);
  }
});

test("no hover-prefetch and no router.prefetch", () => {
  assert.deepEqual(JSX.filter((j) => j.attrs.has("unstable_dynamicOnHover")).map((j) => `${j.file}:${j.line}`), []);
  const prefetchCalls = SOURCES.filter((f) => /\.prefetch\(/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(prefetchCalls, [], "router.prefetch renders a page whole, outside the three Links this file counts");
});

/**
 * Where the dashboard builds an /api URL, and every element it reaches
 * (review, 13 Oct 2026). The rule before this read `/api` in an href as
 * written, and every real one is built elsewhere - csvHref in the placements
 * page, csv() in Reports, report() in the Overview from a reportPath prop -
 * so it had never fired on real code, and turning the CSV's <a download>
 * into a Link passed it. A Link's default prefetch would GET the CSV route,
 * which records a usage row: a write on view.
 *
 * Per file: every string or template holding "/api/" is a seed, landing in a
 * declaration (`csvHref`; `act.action` for an object's key), a JSX attribute
 * or a fetch() (a response, not a URL, so not followed). A declaration that
 * names a held path holds one too, to a fixpoint - by path, so `act.keep`
 * beside `act.action` stays clean. A component prop given one is followed
 * into the file recorded in API_PROPS as taking it. Each element it lands
 * on is then a form's action, a button's formAction, an <a download>'s
 * href, or a failure.
 */
type ApiSource = { file: string; text: string };

const apiTextIn = (n: ts.Node) =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text.includes("/api/") : ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].some((t) => t.includes("/api/")) : false;
const isFetch = (n: ts.Node) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "fetch";
/** `a.b.c` for an identifier or a property access on one; null for anything else. */
const chainOf = (n: ts.Node): string | null => (ts.isIdentifier(n) ? n.text : ts.isPropertyAccessExpression(n) ? ((b) => (b === null ? null : `${b}.${n.name.text}`))(chainOf(n.expression)) : null);

function apiReach(sources: ApiSource[], props: Record<string, string[]>) {
  const out = { seeds: [] as string[], unplaced: [] as string[], handed: {} as Record<string, string[]>, uses: [] as { kind: string; at: string; text: string }[] };
  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const links = new Set<string>();
    for (const st of sf.statements) if (ts.isImportDeclaration(st) && st.importClause?.name && LINK_MODULES.test((st.moduleSpecifier as ts.StringLiteral).text)) links.add(st.importClause.name.text);
    const held = new Set<string>();
    const taken = Object.entries(props).filter(([, by]) => by.includes(file)).map(([p]) => p);
    /** Does a chain hold an /api URL: a held path or a property of one (`act.action.replace`), or a prop this file takes, bare or on its props object. */
    const holds = (c: string) => {
      const parts = c.split(".");
      if (parts.some((_, i) => held.has(parts.slice(0, i + 1).join(".")))) return true;
      const onProps = parts.slice(1).join(".");
      return taken.some((q) => [c, onProps].some((x) => x === q || x.startsWith(`${q}.`)));
    };
    /** The nodes in `e` that put an /api URL there: the text, or a chain holding one - the longest chain decides. */
    const hits = (e: ts.Node) => {
      const found: ts.Node[] = [];
      const visit = (n: ts.Node): void => {
        if (isFetch(n)) return;
        if (apiTextIn(n)) return void found.push(n);
        if (ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) return;
        if (ts.isPropertyAssignment(n.parent) && n.parent.name === n) return;
        if ((ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n)) {
          const c = chainOf(n);
          if (c !== null) {
            if (holds(c)) found.push(n);
            return;
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(e);
      return found;
    };
    /** The object keys between a node and the declaration it sits in. */
    const keysTo = (h: ts.Node, top: ts.Node) => {
      const keys: string[] = [];
      for (let p = h.parent; p && p !== top; p = p.parent) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) keys.unshift(p.name.text);
      return keys;
    };
    const seed = (n: ts.Node) => {
      if (apiTextIn(n) && !ts.isTemplateSpan(n.parent)) {
        let sink = "";
        for (let p: ts.Node = n; !sink && p.parent && !ts.isSourceFile(p.parent); ) {
          p = p.parent;
          if (ts.isJsxAttribute(p)) sink = `<${(p.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf)} ${p.name.getText(sf)}>`;
          else if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) sink = [p.name.text, ...keysTo(n, p)].join(".");
          else if (isFetch(p)) sink = "fetch()";
        }
        if (sink) out.seeds.push(`${file} ${sink}`);
        else out.unplaced.push(at(n));
      }
      ts.forEachChild(n, seed);
    };
    seed(sf);
    for (let changed = true; changed; ) {
      changed = false;
      const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
          for (const h of hits(n.initializer)) {
            const path = [n.name.text, ...keysTo(h, n)].join(".");
            if (!held.has(path)) {
              held.add(path);
              changed = true;
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    const land = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf);
        const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
        const has = (a: string) => attrs.some((b) => b.name.getText(sf) === a);
        for (const a of attrs) {
          const e = a.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : a.initializer;
          if (!e) continue;
          const name = a.name.getText(sf);
          if (/^[A-Z]/.test(tag) && !links.has(tag)) {
            // Handed on: the value holds one, or is an object one is kept in (`act={act}` beside act.action).
            const c = chainOf(e);
            const inside = c === null ? [] : [...held].filter((t) => t.startsWith(`${c}.`)).map((t) => `${name}${t.slice(c.length)}`);
            for (const p of [...(hits(e).length ? [name] : []), ...inside]) (out.handed[p] ??= []).push(`${file} <${tag}>`);
            continue;
          }
          if (!hits(e).length) continue;
          const kind = links.has(tag) ? "Link" : tag === "a" && name === "href" && has("download") ? "a download" : tag === "form" && name === "action" ? "form action" : tag === "button" && name === "formAction" ? "button formAction" : "other";
          out.uses.push({ kind, at: at(n), text: `<${tag} ${name}={${e.getText(sf).slice(0, 60)}}>` });
        }
      }
      ts.forEachChild(n, land);
    };
    land(sf);
  }
  for (const k of Object.keys(out.handed)) out.handed[k] = [...new Set(out.handed[k])].sort();
  return out;
}

/**
 * The props an /api URL is handed through, 13 Oct 2026, and the file that
 * takes each - where the walk follows it. A new one fails until it is here.
 */
const API_PROPS: Record<string, { by: string[]; from: string[]; what: string }> = {
  reportPath: {
    by: ["src/components/app/Overview.tsx", "src/components/app/Reports.tsx"],
    from: ["src/app/app/[client]/page.tsx <Overview>", "src/app/app/[client]/reports/page.tsx <Reports>"],
    what: "the CSV route; Overview's report() and Reports' csv() build the <a download> hrefs from it",
  },
  csvHref: { by: ["src/components/app/Placements.tsx"], from: ["src/app/app/[client]/placements/page.tsx <Placements>"], what: "the placements CSV, an <a download>" },
  noteAction: { by: ["src/components/app/OneCluster.tsx"], from: ["src/app/app/[client]/clusters/[cluster]/page.tsx <OneCluster>"], what: "the note form's POST" },
  action: {
    by: ["src/components/app/DraftPrompts.tsx"],
    from: ["src/app/app/[client]/setup/page.tsx <DraftPrompts>", "src/components/app/Clusters.tsx <DraftPrompts>"],
    what: "the draft prompts form's POST",
  },
  "act.action": {
    by: ["src/components/app/Clusters.tsx"],
    from: ["src/components/app/Clusters.tsx <ClusterRow>", "src/components/app/Clusters.tsx <MoveForm>", "src/components/app/Clusters.tsx <PendingEditor>", "src/components/app/Clusters.tsx <StopForm>", "src/components/app/Clusters.tsx <Toast>", "src/components/app/Clusters.tsx <Ungrouped>"],
    what: "the stop route, and the group, edit and prompt routes built from it: form POSTs and one formAction",
  },
};

/**
 * Floors, 13 Oct 2026: 29 places a string holds "/api/" (form actions, the
 * CSV, three fetch POSTs), and 5 <a download> hrefs reaching it - the
 * Overview's two, Reports' two and Placements' one.
 */
const API_SEED_FLOOR = 29;
const API_DOWNLOAD_FLOOR = 5;
const REACH = apiReach(
  SOURCES.map((f) => ({ file: rel(f), text: readFileSync(f, "utf8") })),
  Object.fromEntries(Object.entries(API_PROPS).map(([p, f]) => [p, f.by])),
);

test("no Link reaches /api: every /api URL lands on a form, a formAction or an <a download>", () => {
  assert.ok(REACH.seeds.length >= API_SEED_FLOOR, `${REACH.seeds.length} /api strings, floor ${API_SEED_FLOOR}: the matcher stopped matching`);
  assert.deepEqual(REACH.unplaced, [], "an /api URL built somewhere this walk cannot follow - hold it in a declaration or put it in the attribute");
  assert.deepEqual(
    Object.fromEntries(Object.entries(REACH.handed).sort()),
    Object.fromEntries(Object.entries(API_PROPS).map(([p, f]) => [p, [...f.from].sort()]).sort()),
    "an /api URL is handed to a component through a prop not in API_PROPS - record it with the file that takes it",
  );
  const bad = REACH.uses.filter((u) => !["form action", "button formAction", "a download"].includes(u.kind)).map((u) => `${u.at} ${u.kind} ${u.text}`);
  assert.deepEqual(bad, [], "an /api URL on a Link is a GET on prefetch, and the CSV's GET writes a usage row; anything else that fetches on render does the same");
  const downloads = REACH.uses.filter((u) => u.kind === "a download");
  assert.ok(downloads.length >= API_DOWNLOAD_FLOOR, `${downloads.length} <a download> hrefs reach /api, floor ${API_DOWNLOAD_FLOOR}: the walk lost the CSV links`);
});

test("census probe: the /api walk follows a URL through a function, a prop and an object key", () => {
  const props = { csvHref: ["b.tsx"], "act.action": ["c.tsx"] };
  const run = (b: string) =>
    apiReach(
      [
        { file: "a.tsx", text: `import Link from "next/link"; const csvHref = \`/api/app/\${s}/report\`; const act = { action: "/api/app/x/stop", keep: {} }; export const A = () => <><B csvHref={csvHref} /><C act={act} /><Link href={\`?\${act.keep}\`}>x</Link></>;` },
        { file: "b.tsx", text: b },
        { file: "c.tsx", text: `export const C = ({ act }) => { const route = (p) => act.action.replace("/stop", p); return <form action={route("/edit")} />; };` },
      ],
      props,
    );
  const kinds = (b: string) => run(b).uses.filter((u) => u.at.startsWith("b.tsx")).map((u) => u.kind);
  assert.deepEqual(kinds(`export const B = (p) => <a href={p.csvHref} download>CSV</a>;`), ["a download"]);
  assert.deepEqual(kinds(`import Link from "@/components/app/AppLink"; export const B = ({ csvHref }) => { const csv = (k) => \`\${csvHref}&k=\${k}\`; return <Link href={csv("a")}>CSV</Link>; };`), ["Link"]);
  assert.deepEqual(kinds(`export const B = (p) => <img src={p.csvHref} />;`), ["other"]);
  assert.deepEqual(kinds(`export const B = (p) => <a href={p.csvHref}>CSV</a>;`), ["other"], "an <a> without download is a navigation, not a file");
  const r = run(`export const B = () => null;`);
  assert.deepEqual(r.handed, { csvHref: ["a.tsx <B>"], "act.action": ["a.tsx <C>"] });
  assert.deepEqual(r.uses.map((u) => `${u.at} ${u.kind}`), ["c.tsx:1 form action"], "act.keep beside act.action is not a URL; the action, through route(), is");
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

test("a failed page drawn after the first render empties the router's memory; a failed section is recorded as held", () => {
  // Review, 13 Oct 2026: a Full prefetch whose render threw answers 200 and was held for the window, so a click
  // drew the failure with no request, and so did the next. fresh.ts, "When a read fails", has both shapes.
  const err = readFileSync(join(CLIENT, "error.tsx"), "utf8");
  assert.ok(err.includes('import { firstRenderDone } from "@/components/app/FreshGuard";'), "error.tsx no longer reads firstRenderDone");
  assert.ok(err.includes("const [purge] = useState(() => firstRenderDone() && !retried);"), "the first-render and Try again tests are no longer taken as the boundary is drawn");
  const effects = [...err.matchAll(/useEffect\(\(\) => \{([^]*?)\n {2}\}, \[/g)].map((m) => m[1]!);
  assert.ok(
    effects.some((b) => /^\s+if \(purge\) router\.refresh\(\);\n\s+return \(\) => \{\n\s+retried = false;\n\s+\};$/.test(b)),
    "error.tsx no longer purges the router as it is drawn, or no longer clears Try again's mark as it goes",
  );
  // router.refresh, not retry: retry resets the boundary, and a render that failed again would draw this and call it again.
  assert.deepEqual(effects.filter((b) => b.includes("retry(")), [], "retry() in an effect redraws the page and, if it fails again, this boundary - round and round");
  assert.match(err, /onClick=\{\(\) => \{\n\s+retried = true;\n\s+retry\(\);\n\s+\}\}/, "Try again no longer marks the boundary it draws, which then refreshes a second time");
  const guard = readFileSync(join(ROOT, "src", "components", "app", "FreshGuard.tsx"), "utf8");
  assert.ok(guard.includes("export const firstRenderDone = () => mounted;") && /useEffect\(\(\) => \{\n\s+purged\.current = Date\.now\(\);\n\s+mounted = true;\n\s+\}, \[\]\);/.test(guard), "firstRenderDone is no longer set by FreshGuard's mount");
  const fresh = readFileSync(join(ROOT, "src", "components", "app", "fresh.ts"), "utf8");
  for (const said of ["When a read fails (review, 13 Oct 2026).", "The whole page failed, drawn by src/app/app/[client]/error.tsx.", "One section failed and says so", "for\n *    up to FRESH_SECONDS."]) {
    assert.ok(fresh.includes(said), `fresh.ts no longer records ${JSON.stringify(said)}`);
  }
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
