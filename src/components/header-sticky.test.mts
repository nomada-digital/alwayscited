import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { HEADER_H } from "./home/dark.ts";

/**
 * R175 (Danny, 1 Oct 2026, danny.md line 188): the site header is sticky on
 * every site page, anchors land below it, and every other top-sticky element
 * on the site offsets by its height. The height is written twice - HEADER_H
 * for the bar, --header-h for the stylesheet - so this holds them equal.
 */

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("R175: --header-h is HEADER_H, and anchors and the menu use it", () => {
  assert.match(css, new RegExp(`--header-h: ${HEADER_H}px;`));
  assert.match(css, /\.site-header \{\s*position: sticky; top: 0; z-index: 40;/);
  assert.match(css, /scroll-padding-top: calc\(var\(--header-h\) \+ 8px\);/);
  assert.match(css, /\.site-header__menu \{ max-height: calc\(100dvh - var\(--header-h\)\); overflow-y: auto;/);
  const header = readFileSync(new URL("./Header.tsx", import.meta.url), "utf8");
  assert.match(header, /className="site-header"/);
  assert.match(header, /className="site-header__menu"/);
  assert.match(header, /window\.scrollY > 8/, "the homepage wash gives way past 8px");
});

test("R175: every other top-sticky rule offsets by the header (the app shell and drawer heads excepted)", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*position: sticky;[^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  assert.ok(rules.length >= 3, `floor: 3 sticky rules, found ${rules.length}`);
  for (const r of rules) {
    if (r.sel === ".site-header" || /^\.ans-drawer__head|^\.app-/.test(r.sel) || !/\btop:/.test(r.body)) continue;
    assert.match(r.body, /top: calc\(var\(--header-h\)/, `${r.sel} sticks under the header`);
  }
  const SRC = new URL("../", import.meta.url).pathname;
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));
  const files = walk(SRC);
  assert.ok(files.length >= 100, `floor: 100 tsx files, found ${files.length}`);
  const inline = files.filter((f) => /position: "sticky"/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length));
  // 18 Oct 2026, brief 2d: the one inline sticky element was the /app sidebar (components/app/Sidebar.tsx), which has
  // no site header above it; it retired with /app, every address 308s to the dashboards host, so none is left.
  assert.deepEqual(inline, [], "an inline sticky element bypasses the header offset - write it as a globals.css rule");
});
