import type { SupabaseClient } from "@supabase/supabase-js";

import type { ParsedPage, RelevantPage } from "../../scan/dataforseo-request.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import { jobOutcomeFor } from "../core/caps.ts";
import type { DeepPage, ReadResult } from "../core/doors.ts";
import type { JobContext, JobHandler, JobResult, ReadCtx } from "../core/jobs.ts";
import { deepRow, insertCheck } from "./check.ts";
import { MONTHLY_KIND, readPlacedElsewhere, topResults } from "./data.ts";
import { type Candidate as PageCandidate, insertKeyPage, isOwnUrl, pickKeyPages, readKeyPages } from "./key-pages.ts";

/**
 * `key_pages_monthly` (13 Oct 2026, DIY P8; spec 10 sections 5.2, 5.7 and
 * 6.4-6.5): paid, monthly on the client's start day, and on onboarding; run
 * only while DIY is on and the client's setup is confirmed (the dispatcher
 * queues no paid kind otherwise). Every read goes through P1's doors on the
 * job's ReadCtx, so each is reserved, capped and settled on the ledger:
 *
 * 1. `relevant_pages` (Labs, one call): the client's highest-traffic pages
 *    fill the key pages up to 10;
 * 2. per live key page, `instant_pages` with JavaScript and the validator,
 *    then `microdata` (free for a paid task): one reservation each
 *    (doors.ts readPageDeep), stored as page_checks `via = 'instant_pages'`;
 * 3. per live cluster keyword, the top 3 organic results of its latest page
 *    of results (tracking_serp.top), read through `content_parsing` for
 *    their structure only, into top_structures.
 *
 * A cap refusal stops the job where it stands: a daily cap defers it to
 * tomorrow, a month budget or the switch skips the rest (caps.ts
 * jobOutcomeFor), and the note says what was read. A failed read is an
 * unreadable row and the job goes on. The paid doors are imported when the
 * job first runs (doors.ts is server-only), and the tests hand in fakes.
 */

export type MonthlyDeps = {
  relevant?: (ctx: ReadCtx) => Promise<ReadResult<RelevantPage[]>>;
  deep?: (ctx: ReadCtx, url: string) => Promise<ReadResult<DeepPage>>;
  parse?: (ctx: ReadCtx, url: string) => Promise<ReadResult<ParsedPage | null>>;
  now?: () => number;
};

/** The top results read per keyword. */
export const TOP_READ = 3;

async function liveDeps(): Promise<Required<Omit<MonthlyDeps, "now">>> {
  const doors = await import("../core/doors.ts");
  return { relevant: doors.readRelevantPages, deep: doors.readPageDeep, parse: (ctx, url) => doors.readContentParsing(ctx, url) };
}

/** A cap refusal, thrown to stop the job where it stands with its outcome. */
class Stop extends Error {
  outcome: "deferred" | "skipped" | "failed";
  why: string;
  constructor(outcome: "deferred" | "skipped" | "failed", why: string) {
    super(why);
    this.outcome = outcome;
    this.why = why;
  }
}

function stopOn<T>(r: ReadResult<T>): void {
  if (r.kind === "refused") throw new Stop(jobOutcomeFor(r.refusal.code), r.refusal.reason);
}

async function liveKeywords(db: SupabaseClient, clientId: string): Promise<{ clusterId: string; keywordId: string }[]> {
  const { data, error } = await db.from("tracked_clusters").select("id, keyword_id, stopped_on").eq("client_domain_id", clientId).is("stopped_on", null).limit(200);
  if (error) throw new Error(`could not read the clusters: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).filter((c) => c.keyword_id).map((c) => ({ clusterId: String(c.id), keywordId: String(c.keyword_id) }));
}

async function latestTop(db: SupabaseClient, clientId: string, keywordId: string, today: Day) {
  const { data, error } = await db.from("tracking_serp").select("run_date, top").eq("client_domain_id", clientId).eq("keyword_id", keywordId).gte("run_date", addDays(today, -14)).not("top", "is", null).order("run_date", { ascending: false }).limit(1);
  if (error) throw new Error(`could not read the results for a keyword: ${error.message}`);
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  return row ? topResults(row.top) : [];
}

/** One top result's structure as a top_structures row: headings and flags only, no body text. */
export function topRow(p: { clientId: string; clusterId: string; keywordId: string; today: Day; rank: number; url: string; page: ParsedPage | null; readId: string | null }): Record<string, unknown> {
  const ok = p.page !== null && (p.page.status === null || (p.page.status >= 200 && p.page.status < 300));
  return {
    client_domain_id: p.clientId,
    cluster_id: p.clusterId,
    keyword_id: p.keywordId,
    read_on: p.today,
    rank: p.rank,
    url: p.url.slice(0, 500),
    url_key: urlKey(p.url) ?? p.url.slice(0, 500),
    status: ok ? "ok" : "unreadable",
    title: ok ? (p.page!.title?.slice(0, 300) ?? null) : null,
    h1: ok ? (p.page!.h1?.slice(0, 200) ?? null) : null,
    headings: ok ? p.page!.headings.slice(0, 40).map((h) => ({ level: h.level, text: h.text.slice(0, 120) })) : [],
    date_shown: ok ? p.page!.dates.length > 0 : null,
    word_count: ok ? p.page!.wordCount : null,
    read_id: p.readId,
  };
}

export function keyPagesMonthlyHandler(deps: MonthlyDeps = {}): JobHandler {
  return {
    kind: MONTHLY_KIND,
    paid: true,
    cadence: "monthly",
    priority: 6,
    onboarding: true,
    async run(ctx: JobContext): Promise<JobResult> {
      if (!ctx.read) return { outcome: "failed", note: "a paid kind ran without a ReadCtx" };
      const read = ctx.read;
      // The live doors only when a test has not handed its own: doors.ts is server-only.
      const base = deps.relevant && deps.deep && deps.parse ? null : await liveDeps();
      const live = { relevant: deps.relevant ?? base!.relevant, deep: deps.deep ?? base!.deep, parse: deps.parse ?? base!.parse };
      const now = deps.now ?? Date.now;
      const { db, client, today } = ctx;
      const trigger = ctx.onboarding ? "onboarding" : "scheduled";
      const done = { relevant: 0, deep: 0, top: 0, failed: 0, refused: 0 };
      const note = () => `${done.deep} key pages read with JavaScript, ${done.top} top results read${done.relevant ? `, ${done.relevant} pages added from traffic` : ""}${done.refused ? `, ${done.refused} pages left out (address too long)` : ""}${done.failed ? `, ${done.failed} reads failed` : ""}`;
      try {
        // 1. Relevant pages fill the key pages.
        const rows = await readKeyPages(db, client.id);
        if (rows.filter((k) => k.removedOn === null).length < 10) {
          const rel = await live.relevant(read);
          stopOn(rel);
          if (rel.kind === "read") {
            const candidates: PageCandidate[] = [...rel.value].sort((a, b) => (b.etv ?? 0) - (a.etv ?? 0)).map((r) => ({ url: r.url, origin: "relevant", clusterIds: [] }));
            const pick = pickKeyPages({ rows, candidates, domain: client.domain });
            done.refused += pick.tooLong;
            for (const a of pick.add) {
              const put = await insertKeyPage(db, client.id, { ...a, by: "system", today });
              if (put === "added") done.relevant++;
              else if (put === "refused") done.refused++;
            }
          } else done.failed++;
        }
        // 2. Each key page with JavaScript and the validator.
        for (const page of (await readKeyPages(db, client.id)).filter((k) => k.removedOn === null)) {
          const r = await live.deep(read, page.url);
          stopOn(r);
          if (r.kind === "read") {
            await insertCheck(db, deepRow({ clientId: client.id, page, trigger, now: now(), page_: r.value.page, microdata: r.value.microdata, readId: r.readId }));
            done.deep++;
          } else {
            done.failed++;
            if (r.kind === "failed") await insertCheck(db, deepRow({ clientId: client.id, page, trigger, now: now(), page_: null, microdata: null, readId: r.readId }));
          }
        }
        // 3. The top 3 for each cluster keyword, structure only.
        // A page where Nomada has placed another client is never read for a client, listed or counted (spec 10 section 2.3).
        const placed = await readPlacedElsewhere(db, client.id);
        for (const k of await liveKeywords(db, client.id)) {
          // The top 3 other than the client's own pages and other clients' placements: it is read against them.
          const top = (await latestTop(db, client.id, k.keywordId, today)).filter((t) => !isOwnUrl(t.url, client.domain) && !placed.has(urlKey(t.url) ?? "")).slice(0, TOP_READ);
          for (const t of top) {
            const r = await live.parse(read, t.url);
            stopOn(r);
            const page = r.kind === "read" ? r.value : null;
            if (r.kind !== "read") done.failed++;
            const { error } = await db.from("top_structures").insert(topRow({ clientId: client.id, clusterId: k.clusterId, keywordId: k.keywordId, today, rank: t.rank, url: t.url, page, readId: r.kind === "refused" ? null : r.readId }));
            if (error) throw new Error(`could not store a top result's structure: ${error.message}`);
            if (r.kind === "read") done.top++;
          }
        }
      } catch (err) {
        if (err instanceof Stop) return { outcome: err.outcome, note: `${note()}; stopped: ${err.why}` };
        throw err;
      }
      return { outcome: "ok", note: note() };
    },
  };
}

/** The handler the shell registers. */
export const keyPagesMonthly = keyPagesMonthlyHandler();
