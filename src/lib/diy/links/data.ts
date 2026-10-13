import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, addDays } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import type { DiyClient } from "../core/client.ts";
import { type DiyFixtureState, FIXTURE_DIR, diyFixtureState, diyFixtureStore, diyFixtureWrites } from "../core/fixture.ts";
import { MAX_ATTEMPTS } from "../core/jobs.ts";
import { type LedgerCountRow, countLedger, countUsage } from "../core/usage-meter.ts";
import { loggedSince } from "../opportunities/data.ts";
import { opportunityOf } from "../opportunities/status.ts";
import { OPP_COLUMNS, type Opportunity } from "../opportunities/types.ts";

import { type Access, accessFrom } from "./access.ts";
import { type Placed, bareHost } from "./nomada-placements.ts";
import { type Basis, type Bulk, type ComparisonSet, type DomainGap, LINK_LENSES, type LinkCheck, type LinkKind, type ListCount, type Mentions, type NewLost, type PageGap, type Series, type Stored, type BacklinksSummary } from "./types.ts";
import type { LinksWorld, WorldPart } from "./view.ts";

/**
 * Where Links reads from (13 Oct 2026, DIY P10; spec 10 sections 4.8 and
 * 5.8): the latest `backlink_reads` row of each kind, the month's
 * `comparison_sets` row, the latest `link_checks`, the client's `opportunities`
 * rows in the link lenses (P7's table, read with P7's own row reader), the
 * Backlinks jobs' rows, and the placements of every other client. Supabase's,
 * or the fixture's (`src/lib/diy/fixtures/links.json`, per DIY state) with its
 * write twins held on globalThis.
 *
 * Every payload is read back through named fields only, so a stored row of
 * another shape - or a key a parser never kept - reaches no page. Each reader
 * throws on a failed read; the page's section says it could not read, never
 * "none".
 *
 * Loadable by node --test: relative imports, the database passed in.
 */

type Row = Record<string, unknown>;
type Env = Record<string, string | undefined>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): Day | null => (typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const strs = (v: unknown, max: number, n: number) => arr(v).filter((x): x is string => typeof x === "string" && x.length > 0).map((x) => x.slice(0, max)).slice(0, n);

// ---- reading a payload back: named fields only ----

/**
 * A stored list's count back (types.ts ListCount). A payload without one -
 * none is stored before 13 Oct 2026's review of DIY P10 - is read as a
 * floor when it holds a full read's 100 rows, so no count is ever drawn as
 * exact without the read saying it was.
 */
function countOf(v: unknown, rows: number): ListCount {
  const o = obj(v);
  const read = num(o.read);
  if (read === null) return { read: rows, total: null, capped: rows >= 100 };
  return { read, total: num(o.total), capped: o.capped === true };
}

const linkRow = (r: unknown) => {
  const o = obj(r);
  const domain = str(o.domain, 253);
  return domain ? { domain, urlFrom: str(o.urlFrom, 500), urlTo: str(o.urlTo, 500), followed: typeof o.followed === "boolean" ? o.followed : null, firstSeen: day(o.firstSeen), lastSeen: day(o.lastSeen) } : null;
};

export const PAYLOAD: { [K in LinkKind]: (v: unknown) => unknown } = {
  summary: (v): BacklinksSummary => {
    const o = obj(v);
    const f = obj(o.follow);
    const follow = num(f.followed) !== null ? { followed: num(f.followed)!, notFollowed: num(f.notFollowed) ?? 0 } : null;
    return { rank: num(o.rank), backlinks: num(o.backlinks), referringDomains: num(o.referringDomains), referringMainDomains: num(o.referringMainDomains), firstSeen: day(o.firstSeen), follow };
  },
  new_lost: (v): NewLost => {
    const o = obj(v);
    const rows = (x: unknown) => arr(x).map(linkRow).filter((r): r is NonNullable<ReturnType<typeof linkRow>> => r !== null).slice(0, 100);
    return { since: day(o.since) ?? "1970-01-01", added: rows(o.added), lost: rows(o.lost), addedTotal: num(o.addedTotal), lostTotal: num(o.lostTotal) };
  },
  timeseries: (v): Series => ({
    weeks: arr(obj(v).weeks)
      .map((w) => obj(w))
      .filter((w) => day(w.week))
      .map((w) => ({ week: day(w.week)!, newDomains: num(w.newDomains) ?? 0, lostDomains: num(w.lostDomains) ?? 0 }))
      .slice(-27),
  }),
  bulk: (v): Bulk => {
    const o = obj(v);
    return {
      from: day(o.from) ?? "1970-01-01",
      rows: arr(o.rows)
        .map((r) => obj(r))
        .filter((r) => str(r.domain, 253))
        .map((r) => ({ domain: str(r.domain, 253)!, rank: num(r.rank), referringDomains: num(r.referringDomains), newDomains: num(r.newDomains), lostDomains: num(r.lostDomains) }))
        .slice(0, 4),
    };
  },
  domain_gap: (v): DomainGap => {
    const o = obj(v);
    const rows = arr(o.rows)
      .map((r) => obj(r))
      .filter((r) => str(r.domain, 253))
      .map((r) => ({ domain: str(r.domain, 253)!, linksTo: strs(r.linksTo, 253, 3), rank: num(r.rank), firstSeen: day(r.firstSeen) }))
      .slice(0, 300);
    return { targets: strs(o.targets, 253, 3), via: o.via === "pairwise" ? "pairwise" : "filter", rows, count: countOf(o.count, rows.length) };
  },
  page_gap: (v): PageGap => {
    const o = obj(v);
    const rows = arr(o.rows)
      .map((r) => obj(r))
      .filter((r) => str(r.urlFrom, 500) && str(r.domain, 253))
      .map((r) => ({
        urlFrom: str(r.urlFrom, 500)!,
        title: str(r.title, 300),
        domain: str(r.domain, 253)!,
        links: arr(r.links)
          .map((l) => obj(l))
          .filter((l) => str(l.target, 253))
          .map((l) => ({ target: str(l.target, 253)!, urlTo: str(l.urlTo, 500), anchor: str(l.anchor, 200) }))
          .slice(0, 3),
        pageRank: num(r.pageRank),
        firstSeen: day(r.firstSeen),
      }))
      .slice(0, 100);
    return { targets: strs(o.targets, 253, 3), rows, count: countOf(o.count, rows.length) };
  },
  mentions: (v): Mentions => {
    const o = obj(v);
    const d = obj(o.dropped);
    return {
      candidates: num(o.candidates) ?? 0,
      confirmed: arr(o.confirmed)
        .map((m) => obj(m))
        .filter((m) => str(m.url, 500) && str(m.domain, 253))
        .map((m) => ({ url: str(m.url, 500)!, urlKey: str(m.urlKey, 520) ?? str(m.url, 500)!, domain: str(m.domain, 253)!, title: str(m.title, 300), published: day(m.published), snippet: str(m.snippet, 200), readOn: day(m.readOn) ?? "1970-01-01", via: m.via === "content_parsing" ? ("content_parsing" as const) : ("own" as const) }))
        .slice(0, 30),
      dropped: { unreadable: num(d.unreadable) ?? 0, linked: num(d.linked) ?? 0, unnamed: num(d.unnamed) ?? 0 },
    };
  },
};

/** One stored read back, or null for a row of no recognisable shape. */
export function storedOf<T>(kind: LinkKind, row: { read_on?: unknown; payload?: unknown } | null | undefined): Stored<T> | null {
  if (!row) return null;
  const readOn = day(row.read_on);
  if (!readOn || !row.payload || typeof row.payload !== "object") return null;
  return { readOn, value: PAYLOAD[kind](row.payload) as T };
}

function basisOf(v: unknown): Basis | null {
  const o = obj(v);
  if (o.from === "page1") return { from: "page1", places: num(o.places) ?? 0, avg: num(o.avg) };
  if (o.from === "labs" || o.from === "backlinks") return { from: o.from, shares: num(o.shares) };
  return null;
}

/** A comparison_sets row back. */
export function setOf(row: Row | null | undefined): ComparisonSet | null {
  if (!row) return null;
  const month = day(row.month);
  if (!month) return null;
  const domains = strs(row.domains, 253, 3).map(bareHost);
  const b = obj(row.basis);
  const basis: Record<string, Basis> = {};
  for (const d of domains) {
    const one = basisOf(b[d]);
    if (one) basis[d] = one;
  }
  return { month, domains, basis, derivedOn: day(row.created_at) ?? day(b.derivedOn) ?? month };
}

/** A link_checks row back. */
export function checkOf(r: Row): LinkCheck | null {
  const url = str(r.url, 500);
  const at = typeof r.checked_at === "string" ? r.checked_at : null;
  if (!url || !at) return null;
  const status = r.status === "ok" || r.status === "blocked" || r.status === "error" || r.status === "not_html" ? r.status : "error";
  return {
    id: String(r.id ?? ""),
    url,
    checkedAt: at,
    via: r.via === "content_parsing" ? "content_parsing" : "own",
    status,
    http: typeof r.http_status === "number" ? r.http_status : null,
    found: typeof r.found === "boolean" ? r.found : null,
    rel: r.rel === "followed" || r.rel === "not_followed" ? r.rel : null,
    anchor: str(r.anchor, 200),
    target: str(r.target, 500),
  };
}

export const LINK_CHECK_COLUMNS = "id, url, checked_at, via, status, http_status, found, rel, anchor, target";

// ---- Supabase ----

/** The latest stored read of one kind, or null when there is none. Throws on a failed read. */
export async function readLatest<T>(db: SupabaseClient, clientId: string, kind: LinkKind): Promise<Stored<T> | null> {
  const { data, error } = await db.from("backlink_reads").select("read_on, payload").eq("client_domain_id", clientId).eq("kind", kind).order("read_on", { ascending: false }).limit(1);
  if (error) throw new Error(`could not read the ${kind} links read: ${error.message}`);
  return storedOf<T>(kind, ((data ?? []) as Row[])[0] ?? null);
}

/** The latest comparison set. Throws on a failed read. */
export async function readSet(db: SupabaseClient, clientId: string): Promise<ComparisonSet | null> {
  const { data, error } = await db.from("comparison_sets").select("month, domains, basis, created_at").eq("client_domain_id", clientId).order("month", { ascending: false }).limit(1);
  if (error) throw new Error(`could not read the comparison set: ${error.message}`);
  return setOf(((data ?? []) as Row[])[0] ?? null);
}

/** The latest link checks, newest first. */
export async function readChecks(db: SupabaseClient, clientId: string, n = 5): Promise<LinkCheck[]> {
  const { data, error } = await db.from("link_checks").select(LINK_CHECK_COLUMNS).eq("client_domain_id", clientId).order("checked_at", { ascending: false }).limit(n);
  if (error) throw new Error(`could not read the link checks: ${error.message}`);
  return ((data ?? []) as Row[]).map(checkOf).filter((c): c is LinkCheck => c !== null);
}

/**
 * The client's opportunities rows in the link lenses (P7's table), with P7's
 * row reader: the newest 500 (13 Oct 2026, review of DIY P10: the oldest 500
 * were read, so a long history would have dropped this month's reveals). The
 * month's reveal count is not taken from these rows but from the table
 * (revealsUsed), so it never depends on how many are read here.
 */
export async function readLinkRows(db: SupabaseClient, clientId: string): Promise<Opportunity[]> {
  const { data, error } = await db.from("opportunities").select(OPP_COLUMNS).eq("client_domain_id", clientId).in("lens", [...LINK_LENSES]).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`could not read the link opportunities: ${error.message}`);
  return ((data ?? []) as Row[]).map(opportunityOf).filter((o): o is Opportunity => o !== null);
}

export type JobFact = { dueOn: Day; outcome: string | null; queued: boolean };
export const LINK_JOB_KINDS = ["backlinks_weekly", "backlinks_monthly"] as const;

/** The two Backlinks jobs' newest rows. A failed read is read as none, and logged: it hides one line, never a figure. */
export async function readLinkJobs(db: SupabaseClient, clientId: string): Promise<{ weekly: JobFact | null; monthly: JobFact | null }> {
  const { data, error } = await db.from("diy_jobs").select("kind, due_on, outcome, claimed_at, done_at, attempts, created_at").eq("client_domain_id", clientId).in("kind", [...LINK_JOB_KINDS]).order("created_at", { ascending: false }).limit(20);
  if (error) {
    console.warn(`[diy] links jobs: ${error.message}`);
    return { weekly: null, monthly: null };
  }
  const first = (kind: string): JobFact | null => {
    const r = ((data ?? []) as Row[]).find((x) => x.kind === kind);
    if (!r || !day(r.due_on)) return null;
    const attempts = typeof r.attempts === "number" ? r.attempts : 0;
    // Not done and under its attempts: a night pass will run it (jobs.ts claimable, without the clock: a claimed row is running).
    return { dueOn: day(r.due_on)!, outcome: typeof r.outcome === "string" ? r.outcome : null, queued: r.done_at == null && attempts < MAX_ATTEMPTS };
  };
  return { weekly: first("backlinks_weekly"), monthly: first("backlinks_monthly") };
}

/**
 * "Check a link" uses this month: usage-meter.ts `countUsage("link_checks")`,
 * the one count Settings, runOnDemand and Opportunities' Log a site read too
 * (13 Oct 2026, review of DIY P10: Links had counted its own free checks as
 * well, so Links could say 30 of 30 while Settings said 2). Throws when it
 * cannot be counted: it is never read as room.
 */
export async function linkChecksUsed(db: SupabaseClient, client: Pick<DiyClient, "id" | "market">, now: number): Promise<number> {
  return countUsage(db, client, "link_checks", now);
}

/** Link targets revealed this month (allowances.ts `link_targets`), from the table. */
export async function revealsUsed(db: SupabaseClient, client: Pick<DiyClient, "id" | "market">, now: number): Promise<number> {
  return countUsage(db, client, "link_targets", now);
}

/** The first read a page may promise: a weekly job actually queued - its due day, or tomorrow for one due today or carried. */
export function firstReadOn(job: JobFact | null, today: Day): Day | null {
  if (!job?.queued) return null;
  return job.dueOn > today ? job.dueOn : addDays(today, 1);
}

// ---- the fixture ----

export type LinksFixture = {
  base?: DiyFixtureState;
  enabled?: boolean;
  access: Access | null;
  /** A ledger row access is derived from, instead of `access`. */
  ledger?: { status: string; code: string | null; created_at: string } | null;
  reads: Partial<Record<LinkKind, { read_on: Day; payload: unknown } | null>>;
  set: Row | null;
  /** Domains and pages where Nomada has placed another fixture client (made up). */
  placed: { domains: string[]; keys: string[] };
  /** Pages revealed before this fixture's month (kept across months), and this month's. */
  revealed: { url: string; title: string | null; domain: string; revealedAt: string }[];
  /** Pursued link wins, as opportunities rows in the link lenses. */
  wins: Row[];
  checks: Row[];
  jobs: { weekly: JobFact | null; monthly: JobFact | null };
  /** What a fixture "Check a link" reads instead of the network: the result for an address containing "nolink", and for any other. */
  canned: { found: Row; none: Row };
};

/** The state's entry of links.json, its `base` (or `full`) under it, key by key. */
export function linksFixture(env: Env = process.env, root: string = process.cwd()): LinksFixture {
  const state = diyFixtureState(env);
  if (state === null) throw new Error("the DIY fixture is read only with TRACKING_FIXTURE=1");
  const file = JSON.parse(readFileSync(join(root, FIXTURE_DIR, "links.json"), "utf8")) as { full: LinksFixture } & Partial<Record<DiyFixtureState, Partial<LinksFixture>>>;
  const own = file[state] ?? {};
  const base = own.base ? { ...file.full, ...(file[own.base] ?? {}) } : file.full;
  return { ...base, ...own, reads: { ...base.reads, ...(own.reads ?? {}) } } as LinksFixture;
}

/** The fixture's writes: reveals and checks, held in memory once writes are on. */
export type LinksHeld = { state: DiyFixtureState; revealed: LinksFixture["revealed"]; checks: Row[] };

export function linksStore(env: Env = process.env, root?: string) {
  const state = diyFixtureState(env) ?? "full";
  const init = (): LinksHeld => {
    const fx = linksFixture(env, root);
    return { state, revealed: structuredClone(fx.revealed), checks: structuredClone(fx.checks) };
  };
  const store = diyFixtureStore<LinksHeld>("links", init);
  const held = () => {
    const h = store.get();
    if (h.state === state) return h;
    const fresh = init();
    store.set(fresh);
    return fresh;
  };
  return {
    get: () => structuredClone(held()),
    write(next: Omit<LinksHeld, "state">): boolean {
      if (!diyFixtureWrites(env)) return false;
      store.set({ state, ...next });
      return true;
    },
  };
}

/** The fixture's placements of other clients. */
export function fixturePlaced(fx: LinksFixture): Placed {
  return { domains: new Set(fx.placed.domains.map(bareHost)), keys: new Set(fx.placed.keys) };
}

/** The fixture's access: its ledger row through the same rule as Supabase's, else as recorded. */
export function fixtureAccess(fx: LinksFixture): Access {
  if (fx.ledger !== undefined) return accessFrom(fx.ledger);
  return fx.access ?? { state: "not_read", at: null, code: null };
}

/**
 * The fixture's link checks this month, counted as the fixture branch of
 * Opportunities' Log a site counts them: the core fixture's ledger rows (link
 * checks and verifications, usage-meter.ts countLedger) and the sites logged
 * in P7's fixture world. A check our own fetch answered counts nothing, as on
 * Supabase (13 Oct 2026, review of DIY P10).
 */
export function linksChecksUsedFixture(ledger: readonly LedgerCountRow[], oppRows: readonly Opportunity[], since: string): number {
  return countLedger(ledger, "link_checks") + loggedSince(oppRows, since);
}

/**
 * The fixture's world, pure: its stored reads, set, placements and access,
 * the reveals and checks as the write twins hold them, the seeded wins, and
 * `oppRows` - the link rows P7's fixture world holds, where this page's
 * Pursue writes them (world.ts reads them; a test passes its own).
 */
export function fixtureLinksWorld(fx: LinksFixture, held: Pick<LinksHeld, "revealed" | "checks">, p: { clientId: string; today: Day; enabled: boolean; oppRows?: readonly Opportunity[]; monthStart?: string; unread?: ReadonlySet<WorldPart> }): LinksWorld {
  const KINDS: LinkKind[] = ["summary", "new_lost", "timeseries", "bulk", "domain_gap", "page_gap", "mentions"];
  const reads = Object.fromEntries(KINDS.map((k) => [k, storedOf(k, fx.reads[k] ?? null)])) as Record<LinkKind, never>;
  const seeded = fx.wins.map((r) => opportunityOf({ ...r, client_domain_id: p.clientId })).filter((o): o is Opportunity => o !== null);
  const revealed = held.revealed
    .map((r, i) => opportunityOf({ id: `opp-reveal-${i}`, client_domain_id: p.clientId, lens: "link_page", url: r.url, url_key: urlKey(r.url) ?? r.url, domain: r.domain, title: r.title, route: "earn_link", status: "new", revealed_at: r.revealedAt, created_at: r.revealedAt }))
    .filter((o): o is Opportunity => o !== null);
  const linkRows = mergeLinkRows([...revealed, ...seeded, ...(p.oppRows ?? []).filter((o) => (LINK_LENSES as readonly string[]).includes(o.lens))]);
  return {
    enabled: fx.enabled ?? p.enabled,
    access: fixtureAccess(fx),
    summary: reads.summary,
    newLost: reads.new_lost,
    series: reads.timeseries,
    bulk: reads.bulk,
    gap: reads.domain_gap,
    pages: reads.page_gap,
    mentions: reads.mentions,
    set: setOf(fx.set),
    placed: fixturePlaced(fx),
    linkRows,
    // As the table counts them: every reveal this month, before any subtraction.
    revealsThisMonth: held.revealed.filter((r) => Date.parse(r.revealedAt) >= Date.parse(p.monthStart ?? `${p.today.slice(0, 7)}-01T00:00:00.000Z`)).length,
    checks: held.checks.map(checkOf).filter((c): c is LinkCheck => c !== null).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)).slice(0, 5),
    unread: p.unread ?? new Set(),
    firstRead: firstReadOn(fx.jobs.weekly, p.today),
    jobFailed: [fx.jobs.weekly, fx.jobs.monthly].some((j) => j?.outcome === "failed"),
    ...(p.oppRows ? { opened: new Set(p.oppRows.map((o) => o.id)) } : {}),
  };
}

/** One row per lens and page, the later in the list winning (a pursued row over a revealed one), the reveal time kept. */
export function mergeLinkRows(rows: readonly Opportunity[]): Opportunity[] {
  const by = new Map<string, Opportunity>();
  for (const o of rows) {
    const had = by.get(`${o.lens}|${o.urlKey}`);
    by.set(`${o.lens}|${o.urlKey}`, had ? { ...o, revealedAt: o.revealedAt ?? had.revealedAt } : o);
  }
  return [...by.values()];
}
