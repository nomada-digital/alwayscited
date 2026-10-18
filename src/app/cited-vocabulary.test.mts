import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The Cited pages page names no price, no marketplace, no difficulty, no DR
 * and no "you could place this" (R144, 1 Oct 2026; BRIEF-4 P4). It lists
 * other people's pages beside how often the engines cite them; a price or a
 * DR beside that list turns a reading into a quote for a placement nobody
 * has offered.
 *
 * Read: the source of the page and its component, comments stripped - every
 * word the page's own column can draw is a literal in one of these two
 * files, and the rest is the client's prompts and the cited hosts and paths.
 * Not the captured HTML: `npm run capture` runs without TRACKING_FIXTURE, so
 * every `/app/example/*` state it renders is the login page, and a sweep of
 * it would pass over nothing. Not the sidebar either: its T11 pack line
 * ("Add 5 clusters for $49 a month") names a price in nomada mode, and
 * upgrade prompts stay where T11 put them, by the brief.
 *
 * Floor: the component's heading and its five column heads, so a file that
 * moves or empties fails here instead of reading clean.
 *
 * 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards
 * host. The rule still holds for its live equivalent, the dashboards host's
 * Sources ("What AI reads") and one source, so the census reads those two
 * pages now; the floor is that page's heading and its five column heads.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const FILES = ["src/app/dashboards/[client]/sources/page.tsx", "src/app/dashboards/[client]/sources/[domain]/page.tsx"];
const BANNED = /[$£€]\s?\d|\bprices?\b|\bpricing\b|\bcosts?\b|\bmarketplaces?\b|\bdifficulty\b|\bDR\b|domain rating|\bplace (?:this|it|here)\b|could place/gi;
// Imports go too: page.tsx imports trackingPackPrice from "@/config/pricing" for the sidebar's pack line.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/^import [\s\S]*?;$/gm, "");

test("Sources (once Cited pages) names no price, marketplace, difficulty, DR or 'you could place this'", () => {
  const src = Object.fromEntries(FILES.map((f) => [f, stripComments(readFileSync(join(ROOT, f), "utf8"))]));
  for (const head of ["What AI reads", "Site", "Cited in", "Pages", "Prompts", "Engines"]) {
    assert.ok(src[FILES[0]!]!.includes(head), `${FILES[0]} no longer draws "${head}" - the census is reading the wrong file`);
  }
  const hits: string[] = [];
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(BANNED)) {
      const i = m.index ?? 0;
      hits.push(`${f}: ...${s.slice(Math.max(0, i - 50), i + 40).replace(/\s+/g, " ")}...`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the census catches what it is for", () => {
  for (const bad of ["from $49", "DR 72", "Marketplace", "You could place this page", "Difficulty: low"]) {
    assert.ok(new RegExp(BANNED.source, "i").test(bad), bad);
  }
});
