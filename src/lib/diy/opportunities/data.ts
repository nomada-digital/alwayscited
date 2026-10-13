import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { diyFixtureState, diyFixtureStore, diyFixtureWrites, FIXTURE_DIR, type DiyFixtureState } from "../core/fixture.ts";

import { type DeriveAnswer, type DeriveInput, type Derived, type SerpTop, WINDOW_DAYS, derive, readPlacedKeys, withoutPlaced } from "./derive.ts";
import { historyOf, opportunityOf } from "./status.ts";
import { type KindRow, OPP_COLUMNS, type Opportunity, PAGE_READ_COLUMNS, type PageFacts, pickDomainType, pickPageType } from "./types.ts";

/**
 * Opportunities' loader (13 Oct 2026, DIY P7; spec 10 sections 3.3, 3.4 and
 * 7.0 item 6): Supabase, or the fixture. Plain module with the database
 * passed in, so node --test runs both branches.
 *
 * **Every list subtracts Nomada's placements for other clients at read time
 * too**, not only when the night derives the rows: a placement logged for
 * client B today must leave client A's list today, and the row the night made
 * before it is never deleted (house rule). A subtraction that cannot be read
 * throws, and the section says it could not be read - a list that could not
 * be checked is not shown.
 *
 * On the fixture (`TRACKING_FIXTURE=1`), `src/lib/diy/fixtures/opportunities.json`
 * holds a made-up world for each DIY state - cited pages, Google's top 10,
 * page reads, types, other clients' placements and the rows' statuses - and
 * the loader runs `derive` over it and the tracking fixture's own answers,
 * exactly as the night job does, so the fixture shows what the rules make of
 * it, exclusions included. A state may name a `base` state and override
 * parts of it. With `TRACKING_FIXTURE_WRITE=1` the route's writes are held in
 * memory over it (`oppFixture`).
 */

// ---- Rows read back ----

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): Day | null => (typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** One page_reads row as PageFacts: named fields only, each checked. */
export function factsOf(r: Record<string, unknown>): PageFacts | null {
  if (typeof r.url_key !== "string" || typeof r.url !== "string" || typeof r.read_at !== "string") return null;
  const status = r.status === "ok" || r.status === "blocked" || r.status === "error" || r.status === "not_html" ? r.status : null;
  if (!status) return null;
  const strs = (v: unknown, max: number, chars: number) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.slice(0, chars)).slice(0, max) : []);
  const tri = (v: unknown) => (v === true ? true : v === false ? false : null);
  return {
    urlKey: r.url_key,
    url: r.url,
    readAt: r.read_at,
    via: r.via === "content_parsing" ? "content_parsing" : "own",
    status,
    http: typeof r.http_status === "number" ? r.http_status : null,
    title: typeof r.title === "string" ? r.title.slice(0, 300) : null,
    h1: typeof r.h1 === "string" ? r.h1.slice(0, 300) : null,
    updatedOn: day(r.updated_on),
    headings: strs(r.headings, 40, 120),
    namesClient: tri(r.names_client),
    snippet: typeof r.client_snippet === "string" ? r.client_snippet.slice(0, 200) : null,
    brandsFound: strs(r.brands_found, 20, 120),
    linksToClient: tri(r.links_to_client),
    linkRel: r.link_rel === "followed" || r.link_rel === "not_followed" ? r.link_rel : null,
    linkAnchor: typeof r.link_anchor === "string" ? r.link_anchor.slice(0, 200) : null,
  };
}

/** PageFacts as a page_reads row, for the writers. */
export function readRow(clientId: string, f: PageFacts, readId: string | null = null): Record<string, unknown> {
  return {
    client_domain_id: clientId,
    url_key: f.urlKey,
    url: f.url.slice(0, 500),
    read_at: f.readAt,
    via: f.via,
    status: f.status,
    http_status: f.http,
    title: f.title,
    h1: f.h1,
    updated_on: f.updatedOn,
    headings: f.headings.slice(0, 40).map((h) => h.slice(0, 120)),
    names_client: f.namesClient,
    client_snippet: f.snippet ? f.snippet.slice(0, 200) : null,
    brands_found: f.brandsFound,
    links_to_client: f.linksToClient,
    link_rel: f.linkRel,
    link_anchor: f.linkAnchor ? f.linkAnchor.slice(0, 200) : null,
    read_id: readId,
  };
}

/** Everything the Opportunities pages and Cited pages draw from. */
export type OppWorld = {
  /** Every row of this client, every status, other clients' placements subtracted. */
  rows: Opportunity[];
  /** The latest read of each page, by url_key. */
  reads: Map<string, PageFacts>;
  /** Other clients' placement keys, for Cited pages' "Leaves you out" (section 4.5). */
  placedKeys: Set<string>;
  /** The day the latest refresh counted to: "Updated overnight from your checks to 14 Oct". Null before the first. */
  refreshedTo: Day | null;
  /** The latest run of one of this package's jobs failed: "Some checks didn't finish last night; they retry tonight." */
  jobFailed: boolean;
};

/** This package's night jobs, for the failed-job line. */
export const OPP_JOB_KINDS = ["opportunity_refresh", "page_reads", "classify", "watch"] as const;

/** Every row of this client, paged. A failed read throws. */
export async function readOpportunityRows(db: SupabaseClient, clientId: string): Promise<Opportunity[]> {
  const rows = await selectAll<Record<string, unknown>>((lo, hi) => db.from("opportunities").select(OPP_COLUMNS).eq("client_domain_id", clientId).order("id", { ascending: true }).range(lo, hi));
  return rows.map(opportunityOf).filter((o): o is Opportunity => o !== null);
}

/** Every page read of this client, by url_key. A failed read throws. */
export async function readPageReads(db: SupabaseClient, clientId: string): Promise<Map<string, PageFacts>> {
  const rows = await selectAll<Record<string, unknown>>((lo, hi) => db.from("page_reads").select(PAGE_READ_COLUMNS).eq("client_domain_id", clientId).order("url_key", { ascending: true }).range(lo, hi));
  return new Map(rows.map(factsOf).filter((f): f is PageFacts => f !== null).map((f) => [f.urlKey, f]));
}

/** Whether the latest row of any of this package's job kinds failed. A failed read is read as no, and logged: it hides one line, never a figure. */
export async function readJobFailed(db: SupabaseClient, clientId: string): Promise<boolean> {
  const { data, error } = await db.from("diy_jobs").select("kind, outcome, created_at").eq("client_domain_id", clientId).in("kind", [...OPP_JOB_KINDS]).order("created_at", { ascending: false }).limit(40);
  if (error) {
    console.warn(`[diy] opportunities jobs: ${error.message}`);
    return false;
  }
  const latest = new Map<string, string | null>();
  for (const r of (data ?? []) as { kind: string; outcome: string | null }[]) if (!latest.has(r.kind)) latest.set(r.kind, r.outcome);
  return [...latest.values()].some((o) => o === "failed");
}

/** The cached types for these keys. Paged by key, at most 200 a request. A failed read throws. */
export async function readKinds(db: SupabaseClient, keys: readonly string[]): Promise<Map<string, KindRow>> {
  const out = new Map<string, KindRow>();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data, error } = await db.from("source_kinds").select("key, level, domain_type, page_type, set_by").in("key", chunk).limit(chunk.length);
    if (error) throw new Error(`could not read the page types: ${error.message}`);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      if (typeof r.key !== "string") continue;
      out.set(r.key, { key: r.key, level: r.level === "page" ? "page" : "domain", domain_type: pickDomainType(r.domain_type), page_type: pickPageType(r.page_type), set_by: r.set_by === "model" ? "model" : "rule" });
    }
  }
  return out;
}

/** Whether a PostgREST error says the table is not there (a deploy before its migration). */
export function missingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message ?? "");
}

/**
 * The client's key pages (P8's `key_pages`), with the clusters each serves,
 * read tolerant (spec 7.8): while the table is absent, an empty list and one
 * log line. Any other failure throws.
 */
export async function readKeyPages(db: SupabaseClient, clientId: string): Promise<{ url: string; clusterIds: string[] }[]> {
  const { data, error } = await db.from("key_pages").select("url, cluster_ids").eq("client_domain_id", clientId).is("removed_on", null).limit(50);
  if (error) {
    if (missingTable(error)) {
      console.warn(`[diy] opportunities key pages: ${error.message}; no key pages until the your_pages migration is applied`);
      return [];
    }
    throw new Error(`could not read the key pages: ${error.message}`);
  }
  return ((data ?? []) as { url: unknown; cluster_ids: unknown }[]).filter((r) => typeof r.url === "string").map((r) => ({ url: r.url as string, clusterIds: Array.isArray(r.cluster_ids) ? (r.cluster_ids as unknown[]).filter((c): c is string => typeof c === "string") : [] }));
}

/**
 * How many open opportunities this client has, optionally on one cluster and
 * of some page types (P8's fit copy imports this: "Opportunities, 6 found").
 * Tolerant: null while the table is absent or the count fails, and one log
 * line; P8 then writes "(see Opportunities)". Other clients' placements are
 * not subtracted from a count this coarse, so it counts only rows the night
 * derived as live, which never include them.
 */
export async function countOpenOpportunities(db: SupabaseClient, clientId: string, opts: { clusterId?: string; pageTypes?: readonly string[] } = {}): Promise<number | null> {
  let q = db.from("opportunities").select("id", { count: "exact", head: true }).eq("client_domain_id", clientId).eq("status", "new").eq("live", true);
  if (opts.clusterId) q = q.eq("cluster_id", opts.clusterId);
  if (opts.pageTypes?.length) q = q.in("page_type", [...opts.pageTypes]);
  const { count, error } = await q;
  if (error || typeof count !== "number") {
    console.warn(`[diy] opportunities count: ${error?.message || "no count came back"}`);
    return null;
  }
  return count;
}

/** The client's latest ranking URL for a keyword in the window, for "What to point it at". Null when there is none. A failed read throws. */
export async function readRankingUrl(db: SupabaseClient, clientId: string, keywordId: string, today: Day): Promise<string | null> {
  const { data, error } = await db
    .from("tracking_serp")
    .select("run_date, url")
    .eq("client_domain_id", clientId)
    .eq("keyword_id", keywordId)
    .gte("run_date", addDays(today, -(WINDOW_DAYS - 1)))
    .order("run_date", { ascending: false })
    .limit(7);
  if (error) throw new Error(`could not read the ranking page: ${error.message}`);
  const row = ((data ?? []) as { url: unknown }[]).find((r) => typeof r.url === "string" && r.url);
  return row ? (row.url as string) : null;
}

/** The world from Supabase: the rows, the reads, the subtraction and the job line. */
export async function readWorld(db: SupabaseClient, clientId: string): Promise<OppWorld> {
  const [rows, reads, placedKeys, jobFailed] = await Promise.all([readOpportunityRows(db, clientId), readPageReads(db, clientId), readPlacedKeys(db, clientId), readJobFailed(db, clientId)]);
  const kept = withoutPlaced(rows, placedKeys);
  const refreshedTo = kept.reduce<Day | null>((m, r) => (r.live && r.lastSeen && (!m || r.lastSeen > m) ? r.lastSeen : m), null);
  return { rows: kept, reads, placedKeys, refreshedTo, jobFailed };
}

// ---- The fixture ----

/** One made-up cited page: its answers, expanded over the last `days` days (or the day offsets given). */
export type WorldPage = { url: string; prompts: string[]; engines?: string[]; days: number | number[]; named?: number; brands?: string[] };

/** A row's stored state over what derive makes of it: status, notes, prompts, verification. Keyed "<lens>|<url_key>". */
export type Overlay = Partial<Record<"id" | "status" | "status_at" | "status_by" | "pursued_on" | "note" | "prompt_id" | "dismiss_reason" | "first_seen", string | null>> & {
  verified?: unknown;
  first_cited?: unknown;
  history?: unknown;
};

export type OppFixtureState = {
  base?: DiyFixtureState;
  /** Include the tracking fixture's own answers in the world. */
  tracking?: boolean;
  world?: WorldPage[];
  serpTop?: { keyword_id: string; top: { rank: number; url: string | null; domain?: string | null }[] }[];
  reads?: Record<string, unknown>[];
  kinds?: { key: string; domain_type?: string | null; page_type?: string | null; set_by?: "rule" | "model" }[];
  placed?: string[];
  keyPages?: { url: string; clusterIds: string[] }[];
  state?: Record<string, Overlay>;
  logged?: Record<string, unknown>[];
  /** What a fixture "Log a site" and "Verify now" read, instead of a network read. */
  canned?: { log?: Record<string, unknown>; verify?: Record<string, unknown> } | null;
  jobFailed?: boolean;
};

type Env = Record<string, string | undefined>;

/** The fixture file's entry for a state, its `base` merged under it. */
export function fixtureEntry(file: Record<string, OppFixtureState>, state: DiyFixtureState): OppFixtureState {
  const own = file[state] ?? file.full;
  if (!own) throw new Error("the opportunities fixture needs a full entry");
  const base = own.base ? (file[own.base] ?? {}) : {};
  return { ...base, ...own };
}

/** The made-up world's answers, as tracking_answers holds them, over the 28 days ending `today`. */
export function worldAnswers(world: readonly WorldPage[], today: Day, engines: readonly string[]): DeriveAnswer[] {
  const out: DeriveAnswer[] = [];
  for (const w of world) {
    const offsets = Array.isArray(w.days) ? w.days : Array.from({ length: Math.max(0, Math.min(WINDOW_DAYS, w.days)) }, (_, i) => i);
    let named = w.named ?? 0;
    for (const off of offsets) {
      for (const q of w.prompts) {
        for (const e of w.engines ?? engines) {
          const isNamed = named > 0;
          if (isNamed) named--;
          out.push({ run_date: addDays(today, -off), question_id: q, engine: e, answered: true, named: isNamed, brands: w.brands ?? [], citations: [{ source_domain: hostOf(w.url), url: w.url }] });
        }
      }
    }
  }
  return out;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A stable fixture id for a derived row: "opp-" and a short hash of its lens and page. */
export function fixtureId(lens: string, urlKey: string): string {
  let h = 5381;
  for (const ch of `${lens}|${urlKey}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `opp-${h.toString(36)}`;
}

/** A derived row as the stored row the night job would write, its overlay over it. */
export function storedRow(clientId: string, d: Derived, overlay: Overlay | undefined, today: Day): Record<string, unknown> {
  return {
    id: overlay?.id ?? fixtureId(d.lens, d.urlKey),
    client_domain_id: clientId,
    cluster_id: d.clusterId,
    lens: d.lens,
    url: d.url,
    url_key: d.urlKey,
    domain: d.domain,
    title: d.title,
    page_type: d.pageType,
    domain_type: d.domainType,
    route: d.route,
    status: overlay?.status ?? "new",
    dismiss_reason: overlay?.dismiss_reason ?? null,
    evidence: d.evidence,
    order_key: d.orderKey,
    first_seen: overlay?.first_seen ?? addDays(today, -Math.min(27, Math.max(1, d.evidence.days_14 * 2))),
    last_seen: today,
    live: true,
    status_at: overlay?.status_at ?? null,
    status_by: overlay?.status_by ?? null,
    pursued_on: overlay?.pursued_on ?? null,
    note: overlay?.note ?? null,
    prompt_id: overlay?.prompt_id ?? null,
    verified: overlay?.verified ?? null,
    first_cited: overlay?.first_cited ?? null,
    history: historyOf(overlay?.history),
    created_at: `${today}T03:30:00Z`,
  };
}

/** What the tracking fixture gives the world: its answers, structure and today. */
export type TrackingWorld = {
  today: Day;
  engines: readonly string[];
  answers: DeriveAnswer[];
  questions: DeriveInput["questions"];
  clusters: DeriveInput["clusters"];
  keywords: DeriveInput["keywords"];
  domain: string;
};

/** The fixture's world: derive over the made-up pages and the tracking fixture, then the stored state over it. Pure. */
export function fixtureWorld(entry: OppFixtureState, t: TrackingWorld, clientId: string, held: { state: Record<string, Overlay>; logged: Record<string, unknown>[] } | null = null): OppWorld & { derived: Derived[] } {
  const reads = new Map((entry.reads ?? []).map(factsOf).filter((f): f is PageFacts => f !== null).map((f) => [f.urlKey, f]));
  const kinds = new Map((entry.kinds ?? []).map((k) => [k.key, { domain_type: pickDomainType(k.domain_type), page_type: pickPageType(k.page_type), set_by: k.set_by ?? "model" }] as const));
  const placedKeys = new Set(entry.placed ?? []);
  const answers = [...(entry.tracking === false ? [] : t.answers), ...worldAnswers(entry.world ?? [], t.today, t.engines)];
  const serpTop: SerpTop[] = (entry.serpTop ?? []).map((s) => ({ keyword_id: s.keyword_id, run_date: t.today, top: s.top }));
  const result = derive({ domain: t.domain, today: t.today, engines: t.engines, answers, questions: t.questions, clusters: t.clusters, keywords: t.keywords, serpTop, reads, kinds, placedKeys, keyPages: entry.keyPages ?? [] });
  const state = held?.state ?? entry.state ?? {};
  const derivedRows = result.rows.map((d) => storedRow(clientId, d, state[`${d.lens}|${d.urlKey}`], t.today));
  const logged = held?.logged ?? (entry.logged ?? []).map((r) => ({ ...r, client_domain_id: clientId }));
  // A row moved by a member stays when the night no longer derives it, as the stored row would.
  const kept = Object.entries(state)
    .filter(([key, o]) => o.status && o.status !== "new" && !derivedRows.some((r) => `${r.lens}|${r.url_key}` === key))
    .map(([key, o]) => ({ key, o }));
  const stale = kept.map(({ key, o }) => {
    const [lens, ...rest] = key.split("|");
    const urlKey = rest.join("|");
    return { ...storedRow(clientId, { lens: lens as Derived["lens"], url: `https://${urlKey}`, urlKey, domain: urlKey.split("/")[0]!, clusterId: null, route: "offer_resource", pageType: null, domainType: null, title: null, evidence: { ...emptyEvidence(t.today) }, orderKey: [0, 0, 0, 0, 0, t.today] }, o, t.today), live: false };
  });
  const rows = withoutPlaced([...derivedRows, ...stale, ...logged].map(opportunityOf).filter((o): o is Opportunity => o !== null), placedKeys);
  return { rows, reads, placedKeys, refreshedTo: t.today, jobFailed: entry.jobFailed === true, derived: result.rows };
}

const emptyEvidence = (to: Day) => ({ to, answers: 0, leaves_out: 0, others_named: 0, prompts: [], prompt_count: 0, engines: [], competitors: [], days_14: 0, days_7: 0, last_cited: null, rank: null, keyword: null, open: null });

/** The fixture file, read whole. */
export async function readFixtureFile(root: string = process.cwd()): Promise<Record<string, OppFixtureState>> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  return JSON.parse(readFileSync(join(root, FIXTURE_DIR, "opportunities.json"), "utf8")) as Record<string, OppFixtureState>;
}

type Held = { state: DiyFixtureState; overlays: Record<string, Overlay>; logged: Record<string, unknown>[] };

/**
 * The fixture's stored state as the route's writes have left it, per DIY
 * state, held on globalThis (core/fixture.ts diyFixtureStore). `write` is
 * false while the fixture is read-only.
 */
export function oppFixture(entry: OppFixtureState, env: Env = process.env): { get(): { state: Record<string, Overlay>; logged: Record<string, unknown>[] }; write(next: { state: Record<string, Overlay>; logged: Record<string, unknown>[] }): boolean } {
  const state = diyFixtureState(env) ?? "full";
  const init = (): Held => ({ state, overlays: structuredClone(entry.state ?? {}), logged: structuredClone(entry.logged ?? []) });
  const store = diyFixtureStore<Held>("opportunities", init);
  const held = () => {
    const h = store.get();
    if (h.state === state) return h;
    const fresh = init();
    store.set(fresh);
    return fresh;
  };
  return {
    get: () => {
      const h = held();
      return { state: structuredClone(h.overlays), logged: structuredClone(h.logged) };
    },
    write(next) {
      if (!diyFixtureWrites(env)) return false;
      store.set({ state, overlays: next.state, logged: next.logged });
      return true;
    },
  };
}

/** The key a fixture overlay is held under. */
export const overlayKey = (o: Pick<Opportunity, "lens" | "urlKey">) => `${o.lens}|${o.urlKey}`;
