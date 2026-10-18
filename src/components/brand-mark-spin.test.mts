import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * R174 (Danny, 1 Oct 2026, danny.md lines 187-188): the header BrandMark
 * turns once every 7.0s, 1.1s of turn; no other mark turns, and reduced
 * motion stops it. Recorded in docs/rules.md.
 */

const SRC = new URL("../", import.meta.url).pathname;
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));
}

test("R174: only the header's BrandMark spins, and the walk still finds every mark", () => {
  const sites = walk(SRC).flatMap((f) => (readFileSync(f, "utf8").match(/<BrandMark\b[^>]*>/g) ?? []).map((tag) => ({ f: f.slice(SRC.length), tag })));
  // 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards host. Its six marks (error, not-found,
  // setup, auth, login, Sidebar) went with it: 11 call sites became 5, so the floor moves from 7 to 5.
  assert.ok(sites.length >= 5, `floor: 5 call sites, found ${sites.length}`);
  const spinning = sites.filter((s) => /\bspin\b/.test(s.tag));
  assert.deepEqual(spinning.map((s) => s.f), ["components/Header.tsx"]);
  assert.match(spinning[0]!.tag, /id="hdr"/);
});

test("R174: a 7s cycle with a 1.1s turn, a hover/focus turn, and none under reduced motion", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.brand-mark--spin \{[^}]*animation: brand-spin 7s infinite;/);
  assert.match(css, /15\.714%, 100% \{ transform: rotate\(360deg\); \}/, "1.1 / 7 of the cycle");
  assert.match(css, /a:focus-visible > \.brand-mark--spin \{\s*animation: brand-turn 1\.1s ease-in-out 1;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.brand-mark--spin,\s*a:hover > \.brand-mark--spin,\s*a:focus-visible > \.brand-mark--spin \{ animation: none; \}/);
});
