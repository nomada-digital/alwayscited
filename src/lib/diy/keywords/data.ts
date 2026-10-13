import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import { FIXTURE_DIR, type DiyFixtureState, diyFixtureState, diyFixtureStore, diyFixtureWrites } from "../core/fixture.ts";
import { MAX_ATTEMPTS } from "../core/jobs.ts";
import { type Section, section } from "../plan/data.ts";

import { FOOTPRINT_COLUMNS, type Pull, latestTwo, readPull } from "./footprint.ts";
import { type TopHit, parseTop } from "./serp-competitors.ts";
import { urlAt } from "./tracked.ts";

/**
 * The keyword pages' reads (13 Oct 2026, DIY P6; spec 10 sections 3.3, 3.4
 * and 4.3): Supabase in production, `src/lib/diy/fixtures/keywords.json` on
 * the tracking fixture. Every read is one section: a failed read is logged as
 * `[diy] <section>: <message>` and comes back `{ ok: false }`, so the page
 * says it could not read that part, never that it is empty (section 3.4).
 *
 * The dark rule (section 4): while `diy_enabled` is off, the footprint, the
 * dismissals and the job are not read at all. Every section that exists only
 * because of the footprint's paid read is hidden, so nothing promises a read
 * that is not going to happen. The tracked keywords' own readings are ours
 * and free, and are read whatever the switch says.
 *
 * Every read is one client's (`.eq("client_domain_id", ...)`), or paged, as
 * fleet-reads.test.mts holds every read of a growing table to; the one
 * cross-client read - other clients' placements, to leave Nomada's inventory
 * out of every list (spec 2.3) - is paged and reads url keys only.
 *
 * Loadable by node --test: relative imports, the database handed in or
 * reached by a dynamic import only when none is.
 */

type Env = Record<string, string | undefined>;
export type Deps = { db?: () => SupabaseClient; env?: Env; root?: string };

/** The tracking fixture's client: the only one the DIY fixture files describe. */
export const FIXTURE_CLIENT = "fixture";

export type Dismissal = { key: string; until: Day; by: string; at: string };

/** How long a dismissal keeps a keyword out of gaining ground. Claude's to set (13 Oct 2026): a quarter, so a keyword still climbing then is offered again. */
export const DISMISS_DAYS = 90;

/** Whether a dismissal still holds on `today`. */
export const liveDismissal = (d: Pick<Dismissal, "until">, today: Day) => d.until >= today;

export type FootprintData = {
  /** `diy_enabled`, the fixture's state answering on the fixture. */
  enabled: boolean;
  /** Null while dark: hidden, not read. */
  pulls: Section<{ latest: Pull | null; previous: Pull | null }> | null;
  dismissals: Section<Dismissal[]> | null;
  /** The footprint job's newest row: its due day, whether it is still queued to run, and whether its latest run failed. */
  job: Section<FootprintJob> | null;
  /** The brand's aliases, for the brand rule; empty when unread. */
  aliases: string[];
};

export type FootprintJob = {
  dueOn: Day | null;
  /** Not done and under its attempts: a night pass will run it (jobs.ts claimable). */
  queued: boolean;
  failed: boolean;
};

/**
 * The day a pending first read can be promised (spec 10 section 4: "First read
 * <date>", from the job's due_on): only when a footprint job row is actually
 * queued - its due day, or tomorrow's night pass for one due today or carried.
 * Null when none is, and then nothing is promised: a client whose setup the
 * dispatcher does not count as confirmed (jobs.ts dueFor) has no paid job
 * queued, so its page must not say a read is coming (13 Oct 2026, review of
 * the P6 handoff).
 */
export function firstReadOn(job: FootprintJob | null, today: Day): Day | null {
  if (!job?.queued) return null;
  return job.dueOn !== null && job.dueOn > today ? job.dueOn : addDays(today, 1);
}

export type SerpDetail = {
  /** The ranking URL of each keyword on each day it ranked, keyed by `urlAt(keyword, day)`. */
  urls: Section<Map<string, string | null>>;
  /** Each keyword's latest stored top 20 on or before the window's end. */
  tops: Section<Map<string, { day: Day; top: TopHit[] }>>;
};

// ---- the fixture ----

type FixturePull = { pulled_on: Day; labs_date: Day | null; total_count: number | null; etv: number | null; rows: unknown };
export type KeywordsFixture = {
  pulls: FixturePull[];
  dismissals: { key: string; until: Day; by_email: string; created_at: string }[];
  /** The footprint job's rows; one with no outcome yet is still queued. */
  jobs: { due_on: Day; outcome: string | null }[];
  serp: {
    /** Per keyword, the URL it ranks with from each listed day on. */
    urls: Record<string, [Day, string][]>;
    /** Per keyword, two of the client's pages taking turns: the first on even days of the month, the second on odd. */
    turns: Record<string, [string, string]>;
    /** Per keyword, its top 20 at its latest reading. */
    top: Record<string, TopHit[]>;
  };
  /** Url keys of pages where Nomada has placed another client (made up, on the fixture's hosts). */
  othersPlaced: string[];
};

/** The state's entry of keywords.json over its `full` entry, key by key. */
export function keywordsFixture(env: Env = process.env, root: string = process.cwd()): KeywordsFixture {
  const state = diyFixtureState(env);
  if (state === null) throw new Error("the DIY fixture is read only with TRACKING_FIXTURE=1");
  const file = JSON.parse(readFileSync(join(root, FIXTURE_DIR, "keywords.json"), "utf8")) as { full: KeywordsFixture } & Partial<Record<DiyFixtureState, Partial<KeywordsFixture>>>;
  return { ...file.full, ...(file[state] ?? {}) };
}

/** The fixture's dismissals, held in memory once writes are on (TRACKING_FIXTURE_WRITE=1). */
export function dismissalStore(env: Env = process.env, root?: string) {
  return diyFixtureStore<Dismissal[]>("keywords", () => keywordsFixture(env, root).dismissals.map((d) => ({ key: d.key, until: d.until, by: d.by_email, at: d.created_at })));
}

function fixtureDismissals(env: Env, root?: string): Dismissal[] {
  return diyFixtureWrites(env) ? dismissalStore(env, root).get() : keywordsFixture(env, root).dismissals.map((d) => ({ key: d.key, until: d.until, by: d.by_email, at: d.created_at }));
}

async function admin(deps: Deps): Promise<SupabaseClient> {
  if (deps.db) return deps.db();
  return (await import("../../supabase/admin.ts")).supabaseAdmin();
}

// ---- the footprint ----

export async function loadFootprint(clientId: string, deps: Deps = {}): Promise<FootprintData> {
  const env = deps.env ?? process.env;
  const state = diyFixtureState(env);
  if (state !== null) {
    const enabled = state !== "dark";
    if (!enabled) return { enabled, pulls: null, dismissals: null, job: null, aliases: [] };
    const mine = clientId === FIXTURE_CLIENT;
    const fx = keywordsFixture(env, deps.root);
    const pulls = mine ? fx.pulls.map((p) => readPull(p)).filter((p): p is Pull => p !== null) : [];
    const job = mine ? [...fx.jobs].sort((a, b) => b.due_on.localeCompare(a.due_on))[0] : undefined;
    return {
      enabled,
      pulls: { ok: true, value: latestTwo(pulls) },
      dismissals: { ok: true, value: mine ? fixtureDismissals(env, deps.root) : [] },
      job: { ok: true, value: { dueOn: job?.due_on ?? null, queued: !!job && job.outcome === null, failed: job?.outcome === "failed" } },
      aliases: [],
    };
  }
  let db: SupabaseClient;
  try {
    db = await admin(deps);
  } catch (err) {
    console.warn(`[diy] keywords: ${err instanceof Error ? err.message : String(err)}`);
    return { enabled: false, pulls: null, dismissals: null, job: null, aliases: [] };
  }
  const { loadDiyEnabled } = await import("../core/settings.ts");
  const enabled = await loadDiyEnabled(db);
  if (!enabled) return { enabled, pulls: null, dismissals: null, job: null, aliases: [] };
  const [pulls, dismissals, job, aliases] = await Promise.all([
    section("google footprint", () => readPulls(db, clientId)),
    section("google dismissals", () => readDismissals(db, clientId)),
    section("google footprint job", () => readJob(db, clientId)),
    section("google aliases", () => readAliases(db, clientId)),
  ]);
  return { enabled, pulls, dismissals, job, aliases: aliases.ok ? aliases.value : [] };
}

export async function readPulls(db: SupabaseClient, clientId: string): Promise<{ latest: Pull | null; previous: Pull | null }> {
  const { data, error } = await db.from("keyword_footprints").select(FOOTPRINT_COLUMNS).eq("client_domain_id", clientId).order("pulled_on", { ascending: false }).limit(2);
  if (error) throw new Error(`could not read the footprint: ${error.message}`);
  return latestTwo(((data ?? []) as Record<string, unknown>[]).map(readPull).filter((p): p is Pull => p !== null));
}

/** Every gaining-keyword dismissal of one client, live or lapsed, newest first. A client's few hundred at most: bounded by the keywords Labs holds for it. */
export async function readDismissals(db: SupabaseClient, clientId: string): Promise<Dismissal[]> {
  const { data, error } = await db.from("diy_dismissals").select("key, until, by_email, created_at").eq("client_domain_id", clientId).eq("kind", "gaining_keyword").order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error(`could not read the dismissals: ${error.message}`);
  return ((data ?? []) as { key: string; until: string; by_email: string; created_at: string }[]).map((d) => ({ key: d.key, until: String(d.until).slice(0, 10), by: d.by_email, at: d.created_at }));
}

export async function readJob(db: SupabaseClient, clientId: string): Promise<FootprintJob> {
  const { data, error } = await db.from("diy_jobs").select("due_on, outcome, done_at, attempts").eq("client_domain_id", clientId).eq("kind", "footprint").order("due_on", { ascending: false }).limit(1);
  if (error) throw new Error(`could not read the footprint job: ${error.message}`);
  const row = (data?.[0] ?? null) as { due_on: string; outcome: string | null; done_at: string | null; attempts: number | null } | null;
  return {
    dueOn: row ? String(row.due_on).slice(0, 10) : null,
    queued: !!row && row.done_at === null && (row.attempts ?? 0) < MAX_ATTEMPTS,
    failed: row?.outcome === "failed",
  };
}

async function readAliases(db: SupabaseClient, clientId: string): Promise<string[]> {
  const { data, error } = await db.from("client_domains").select("brand_aliases").eq("id", clientId).maybeSingle();
  if (error) throw new Error(`could not read the brand's aliases: ${error.message}`);
  return (((data as { brand_aliases?: string[] | null } | null)?.brand_aliases ?? []) as string[]).filter(Boolean);
}

// ---- the tracked keywords' URLs and Google's top 20 ----

/** How far back from the window's end a stored top 20 is looked for: a live keyword is read every day. */
export const TOP_LOOKBACK_DAYS = 14;

export async function loadSerpDetail(clientId: string, window: { from: Day; to: Day }, positions: readonly { run_date: Day; keyword_id: string; position: number | null }[], deps: Deps = {}): Promise<SerpDetail> {
  const env = deps.env ?? process.env;
  if (diyFixtureState(env) !== null) {
    const fx = keywordsFixture(env, deps.root);
    const mine = clientId === FIXTURE_CLIENT;
    return { urls: { ok: true, value: mine ? fixtureUrls(fx, positions) : new Map() }, tops: { ok: true, value: mine ? fixtureTops(fx, positions, window.to) : new Map() } };
  }
  let db: SupabaseClient;
  try {
    db = await admin(deps);
  } catch (err) {
    console.warn(`[diy] google serp: ${err instanceof Error ? err.message : String(err)}`);
    return { urls: { ok: false }, tops: { ok: false } };
  }
  const [urls, tops] = await Promise.all([section("google urls", () => readUrls(db, clientId, window)), section("google top 10", () => readTops(db, clientId, window.to))]);
  return { urls, tops };
}

/**
 * The tracked keywords whose page 1 the Google page can open (13 Oct 2026,
 * Danny: the cluster slots' "See who ranks"): each with a stored top 20 on
 * a reading within TOP_LOOKBACK_DAYS of `to`, the window loadSerpDetail's
 * tops are read over, so the link lands on a row that has its page 1 to
 * show. Keyword ids only - no `top` is carried here. A failed read is logged
 * and answers none: the link is left out, never pointed at a page that
 * cannot show it.
 */
export async function loadWhoRanks(clientId: string, to: Day, positions: readonly { run_date: Day; keyword_id: string }[], deps: Deps = {}): Promise<ReadonlySet<string>> {
  const env = deps.env ?? process.env;
  if (diyFixtureState(env) !== null) return clientId === FIXTURE_CLIENT ? new Set(fixtureTops(keywordsFixture(env, deps.root), positions, to).keys()) : new Set();
  try {
    const db = await admin(deps);
    const rows = await selectAll<{ keyword_id: string }>((lo, hi) =>
      db.from("tracking_serp").select("keyword_id").eq("client_domain_id", clientId).gte("run_date", addDays(to, -TOP_LOOKBACK_DAYS)).lte("run_date", to).not("top", "is", null).order("id", { ascending: true }).range(lo, hi),
    );
    return new Set(rows.map((r) => r.keyword_id));
  } catch (err) {
    console.warn(`[diy] who ranks: ${err instanceof Error ? err.message : String(err)}`);
    return new Set();
  }
}

export async function readUrls(db: SupabaseClient, clientId: string, window: { from: Day; to: Day }): Promise<Map<string, string | null>> {
  const rows = await selectAll<{ run_date: string; keyword_id: string; url: string | null }>((from, to) =>
    db.from("tracking_serp").select("run_date, keyword_id, url").eq("client_domain_id", clientId).gte("run_date", window.from).lte("run_date", window.to).order("id", { ascending: true }).range(from, to),
  );
  return new Map(rows.map((r) => [urlAt(r.keyword_id, r.run_date), r.url]));
}

export async function readTops(db: SupabaseClient, clientId: string, to: Day): Promise<Map<string, { day: Day; top: TopHit[] }>> {
  const rows = await selectAll<{ run_date: string; keyword_id: string; top: unknown }>((lo, hi) =>
    db.from("tracking_serp").select("run_date, keyword_id, top").eq("client_domain_id", clientId).gte("run_date", addDays(to, -TOP_LOOKBACK_DAYS)).lte("run_date", to).order("id", { ascending: true }).range(lo, hi),
  );
  return latestTops(rows);
}

/** Each keyword's newest row with a stored top. A row from before MS-1 (no top) is passed over. */
export function latestTops(rows: readonly { run_date: Day; keyword_id: string; top: unknown }[]): Map<string, { day: Day; top: TopHit[] }> {
  const out = new Map<string, { day: Day; top: TopHit[] }>();
  for (const r of rows) {
    const top = parseTop(r.top);
    if (!top) continue;
    const had = out.get(r.keyword_id);
    if (!had || r.run_date > had.day) out.set(r.keyword_id, { day: r.run_date, top });
  }
  return out;
}

/** The fixture's URLs, laid over the tracking fixture's own readings: only a day it ranked has a URL. */
export function fixtureUrls(fx: KeywordsFixture, positions: readonly { run_date: Day; keyword_id: string; position: number | null }[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const s of positions) {
    if (s.position === null) continue;
    const turns = fx.serp.turns[s.keyword_id];
    if (turns) {
      out.set(urlAt(s.keyword_id, s.run_date), Number(s.run_date.slice(8, 10)) % 2 === 0 ? turns[0] : turns[1]);
      continue;
    }
    const segs = [...(fx.serp.urls[s.keyword_id] ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
    const at = [...segs].reverse().find(([from]) => from <= s.run_date);
    if (at) out.set(urlAt(s.keyword_id, s.run_date), at[1]);
  }
  return out;
}

/** The fixture's top 20 for each keyword, on its latest reading on or before `to`. */
export function fixtureTops(fx: KeywordsFixture, positions: readonly { run_date: Day; keyword_id: string }[], to: Day): Map<string, { day: Day; top: TopHit[] }> {
  const latest = new Map<string, Day>();
  for (const s of positions) if (s.run_date <= to && (latest.get(s.keyword_id) ?? "") < s.run_date) latest.set(s.keyword_id, s.run_date);
  const out = new Map<string, { day: Day; top: TopHit[] }>();
  for (const [kid, day] of latest) {
    const top = parseTop(fx.serp.top[kid]);
    if (top) out.set(kid, { day, top });
  }
  return out;
}

// ---- other clients' placements ----

/** The url keys of every page where Nomada has placed any other client, any status (spec 2.3): left out of every list here, with no label. */
export async function loadOthersPlaced(clientId: string, deps: Deps = {}): Promise<Section<Set<string>>> {
  const env = deps.env ?? process.env;
  if (diyFixtureState(env) !== null) return { ok: true, value: new Set(keywordsFixture(env, deps.root).othersPlaced) };
  return section("google other placements", async () => {
    const db = await admin(deps);
    const rows = await selectAll<{ url_key: string | null; url: string | null }>((from, to) => db.from("placements").select("url_key, url").neq("client_domain_id", clientId).order("id", { ascending: true }).range(from, to));
    return new Set(rows.map((r) => r.url_key || (r.url ? urlKey(r.url) : null)).filter((k): k is string => !!k));
  });
}

// ---- pursued pages (P7's table, read tolerantly) ----

/**
 * Opportunities in Pursuing or Pitched, counted by cluster, for the tracked
 * table's chip. P7's table: read tolerantly, so a deploy before its migration
 * (or a read that fails) draws no chip and logs once, never an error.
 */
export async function loadPursuing(clientId: string, deps: Deps = {}): Promise<Map<string, number>> {
  const env = deps.env ?? process.env;
  if (diyFixtureState(env) !== null) return new Map();
  try {
    const db = await admin(deps);
    const { data, error } = await db.from("opportunities").select("cluster_id").eq("client_domain_id", clientId).in("status", ["pursuing", "pitched"]).limit(1000);
    if (error) throw new Error(error.message);
    const out = new Map<string, number>();
    for (const r of (data ?? []) as { cluster_id: string | null }[]) if (r.cluster_id) out.set(r.cluster_id, (out.get(r.cluster_id) ?? 0) + 1);
    return out;
  } catch (err) {
    console.warn(`[diy] google pursuing: ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}
