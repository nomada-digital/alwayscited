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
 */

const SRC = new URL("../", import.meta.url).pathname;
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(tsx?|mts)$/.test(e.name) && !e.name.endsWith(".test.mts") ? [join(dir, e.name)] : []));
const files = walk(SRC).map((f) => ({ path: f.slice(SRC.length), text: readFileSync(f, "utf8") }));

/** The dashboard: the routes beneath app/app/layout.tsx, and the components only they draw (held in the second test). */
const DASHBOARD = /^(app\/app\/|components\/app\/)/;

/** Each file's EngineLogo tags; every one is self-closing. */
const tags = (text: string) => [...text.matchAll(/<EngineLogo\b[\s\S]*?\/>/g)].map((m) => m[0]);

/** The files that draw a logo, on each side, 13 Oct 2026. A new one is added here after its side is checked. */
const SPRITE_FILES = [
  "components/app/Cited.tsx",
  "components/app/Clusters.tsx",
  "components/app/Named.tsx",
  "components/app/OneCluster.tsx",
  "components/app/Overview.tsx",
  "components/app/OverviewChart.tsx",
  "components/app/Placements.tsx",
  "components/app/Sidebar.tsx",
  "components/app/ai/AiVisibility.tsx",
];
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
      else assert.ok(isInline, `${f.path}: ${t} - nothing outside app/app mounts the sprite, so this logo would paint nothing; pass inline`);
      seen[isInline ? "inline" : "sprite"].add(f.path);
      if (isInline) inline++;
      else sprite++;
    }
  }
  assert.deepEqual([...seen.sprite].sort(), [...SPRITE_FILES].sort(), "the files drawing sprite logos moved - check the new one renders under app/app/layout.tsx, then record it");
  assert.deepEqual([...seen.inline].sort(), [...INLINE_FILES].sort(), "the files drawing inline logos moved - check the new one renders outside the dashboard, then record it");
  // 22 and 13 on 13 Oct 2026: a walk that stops matching the tags reports a clean tree.
  assert.ok(sprite >= 22, `floor: 22 sprite logos, found ${sprite}`);
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
  assert.ok(edges >= 2500, `floor: 2500 resolved value imports, found ${edges}`);
  const reach = new Set(SPRITE_FILES);
  for (const queue = [...SPRITE_FILES]; queue.length; ) for (const by of importers.get(queue.pop()!) ?? []) if (!reach.has(by) && (reach.add(by), true)) queue.push(by);
  const outside = [...reach].filter((p) => !DASHBOARD.test(p));
  assert.deepEqual(outside, [], "these draw a dashboard component outside app/app, where no sprite is mounted - its engine logos would paint nothing");
  // 27 on 13 Oct 2026: the nine files above and the 18 pages that draw them - every page with a sidebar, whose plan
  // card draws the tier's logos, and the parity page.
  assert.ok(reach.size >= 27, `floor: 27 files reach a sprite logo, found ${reach.size}`);
  assert.ok(reach.has("app/app/[client]/named/page.tsx") && reach.has("app/app/parity/page.tsx"), "the walk stopped following imports");
});

test("the sprite is mounted once, in app/app/layout.tsx, painted, and under the ids the logos use", () => {
  const mounts = files.flatMap((f) => [...f.text.matchAll(/<EngineSprite\b/g)].map(() => f.path));
  assert.deepEqual(mounts, ["app/app/layout.tsx"]);
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
