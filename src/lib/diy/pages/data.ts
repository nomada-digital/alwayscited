import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { diyFixtureState, diyFixtureStore, diyFixtureWrites, readDiyFixture } from "../core/fixture.ts";
import type { SchemaFound, SchemaResults } from "./own-parse.ts";
import { KEY_PAGE_COLUMNS, keyPageOf } from "./key-pages.ts";
import type { Basics, BotCheck, CrawlerVerdict, JobState, KeyPage, KeywordSerp, PageCheck, ReoptExample, SerpReading, TopResult, TopStructure } from "./types.ts";

/**
 * Your pages' reads (13 Oct 2026, DIY P8): Supabase through `db`, or the DIY
 * fixture (`src/lib/diy/fixtures/pages.json`, by DIY_FIXTURE_STATE) when the
 * tracking fixture is on, with the route's writes held in memory beside it
 * (TRACKING_FIXTURE_WRITE=1). Every read is held to one client, and each
 * looks at its own error and throws: the page runs each as a section, so a
 * failed read says so and never reads as empty (spec 10 section 3.4).
 *
 * P7's opportunity count, for the fit copy's "(Opportunities, 6 found)", is
 * read through `OPPORTUNITY_COUNT`. P7 builds its tolerant count reader in
 * parallel with this package, so until the shell (P9) points this one line
 * at it the count is null and the copy reads "(see Opportunities)" - which is
 * what the reader itself answers while the opportunities table is absent.
 */

type Env = Record<string, string | undefined>;

/** How many lists-lens opportunities a cluster has, or null when that cannot be read. P9 wires P7's tolerant reader here. */
export type OpportunityCountReader = (db: SupabaseClient | null, clientId: string, clusterId: string) => Promise<number | null>;
export const OPPORTUNITY_COUNT: OpportunityCountReader = async () => null;

/** The night jobs this package registers (through the shell): the weekly own reads and the monthly paid ones. */
export const WEEKLY_KIND = "key_pages_weekly";
export const MONTHLY_KIND = "key_pages_monthly";

export const CHECK_COLUMNS = "id, key_page_id, url, url_key, checked_at, via, trigger, status, http_status, final_url, basics, fix, schema_found, schema_results, content_hash, word_count, rendered_word_count";
export const BOT_COLUMNS = "id, checked_at, robots_status, robots, llms_txt_status, pages";
export const EXAMPLE_COLUMNS = "id, cluster_id, url, url_key, status, requested_by, requested_at, finished_at, inputs, example, guard_hits, error";
export const TOP_COLUMNS = "cluster_id, keyword_id, read_on, rank, url, url_key, status, title, h1, headings, date_shown, word_count";

/** How far back the page reads checks, and how many: ten pages read weekly, plus the monthly and on-demand reads. */
export const CHECK_DAYS = 120;
export const CHECK_LIMIT = 400;
/** The keyword readings fit reads: its last 28, so twice that in days covers missed days. */
export const SERP_DAYS = 60;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function checkOf(r: Record<string, unknown>): PageCheck | null {
  if ((typeof r.id !== "string" && typeof r.id !== "number") || typeof r.url !== "string" || typeof r.url_key !== "string" || typeof r.checked_at !== "string") return null;
  const via = r.via === "instant_pages" ? "instant_pages" : r.via === "own" ? "own" : null;
  const trigger = r.trigger === "on_demand" || r.trigger === "onboarding" || r.trigger === "scheduled" ? r.trigger : null;
  const status = r.status === "ok" || r.status === "unreadable" ? r.status : null;
  if (!via || !trigger || !status) return null;
  return {
    id: String(r.id),
    keyPageId: r.key_page_id == null ? null : String(r.key_page_id),
    url: r.url,
    urlKey: r.url_key,
    checkedAt: r.checked_at,
    via,
    trigger,
    status,
    httpStatus: num(r.http_status),
    finalUrl: str(r.final_url),
    basics: (obj(r.basics) as Basics | null) ?? null,
    fix: Array.isArray(r.fix) ? (r.fix as PageCheck["fix"]) : null,
    schemaFound: (obj(r.schema_found) as SchemaFound | null) ?? null,
    schemaResults: (obj(r.schema_results) as SchemaResults | null) ?? null,
    contentHash: str(r.content_hash),
    wordCount: num(r.word_count),
    renderedWordCount: num(r.rendered_word_count),
  };
}

export function botOf(r: Record<string, unknown>): BotCheck | null {
  if ((typeof r.id !== "string" && typeof r.id !== "number") || typeof r.checked_at !== "string") return null;
  const robots = obj(r.robots);
  return {
    id: String(r.id),
    checkedAt: r.checked_at,
    robotsStatus: num(r.robots_status),
    crawlers: Array.isArray(robots?.crawlers) ? (robots!.crawlers as CrawlerVerdict[]) : [],
    llmsTxtStatus: num(r.llms_txt_status),
    pages: Array.isArray(r.pages) ? (r.pages as BotCheck["pages"]) : [],
  };
}

export function exampleOf(r: Record<string, unknown>): ReoptExample | null {
  if ((typeof r.id !== "string" && typeof r.id !== "number") || typeof r.url !== "string" || typeof r.requested_at !== "string") return null;
  const status = r.status === "pending" || r.status === "ready" || r.status === "failed" ? r.status : null;
  if (!status) return null;
  const inputs = obj(r.inputs);
  const now = obj(inputs?.now);
  return {
    id: String(r.id),
    clusterId: r.cluster_id == null ? null : String(r.cluster_id),
    url: r.url,
    urlKey: String(r.url_key ?? ""),
    status,
    requestedBy: String(r.requested_by ?? ""),
    requestedAt: r.requested_at,
    finishedAt: str(r.finished_at),
    example: (obj(r.example) as ReoptExample["example"]) ?? null,
    now: now ? { title: str(now.title), h1: str(now.h1), opening: str(now.opening) } : null,
    guardHits: Array.isArray(r.guard_hits) ? (r.guard_hits as ReoptExample["guardHits"]) : [],
    error: str(r.error),
  };
}

export function topOf(r: Record<string, unknown>): TopStructure | null {
  if (typeof r.url !== "string" || typeof r.read_on !== "string" || typeof r.rank !== "number") return null;
  return {
    clusterId: r.cluster_id == null ? null : String(r.cluster_id),
    keywordId: r.keyword_id == null ? null : String(r.keyword_id),
    readOn: r.read_on.slice(0, 10),
    rank: r.rank,
    url: r.url,
    urlKey: String(r.url_key ?? ""),
    status: r.status === "unreadable" ? "unreadable" : "ok",
    title: str(r.title),
    h1: str(r.h1),
    headings: Array.isArray(r.headings) ? (r.headings as TopStructure["headings"]).slice(0, 40) : [],
    dateShown: typeof r.date_shown === "boolean" ? r.date_shown : null,
    wordCount: num(r.word_count),
  };
}

const rows = (data: unknown) => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);

export async function readChecks(db: SupabaseClient, clientId: string, today: Day): Promise<PageCheck[]> {
  const { data, error } = await db.from("page_checks").select(CHECK_COLUMNS).eq("client_domain_id", clientId).gte("checked_at", `${addDays(today, -CHECK_DAYS)}T00:00:00Z`).order("checked_at", { ascending: false }).limit(CHECK_LIMIT);
  if (error) throw new Error(`could not read the page checks: ${error.message}`);
  return rows(data).map(checkOf).filter((c): c is PageCheck => c !== null);
}

export async function readBots(db: SupabaseClient, clientId: string): Promise<BotCheck[]> {
  const { data, error } = await db.from("bot_checks").select(BOT_COLUMNS).eq("client_domain_id", clientId).order("checked_at", { ascending: false }).limit(2);
  if (error) throw new Error(`could not read the crawler checks: ${error.message}`);
  return rows(data).map(botOf).filter((b): b is BotCheck => b !== null);
}

export async function readExamples(db: SupabaseClient, clientId: string): Promise<ReoptExample[]> {
  const { data, error } = await db.from("reopt_examples").select(EXAMPLE_COLUMNS).eq("client_domain_id", clientId).order("requested_at", { ascending: false }).limit(60);
  if (error) throw new Error(`could not read the examples: ${error.message}`);
  return rows(data).map(exampleOf).filter((e): e is ReoptExample => e !== null);
}

export async function readTop(db: SupabaseClient, clientId: string): Promise<TopStructure[]> {
  const { data, error } = await db.from("top_structures").select(TOP_COLUMNS).eq("client_domain_id", clientId).order("read_on", { ascending: false }).limit(90);
  if (error) throw new Error(`could not read the top results' structure: ${error.message}`);
  return latestTop(rows(data).map(topOf).filter((t): t is TopStructure => t !== null));
}

/** Each keyword's latest read of its top 3 only. */
export function latestTop(all: readonly TopStructure[]): TopStructure[] {
  const latest = new Map<string, Day>();
  for (const t of all) {
    const k = t.keywordId ?? t.clusterId ?? "";
    if (!latest.has(k) || t.readOn > latest.get(k)!) latest.set(k, t.readOn);
  }
  return all.filter((t) => t.readOn === latest.get(t.keywordId ?? t.clusterId ?? ""));
}

/** A page of Google results as tracking_serp.top stores it, allow-listed. */
export function topResults(v: unknown): TopResult[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => obj(x))
    .filter((x): x is Record<string, unknown> => x !== null && typeof x.rank === "number" && typeof x.url === "string")
    .map((x) => ({ rank: x.rank as number, domain: String(x.domain ?? ""), url: x.url as string }))
    .slice(0, 20);
}

/**
 * The live cluster keywords' readings over SERP_DAYS (position and ranking
 * URL: tracking_serp holds a row only for a keyword that was read that day),
 * and each keyword's latest page of results.
 */
export async function readSerp(db: SupabaseClient, clientId: string, keywordIds: readonly string[], today: Day): Promise<KeywordSerp[]> {
  if (!keywordIds.length) return [];
  const from = addDays(today, -SERP_DAYS);
  const all = await selectAll<{ run_date: Day; keyword_id: string; position: number | null; url: string | null }>((lo, hi) =>
    db.from("tracking_serp").select("run_date, keyword_id, position, url").eq("client_domain_id", clientId).gte("run_date", from).lte("run_date", today).order("id").range(lo, hi),
  );
  const out: KeywordSerp[] = [];
  for (const k of keywordIds) {
    const readings: SerpReading[] = all.filter((r) => r.keyword_id === k).map((r) => ({ day: r.run_date, position: r.position, url: r.url })).sort((a, b) => (a.day < b.day ? -1 : 1));
    const { data, error } = await db.from("tracking_serp").select("run_date, top").eq("client_domain_id", clientId).eq("keyword_id", k).not("top", "is", null).order("run_date", { ascending: false }).limit(1);
    if (error) throw new Error(`could not read the results for a keyword: ${error.message}`);
    const row = rows(data)[0];
    out.push({ keywordId: k, readings, top: topResults(row?.top), topOn: row ? String(row.run_date) : null });
  }
  return out;
}

export async function readJobs(db: SupabaseClient, clientId: string): Promise<JobState[]> {
  const { data, error } = await db.from("diy_jobs").select("kind, outcome, due_on, done_at").eq("client_domain_id", clientId).in("kind", [WEEKLY_KIND, MONTHLY_KIND]).order("due_on", { ascending: false }).limit(10);
  if (error) throw new Error(`could not read the night's jobs: ${error.message}`);
  return rows(data).map((r) => ({ kind: String(r.kind), outcome: str(r.outcome), dueOn: String(r.due_on), doneAt: str(r.done_at) }));
}

/** Whether the latest run of either job failed: "Some checks didn't finish last night; they retry tonight" (spec 5.7). */
export function lastNightFailed(jobs: readonly JobState[]): boolean {
  return [WEEKLY_KIND, MONTHLY_KIND].some((k) => jobs.find((j) => j.kind === k)?.outcome === "failed");
}

// ---- The fixture. ----

/** pages.json's entry for one state: the rows as the tables would hold them, and each keyword's readings compactly. */
export type PagesFixture = {
  keyPages: Record<string, unknown>[];
  checks: Record<string, unknown>[];
  bots: Record<string, unknown>[];
  examples: Record<string, unknown>[];
  top: Record<string, unknown>[];
  /** Per keyword id: [day, position, url] readings and [rank, domain, url] results. */
  serp: Record<string, { readings: [Day, number | null, string | null][]; top: [number, string, string][]; topOn: Day | null }>;
  jobs: Record<string, unknown>[];
};

type Held = { state: string; data: PagesFixture };

/** The fixture's rows, with the route's writes held in memory per DIY state (TRACKING_FIXTURE_WRITE=1). */
export function pagesFixture(env: Env = process.env, root?: string): { get(): PagesFixture; write(next: PagesFixture): boolean } {
  const state = diyFixtureState(env) ?? "full";
  const store = diyFixtureStore<Held>("pages", () => ({ state, data: readDiyFixture<PagesFixture>("pages", env, root) }));
  const held = () => {
    const h = store.get();
    if (h.state === state) return h;
    const fresh = { state, data: readDiyFixture<PagesFixture>("pages", env, root) };
    store.set(fresh);
    return fresh;
  };
  return {
    get: () => structuredClone(held().data),
    write(next) {
      if (!diyFixtureWrites(env)) return false;
      store.set({ state, data: next });
      return true;
    },
  };
}

/** The fixture's keyword readings as the Supabase read answers them. */
export function fixtureSerp(f: PagesFixture, keywordIds: readonly string[]): KeywordSerp[] {
  return keywordIds.map((k) => {
    const s = f.serp[k];
    return {
      keywordId: k,
      readings: (s?.readings ?? []).map(([day, position, url]) => ({ day, position, url })),
      top: (s?.top ?? []).map(([rank, domain, url]) => ({ rank, domain, url })),
      topOn: s?.topOn ?? null,
    };
  });
}

export type PagesRead = {
  keyPages: KeyPage[];
  checks: PageCheck[];
  bots: BotCheck[];
  examples: ReoptExample[];
  top: TopStructure[];
  jobs: JobState[];
};

/** One section's read, on the fixture or on Supabase. */
export async function readPagesPart<K extends keyof PagesRead>(part: K, db: (() => SupabaseClient) | null, clientId: string, today: Day, env: Env = process.env): Promise<PagesRead[K]> {
  if (diyFixtureState(env) !== null) {
    const f = pagesFixture(env).get();
    const own = (r: Record<string, unknown>) => r.client_domain_id === undefined || r.client_domain_id === clientId;
    const map: { [P in keyof PagesRead]: () => PagesRead[P] } = {
      keyPages: () => f.keyPages.filter(own).map(keyPageOf).filter((k): k is KeyPage => k !== null),
      checks: () => f.checks.filter(own).map(checkOf).filter((c): c is PageCheck => c !== null).sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1)),
      bots: () => f.bots.filter(own).map(botOf).filter((b): b is BotCheck => b !== null).sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1)),
      examples: () => f.examples.filter(own).map(exampleOf).filter((e): e is ReoptExample => e !== null).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)),
      top: () => latestTop(f.top.filter(own).map(topOf).filter((t): t is TopStructure => t !== null)),
      jobs: () => f.jobs.filter(own).map((r) => ({ kind: String(r.kind), outcome: str(r.outcome), dueOn: String(r.due_on), doneAt: str(r.done_at) })),
    };
    return map[part]();
  }
  if (!db) throw new Error("no database to read");
  const d = db();
  const read: { [P in keyof PagesRead]: () => Promise<PagesRead[P]> } = {
    keyPages: async () => {
      const { data, error } = await d.from("key_pages").select(KEY_PAGE_COLUMNS).eq("client_domain_id", clientId).order("added_on", { ascending: true }).limit(500);
      if (error) throw new Error(`could not read the key pages: ${error.message}`);
      return rows(data).map(keyPageOf).filter((k): k is KeyPage => k !== null);
    },
    checks: () => readChecks(d, clientId, today),
    bots: () => readBots(d, clientId),
    examples: () => readExamples(d, clientId),
    top: () => readTop(d, clientId),
    jobs: () => readJobs(d, clientId),
  };
  return read[part]();
}

/** The keyword readings, on the fixture or on Supabase. */
export async function readPagesSerp(db: (() => SupabaseClient) | null, clientId: string, keywordIds: readonly string[], today: Day, env: Env = process.env): Promise<KeywordSerp[]> {
  if (diyFixtureState(env) !== null) return fixtureSerp(pagesFixture(env).get(), keywordIds);
  if (!db) throw new Error("no database to read");
  return readSerp(db(), clientId, keywordIds, today);
}
