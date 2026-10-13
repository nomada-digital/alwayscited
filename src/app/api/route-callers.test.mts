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
  {
    route: "/api/app/auth",
    method: "POST",
    why: "Posted by the plain HTML form on /app/auth (the login link's button), which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/app/app/auth/page.tsx"), "utf8").includes('action="/api/app/auth"'),
  },
  {
    route: "/api/app/logout",
    method: "POST",
    // The sidebar moved out of /app/[client]/page.tsx into its own component
    // on 29 Sep 2026 (T4), so the parity fixture draws the same one.
    why: "Posted by the plain HTML form in the dashboard sidebar, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/app/Sidebar.tsx"), "utf8").includes('action="/api/app/logout"'),
  },
  {
    route: "/api/app/[client]/stop",
    method: "POST",
    // BRIEF-3 T6 part 2b, 30 Sep 2026: stop and Undo on the Clusters page.
    why: "Posted by the plain HTML stop and Undo forms on the Clusters page, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes("action: `/api/app/${encodeURIComponent(slug)}/stop`"),
  },
  {
    route: "/api/app/[client]/group",
    method: "POST",
    // R170 part 2, 2 Oct 2026: Move into a cluster on the Clusters page's ungrouped prompts.
    why: "Posted by the plain HTML Move into a cluster form on the Clusters page's ungrouped prompts, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes('act.action.replace(/\\/stop$/, "/group")'),
  },
  {
    route: "/api/app/[client]/prompt",
    method: "POST",
    // BRIEF-3 T6 part 2c, 30 Sep 2026: the free slot on the Clusters page.
    why: "Posted by the plain HTML free-slot form on the Clusters page, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes('act.action.replace(/\\/stop$/, "/prompt")'),
  },
  {
    route: "/api/app/[client]/edit",
    method: "POST",
    // BRIEF-3 T6 part 2d, 30 Sep 2026: the pending cluster editor's Save changes.
    why: "Posted by the plain HTML pending-cluster editor on the Clusters page, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes('act.action.replace(/\\/stop$/, "/edit")'),
  },
  {
    route: "/api/app/[client]/note",
    method: "POST",
    // BRIEF-3 T7 part 4b, 30 Sep 2026: Add a note on the one-cluster page.
    why: "Posted by the plain HTML Add a note form on the one-cluster page, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/app/app/[client]/clusters/[cluster]/page.tsx"), "utf8").includes("noteAction={`/api/app/${encodeURIComponent(slug)}/note`}"),
  },
  {
    route: "/api/app/[client]/report",
    method: "GET",
    // R90 T8 v1, 30 Sep 2026: Download report, two CSVs of the range.
    // R97 part 4, 30 Sep 2026: also the placements screen's Download CSV (?kind=placements).
    // R151, 3 Oct 2026: the Overview's links go through `download`, which is `report` once the
    // range has readings - withheld with nothing read, as the Reports page already does.
    why: "Opened by the Overview's Download report and Keywords CSV links (once the range has readings) and the placements screen's Download CSV (plain <a download>), which the fetch scanner does not read.",
    earns: () =>
      readFileSync(join(ROOT, "src/app/app/[client]/page.tsx"), "utf8").includes("reportPath={`/api/app/${encodeURIComponent(slug)}/report`}") &&
      readFileSync(join(ROOT, "src/components/app/Overview.tsx"), "utf8").includes('href={download("answers")} download'),
  },
  {
    route: "/api/app/[client]/ask",
    method: "POST",
    // BRIEF-2 T11 /ask, 30 Sep 2026: first caller is Add a cluster's "Ask us to pick one".
    // DS16, 2 Oct 2026: the action now carries the page's view in its query (fact moved).
    // 13 Oct 2026, DIY P9 (P7's handoff, spec 10 section 3.6): also "Suggest this to your account lead" on one
    // opportunity, kind=opportunity&id=<uuid> and nothing typed (paths.ts oppAskAction).
    why: "Posted by the plain HTML Ask us to pick one form in the Clusters page's Add panel, and the Suggest this to your account lead form on one opportunity, which the fetch scanner does not read.",
    earns: () =>
      readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes("action={`/api/app/${encodeURIComponent(slug)}/ask${view ? `?${view}` : \"\"}`}") &&
      readFileSync(join(ROOT, "src/lib/diy/opportunities/paths.ts"), "utf8").includes("return `/api/app/${encodeURIComponent(slug)}/ask${query({ kind: \"opportunity\", id })}`;") &&
      readFileSync(join(ROOT, "src/components/app/opportunities/OppDetail.tsx"), "utf8").includes("action={oppAskAction(p.slug, p.id)}"),
  },
  {
    route: "/api/app/[client]/hide",
    method: "POST",
    // BRIEF-2 T11 part 5, 30 Sep 2026: the upgrade prompt's x, "Hide for 30 days".
    why: "Posted by the plain HTML Hide for 30 days form in UpgradePrompt, which the fetch scanner does not read.",
    // DS16, 2 Oct 2026: the action carries the Clusters view (`kept`); fact moved.
    earns: () => readFileSync(join(ROOT, "src/components/app/UpgradePrompt.tsx"), "utf8").includes("action={`${api}/hide${kept}`}"),
  },
  {
    route: "/api/app/[client]/check",
    method: "POST",
    // BRIEF-3 T6 part 3b, 30 Sep 2026: Check keyword in Add a cluster.
    why: "Posted by the plain HTML Check keyword form in the Clusters page's Add panel, which the fetch scanner does not read.",
    // DS15, 2 Oct 2026: the action carries the page's view as a query, so the literal ends `/check${view ...`.
    earns: () => readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes("action={`/api/app/${encodeURIComponent(slug)}/check${view ? `?${view}` : \"\"}`}"),
  },
  {
    route: "/api/app/[client]/setup",
    method: "POST",
    // R166 part 3b, 1 Oct 2026: step 3's Confirm on the setup page.
    why: "Posted by the plain HTML Confirm form on /app/[client]/setup, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/app/app/[client]/setup/page.tsx"), "utf8").includes("action={`/api/app/${encodeURIComponent(slug)}/setup`}"),
  },
  {
    route: "/api/app/[client]/cluster",
    method: "POST",
    // BRIEF-3 T6 part 3c, 30 Sep 2026: Start tracking this cluster.
    why: "Posted by the plain HTML step 2 form in the Clusters page's Add panel, which the fetch scanner does not read.",
    // DS15, 2 Oct 2026: as /check above, the action carries the page's view.
    earns: () => readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes("action={`/api/app/${encodeURIComponent(slug)}/cluster${view ? `?${view}` : \"\"}`}"),
  },
  {
    route: "/api/app/[client]/keyword",
    method: "POST",
    // R179, 2 Oct 2026: Use this keyword, after a pending cluster's Change keyword passes - on a setup card and on Clusters.
    why: "Posted by the plain HTML Use this keyword forms on a setup card and a pending Clusters card, which the fetch scanner does not read.",
    earns: () =>
      readFileSync(join(ROOT, "src/app/app/[client]/setup/page.tsx"), "utf8").includes("action={`/api/app/${encodeURIComponent(slug)}/keyword?") &&
      readFileSync(join(ROOT, "src/components/app/Clusters.tsx"), "utf8").includes('route("/keyword")'),
  },
  {
    route: "/api/app/[client]/member",
    method: "POST",
    // R142 part 2, 1 Oct 2026 (BRIEF-4 P2 Team): invite, change a role, remove.
    why: "Posted by the plain HTML Invite someone, Make editor/viewer and Remove forms on Settings, which the fetch scanner does not read.",
    // DS40, 2 Oct 2026: the action now carries the page's stated range (`keep`), so the 303 lands back on it.
    earns: () => readFileSync(join(ROOT, "src/components/app/Settings.tsx"), "utf8").includes("const action = `/api/app/${encodeURIComponent(slug)}/member${keep}`;"),
  },
  {
    route: "/api/app/[client]/trial",
    method: "POST",
    // 8 Oct 2026: the alwaystracked trial's Cancel trial, owners only, built dark.
    why: "Posted by the plain HTML Cancel trial confirm form in Settings > Billing, which the fetch scanner does not read.",
    earns: () => readFileSync(join(ROOT, "src/components/app/Settings.tsx"), "utf8").includes("action={`/api/app/${encodeURIComponent(slug)}/trial`}"),
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
    route: "/api/app/[client]/plan",
    method: "POST",
    // 13 Oct 2026, DIY P5 (P3's handoff, spec 10 section 3.6): every form on Actions and on the Overview's This week.
    why: "Posted by the plain HTML forms on Actions and on the Overview's This week, which the fetch scanner does not read; paths.ts builds every one of their actions.",
    earns: () =>
      readFileSync(join(ROOT, "src/lib/diy/plan/paths.ts"), "utf8").includes("return `/api/app/${encodeURIComponent(slug)}/plan${query(keep)}`;") &&
      readFileSync(join(ROOT, "src/components/app/plan/PlanCard.tsx"), "utf8").includes("planAction(slug, { ...keep, id: item.id })") &&
      readFileSync(join(ROOT, "src/components/app/plan/ThisWeek.tsx"), "utf8").includes("action={planAction(slug, { ...at, id: item.id })}") &&
      readFileSync(join(ROOT, "src/components/app/plan/AddTask.tsx"), "utf8").includes("action={planAction(slug, keep)}"),
  },
  {
    route: "/api/app/[client]/keywords",
    method: "POST",
    // 13 Oct 2026, DIY P9 (P6's handoff, spec 10 section 3.6): gaining ground's Dismiss, Restore and the toast's Undo on Google.
    why: "Posted by the plain HTML Dismiss, Restore and Undo forms in gaining ground on the Google page, which the fetch scanner does not read.",
    earns: () => {
      const src = readFileSync(join(ROOT, "src/components/app/google/GainingGround.tsx"), "utf8");
      return src.includes("const route = `/api/app/${encodeURIComponent(p.slug)}/keywords?${new URLSearchParams(p.keep)}`;") && src.includes('<form method="post" action={route}');
    },
  },
  {
    route: "/api/app/[client]/opportunity",
    method: "POST",
    // 13 Oct 2026, DIY P9 (P7's handoff, spec 10 section 3.6): every status form, Log a site and Verify now on Opportunities.
    why: "Posted by the plain HTML status, Log a site and Verify now forms on Opportunities and one opportunity, which the fetch scanner does not read; paths.ts oppAction builds every one of their actions.",
    earns: () =>
      readFileSync(join(ROOT, "src/lib/diy/opportunities/paths.ts"), "utf8").includes("return `/api/app/${encodeURIComponent(slug)}/opportunity${query(q)}`;") &&
      readFileSync(join(ROOT, "src/components/app/opportunities/Opportunities.tsx"), "utf8").includes("action={oppAction(p.slug, p.keep)}") &&
      readFileSync(join(ROOT, "src/components/app/opportunities/OppDetail.tsx"), "utf8").includes('const action = oppAction(p.slug, { id: p.id, at: "detail" });'),
  },
  {
    route: "/api/app/[client]/prompt-offer",
    method: "POST",
    // 13 Oct 2026, DIY P9 (P7's handoff, spec 10 sections 3.6 and 6.7): the prompt step on one opportunity - add, swap, undo, watch.
    why: "Posted by the plain HTML prompt step and swap picker forms on one opportunity, which the fetch scanner does not read; paths.ts promptOfferAction builds their action.",
    earns: () =>
      readFileSync(join(ROOT, "src/lib/diy/opportunities/paths.ts"), "utf8").includes("return `/api/app/${encodeURIComponent(slug)}/prompt-offer${query({ id })}`;") &&
      readFileSync(join(ROOT, "src/components/app/opportunities/OppDetail.tsx"), "utf8").includes("const offer = promptOfferAction(p.slug, p.id);"),
  },
  {
    route: "/api/app/[client]/links",
    method: "POST",
    // 13 Oct 2026, DIY P10 (spec 10 section 3.6): Show the next 5, Pursue and Check a link on Links.
    why: "Posted by the plain HTML Show the next 5, Pursue and Check a link forms on Links, which the fetch scanner does not read; paths.ts linksAction builds every one of their actions.",
    earns: () => {
      const links = readFileSync(join(ROOT, "src/components/app/links/Links.tsx"), "utf8");
      return (
        readFileSync(join(ROOT, "src/lib/diy/links/paths.ts"), "utf8").includes("return `/api/app/${encodeURIComponent(slug)}/links${query({ view: keep.view })}`;") &&
        links.includes("action={linksAction(slug, { view })}") &&
        links.includes('action={linksAction(p.slug, { view: "targets" })}') &&
        links.includes('action={linksAction(p.slug, { view: "check" })}')
      );
    },
  },
  {
    route: "/api/app/[client]/pages",
    method: "POST",
    // 13 Oct 2026, DIY P9 (P8's handoff, spec 10 section 3.6): add, remove, check, example and Add to Actions on Your pages.
    why: "Posted by the plain HTML forms on Your pages and one key page (Add page, Remove, Check this page now, Draft an example, Add to Actions), which the fetch scanner does not read; paths.ts pagesAction builds every one of their actions.",
    earns: () =>
      readFileSync(join(ROOT, "src/lib/diy/pages/paths.ts"), "utf8").includes("const base = `/api/app/${encodeURIComponent(slug)}/pages`;") &&
      readFileSync(join(ROOT, "src/components/app/pages/KeyPagesList.tsx"), "utf8").includes("const action = pagesAction(slug, keep);") &&
      readFileSync(join(ROOT, "src/components/app/pages/SchemaPanel.tsx"), "utf8").includes('const action = pageAction(slug, pageId, "schema");'),
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
