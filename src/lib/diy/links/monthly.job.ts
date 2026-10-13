import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { type Subject, readSubject } from "../../tracking/limits.ts";
import { jobOutcomeFor } from "../core/caps.ts";
import type { JobContext, JobHandler, JobResult, ReadCtx } from "../core/jobs.ts";
import type { ReadResult } from "../core/ledger.ts";
import { classifyAll } from "../opportunities/classify.job.ts";
import { domainKey } from "../opportunities/classify-rules.ts";
import type { Unclassified } from "../opportunities/derive.ts";

import { accessFrom, readFilterNames } from "./access.ts";
import type { FallbackRead } from "./check-link.ts";
import { type Fallback, type Kinds, type SerpRow, WINDOW_DAYS, deriveSet, monthOf, needsFallback, pageOnePlaces } from "./comparison-set.ts";
import { gapRows, pairRows, pairsOf } from "./gap.ts";
import { type LinksIO, liveLinksIO } from "./io.ts";
import { confirmMentions, mentionCandidates } from "./mentions.ts";
import { type Placed, bareHost, readPlacedDomains } from "./nomada-placements.ts";
import { targetRows } from "./targets.ts";
import type { Bulk, ComparisonSet, DomainGap, Mentions, PageGap } from "./types.ts";
import { writeLinkRead, writeSet } from "./write.ts";

/**
 * `backlinks_monthly` (13 Oct 2026, DIY P10; spec 10 sections 5.2, 5.7 and
 * 6.3): paid (the backlinks and content doors, and the labs door for the
 * fallback), monthly on the client's start day. In order, each step on its
 * own:
 *
 * 1. **the comparison set**: page-1 places from the stored SERPs (free), and
 *    when fewer than 3 vendor sites hold them, Labs' competitors_domain, then
 *    backlinks/competitors (reused from a set derived in the last 90 days
 *    when one recorded it, so it is read about quarterly), a fallback domain
 *    with no type yet sent to P7's classify call first (one chunk, at most
 *    20); stored in `comparison_sets` with each domain's basis;
 * 2. **the 13-week series** of new and lost referring domains;
 * 3. **bulk x 3**: rank, referring domains, and new and lost in 30 days, for
 *    the client and the set;
 * 4. **the domain gap** (3 compared sites only): one filtered read when the
 *    night's stored filter names carry `intersections_count`, else the three
 *    pairwise reads (gap.ts);
 * 5. **the page gap** (3 compared sites only);
 * 6. **mentions**: the content search, then at most 30 of our own reads
 *    (a content_parsing fallback when robots.txt keeps us out) to confirm.
 *
 * Every list is stored with Nomada's placements for other clients already
 * subtracted (and the page subtracts again on read). A daily cap stops the
 * job and defers it; the month's budget skips what is left; a failed read is
 * named in the note. When the first Backlinks read fails with an access
 * code, nothing more is asked for that night.
 */

export const SERIES_WEEKS = 13;
export const BULK_DAYS = 30;
/** A fallback set's backlinks/competitors read is reused for this long: the spec's "quarterly, only when needed". */
export const BACKLINKS_FALLBACK_DAYS = 90;
const CLASSIFY_MAX = 20;

class Stop extends Error {
  readonly result: JobResult;
  constructor(result: JobResult) {
    super(result.note ?? result.outcome);
    this.result = result;
  }
}

const notes: (n: string[]) => (s: string) => void = (n) => (s) => void n.push(s);

/** A read's value, or a Stop for a cap, or null (noted) for a failure. */
function take<T>(r: ReadResult<T>, what: string, note: (s: string) => void, done: string[]): { value: T; readId: string } | null {
  if (r.kind === "read") return { value: r.value, readId: r.readId };
  if (r.kind === "refused") throw new Stop({ outcome: jobOutcomeFor(r.refusal.code), note: [...done, `${what} refused: ${r.refusal.code}`].join("; ") });
  // Skipped, not failed: a retry the same night would be refused the same way.
  if (accessFrom({ status: "failed", code: r.reason, created_at: "" }).state === "inactive") throw new Stop({ outcome: "skipped", note: [...done, `Backlinks access isn't active (${r.reason}); nothing more was asked`].join("; ") });
  note(`${what} failed: ${r.reason}`);
  return null;
}

/** The SERP rows and types the set is derived from: 28 days of tracking_serp, the live cluster keywords, the domains' types. */
export async function readSetInput(db: SupabaseClient, clientId: string, today: Day): Promise<{ rows: SerpRow[]; live: Set<string> }> {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const [clusters, serp] = await Promise.all([
    selectAll<{ keyword_id: string | null; stopped_on: string | null }>((lo, hi) => db.from("tracked_clusters").select("keyword_id, stopped_on").eq("client_domain_id", clientId).order("id").range(lo, hi)),
    selectAll<{ keyword_id: string; run_date: string; top: unknown }>((lo, hi) => db.from("tracking_serp").select("keyword_id, run_date, top").eq("client_domain_id", clientId).gte("run_date", from).lte("run_date", today).order("id").range(lo, hi)),
  ]);
  const live = new Set(clusters.filter((c) => c.stopped_on === null && c.keyword_id).map((c) => c.keyword_id!));
  const rows = serp.filter((s) => Array.isArray(s.top)).map((s) => ({ keyword_id: s.keyword_id, run_date: String(s.run_date).slice(0, 10), top: (s.top as SerpRow["top"]).filter((t) => t && typeof t.rank === "number") }));
  return { rows, live };
}

/** The domain types for these domains (P7's global cache), `d:<domain>` to type. */
export async function readDomainKinds(db: SupabaseClient, domains: readonly string[]): Promise<Map<string, string | null>> {
  const keys = [...new Set(domains.map((d) => domainKey(d)))];
  const out = new Map<string, string | null>();
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const { data, error } = await db.from("source_kinds").select("key, domain_type").in("key", chunk).limit(chunk.length);
    if (error) throw new Error(`could not read the domain types: ${error.message}`);
    for (const r of (data ?? []) as { key: string; domain_type: string | null }[]) out.set(r.key, r.domain_type);
  }
  return out;
}

/** Domain types the model set, never over a rule's (P7's rule): domain rows only. */
async function writeDomainKinds(db: SupabaseClient, rows: readonly Record<string, unknown>[]): Promise<number> {
  let n = 0;
  for (const row of rows.filter((r) => r.level === "domain")) {
    const { error } = await db.from("source_kinds").insert(row);
    if (!error) {
      n++;
      continue;
    }
    if (error.code !== "23505") throw new Error(`could not store a type: ${error.message}`);
  }
  return n;
}

/** The backlinks fallback a set derived in the last 90 days recorded, to reuse rather than read again. */
async function recentBacklinksFallback(db: SupabaseClient, clientId: string, today: Day): Promise<Fallback[] | null> {
  const { data, error } = await db.from("comparison_sets").select("month, basis").eq("client_domain_id", clientId).gte("month", addDays(today, -BACKLINKS_FALLBACK_DAYS)).order("month", { ascending: false }).limit(3);
  if (error) throw new Error(`could not read the earlier comparison sets: ${error.message}`);
  const out: Fallback[] = [];
  for (const r of (data ?? []) as { basis: Record<string, { from?: string; shares?: number | null }> | null }[]) {
    for (const [domain, b] of Object.entries(r.basis ?? {})) if (b?.from === "backlinks" && !out.some((x) => x.domain === domain)) out.push({ domain, shares: typeof b.shares === "number" ? b.shares : null });
  }
  return out.length ? out : null;
}

/** Step 1: derive the month's set and store it. */
export async function deriveMonthSet(db: SupabaseClient, ctx: ReadCtx, io: LinksIO, client: { id: string; domain: string }, today: Day, placed: Placed, note: (s: string) => void, done: string[]): Promise<ComparisonSet> {
  const input = await readSetInput(db, client.id, today);
  const places = pageOnePlaces(input.rows, input.live, today);
  let kinds: Kinds = await readDomainKinds(db, [...places.keys()]);
  const base = { client: client.domain, month: monthOf(today), today, places, placed };
  let set = deriveSet({ ...base, kinds });
  if (set.waiting.length) note(`${set.waiting.length} page-1 domains wait for a type`);
  if (needsFallback(set)) {
    const labs = take(await io.labsCompetitors(ctx), "Labs competitors", note, done);
    let backlinks: Fallback[] | null = null;
    const lab: Fallback[] = (labs?.value ?? []).map((c) => ({ domain: bareHost(c.domain), shares: c.intersections }));
    kinds = await readDomainKinds(db, [...places.keys(), ...lab.map((l) => l.domain)]);
    set = deriveSet({ ...base, kinds, labs: lab });
    if (set.domains.length < 3) {
      backlinks = await recentBacklinksFallback(db, client.id, today);
      if (!backlinks) {
        const got = take(await io.backlinksCompetitors(ctx), "backlinks competitors", note, done);
        backlinks = (got?.value ?? []).map((c) => ({ domain: bareHost(c.domain), shares: c.intersections }));
      }
      kinds = await readDomainKinds(db, [...places.keys(), ...lab.map((l) => l.domain), ...backlinks.map((b) => b.domain)]);
      set = deriveSet({ ...base, kinds, labs: lab, backlinks });
    }
    // A fallback domain with no type is typed now (P7's classify call and schema), so the set can use it tonight.
    if (set.domains.length < 3 && set.waitingFallback.length) {
      const items: Unclassified[] = set.waitingFallback.slice(0, CLASSIFY_MAX).map((d) => ({ urlKey: d, url: `https://${d}/`, domain: d, title: null, h1: null, headings: [], needs: ["domain"] }));
      const typed = await classifyAll(io, ctx, items, (rows) => writeDomainKinds(db, rows));
      note(`fallback domains: ${typed.note ?? typed.outcome}`);
      kinds = await readDomainKinds(db, [...places.keys(), ...lab.map((l) => l.domain), ...(backlinks ?? []).map((b) => b.domain)]);
      set = deriveSet({ ...base, kinds, labs: lab, backlinks });
    }
  }
  await writeSet(db, client.id, set);
  done.push(`set of ${set.domains.length}`);
  return set;
}

export async function runMonthly(db: SupabaseClient, ctx: ReadCtx, io: LinksIO, client: { id: string; domain: string; brand: string }, today: Day, deps: { now?: () => number; subject?: Subject } = {}): Promise<JobResult> {
  const done: string[] = [];
  const problems: string[] = [];
  const note = notes(problems);
  const now = deps.now ?? Date.now;
  try {
    let placed: Placed;
    try {
      placed = await readPlacedDomains(db, client.id);
    } catch (err) {
      // No list is stored unchecked: the gap, targets and mentions wait for a night the placements can be read.
      return { outcome: "failed", note: `placements not read, so no list was made: ${err instanceof Error ? err.message : String(err)}` };
    }
    const set = await deriveMonthSet(db, ctx, io, client, today, placed, note, done);
    const compared = set.domains;

    const series = take(await io.series(ctx, addDays(today, -SERIES_WEEKS * 7), today), "series", note, done);
    if (series) {
      await writeLinkRead(db, client.id, { kind: "timeseries", readOn: today, payload: { weeks: series.value }, readId: series.readId, total: series.value.length });
      done.push("series");
    }

    if (compared.length) {
      const from = addDays(today, -BULK_DAYS);
      const ranks = take(await io.bulkRanks(ctx, compared), "bulk ranks", note, done);
      const domains = take(await io.bulkDomains(ctx, compared), "bulk referring domains", note, done);
      const newLost = take(await io.bulkNewLost(ctx, compared, from), "bulk new and lost", note, done);
      if (ranks || domains || newLost) {
        const rows: Bulk["rows"] = [client.domain, ...compared].map((d) => {
          const k = bareHost(d);
          return { domain: k, rank: ranks?.value[k] ?? null, referringDomains: domains?.value[k] ?? null, newDomains: newLost?.value[k]?.newDomains ?? null, lostDomains: newLost?.value[k]?.lostDomains ?? null };
        });
        await writeLinkRead(db, client.id, { kind: "bulk", readOn: today, payload: { from, rows }, readId: (ranks ?? domains ?? newLost)!.readId });
        done.push("bulk");
      }
    }

    if (compared.length === 3) {
      let countFilter = false;
      try {
        countFilter = (await readFilterNames(db)).intersectionsCount;
      } catch (err) {
        note(`filter names not read (${err instanceof Error ? err.message : String(err)}); pairwise`);
      }
      const reads: { rows: DomainGap["rows"]; readId: string }[] = [];
      if (countFilter) {
        const one = take(await io.domainGap(ctx, { targets: compared, mode: "partial", countFilter: true }), "domain gap", note, done);
        if (one) reads.push({ rows: one.value.rows, readId: one.readId });
      } else {
        for (const pair of pairsOf(compared)) {
          const one = take(await io.domainGap(ctx, { targets: pair, mode: "all", countFilter: false }), "domain gap pair", note, done);
          if (one) reads.push({ rows: pairRows(one.value.rows, pair), readId: one.readId });
        }
      }
      if (reads.length && (countFilter || reads.length === 3)) {
        const gap: DomainGap = { targets: compared, via: countFilter ? "filter" : "pairwise", rows: gapRows(reads.map((r) => r.rows), { client: client.domain, targets: compared, placed }) };
        await writeLinkRead(db, client.id, { kind: "domain_gap", readOn: today, payload: gap, readId: reads[0]!.readId, total: gap.rows.length });
        done.push(`gap of ${gap.rows.length}`);
      } else if (reads.length) note("the pairwise gap was cut short; nothing stored, tried again next month");

      const pages = take(await io.pageGap(ctx, compared), "page gap", note, done);
      if (pages) {
        const pg: PageGap = { targets: compared, rows: targetRows(pages.value.rows, { client: client.domain, targets: compared, placed }) };
        await writeLinkRead(db, client.id, { kind: "page_gap", readOn: today, payload: pg, readId: pages.readId, total: pg.rows.length });
        done.push(`${pg.rows.length} target pages`);
      }
    } else note(`${compared.length} compared sites: no gap or targets until there are 3`);

    const search = take(await io.contentSearch(ctx), "content search", note, done);
    if (search) {
      const subject = deps.subject ?? (await readSubject(db, client.id));
      if (typeof subject === "string") note(`mentions not confirmed: ${subject}`);
      else {
        const candidates = mentionCandidates(search.value.rows, { client: client.domain, compared, placed });
        const fallback = async (url: string): Promise<FallbackRead> => {
          const r = await io.parse(ctx, url);
          return r.kind === "read" ? { kind: "read", value: r.value } : r.kind === "refused" ? { kind: "refused" } : { kind: "failed", reason: r.reason };
        };
        const got = await confirmMentions(candidates, { ...subject, brand: subject.brand ?? client.brand }, { get: io.get, fallback, today, now, deadlineMs: ctx.deadlineMs });
        const payload: Mentions = { candidates: got.candidates, confirmed: got.confirmed, dropped: got.dropped };
        await writeLinkRead(db, client.id, { kind: "mentions", readOn: today, payload, readId: search.readId, total: search.value.total });
        done.push(`${got.confirmed.length} mentions of ${got.read} read`);
      }
    }
  } catch (err) {
    if (err instanceof Stop) return err.result;
    throw err;
  }
  const outcome = !done.length && problems.length ? "failed" : "ok";
  return { outcome, note: [...done, ...problems].join("; ") };
}

/** The handler. Paid: queued only for a confirmed client while diy_enabled is on. */
export function backlinksMonthlyHandler(io?: LinksIO): JobHandler {
  return {
    kind: "backlinks_monthly",
    paid: true,
    cadence: "monthly",
    priority: 8,
    onboarding: false,
    async run(ctx: JobContext): Promise<JobResult> {
      if (!ctx.read) return { outcome: "skipped", note: "no ReadCtx: a paid kind run without one" };
      return runMonthly(ctx.db, ctx.read, io ?? (await liveLinksIO()), ctx.client, ctx.today);
    },
  };
}

