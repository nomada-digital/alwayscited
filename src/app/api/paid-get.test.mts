import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { apiRoutes, missingEntryPoints, spendingRoutes } from "./spenders.mts";

/**
 * A route that spends money must not answer GET.
 *
 * Asked by the 20 Sep design review, which had just seen `/scan` in a browser
 * for the first time and noticed that `robots.txt` closes `/scan/` but not
 * `/scan?domain=...` - robots matching is literal prefix, and after `/scan`
 * comes `?`, not `/`. GPTBot, Googlebot and Bingbot are all `Allow: /` on that
 * path. So: if a GET with a query string could start a pass, every crawler
 * that follows one spends a scan.
 *
 * It cannot, for three independent reasons, and this test freezes the one that
 * is cheapest to break by accident. `/scan` is a server component that passes
 * `domain` into a `useState` initial value; there is no `useEffect` anywhere in
 * `HeroSection`, `LiveScanChecker` or `RequestScanForm`, so nothing runs on
 * mount; and the fetch to `/api/scan/start` sits inside a submit handler
 * against a POST-only route. A crawler issues GETs and does not submit forms.
 *
 * The third is the one worth a tripwire, because a route gains a method in one
 * line and nothing else in the tree would notice.
 *
 * ## The denominator was derived off the wrong thing, and it moved out
 *
 * This file used to say: "The paid set is DERIVED, not typed here - a list of
 * paid routes in a test is the fixed-rung-against-a-growing-list species this
 * repo keeps finding. A route is paid if it calls `checkCeilings` or
 * `completeUnlock`." It was derived, and it was still wrong, which is the
 * sharper lesson: **those two names are the GUARDS, not the spend.** A route
 * bounded by something else entirely is a route that spends and calls
 * neither.
 *
 * Measured 20 September 2026: it saw **five of the eight** routes that can
 * cause a paid call. The three outside it were `scan/[token]/confirm`, which
 * runs the entire free pass and is bounded by a compare-and-swap;
 * `scan/[token]/questions`, bounded by a per-scan reservation; and
 * `scan/[token]/resend`, which bills Resend and was in no sweep's list at all.
 * All three are POST-only today, so nothing was served wrong - but the rule
 * this file states was being enforced on five eighths of its own subject, and
 * a `GET` added to the confirm route is precisely the crawler-spends-a-scan
 * scenario it exists for, passing green.
 *
 * `spend-gates.test.mts` had already censused the true set two files away, off
 * a denominator of its own that was blind somewhere else. Two copies of one
 * denominator, so the set now lives in `spenders.mts` and both import it.
 * That file's header carries the whole measurement; do not re-derive it here.
 */

const API = join(import.meta.dirname, ".");

/**
 * There is no longer a paid route that answers GET, and the rule below says so
 * with no exemption at all.
 *
 * There was one: `verify/[vtoken]`, the link in a verification email, which
 * cannot be anything but a GET. What made it safe was not the method - mail
 * scanners fetch links on delivery, so that URL genuinely was fetched by a
 * machine before its owner clicked it - but a compare-and-swap, an unguessable
 * token and a `robots.txt` that closes `/api/`.
 *
 * It went on 24 September 2026 with the email gate, along with
 * `scan/[token]/unlock` and `scan/[token]/resend`. The exemption went with it
 * rather than being left pointing at a route that no longer exists, which is
 * the shape of stale allowance this file's own header is about: an entry that
 * outlives its subject is an allowance the next GET inherits.
 *
 * So the expected set is empty. If a paid GET comes back it needs what the
 * verify link had, and it needs an entry here arguing for it again.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * Deliberately not `git ls-files`, which is what this walked before.
 *
 * `npm run check` runs before `git add`, so a route file that exists and is
 * not yet staged is invisible to that listing - and a brand new paid route is
 * exactly the thing most likely to be both unstaged and wrong. `apiRoutes`
 * walks the filesystem. This repo has the rule written down; this file was
 * breaking it.
 */
const routes = () => apiRoutes(ROOT);

/**
 * Strip comments, so a route that only *mentions* a spend door is not counted.
 *
 * Kept local rather than taken from `spenders.mts`, whose cut is not identical.
 * A stripper that differs in one case blinds the sweep that depended on that
 * case, and `methodsOf` and the compare-and-swap check below were both proved
 * against this one.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const methodsOf = (src: string) =>
  [...code(src).matchAll(/export\s+async\s+function\s+([A-Z]+)\s*\(/g)].map((m) => m[1]!);

test("every route that spends money refuses GET, except the email link", () => {
  const all = routes();

  // The sweep must be looking at something. A `git ls-files` that stopped
  // matching and a site with no API routes read identically.
  assert.ok(all.length > 10, `only ${all.length} API routes found - the file walk has drifted`);

  const paid = spendingRoutes(ROOT);

  // Counter-guard: if the entry points were renamed, `paid` empties and every
  // assertion below passes while checking nothing at all. The floor is 8 and
  // not 4 because the set is now the measured one - see `spenders.mts`.
  // Was 8 until 24 September 2026, when the email gate took three routes with
  // it - unlock, resend and the verify link. Lowered to what is actually there
  // rather than left as a floor nothing can meet, because a floor that always
  // fails is a floor nobody reads.
  // Raised 13 Oct 2026 (DIY P9, wave 2 merged): 21 - the measured set, which spend-gates.test.mts pins name by
  // name: the scan's five (start, confirm, questions, email-report, walkthrough), the coverage check's three, the
  // tier pages' walkthrough, app/login, the dashboard's ask, check, member and setup, the tracking pair (cron/track,
  // track/run), the DIY night three (diy/run and the two night crons), and wave 2's opportunity and pages doors.
  // Raised 13 Oct 2026 (DIY P10, wave 3): 22 - and Links' door, app/[client]/links (Check a link's paid fallback
  // through runOnDemand; reveal and Pursue read stored rows only). POST only, as every one of them.
  assert.ok(
    paid.length >= 22,
    `only ${paid.length} paid routes detected - the spend walk in spenders.mts has gone blind: ` +
      paid.map((r) => r.name).join(", "),
  );
  assert.deepEqual(
    missingEntryPoints(ROOT),
    [],
    "a paid entry point was renamed, so the set this rule runs over is short by however many " +
      "routes reached money through it",
  );

  const gettable = paid.filter((r) => methodsOf(r.src).includes("GET"));

  /**
   * 29 September 2026: `cron/track`, the daily tracking dispatch (T1). Vercel
   * Cron can only GET. What stands in for a POST is what stands in front of
   * the two crons beside it - a request without `Bearer <CRON_SECRET>` is a
   * 401 before anything is read, so a crawler following the link pays nothing
   * - and the unique (client, day) run row, so even an authorised repeat
   * dispatches nothing. Earned here against the route's own source.
   */
  /*
   * 13 Oct 2026, DIY P1 (spec 10 section 5.7): the two night crons that carry
   * the DIY dispatch, beside `cron/track` and gated the same way - a request
   * without `Bearer <CRON_SECRET>` is a 401 before anything is read. Behind
   * the secret, the dispatch queues no paid kind while diy_enabled is off and
   * every paid read is reserved in the DIY ledger first.
   */
  const SECRET_GATED_GET = ["cron/track", "cron/purge-responses", "cron/reap-stalled-scans"];
  for (const name of SECRET_GATED_GET) {
    const r = all.find((x) => x.name === name);
    assert.ok(r, `${name} is allowed a paid GET here and is not a route any more`);
    assert.match(
      code(r.src),
      /if \(!constantTimeEqual\(offered, `Bearer \$\{secret\}`\)\)/,
      `${name} answers GET and spends, and no longer refuses a request without CRON_SECRET`,
    );
  }

  assert.deepEqual(
    gettable.map((r) => r.name).filter((n) => !SECRET_GATED_GET.includes(n)),
    [],
    `These routes spend money and answer GET, so any crawler that follows a link to one pays for ` +
      `it:\n${gettable.map((r) => "  " + r.name).join("\n")}\n` +
      `A pass must start on a POST. If one genuinely has to be a GET, it needs what the deleted ` +
      `verify link had - an unguessable token and a compare-and-swap - and an entry above saying so.`,
  );
});

test("robots.txt closes /api/ to every agent it names", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "robots.ts"), "utf8");

  // Belt to the POST rule's braces. Even a paid GET should not be advertised.
  assert.match(src, /const CLOSED = \[[^\]]*"\/api\/"/, "robots.ts no longer disallows /api/");
});
