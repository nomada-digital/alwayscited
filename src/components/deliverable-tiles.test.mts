// "What lands each month" as tiles (Danny, 28 Sep 2026, R78). Every number on
// a tile is read from pricing.ts, the detail is rendered open until there is
// script to close it, and the collapse keeps the text in the DOM.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const page = read("./PackagePage.tsx");
const tiles = read("./DeliverableTiles.tsx");
const TIER_PAGES = ["alwaystracked", "alwaysmentioned", "alwayscited", "alwayseverywhere"];

test("the figure tiles read their numbers from pricing.ts, never a literal", () => {
  // 16 Oct 2026: tilesFor split into trackedTiles (the alwaystracked block
  // every plan includes) and sectionTiles (the cards), when the paid pages
  // gained a block of their own monthly deliverables between them.
  const fn = page.slice(page.indexOf("function trackedTiles"), page.indexOf("export default function PackagePage"));
  assert.ok(fn.length > 200, "trackedTiles was not found");
  // Clusters and prompts replaced the question tile on 29 Sep 2026 (R112/R115).
  assert.match(fn, /figure: String\(TRACKED_CLUSTERS\)/);
  assert.match(fn, /figure: String\(TRACKED_PROMPTS\)/);
  assert.match(fn, /figure: String\(TRACKED_KEYWORDS\)/);
  assert.match(fn, /enginesFor\(tier\.key\)\.length/);
  assert.match(fn, /<TierEngines tier=\{tier\.key\}/);
  assert.doesNotMatch(fn, /figure: "?\d/, "a tile figure is typed as a number");
});

test("every section on the four tier pages has a short word figure, never a number", () => {
  let n = 0;
  for (const t of TIER_PAGES) {
    // The cards only: since 16 Oct 2026 the paid pages also pass `monthly`,
    // whose figures have no heading and are checked in the test below.
    const all = read(`../app/${t}/page.tsx`);
    const src = all.slice(all.indexOf("sections={"));
    const figures = [...src.matchAll(/figure: "([^"]*)"/g)].map((m) => m[1]);
    const headings = [...src.matchAll(/heading: "/g)].length;
    assert.equal(figures.length, headings, `${t}: every section needs a figure`);
    for (const f of figures) {
      assert.doesNotMatch(f, /\d/, `${t}: "${f}" types a number`);
      assert.ok(f.length <= 12, `${t}: "${f}" is too long for a tile at 390`);
      n++;
    }
  }
  // 17 -> 13 on 16 Oct 2026: the cards that repeated a monthly tile went
  // (Screened and Replaced on alwaysmentioned, Schema on alwayscited, Tracked
  // on alwayseverywhere), Danny's call.
  assert.ok(n >= 13, `only ${n} section figures found - the walk stopped matching`);
});

test("the monthly block's numbers come from pricing.ts, never a literal (16 Oct 2026)", () => {
  let n = 0;
  for (const t of TIER_PAGES.slice(1)) {
    const all = read(`../app/${t}/page.tsx`);
    const block = all.slice(all.indexOf("monthly={["), all.indexOf("]}", all.indexOf("monthly={[")));
    assert.ok(block.length > 100, `${t}: the monthly block was not found`);
    // A count is written String(NAME) or in a template; a quoted figure is a word.
    for (const m of block.matchAll(/figure: "([^"]*)"/g)) assert.doesNotMatch(m[1], /\d/, `${t}: "${m[1]}" types a number`);
    for (const m of block.matchAll(/label: "([^"]*)"/g)) assert.doesNotMatch(m[1], /\d/, `${t}: "${m[1]}" types a number`);
    n += [...block.matchAll(/figure: /g)].length;
  }
  assert.ok(n >= 11, `only ${n} monthly figures found - the walk stopped matching`);
});

test("the detail is open on the server and stays in the DOM when closed", () => {
  assert.match(tiles, /useState<Record<string, boolean> \| null>\(null\)/, "the first render is not the open one");
  assert.match(tiles, /open === null \|\|/, "a null state no longer reads as open");
  assert.match(tiles, /aria-expanded=\{open\}/);
  assert.doesNotMatch(tiles, /display: "none"|\{open \? <|open && </, "closing removes or hides the text instead of collapsing it");
});
