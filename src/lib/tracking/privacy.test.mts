/**
 * The tracked-client privacy census (R94, 29 Sep 2026; danny.md lines 89-90).
 *
 * No tracked client, question, prompt, keyword, answer or figure may be
 * written into src, supabase, e2e, fixtures, commit messages or tracked docs.
 * Live pilot checks and parity of /app use the fixture only and save nothing
 * to the repo. This file holds the part a test can hold: the dashboard's code,
 * its fixture and its specs name only made-up brands and domains.
 *
 * Scope is the tracking relationship only - src/app/app, src/components/app,
 * src/lib/tracking and e2e. The public case studies are outside it (R100).
 * This test names no real client, and must not: the probe below is built at
 * run time so that no real domain is written here either.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { REVIEW_SITES } from "../scan/source-kinds.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
/**
 * `src/lib/diy` since 13 Oct 2026 (DIY P1, spec 10 section 6.10 item 3): the
 * DIY platform's code, fixtures and DataForSEO sample payloads name only the
 * fixture's made-up world, `.example` hosts, and the recorded hosts below.
 */
const DIRS = ["src/app/app", "src/components/app", "src/lib/tracking", "src/lib/diy", "e2e"];

/** The fixture's made-up world: boards-3/dataset.py's brands and the hosts it cites. */
const BRANDS = new Set(["Tallyroo", "Ledgerline", "Brightbook", "Countwise", "Sumly"]);
const DOMAINS = new Set([
  "tallyroo.com",
  "example.com",
  // Cited hosts the board's dataset invents (R93 note, 29 Sep 2026).
  "ledgerline.com",
  "thesmallbizstack.com",
  "softwarecritic.com",
  "freelancefieldnotes.com",
  "ownerledger.co",
  // The company's own domain, never a tracked client: the link check's polite
  // user agent carries it as its contact URL (R96, 30 Sep 2026).
  "alwayscited.com",
  // The dashboard's own host (M1, 6 Oct 2026). Same domain one label along,
  // and the same reason: it is where the dashboard is served from, never a
  // client of it. Named in session.ts's comment on the __Host- cookie and in
  // the two specs that exercise the host comparison.
  "app.alwayscited.com",
  // Stripe's hosted invoice host (BL-2, 9 Oct 2026): a vendor's, never a
  // client's. The past-due fixture state carries a made-up invoice URL on it
  // (fixture-mode.ts), because the banner keeps a payment link only when it is
  // a Stripe invoice page (checkout/payment.ts hostedInvoiceUrl).
  "invoice.stripe.com",
  // 13 Oct 2026, walkthrough review: the consumer mail host site.spec.mts (11)
  // types as the personal address the walkthrough form must refuse. A mail
  // provider's, never a client's, and the one WORK_EMAIL_REFUSAL itself names.
  "gmail.com",
  // 13 Oct 2026, DIY P1 (spec 10 section 6.10 item 3): the hosts the DIY
  // platform's rules and evidence register name, none of them a client's.
  // The engines' own hosts, which crawler and answer rules name:
  "google.com",
  "bing.com",
  "openai.com",
  "chatgpt.com",
  "perplexity.ai",
  "anthropic.com",
  // The documentation hosts the evidence register cites:
  "developers.google.com",
  "search.google.com",
  "schema.org",
  // The social and community hosts the rules name (a footer's sameAs links, the threads lens):
  "linkedin.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "quora.com",
  "stackexchange.com",
  "wikipedia.org",
  // And the review platforms, read from the one list the scan already keeps (source-kinds.ts REVIEW_SITES).
  ...Object.keys(REVIEW_SITES),
]);
/**
 * Walked files, this one excluded. 29 Sep 2026: 25. 13 Oct 2026, DIY P1: 71 -
 * src/lib/diy joined the walk with 46 files (its modules, tests, fake, fixture
 * and eight sample payloads; 230 walked in all), and the floor rises by them.
 */
const FLOOR = 71;

const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|co\.uk|org\.uk|co|io|net|org|ai|uk|us|de|fr|au|ca|nz|ie|xyz|shop|store)\b/gi;

/** Every host literal in `text` that is not in the made-up set, `www.` stripped. */
export function foreignDomains(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(HOST)) {
    const host = m[0].toLowerCase().replace(/^www\./, "");
    if (!DOMAINS.has(host)) out.add(host);
  }
  return [...out];
}

function walk(dir: string): string[] {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [dir];
  return readdirSync(dir).flatMap((f) => walk(join(dir, f)));
}

const files = DIRS.flatMap((d) => walk(join(ROOT, d)))
  .filter((f) => /\.(tsx?|mts|json)$/.test(f))
  .filter((f) => f !== fileURLToPath(import.meta.url));

test("the dashboard's code, fixture and specs name no domain outside the made-up set", () => {
  assert.ok(files.length >= FLOOR, `walked ${files.length} files, floor ${FLOOR} - the walk has stopped matching`);
  const found = files.flatMap((f) => foreignDomains(readFileSync(f, "utf8")).map((d) => `${relative(ROOT, f)}: ${d}`));
  assert.deepEqual(found, [], "a domain literal outside the fixture's made-up world");
});

test("the fixture's brands and client are the made-up five", () => {
  const fx = JSON.parse(readFileSync(join(ROOT, "src/lib/tracking/fixture.json"), "utf8"));
  const brands = new Set<string>([fx.client.brand]);
  for (const a of fx.data.answers as [string, string, string, number, string[], string[]][]) for (const b of a[4]) brands.add(b);
  assert.deepEqual([...brands].filter((b) => !BRANDS.has(b)), []);
  assert.ok(DOMAINS.has(fx.client.domain), fx.client.domain);
  assert.ok(brands.size >= 5, `only ${brands.size} brands read - the fixture shape has moved`);
});

test("the census fires on a real domain pasted into a copy of the fixture", () => {
  const fixture = readFileSync(join(ROOT, "src/lib/tracking/fixture.json"), "utf8");
  assert.deepEqual(foreignDomains(fixture), []);
  const probe = ["shop", "ify"].join("") + "." + "com";
  const scratch = fixture.replace("tallyroo.com", `www.${probe}`);
  assert.deepEqual(foreignDomains(scratch), [probe]);
});
