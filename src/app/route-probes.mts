/**
 * The probes that read which routes are open and which are shut.
 *
 * Not a test, deliberately. Three suites need these - `route-closure`
 * (is a private route shut), `sitemap` (does a listed URL contradict
 * robots.txt) and `public-routes` (is a page meant to be found still findable)
 * - and **importing a test module registers its tests**, so the importer runs
 * the imported suite a second time under its own name.
 *
 * The answer that was reached for first was to re-state the parser in each
 * file, and `route-closure.test.mts` carried a comment saying so. That is the
 * duplication this repo keeps finding the hard way: `disallowedPaths` was
 * written twice, identically, with nothing reconciling the two, so a fix to
 * one would silently leave the other reading a different robots.txt. Same
 * shape as `SCAN_FROM_EMAIL` on four senders and one list.
 *
 * A plain `.mts` module is importable by every suite, runs nothing on import,
 * and has one definition. `dynamic-render.mts` is already this.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
export const APP = join(ROOT, "src", "app");

/**
 * Every page route whose own metadata declares it noindex.
 *
 * Source rather than rendered HTML, deliberately. The rendered set cannot
 * contain `/scan/[token]`, `/coverage-check/[token]` or `/admin/scans` - they
 * need a database or a credential this machine does not have - and those are
 * the three routes the whole check exists for.
 */
export function privateRoutes(dir = APP): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "page.tsx") {
        // `robots: { index: false, follow: false }` is how all four of them
        // spell it. Matched on the property rather than the word "noindex",
        // which also appears in prose comments on pages that are indexable.
        if (/robots:\s*\{[^}]*index:\s*false/.test(readFileSync(full, "utf8"))) {
          const rel = relative(dir, full).split(sep).slice(0, -1).join("/");
          out.push("/" + rel);
        }
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Every page route in the app, private and public alike. */
export function pageRoutes(dir = APP): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const rel = relative(dir, full).split(sep).slice(0, -1).join("/");
        out.push(rel ? "/" + rel : "/");
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** `/coverage-check/[token]` -> `/coverage-check/probe`. A path to match rules against. */
export function probePath(route: string): string {
  return route.replace(/\[[^\]]+\]/g, "probe");
}

/**
 * Every header rule in the build that sets `x-robots-tag: noindex`, with the
 * regex Next compiled for it.
 *
 * The compiled regex is used rather than a matcher written here, so the test
 * is reading the rule that ships. That distinction is not theoretical: the
 * comment in `next.config.ts` records `/scan/:path*` once matching bare
 * `/scan` when `:path+` was meant, and only the compiled form tells the two
 * apart.
 */
export function noindexHeaderRules(manifest: string): { source: string; regex: RegExp }[] {
  const parsed = JSON.parse(manifest) as {
    headers?: { source: string; regex: string; headers: { key: string; value: string }[]; has?: { type: string }[] }[];
  };
  return (parsed.headers ?? [])
    // 17 Oct 2026: a rule conditioned on another host (the dashboards host's, and APP_HOST's once it is set) never
    // answers on the marketing host, which is the only host these routes are probed on.
    .filter((rule) => !(rule.has ?? []).some((h) => h.type === "host"))
    .filter((rule) => rule.headers.some((h) => h.key.toLowerCase() === "x-robots-tag" && /noindex/.test(h.value)))
    .map((rule) => ({ source: rule.source, regex: new RegExp(rule.regex) }));
}

/** The paths robots.txt tells every agent not to fetch. */
export function disallowedPaths(robots: string): string[] {
  return [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
}
