import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { blankComments, sourceFiles } from "../source-read.mts";

/**
 * No read of a tracking table across every client is left to one page.
 *
 * The tracking tables are the seven in TABLES, and since 13 Oct 2026 (DIY P5) the four DIY tables beside them. The first version (9 Oct
 * 2026) walked five and said "a tracking table"; tracked_clusters and
 * tracking_notes grow with the fleet the same way, and /admin/tracking read
 * every client's clusters in one select (review of 348abbd, 9 Oct 2026).
 *
 * PostgREST answers a select with at most db-max-rows rows - 1000 on a
 * default project - and says so nowhere (page.ts). The tracking tables grow
 * with every client and every day, and on 9 Oct 2026 (audit reliability-2)
 * two reads took them whole: the daily dispatch read every unstopped prompt
 * of every client in one select to decide who to run, and /admin/tracking read
 * every client's prompts, keywords and runs the same way. Past a thousand
 * rows, clients beyond the cut counted no live prompt, were skipped and got
 * no run, and the admin counts went wrong with them - nothing errored. Both
 * are paged now; this keeps the next one from arriving unpaged.
 *
 * A select of one of these tables must be bounded by what it reads, in one of
 * five ways, each read off its own chain:
 *
 * - **paged** - `.range(`, as `selectAll` and every paged read here call it;
 * - **counted** - `head: true`, which returns no rows;
 * - **limited** - `.limit(`, `.single()` or `.maybeSingle()`;
 * - **one client, run, cluster, prompt, keyword or row** - `.eq(` on
 *   client_domain_id, run_id, cluster_id, question_id, keyword_id or id. A
 *   prompt or keyword is one client's, a client's rows are bounded by its
 *   allowance (limits.ts) and a day's by its prompts and engines, so these
 *   are not the read that grows with the fleet. `.in("client_domain_id", ...)`
 *   is not one of them: it is every client named;
 * - or written down in FLEET_UNPAGED with why it is safe. It is empty.
 *
 * What this cannot see: a table named by a variable (limits.ts `liveCount`
 * takes it as an argument, and counts with head: true), and a builder handed
 * on before its select (overview-data.ts passes `db.from("tracking_answers")`
 * to read-shape.ts: to readAnswers, which pages it, and since DB-2 on 9 Oct
 * 2026 to readAnswerDay, the one-cluster answers panel's read, which is held
 * to one client, one prompt and one day rather than paged, and which
 * read-shape.test.mts runs on a fake PostgREST holding two clients' rows).
 * Neither is a select on the chain it is found on, so neither is counted, and
 * the floor below is what notices this walk going blind.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

/**
 * 13 Oct 2026, DIY P5 (spec 10 section 7.6): the DIY wave 1 tables join - diy_reads (the paid-read ledger),
 * diy_jobs (the night's queue), diy_vendor_status (two rows a night, no client data, but it grows a row pair a
 * day like the rest) and plan_items. Each grows with every client and every day as the tracking tables do.
 */
/**
 * 13 Oct 2026, DIY P9 (spec 10 sections 5.8 and 7.10): the wave 2 tables join, each growing with every client as
 * the rest do - P6's keyword_footprints (a pull a week) and diy_dismissals; P7's opportunities, page_reads and
 * source_kinds (a global cache of page and domain types, keyed by URL, which grows with every client's citations);
 * P8's key_pages, page_checks, bot_checks, reopt_examples and top_structures.
 */
/**
 * 13 Oct 2026, DIY P10 (spec 10 sections 5.8 and 7.11): the wave 3 tables join, each growing with every client -
 * backlink_reads (a read per kind per night run), comparison_sets (a row a month) and link_checks (a row a check).
 */
const TABLES = [
  "tracked_questions", "tracked_keywords", "tracked_clusters", "tracking_runs", "tracking_answers", "tracking_serp", "tracking_notes",
  "diy_reads", "diy_jobs", "diy_vendor_status", "plan_items",
  "keyword_footprints", "diy_dismissals",
  "opportunities", "page_reads", "source_kinds",
  "key_pages", "page_checks", "bot_checks", "reopt_examples", "top_structures",
  "backlink_reads", "comparison_sets", "link_checks",
];

/** Reads across every client that may take one page, and why. Empty: a new entry is an argument, not a fix. */
const FLEET_UNPAGED: Record<string, string> = {};

/**
 * The chain a `.from(` starts, to its end: the `;` or `,` that ends its
 * statement or argument, or the bracket that closes what it sits in. Strings
 * are skipped whole, because a select of `client_domains(tier, slug)` holds
 * brackets that are not the code's.
 */
export function chainAt(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) return src.slice(start, i);
      depth--;
    } else if ((ch === ";" || ch === ",") && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

export type Read = { at: string; table: string; bound: "paged" | "counted" | "limited" | "scoped" | null };

/** Every select of a tracking table in one file's code, and what bounds it. Writes are not reads. */
export function readsIn(file: string, src: string): Read[] {
  const out: Read[] = [];
  for (const m of src.matchAll(/\.from\(\s*"(\w+)"\s*\)/g)) {
    if (!TABLES.includes(m[1]!)) continue;
    const chain = chainAt(src, m.index!);
    if (!/\.select\(/.test(chain) || /\.(insert|update|upsert|delete)\(/.test(chain)) continue;
    const bound = /\.range\(/.test(chain)
      ? "paged"
      : /head:\s*true/.test(chain)
        ? "counted"
        : /\.(limit\(|single\(\)|maybeSingle\(\))/.test(chain)
          ? "limited"
          : /\.eq\(\s*"(client_domain_id|run_id|cluster_id|question_id|keyword_id|id)"/.test(chain)
            ? "scoped"
            : null;
    out.push({ at: `${file}:${src.slice(0, m.index).split("\n").length}`, table: m[1]!, bound });
  }
  return out;
}

const READS = sourceFiles(ROOT).flatMap((f) => readsIn(f, blankComments(readFileSync(join(ROOT, f), "utf8"))));

test("the probe reads a chain to its end, and classifies the shapes that are wrong", () => {
  const unpaged = 'const { data } = await db.from("tracked_questions").select("client_domain_id, added_on").is("stopped_on", null);';
  assert.deepEqual(readsIn("f.ts", unpaged), [{ at: "f.ts:1", table: "tracked_questions", bound: null }], "the dispatch's old read");
  assert.equal(readsIn("f.ts", 'db.from("tracking_runs").select("x").in("client_domain_id", ids).gte("run_date", d).order("run_date")')[0]!.bound, null, "every client named is not one client");
  assert.equal(readsIn("f.ts", 'selectAll((a, b) => db.from("tracked_questions").select("x").is("stopped_on", null).order("id").range(a, b))')[0]!.bound, "paged");
  assert.equal(readsIn("f.ts", 'db.from("tracking_runs").select("id", { count: "exact", head: true }).in("status", s)')[0]!.bound, "counted");
  assert.equal(readsIn("f.ts", 'db.from("tracking_answers").select("x").eq("client_domain_id", c).eq("question_id", q)')[0]!.bound, "scoped");
  // limits.ts linkKeyword: the live clusters holding one keyword, which is one client's.
  assert.equal(readsIn("f.ts", 'db.from("tracked_clusters").select("id").eq("keyword_id", k).is("stopped_on", null)')[0]!.bound, "scoped");
  // /admin/tracking's clusters before the review of 348abbd.
  assert.equal(readsIn("f.ts", 'db.from("tracked_clusters").select("id").in("client_domain_id", ids).is("stopped_on", null).order("created_at", { ascending: true })')[0]!.bound, null);
  // A chain ends where its statement or argument does, so a sibling's .range() does not page it.
  const two = 'Promise.all([db.from("tracked_keywords").select("x").in("client_domain_id", ids), db.from("tracking_serp").select("y").eq("run_id", r).range(0, 9)])';
  assert.deepEqual(readsIn("f.ts", two).map((r) => r.bound), [null, "paged"]);
  // Brackets inside a select string are not the code's.
  assert.equal(readsIn("f.ts", 'db.from("tracking_runs").select("id, client_domains(tier, slug)").in("x", y).order("id")')[0]!.bound, null);
  assert.deepEqual(readsIn("f.ts", 'db.from("tracking_runs").update({ status: "x" }).eq("id", i).select("id")'), [], "a write returning its row is not a read");
  assert.deepEqual(readsIn("f.ts", 'db.from("placements").select("x")'), [], "only the tracking tables");
});

test("the walk found the reads, so a clean sweep is not a blind one", () => {
  // 9 Oct 2026: 40 selects of the five tables across the tree, 14 of them paged. Later that day
  // (review of 348abbd), with tracked_clusters and tracking_notes walked too: 60 selects, 17 paged.
  // Raised 13 Oct 2026 (DIY P9, wave 2 merged): 140 selects across the 21 tables, 39 of them paged, measured on the
  // merged tree; and every wave 2 table has a select the walk sees, so a renamed table is not a clean sweep.
  // Raised 13 Oct 2026 (DIY P10, wave 3): 152 selects across the 24 tables, 41 of them paged, measured with Links'
  // readers and jobs.
  assert.ok(READS.length >= 152, `only ${READS.length} tracking-table selects found - the walk has drifted`);
  assert.ok(READS.filter((r) => r.bound === "paged").length >= 41, "the paged reads are not being seen");
  // 13 Oct 2026, DIY P10: and every wave 3 table, likewise.
  for (const t of ["keyword_footprints", "diy_dismissals", "opportunities", "page_reads", "source_kinds", "key_pages", "page_checks", "bot_checks", "reopt_examples", "top_structures", "backlink_reads", "comparison_sets", "link_checks"]) {
    assert.ok(READS.some((r) => r.table === t), `${t} has no select the walk can see`);
  }
  assert.ok(READS.filter((r) => r.table === "tracked_clusters").length >= 12, "the cluster reads are not being seen");
  for (const at of ["src/lib/tracking/run-health.ts", "src/app/admin/tracking/page.tsx", "src/lib/tracking/runner.ts"]) {
    assert.ok(READS.some((r) => r.at.startsWith(`${at}:`)), `${at} has no tracking read the walk can see`);
  }
});

test("no select of a tracking table reads every client's rows in one page", () => {
  const fleet = READS.filter((r) => r.bound === null).map((r) => `${r.at} ${r.table}`);
  const unexplained = fleet.filter((f) => !Object.hasOwn(FLEET_UNPAGED, f.split(" ")[0]!));
  assert.deepEqual(
    unexplained,
    [],
    "these read a tracking table across clients with no range, so PostgREST's thousand-row ceiling cuts them " +
      "silently. Page them (supabase/page.ts selectAll), scope them to one client or run, or say here why not.",
  );
  for (const at of Object.keys(FLEET_UNPAGED)) assert.ok(fleet.some((f) => f.startsWith(`${at} `)), `${at} is excused and no longer an unpaged read`);
});
