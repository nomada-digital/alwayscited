import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The join between a `fetch` and the route that answers it, in both
 * directions. Nothing in this tree had ever read it.
 *
 * `paid-get.test.mts` proves no route that spends money answers GET. That is
 * one way down a two-way street: it is correct about every route it names and
 * says nothing about whether the routes that MUST answer a POST still do.
 * `cron-schedule.test.mts` is the same shape - it proves every cron route
 * refuses a wrong bearer, and nothing proves the right one is accepted. This
 * file takes the direction neither of them looks in.
 *
 * The gap is real and it is silent at every gate this repo has. A route path
 * is built by string concatenation at the call site - `"/api/scan/" + token +
 * "/unlock"` - so **no type connects a caller to the route it calls**. Rename
 * the directory, drop the `POST` export, change the method on one side only,
 * and `npx tsc --noEmit` passes, `npm run build` passes, every existing test
 * passes, and the deploy is green. What breaks is a 405 inside a submit
 * handler on a conversion path, visible to nobody but the visitor who clicked.
 *
 * Both directions are checked:
 *
 *   FORWARD - every internal `fetch` in the tree names a route that exists and
 *   exports the method it uses. This is the one that catches a dead button.
 *
 *   REVERSE - every route method that exists has a caller, or a written
 *   exemption with a reason. A route nobody calls is either dead code or a
 *   caller that was deleted; both are worth a sentence. The exemptions are
 *   re-earned below rather than trusted, and checked for staleness, so the
 *   list cannot rot into a blanket pass.
 *
 * What this cannot do, said out loud rather than left for somebody to discover:
 * a concatenated path collapses its dynamic segment to `*`, so
 * `"/api/scan/" + p.token` matches both `/api/scan/[token]` and
 * `/api/scan/start`. A call resolves if ANY route matching its shape exports
 * the method. That is weaker than naming one route, and it is the honest limit
 * of reading a template literal as source - it still catches a renamed
 * directory, a dropped export and a method changed on one side.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");

// ------------------------------------------------------------- the probes

export type Call = { file: string; path: string; method: string };
export type Route = { path: string; methods: string[] };

/**
 * The path a `fetch` argument resolves to, with every dynamic part as `*`.
 *
 * Written as a scanner rather than a regex because all three forms are in the
 * tree and a regex that takes one silently reads the others as no path at all
 * - which is the "probe returns zero and that looks exactly like the defect"
 * failure this repo has been bitten by. A template literal, a `+`
 * concatenation and a bare string all have to come out the same shape.
 */
export function normalisePath(arg: string): string {
  let out = "";
  let i = 0;
  while (i < arg.length) {
    const ch = arg[i]!;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < arg.length && arg[j] !== ch) {
        if (arg[j] === "\\") j++;
        out += arg[j];
        j++;
      }
      i = j + 1;
    } else if (ch === "`") {
      let j = i + 1;
      while (j < arg.length && arg[j] !== "`") {
        if (arg[j] === "$" && arg[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < arg.length && depth > 0) {
            if (arg[j] === "{") depth++;
            else if (arg[j] === "}") depth--;
            j++;
          }
          out += "*";
        } else {
          out += arg[j];
          j++;
        }
      }
      i = j + 1;
    } else if (ch === "+" || /\s/.test(ch)) {
      i++;
    } else {
      // An expression. Consume to the next top-level `+` so a call inside it
      // - `String(x + 1)` - does not split the segment in two.
      let depth = 0;
      let j = i;
      while (j < arg.length) {
        const c = arg[j]!;
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === "+" && depth === 0) break;
        j++;
      }
      out += "*";
      i = j;
    }
  }
  return out;
}

/** Every internal `fetch` in one file, with the method it sends. */
export function callsIn(file: string, src: string): Call[] {
  const out: Call[] = [];
  for (const m of src.matchAll(/fetch\(\s*/g)) {
    const start = m.index! + m[0].length;
    // Read the whole call, balanced, so the options object comes with it.
    let depth = 1;
    let j = start;
    while (j < src.length && depth > 0) {
      const c = src[j]!;
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if (depth === 0) break;
      j++;
    }
    const whole = src.slice(start, j);
    // Split the first argument off at the top-level comma.
    let d = 0;
    let k = 0;
    for (; k < whole.length; k++) {
      const c = whole[k]!;
      if ("([{".includes(c)) d++;
      else if (")]}".includes(c)) d--;
      else if (c === "," && d === 0) break;
    }
    const path = normalisePath(whole.slice(0, k));
    if (!path.startsWith("/api/")) continue;
    const method = whole.slice(k).match(/method:\s*["'`](\w+)["'`]/)?.[1] ?? "GET";
    out.push({ file, path, method: method.toUpperCase() });
  }
  return out;
}

/** Does a call path match a route pattern, treating `[x]` and `*` as any segment? */
export function matches(callPath: string, routePath: string): boolean {
  const a = callPath.split("/");
  const b = routePath.split("/");
  if (a.length !== b.length) return false;
  return a.every((seg, i) => {
    const r = b[i]!;
    if (r.startsWith("[") || seg === "*") return true;
    return seg === r;
  });
}

// ------------------------------------------------- reading the real tree

/**
 * The filesystem, not `git ls-files`.
 *
 * `paid-get.test.mts` walks the index and that is a smaller denominator than
 * it looks: `npm run check` runs at the push gate, BEFORE `git add`, so a
 * route.ts written this run is untracked and a git walk cannot see it. The
 * case this sweep exists for - a new route, or a caller pointed at one - is
 * exactly the case that is uncommitted at the moment it is measured.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

function routeTable(): Route[] {
  return walk("src/app/api")
    .filter((f) => f.endsWith("/route.ts"))
    .map((f) => ({
      path: f.replace(/^src\/app/, "").replace(/\/route\.ts$/, ""),
      methods: [...readFileSync(join(ROOT, f), "utf8").matchAll(/export\s+async\s+function\s+([A-Z]+)\s*\(/g)].map(
        (m) => m[1]!,
      ),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function allCalls(): Call[] {
  return walk("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.mts") && !f.endsWith(".mts"))
    .flatMap((f) => callsIn(f, readFileSync(join(ROOT, f), "utf8")));
}

/**
 * Route methods with no in-app caller, and why each is right.
 *
 * Every entry is re-earned by `earns`, against the file that actually does the
 * calling. An exemption asserted rather than earned is how a list like this
 * stops meaning anything.
 */
const NO_CALLER: { route: string; method: string; why: string; earns: () => boolean }[] = [
  // 18 Oct 2026 (brief 2e): #7's one-click unsubscribe. Its callers are mail clients and readers of the email.
  {
    route: "/api/dash/unsubscribe",
    method: "GET",
    why: "Opened from the Monday email's footer link, which the lifecycle emails build with unsubscribeLink; nothing in the app links to it.",
    earns: () => readFileSync(join(ROOT, "src/lib/email/unsubscribe.ts"), "utf8").includes("/api/dash/unsubscribe?t="),
  },
  {
    route: "/api/dash/unsubscribe",
    method: "POST",
    why: "Posted by a mail client's RFC 8058 one-click (the List-Unsubscribe-Post header), or by the plain form the GET page draws, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/app/api/dash/unsubscribe/route.ts"), "utf8").includes('<form method="post" action="/api/dash/unsubscribe?t='),
  },
  // 18 Oct 2026 (brief 2e): Settings' Monday-summary switch on the dashboards host, a plain form post.
  {
    route: "/api/dash/[client]/email",
    method: "POST",
    why: "Posted by the Email section's form on /dashboards/[client]/settings, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/app/dashboards/[client]/settings/page.tsx"), "utf8").includes("action={`/api/dash/${slug}/email`}"),
  },
  {
    route: "/api/cron/purge-responses",
    method: "GET",
    why: "Vercel Cron calls it on a schedule; nothing in the app does.",
    earns: () => declaredCron("/api/cron/purge-responses"),
  },
  {
    route: "/api/cron/reap-stalled-scans",
    method: "GET",
    why: "Vercel Cron calls it on a schedule; nothing in the app does.",
    earns: () => declaredCron("/api/cron/reap-stalled-scans"),
  },
  {
    route: "/api/cron/track",
    method: "GET",
    why: "Vercel Cron calls it on a schedule (the daily tracking check, 29 Sep 2026); nothing in the app does.",
    earns: () => declaredCron("/api/cron/track"),
  },
  // 19 Oct 2026: the 22 entries "Orphaned on 18 Oct 2026 (brief 2d)" - POST /api/app/auth and /logout, and under
  // /api/app/[client] stop, group, prompt, edit, note, report (GET), ask, hide, check, setup, cluster, keyword, trial,
  // event, plan, keywords, opportunity, prompt-offer, links and pages - left with their routes. Each was "kept until the
  // /api/app routes are retired as their own batch", and commit 78b1023 was that batch. An exemption whose route is
  // gone is one the next route of that name would inherit, so they go. orphanedByAppRetirement, which earned them, went
  // with them; /api/app/[client]/member below is the /api/app route left, earned by the dashboards host's Settings.
  {
    route: "/api/dash/auth",
    method: "POST",
    why: "Posted by the plain HTML form on the dashboards host's /auth (the login link's button, 17 Oct 2026), which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/app/dashboards/auth/page.tsx"), "utf8").includes('action="/api/dash/auth"'),
  },
  {
    route: "/api/dash/[client]/billing",
    method: "POST",
    why: "Posted by the plain HTML Open billing form on the dashboards host's Plan page (17 Oct 2026), which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/app/dashboards/[client]/plan/page.tsx"), "utf8").includes("<form action={`/api/dash/${slug}/billing`} method=\"post\">"),
  },
  {
    route: "/api/dash/[client]/pack",
    method: "POST",
    why: "Posted by the plain HTML form PackButton draws wherever an allowance runs out, and by Plan's Track more (17 Oct 2026); it answers with Stripe Checkout. The fetch scanner does not read forms.",
    earns: () =>
      readFileSync(join(ROOT, "src/components/dash/PackButton.tsx"), "utf8").includes("<form action={`/api/dash/${slug}/pack`} method=\"post\"") &&
      readFileSync(join(ROOT, "src/app/dashboards/[client]/plan/page.tsx"), "utf8").includes("<form action={`/api/dash/${slug}/pack`} method=\"post\">"),
  },
  {
    route: "/api/dash/logout",
    method: "POST",
    why: "Posted by the plain HTML Sign out form in the dashboards host's sidebar (17 Oct 2026), which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/dash/Shell.tsx"), "utf8").includes('action="/api/dash/logout"'),
  },
  {
    route: "/api/app/[client]/member",
    method: "POST",
    // R142 part 2, 1 Oct 2026 (BRIEF-4 P2 Team): invite, change a role, remove.
    why: "Posted by the plain HTML Invite someone and Remove forms on the dashboards host's Settings, which the fetch scanner does not read.",
    // DS40, 2 Oct 2026: the action now carries the page's stated range (`keep`), so the 303 lands back on it.
    // 18 Oct 2026, brief 2d: /app retired; the dashboards host's Settings draws the Invite and Remove forms now (fact moved).
    earns: () => readFileSync(join(ROOT, "src/app/dashboards/[client]/settings/page.tsx"), "utf8").includes("action={`/api/app/${slug}/member`}"),
  },
  {
    route: "/api/checkout",
    method: "POST",
    // R91, 29 Sep 2026. It opens a live Stripe Checkout - the one route
    // where a buyer's money moves - though Stripe bills nobody for the
    // Session itself.
    // The form moved into the CheckoutOrder island with the order summary
    // card, 1 Oct 2026 (danny.md lines 156-157); it is still a plain form post.
    why: "Posted by the plain HTML order form on /checkout (CheckoutOrder), which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/checkout/CheckoutOrder.tsx"), "utf8").includes('action="/api/checkout"'),
  },
  {
    route: "/api/stripe/webhook",
    method: "POST",
    // BRIEF-3 C4, 30 Sep 2026. Registered in Stripe's dashboard for three
    // events (R110); nothing on the site calls it.
    why: "Posted by Stripe to the endpoint registered in its dashboard, signed with STRIPE_WEBHOOK_SECRET.",
    earns: () => readFileSync(join(ROOT, "src/app/api/stripe/webhook/route.ts"), "utf8").includes("process.env.STRIPE_WEBHOOK_SECRET"),
  },
  {
    route: "/api/track/run",
    method: "POST",
    why:
      "Posted by the tracking dispatcher with an HMAC of the body, at an absolute URL built from the " +
      "cron request's origin, so the path scanner reads no literal call to it.",
    earns: () => readFileSync(join(ROOT, "src/lib/tracking/runner.ts"), "utf8").includes("/api/track/run`"),
  },
  {
    route: "/api/diy/run",
    method: "POST",
    // 13 Oct 2026, DIY P5 (P1's handoff, spec 10 section 7.2). P1's wording said the URL is built from the cron
    // request's origin; dispatch.ts posts to SITE_URL instead, and says why, so the reason says what the code does.
    why:
      "Posted by the DIY dispatcher with an HMAC of the body, at an absolute URL built from SITE_URL, " +
      "so the path scanner reads no literal call to it.",
    earns: () => readFileSync(join(ROOT, "src/lib/diy/core/dispatch.ts"), "utf8").includes("/api/diy/run`"),
  },
  {
    route: "/api/verify/[vtoken]",
    method: "GET",
    why: "It is the link in the verification email, followed by a person in a mail client.",
    earns: () =>
      readFileSync(join(ROOT, "src/lib/scan/verify-email.ts"), "utf8").includes("/api/verify/"),
  },
  /**
   * Orphaned on 24 September 2026, when the email gate came off the result and
   * its form went with it. Kept rather than deleted in the same push: eighteen
   * files reference them, and the verify flow they belong to is already off
   * (require_email_verification false). Deleting both, with the verify route,
   * is its own tidy batch. `earns` holds the reason - the moment anything in
   * the app calls them again, this entry is stale and says so.
   */
  {
    route: "/api/scan/[token]/unlock",
    method: "POST",
    why: "Orphaned by the gate removal on 24 Sep 2026; awaiting deletion with the verify flow.",
    earns: () => !readFileSync(join(ROOT, "src/components/scan/ScanFlow.tsx"), "utf8").includes("/unlock"),
  },
  {
    route: "/api/scan/[token]/resend",
    method: "POST",
    why: "Orphaned by the gate removal on 24 Sep 2026; it resent the verification mail the gate asked for.",
    earns: () => !readFileSync(join(ROOT, "src/components/scan/ScanFlow.tsx"), "utf8").includes("/resend"),
  },
  {
    route: "/api/health/runs",
    method: "GET",
    // 9 Oct 2026, audit reliability-6 and spec OP-1: whether today's runs were read.
    why:
      "Polled by an external uptime monitor, which alerts on its 503; /admin/tracking links to it " +
      "with a plain <a>, which the fetch scanner does not read.",
    earns: () =>
      readFileSync(join(ROOT, "src/app/admin/tracking/page.tsx"), "utf8").includes('href="/api/health/runs"') &&
      readFileSync(join(ROOT, "src/app/api/health/runs/route.ts"), "utf8").includes("healthAnswer("),
  },
  {
    route: "/api/version",
    method: "GET",
    why:
      "The deploy probe. Read from outside the app entirely - a run checking what production is " +
      "serving - so an in-app caller would be the surprising thing, not its absence.",
    earns: () => true,
  },
];

function declaredCron(path: string): boolean {
  const json = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
    crons?: { path: string }[];
  };
  return (json.crons ?? []).some((c) => c.path === path);
}

// -------------------------------------------------------------- the guards

test("the path scanner reads all three call forms the same way", () => {
  assert.equal(normalisePath('"/api/scan/start"'), "/api/scan/start");
  assert.equal(normalisePath("`/api/coverage-check/${token}/rerun`"), "/api/coverage-check/*/rerun");
  assert.equal(normalisePath('"/api/scan/" + p.token + "/questions"'), "/api/scan/*/questions");
  // A trailing expression is a segment, not nothing. Dropping it reads
  // `/api/scan/<token>` as a call to `/api/scan/`, which matches no route and
  // would be reported as a broken caller that is in fact fine.
  assert.equal(normalisePath('"/api/scan/" + p.token'), "/api/scan/*");
  // A call inside the expression must not split the segment in two.
  assert.equal(normalisePath("`/api/scan/${encodeURIComponent(t)}/full`"), "/api/scan/*/full");
  // An external URL comes back whole, so the `/api/` filter can drop it.
  assert.equal(normalisePath('"https://api.dataforseo.com/v3/x"'), "https://api.dataforseo.com/v3/x");
});

test("the call scanner finds the method, and defaults to GET", () => {
  assert.deepEqual(callsIn("f.tsx", 'await fetch("/api/scan/start", { method: "POST", body: b })'), [
    { file: "f.tsx", path: "/api/scan/start", method: "POST" },
  ]);
  // No `method` key is a GET. This is the one that matters: a GET is written
  // by omission, so a probe keyed on the word "GET" reads every one of them
  // as absent.
  assert.deepEqual(callsIn("f.tsx", 'await fetch("/api/scan/" + t, { cache: "no-store" })'), [
    { file: "f.tsx", path: "/api/scan/*", method: "GET" },
  ]);
  // An options object holding another fetch must not swallow the sibling call.
  assert.equal(callsIn("f.tsx", 'fetch("/api/a", {x: 1});\nfetch("/api/b", {y: 2});').length, 2);
  // External fetches are not this sweep's business.
  assert.deepEqual(callsIn("f.tsx", 'fetch("https://example.com/api/x")'), []);
});

test("the route matcher fires on the shapes that are wrong", () => {
  assert.ok(matches("/api/scan/*/status", "/api/scan/[token]/status"));
  assert.ok(matches("/api/scan/start", "/api/scan/start"));
  // Different depth is a different route, however similar it reads.
  assert.ok(!matches("/api/scan/*/status", "/api/scan/[token]"));
  assert.ok(!matches("/api/scan/*/status", "/api/scan/[token]/full"));
  assert.ok(!matches("/api/coverage-check", "/api/coverage-check/[token]/rerun"));
});

// --------------------------------------------------------- the real files

test("every internal fetch names a route that exists and takes its method", () => {
  const routes = routeTable();
  const calls = allCalls();

  // Counter-guards. An empty list on either side makes the assertion below
  // pass while reading nothing at all - both halves of this sweep are a walk
  // over `git ls-files`, and a walk that stops matching is silent.
  assert.ok(routes.length > 10, `only ${routes.length} API routes found - the route walk has drifted`);
  assert.ok(calls.length > 8, `only ${calls.length} internal fetches found - the call scanner has drifted`);

  const broken = calls.filter(
    (c) => !routes.some((r) => matches(c.path, r.path) && r.methods.includes(c.method)),
  );

  assert.deepEqual(
    broken,
    [],
    "These call sites fetch a route that does not exist, or does not export the method they send. " +
      "Nothing else in this repo fails on it: it typechecks, it builds, and it answers 404 or 405 " +
      "inside a click handler where only the visitor sees it.\n" +
      broken.map((c) => `  ${c.method.padEnd(5)} ${c.path}  in ${c.file}`).join("\n"),
  );
});

test("every route method has a caller, or a written reason it has none", () => {
  const routes = routeTable();
  const calls = allCalls();

  const uncalled: string[] = [];
  const staleExemptions: string[] = [];

  for (const r of routes) {
    for (const method of r.methods) {
      const called = calls.some((c) => matches(c.path, r.path) && c.method === method);
      const exempt = NO_CALLER.find((e) => e.route === r.path && e.method === method);

      if (!called && !exempt) {
        uncalled.push(`  ${method.padEnd(5)} ${r.path}`);
      }
      if (called && exempt) {
        staleExemptions.push(`  ${method.padEnd(5)} ${r.path}  - now called from the app`);
      }
      if (!called && exempt && !exempt.earns()) {
        staleExemptions.push(
          `  ${method.padEnd(5)} ${r.path}  - the exemption says "${exempt.why}" and the thing that ` +
            `would do the calling no longer does`,
        );
      }
    }
  }

  assert.deepEqual(
    uncalled,
    [],
    "These route methods exist and nothing in the app calls them. Either a caller was deleted and " +
      "this is dead code, or the caller's path drifted and the feature is broken. If it is called " +
      "from outside the app, add it to NO_CALLER with a reason and something that earns it:\n" +
      uncalled.join("\n"),
  );

  assert.deepEqual(
    staleExemptions,
    [],
    "The NO_CALLER list has rotted. An exemption that no longer describes the tree is worse than " +
      "no list, because it reads as a checked fact:\n" + staleExemptions.join("\n"),
  );

  // And the list must still be doing work. If every entry drops off, the
  // assertions above pass over an empty exemption set and nobody notices that
  // the reasons stopped being consulted.
  assert.ok(NO_CALLER.length >= 3, "NO_CALLER has emptied - check it is still being read");
});
