import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Every `onConflict` names a column set some migration actually declares
 * unique - and every upsert names one at all.
 *
 * **Nothing connects the two ends.** `onConflict` is a string in TypeScript
 * and the constraint is DDL in a `.sql` file; no type, no import and no build
 * step reads both. Renaming a column, adding a fifth column to a composite
 * key, or writing an upsert against a table whose unique index was never
 * created all pass `tsc`, pass the build, pass every other test and deploy.
 * Same shape as `route-callers.test.mts`, where the path between a fetch and
 * the route answering it is built by concatenation.
 *
 * **What it costs when it is wrong.** Postgres answers an unmatched
 * `on conflict` with *there is no unique or exclusion constraint matching the
 * ON CONFLICT specification* - it does not insert, it raises. In
 * `sources.ts` that raise happens on the last line, *after* the model calls
 * have been made and billed, and `pipeline.ts` wraps that call in
 * never-fatal. So the failure mode is: the scan pays Anthropic for every
 * source classification, throws the results away, logs one swallowed line,
 * and ships a report with nothing sorted. That is the silent-failure species
 * this repo keeps finding, with a bill attached.
 *
 * All four sites are correct today. This test exists so that stays a fact
 * rather than a coincidence, and it is written to fail loudly if it ever
 * stops being able to see - a sweep that quietly finds zero upserts is the
 * blind-tripwire recipe, so the denominators are asserted first.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SRC = path.join(ROOT, "src");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** Strips `-- line comments`, which otherwise put stray `unique` in the parse. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** Splits on commas that sit at paren depth zero: `numeric(10,5)` is one item. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean);
}

/** Reads the balanced parenthesised body that starts at `open`. */
function balanced(sql: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return { body: sql.slice(open + 1, i), end: i };
    }
  }
  throw new Error("unbalanced parentheses in a migration");
}

const key = (cols: string[]) => [...cols].map((c) => c.trim().toLowerCase()).sort().join(",");

/** Every unique column set the migrations declare, by table. */
function declaredUnique(): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  const add = (table: string, cols: string[]) => {
    const set = byTable.get(table) ?? new Set<string>();
    set.add(key(cols));
    byTable.set(table, set);
  };

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = stripSqlComments(readFileSync(path.join(MIGRATIONS, file), "utf8"));

    // create table [if not exists] <name> ( ... )
    const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_0-9.]+)\s*\(/gi;
    for (const m of sql.matchAll(tableRe)) {
      const table = m[1].replace(/^public\./, "");
      const { body } = balanced(sql, m.index + m[0].length - 1);
      for (const item of topLevelItems(body)) {
        // A table-level `primary key (a, b)` is a unique key too (9 Oct 2026, AG-1:
        // dashboard_member_clients is keyed on the pair). Before this it was read as a
        // column named "primary", which no upsert names.
        const constraint = /^(?:constraint\s+[a-z_0-9]+\s+)?(?:unique|primary\s+key)\s*\(([^)]*)\)/i.exec(item);
        if (constraint) {
          add(table, constraint[1].split(","));
          continue;
        }
        // A column definition: `<col> <type> ... unique ...` or `primary key`.
        const col = /^([a-z_][a-z_0-9]*)\s/i.exec(item);
        if (!col) continue;
        if (/\bprimary\s+key\b/i.test(item) || /\bunique\b/i.test(item)) add(table, [col[1]]);
      }
    }

    // create unique index [if not exists] <name> on <table> ( ... )
    const indexRe =
      /create\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[a-z_0-9]*\s*on\s+([a-z_0-9.]+)\s*\(/gi;
    for (const m of sql.matchAll(indexRe)) {
      const table = m[1].replace(/^public\./, "");
      const { body } = balanced(sql, m.index + m[0].length - 1);
      add(table, topLevelItems(body));
    }

    // alter table <t> add [constraint <c>] unique (cols)
    const alterRe =
      /alter\s+table\s+(?:if\s+exists\s+)?([a-z_0-9.]+)\s+add\s+(?:constraint\s+[a-z_0-9]+\s+)?unique\s*\(/gi;
    for (const m of sql.matchAll(alterRe)) {
      const table = m[1].replace(/^public\./, "");
      const { body } = balanced(sql, m.index + m[0].length - 1);
      add(table, topLevelItems(body));
    }
  }
  return byTable;
}

/** Every `.upsert(` in the tree, with the table it runs against. */
function upsertSites(): { file: string; line: number; table: string; onConflict: string | null }[] {
  const out: { file: string; line: number; table: string; onConflict: string | null }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts)$/.test(entry.name) || entry.name.includes(".test.")) continue;
      const text = readFileSync(full, "utf8");
      if (!text.includes(".upsert(")) continue;

      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes(".upsert(")) continue;

        /**
         * The table is the nearest preceding `.from("...")`. Walking backwards
         * rather than matching on one line because supabase-js chains across
         * lines: `unlock.ts` puts `.from(...)` and `.upsert(` on separate
         * lines with a `const` between them.
         */
        let table: string | null = null;
        for (let j = i; j >= 0 && j > i - 12; j -= 1) {
          const from = /\.from\("([a-z_0-9]+)"\)/.exec(lines[j]);
          if (from) {
            table = from[1];
            break;
          }
        }
        assert.ok(
          table,
          `${path.relative(ROOT, full)}:${i + 1} - could not find the table for this upsert. ` +
            `The sweep resolves it from the nearest preceding .from("..."); if the call shape ` +
            `changed, fix the sweep rather than letting it skip the site.`,
        );

        // The options object can be on the same line or a few below it.
        const window = lines.slice(i, i + 25).join("\n");
        const oc = /onConflict:\s*"([^"]*)"/.exec(window);
        out.push({
          file: path.relative(ROOT, full),
          line: i + 1,
          table,
          onConflict: oc ? oc[1] : null,
        });
      }
    }
  };
  walk(SRC);
  return out;
}

const unique = declaredUnique();
const sites = upsertSites();

test("the sweep can see both ends", () => {
  /**
   * The denominator, asserted before anything is judged. A sweep that finds
   * no upserts, or no constraints, passes every assertion below it while
   * checking nothing - four of this repo's own tripwires have failed exactly
   * that way.
   */
  assert.ok(sites.length >= 4, `expected at least 4 upsert sites, found ${sites.length}`);
  assert.ok(unique.size >= 5, `expected unique constraints on at least 5 tables, found ${unique.size}`);
  // Known-good spot checks, so a parser that returns plausible rubbish fails here.
  assert.ok(unique.get("scan_sources")?.has("domain,scan_id"), "scan_sources (scan_id, domain)");
  assert.ok(unique.get("scan_answers")?.has("engine,question_id"), "scan_answers (question_id, engine)");
  // A table-level primary key (9 Oct 2026), the shape the column walk used to misread.
  assert.ok(unique.get("dashboard_member_clients")?.has("client_domain_id,member_id"), "dashboard_member_clients primary key (member_id, client_domain_id)");
});

test("every upsert names an onConflict", () => {
  /**
   * The other direction, and the one with no error message at all. Without
   * `onConflict` supabase-js conflicts on the primary key, and every table
   * here has a `gen_random_uuid()` id - so a re-run never collides, the
   * upsert silently inserts a duplicate row, and the second pass doubles the
   * data instead of updating it. Nothing raises. This is the same failure
   * the inbox records for `scan_citations`, which has no unique constraint
   * and so must be keyed on read.
   */
  for (const s of sites) {
    assert.ok(
      s.onConflict,
      `${s.file}:${s.line} upserts into ${s.table} with no onConflict - it will conflict on the ` +
        `uuid primary key, which never collides, and insert a duplicate row instead of updating.`,
    );
  }
});

test("every onConflict is backed by a unique constraint on that table", () => {
  for (const s of sites) {
    if (!s.onConflict) continue;
    const declared = unique.get(s.table);
    assert.ok(declared, `${s.file}:${s.line} upserts into ${s.table}, which no migration creates`);
    const wanted = key(s.onConflict.split(","));
    assert.ok(
      declared.has(wanted),
      `${s.file}:${s.line} upserts into ${s.table} on conflict (${s.onConflict}), which no ` +
        `migration declares unique. Postgres raises "there is no unique or exclusion constraint ` +
        `matching the ON CONFLICT specification" - it does not insert. Declared on ${s.table}: ` +
        `${[...declared].join(" | ")}`,
    );
  }
});

test("the upsert sites are the ones we think they are", () => {
  /**
   * Pinned so that a new upsert is a deliberate edit here rather than an
   * addition nobody notices. The checks above already cover a new one; this
   * is about a reviewer seeing it.
   *
   * Compared as a sorted column *set*, not as the written string. Postgres
   * infers the arbiter index from the set, so `scan_id,engine,brand` and
   * `brand,scan_id,engine` are the same instruction - and a pin that failed
   * on the reorder would be asserting a difference the database does not
   * make. The injection harness records that case as a no-op for the same
   * reason.
   */
  assert.deepEqual(
    sites.map((s) => `${s.table}:${key((s.onConflict ?? "").split(","))}`).sort(),
    [
      // 13 Oct 2026, DIY P10 (spec 10 sections 5.8 and 6.3): the Backlinks jobs
      // store one read per client, kind and night on backlink_reads' unique
      // (client_domain_id, kind, read_on) in 20261014210000_links.sql, so the
      // worker's stale reclaim running a job twice writes one row
      // (links/write.ts writeLinkRead). Sorts first.
      "backlink_reads:client_domain_id,kind,read_on",
      // 29 Sep 2026, T2 /admin/tracking: a client from a scan on client_domains'
      // original unique key (scan_phase1), and a member on dashboard_members'
      // (account_id, email) - once as the owner at create, once from the form.
      // 30 Sep 2026, BRIEF-3 C4: the second of each is the Stripe webhook's
      // signup (checkout/signup.ts), the client and its owner on T2's keys.
      "client_domains:account_id,domain,market,topic",
      "client_domains:account_id,domain,market,topic",
      // 13 Oct 2026, DIY P10 (spec 10 section 6.3): the month's comparison set,
      // one per client and month on comparison_sets' primary key in
      // 20261014210000_links.sql (links/write.ts writeSet).
      "comparison_sets:client_domain_id,month",
      // 9 Oct 2026, AG-1: a member limited to one more client, or a removed scope row
      // brought back (scope.ts addScope), on the table's primary key in
      // 20261009010000_member_clients.sql. Sorts ahead of dashboard_members.
      "dashboard_member_clients:client_domain_id,member_id",
      "dashboard_members:account_id,email",
      "dashboard_members:account_id,email",
      "dashboard_members:account_id,email",
      // 1 Oct 2026, R142 part 2: an owner's invite on Settings (team.ts invite),
      // the same key, clearing removed_at so a removed member comes back on their row.
      // 9 Oct 2026 (AG-1): one site still - team.ts writeMember, called not yet live and then live.
      "dashboard_members:account_id,email",
      // 13 Oct 2026, DIY P6 (spec 10 sections 3.6 and 4.3): gaining ground's
      // Dismiss writes one dismissal per client, kind and keyword on
      // diy_dismissals' primary key in 20261014010000_footprint.sql, again
      // on a second dismiss so the newest is the one a toast's Undo restores
      // (keywords/write.ts writeDismissal).
      "diy_dismissals:client_domain_id,key,kind",
      // 13 Oct 2026, DIY P1 (spec 10 section 5.7), each on its own key in
      // 20261013000000_diy_core.sql and each ignoring a duplicate: the night
      // dispatch and setup's enqueueOnboarding queue one diy_jobs row per
      // client, kind and due day (upsertJobs, one site); the worker queues a
      // deferred job again for tomorrow; and the dispatcher stores the two
      // free vendor reads once per kind a UTC day.
      "diy_jobs:client_domain_id,due_on,kind",
      "diy_jobs:client_domain_id,due_on,kind",
      "diy_vendor_status:kind,read_on",
      // 13 Oct 2026, DIY P6 (spec 10 sections 5.8 and 6.6): the footprint job
      // stores one pull per client per day on keyword_footprints' unique
      // (client_domain_id, pulled_on), so the worker's stale reclaim running
      // it twice writes one row (keywords/footprint.job.ts).
      // 17 Oct 2026: an integration request on the dashboards host, one row per client and provider (20261017000000).
      "integration_connections:client_domain_id,provider",
      "keyword_footprints:client_domain_id,pulled_on",
      // 17 Oct 2026: keyword research's shared 30-day cache (lib/dash/research.ts), one row per market, kind, seed and day.
      "keyword_research:kind,market,read_on,seed",
      // 22 Oct 2026: a map pack grid's weekly read, one row per grid, day and point on local_grid_points'
      // unique (grid_id, run_date, row_idx, col_idx) in 20261022010000_local_grids.sql (lib/local/run.ts).
      "local_grid_points:col_idx,grid_id,row_idx,run_date",
      // 30 Sep 2026, R91: the Stripe webhook's one orders row per completed
      // Session (checkout/signup.ts writeOrder), on the unique column in
      // 20260930020000_orders.sql, so a replayed event writes nothing.
      "orders:stripe_session_id",
      // 22 Oct 2026: the agency hub's subscription offer writes its order the same way, on the same unique column
      // (checkout/hub-offer.ts onHubOfferCompleted), so a replayed event writes nothing.
      "orders:stripe_session_id",
      // 13 Oct 2026, DIY P7 (spec 10 section 6.2): a page's latest read replaces the one before
      // (opportunities/record.ts writePageRead), on page_reads' unique (client_domain_id, url_key)
      // in 20261014070000_opportunities.sql.
      "page_reads:client_domain_id,url_key",
        "scan_answers:engine,question_id",
      "scan_brands:brand,engine,scan_id",
      "scan_sources:domain,scan_id",
      // 25 Sep 2026: difficulty.ts writes each placeable source's difficulty
      // score back onto its own row, on the same (scan_id, domain) index.
      "scan_sources:domain,scan_id",
      // 29 Sep 2026, the daily tracking runner (T1), each on its own unique
      // constraint in 20260929000000_tracking_dashboard.sql: one run per client
      // per day, one answer per run, question and engine, one SERP per keyword.
      // The second tracking_runs site is T2's "Run now", same key.
      "tracking_answers:engine,question_id,run_id",
      // 17 Oct 2026: an extra tracking pack's subscription, recorded and updated by the webhook (lib/checkout/packs.ts).
      "tracking_packs:stripe_subscription_id",
      "tracking_runs:client_domain_id,run_date",
      "tracking_runs:client_domain_id,run_date",
      "tracking_serp:keyword_id,run_id",
      // 24 Sep 2026: one walkthrough request per scan, address and kind.
      "walkthrough_requests:email,kind,scan_id",
    ],
  );
});
