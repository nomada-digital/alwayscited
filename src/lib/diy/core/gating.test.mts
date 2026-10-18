import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { code } from "../../source-read.mts";

/**
 * The DIY gating and vocabulary census (13 Oct 2026, DIY P1; spec 10 sections
 * 2.3 and 6.10 item 2). Nothing a client sees on a DIY page may carry Fatgrid
 * data, a price next to a link or placement, a "sells links" signal, a
 * difficulty or authority figure, a competitor tool's name, or a sponsored or
 * spam field. It sweeps two things:
 *
 * - **source**: the DIY page and component directories and `src/lib/diy`,
 *   less DataForSEO's sample payloads (which carry those fields on purpose:
 *   the parsers are tested against them) and test files (which must name the
 *   words to test that they are dropped);
 * - **rendered HTML**: each DIY e2e spec saves every page and state it visits,
 *   signed in on the fixture, to `test-results/diy/<pkg>/<page>-<state>.html`.
 *   `npm run capture` cannot show these pages - without a session they
 *   redirect to the login - so this reads the saved files. On a built tree
 *   with a DIY route and no saved file for it, it fails rather than skipping.
 *
 * Floors, raised by the shell packages as pages land: the source files swept,
 * and the saved route files swept (0 in wave 1 before P3's Actions page
 * merges: P1 has no page).
 *
 * The detectors are shown finding what they are for, on text written here,
 * because a census that has stopped matching reports a clean tree.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");

/** The DIY routes whose rendered HTML is swept, and how a saved file for each is named. */
export const DIY_ROUTES: Record<string, RegExp> = {
  ai: /^ai[-.]/,
  google: /^google[-.]/,
  plan: /^plan[-.]/,
  opportunities: /^opportunit/,
  links: /^links[-.]/,
  pages: /^pages?[-.]/,
};

/** Routes where a price within 80 characters of a link or placement word fails. Not /pages, which shows the client's own prices. */
const PRICE_ROUTES = ["opportunities", "links"];

/** Actions card kinds that are about opportunities or links: swept for the price rule on /plan, inside an element carrying `data-plan-kind="<kind>"`. */
export const PRICE_PLAN_KINDS = ["get_onto_page", "claim_profile", "answer_thread", "send_correction", "earn_link", "ask_for_link", "reclaim_link"];

/**
 * 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards host, and the DIY page and component
 * directories under src/app/app/[client] and src/components/app went with it. The pages a client now sees for those
 * routes are the dashboards host's: AI answers, Google, Opportunities, and Sources (where /app's links and pages
 * addresses land, dash/host.ts dashPathForApp), drawn by src/components/dash. Its /plan is the plan and allowances
 * page, not Actions, and is not a DIY page. So the source sweep walks those four page directories and the dashboards
 * components beside src/lib/diy, and the Fatgrid rule walks the whole dashboards tree and its library.
 */
const SOURCE_ROOTS = [
  ...["ai", "google", "opportunities", "sources"].map((d) => `src/app/dashboards/[client]/${d}`),
  "src/components/dash",
  "src/lib/diy",
];
/** Where "fatgrid" may not appear at all, and the difficulty modules may not be imported from. */
const FATGRID_ROOTS = ["src/app/dashboards", "src/components/dash", "src/lib/dash", "src/lib/diy"];

/**
 * Source files swept, recorded with their reason and date. 13 Oct 2026, DIY P1:
 * 22 - the P1 core under src/lib/diy (its modules, its fake, wiring.ts and
 * fixtures/core.json; the samples and tests are not swept). Raised by each
 * shell as packages land.
 * Raised 13 Oct 2026 (DIY P5, wave 1 merged): 72 - P1's core, P2's prompts and
 * OriginChip, P3's plan library, page and components, P4's /ai page, its
 * components and the changes and ai libraries, and the shell's wiring.ts and
 * shell/work.ts.
 * Raised 13 Oct 2026 (DIY P9, wave 2 merged): 174 - wave 1's, plus P6's
 * keywords library, /google page and components, P7's opportunities library,
 * pages and components, P8's pages library, pages and components, and their
 * fixtures.
 * Raised 13 Oct 2026 (DIY P10, wave 3): 199, measured - wave 2's and P10's
 * /links page, its two components, the links library and fixtures/links.json.
 * 18 Oct 2026, brief 2d: /app retired; the walk is src/lib/diy, the dashboards host's four DIY page directories and
 * src/components/dash (see SOURCE_ROOTS). 178 files that day.
 */
const SOURCE_FLOOR = 178;
/**
 * Saved route files swept. 13 Oct 2026, DIY P1: 0 - no DIY page exists yet. P5 raises it with P3's /plan and P4's /ai.
 * Raised 13 Oct 2026 (DIY P5, wave 1 merged): 11 on a built tree - P3's six Actions pages (board full and viewer,
 * day 0, list full, placed and placed-agency), P4's three AI visibility pages (default, missing, new), and the
 * shell's ai-shell and plan-shell. Held on a built tree only, as the test above is: on an unbuilt tree the e2e
 * specs have not run either, and that tree's capture and sweeps skip.
 * Raised 13 Oct 2026 (DIY P9, wave 2 merged): 40 - wave 1's 11, P6's six Google pages, P7's eight Opportunities
 * pages, P8's eleven Your pages pages, and the wave 2 journey's Google, Opportunities, key page and Actions
 * (e2e/app/diy-wave2.spec.mts).
 * Raised 13 Oct 2026 (DIY P10, wave 3): 51 - wave 2's 40 and P10's eleven Links pages (profile full, dark and
 * nolinks; gap full and fewcompetitors; targets full, revealed and capped; mentions; check full and nolinks).
 * 13 Oct 2026 (Danny, Actions simple by default): the list is Actions' default, so diy-plan.spec saves the viewer's
 * list (plan-list-viewer) beside the viewer's board, and plan-list-full is the page with no view: seven Actions pages,
 * one more than wave 1 counted. Merged after wave 3: the floor stays 51 - a minimum - and the saved pages are 52.
 * 18 Oct 2026, brief 2d: unchanged. The saved pages come from e2e/app/diy-*.spec.mts, which still visit /app
 * addresses (each 308s to the dashboards host now); moving the specs onto the dashboards host is their own change.
 */
const SAVED_FLOOR = 51;

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [dir];
  return readdirSync(abs).flatMap((f) => walk(join(dir, f)));
}

const swept = (f: string) => !f.includes("/samples/") && !f.includes(".test.") && /\.(tsx?|mts|json)$/.test(f);
export const SOURCE_FILES = [...new Set(SOURCE_ROOTS.flatMap(walk))].filter(swept).sort();

// ------------------------------------------------------------ the detectors

/** "fatgrid" in any case, anywhere in the text. */
export function namesFatgrid(text: string): boolean {
  return /fatgrid/i.test(text);
}

/** An import of a Fatgrid-derived difficulty module. */
export function importsDifficulty(src: string): boolean {
  return /from\s+["'][^"']*\/(difficulty|difficulty-read|placement-difficulty)(\.ts)?["']/.test(src) || /import\(\s*["'][^"']*\/(difficulty|difficulty-read|placement-difficulty)/.test(src);
}

/** Words that may not appear in rendered text on any swept route. */
export const BANNED_WORDS: RegExp[] = [
  /marketplace/i,
  /for sale/i,
  /write for us/i,
  /accepts guest/i,
  /placeable/i,
  /could place/i,
  /place this/i,
  /\bDR\b/,
  /domain rating/i,
  /\bKD\b/,
  /difficulty/i,
  /sponsored/i,
  /guest post/i,
];

/** Competitor tools, as words, any case (Danny's standing rule; section 2.3). */
export const COMPETITOR_TOOLS = /\b(ahrefs|semrush|sitechecker|sparktoro|gumshoe|peec|profound|otterly|scrunch)\b/i;

/** A price within 80 characters of a link or placement word, either side. */
export function pricedNearLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[$£€]\s?\d|\b(price|cost|fee|budget)/gi)) {
    const at = m.index!;
    const window = text.slice(Math.max(0, at - 80), at + m[0].length + 80);
    if (/link|placement|insertion|outreach|opportunit/i.test(window)) out.push(window.replace(/\s+/g, " ").trim());
  }
  return out;
}

/** A key that may not be stored or rendered. */
export const BANNED_KEY = /(^|[\s{,(])["']?(sponsored|attributes|spam_score|backlink_spam_score|target_spam_score)["']?\s*:/;

/** Visible text of an HTML page: scripts, styles and tags removed, a few entities decoded. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&euro;/g, "€")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

/**
 * Each element carrying `data-plan-kind`, with everything inside it, found by
 * a balanced walk of its own tag name: a card holding a child of its own tag
 * (a `<div>` card with a `<div>` title) is read to its own close, not cut at
 * the child's (13 Oct 2026, review of DIY P1: a lazy match stopped at the
 * first `</div>`, and a price after it was never checked). A card never
 * closed runs to the end of the page.
 */
export function planCards(html: string): { kind: string; inner: string }[] {
  const out: { kind: string; inner: string }[] = [];
  for (const open of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\bdata-plan-kind="([a-z_]+)"[^>]*>/g)) {
    const tag = open[1]!.toLowerCase();
    const start = open.index! + open[0].length;
    if (open[0].endsWith("/>")) {
      out.push({ kind: open[2]!, inner: "" });
      continue;
    }
    const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    tags.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let m = tags.exec(html); m; m = tags.exec(html)) {
      if (m[1] === "/") depth -= 1;
      else if (!m[0].endsWith("/>")) depth += 1;
      if (depth === 0) {
        end = m.index;
        break;
      }
    }
    out.push({ kind: open[2]!, inner: html.slice(start, end) });
  }
  return out;
}

/** What is wrong with one saved page, one line each. */
export function renderedProblems(route: string, html: string): string[] {
  const text = visibleText(html);
  const out: string[] = [];
  if (namesFatgrid(html)) out.push("names Fatgrid");
  for (const re of BANNED_WORDS) {
    const m = re.exec(text);
    if (m) out.push(`says "${m[0]}"`);
  }
  const tool = COMPETITOR_TOOLS.exec(text);
  if (tool) out.push(`names a competitor tool: ${tool[0]}`);
  if (PRICE_ROUTES.includes(route)) for (const w of pricedNearLinks(text)) out.push(`a price beside a link or placement: "${w}"`);
  if (route === "plan") {
    for (const card of planCards(html)) {
      if (PRICE_PLAN_KINDS.includes(card.kind)) for (const w of pricedNearLinks(visibleText(card.inner))) out.push(`a price on a ${card.kind} card: "${w}"`);
    }
  }
  if (BANNED_KEY.test(html)) out.push("carries a sponsored, attributes or spam key");
  return out;
}

// ------------------------------------------------------------ the detectors, shown working

test("the detectors fire on what they are for, written here", () => {
  assert.ok(namesFatgrid("from the FatGrid export"));
  assert.ok(importsDifficulty('import { band } from "@/lib/scan/difficulty";'));
  assert.ok(importsDifficulty('import { x } from "../../scan/placement-difficulty.ts";'));
  assert.ok(!importsDifficulty('import { x } from "@/lib/scan/difficulty-copy";'), "a different module is not the difficulty one");
  const page = (body: string) => `<html><body><main>${body}</main><script>var price = "$5 link";</script></body></html>`;
  assert.deepEqual(renderedProblems("ai", page("<p>Cited in 12 answers to your prompts.</p>")), [], "clean text passes, and script text is not read");
  assert.match(renderedProblems("ai", page("<p>DR 54</p>")).join(), /DR/);
  assert.match(renderedProblems("ai", page("<p>Keyword difficulty: hard</p>")).join(), /difficulty/);
  assert.match(renderedProblems("ai", page("<p>This site accepts guest posts.</p>")).join(), /accepts guest/);
  assert.match(renderedProblems("google", page("<p>As Ahrefs reports</p>")).join(), /competitor tool/);
  assert.deepEqual(renderedProblems("ai", page("<p>The sidr dr. Drive</p>")), [], "DR as a word, upper case only");
  assert.match(renderedProblems("links", page("<p>This link costs about &pound;120 a month.</p>")).join(), /price beside/);
  assert.deepEqual(renderedProblems("pages", page("<p>Product with Offer (price, currency) next to your internal links</p>")), [], "/pages may show the client's own prices");
  assert.match(renderedProblems("plan", page('<article data-plan-kind="earn_link"><p>Budget $300 for this link.</p></article>')).join(), /earn_link card/);
  assert.deepEqual(renderedProblems("plan", page('<article data-plan-kind="add_schema"><p>Product price markup, then link it.</p></article>')), []);
  // 13 Oct 2026: a card holding a child of its own tag is read to its own close.
  assert.match(renderedProblems("plan", page('<div data-plan-kind="earn_link"><div>Earn a link</div><p>Budget $300 for this link.</p></div>')).join(), /earn_link card/);
  assert.match(renderedProblems("plan", page('<div data-plan-kind="earn_link"><div><div>Earn</div></div><div><p>Budget $300 for this link.</p></div></div><div>after</div>')).join(), /earn_link card/);
  assert.deepEqual(
    planCards('<li data-plan-kind="earn_link"><ul><li>a</li></ul>b</li><li data-plan-kind="add_schema">c</li>').map((c) => [c.kind, c.inner]),
    [["earn_link", "<ul><li>a</li></ul>b"], ["add_schema", "c"]],
  );
  assert.match(renderedProblems("ai", '<pre>{"sponsored": 3}</pre>').join(), /sponsored/);
  assert.ok(BANNED_KEY.test('const row = { spam_score: 4 }'));
  assert.ok(!BANNED_KEY.test("const label = 'spam is used as a filter only';"));
});

// ------------------------------------------------------------ the source

test("the source walk finds the DIY tree, so a clean sweep is not a blind one", () => {
  assert.ok(SOURCE_FILES.length >= SOURCE_FLOOR, `swept ${SOURCE_FILES.length} source files, floor ${SOURCE_FLOOR}`);
  assert.ok(SOURCE_FILES.includes("src/lib/diy/core/ledger.ts"));
  assert.ok(!SOURCE_FILES.some((f) => f.includes("/samples/")), "the samples carry the banned fields on purpose and are not swept");
  assert.ok(walk("src/lib/diy/core/samples").length >= 8, "the samples the parsers are tested against are where this expects them");
});

test("nothing under the dashboard or the DIY tree names Fatgrid or imports its difficulty bands", () => {
  const files = FATGRID_ROOTS.flatMap(walk).filter(swept);
  assert.ok(files.length > SOURCE_FILES.length, "the Fatgrid roots are wider than the swept DIY roots");
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    if (namesFatgrid(src)) bad.push(`${f}: names Fatgrid`);
    if (importsDifficulty(code(src))) bad.push(`${f}: imports a difficulty module`);
  }
  assert.deepEqual(bad, []);
});

test("no swept source stores or renders a sponsored, attributes or spam key", () => {
  const bad = SOURCE_FILES.filter((f) => BANNED_KEY.test(f.endsWith(".json") ? readFileSync(join(ROOT, f), "utf8") : code(readFileSync(join(ROOT, f), "utf8"))));
  assert.deepEqual(bad, []);
});

test("no payload built under src/lib/diy puts a price beside a link or placement", () => {
  const payloads = SOURCE_FILES.filter((f) => /\/payload[^/]*\.ts$/.test(f));
  const bad = payloads.flatMap((f) => pricedNearLinks(code(readFileSync(join(ROOT, f), "utf8"))).map((w) => `${f}: ${w}`));
  assert.deepEqual(bad, []);
});

/**
 * Every source file under `src` (.ts, .tsx and .mts, tests aside), for the
 * ReadCtx census below. 13 Oct 2026, review of DIY P1: the census walked the
 * DIY directories only, so an on-demand route under `src/app/api` - where P7,
 * P8 and P10 put theirs - could mint a ctx and skip runOnDemand's tracking-run
 * and allowance checks with the census green. Floor: 416 such files on 13 Oct
 * 2026 (DIY P1); a walk that stops matching reports a clean tree.
 * Raised 13 Oct 2026 (DIY P9, wave 2 merged): 569, measured on the merged tree.
 * Raised 13 Oct 2026 (DIY P10, wave 3): 598, measured with the Links page, route, components and library.
 */
const ALL_SOURCE_FLOOR = 598;
const ALL_SOURCE = walk("src").filter((f) => /\.(tsx?|mts)$/.test(f) && !f.endsWith(".test.mts"));

test("only the worker and runOnDemand mint a ReadCtx, anywhere in src", () => {
  assert.ok(ALL_SOURCE.length >= ALL_SOURCE_FLOOR, `walked ${ALL_SOURCE.length} source files, floor ${ALL_SOURCE_FLOOR}`);
  assert.ok(ALL_SOURCE.includes("src/app/api/diy/run/route.ts"), "src/app/api is walked");
  const minters: string[] = [];
  const importers: Record<string, string[]> = { mintReadCtx: [], ctxRuntime: [] };
  for (const f of ALL_SOURCE) {
    const src = code(readFileSync(join(ROOT, f), "utf8"));
    if (/(?<![\w.])mintReadCtx\(/.test(src.replace(/export function mintReadCtx\(/, ""))) minters.push(f);
    for (const name of Object.keys(importers)) {
      if (new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(src)) importers[name]!.push(f);
    }
  }
  // The test helper mints over a fake runtime for the unit tests; nothing it builds ships.
  assert.deepEqual(minters.sort(), ["src/lib/diy/core/fake-diy.mts", "src/lib/diy/core/runondemand.ts", "src/lib/diy/core/worker.ts"]);
  assert.deepEqual(importers.mintReadCtx!.sort(), ["src/lib/diy/core/fake-diy.mts", "src/lib/diy/core/runondemand.ts", "src/lib/diy/core/worker.ts"]);
  // The runtime behind a ctx (its database, its pools) is the ledger's and the model door's to read, and nobody else's.
  assert.deepEqual(importers.ctxRuntime!.sort(), ["src/lib/diy/core/ledger.ts", "src/lib/diy/core/model.ts"]);
});

// ------------------------------------------------------------ the rendered pages

const SAVED_DIR = join(ROOT, "test-results", "diy");

function savedFiles(): { route: string; file: string }[] {
  if (!existsSync(SAVED_DIR)) return [];
  const out: { route: string; file: string }[] = [];
  for (const pkg of readdirSync(SAVED_DIR)) {
    const dir = join(SAVED_DIR, pkg);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".html"))) {
      const route = Object.entries(DIY_ROUTES).find(([, re]) => re.test(name))?.[0];
      if (route) out.push({ route, file: join(dir, name) });
    }
  }
  return out;
}

/** The DIY routes this tree has a page for. 18 Oct 2026, brief 2d: on the dashboards host, /app's pages being gone. */
function builtRoutes(): string[] {
  // Not plan: the dashboards host's /plan is the plan and allowances page, not Actions (see SOURCE_ROOTS).
  return Object.keys(DIY_ROUTES).filter((r) => r !== "plan" && existsSync(join(ROOT, "src", "app", "dashboards", "[client]", r, "page.tsx")));
}

test("every DIY page this tree has, built, has its rendered HTML saved by its e2e spec", () => {
  if (!existsSync(join(ROOT, ".next"))) return; // unbuilt: capture and the e2e specs have not run either
  const saved = new Set(savedFiles().map((s) => s.route));
  const missing = builtRoutes().filter((r) => !saved.has(r));
  assert.deepEqual(missing, [], `no saved HTML for ${missing.join(", ")}: run npx playwright test e2e/app/diy-*.spec.mts on the fixture`);
});

test("the saved DIY pages say nothing the gating rules forbid", () => {
  const files = savedFiles();
  if (existsSync(join(ROOT, ".next"))) assert.ok(files.length >= SAVED_FLOOR, `swept ${files.length} saved pages, floor ${SAVED_FLOOR}: run npx playwright test e2e/app/diy-*.spec.mts on the fixture`);
  const bad = files.flatMap(({ route, file }) => renderedProblems(route, readFileSync(file, "utf8")).map((p) => `${relative(ROOT, file)}: ${p}`));
  assert.deepEqual(bad, []);
});
