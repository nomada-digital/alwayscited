import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { WAITLIST_LIMITS } from "./contact.ts";

/**
 * Every `<form action="/scan" method="get">` on the site, and the one field
 * each of them posts.
 *
 * The cloud session measured three of these unbounded on 20 September 2026 by
 * loading `/`, `/seo-agencies` and `/pr-agencies` and reading the DOM. There
 * are **five**: the other two are on `/case-studies/vibe-retail` and inside
 * `PostShell`, which every blog post renders. Neither was in the measurement,
 * so neither was in the finding - the same denominator defect this queue keeps
 * naming, arrived at this time by walking pages instead of reading sources.
 *
 * A browser is the only thing that can confirm the bound is *served*; a source
 * census is the only thing that can confirm it is on *all of them*. This is the
 * second, and it is why the count is asserted rather than the pages.
 *
 * The bound is not a security control - the value goes into a URL the server
 * normalises and validates, and `23f8791` established a GET cannot start a
 * pass. It is a consistency rule, and a rule applied at three call sites out of
 * five is the thing this repo files as a defect.
 */

const SRC = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SOURCES = walk(SRC).filter((f) => /\.tsx$/.test(f));

/** Each `/scan` GET form's markup, from the opening tag to its `</form>`. */
function scanForms(): { file: string; markup: string }[] {
  const out: { file: string; markup: string }[] = [];
  for (const file of SOURCES) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/<form\s+action="\/scan"[^>]*>/g)) {
      const start = m.index;
      const end = text.indexOf("</form>", start);
      assert.notEqual(end, -1, `${file}: a /scan form with no closing tag`);
      out.push({ file: file.slice(SRC.length), markup: text.slice(start, end) });
    }
  }
  return out;
}

test("the census finds every /scan GET form, not the ones a page walk reached", () => {
  const forms = scanForms();
  // 5 -> 4 on 25 Sep 2026 (Q12): /pr-agencies lost its free-scan form card,
  // because PRAgencies.dc.html (25 Sep read) has none - the page's one door
  // is the coverage check, and the sitewide header keeps "Free scan".
  // Still 4 in source on 2 Oct 2026 (R181), counted differently: the three
  // page cards (/seo-agencies, /how-it-works, the case study) are now one
  // form, in ScanBox, beside HomeFaq, PostShell and DarkClosing. 1 Nov 2026: PostShell's aside form went;
  // every post's scan is BlogScanCta (in the body, early and at the end), so the count holds.
  assert.ok(
    forms.length >= 4,
    `only ${forms.length} /scan forms were found - there are four, so a shrinking count here means the probe has gone blind, not that a form was removed`,
  );
});

test("every /scan form's domain field is bounded, and bounded from the config", () => {
  const unbounded: string[] = [];
  for (const { file, markup } of scanForms()) {
    if (!markup.includes('name="domain"')) continue;
    if (!markup.includes("maxLength={WAITLIST_LIMITS.domain}")) unbounded.push(file);
  }
  assert.deepEqual(
    unbounded,
    [],
    "these post a domain to /scan with no maxLength, or with one typed rather than read from WAITLIST_LIMITS",
  );
});

test("every /scan form posts a domain at all", () => {
  for (const { file, markup } of scanForms()) {
    assert.ok(markup.includes('name="domain"'), `${file}: a /scan form that posts no domain`);
  }
});

/**
 * Asserted as a value so that a typed `253` somewhere cannot pass the check
 * above by coincidence, and so the bound itself is a deliberate number rather
 * than whatever was last edited. 253 is the maximum length of a DNS name.
 */
test("the domain bound is a real DNS limit", () => {
  assert.equal(WAITLIST_LIMITS.domain, 253);
});
