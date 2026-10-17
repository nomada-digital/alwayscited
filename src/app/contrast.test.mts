import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BUILD_DIR, PRERENDER_DIR as PRERENDER, sweptPages } from "./dynamic-render.mts";
import { T } from "../config/tokens.ts";

/**
 * What every coloured string on this site is actually sitting on.
 *
 * ## Why this could not be done before, and why it can be now
 *
 * blocked.md 9 is the contrast decision, and it says the measurement "depends
 * on what the element is sitting on, and only a rendered page knows that -
 * which is why a source read never caught it and a browser did". The first
 * half is right and the second half is not. A source read cannot do it,
 * because a call site says `color: T.soft` and says nothing about the ground.
 * **The built bytes can**: every ground on this site is a `background` on an
 * ancestor's inline style, so the answer is in the HTML, one tag stack away.
 *
 * That matters beyond tidiness. The browser measurement behind blocked.md 9
 * read **two pages** - the homepage and one blog post - and extrapolated the
 * rest from the chrome. This reads all 31 swept states and every element on
 * them, which is how the count in that entry went from "43 on the homepage,
 * 26 on a post" to the exact figure now recorded there.
 *
 * ## What holds the property that is already fixed
 *
 * `37512ae` moved 46 sites from `faint` to `soft` BY HAND, because `faint` is
 * 2.54 on white and `tokens.ts` says in its own doc comment that light-ground
 * text does not use it. Nothing held that. A sweep pointed at the token would
 * have been decoration - there is no live instance, every `faint` in the
 * shipped bytes is on a dark ground at 6.99:1 or better - but the same walk
 * that proves it also judges every other colour on the site, and four of those
 * pairs do fail. So the rule is stated over the whole palette rather than over
 * one token, and it fails on a 27th pair rather than on a name somebody
 * thought of.
 *
 * ## What it cannot see, stated plainly
 *
 * - **A colour set by the stylesheet.** This walk reads inline styles, which
 *   is where this site puts nearly everything. `globals.css` sets a colour in
 *   six rules and they are pinned by the last test here, with a reason each,
 *   because a rule that cannot resolve them should say which ones it is
 *   passing over rather than pass over them quietly.
 * - **A gradient.** `.btn-primary` is white on a purple gradient, so its label
 *   has no single ground - it has a range. That is measured in the last test
 *   and it is the one place on the site where the answer is worse than the
 *   inline sweep can see: blocked.md 31.
 * - **Opacity.** The motion from-state rests at `.15`, which no reader ever
 *   sees at rest, and the failsafe bounds it - `motion-rest-state.test.mts`
 *   holds that and it is not a contrast question.
 * - **An image behind text.** There is none; `page-head.test.mts` asserts
 *   there is no `<img>` on the site at all.
 */

const NEEDS_BUILD = "no build to read - run `npm run build` then `npm run capture`";

/** The page ground, set on `body` in globals.css as `var(--bg)`. */
const PAGE_GROUND = T.bg.toLowerCase();

// ------------------------------------------------------------- the probes

/** sRGB relative luminance, WCAG 2.1 definition. */
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? [...n].map((c) => c + c).join("") : n;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Contrast ratio, lighter over darker. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The declaration's value, or null. Declarations here never contain a `;`. */
function decl(style: string, prop: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(style);
  return m ? m[1]!.trim() : null;
}

/**
 * The hex in a value, or null.
 *
 * `null` is the right answer for `none` and `transparent` - both are real
 * background values in these bytes and neither replaces the ground under
 * them, so the walk has to keep inheriting rather than treat them as a
 * colour.
 */
function hexOf(value: string | null): string | null {
  if (!value) return null;
  return /#[0-9a-f]{3,8}\b/i.exec(value)?.[0]?.toLowerCase() ?? null;
}

type Measured = {
  page: string;
  colour: string;
  ground: string;
  /** Computed px, so the large-text threshold can be applied honestly. */
  px: number;
  bold: boolean;
  sample: string;
};

/** Void and SVG-shape elements, which never open a scope with content in it. */
const VOID = new Set([
  "br", "img", "meta", "link", "input", "hr", "source", "col", "area", "base", "embed", "track", "wbr",
  "path", "circle", "rect", "line", "use", "stop", "polygon", "polyline", "ellipse",
]);

/**
 * Font size in px, resolved against what it inherits.
 *
 * `em` matters rather than being pedantry: the `[TO CONFIRM]` markers are set
 * at `0.95em`, so reading that as "no size given" would judge them at the
 * inherited size and the large-text branch would be answering about the wrong
 * text. `rem` resolves against 16, which is the root size this site never
 * changes.
 */
function sizeOf(value: string | null, inherited: number): number {
  if (!value) return inherited;
  const m = /^([\d.]+)(px|em|rem|%)?$/.exec(value.trim());
  if (!m) return inherited;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return inherited;
  if (m[2] === "em") return inherited * n;
  if (m[2] === "%") return (inherited * n) / 100;
  if (m[2] === "rem") return 16 * n;
  return n;
}

/**
 * Every element on a page that sets a colour, with the ground it inherits.
 *
 * Scripts and styles are cut whole first. They paint nothing, and leaving them
 * in is worse than useless here: the flight payload is markup-shaped text, and
 * an unbalanced tag inside it would pop this walk's stack and hand the wrong
 * ground to everything after it.
 */
export function measure(page: string, html: string): Measured[] {
  const painted = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const stack = [{ ground: PAGE_GROUND, hidden: false, px: 16, bold: false }];
  const out: Measured[] = [];

  for (const m of painted.matchAll(/<(\/?)([a-z0-9-]+)([^>]*)>/gi)) {
    const [whole, closing, name, attrs] = m;
    const tag = name!.toLowerCase();
    if (closing) {
      // A void or shape element never pushed, so its closing tag must not pop.
      // React writes `<line ...></line>` and `<path ...></path>`, and before
      // 25 Sep 2026 each of those popped the element that held the svg - so
      // everything after an inline mark inherited the ground from one level
      // up. Invisible while every mark sat on a light ground; the homepage's
      // dark hero is where it first measured wrong.
      if (VOID.has(tag)) continue;
      if (stack.length > 1) stack.pop();
      continue;
    }
    const top = stack[stack.length - 1]!;
    if (VOID.has(tag) || whole.endsWith("/>")) continue;

    const style = /style="([^"]*)"/i.exec(attrs!)?.[1] ?? "";
    const cls = /class="([^"]*)"/i.exec(attrs!)?.[1] ?? "";
    // `.sr-only` is read aloud and never painted, and it has fooled a probe
    // here twice - once for contrast, once for not being a lockup.
    const hidden = top.hidden || /\bsr-only\b/.test(cls);
    const ground = hexOf(decl(style, "background-color")) ?? hexOf(decl(style, "background")) ?? top.ground;
    const px = sizeOf(decl(style, "font-size"), top.px);
    const weight = decl(style, "font-weight");
    const bold = weight ? Number(weight) >= 700 || weight === "bold" : top.bold;
    const colour = hexOf(decl(style, "color"));

    if (colour && !hidden) {
      const after = painted.slice(m.index + whole.length);
      const cut = after.indexOf("<");
      out.push({
        page,
        colour,
        ground,
        px,
        bold,
        sample: (cut < 0 ? after : after.slice(0, cut)).trim().slice(0, 40),
      });
    }
    stack.push({ ground, hidden, px, bold });
  }
  return out;
}

/**
 * WCAG AA for body text is 4.5:1. Large text - 24px, or 18.66px bold - is
 * 3:1, and this site has none that would need it today. It is here so the rule
 * does not fail on a correct new heading, which is how a tripwire gets deleted
 * by the next person rather than heeded.
 */
function required(el: Measured): number {
  return el.px >= 24 || (el.bold && el.px >= 18.66) ? 3 : 4.5;
}

// ------------------------------------------------------- the probes, proved

test("the ground walk carries a background down the tag stack", () => {
  const nested = measure(
    "fixture",
    `<div style="background:#0f1115"><div class="ac-row"><p style="color:#9ca3af">Step 4</p></div></div>`,
  );
  assert.equal(nested.length, 1);
  assert.equal(nested[0]!.ground, "#0f1115", "a colour inherits the nearest ancestor background, not the page");
  assert.equal(round(contrast(nested[0]!.colour, nested[0]!.ground)), 7.44);

  const closed = measure(
    "fixture",
    `<div style="background:#0f1115"><p style="color:#fff">a</p></div><p style="color:#6f7480">b</p>`,
  );
  assert.equal(closed[1]!.ground, PAGE_GROUND, "the dark ground ends where its element closes");

  const transparent = measure(
    "fixture",
    `<div style="background:#0f1115"><div style="background:transparent"><p style="color:#fff">a</p></div></div>`,
  );
  assert.equal(transparent[0]!.ground, "#0f1115", "`transparent` is not a ground, it is the absence of one");

  const marked = measure(
    "fixture",
    `<div style="background:#0f1115"><svg><g><line x1="1"></line><path d="M0"></path></g></svg><p style="color:#fff">a</p></div>`,
  );
  assert.equal(marked[0]!.ground, "#0f1115", "a closing </line> or </path> popped the ground out from under an inline svg");
});

test("the walk skips what is never painted, and sizes what is", () => {
  const hidden = measure("fixture", `<p class="sr-only" style="color:#9ca3af">read aloud</p>`);
  assert.deepEqual(hidden, [], "`.sr-only` text is not painted and must not be measured");

  const inScript = measure(
    "fixture",
    `<script>[{"style":{"color":"#9ca3af"}}]</script><p style="color:#0f1115">x</p>`,
  );
  assert.equal(inScript.length, 1, "a colour inside a script paints nothing");

  const em = measure("fixture", `<p style="font-size:20px"><mark style="font-size:0.95em;color:#c96a15">[</mark></p>`);
  assert.equal(em[0]!.px, 19, "an em size resolves against what it inherits");

  const large = measure("fixture", `<h1 style="font-size:36px;color:#6f7480">x</h1>`);
  assert.equal(required(large[0]!), 3, "36px is large text, which AA puts at 3:1");
  const body = measure("fixture", `<p style="font-size:15px;color:#6f7480">x</p>`);
  assert.equal(required(body[0]!), 4.5, "15px is body text, which AA puts at 4.5:1");
});

// --------------------------------------------------------- the real pages

/**
 * The colour/ground pairs that fail AA and are not mine to fix.
 *
 * **Empty since 24 September 2026, and that is the point of it.**
 *
 * It held four entries, all blocked.md 9, all the same two token values:
 * `soft` at 4.33 on the page ground, 4.18 on the purple wash and 4.26 on a
 * chip, and `warnFg` at 3.39 on the warn ground. Changing which token a call
 * site uses was mine and was taken in `37512ae`; changing what a token is
 * *worth* alters every page against the boards, so it was his.
 *
 * Danny took it on 24 September 2026: `soft` to #686d79 and `warnFg` to
 * #a95912. Every one of the four now clears AA, which is why the list is empty
 * rather than rewritten - an exemption whose answer has landed is an
 * allowance the next failure inherits.
 *
 * The shape stays because the next one will need it. An entry is read off the
 * tokens rather than typed as hex, so it is keyed to the token and not to a
 * string that could go on matching after the token moved, and `ratio` is
 * re-earned below - so a value that changes fails here rather than quietly
 * surviving its own answer. Same device as `mail-from.test.mts` asserting the
 * fallback is still on `resend.dev`.
 */
const BLOCKED_ON_DANNY: { colour: string; ground: string; ratio: number; why: string }[] = [];

const key = (colour: string, ground: string) => `${colour.toLowerCase()} on ${ground.toLowerCase()}`;
const EXEMPT = new Set(BLOCKED_ON_DANNY.map((e) => key(e.colour, e.ground)));

function census() {
  return sweptPages().flatMap(({ page, html }) => measure(page, html));
}

test("the contrast sweep can still see the pages, the grounds and the sizes", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const all = census();
  const pages = new Set(all.map((e) => e.page));
  // Floors, not an empty list read as a clean site. Every assertion below is
  // over this set, and a walk that stopped matching would show green.
  assert.ok(pages.size >= 25, `expected 25+ swept pages with colour on them, saw ${pages.size}`);
  assert.ok(all.length >= 1000, `expected 1000+ coloured elements, measured ${all.length}`);

  // The ancestor walk has to be doing something. If every ground resolved to
  // the page default the sweep would be judging dark-panel text against a
  // light ground - which would fail loudly - but the reverse rot is silent:
  // a walk that stopped finding backgrounds is one that stopped narrowing.
  const grounds = new Set(all.map((e) => e.ground));
  assert.ok(grounds.size >= 4, `expected 4+ distinct grounds, found ${[...grounds].join(", ")}`);
  assert.ok(
    all.some((e) => luminance(e.ground) < 0.2),
    "no element resolved to a dark ground, so the background walk has stopped carrying one down",
  );

  /**
   * And the values it could not read.
   *
   * Every inline colour on this site is a six-digit hex except three, which
   * belong to Next's own error page and resolve from a stylesheet that is not
   * ours. Pinned rather than skipped in silence: a `rgba()` or a
   * `var(--something)` appearing in our own markup is a hole in this sweep,
   * and it should arrive as a failure rather than as a smaller denominator.
   */
  const unreadable = new Set<string>();
  for (const { html } of sweptPages()) {
    for (const m of html.matchAll(/style="([^"]*)"/gi)) {
      const value = decl(m[1]!, "color");
      if (value && !hexOf(value)) unreadable.add(value);
    }
  }
  assert.deepEqual(
    [...unreadable].sort(),
    ["var(--next-error-btn-text)", "var(--next-error-message)", "var(--next-error-title)"],
    "an inline colour this sweep cannot resolve appeared in our own markup - it is being passed over silently",
  );
});

test("every colour on this site clears AA against the ground it sits on", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const failing = new Map<string, { ratio: number; pages: Set<string>; n: number; sample: string }>();
  for (const el of census()) {
    const ratio = contrast(el.colour, el.ground);
    if (ratio >= required(el)) continue;
    const k = key(el.colour, el.ground);
    if (EXEMPT.has(k)) continue;
    const seen = failing.get(k) ?? { ratio: round(ratio), pages: new Set<string>(), n: 0, sample: el.sample };
    seen.n += 1;
    seen.pages.add(el.page);
    failing.set(k, seen);
  }

  assert.deepEqual(
    [...failing].map(([k, v]) => `${k} at ${v.ratio}:1 - ${v.n} el on ${v.pages.size} pg, eg "${v.sample}"`),
    [],
    "a colour on this site does not meet WCAG AA against the ground it renders on. If it is a call site using" +
      " the wrong token for its ground, fix the call site - that is the `37512ae` judgement and it is ours." +
      " If it is what a token is worth, it belongs in blocked.md beside item 9 with its measured ratio",
  );
});

test("the exemptions cannot outlive the answer that closes them", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const live = new Set(census().map((e) => key(e.colour, e.ground)));

  for (const e of BLOCKED_ON_DANNY) {
    assert.equal(
      round(contrast(e.colour, e.ground)),
      e.ratio,
      `${key(e.colour, e.ground)} no longer measures ${e.ratio}:1, so the token value has moved and this` +
        ` exemption is describing a site that no longer exists: ${e.why}`,
    );
    assert.ok(
      live.has(key(e.colour, e.ground)),
      `${key(e.colour, e.ground)} is exempted here and no longer appears on any page - delete the exemption` +
        ` and close the blocked.md entry rather than leaving a sweep switched off for nothing: ${e.why}`,
    );
  }
});

/**
 * The colours the stylesheet sets, which the walk above cannot resolve.
 *
 * Six rules, and they are the whole of this sweep's blind spot, so they are
 * named with what each resolves to and why it is or is not a contrast
 * question. A seventh arriving fails this test, which is the point: the honest
 * way to state a limit is to derive it from the bytes and fail when it grows.
 */
/** Every stylesheet in the build, or null when there is no build to read. */
function stylesheet(): string | null {
  const staticDir = join(BUILD_DIR, "static");
  if (!existsSync(staticDir)) return null;
  const sheets: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) sheets.push(readFileSync(full, "utf8"));
    }
  };
  walk(staticDir);
  assert.ok(sheets.length > 0, "no stylesheet in the build, so the rules below read nothing");
  /**
   * 17 Oct 2026: the dashboards host's sheet (app/dashboards/dash.css) is left to
   * app/dashboards/dash-css.test.mts, which measures every text colour in it on
   * every ground it can land on rather than recording each rule here. Exactly one
   * sheet is set aside, by a selector only that sheet has, so this cannot quietly
   * drop the site's own.
   */
  const dash = sheets.filter((css) => css.includes(".dash-side{"));
  assert.ok(dash.length <= 1, `expected at most one dashboards stylesheet, found ${dash.length}`);
  return sheets.filter((css) => !dash.includes(css)).join("\n");
}

const CSS_COLOURS: Record<string, string> = {
  body: "var(--ink) on var(--bg) - 17.50:1, and it is the default every inline colour overrides",
  ".btn-primary":
    "#ffffff on a purple gradient, which has no single ground. Measured by the test below: blocked.md 31",
  ".tier-name__accent": "var(--brand-purple) #7c3aed - 5.28 on the page ground, 5.70 on white, 5.09 on the wash",
  ".on-dark .tier-name__accent": "#a78bfa, which is the dark-ground spelling of the same mark - 6.94 on ink",
  ".faq-row[open] .faq-summary span:first-child": "var(--accent) #7c3aed, the same value as the tier accent",
  ".q-remove:hover,.q-remove:focus-visible":
    "var(--bad-fg) #b3372f, T.badFg - 5.99:1 on the question card's white surface. Hover and keyboard focus on the confirm screen's Remove only (R34, 27 Sep 2026)",
  ".tier-quiet .tier-name,.tier-quiet .tier-name__accent":
    "var(--soft), so it is the token blocked.md 9 moved and clears AA on every ground the site draws since it was answered",
  ".proc-schema":
    "var(--soft) on var(--bg) - 4.80:1, which clears AA for body text since blocked.md 9 was answered. It is a code sample in a product panel, and it is illustrative schema rather than anything a reader has to act on",
  ".ans-nav":
    "var(--ink) on var(--surface) - 18.66:1. The drawer's paging controls, which render only behind a completed scan and so are on no swept page",
  // .run-mail-btn left this set on 2 Oct 2026: the Email me button went purple
  // (Danny) and takes its white text and ground from .btn-primary, measured above.
  ".wt-option":
    "var(--soft) on the .wt-toggle track, var(--chip) - 4.72:1. The unchosen half of the walkthrough switch, ScanResult.dc.html (Q10, 25 Sep 2026); the result is on no swept page",
  ".wt-option--on": "var(--ink) on var(--surface) - 18.66:1. The chosen half of the same switch",
  // DS17, 2 Oct 2026: Fig.tsx's one-line basis under a dashboard figure.
  ".app-fig:after":
    "var(--surface) on its own var(--ink) ground - 18.66:1. A figure's basis line, shown on hover and focus only, on /app (no swept page)",
};

/**
 * The grounds the stylesheet sets, which is the sharper half of the same
 * blind spot and was missing from this file until the question was asked of
 * it - the refill rule, one push after writing the rule above.
 *
 * A class that sets a colour makes this sweep quieter by one element. **A
 * class that sets a background makes it wrong about every element under it**,
 * and in one direction silently: a light ground arriving from a stylesheet,
 * under text the walk still believes is on ink, reads as a comfortable pass.
 * Four rules set one and none of them is that, which is why the sweep above
 * is sound - but that is a fact about today's stylesheet, so it is asserted
 * rather than assumed.
 */
const CSS_GROUNDS: Record<string, string> = {
  body: "var(--bg), and it is the ground this whole sweep starts its stack from - checked against the token below",
  ".btn-primary": "the CTA gradient, measured below rather than resolved to one ground: blocked.md 31",
  "button,input,select,optgroup,textarea": "#0000 - the browser reset making a control transparent, not a ground",
  "::file-selector-button": "#0000, the same reset, on an element this site never renders",

  // The answers drawer, the result's question rows and the walkthrough toggle.
  // All of them render only behind a completed scan, which is a route no page
  // sweep reaches - so the inline-style walk has nothing to judge them against
  // and these reasons are the record instead.
  ".ans-backdrop": "var(--ink) at 0.28 opacity, over the page. A scrim, and nothing is drawn on it - the drawer sits above it on its own ground",
  ".ans-drawer": "var(--surface), so text inside it lands on white and the surface tokens are the right ones for it",
  ".ans-drawer__head": "var(--surface), the same ground as the drawer it is stuck to the top of",
  ".ans-nav": "var(--surface), a control on the drawer's own ground",
  // .run-mail-btn left this set on 2 Oct 2026: its ground is now .btn-primary's gradient.
  ".res-qbtn": "transparent - it takes the ground of the row it wraps, which is what the inline walk already measures",
  ".res-qbtn:hover:not(:disabled)": "var(--bg) on hover only. A hover state is not a resting ground, and the text on it is the row's own",
  // 28 Sep 2026 (R63): the topbar dropdown's item highlight. #0f1115 ink on
  // #f4f0fe wash is well over 4.5:1, and the card under it is T.surface.
  ".nav-dd-link:hover,.nav-dd-link:focus-visible": "var(--wash) on hover/focus only, under the item's own T.ink text; the resting ground is the white card",
  // 1 Oct 2026 (R151): AppLink.tsx's loading bar.
  // DS17, 2 Oct 2026: Fig.tsx's basis line, drawn above the figure with its own white text on it.
  ".app-fig:after": "var(--ink), the basis line's own ground on hover and focus only; its var(--surface) text is the only thing on it",
  ".app-pending": "var(--brand-purple), a 3px fixed bar along the top of the window while a dashboard navigation is pending; aria-hidden and empty, so nothing is drawn on it",
  // 8 Oct 2026 (audit mobile-3): the one-cluster day strip's sticky columns.
  ".app-strip-lab,.app-strip-n":
    "var(--surface), the one-cluster day strip's sticky engine-mark and 'N of 28' columns, painted so no square shows round them as the days scroll under; the text on them is ink on the same white as the card",
  ".proc-schema": "var(--bg), the page ground, inside the white product panel on the cited tier - a code block, and the only place on the site that sets one",
  // 25 Sep 2026 (Q10): ScanResult.dc.html's switch - a chip track with the
  // chosen half raised in white. Was a surface card per option, wash when on.
  ".wt-toggle": "var(--chip), the grey track of the walkthrough switch; the unchosen label on it is soft",
  ".wt-option": "transparent - it takes the .wt-toggle track it sits in",
  ".wt-option--on": "var(--surface), the chosen half of the same switch, raised in white with ink text",
  // 26 Sep 2026 (R18): the /what-is-aeo beat, WhatIsAeo.dc.html. The reader
  // sees the keyframe block because the minifier puts its background after
  // the colour; hlSeo's comes first and so is not matched, and says the same.
  "@keyframes hlAeo":
    "transparent, the start of a one-pass highlight on the word Tallyroo, which then sits on the grey AI Overview panel (T.bg) it is drawn in - ink on #f6f6f7, 17.5:1 - until it settles on its inline T.washLine ground",
};

test("the stylesheet's own grounds are the recorded set, and the page ground is the token", (t) => {
  const css = stylesheet();
  if (css === null) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const setsGround = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, , body]) => /(?:^|;)\s*background(?:-color)?\s*:/.test(body!))
    .map(([, selector]) => selector!.trim());

  assert.deepEqual(
    [...new Set(setsGround)].sort(),
    Object.keys(CSS_GROUNDS).sort(),
    "a stylesheet rule sets a background, and this file's walk reads inline styles only - so every element" +
      " under that rule is being judged against the wrong ground. Work out what it lands on, then record it" +
      " in CSS_GROUNDS with the reason",
  );

  // What the sweep starts every stack from. Typed as `T.bg` there and written
  // into the stylesheet as `--bg` here, so a drift between the two would move
  // every ground on the site while this file went on reporting the old one.
  assert.match(
    css,
    new RegExp(`--bg:\\s*${PAGE_GROUND}\\b`, "i"),
    `the stylesheet's --bg is no longer ${PAGE_GROUND}, so the ground this sweep assumes for unbacked text is wrong`,
  );
});

test("the stylesheet's own colours are the recorded set, and the CTA gradient is what blocked 31 measured", (t) => {
  const css = stylesheet();
  if (css === null) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const setsColour = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    // `color:inherit` sets no colour, it declines to. The four rules using it
    // are the browser reset, and they are not a contrast question.
    .filter(([, , body]) => /(?:^|;)\s*color\s*:/.test(body!) && !/(?:^|;)\s*color\s*:\s*inherit/.test(body!))
    .map(([, selector]) => selector!.trim());

  assert.deepEqual(
    [...new Set(setsColour)].sort(),
    Object.keys(CSS_COLOURS).sort(),
    "a stylesheet rule sets a colour that the inline-style sweep in this file cannot see. It is not a failure -" +
      " it is the thing to look at: work out what ground it lands on, then record it in CSS_COLOURS with the" +
      " reason, the way the others above are",
  );

  /**
   * The gradient, which is the one place the answer is worse than the inline
   * sweep can reach. White clears 4.5:1 over the first two thirds of the run
   * and falls to 3.96 at the far stop, on a label that is 16px/600 - not large
   * text, so 4.5 is the bar it is held to. Pinned so blocked.md 31 cannot
   * outlive its answer: darken the far stop and this fails, and closing the
   * entry means updating both together.
   */
  const gradient = /\.btn-primary\{[^}]*linear-gradient\(135deg,\s*(#[0-9a-f]{6})\s*0%,\s*(#[0-9a-f]{6})\s*100%\)/i.exec(css);
  assert.ok(gradient, "the primary CTA is no longer a two-stop 135deg gradient - re-measure it for blocked.md 31");
  assert.equal(round(contrast("#ffffff", gradient![1]!)), 5.7, "the near stop of the CTA gradient has moved");
  assert.equal(
    round(contrast("#ffffff", gradient![2]!)),
    3.96,
    "the far stop of the CTA gradient has moved - if it now clears 4.5:1, blocked.md 31 is answered and this" +
      " assertion should be the floor rather than the reading",
  );
});
