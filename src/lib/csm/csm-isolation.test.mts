import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";

/**
 * Danny's hard rule (5 Nov 2026): Fatgrid data, prices, DR and relevance scores, and our placement costs never reach
 * the client view, the client API responses, or this public repo.
 *
 * Three facts hold it in code:
 * 1. The agency-only tables are the ones migration 20261106000000 marks AGENCY-ONLY, each with row level security on,
 *    no policy anywhere, and no grant to anon or authenticated - derived from the migrations, not typed here.
 * 2. A secret table's name is written only under src/lib/csm/ (the agency code), never anywhere else in src.
 * 3. Nothing a client can reach - the dashboards pages, their API routes, the dashboard libraries and components -
 *    imports src/lib/csm/, directly or through anything it imports. The walk follows every import, so routing around
 *    it through a shared module is caught too.
 */
const ROOT = resolve(new URL("../../..", import.meta.url).pathname);
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const CSM = join(SRC, "lib", "csm");
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(e) && !e.includes(".test.")) out.push(p);
  }
  return out;
}

const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));
const batchA = readFileSync(join(MIGRATIONS, "20261106000000_csm_batch_a.sql"), "utf8");

/** Every table the batch marks AGENCY-ONLY: the comment line, then its create table. */
const AGENCY_TABLES = [...batchA.matchAll(/-- AGENCY-ONLY[^\n]*\n(?:--[^\n]*\n)*create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]!);
/** The ones that hold Fatgrid data or our costs: never named outside src/lib/csm. */
const SECRET_TABLES = ["fatgrid_listings", "shortlist_runs", "shortlist_items", "placement_budgets", "placement_budget_overrides", "placement_spend"];

test("the agency-only tables are locked: row level security on, no policy, no grant to the browser roles", () => {
  assert.ok(AGENCY_TABLES.length >= 9, `found ${AGENCY_TABLES.length} AGENCY-ONLY tables`);
  for (const t of SECRET_TABLES) assert.ok(AGENCY_TABLES.includes(t), `${t} is not marked AGENCY-ONLY`);
  const revoked = batchA.slice(batchA.indexOf("revoke all on table"));
  for (const t of AGENCY_TABLES) {
    assert.match(batchA, new RegExp(`alter table public\\.${t} enable row level security;`), `${t}: row level security`);
    assert.ok(!migrations.some((m) => new RegExp(`create policy[^;]*\\bon\\s+(public\\.)?${t}\\b`, "i").test(m)), `${t} has a policy`);
    assert.match(revoked, new RegExp(`public\\.${t}\\b`), `${t}: not revoked from anon and authenticated`);
  }
});

test("a secret table is named only in the agency code", () => {
  const hits: string[] = [];
  for (const f of walk(SRC)) {
    if (f.startsWith(CSM + sep)) continue;
    const src = readFileSync(f, "utf8");
    for (const t of SECRET_TABLES) if (new RegExp(`["'\`]${t}["'\`]`).test(src)) hits.push(`${rel(f)}: ${t}`);
  }
  assert.deepEqual(hits, []);
});

/** The modules a file imports, resolved to files under src (alias `@/` and relative), extension or index optional. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2]!;
    const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
    if (!base) continue;
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((p) => existsSync(p) && statSync(p).isFile());
    if (hit) out.push(hit);
  }
  return out;
}

const CLIENT_ROOTS = ["app/dashboards", "app/api/dash", "app/api/app", "lib/dash", "components/dash"].map((d) => join(SRC, d)).filter(existsSync);

test("nothing a client can reach imports the agency code, however indirectly", () => {
  const entries = CLIENT_ROOTS.flatMap((d) => walk(d));
  assert.ok(entries.length >= 40, `the client walk found ${entries.length} files`);
  const seen = new Set<string>();
  const from = new Map<string, string>();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const i of importsOf(f)) if (!seen.has(i)) { from.set(i, f); queue.push(i); }
  }
  const reached = [...seen].filter((f) => f.startsWith(CSM + sep));
  const chain = (f: string) => { const c = [rel(f)]; let p = from.get(f); while (p) { c.unshift(rel(p)); p = from.get(p); } return c.join(" -> "); };
  assert.deepEqual(reached.map(chain), [], "a client surface reaches src/lib/csm");
  // The walk does reach shared code, so a clean result is a real one.
  assert.ok([...seen].some((f) => rel(f) === "src/lib/supabase/admin.ts"), "the import walk no longer follows imports");
});
