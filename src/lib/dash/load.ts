import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { missingColumn } from "@/lib/tracking/limits";

import type { KeyPageRow } from "./target";
import type { Day, FootRow, Raw, RawAnswer, RawClient, RawConnection, RawConsoleRow, RawGroup, RawKeyword, RawOpportunity, RawPlacement, RawPrompt, RawRun, RawSerp, TierKey } from "./types";

/**
 * One client's rows for the dashboards host, read in parallel with the
 * service role, every read scoped to client_domain_id. The caller has already
 * found the client in the session's own list (member.ts clientsFor), so a
 * client outside it is never read.
 *
 * Answers are the heavy read: verdicts for the last ANSWER_DAYS readings, and
 * brands and citations for the last SOURCE_DAYS only. Both are paged past
 * PostgREST's 1,000-row cap, because a 10-cluster client reads 250 a day.
 */

export const ANSWER_DAYS = 28;
export const SOURCE_DAYS = 7;
export const SERP_DAYS = 45;
const PAGE = 1000;

function addDays(d: Day, n: number): Day {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Every row of a read, page by page. `make` builds the same filtered query each time. */
async function paged<T>(make: () => { range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw new Error(`could not read ${what}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** A table the 17 Oct migration adds, read as empty until it is applied. */
function absent(e: { code?: string; message: string } | null): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(e.message) || missingColumn(e);
}

export type ClientRow = { id: string; slug: string; domain: string; brand: string | null; market: string; tier: string; started_on: string | null; cluster_limit?: number; trial_ends_at?: string | null; status?: string; payment_status?: string | null };

export async function loadRaw(client: ClientRow, role: string, today: Day, db: SupabaseClient = supabaseAdmin()): Promise<Raw> {
  const cid = client.id;
  const since = addDays(today, -ANSWER_DAYS);
  const sourcesSince = addDays(today, -SOURCE_DAYS);

  const [{ data: groupRows, error: groupsErr }, { data: extraRow, error: extraErr }, { error: formsErr }] = await Promise.all([
    db.from("keyword_groups").select("id, cluster_id, name, note, terms, position, stopped_on").eq("client_domain_id", cid),
    db.from("client_domains").select("brand_aliases, payment_status").eq("id", cid).maybeSingle(),
    // 20261018030000 (brief 2c): a keyword's form and the primary it pairs with. Read as all-primary until applied.
    db.from("tracked_keywords").select("form, pair_of").limit(0),
  ]);
  const formsReady = !absent(formsErr);
  const groupsReady = !absent(groupsErr);
  if (groupsErr && groupsReady) throw new Error(`could not read groups: ${groupsErr.message}`);
  // payment_status may predate BL-2's migration on an old database; aliases always exist.
  const extra = extraErr ? null : (extraRow as { brand_aliases?: string[]; payment_status?: string | null } | null);

  const kwCols = (groupsReady ? "id, keyword, search_volume, intent, added_on, stopped_on, added_by, cluster_id, group_id" : "id, keyword, search_volume, intent, added_on, stopped_on, added_by") + (formsReady ? ", form, pair_of" : "");
  const pCols = groupsReady ? "id, text, cluster_id, group_id, angle, added_on, stopped_on, origin_kind, allowance" : "id, text, cluster_id, angle, added_on, stopped_on";

  const [
    { data: clusterRows, error: clustersErr },
    { data: keywordRows, error: keywordsErr },
    { data: promptRows, error: promptsErr },
    { data: runRows, error: runsErr },
    { data: footRows, error: footErr },
    { data: oppRows, error: oppsErr },
    { data: placeRows, error: placeErr },
    { data: connRows, error: connErr },
    { data: consoleData, error: consoleErr },
    { data: keyPageRows, error: keyPageErr },
    { count: gridCount, error: gridErr },
  ] = await Promise.all([
    db.from("tracked_clusters").select("id, name, keyword_id, tier, started_on, stopped_on").eq("client_domain_id", cid),
    db.from("tracked_keywords").select(kwCols).eq("client_domain_id", cid),
    db.from("tracked_questions").select(pCols).eq("client_domain_id", cid),
    db.from("tracking_runs").select("run_date, status, engines").eq("client_domain_id", cid).gte("run_date", since).order("run_date"),
    db.from("keyword_footprints").select("pulled_on, rows").eq("client_domain_id", cid).order("pulled_on", { ascending: false }).limit(1),
    db.from("opportunities").select("id, cluster_id, lens, url, domain, title, route, status, evidence").eq("client_domain_id", cid).eq("live", true).limit(200),
    db.from("placements").select("id, cluster_id, kind, url, domain, status, scheduled_on, live_on, anchor_text").eq("client_domain_id", cid).neq("status", "removed"),
    db.from("integration_connections").select("provider, status, property, requested_at, connected_at, last_synced_at").eq("client_domain_id", cid),
    db.from("search_console_queries").select("provider, query, clicks, impressions, ctr, position, period_end").eq("client_domain_id", cid).gte("period_end", addDays(today, -60)).limit(5000),
    db.from("key_pages").select("url, origin, cluster_ids, added_on, removed_on").eq("client_domain_id", cid).is("removed_on", null).limit(50),
    // Map pack grids (22 Oct 2026, lib/local): only whether there are any, for the nav. The page reads them itself.
    db.from("local_grids").select("id", { count: "exact", head: true }).eq("client_domain_id", cid).eq("active", true),
  ]);
  const core = clustersErr ?? keywordsErr ?? promptsErr ?? runsErr;
  if (core) throw new Error(`could not read what is tracked: ${core.message}`);
  // The DIY reads and the 17 Oct tables are extras: a failure or an absent table draws an empty section, never a broken page.
  if (footErr) console.warn(`[dash] footprint read failed: ${footErr.message}`);
  if (oppsErr) console.warn(`[dash] opportunities read failed: ${oppsErr.message}`);
  if (placeErr) console.warn(`[dash] placements read failed: ${placeErr.message}`);
  if (connErr && !absent(connErr)) console.warn(`[dash] connections read failed: ${connErr.message}`);
  if (consoleErr && !absent(consoleErr)) console.warn(`[dash] console read failed: ${consoleErr.message}`);
  if (keyPageErr && !absent(keyPageErr)) console.warn(`[dash] key pages read failed: ${keyPageErr.message}`);
  if (gridErr && !absent(gridErr)) console.warn(`[dash] grid count failed: ${gridErr.message}`);

  // Started together, awaited one by one: paged() throws on any page's error, so nothing here is held unchecked.
  const serpRead = paged<RawSerp>(() => db.from("tracking_serp").select("run_date, keyword_id, position, url").eq("client_domain_id", cid).gte("run_date", addDays(today, -SERP_DAYS)).order("run_date").order("id"), "positions");
  const verdictRead = paged<RawAnswer>(() => db.from("tracking_answers").select("run_date, question_id, engine, answered, named").eq("client_domain_id", cid).gte("run_date", since).lt("run_date", sourcesSince).order("run_date").order("id"), "answers");
  const citeRead = paged<RawAnswer>(() => db.from("tracking_answers").select("run_date, question_id, engine, answered, named, brands, citations").eq("client_domain_id", cid).gte("run_date", sourcesSince).order("run_date").order("id"), "recent answers");
  // A later read failing while an earlier one is awaited is still thrown below, not reported unhandled.
  for (const r of [verdictRead, citeRead]) r.catch(() => undefined);
  const serp = await serpRead;
  const verdicts = await verdictRead;
  const cites = await citeRead;

  const keywords = ((keywordRows ?? []) as Partial<RawKeyword>[]).map((k) => ({ cluster_id: null, group_id: null, ...k })) as RawKeyword[];
  const clusters = (clusterRows ?? []) as Raw["clusters"];
  // Before the migration a keyword's cluster is only the cluster's keyword_id; after it, the backfill states it on the keyword.
  for (const k of keywords) if (!k.cluster_id) k.cluster_id = clusters.find((c) => c.keyword_id === k.id)?.id ?? null;
  const prompts = ((promptRows ?? []) as Partial<RawPrompt>[]).map((p) => ({ group_id: null, ...p })) as RawPrompt[];

  const rawClient: RawClient = {
    id: client.id,
    slug: client.slug,
    domain: client.domain,
    brand: client.brand,
    market: client.market,
    tier: (["tracked", "mentioned", "cited", "everywhere"].includes(client.tier) ? client.tier : "tracked") as TierKey,
    status: client.status ?? "active",
    started_on: client.started_on,
    cluster_limit: client.cluster_limit ?? 10,
    trial_ends_at: client.trial_ends_at ?? null,
    payment_status: extra?.payment_status ?? client.payment_status ?? null,
    brand_aliases: extra?.brand_aliases ?? [],
  };
  const foot = (footRows?.[0] ?? null) as { pulled_on: Day; rows: unknown } | null;

  return {
    client: rawClient,
    role,
    today,
    clusters,
    groups: groupsReady ? ((groupRows ?? []) as RawGroup[]) : [],
    keywords,
    prompts,
    runs: (runRows ?? []) as RawRun[],
    serp,
    answers: [...verdicts, ...cites],
    footprint: foot ? { pulled_on: foot.pulled_on, rows: Array.isArray(foot.rows) ? (foot.rows as FootRow[]) : [] } : null,
    opportunities: (oppsErr ? [] : (oppRows ?? [])) as RawOpportunity[],
    placements: (placeErr ? [] : (placeRows ?? [])) as RawPlacement[],
    connections: (connErr ? [] : (connRows ?? [])) as RawConnection[],
    consoleRows: (consoleErr ? [] : (consoleData ?? [])) as RawConsoleRow[],
    groupsReady,
    keyPages: (keyPageErr ? [] : (keyPageRows ?? [])) as KeyPageRow[],
    localGrids: gridErr ? 0 : (gridCount ?? 0),
  };
}
