/**
 * Which routes in this tree can cause somebody to be billed.
 *
 * Not a test - `npm run check` globs `src/**\/*.test.mts`, so this is a helper
 * the way `src/app/dynamic-render.mts` and `src/lib/source-read.mts` are. It
 * exists because **two sweeps in this one directory were answering the same
 * question with two different denominators, and the smaller one did not know
 * it was smaller.**
 *
 * `spend-gates.test.mts` asks what stands in front of each spending door.
 * `paid-get.test.mts` asks whether a spending route answers GET - a real
 * question, because `robots.txt` closes `/scan/` and not `/scan?domain=...`,
 * so a GET that spends is every crawler on the internet spending a scan.
 * Different questions, one denominator, and it was written twice.
 *
 * ## What each copy could not see, measured 20 September 2026
 *
 * `paid-get` derived its set from the two *guard* names - a route was paid if
 * it called `checkCeilings` or `completeUnlock`. That is deriving off the
 * wrong thing: it names what stands in front of spend rather than what
 * spends, so **the three routes bounded by something else were invisible**.
 * One of them is `scan/[token]/confirm`, which runs the entire free pass -
 * every question against every engine - and is bounded by a compare-and-swap
 * instead of a ceiling. 5 of 8. Its own header called the set "DERIVED, not
 * typed here", and it was, off a premise that had quietly stopped being true.
 *
 * `spend-gates` typed its vendor list and called them "the two clients that
 * actually put a request on the wire to a vendor". There are three: **Resend
 * bills per message**, which is the premise `mail-doors.test.mts` is built on.
 * So `scan/[token]/resend` - under `src/app/api`, named `route.ts`, squarely
 * inside that walk, and existing only to put a second message on a vendor's
 * bill - was in neither of its lists. 7 of 8.
 *
 * Neither gap was reachable by editing either file's lists, which is the
 * argument for this one existing rather than for a third list.
 *
 * ## Nothing here is typed that can be walked
 *
 * `PAID` is a list of function names and every one is re-checked against the module
 * that exports it, so a rename fails loudly rather than emptying the set - the
 * failure mode a name-matching probe has by default. The mail senders are
 * walked for, not named. The routes are walked for, not named.
 *
 * ## The honest limit
 *
 * A route "spends" if its own source calls one of the paid entry points, or
 * imports a vendor client or a mail sender directly. That cannot see a paid
 * call reached through a module the route imports for another reason - which
 * is why the import-graph version of this was discarded: it reported `/full`
 * and `/opportunities` as spenders because something in their graph imports
 * `anthropic.ts`, when both only read rows that were already paid for. **An
 * import is not a call.** The named-entry-point list is narrower and true, and
 * the direct-import half is what stops a route routing around it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The functions that bill somebody, or queue work that will.
 *
 * Checked against their own modules by `paidEntryPoints`, below.
 */
export const PAID: Record<string, { module: string; what: string }> = {
  runScan: { module: "src/lib/scan/pipeline.ts", what: "every question against every engine" },
  readBrand: { module: "src/lib/scan/anthropic.ts", what: "one model call to name the brand" },
  // `completeUnlock` was here until 24 September 2026 and was the biggest
  // single spender on the list - it ran the gated pass. It went with the email
  // gate, along with the three routes that called it (scan unlock, scan resend
  // and the verify link). There is no gated pass to enter any more: the free
  // pass reads every engine and `GATED_ENGINES` is empty.
  startBenchmark: { module: "src/lib/coverage/campaign.ts", what: "a campaign and its first reading" },
  addReading: { module: "src/lib/coverage/campaign.ts", what: "a further reading of a campaign" },
  /**
   * Added 20 September 2026, by opening a door neither sweep could see.
   *
   * `/api/scan/[token]/email-report` mails a scan result. It reaches Resend one
   * hop away - through `report-mail.ts`, which imports `verify-email`, which
   * imports the client - so `mailSenders` did not list it, `importsModule`
   * could not match it, and a new route onto a vendor bill passed both sweeps
   * green.
   *
   * This is the registry's own answer to that, and it is why the registry
   * exists rather than an import graph: naming the entry point is narrow and
   * true where "imports something that imports Resend" is broad and wrong. It
   * is checked against its module by `paidEntryPoints`, so a rename fails
   * loudly instead of quietly emptying the set.
   */
  /**
   * 29 September 2026, T1 of the alwaystracked dashboard. The daily runner:
   * every live question on the tier's engines, every live keyword's SERP and
   * a brand extraction per engine, for one client. `dispatchTrackingRuns`
   * opens and hands off one of those per client, so it queues work that bills.
   */
  runTrackingDay: {
    module: "src/lib/tracking/runner.ts",
    what: "one client's daily tracking run - its questions on its engines, its keywords, a brand read per engine",
  },
  dispatchTrackingRuns: {
    module: "src/lib/tracking/runner.ts",
    what: "one tracking run per active client with a live question, handed to /api/track/run",
  },
  sendRequestedReport: {
    module: "src/lib/scan/report-mail.ts",
    what: "one report message per scan, to an address given while it was still running",
  },
  /** 30 September 2026, BRIEF-3 T6 part 3b: "Check keyword" in Add a cluster. */
  checkClusterKeyword: {
    module: "src/lib/tracking/check-keyword.ts",
    what: "two DataForSEO reads, volume and intent, for one keyword a member typed",
  },
  /**
   * 13 October 2026, DIY P1 (spec 10 sections 5.6 and 5.7): the DIY
   * platform's four doors onto spend. Every paid read under them is reserved
   * in the DIY ledger (`diy_reads`) before it goes out, behind `diy_enabled`,
   * global daily caps, per-door daily counts and per-client month budgets.
   */
  runDiyWorker: {
    module: "src/lib/diy/core/worker.ts",
    what: "one DIY night worker: claims due diy_jobs and runs their handlers, whose paid reads go through diyRead",
  },
  dispatchDiyWork: {
    module: "src/lib/diy/core/dispatch.ts",
    what: "a DIY night pass: the two free vendor reads, each client's due jobs queued, and two signed workers posted",
  },
  runOnDemand: {
    module: "src/lib/diy/core/runondemand.ts",
    what: "a member's DIY button - a page check, a drafted example, a verify, a logged site, a link check",
  },
  diyRead: {
    module: "src/lib/diy/core/doors.ts",
    what: "one capped DataForSEO read on the DIY ledger",
  },
};

/**
 * The two scan clients, named because each is one module and a rename of
 * either fails `paidEntryPoints`. The mail senders are derived instead - see
 * `mailSenders` - because that is precisely where the typed version was wrong.
 */
export const SCAN_VENDORS = ["@/lib/scan/anthropic", "@/lib/scan/dataforseo"];

/**
 * Strip comments before looking for a call.
 *
 * Every one of these routes discusses the others in prose - `start/route.ts`
 * names `runScan`, `completeUnlock` and `checkCeilings` in comments without
 * calling any of them - so a bare substring search reads almost every route as
 * a spender.
 *
 * Trailing comments are stripped as well as whole-line ones, and that was
 * found by an injection rather than by reading: a case that appended
 * `// checkCeilings(` to a line was reported CAUGHT, by the right test, for
 * entirely the wrong reason. A pass that means nothing looks exactly like a
 * pass that means something.
 *
 * The `[^:]` guard is so `https://` in a comment or a string does not take the
 * rest of its line with it.
 */
export function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every module under `src` that imports Resend, as the `@/` specifier a route
 * would import it by.
 *
 * Walked rather than named, and comments stripped first, for the reason
 * `mail-doors.test.mts` proves with an injected case: a commented-out
 * `from "resend"` line anywhere in `src` reads as a mail sender otherwise.
 */
export function mailSenders(root: string): string[] {
  const out: string[] = [];
  const src = join(root, "src");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
        if (/from "resend"/.test(code(readFileSync(p, "utf8")))) {
          out.push("@/" + relative(src, p).split(/[\\/]/).join("/").replace(/\.tsx?$/, ""));
        }
      }
    }
  };
  walk(src);
  return out.sort();
}

/** Every vendor that bills us, as the specifier a route imports it by. */
export function vendors(root: string): string[] {
  return [...SCAN_VENDORS, ...mailSenders(root)];
}

export type Route = { name: string; file: string; src: string };

/** Every `route.ts` under `src/app/api`, named the way a human names it. */
export function apiRoutes(root: string): Route[] {
  const api = join(root, "src", "app", "api");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === "route.ts") out.push(p);
    }
  };
  walk(api);
  return out.map((file) => ({
    name: relative(api, file).split(/[\\/]/).join("/").replace(/\/route\.ts$/, ""),
    file,
    src: readFileSync(file, "utf8"),
  }));
}

/**
 * A specifier for `@/lib/scan/anthropic` that also matches
 * `../../../../lib/scan/anthropic`, with or without an extension.
 *
 * Keyed on the last two path segments rather than the whole `@/` path, and
 * that is the fix for the second hole below rather than tidiness: a relative
 * import climbing out of `src/app` does not contain the leading segment at
 * all, so `app/contact/actions` never appears in `../../contact/actions`.
 * Two segments is specific enough that nothing else in this tree matches one.
 */
function importsModule(c: string, specifier: string): boolean {
  const tail = specifier.replace(/^@\//, "").split("/").slice(-2).join("/");
  const escaped = tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`from "[^"]*${escaped}(\\.tsx?)?"`).test(c);
}

/**
 * Does this route's own source reach a paid call?
 *
 * ## Two holes this had on the day it was written, both found by asking the
 * refill question of it before the push had finished deploying
 *
 * 1. **A route that imports Resend itself read as not spending**, which is the
 *    most direct way to spend there is. The specifier match could not see it
 *    by construction: `mailSenders` walks all of `src`, so such a route is
 *    listed under *its own* specifier, and a file's source never contains its
 *    own import path. The set would have grown by one and the answer would
 *    have stayed `false`. It is checked for the package directly now.
 * 2. **A relative import of a vendor was invisible.** Nothing in `src/app/api`
 *    imports relatively today - measured, not assumed - but this tree has a
 *    standing rule that two modules import relatively on purpose and must not
 *    be tidied back to `@/`, so the idiom is live here. `importsModule` keys
 *    on the last two path segments, which survive any number of `../`.
 *
 * Both were one line, both were invisible to every assertion over the set, and
 * both are the same error as the one this file was created for: the check was
 * right about the shape in front of whoever wrote it.
 */
export function spends(routeSrc: string, vendorList: string[]): boolean {
  const c = code(routeSrc);
  if (Object.keys(PAID).some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(c))) return true;
  // The vendor package itself, not a module that wraps it. See (1) above.
  if (/from "resend"/.test(c)) return true;
  return vendorList.some((v) => importsModule(c, v));
}

/** The set both sweeps are about, sorted by route name. */
export function spendingRoutes(root: string): Route[] {
  const vendorList = vendors(root);
  return apiRoutes(root)
    .filter((r) => spends(r.src, vendorList))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Each paid entry point checked against the module that exports it.
 *
 * Returns the ones that have gone missing, so a caller can assert on an empty
 * list and name what moved.
 */
export function missingEntryPoints(root: string): string[] {
  return Object.entries(PAID)
    .filter(([fn, { module }]) => {
      const src = readFileSync(join(root, module), "utf8");
      return !new RegExp(`export (async )?function ${fn}\\b`).test(src);
    })
    .map(([fn, { module }]) => `${module} no longer exports ${fn}`);
}
