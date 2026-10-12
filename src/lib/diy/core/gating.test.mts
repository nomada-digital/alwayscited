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

const SOURCE_ROOTS = [
  ...["ai", "google", "plan", "opportunities", "links", "pages"].map((d) => `src/app/app/[client]/${d}`),
  ...["ai", "google", "plan", "opportunities", "links", "pages", "prompts"].map((d) => `src/components/app/${d}`),
  "src/lib/diy",
];
/** Where "fatgrid" may not appear at all, and the difficulty modules may not be imported from. */
const FATGRID_ROOTS = ["src/app/app", "src/components/app", "src/lib/diy"];

/**
 * Source files swept, recorded with their reason and date. 13 Oct 2026, DIY P1:
 * 22 - the P1 core under src/lib/diy (its modules, its fake, wiring.ts and
 * fixtures/core.json; the samples and tests are not swept). Raised by each
 * shell as packages land.
 */
const SOURCE_FLOOR = 22;
/** Saved route files swept. 13 Oct 2026, DIY P1: 0 - no DIY page exists yet. P5 raises it with P3's /plan and P4's /ai. */
const SAVED_FLOOR = 0;

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
    for (const m of html.matchAll(/<(\w+)[^>]*data-plan-kind="([a-z_]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      if (PRICE_PLAN_KINDS.includes(m[2]!)) for (const w of pricedNearLinks(visibleText(m[3]!))) out.push(`a price on a ${m[2]} card: "${w}"`);
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

test("only the worker and runOnDemand mint a ReadCtx", () => {
  const minters = SOURCE_FILES.filter((f) => /\.(tsx?)$/.test(f) && /(?<![\w.])mintReadCtx\(/.test(code(readFileSync(join(ROOT, f), "utf8"))) && !/export function mintReadCtx/.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(minters, ["src/lib/diy/core/runondemand.ts", "src/lib/diy/core/worker.ts"]);
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

/** The DIY routes this tree has a page for. */
function builtRoutes(): string[] {
  return Object.keys(DIY_ROUTES).filter((r) => existsSync(join(ROOT, "src", "app", "app", "[client]", r, "page.tsx")));
}

test("every DIY page this tree has, built, has its rendered HTML saved by its e2e spec", () => {
  if (!existsSync(join(ROOT, ".next"))) return; // unbuilt: capture and the e2e specs have not run either
  const saved = new Set(savedFiles().map((s) => s.route));
  const missing = builtRoutes().filter((r) => !saved.has(r));
  assert.deepEqual(missing, [], `no saved HTML for ${missing.join(", ")}: run npx playwright test e2e/app/diy-*.spec.mts on the fixture`);
});

test("the saved DIY pages say nothing the gating rules forbid", () => {
  const files = savedFiles();
  assert.ok(files.length >= SAVED_FLOOR, `swept ${files.length} saved pages, floor ${SAVED_FLOOR}`);
  const bad = files.flatMap(({ route, file }) => renderedProblems(route, readFileSync(file, "utf8")).map((p) => `${relative(ROOT, file)}: ${p}`));
  assert.deepEqual(bad, []);
});
