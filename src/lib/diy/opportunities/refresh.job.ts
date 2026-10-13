import type { SupabaseClient } from "@supabase/supabase-js";

import { ENGINE_SPECS } from "../../scan/engines.ts";
import { selectAll } from "../../supabase/page.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { answerPlan, readAnswers, type AnswersTable } from "../../tracking/read-shape.ts";
import type { JobContext, JobHandler, JobResult } from "../core/jobs.ts";

import { citationKey, type DeriveInput, type DeriveResult, type Derived, type SerpTop, WINDOW_DAYS, derive, firstCitedAfter, readPlacedKeys } from "./derive.ts";
import { domainKey, pageKey } from "./classify-rules.ts";
import { readKeyPages, readKinds, readOpportunityRows, readPageReads } from "./data.ts";
import { compareOrder } from "./order.ts";
import { type KindRow, type Opportunity } from "./types.ts";

/**
 * `opportunity_refresh` (13 Oct 2026, DIY P7; spec 10 sections 5.7 and 6.2):
 * free, daily. Derives the AI-cited, `lists` and `own` rows from what is
 * already stored - the last 28 days of answers and citations, Google's top
 * 10 for each cluster keyword (tracking_serp.top), the page reads and the
 * cached types - and writes them: new rows as `new`, existing rows' evidence,
 * order and `last_seen`, a `new` row the rules no longer derive as not
 * `live` (never deleted), `first_cited` for pursued rows, and the types the
 * rules settled into source_kinds. Rows a member has moved keep their status.
 *
 * Never silent: every write failure is counted, the rest still tried, and
 * the job fails with the count, so the page says checks did not finish.
 */

/** Every engine in the tier order the evidence lists them in. */
export const ENGINE_ORDER: readonly string[] = Object.keys(ENGINE_SPECS);

/** The lenses this job derives; a row of another lens (logged, P10's) is never touched by it. */
const DERIVED_LENSES = new Set(["cited", "threads", "profiles", "lists", "own"]);

type SerpRow = { keyword_id: string; run_date: Day; top: unknown };

/** One client's derive input, read with the db the job hands in: paged, one client's rows only. A failed read throws. */
export async function readDeriveInput(db: SupabaseClient, client: { id: string; domain: string }, today: Day): Promise<DeriveInput & { existing: Opportunity[] }> {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const [clusters, questions, keywords, answers, serp, reads, placedKeys, keyPages, existing] = await Promise.all([
    selectAll<{ id: string; keyword_id: string | null; stopped_on: Day | null }>((lo, hi) => db.from("tracked_clusters").select("id, keyword_id, stopped_on").eq("client_domain_id", client.id).order("id").range(lo, hi)),
    selectAll<{ id: string; cluster_id: string | null; stopped_on: Day | null }>((lo, hi) => db.from("tracked_questions").select("id, cluster_id, stopped_on").eq("client_domain_id", client.id).order("id").range(lo, hi)),
    selectAll<{ id: string; keyword: string; search_volume: number | null }>((lo, hi) => db.from("tracked_keywords").select("id, keyword, search_volume").eq("client_domain_id", client.id).order("id").range(lo, hi)),
    readAnswers((() => db.from("tracking_answers")) as unknown as AnswersTable, answerPlan({ answers: "full" })!, null, { clientId: client.id, from, to: today }),
    selectAll<SerpRow>((lo, hi) => db.from("tracking_serp").select("keyword_id, run_date, top").eq("client_domain_id", client.id).gte("run_date", from).lte("run_date", today).order("id").range(lo, hi)),
    readPageReads(db, client.id),
    readPlacedKeys(db, client.id),
    readKeyPages(db, client.id),
    readOpportunityRows(db, client.id),
  ]);
  const serpTop: SerpTop[] = serp.filter((s) => Array.isArray(s.top)).map((s) => ({ keyword_id: s.keyword_id, run_date: s.run_date, top: (s.top as { rank?: unknown; url?: unknown; domain?: unknown }[]).filter((t) => typeof t?.rank === "number").map((t) => ({ rank: t.rank as number, url: typeof t.url === "string" ? t.url : null, domain: typeof t.domain === "string" ? t.domain : null })) }));
  // The types cached for every domain and page this window could list.
  const keys = new Set<string>();
  for (const a of answers) for (const c of a.citations) {
    const k = citationKey(c);
    if (k) keys.add(domainKey(k.host)).add(pageKey(k.key));
  }
  for (const s of serpTop) for (const t of s.top) {
    const k = citationKey({ source_domain: t.domain ?? "", url: t.url });
    if (k) keys.add(domainKey(k.host)).add(pageKey(k.key));
  }
  const kinds = await readKinds(db, [...keys]);
  return { domain: client.domain, today, engines: ENGINE_ORDER, answers, questions, clusters, keywords, serpTop, reads, kinds, placedKeys, keyPages, existing };
}

const rowKey = (lens: string, urlKey: string) => `${lens}|${urlKey}`;

export type RefreshPlan = {
  inserts: Record<string, unknown>[];
  updates: { id: string; patch: Record<string, unknown> }[];
  kinds: KindRow[];
};

/**
 * What one refresh writes, from what derive made and what is stored. Pure.
 * A new row of a lens it derives that is not derived this run is set not
 * live; a moved row (pursued, won, not for us) keeps its status, and only its
 * evidence and first_cited are refreshed.
 */
export function planRefresh(p: { clientId: string; today: Day; now: string; result: DeriveResult; existing: readonly Opportunity[]; answers: DeriveInput["answers"]; kinds: DeriveInput["kinds"] }): RefreshPlan {
  const byKey = new Map(p.existing.map((o) => [rowKey(o.lens, o.urlKey), o]));
  const seen = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const sorted = [...p.result.rows].sort((a, b) => compareOrder({ key: a.orderKey, urlKey: a.urlKey }, { key: b.orderKey, urlKey: b.urlKey }));
  for (const d of sorted) {
    const k = rowKey(d.lens, d.urlKey);
    seen.add(k);
    const had = byKey.get(k);
    if (!had) {
      inserts.push(insertOf(p.clientId, d, p.today, p.now));
      continue;
    }
    const firstSeen = had.firstSeen ?? p.today;
    const patch: Record<string, unknown> = {
      evidence: d.evidence,
      order_key: [...d.orderKey.slice(0, 5), firstSeen],
      last_seen: p.today,
      live: true,
      title: d.title ?? had.title,
      page_type: d.pageType,
      domain_type: d.domainType,
      updated_at: p.now,
    };
    if (had.status === "new") Object.assign(patch, { route: d.route, cluster_id: d.clusterId });
    updates.push({ id: had.id, patch });
  }
  for (const o of p.existing) {
    const k = rowKey(o.lens, o.urlKey);
    if (!seen.has(k) && o.status === "new" && o.live && DERIVED_LENSES.has(o.lens)) updates.push({ id: o.id, patch: { live: false, updated_at: p.now } });
    if ((o.status === "pursuing" || o.status === "pitched" || o.status === "won") && o.pursuedOn) {
      const next = firstCitedAfter(p.answers, o.urlKey, o.pursuedOn, o.firstCited);
      if (Object.keys(next).length !== Object.keys(o.firstCited ?? {}).length) {
        const u = updates.find((x) => x.id === o.id);
        if (u) u.patch.first_cited = next;
        else updates.push({ id: o.id, patch: { first_cited: next, updated_at: p.now } });
      }
    }
  }
  // Rule types written only when the cache does not already say so.
  const kinds = p.result.ruleKinds.filter((k) => {
    const had = p.kinds.get(k.key);
    return !had || had.set_by !== "rule" || had.domain_type !== k.domain_type || had.page_type !== k.page_type;
  });
  return { inserts, updates, kinds };
}

function insertOf(clientId: string, d: Derived, today: Day, now: string): Record<string, unknown> {
  return {
    client_domain_id: clientId,
    cluster_id: d.clusterId,
    lens: d.lens,
    url: d.url.slice(0, 500),
    url_key: d.urlKey,
    domain: d.domain,
    title: d.title,
    page_type: d.pageType,
    domain_type: d.domainType,
    route: d.route,
    status: "new",
    evidence: d.evidence,
    order_key: [...d.orderKey.slice(0, 5), today],
    first_seen: today,
    last_seen: today,
    live: true,
    created_at: now,
    updated_at: now,
  };
}

/** The plan's writes. A duplicate insert is one written since this read, left for tomorrow. Every failure is counted, then thrown. */
export async function applyRefresh(db: SupabaseClient, clientId: string, plan: RefreshPlan): Promise<{ inserted: number; updated: number; kinds: number }> {
  const failed: string[] = [];
  let inserted = 0;
  let updated = 0;
  let kinds = 0;
  for (const row of plan.inserts) {
    const { error } = await db.from("opportunities").insert(row);
    if (!error) inserted++;
    else if (error.code !== "23505") failed.push(error.message);
  }
  for (const u of plan.updates) {
    const { error } = await db.from("opportunities").update(u.patch).eq("client_domain_id", clientId).eq("id", u.id);
    if (!error) updated++;
    else failed.push(error.message);
  }
  for (const k of plan.kinds) {
    const row = { key: k.key, level: k.level, domain_type: k.domain_type, page_type: k.page_type, set_by: "rule", model: null, classified_at: new Date().toISOString() };
    const { error } = await db.from("source_kinds").insert(row);
    if (!error) {
      kinds++;
      continue;
    }
    if (error.code !== "23505") {
      failed.push(error.message);
      continue;
    }
    // Rules are final: a rule's type replaces the model's for the same key.
    const { error: uErr } = await db.from("source_kinds").update({ level: k.level, domain_type: k.domain_type, page_type: k.page_type, set_by: "rule", model: null, classified_at: row.classified_at }).eq("key", k.key);
    if (uErr) failed.push(uErr.message);
    else kinds++;
  }
  if (failed.length) throw new Error(`${failed.length} opportunity writes failed: ${failed[0]}`);
  return { inserted, updated, kinds };
}

/** The handler. Free: it reads only what is stored, so it runs whatever diy_enabled says. */
export function opportunityRefreshHandler(): JobHandler {
  return {
    kind: "opportunity_refresh",
    paid: false,
    cadence: "daily",
    priority: 3,
    onboarding: false,
    async run(ctx: JobContext): Promise<JobResult> {
      const input = await readDeriveInput(ctx.db, ctx.client, ctx.today);
      const result = derive(input);
      const plan = planRefresh({ clientId: ctx.client.id, today: ctx.today, now: new Date().toISOString(), result, existing: input.existing, answers: input.answers, kinds: input.kinds });
      const done = await applyRefresh(ctx.db, ctx.client.id, plan);
      const live = result.rows.length;
      return { outcome: "ok", note: `${live} rows derived; ${done.inserted} new, ${done.updated} updated; ${done.kinds} types set by rule; ${result.unclassified.length} pages wait for a type` };
    },
  };
}
