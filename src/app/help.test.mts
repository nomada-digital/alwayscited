import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { code } from "../lib/source-read.mts";
import { splitTierNames } from "../lib/tier-text.ts";

/**
 * The help centre (MK-2, 9 Oct 2026) describes the product, so it goes stale
 * the way every second copy of a fact in this tree has: the product moves and
 * the description does not. Four things are held here, none of which reads
 * the build, so none skips on an unbuilt tree.
 *
 * 1. **Every number in the copy is the code's.** config/help.ts interpolates
 *    each figure it states - the cluster and prompt counts, the sign-in
 *    lifetimes, the team caps, the Google depth, the prices, the notice
 *    period - from the module that enforces it. A figure typed into a
 *    sentence, in digits or in words, is a copy that will not follow the
 *    code, so none is allowed. The only digits in the copy are inside `ui()`
 *    labels, which rule 2 holds to the product instead.
 * 2. **Every control the copy names is one the dashboard draws.** A sentence
 *    saying "choose Cancel trial" is wrong the day the button is renamed, and
 *    nothing else would notice. Each literal `ui("...")` label must be drawn
 *    by the dashboard's own code: a string literal of exactly those words, or
 *    JSX text, with comments cut first. Reading raw text let a doc comment
 *    that names a control stand in for the control (review of MK-2, 9 Oct
 *    2026: "Cancel trial" renamed in Settings.tsx stayed found in limits.ts's
 *    header), the cut source-read.mts records being paid for seven times.
 * 3. **The copy is built for the trial's state.** config/trial.ts turns the
 *    free trial off in one line, and every reader takes `enabled`; the help
 *    is built off here and must not name a trial.
 * 4. **Every article is a page, and every page is offered**: one page file per
 *    article and none spare, each in sitemap.ts and the footer reaching the
 *    index. sitemap.test.mts checks the sitemap against the built pages, and
 *    skips on an unbuilt tree; this half does not skip.
 *
 * And one decision: the help promises no reply time. Danny reversed the one
 * promise of that kind (R24, 26 Sep 2026), and putting one back is his.
 *
 * What it cannot see: whether a sentence without a number or a control name
 * is still true. Those were checked by reading the code on 9 Oct 2026 and are
 * recorded in config/help.ts's header. The help's two promises that answers
 * are kept are reading-retention.test.mts's, with every other surface's.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const HELP_SRC = "src/config/help.ts";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * config/help.ts is loaded, not parsed, so rule 3 can build the copy with the
 * trial off and the link rule reads the words a page renders. It imports by
 * `@/`, which only Next and tsc resolve, and pricing.ts takes TIER_PLAIN from
 * `@/components/TierName`, a .tsx node cannot load - the reason
 * price-schema.test.mts records for parsing pricing.ts instead. This resolves
 * `@/x` to src/x.ts, and TierName to lib/tier-text.ts, which is where
 * TierName takes both of the names pricing.ts imports from it (held below,
 * so the mapping cannot come to load something TierName does not export).
 * The hook is this file's alone: node --test runs every test file in its own
 * process. `registerHooks` is in Node 24 and not in @types/node 20, hence the
 * cast.
 */
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown): unknown }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("@/")) return next(specifier, context);
    const rel = specifier === "@/components/TierName" ? "lib/tier-text" : specifier.slice(2);
    const file = join(ROOT, "src", `${rel}.ts`);
    if (!existsSync(file)) throw new Error(`help.test.mts cannot load ${specifier} under node: only a .ts module resolves here`);
    return next(pathToFileURL(file).href, context);
  },
});
const { HELP, QUICK, HELP_INDEX, STILL_STUCK, helpContent } = await import("../config/help.ts");
type HelpContent = ReturnType<typeof helpContent>;

/**
 * The prose on one line of source: every string or template literal that
 * holds a space and a word. Each `${...}` is taken out of the text around it,
 * innermost first, so an interpolated figure is never read as a typed one -
 * and the literals inside it are read in their own right, because a sentence
 * chosen by a ternary (`${trialOn ? "..." : "..."}`) is prose too, and taking
 * the whole expression out hid it (review of MK-2, 9 Oct 2026). `ui("...")`
 * labels are left out: rule 2 holds those to the product.
 */
export function proseRuns(line: string): string[] {
  let s = line.replace(/\bui\("(?:[^"\\]|\\.)*"\)/g, "ui()");
  const exprs: string[] = [];
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/\$\{([^{}]*)\}/g, (_, expr: string) => {
      exprs.push(expr);
      return " ";
    });
  }
  const out: string[] = [];
  for (const part of [s, ...exprs]) {
    for (const m of part.matchAll(/"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)) {
      const run = m[1] ?? m[2] ?? "";
      if (/\s/.test(run) && /\w/.test(run)) out.push(run);
    }
  }
  return out;
}

/** The labels written as `ui("...")`. */
export function uiLabels(src: string): string[] {
  return [...src.matchAll(/\bui\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]!);
}

/**
 * Whether code draws `label`: a string literal of exactly those words, or JSX
 * text - between `>` or `}` and `<` or `{`, across lines - in source whose
 * comments are already cut. A label inside a longer string is another
 * control's words, not this one.
 */
export function drawn(label: string, product: readonly { src: string }[]): boolean {
  const e = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(["'\`])${e}\\1|[>}]\\s*${e}\\s*[<{]`);
  return product.some((p) => re.test(p.src));
}

/** A reply-time promise: "within a day", "in 24 hours", "the same week". */
const REPLY_TIME = /\b(?:within|in under|in)\s+(?:an?\s+|\d+\s+|one\s+|a few\s+)?(?:hours?|days?|weeks?|business|working)\b|\bsame (?:day|week)\b|\b24\s*(?:h\b|hours?)/i;

/**
 * A figure typed in words (review of MK-2, 9 Oct 2026: "thirty days to stop"
 * passed a digits-only probe). "one" is not on the list: it is a pronoun as
 * often as a number ("a new one", "a US one"), and the counts the copy gives
 * in it are definitions rather than limits - one keyword to a cluster, one
 * prompt to an angle.
 */
const NUMBER_WORD = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|fortnight)\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|mts)$/.test(e.name) && !e.name.includes(".test.")) out.push(rel);
  }
  return out;
}

const SRC = read(HELP_SRC);
const RUNS = code(SRC).split("\n").flatMap(proseRuns);
const SLUGS = HELP.map((a) => a.slug);

/**
 * The dashboard's own code, comments cut: its pages, its components and the rules behind them.
 * 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards host, so the dashboard is the
 * dashboards host's - src/app/dashboards, src/components/dash and src/lib/dash - beside src/lib/tracking as before
 * (src/app/app and src/components/app are gone).
 */
const PRODUCT = ["src/app/dashboards", "src/components/dash", "src/lib/dash", "src/lib/tracking"].flatMap((d) => walk(d)).map((f) => ({ f, src: code(read(f)) }));

/**
 * 18 Oct 2026, brief 2d: controls the help names that only the retired /app pages drew. The dashboards host draws
 * none of them, so these sentences in config/help.ts now describe a dashboard nobody can reach. Rewriting the help
 * for the dashboards host is its own piece of work - public, client-facing copy - and is not done by deleting the
 * pages it described. Recorded here rather than let rule 2 go red or stop reading: each entry is re-earned below
 * (still named by the help, still drawn nowhere), so the list can only shrink, and a new label the dashboard does
 * not draw still fails rule 2 exactly as before.
 */
const RETIRED_WITH_APP = new Set([
  "Add a cluster", "Answers CSV", "Answers naming you", "Ask us to change these", "Ask us to pick one", "Cancel trial",
  "Change keyword", "Check keyword", "Cited pages", "Cluster keywords on page 1", "Clusters in use", "Every check, day by day",
  "Every daily check, by cluster", "Keywords CSV", "Latest answers", "Make editor", "Make viewer", "Move", "Names we match",
  "Notes on this cluster", "Open cluster", "Other sites", "Pages the engines cite most", "Prompts you are named in",
  "Reports", "Review and confirm", "Send invite", "Share of voice", "Sign out of every device", "Start tracking this cluster",
  "Stop", "Who is named", "Who is named instead", "Who they see", "Yes, cancel the trial", "Your clusters", "Your site",
]);

type Block = HelpContent["articles"][number]["sections"][number]["blocks"][number];
const blockText = (b: Block): string[] => (typeof b === "string" ? [b] : "list" in b ? b.list : b.steps);

/** Every string a reader sees in one build of the help, marks and all. */
function strings(c: HelpContent): string[] {
  return [
    ...Object.values(c.index),
    ...c.quick.map((q) => q.q),
    ...c.articles.flatMap((a) => [a.title, a.description, a.standfirst, ...a.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockText)])]),
    STILL_STUCK,
  ];
}

test("the probes see what they are for", () => {
  assert.deepEqual(proseRuns('a: `Up to ${PROMPTS_PER_CLUSTER} prompts, ${x ? `#${y}` : ""} each`,'), ["Up to   prompts,   each"]);
  assert.deepEqual(proseRuns('"Up to 5 prompts"'), ["Up to 5 prompts"]);
  assert.deepEqual(proseRuns('presets("2026-10-09", null)'), [], "a value with no space is code, not prose");
  assert.deepEqual(
    proseRuns('`${on ? "Free for 14 days" : "Paid"} then ${ui("Cluster keywords on page 1")}`'),
    ["  then  ", "Free for 14 days"],
    "a sentence a ternary picks is prose; a ui() label is rule 2's",
  );
  assert.deepEqual(uiLabels('`On ${ui("Clusters")}, choose ${ui("Add a cluster")}.`'), ["Clusters", "Add a cluster"]);
  for (const bad of ["We reply within a day.", "Expect an answer in 24 hours.", "usually the same week", "within 2 working days"]) {
    assert.ok(REPLY_TIME.test(bad), bad);
  }
  for (const fine of ["Tracking carries on until the trial ends", "once a day", "the day after checkout", "for 30 days"]) {
    assert.ok(!REPLY_TIME.test(fine), fine);
  }
  assert.ok(NUMBER_WORD.test("with thirty days to stop") && NUMBER_WORD.test("The three roles") && !NUMBER_WORD.test("add a new one, often"));
});

test("rule 2 fails on a renamed control, and a comment naming it does not stand in", () => {
  // 18 Oct 2026, brief 2d: /app's Settings.tsx and its Cancel trial went with /app; the injected defect is now the
  // dashboards host's Settings' Remove, which the help names and nothing else in the dashboard draws.
  const settings = PRODUCT.find((p) => p.f === "src/app/dashboards/[client]/settings/page.tsx");
  assert.ok(settings, "the dashboards host's Settings is not where this reads it");
  assert.ok(drawn("Remove", PRODUCT), "Settings draws Remove today");
  // The injected defect: Settings' Remove renamed, in memory. team.ts's doc
  // comments still say "Remove"; they do not count.
  const renamed = settings.src.replace(">Remove</button>", ">Take off</button>");
  assert.notEqual(renamed, settings.src, "the Remove button is not where this renames it");
  assert.ok(!drawn("Remove", PRODUCT.map((p) => (p === settings ? { ...p, src: renamed } : p))), "a renamed Remove must go missing");
  assert.ok(!drawn("Cancel trial", [{ src: code('/** "Cancel trial" (Danny) */\n{/* "Cancel trial": a confirm */}\n// >Cancel trial<\nconst x = 1;') }]), "a label in a comment is not drawn");
  assert.ok(drawn("Stop", [{ src: "{STOP_ICON}Stop</>" }]) && drawn("Sign out", [{ src: "<button>\n  Sign out\n</button>" }]) && drawn("Overview", [{ src: 'label: "Overview",' }]));
  assert.ok(!drawn("Stop", [{ src: '"Stop tracking this cluster"' }]), "a label inside a longer string is another control");
});

test("the walk found the copy, the articles and the product, so a clean result is a reading", (t) => {
  t.diagnostic(`${SLUGS.length} articles, ${RUNS.length} prose runs, ${uiLabels(SRC).length} ui() labels, ${PRODUCT.length} dashboard source files`);
  // Floors, measured 9 Oct 2026: 7 articles, 187 prose runs, 83 control
  // labels, 97 dashboard source files. Then, the same day (review of MK-2):
  // 213 prose runs once the walk read the literals inside an interpolation,
  // and 84 labels once the setup page's heading came out of ui() - the page
  // draws no literal of those words - and two page names went in. Set below
  // the measure, so trimming a sentence does not trip them, and far above
  // what a walk that stopped matching finds.
  assert.ok(SLUGS.length >= 7, `only ${SLUGS.length} articles in ${HELP_SRC} - 7 on 9 Oct 2026`);
  assert.ok(RUNS.length >= 150, `only ${RUNS.length} prose runs read from ${HELP_SRC} - 213 on 9 Oct 2026`);
  assert.ok(uiLabels(SRC).length >= 60, `only ${uiLabels(SRC).length} ui() labels - 84 on 9 Oct 2026`);
  assert.ok(PRODUCT.length >= 90, `only ${PRODUCT.length} dashboard source files walked - 97 on 9 Oct 2026`);
});

test("every number the help states is interpolated from the code, never typed", () => {
  const typed = RUNS.filter((r) => /\d/.test(r) || NUMBER_WORD.test(r));
  assert.deepEqual(typed, [], `a figure is typed into the help copy - read it from the module that enforces it:\n${typed.join("\n")}`);
});

test("every control the help names is one the dashboard draws", () => {
  const missing = [...new Set(uiLabels(SRC))].filter((label) => !drawn(label, PRODUCT) && !RETIRED_WITH_APP.has(label));
  assert.deepEqual(missing, [], `the help names a control the dashboard's code does not draw - rename it in ${HELP_SRC}:\n${missing.join("\n")}`);
});

test("every control recorded as retired with /app is still named by the help and still drawn nowhere (18 Oct 2026, brief 2d)", () => {
  const labels = new Set(uiLabels(SRC));
  const stale = [...RETIRED_WITH_APP].filter((label) => !labels.has(label) || drawn(label, PRODUCT));
  assert.deepEqual(stale, [], "these are no longer named by the help, or the dashboard draws them again - take them off RETIRED_WITH_APP");
});

test("built with the trial off, the help names no trial; built on, it does", () => {
  // A link's address is not wording: the trial-and-cancelling slug stays in both states.
  const trial = (c: HelpContent) => strings(c).map((s) => s.replace(/\]\([^)]*\)/g, "]")).filter((s) => /\btrials?\b/i.test(s));
  const on = trial(helpContent(true));
  assert.ok(on.length >= 8, `the probe found ${on.length} strings naming the trial with it on - it has stopped reading the copy`);
  assert.deepEqual(trial(helpContent(false)), [], "with config/trial.ts's trial off, the help still offers one - gate these on trialOn");
  assert.deepEqual(
    helpContent(false).articles.map((a) => a.slug),
    helpContent(true).articles.map((a) => a.slug),
    "an article that comes and goes with the trial leaves a page with nothing to render",
  );
});

test("the help promises no reply time (R24, 26 Sep 2026)", () => {
  const files = [HELP_SRC, "src/components/HelpShell.tsx", ...walk("src/app/help")];
  const hits = files.flatMap((f) => code(read(f)).split("\n").flatMap(proseRuns).filter((r) => REPLY_TIME.test(r)).map((r) => `${f}: ${r}`));
  assert.deepEqual(hits, [], "a reply time is a promise Danny reversed; it is his to make again");
});

/**
 * Words the help renders as a link, in both states of the trial: a `link()`
 * label, an article's title (the aside and the index link it), a section's
 * heading (the contents link it) and a quick answer (the index links it). A
 * tier name there would be a bare word or a lockup inside a link, and both
 * are refused elsewhere - tier-lockup.test.mts on the built page, and
 * result-copy.test.mts's "no tier name sits inside a link" on the source.
 * Read off the built copy, so `${TRACKED}` is the word it renders, and
 * judged by splitTierNames, the split TierText draws a lockup by - so the
 * contact address, alwayscited's domain, is not read as the plan.
 */
function linkedWords(c: HelpContent): string[] {
  return [
    ...strings(c).flatMap((s) => [...s.matchAll(/\[([^\]]+)\]\(/g)].map((m) => m[1]!)),
    ...c.articles.flatMap((a) => [a.title, ...a.sections.map((s) => s.heading)]),
    ...c.quick.map((q) => q.q),
  ];
}
const namesATier = (w: string) => splitTierNames(w).some((seg) => "tier" in seg);

test("no link in the help is worded with a tier name", (t) => {
  assert.ok(namesATier("alwaystracked help") && !namesATier("Billing questions") && !namesATier("hello@alwayscited.com"));
  for (const on of [true, false]) {
    const words = linkedWords(helpContent(on));
    t.diagnostic(`trial ${on ? "on" : "off"}: ${words.length} linked strings`);
    // Floor, measured 9 Oct 2026: 59 link labels, titles and headings read off
    // the source; more once the quick answers and STILL_STUCK's links were
    // read off the built copy (review of MK-2, the same day).
    assert.ok(words.length >= 50, `only ${words.length} linked strings read - the probe has drifted`);
    const bad = words.filter(namesATier);
    assert.deepEqual(bad, [], "a tier name in a link renders bare or as a lockup inside the link; word the link plainly and name the tier in the sentence");
  }
  // The index's own title and heading are a page head and an h1, never a link.
  assert.ok(namesATier(HELP_INDEX.title) && QUICK.length >= 6);
});

test("the module mapping loads what TierName exports, and nothing else", () => {
  const tierName = read("src/components/TierName.tsx");
  assert.match(tierName, /^import \{[^}]*\bTIER_PLAIN\b[^}]*\btype TierKey\b[^}]*\} from "@\/lib\/tier-text";$/m, "TierName no longer takes TIER_PLAIN and TierKey from lib/tier-text");
  assert.match(tierName, /^export \{ TIER_PLAIN, type TierKey \};$/m, "TierName no longer re-exports them unchanged");
  assert.match(read("src/config/pricing.ts"), /^import \{ TIER_PLAIN, type TierKey \} from "@\/components\/TierName";$/m, "pricing.ts takes more from TierName than this file maps");
});

test("every article is a page, every page is an article, and each renders its own", () => {
  const dirs = readdirSync(join(ROOT, "src/app/help"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.deepEqual([...dirs].sort(), [...SLUGS].sort(), "src/app/help and the articles in config/help.ts disagree");
  for (const slug of dirs) {
    const page = read(`src/app/help/${slug}/page.tsx`);
    assert.match(page, new RegExp(`helpMetadata\\("${slug}"\\)`), `${slug}'s page carries another article's head`);
    assert.match(page, new RegExp(`<HelpArticlePage slug="${slug}" />`), `${slug}'s page renders another article`);
  }
  assert.ok(existsSync(join(ROOT, "src/app/help/page.tsx")), "the help index is gone");
});

test("every help page is offered: in the sitemap, and the footer reaches the index", () => {
  const sitemap = read("src/app/sitemap.ts");
  const offered = new Set([...sitemap.matchAll(/^\s*\["([^"]*)", "\d{4}-\d{2}-\d{2}"/gm)].map((m) => m[1]));
  const missing = ["/help", ...SLUGS.map((s) => `/help/${s}`)].filter((p) => !offered.has(p));
  assert.deepEqual(missing, [], "add these to ENTRIES in src/app/sitemap.ts");
  assert.match(read("src/components/Footer.tsx"), /\["Help", "\/help"\]/, "the footer no longer links the help centre");
});
