import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

/**
 * Dashboard speed, payload (13 Oct 2026): inside the dashboard EngineLogo is a
 * <use> of the one sprite app/app/layout.tsx mounts (EngineSprite), and
 * outside it there is no sprite, so every caller passes `inline` and draws the
 * paths as before. A logo on the wrong side of that line fails without a
 * sound: a <use> with no sprite under it paints nothing, and an inline mark in
 * the dashboard is 0.5 to 2.8 KB of payload a time - Who is named draws up to
 * 50 rows of four. So this records which files draw which, and the rule that
 * keeps every dashboard component beneath the layout that mounts the sprite.
 *
 * 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards
 * host. app/app/layout.tsx and everything beneath it are gone, so the
 * dashboard is the dashboards host's tree alone and the rule holds there.
 */

const SRC = new URL("../", import.meta.url).pathname;
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(tsx?|mts)$/.test(e.name) && !e.name.endsWith(".test.mts") ? [join(dir, e.name)] : []));
const files = walk(SRC).map((f) => ({ path: f.slice(SRC.length), text: readFileSync(f, "utf8") }));

/** The dashboard: the routes beneath app/dashboards/layout.tsx, and the components only they draw (held in the second test). */
// 17 Oct 2026: the dashboards host's tree mounts the sprite too (app/dashboards/layout.tsx).
// 18 Oct 2026, brief 2d: app/app/ and components/app/ retired with /app; the dashboards host's tree is the dashboard.
const DASHBOARD = /^(app\/dashboards\/|components\/dash\/)/;

/** Each file's EngineLogo tags; every one is self-closing. */
const tags = (text: string) => [...text.matchAll(/<EngineLogo\b[\s\S]*?\/>/g)].map((m) => m[0]);

/** The files that draw a logo, on each side, 13 Oct 2026. A new one is added here after its side is checked. */
const SPRITE_FILES = [
  // 18 Oct 2026, brief 2d: the nine components/app files (Cited, Clusters, Named, OneCluster, Overview, OverviewChart,
  // Placements, Sidebar, ai/AiVisibility) retired with /app.
  // 17 Oct 2026, dashboards.alwayscited.com: rendered under app/dashboards/layout.tsx, which mounts the sprite.
  "app/dashboards/[client]/ai/page.tsx",
  // 17 Oct 2026: the click-through views and the AI tab's prompt manager, all under app/dashboards/layout.tsx.
  "app/dashboards/[client]/ai/[prompt]/page.tsx",
  "app/dashboards/[client]/sources/[domain]/page.tsx",
  "components/dash/PromptManager.tsx",
  "app/dashboards/[client]/sources/page.tsx",
  "components/dash/Figures.tsx",
  // 18 Oct 2026 (brief 2g): the alwaystracked view's engine row, under app/dashboards/layout.tsx.
  "app/dashboards/[client]/alwaystracked/page.tsx",
];
/**
 * 18 Oct 2026, brief 2d: the floors as measured on the dashboards host the day /app was retired - 9 sprite logos
 * (22 before), 2,407 resolved value imports over the whole tree (floor 2,200; 2,500 before) and 24 files reaching a
 * sprite logo (27 before).
 */
const SPRITE_FLOOR = 9;
const EDGE_FLOOR = 2200;
const REACH_FLOOR = 24;

const INLINE_FILES = [
  "app/pr-agencies/page.tsx",
  "app/seo-agencies/page.tsx",
  "components/ProcessSequence.tsx",
  "components/TierEngines.tsx",
  "components/TrackedBeat.tsx",
  "components/home/EngineDemo.tsx",
  "components/scan/ResultView.tsx",
  "components/scan/ScanProgress.tsx",
];

test("every EngineLogo in the dashboard draws from the sprite, and every one outside it inline", () => {
  assert.ok(files.length >= 500, `floor: 500 source files, found ${files.length}`);
  const seen = { sprite: new Set<string>(), inline: new Set<string>() };
  let sprite = 0;
  let inline = 0;
  for (const f of files) {
    for (const t of tags(f.text)) {
      const isInline = /\sinline(?=\s|\/>|=\{true\})/.test(t);
      if (DASHBOARD.test(f.path)) assert.ok(!isInline, `${f.path}: ${t} - the dashboard mounts the sprite, so its logos are <use>s; inline puts the paths back in every row's payload`);
      else assert.ok(isInline, `${f.path}: ${t} - nothing outside app/dashboards mounts the sprite, so this logo would paint nothing; pass inline`);
      seen[isInline ? "inline" : "sprite"].add(f.path);
      if (isInline) inline++;
      else sprite++;
    }
  }
  assert.deepEqual([...seen.sprite].sort(), [...SPRITE_FILES].sort(), "the files drawing sprite logos moved - check the new one renders under app/dashboards/layout.tsx, then record it");
  assert.deepEqual([...seen.inline].sort(), [...INLINE_FILES].sort(), "the files drawing inline logos moved - check the new one renders outside the dashboard, then record it");
  // 22 and 13 on 13 Oct 2026: a walk that stops matching the tags reports a clean tree.
  // 18 Oct 2026, brief 2d: /app's sprite logos went with it; SPRITE_FLOOR sprite logos measured that day on the dashboards host.
  assert.ok(sprite >= SPRITE_FLOOR, `floor: ${SPRITE_FLOOR} sprite logos, found ${sprite}`);
  assert.ok(inline >= 13, `floor: 13 inline logos, found ${inline}`);
});

test("every file that draws a sprite logo, itself or through what it imports, is in the dashboard", () => {
  // The import graph by value: a type-only import draws nothing. Each specifier resolved from its file ("@/" from
  // src/), with the extensions the tree leaves off. Then every file that reaches a sprite logo through it.
  const statement = /^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;
  const known = new Set(files.map((f) => f.path));
  const resolveSpec = (from: string, spec: string): string | null => {
    const abs = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(join(SRC, from)), spec) : null;
    if (abs === null) return null;
    const rel = abs.slice(SRC.length);
    return ["", ".tsx", ".ts", ".mts", "/index.tsx", "/index.ts"].map((x) => rel + x).find((c) => known.has(c)) ?? null;
  };
  const importers = new Map<string, string[]>();
  let edges = 0;
  for (const f of files) {
    for (const m of f.text.matchAll(statement)) {
      if (m[2]) continue;
      const to = resolveSpec(f.path, m[3] ?? m[4]!);
      if (to === null) continue;
      importers.set(to, [...(importers.get(to) ?? []), f.path]);
      edges++;
    }
  }
  // 2,906 on 13 Oct 2026.
  // 18 Oct 2026, brief 2d: /app's imports went with it; EDGE_FLOOR is set below that day's measure.
  assert.ok(edges >= EDGE_FLOOR, `floor: ${EDGE_FLOOR} resolved value imports, found ${edges}`);
  const reach = new Set(SPRITE_FILES);
  for (const queue = [...SPRITE_FILES]; queue.length; ) for (const by of importers.get(queue.pop()!) ?? []) if (!reach.has(by) && (reach.add(by), true)) queue.push(by);
  const outside = [...reach].filter((p) => !DASHBOARD.test(p));
  assert.deepEqual(outside, [], "these draw a dashboard component outside app/dashboards, where no sprite is mounted - its engine logos would paint nothing");
  // 27 on 13 Oct 2026: the nine files above and the 18 pages that draw them - every page with a sidebar, whose plan
  // card draws the tier's logos, and the parity page.
  // 18 Oct 2026, brief 2d: those went with /app; REACH_FLOOR files on the dashboards host that day. The two probes are
  // a page that draws Figures (an import away) and the layout that draws the shell.
  assert.ok(reach.size >= REACH_FLOOR, `floor: ${REACH_FLOOR} files reach a sprite logo, found ${reach.size}`);
  assert.ok(reach.has("app/dashboards/[client]/google/page.tsx") && reach.has("app/dashboards/[client]/layout.tsx"), "the walk stopped following imports");
});

test("the sprite is mounted once, in app/dashboards/layout.tsx, painted, and under the ids the logos use", () => {
  const mounts = files.flatMap((f) => [...f.text.matchAll(/<EngineSprite\b/g)].map(() => f.path));
  // 17 Oct 2026: the dashboards host's layout mounts its own; no page renders under both layouts.
  // 18 Oct 2026, brief 2d: app/app/layout.tsx retired with /app, so the dashboards host's is the one mount.
  assert.deepEqual(mounts.sort(), ["app/dashboards/layout.tsx"]);
  const logo = files.find((f) => f.path === "components/EngineLogo.tsx")!.text;
  const sprite = logo.slice(logo.indexOf("export function EngineSprite("), logo.indexOf("\n}\n", logo.indexOf("export function EngineSprite(")));
  assert.ok(sprite.length > 100, "EngineSprite not found");
  // display:none (or the hidden attribute) is the trap: a gradient defined under it is not painted - every Gemini mark
  // on a phone drew flat blue until 13 Oct 2026, its first gradient copy being in the sidebar a phone hides.
  assert.doesNotMatch(sprite, /\shidden(?=[\s/>])|display:\s*"none"/);
  assert.match(sprite, /width="0" height="0"/);
  assert.match(logo, /<symbol id="\$\{symbolId\(e\)\}"/);
  assert.match(logo, /<use href=\{`#\$\{symbolId\(p\.engine\)\}`\} \/>/);
});
