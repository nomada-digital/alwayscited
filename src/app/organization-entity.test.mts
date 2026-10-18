import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sweptPages } from "./dynamic-render.mts";
import { BRAND, LOGO_URL, ORG_ID, SITE_URL } from "../config/schema.ts";

/**
 * What the entity says about itself, which is a different question from
 * whether it resolves.
 *
 * `structured-data.test.mts` reads the same blocks and asks four things of
 * them: do they parse, does every `@id` resolve, does every FAQ answer match
 * the page, is every own-domain URL a real route. All four are questions about
 * *what is there*. Not one of them can notice a property that is absent, and
 * the whole reason this site declares an Organization at all is to be the
 * entity an answer engine resolves a brand against - which is a question about
 * what the node *contains*.
 *
 * That gap had a live instance, found on 20 Sep 2026. `config/schema.ts`
 * listed `logo` under "deliberately absent" with the reason "There is no logo
 * file. The wordmark is drawn in markup by `BrandMark`, and the Open Graph
 * card is a share image rather than a logo." The second sentence is true and
 * the first is false: `src/app/icon.svg` is the brand mark as a square SVG,
 * Next serves it at `/icon.svg`, every built head links it, and
 * `structured-data.test.mts` names that very file in its own comment while
 * listing "every image on this site". Two files in one tree, one saying the
 * logo file does not exist and one naming it. Read from production the same
 * day: `/icon.svg` 200, 597 bytes; `/favicon.ico` 200, 19,515 - the bytes on
 * disk in both cases.
 *
 * Same species as the date formatter and the honeypot, arriving from a new
 * direction: there it was two copies of a function and the untested one was
 * wrong, here it is two statements about the tree and the untested one was
 * wrong. **A stated reason for an absence is a claim about the tree, and this
 * repo checks claims.** So the absences that remain carry a `holds` that
 * re-earns them, in the shape `spend-gates.test.mts` established, rather than
 * a sentence nothing executes.
 *
 * What this cannot see, plainly: whether any engine reads the logo, renders it
 * or ignores it. That is a statement about a vendor, vendor docs are
 * unreachable from this session, and nothing here claims one.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const NEEDS_BUILD = "no build to read - run `npm run build` then `npm run capture`";

/** `_global-error` renders outside the root layout, so it carries no siteGraph. */
const NO_LAYOUT = "_global-error.html";

// ----------------------------------------------------------------- probes

/**
 * Every JSON-LD block on a page.
 *
 * Deliberately a local copy rather than an import from
 * `structured-data.test.mts`: importing one test file from another registers
 * its tests a second time, and the count in a harness is the only column that
 * tells a real pass from a duplicated one. The same reasoning it carries
 * applies here - the flight payload holds these scripts as
 * `["$","script",null,{...}]` tuples, so the literal opening tag cannot match
 * inside it and the blocks are not double-counted.
 */
function ldBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

type Node = Record<string, unknown>;

/** Every node in every graph on the page, flattened. */
function nodesOf(html: string): Node[] {
  const out: Node[] = [];
  for (const raw of ldBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // `structured-data.test.mts` owns the parse failure
    }
    const graph = (parsed as { "@graph"?: unknown })?.["@graph"];
    for (const node of Array.isArray(graph) ? graph : [parsed]) {
      if (node && typeof node === "object") out.push(node as Node);
    }
  }
  return out;
}

/** The one Organization the site is supposed to have, off a built page. */
function orgNode(html: string): Node | undefined {
  return nodesOf(html).find((n) => n["@type"] === "Organization" && n["@id"] === ORG_ID);
}

/**
 * The icon URLs a head publishes, absolute and without the cache-busting hash.
 *
 * Next's file convention appends `?icon.<hash>.svg` to the href. The hash is
 * not part of the route - `app-path-routes-manifest.json` lists `/icon.svg`
 * and `/favicon.ico` - so it is stripped before comparing, and both bare paths
 * were fetched from production on 20 Sep 2026 to confirm the route answers
 * without it.
 */
function headIcons(html: string): string[] {
  const head = /<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? "";
  return [...head.matchAll(/<link rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1]!.split("?")[0]!)
    .map((p) => (p.startsWith("http") ? p : SITE_URL + p));
}

/**
 * Both probes fired at a defect before any of them is believed on real pages.
 *
 * A clean list is what a probe that stopped matching returns, and this file
 * has two string-shaped probes that a markup change could silently break. The
 * green cases are the load-bearing half: a page whose head is fine must not
 * read as a finding, or the rule below would be passing on noise.
 */
test("the probes fire on an injected defect, and not on the shapes that are fine", () => {
  const head = (inner: string) => `<html><head>${inner}</head><body></body></html>`;

  assert.deepEqual(
    headIcons(head(`<link rel="icon" href="/icon.svg?icon.abc123.svg" sizes="any" type="image/svg+xml"/>`)),
    [SITE_URL + "/icon.svg"],
    "the icon probe no longer strips the cache-busting hash off a file-convention href",
  );
  assert.deepEqual(
    headIcons(head(`<link rel="shortcut icon" href="/favicon.ico"/><link rel="apple-touch-icon" href="/x.png"/>`)),
    [SITE_URL + "/favicon.ico", SITE_URL + "/x.png"],
    "the icon probe misses a rel the head is allowed to use",
  );
  assert.deepEqual(headIcons(head(`<link rel="preload" href="/f.woff2"/>`)), [], "the icon probe matches a non-icon link");

  const graph = (node: unknown) =>
    `<script type="application/ld+json">${JSON.stringify({ "@graph": [node] }).replace(/</g, "\\u003c")}</script>`;

  assert.ok(
    orgNode(graph({ "@type": "Organization", "@id": ORG_ID, name: BRAND })),
    "the org probe cannot find an Organization carrying the site's own @id",
  );
  assert.equal(
    orgNode(graph({ "@type": "Organization", name: BRAND })),
    undefined,
    "the org probe accepts an anonymous Organization as the site entity",
  );
});

// ------------------------------------------------------------- what it says

/**
 * The entity declares a logo, and it is an image the site actually publishes.
 *
 * Read off the built heads at both ends rather than from `config/schema.ts`,
 * because comparing the config to itself is the blind-tripwire recipe this
 * repo has paid for five times. What is joined here is the graph a crawler
 * parses against the `<link rel="icon">` set in the same head - two
 * independent statements in the shipped bytes about what this company's mark
 * is. A `logo` pointing at the OG card, at a deleted route, or at nothing at
 * all fails, and so does an icon set that stops containing the logo.
 */
test("the organisation declares a logo the head also publishes", (t) => {
  const pages = sweptPages();
  if (!pages.length) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const bad: string[] = [];
  let checked = 0;

  for (const { page, html } of pages) {
    if (page === NO_LAYOUT) continue;
    const org = orgNode(html);
    if (!org) {
      bad.push(`${page}: no Organization node carrying ${ORG_ID}`);
      continue;
    }
    checked++;

    const logo = org["logo"];
    if (typeof logo !== "string" || !logo) {
      bad.push(`${page}: the Organization declares no logo`);
      continue;
    }
    if (logo !== LOGO_URL) bad.push(`${page}: logo is ${JSON.stringify(logo)}, config/schema.ts says ${LOGO_URL}`);

    const icons = headIcons(html);
    if (!icons.includes(logo)) {
      bad.push(`${page}: logo ${logo} is not one of the icons this head links (${icons.join(", ") || "none"})`);
    }
  }

  assert.ok(checked > 15, `only ${checked} of ${pages.length} swept pages carry the site graph - the sweep has narrowed`);
  t.diagnostic(`${checked} pages carry the organisation, logo ${LOGO_URL}`);
  assert.deepEqual(bad, [], bad.join("\n"));
});

/**
 * One organisation, and it is never anonymous.
 *
 * This is the defect `config/schema.ts` was written to end - eight pages each
 * declaring their own unnamed `Organization` called "alwayscited", which to a
 * parser is eight unrelated companies sharing a name. The fix was one node
 * with an `@id` and references everywhere else, and **nothing has ever checked
 * that it stayed that way.** `structured-data.test.mts` asks that every `@id`
 * a page points at is defined on that page, which a fresh anonymous node
 * satisfies trivially by pointing at nothing.
 *
 * `parentOrganization` is legitimately anonymous - Nomada Digital is a
 * different company and has no node here - so the rule is keyed on the name
 * rather than on the type: any Organization calling itself the brand must be
 * the one node.
 */
test("no page reintroduces an anonymous organisation under the brand name", (t) => {
  const pages = sweptPages();
  if (!pages.length) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const bad: string[] = [];
  for (const { page, html } of pages) {
    for (const node of nodesOf(html)) {
      if (node["@type"] !== "Organization" || node["name"] !== BRAND) continue;
      if (node["@id"] !== ORG_ID) {
        bad.push(`${page}: an Organization named ${BRAND} carries @id ${JSON.stringify(node["@id"] ?? null)}`);
      }
    }
  }

  assert.deepEqual(bad, [], bad.join("\n"));
});

// --------------------------------------------------- the absences, re-earned

/**
 * Every property the entity deliberately does not declare, with the reason
 * that justifies the omission and a check that the reason is still true.
 *
 * An absence with a prose reason is an exemption by another name, and this
 * repo has now been bitten three times by an exemption whose sentence had
 * quietly stopped being true - `cc-coverage` naming a check nothing held,
 * `PRICE_EXEMPT` keyed by file, `ENGINE_EXEMPT` checking filenames and not
 * reasons. `logo` was the fourth and the worst, because its reason was
 * checkable from the first day and nobody checked it.
 *
 * So each row costs a `holds`. A row whose reason cannot be executed does not
 * belong here - it belongs in blocked.md, where `foundingDate`, `address` and
 * the two Article dates already are, because "we do not hold this fact" is a
 * statement about Danny's filing cabinet and not about this tree.
 */
const ABSENT: { property: string; why: string; holds: (pages: { page: string; html: string }[]) => string[] }[] = [
  {
    property: "sameAs",
    why: "no profile URL for this company is published anywhere on the site, so there is nothing to declare that would not be a guess",
    /**
     * Read from the rendered pages rather than from source on purpose. The
     * source tables in `lib/scan/source-kinds.ts` list `linkedin.com` and
     * `twitter.com` as *other people's* domains for the classifier, and a
     * source grep reports those as profile URLs - the `dataLayer`-over-
     * comments false positive in a new costume. What matters is whether this
     * site links a profile of its own, which only the built pages can say.
     */
    holds: (pages) => {
      const PROFILE =
        /https?:\/\/(?:[a-z0-9-]+\.)*(?:linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|crunchbase\.com)\/[^"'\s<>]+/gi;
      const found: string[] = [];
      for (const { page, html } of pages) {
        const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
        for (const m of body.matchAll(PROFILE)) found.push(`${page}: ${m[0]}`);
      }
      return found;
    },
  },
];

test("every property the entity omits still has a reason that is true", (t) => {
  const pages = sweptPages();
  if (!pages.length) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const sample = pages.find(({ page }) => page !== NO_LAYOUT);
  const org = orgNode(sample!.html) ?? {};

  const bad: string[] = [];
  for (const { property, why, holds } of ABSENT) {
    if (property in org) {
      bad.push(`${property} is declared now - move it out of ABSENT and give it a rule, its reason was ${JSON.stringify(why)}`);
      continue;
    }
    const broke = holds(pages);
    if (broke.length) {
      bad.push(
        `${property} is omitted because ${why} - and that is no longer true:\n` +
          broke.slice(0, 8).map((s) => `    ${s}`).join("\n"),
      );
    }
  }

  t.diagnostic(`${ABSENT.length} declared absences, each re-earned against ${pages.length} pages`);
  assert.deepEqual(bad, [], bad.join("\n\n"));
});

/**
 * Asked of this file the moment it went green.
 *
 * Everything above compares the logo to `LOGO_URL` and to whatever the head
 * links, which makes the *set of icon files* the real denominator and leaves
 * it assumed. Next resolves the icon conventions per route segment exactly as
 * it does the share card: `src/app/blog/icon.svg` would be a second mark,
 * served on the writing index, linked in that page's head, and the rule above
 * would pass because the logo is still among that head's icons. A third file
 * is a decision about which mark is the company's - and this is where the
 * question gets asked rather than nowhere.
 *
 * `og-card.test.mts` derives its denominator the same way and for the same
 * reason. Its header calls the card "the one published surface that is not
 * text", which is wider than its walk; the icons are the rest of that set, and
 * they turn out to be read - `copy.test.mts` walks `.svg` for the brand
 * casing, `structured-data.test.mts` resolves the hrefs, and now this file
 * joins them to the entity. That is recorded here so the next run does not
 * re-take it as an open gap.
 */
test("the root icons are the only icons, so the denominator above is the whole set", () => {
  const found: string[] = [];
  (function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (/^(icon|apple-icon|favicon)\.[a-z0-9]+$/.test(entry.name)) found.push(prefix + entry.name);
    }
  })(join(ROOT, "src", "app"), "src/app/");

  assert.deepEqual(
    found.sort(),
    // 18 Oct 2026 (brief 2f): apple-icon.png is the same asterisk on white for iOS home screens, not a second
    // mark - LOGO_URL stays icon.svg, and config/schema.ts's logo decision stands.
    ["src/app/apple-icon.png", "src/app/favicon.ico", "src/app/icon.svg"],
    "an icon exists that nothing here reads - decide which mark is the company's logo and say so in config/schema.ts",
  );
});
