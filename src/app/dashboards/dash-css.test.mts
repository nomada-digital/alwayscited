import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The dashboards host's stylesheet, measured (17 Oct 2026).
 *
 * contrast.test.mts reads inline styles and records the few stylesheet rules
 * it cannot resolve; the dashboards host is the opposite - nearly every colour
 * is a class in dash.css - so that file's record would be a hundred lines of
 * reasons for one sheet. This file measures the sheet instead: every rule that
 * sets a text colour is measured against its own ground, or, when it sets
 * none, against every ground the host paints, and each must clear WCAG AA for
 * body text (4.5:1). contrast.test.mts leaves this one sheet to this file and
 * says so; motion-rest-state.test.mts still checks its animations.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const CSS = readFileSync(join(ROOT, "src", "app", "dashboards", "dash.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const GLOBALS = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const TOKENS = readFileSync(join(ROOT, "src", "config", "tokens.ts"), "utf8");

/** Every `--name: #hex` the two sheets define; dash.css's own .dash block wins. */
function tokens(): Map<string, string> {
  const out = new Map<string, string>();
  for (const src of [GLOBALS, CSS]) for (const [, k, v] of src.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out.set(k!, v!.toLowerCase());
  return out;
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
/** `color-mix(in srgb, A n%, transparent)` over a ground: A at n% alpha. */
function over(fg: string, alpha: number, ground: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(ch(fg, i) * alpha + ch(ground, i) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

type Rule = { selector: string; color: string | null; ground: string | null };
function rules(): Rule[] {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selector: sel!.trim(),
    color: /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(body!)?.[1]?.trim() ?? null,
    ground: /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/.exec(body!)?.[1]?.trim() ?? null,
  }));
}

/** The grounds text with no ground of its own can land on: the page, cards, chips, the wash rows and the warn banner. */
const AMBIENT = ["bg", "surface", "chip", "wash", "warn-bg"];

/** Colour rules that are not text, each with why. */
const NOT_TEXT: Record<string, string> = {
  ".item .grip": "the drag grip, a decorative glyph beside a row whose whole surface is the drag handle; aria-hidden",
};

test("the dashboards stylesheet writes no colour but its tokens, and its tokens are tokens.ts's", () => {
  const t = tokens();
  const own = /\.dash\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
  for (const [, k, v] of own.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    assert.ok(TOKENS.toLowerCase().includes(`"${v!.toLowerCase()}"`), `--${k} ${v} is not a value in config/tokens.ts`);
  }
  const outside = CSS.replace(/\.dash\s*\{[^}]*\}/, "");
  assert.deepEqual(outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [], [], "a colour literal outside the token block");
  assert.ok(t.size >= 15, `floor: 15 tokens resolved, found ${t.size}`);
});

test("every text colour in the dashboards stylesheet clears 4.5:1 on every ground it can land on", () => {
  const t = tokens();
  const hex = (v: string) => {
    const m = /^var\(--([a-z-]+)\)$/.exec(v);
    return m ? (t.get(m[1]!) ?? null) : null;
  };
  const all = rules();
  assert.ok(all.length >= 120, `floor: 120 rules parsed, found ${all.length}`);
  const failing: string[] = [];
  let measured = 0;
  for (const r of all) {
    if (!r.color || r.color === "inherit" || Object.hasOwn(NOT_TEXT, r.selector)) continue;
    const fg = hex(r.color);
    assert.ok(fg, `${r.selector}: color ${r.color} is not a token`);
    const mix = r.ground ? /^color-mix\(in srgb, var\(--([a-z-]+)\) (\d+)%, transparent\)$/.exec(r.ground) : null;
    // A translucent ground (the toast's buttons) is measured over each ground its parent paints.
    const grounds = mix
      ? ["ink", "bad-fg"].map((g) => over(t.get(mix[1]!)!, Number(mix[2]) / 100, t.get(g)!))
      : r.ground && hex(r.ground)
        ? [hex(r.ground)!]
        : AMBIENT.map((g) => t.get(g)!);
    for (const g of grounds) {
      measured++;
      const c = ratio(fg!, g);
      if (c < 4.5) failing.push(`${r.selector}: ${r.color} on ${g} is ${c.toFixed(2)}:1`);
    }
  }
  assert.ok(measured >= 200, `floor: 200 colour-on-ground pairs measured, found ${measured}`);
  assert.deepEqual(failing, []);
});

test("text in the faint grey is gone: it measures under AA on white", () => {
  const t = tokens();
  assert.ok(ratio(t.get("faint")!, t.get("surface")!) < 4.5, "if --faint now clears AA, this rule can be relaxed");
  const text = rules().filter((r) => r.color === "var(--faint)" && !Object.hasOwn(NOT_TEXT, r.selector));
  assert.deepEqual(text.map((r) => r.selector), []);
});
