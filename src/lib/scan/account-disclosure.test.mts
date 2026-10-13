import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { code, liveSqlFunctions, sourceFiles } from "../source-read.mts";

/**
 * `account_id` never reaches a visitor.
 *
 * ## Why this is a claim about the code and not a tidiness rule
 *
 * `unlock.ts` records a real defect it fixed: `resolveAccount` matched a
 * stored address with `ilike`, which takes a SQL LIKE pattern. An underscore
 * matches any single character, so a stored `a_b@x.com` matched anything
 * submitted as `aXb@x.com` **and handed that visitor the other person's
 * account row**. Percent and asterisk are wildcards on the same path, all
 * three are legal in an address, and all three pass the route's regex - so it
 * needed no malformed input, an underscore was enough.
 *
 * The fix is `eq` on a lowercased address. What matters here is the sentence
 * that classifies what happened before the fix:
 *
 * > Nothing reads account_id back to a visitor today, so what this produced
 * > was wrong attribution rather than disclosure [...] It stops being only
 * > attribution the day there is an account view.
 *
 * That sentence is the whole difference between a mis-filed row and one
 * visitor being handed another's account identifier. **It was true, and it was
 * held by nothing** - the file names its own trigger ("the day there is an
 * account view") and has no way to notice that day arriving. A stated reason
 * for a safety property is a claim about the tree, and it costs a `holds` now,
 * the same device `organization-entity.test.mts` uses for the `sameAs`
 * absence and `mail-from.test.mts` uses to stop blocked.md 20 outliving its
 * answer.
 *
 * ## The mechanism, which is what rules 1 and 2 are actually about
 *
 * Nothing redacts anything here. `account_id` stays off the wire for one
 * reason only: **every read in this tree names its columns**, and the three
 * that name `account_id` happen to sit in routes that answer with a redirect
 * or with a hand-built body. There is no allow-list, no serializer and no
 * type standing between the column and a response.
 *
 * So the edit that falsifies the claim is not a new feature. It is one
 * character: a `.select("*")` on `scans` or `leads` puts `account_id` into the
 * row object, and both routes below are then one `...scan` away from
 * publishing it. That edit moves no type, fails no build and reads as a
 * simplification. Rule 1 is the one that catches it.
 *
 * ## What each rule is for
 *
 * 1. **Nothing selects `*`.** The mechanism above, stated once. Green today
 *    across the whole tree - measured, not assumed - and it is the cheapest
 *    way to lose the property.
 * 2. **The set of reads that bring `account_id` into memory is pinned, with a
 *    reason each.** Derived by walking `src` and resolving an identifier
 *    select back to the constant it names, so `.select(SCAN_UNLOCK_COLUMNS)`
 *    counts as a reader of every column that string contains. A fourth reader
 *    fails this file until somebody classifies it - the failure is meant to be
 *    a question, not a bug report.
 * 3. **The set of files that mention it at all is pinned.** Rule 2 sees
 *    database reads. A server component rendering `{scan.account_id}` is not a
 *    read, and a page is not a `Response.json` - so neither of the other rules
 *    would see the account view the comment warns about. This one does,
 *    because such a page has to name the column somewhere.
 * 4. **No row bound from one of those reads is ever spread.** The two routes
 *    name their own response fields today. `...scan` is the one-line edit that
 *    undoes that, and it is invisible to a reader who is looking at the select
 *    rather than at the response.
 * 5. **No response body anywhere in the tree names it.** Tree-wide rather than
 *    scoped to the two routes, for the reason `spend-gates` learned the hard
 *    way: a rule scoped to the files that have the property today cannot see
 *    the file that gains it tomorrow.
 *
 * ## What this cannot see, stated plainly
 *
 * A column reaching a visitor through a module the route imports for another
 * reason. `buildUnlockPayload` is the live instance of that shape - the unlock
 * response spreads `...payload` - and it is covered only because rule 2 walks
 * every select in the tree and that function's selects are not in the set. An
 * import is not a call, and this file does not build a call graph.
 *
 * Nothing here is a live defect. The tree is clean under all five rules and
 * each was proved against an injected instance before it was committed.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

/** The column this file is about. Named once so a rule cannot drift from it. */
const COLUMN = "account_id";

type Source = { file: string; src: string };

/** Every shipped source file, prose removed. Tests are excluded by the walk. */
function shipped(): Source[] {
  return sourceFiles(ROOT).map((file) => ({
    file,
    src: code(readFileSync(join(ROOT, file), "utf8")),
  }));
}

/**
 * Every `const NAME = "..."` in the tree whose value is a column list naming
 * the column, as a set of identifier names.
 *
 * Resolved rather than special-cased: `SCAN_UNLOCK_COLUMNS` is shared by two
 * routes precisely so the list is written once, and a rule that only matched
 * inline strings would see neither of its readers.
 */
function columnConstants(files: Source[]): Set<string> {
  const names = new Set<string>();
  for (const { src } of files) {
    for (const m of src.matchAll(
      /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(["'`])([^"'`]*)\2/g,
    )) {
      if (new RegExp(`\\b${COLUMN}\\b`).test(m[3])) names.add(m[1]);
    }
  }
  return names;
}

/** A `.select(...)` call: the file, the line, and the argument as written. */
type Select = { file: string; line: number; arg: string; index: number };

function selectsIn({ file, src }: Source): Select[] {
  const out: Select[] = [];
  for (const m of src.matchAll(/\.select\(\s*(["'`])([^"'`]*)\1|\.select\(\s*([A-Za-z_$][\w$]*)\s*[),]/g)) {
    out.push({
      file,
      line: src.slice(0, m.index).split("\n").length,
      arg: (m[2] ?? m[3] ?? "").replace(/\s+/g, " ").trim(),
      index: m.index,
    });
  }
  return out;
}

/**
 * The reads that bring the column into server memory, each with the reason it
 * cannot reach the person who made the request.
 *
 * Keyed on file and argument rather than on a line number: a line number
 * churns on every edit above it, and an entry that has to be renumbered to
 * keep the suite green is an entry nobody re-reads.
 */
const RECORDED: Record<string, string> = {
  // 30 Sep 2026, T11 /ask: the member's own client, already membership-checked;
  // the id picks the account's recipient and is not in the 303. 1 Oct 2026
  // (R142 part 3): brand_aliases joins it for the alias ask's mail, which goes
  // to us or the agency contact, never back to the requester's page.
  "src/app/api/app/[client]/ask/route.ts :: account_id, brand_aliases":
    "the ask route's recipient lookup; the redirect carries only sent|refused and us|agency.",
  // 13 Oct 2026, DIY P7 (spec 10 section 4.7): the opportunity ask's own recipient lookup, on the member's own
  // client, already membership-checked; the 303 carries only Opportunities' done and why codes.
  "src/app/api/app/[client]/ask/route.ts :: account_id":
    "the opportunity ask's recipient lookup; the redirect carries only the asked or refused code, never the id.",
  // 29 Sep 2026, T2. Both render only on /admin/tracking, behind the /admin
  // Basic auth; the requester is Nomada, and the id is used only to group
  // members and post it back as a hidden field to the admin's own action.
  // 9 Oct 2026 (AG-1): the member id joined, to read each member's client scope; same page, same reason.
  "src/app/admin/tracking/page.tsx :: id, account_id, email, role":
    "admin-only page; groups dashboard members under their client. Never reaches a visitor.",
  // 29 Sep 2026, BRIEF-3 C2: the limit columns became cluster_limit; same read, same reason.
  // 30 Sep 2026: brand_name and brand_aliases added, for the "names the brand" flag on live prompts.
  "src/app/admin/tracking/page.tsx :: id, account_id, domain, brand_name, brand_aliases, market, tier, status, started_on, cluster_limit, slug":
    "admin-only page; the account id goes back only into the admin's own member form.",
  // 29 Sep 2026, T3. The signed-in member's memberships and clients; the
  // account id is used only to join the two and is dropped before return
  // (MemberClient has no account_id), so no page or response carries it.
  // 9 Oct 2026 (AG-1): the member id joined, to read the member's client scope (scope.ts readScopes).
  "src/lib/tracking/member.ts :: id, account_id, role":
    "joins a member to their accounts server-side; clientsFor returns no account_id.",
  // 30 Sep 2026, T6 part 1: cluster_limit added for the Clusters page's usage bar; account_id still stays server-side.
  // 8 Oct 2026: trial_ends_at and trial_cancelled_at added for the plan card's trial line; account_id still stays server-side.
  // 8 Oct 2026 (audit activation-5, ia-12): status, so an ended client says so rather than promising a next check.
  "src/lib/tracking/member.ts :: id, account_id, slug, domain, brand_name, market, tier, started_on, question_limit, keyword_limit, cluster_limit, trial_ends_at, trial_cancelled_at, status":
    "maps each client to its role by account server-side; the returned MemberClient omits account_id.",
  // 1 Oct 2026, R142 (BRIEF-4 P2): Settings' team list. The id picks the account's members and is dropped.
  "src/lib/tracking/settings-data.ts :: account_id, brand_aliases":
    "finds the client's account server-side to list its live members; SettingsData carries no account_id.",
  // 1 Oct 2026, R142 part 2 (BRIEF-4 P2 Team): the owner's own client, already membership-checked.
  "src/app/api/app/[client]/member/route.ts :: account_id":
    "the member route's team lookup; the 303 carries only the toast word and the email the owner typed.",
  // 1 Oct 2026, R159 part 3: plan_ended finds the ended client's live owners.
  // 8 Oct 2026 (audit copy-4, package E): slug and trial_ends_at joined, for
  // plan_ended's Billing link and its trial version; the id is still used only
  // to find the owners, server-side.
  // 9 Oct 2026 (BL-2, review of 2c6dc99): the select is endClient's, which a
  // customer.subscription.updated saying canceled now reaches too. Same use.
  "src/lib/checkout/signup.ts :: account_id, domain, tier, slug, trial_ends_at":
    "the Stripe webhook's endClient (subscription deleted, or updated to canceled) finds the ended client's owners to mail; the webhook answers Stripe with a status only, and no visitor makes the request.",
  // 8 Oct 2026 (audit activation-1, package E): the trial and setup emails.
  // Server-only callers, no visitor request: the CRON_SECRET-gated cron and
  // the signed Stripe webhook's trial_will_end. The id finds the account's
  // upsell mode and live owners and is never in what either answers.
  "src/lib/email/lifecycle-sweep.ts :: CLIENT_COLUMNS":
    "the daily cron's lifecycle sweep and Stripe's trial_will_end read a client's account to skip agency mode and mail its live owners; the cron answers with sent and unsent labels of email name and client id, the webhook with a status only.",
  // 1 Oct 2026, R159 part 5: first_reading finds the client's account mode and owners.
  "src/lib/tracking/runner.ts :: account_id, tier":
    "the tracking runner, after a run, for first_reading's agency check and owners; started only by the cron's signed dispatch, it returns a status only.",
  // 2 Oct 2026, R166 / R159: setup_confirmed's agency check, after the setup route writes its one row.
  // 9 Oct 2026 (audit copy-2): market and started_on joined, so the mail says the first check's time in the
  // client's zone and promises no "first" check once checks have begun; the id is still only the agency check.
  "src/lib/tracking/setup-mail.ts :: account_id, tier, market, started_on":
    "mailSetupConfirmed reads the confirmed client's account for its upsell mode; it returns nothing, and the setup route answers with a 303 to the Overview.",
};

/**
 * Every shipped file that mentions the column, and why it is allowed to.
 *
 * The write sites are the point of the column existing and are listed as
 * writes, so a rule cannot quietly start reading an insert payload as a
 * disclosure.
 */
const MENTIONED: Record<string, string> = {
  "src/lib/scan/unlock.ts":
    "Declares SCAN_UNLOCK_COLUMNS, and writes the column on the accounts and " +
    "client_domains rows. Writes, not reads: resolveAccount is the only thing that " +
    "inserts into accounts.",
  "src/app/admin/tracking/actions.ts":
    "T2 (29 Sep 2026): writes the column on client_domains and dashboard_members when " +
    "Nomada creates a tracked client or a member. Writes, behind the admin check.",
  "src/app/admin/tracking/page.tsx":
    "T2: renders the admin's member form with the account id as a hidden field. " +
    "Admin-only, behind the /admin Basic auth.",
  "src/lib/tracking/member.ts":
    "T3: reads the column to join a signed-in member to their clients; returns none of it.",
  "src/app/api/app/[client]/ask/route.ts":
    "T11 /ask (30 Sep 2026): reads the member's own client's account_id to find its upsell mode " +
    "and agency contact. Used only to pick the recipient; the route answers with a 303 carrying " +
    "sent|refused and us|agency, never the id.",
  "src/lib/tracking/settings-data.ts":
    "R142 (1 Oct 2026): reads the column to list the client's live members for Settings; " +
    "used only in the member read's filter, and SettingsData returns emails, names, roles and sign-in days, never the id.",
  "src/app/api/app/[client]/member/route.ts":
    "R142 part 2 (1 Oct 2026): reads the owner's own client's account_id to read and change its team. " +
    "Used only in team.ts filters and writes; the route answers with a 303 carrying a toast word and an email, never the id.",
  "src/lib/tracking/team.ts":
    "R142 part 2 (1 Oct 2026): filters and writes dashboard_members by the account_id the member route passes; " +
    "returns emails, roles and removed_at only, never the account id. Since 9 Oct 2026 (AG-1) also each member's own " +
    "row id and client scope, which the route uses for its writes and never puts in the 303.",
  "src/lib/tracking/scope.ts":
    "AG-1 (9 Oct 2026): visibleClients joins a member's memberships to client rows by account_id, a pure function " +
    "clientsFor calls server-side. It hands each row back unspread with its role, and clientsFor names the fields it returns.",
  "src/lib/checkout/signup.ts":
    "C4 (30 Sep 2026): writes the column on client_domains and dashboard_members when a " +
    "paid checkout from a scan becomes a client. Writes, behind the Stripe signature; " +
    "the webhook answers with no row. Also reads it back when a subscription ends, to mail " +
    "plan_ended (R159, 1 Oct 2026; widened 8 Oct 2026 - its RECORDED entry above).",
  "src/lib/tracking/runner.ts":
    "R159 part 5 (1 Oct 2026): reads the client's account_id after a run to find its upsell mode and " +
    "live owners for first_reading. Started only by the cron's signed dispatch; the run returns a status, never the id.",
  "src/lib/tracking/setup-mail.ts":
    "R166 / R159 (2 Oct 2026): reads the confirmed client's account_id to skip setup_confirmed in agency mode. " +
    "Returns nothing; the setup route answers with a 303, never the id.",
  "src/lib/email/lifecycle-sweep.ts":
    "Audit activation-1 (8 Oct 2026, package E): reads a client's account_id to skip agency mode and to find its " +
    "live owners for trial_midpoint, trial_ending, setup_reminder and plan_ended. Run only by the CRON_SECRET-gated " +
    "cron and the signed Stripe webhook; SweepResult carries email names and client ids, never the account id.",
  // 13 Oct 2026, DIY P9 (spec 10 section 7.10): the This week email's recipients.
  "src/lib/email/week-recipients.ts":
    "DIY P9 (13 Oct 2026): reads the members of a client's account by account_id for the Monday This week email - " +
    "its live owners and editors who can see the client. Called only from lifecycle-sweep.ts behind CRON_SECRET; " +
    "returns email addresses to mail, never the account id.",
};

test("nothing in this tree selects *", () => {
  const stars: string[] = [];
  for (const { file, src } of shipped()) {
    for (const m of src.matchAll(/\.select\(\s*(["'`])\s*\*\s*\1/g)) {
      stars.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(
    stars,
    [],
    "a select(*) puts every column of the row into the object a route answers with, " +
      `which is how ${COLUMN} stops being unreachable without anybody editing a response:\n  ` +
      stars.join("\n  "),
  );
});

test(`every read of ${COLUMN} is recorded with the reason it cannot reach a visitor`, () => {
  const files = shipped();
  const constants = columnConstants(files);
  const found: string[] = [];

  for (const source of files) {
    for (const sel of selectsIn(source)) {
      const namesIt = new RegExp(`\\b${COLUMN}\\b`).test(sel.arg) || constants.has(sel.arg);
      if (namesIt) found.push(`${sel.file} :: ${sel.arg}`);
    }
  }

  const recorded = Object.keys(RECORDED).sort();
  assert.deepEqual(
    [...new Set(found)].sort(),
    recorded,
    `a read of ${COLUMN} is in nobody's list. Classify it here with the reason it ` +
      "cannot reach the person who made the request, or stop selecting the column.",
  );
});

test(`every file that mentions ${COLUMN} is recorded`, () => {
  const found = shipped()
    .filter(({ src }) => new RegExp(`\\b${COLUMN}\\b`).test(src))
    .map(({ file }) => file)
    .sort();

  assert.deepEqual(
    found,
    Object.keys(MENTIONED).sort(),
    `a shipped file names ${COLUMN} and is on no list. A page rendering it is neither a ` +
      "select nor a response body, so this is the only rule here that would see the " +
      "account view unlock.ts names as the day its own reasoning stops holding.",
  );
});

test(`no row read with ${COLUMN} on it is ever spread`, () => {
  const files = shipped();
  const constants = columnConstants(files);
  const offenders: string[] = [];

  for (const { file, src } of files) {
    /**
     * The variable each account-bearing read binds, as `const { data: NAME }`.
     *
     * Taken from the 200 characters in front of the `.select(`, which is where
     * the destructuring sits in every one of these call sites - the read is
     * always `const { data: x, error } = await db.from(...).select(...)`.
     */
    const bound = new Set<string>();
    for (const sel of selectsIn({ file, src })) {
      if (!(new RegExp(`\\b${COLUMN}\\b`).test(sel.arg) || constants.has(sel.arg))) continue;
      const before = src.slice(Math.max(0, sel.index - 200), sel.index);
      const decl = [...before.matchAll(/data\s*:\s*([A-Za-z_$][\w$]*)/g)].pop();
      if (decl) bound.add(decl[1]);
    }
    for (const name of bound) {
      if (new RegExp(`\\.\\.\\.\\s*${name}\\b`).test(src)) {
        offenders.push(`${file}: ...${name}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these routes keep the column off the wire by naming their response fields one by " +
      `one. Spreading the row publishes ${COLUMN} with no edit to any select:\n  ` +
      offenders.join("\n  "),
  );
});

test(`no response body in this tree names ${COLUMN}`, () => {
  const offenders: string[] = [];

  for (const { file, src } of shipped()) {
    for (const m of src.matchAll(/(?:Next)?Response\.json\(/g)) {
      // The argument list, matched by counting parens so a nested object or a
      // second `{ status }` argument does not cut it short.
      let depth = 0;
      let end = m.index + m[0].length - 1;
      for (let i = end; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const args = src.slice(m.index, end);
      if (new RegExp(`\\b${COLUMN}\\b`).test(args)) {
        offenders.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a response names ${COLUMN}. That is the disclosure unlock.ts's own comment says ` +
      "this tree does not do, and it is the sentence that downgrades the ilike defect " +
      `from handing a visitor another account to mis-filing a row:\n  ` + offenders.join("\n  "),
  );
});

// ------------------------------------------------------------- the SQL half

/**
 * Same claim, same column, the other language.
 *
 * Rule 1 above says "nothing in this tree selects `*`" and walks `src` for
 * `.ts` and `.tsx`. The header calls that green "across the whole tree". It is
 * not the whole tree: **`scan_teaser` reads `from scans s`**, and `scans` is
 * the table `account_id` is a column of. Every rule above stops at the edge of
 * the `.sql` files, which is this repo's most-paid denominator failure - the
 * same edge `citations.test.mts` was standing on until `aadfd06`, and the same
 * shape as `spend-gates` claiming "every door in this tree" while walking
 * `src/app/api` for `route.ts`.
 *
 * ## Why the SQL side is the more exposed one, not the lesser one
 *
 * Measured off the migrations rather than remembered: of the six live
 * functions, **`scan_teaser` is the only one granted to `anon`**, and it is
 * `security definer`, so it runs with the owner's rights and ignores RLS. The
 * other five are `service_role` only and are reachable from this tree alone.
 * The grants themselves are held by `function-grants.test.mts`; what matters
 * here is the consequence - `scan_teaser` is the function behind the public
 * scan report, callable by anybody holding a public token, and it selects from
 * the account-bearing table.
 *
 * So the one-character edit rule 1 exists to refuse has an exact counterpart
 * here, and it is *cheaper* to make. The TypeScript version is
 * `.select("*")`. The SQL versions are two:
 *
 *  - `select c.*` inside one of the six `jsonb_agg(t)` sub-selects. Those
 *    aggregate a whole derived row by alias, so widening the sub-select's
 *    column list widens the published JSON with no other edit.
 *  - `to_jsonb(s)` or `row_to_json(s)` in place of the twenty-key
 *    `jsonb_build_object`. That reads as a simplification, shortens the
 *    function by ninety lines, and publishes every column of `scans` -
 *    `account_id`, `ip_hash` and `client_domain_id` included - to an
 *    anonymous caller.
 *
 * Neither fails a build, neither moves a TypeScript type, and rules 1 to 5
 * cannot see either.
 *
 * ## What these three rules are, and what they are not
 *
 * They are keyed on the shape of the query, the way the TypeScript rules are
 * keyed on the shape of the select. They cannot tell you a function is
 * *correct*; they refuse the two constructions that publish a column nobody
 * chose to publish, and they pin the denominator so the next function joins
 * loudly.
 *
 * `jsonb_agg(t)` is deliberately NOT forbidden. It is a whole-row
 * serialisation of a derived alias and the tree has six of them, every one
 * legitimate because the sub-select under it names its columns. Forbidding it
 * would fail on a clean tree, which is a rule written to be exempted rather
 * than heeded. The star rule below is what actually guards those six, and it
 * guards them at the only place the widening can happen.
 *
 * The star pattern is anchored at the column-list position - `select *` and
 * `select c.*`, never `count(*)`, which appears fourteen times in
 * `scan_teaser` alone and is not a whole-row read. That narrowing is the one
 * thing here most likely to be wrong in the flattering direction, so
 * `docs/inject-account-sql.mjs` proves it from both sides: a real `select c.*`
 * must be caught, and the existing `count(*)` must not be.
 */

/**
 * The tables a read of which can put the column, or the identity behind it, in
 * a function's hands.
 *
 * **Derived, because the first draft of this rule typed them.** That draft
 * listed `scans`, `leads`, `client_domains` and `accounts` from the four
 * `account_id` lines in front of whoever wrote it - which is the typed
 * denominator inside a sweep, the species this repo has paid for three times
 * in one sitting, arriving in the file written to close a denominator gap.
 * A table added tomorrow with an `account_id` on it would have been outside
 * it, and the rule would have stayed green while reporting on the tree.
 *
 * Two kinds of table qualify and the second is why `accounts` is here at all:
 * a table carrying the column, and the table the column points *at*, since
 * publishing `accounts.id` is the same disclosure spelled the other way.
 */
function bearerTables(): string[] {
  const sql = migrationSources().join("\n");
  const found = new Set<string>();
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
    if (new RegExp(`\\b${COLUMN}\\b`).test(m[2]!)) found.add(m[1]!.toLowerCase());
    // The referenced side, taken from the same declaration rather than assumed.
    for (const r of m[2]!.matchAll(new RegExp(`\\b${COLUMN}\\b[^,]*?references\\s+(?:public\\.)?(\\w+)`, "gi"))) {
      found.add(r[1]!.toLowerCase());
    }
  }
  return [...found].sort();
}

/** Every migration as written, for the table declarations the function walk drops. */
function migrationSources(): string[] {
  const dir = join(ROOT, "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").replace(/--[^\n]*/g, ""));
}

const BEARERS = bearerTables();

/** A `select` that takes every column, never `count(*)`. */
const SQL_STAR = /\bselect\s+(?:distinct\s+)?(?:\w+\.)?\*/gi;

/** A whole row serialised by alias, never `to_jsonb(s.engines)`. */
const SQL_WHOLE_ROW = /\b(?:to_jsonb|row_to_json)\s*\(\s*([A-Za-z_]\w*)\s*\)/gi;

/**
 * The live SQL functions that read a table carrying the column, and why each
 * cannot publish it.
 *
 * All six of them do, which is the point rather than an accident: every
 * function in this schema either reads or writes `scans` or `leads`. A rule
 * that pinned "the ones that touch it" would therefore pin everything and say
 * nothing, so what each entry records is the thing that actually keeps the
 * column off the wire - the return type, and for the one public function, the
 * fact that it hand-builds its object key by key.
 */
const SQL_READERS: Record<string, string> = {
  scan_teaser:
    "The public scan report. security definer and the only function granted to anon, so " +
    "this is the one place a whole-row read reaches somebody who is not us. Returns jsonb " +
    "built key by key with jsonb_build_object; the outer row `s` is never serialised whole.",
  scan_source_coverage:
    "The admin source counts. service_role only, and `returns table (scan_id, " +
    "cited_domains, classified_domains)` - a named three-column shape a widened select " +
    "cannot leak through.",
  note_scan_spend:
    "The spend accumulator. service_role only, `returns table` with its columns named.",
  note_preview_call:
    "The per-scan call reservation. service_role only, returns integer.",
  note_preview_calls:
    "The same reservation in bulk. service_role only, returns void.",
  note_verify_send:
    "The verify-send ceiling on leads. service_role only, returns integer - and the one " +
    "whose own migration records being security definer with no revoke as the defect it " +
    "was written to fix.",
};

test("the SQL walk can see the functions it is sweeping", () => {
  const live = liveSqlFunctions(ROOT);
  // A parse that found no bodies is the same green as a clean schema.
  assert.ok(live.size >= 6, `expected 6+ live SQL functions, parsed ${live.size}`);
  // And it has to have taken the LAST definition. scan_teaser is written five
  // times; the live one is the only one carrying google_rank.
  assert.match(
    live.get("scan_teaser")!.body,
    /google_rank/,
    "liveSqlFunctions returned a superseded scan_teaser - apply order has stopped working",
  );
  // And the derived table list, which every rule below is scoped by. A parse
  // that found no tables makes the reader rule vacuous, and a derivation is
  // exactly the thing that can go quiet without anybody editing it.
  assert.deepEqual(
    BEARERS,
    // dashboard_members joined on 29 Sep 2026 (20260929000000_tracking_dashboard,
    // the alwaystracked dashboard's logins). No SQL function reads it; the
    // dashboard reads it server-side through the service role only.
    ["accounts", "client_domains", "dashboard_members", "leads", "scans"],
    `the tables carrying ${COLUMN} have changed, or bearerTables has stopped parsing them`,
  );
});

test(`every live SQL function that reads a table carrying ${COLUMN} is recorded`, () => {
  const found = [...liveSqlFunctions(ROOT)]
    .filter(([, { body }]) =>
      BEARERS.some((t) => new RegExp(`\\b(?:from|join|update|into)\\s+(?:public\\.)?${t}\\b`, "i").test(body)),
    )
    .map(([fn]) => fn)
    .sort();

  assert.deepEqual(
    found,
    Object.keys(SQL_READERS).sort(),
    `a SQL function reads a table carrying ${COLUMN} and is on no list. Classify it here ` +
      "with what stops it returning the column - its return type, or its grants. As with " +
      "rule 2, the failure is meant to be a question rather than a bug report.",
  );
});

test("no live SQL function takes a whole row", () => {
  const offenders: string[] = [];

  for (const [fn, { file, body }] of liveSqlFunctions(ROOT)) {
    for (const m of body.matchAll(SQL_STAR)) {
      offenders.push(`${file} ${fn}: ${m[0].replace(/\s+/g, " ")}`);
    }
    for (const m of body.matchAll(SQL_WHOLE_ROW)) {
      offenders.push(`${file} ${fn}: ${m[0].replace(/\s+/g, " ")}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a SQL function takes every column of a row. scan_teaser is security definer and ` +
      `granted to anon, so on that function this publishes ${COLUMN} to anybody holding a ` +
      "public token - the SQL spelling of the select(*) rule 1 refuses:\n  " +
      offenders.join("\n  "),
  );
});

test(`no live SQL function names ${COLUMN}`, () => {
  const offenders = [...liveSqlFunctions(ROOT)]
    .filter(([, { body }]) => new RegExp(`\\b${COLUMN}\\b`).test(body))
    .map(([fn, { file }]) => `${file} ${fn}`);

  assert.deepEqual(
    offenders,
    [],
    `a SQL function names ${COLUMN}. Filtering on it is legitimate and returning it is ` +
      "not, and the difference is not readable from the query text - so this fails either " +
      "way and wants a decision here, the way rule 3 does for a file that mentions it:\n  " +
      offenders.join("\n  "),
  );
});

/**
 * 8 Oct 2026, audit security-1 (critical): the same ILIKE defect this file's
 * header records as fixed in the unlock route was still live in three other
 * places - checkout signup made a buyer owner of whatever account an ILIKE on
 * their address matched, so an underscore could hand them a stranger's
 * clients. Every stored email is lowercased, so an address is matched with
 * .eq on its normalised form, never with a pattern.
 */
const ILIKE_ON_EMAIL = /\.ilike\(\s*["'`][a-z_]*email["'`]/;

test("no query matches an email column with ilike", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = sourceFiles(root);
  assert.ok(files.length > 200, `only ${files.length} source files walked`);
  assert.ok(files.some((f) => f.endsWith("lib/checkout/signup.ts")), "the walk cannot see signup.ts, the file this is about");
  const hits = files.filter((f) => ILIKE_ON_EMAIL.test(code(readFileSync(join(root, f), "utf8"))));
  assert.deepEqual(hits, [], "match an email with .eq on its lowercased form - ilike reads _ and % as wildcards");
});

test("the ilike probe still recognises the shape it bans", () => {
  for (const s of ['db.from("accounts").select("id").ilike("email", email)', "x.ilike('member_email', e)", "q.ilike(`report_email`, e)"]) assert.match(s, ILIKE_ON_EMAIL, s);
  assert.doesNotMatch('db.from("accounts").select("id").eq("email", email)', ILIKE_ON_EMAIL);
  assert.doesNotMatch('q.ilike("domain", d)', ILIKE_ON_EMAIL);
});
