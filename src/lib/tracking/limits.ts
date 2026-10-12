import type { SupabaseClient } from "@supabase/supabase-js";

import { namesSubject } from "../scan/brand-name.ts";

import { PROMPT_TRACKED } from "./prompt-text.ts";

/**
 * alwaystracked's limits, enforced on the server - C2 of
 * docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md (Danny, 29 Sep 2026).
 *
 * A client has `cluster_limit` clusters (10, plus 5 per pack). A cluster is one
 * live keyword and at most 5 live prompts. Every insert into
 * `tracked_questions`, `tracked_keywords` and `tracked_clusters` goes through
 * this file - admin actions, dashboard actions and the webhook alike - and
 * `limits.test.mts` holds that as a census. The form is never the only guard.
 *
 * `client_domains.question_limit` and `keyword_limit` stay in the table
 * (dropping them is destructive) and are no longer read: the limits are
 * derived from `cluster_limit` here.
 *
 * Prompts and keywords with no cluster ("Ungrouped", admin only, still read
 * daily - R111) count against the client's whole allowance: 5 prompts and one
 * keyword per cluster it may have.
 *
 * The refusals are pure so the tests can run each one. The writers below are
 * the only network half; the one runtime import (brand-name.ts) is relative
 * and dependency-free, so Node's runner can still load this.
 *
 * 13 Oct 2026, DIY P2 (spec 10 sections 2.5, 6.7 and 7.3; Danny's 12 Oct call,
 * "prompts come from placements"): a prompt added from a live placement has
 * `allowance = 'placement'`. It sits outside its cluster's 5 angle slots and
 * the client's `cluster_limit` x 5, and is counted in its own allowance:
 * PLACEMENT_PROMPTS_PER_CLIENT live per client, across every cluster. The
 * angle-slot and client counts below leave those rows out; only
 * `insertPrompts(..., { allowance: "placement" })` counts them. Before
 * 20261013010000 is applied there is no allowance column, so every live
 * prompt is an angle-slot prompt and none is a placement one.
 */

export const CLUSTER_BASE = 10;
export const CLUSTERS_PER_PACK = 5;
export const PROMPTS_PER_CLUSTER = 5;
export const KEYWORDS_PER_CLUSTER = 1;

/**
 * Placement prompts live per client, across every cluster (13 Oct 2026, DIY
 * P2). Per client, not per cluster, because each one adds a read on every
 * engine to a daily run already measured at 264-279 s against its 270 s
 * budget (spec 10 section 5.5). Raised only after a placed client's run is
 * measured under 240 s with them in it, with the reading and its date here.
 */
export const PLACEMENT_PROMPTS_PER_CLIENT = 10;
export const PLACEMENT_FULL = `Placement prompt allowance full (${PLACEMENT_PROMPTS_PER_CLIENT})`;

/** The pack rule: 10 + 5 per pack. Set by the webhook on `customer.subscription.updated`; no other writer. */
export function clusterLimitFor(packs: number): number {
  const n = Number.isFinite(packs) && packs > 0 ? Math.floor(packs) : 0;
  return CLUSTER_BASE + CLUSTERS_PER_PACK * n;
}

/** A new cluster is refused when the live clusters already reach `cluster_limit`. */
export function refuseCluster(liveClusters: number, clusterLimit: number): string | null {
  return liveClusters >= clusterLimit ? `At the limit of ${clusterLimit} clusters.` : null;
}

/**
 * How many prompts may still be added. `clusterLive` is the target cluster's
 * live prompt count, or null for an ungrouped prompt.
 */
export function promptRoom(p: { clientLive: number; clusterLive: number | null; clusterLimit: number }): number {
  const client = p.clusterLimit * PROMPTS_PER_CLUSTER - p.clientLive;
  const cluster = p.clusterLive === null ? Infinity : PROMPTS_PER_CLUSTER - p.clusterLive;
  return Math.max(0, Math.min(client, cluster));
}

/** A prompt is refused when its cluster already has 5 live, or the client has no room left. */
export function refusePrompts(p: { clientLive: number; clusterLive: number | null; clusterLimit: number }, adding = 1): string | null {
  if (p.clusterLive !== null && p.clusterLive + adding > PROMPTS_PER_CLUSTER) {
    return `That cluster already has ${p.clusterLive} of ${PROMPTS_PER_CLUSTER} live prompts.`;
  }
  const total = p.clusterLimit * PROMPTS_PER_CLUSTER;
  if (p.clientLive + adding > total) return `At the limit of ${total} prompts (${p.clusterLimit} clusters).`;
  return null;
}

/** A placement prompt is refused when the client already has PLACEMENT_PROMPTS_PER_CLIENT live; the angle slots are not asked. */
export function refusePlacementPrompts(live: number, adding = 1): string | null {
  return live + adding > PLACEMENT_PROMPTS_PER_CLIENT ? PLACEMENT_FULL : null;
}

/** A keyword is refused when its cluster already has one live, or the client has one per cluster already. */
export function refuseKeyword(p: { clientLive: number; clusterHasLive: boolean | null; clusterLimit: number }): string | null {
  if (p.clusterHasLive) return "That cluster already has its keyword.";
  const total = p.clusterLimit * KEYWORDS_PER_CLUSTER;
  if (p.clientLive >= total) return `At the limit of ${total} keywords (${p.clusterLimit} clusters).`;
  return null;
}

/**
 * One client's line on /admin/tracking (R101): live prompts and keywords
 * against the limits `cluster_limit` gives, and how many prompts today's
 * check reads (a prompt stopped for tomorrow still counts today).
 */
export function trackingCounts(p: { clusterLimit: number; today: string; prompts: { added_on: string; stopped_on: string | null }[]; keywords: { stopped_on: string | null }[] }) {
  return {
    prompts: p.prompts.filter((q) => q.stopped_on === null).length,
    promptLimit: p.clusterLimit * PROMPTS_PER_CLUSTER,
    checkedToday: p.prompts.filter((q) => q.added_on <= p.today && (q.stopped_on === null || q.stopped_on > p.today)).length,
    keywords: p.keywords.filter((k) => k.stopped_on === null).length,
    keywordLimit: p.clusterLimit * KEYWORDS_PER_CLUSTER,
  };
}

/** Text is editable only until the first reading. After that it is "Stop and add a new one". */
export function refuseEdit(readings: number): string | null {
  return readings > 0 ? "It already has readings, so its text is fixed. Stop it and add a new one." : null;
}

// ---- The writers. Each reads the counts, asks the rule above, then writes. ----

export type Written = { ok: true; ids: string[] } | { ok: false; message: string };

async function clusterLimitOf(db: SupabaseClient, clientId: string): Promise<number | string> {
  const { data, error } = await db.from("client_domains").select("cluster_limit").eq("id", clientId).single();
  if (error) return `Could not read the client: ${error.message}`;
  return data.cluster_limit as number;
}

async function liveCount(db: SupabaseClient, table: string, column: string, value: string): Promise<number | string> {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value).is("stopped_on", null);
  if (error) return `Could not count ${table}: ${error.message}`;
  return count ?? 0;
}

/** The column is not there yet: Postgres' undefined_column, or PostgREST's schema-cache miss (a deploy before its migration). */
export function missingColumn(e: { code?: string; message: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|Could not find the '.*' column/i.test(e.message);
}

/**
 * Live prompts on a client or in a cluster, in one pool: the angle slots
 * (`allowance` null) or the placement allowance. Before the allowance column
 * exists every live prompt is a slot prompt and none is a placement one.
 */
export async function livePromptCount(db: SupabaseClient, column: "client_domain_id" | "cluster_id", value: string, pool: "slots" | "placement"): Promise<number | string> {
  const live = () => db.from("tracked_questions").select("id", { count: "exact", head: true }).eq(column, value).is("stopped_on", null);
  const { count, error } = await (pool === "placement" ? live().eq("allowance", "placement") : live().is("allowance", null));
  if (missingColumn(error)) {
    if (pool === "placement") return 0;
    const { count: all, error: allErr } = await live();
    if (allErr) return `Could not count tracked_questions: ${allErr.message}`;
    return all ?? 0;
  }
  if (error) return `Could not count tracked_questions: ${error.message}`;
  return count ?? 0;
}

/** The room for prompts on a client, and in a cluster when one is named. Placement prompts are not in it (DIY P2). */
export async function readPromptRoom(db: SupabaseClient, clientId: string, clusterId: string | null): Promise<{ room: number; limits: { clientLive: number; clusterLive: number | null; clusterLimit: number } } | string> {
  const clusterLimit = await clusterLimitOf(db, clientId);
  if (typeof clusterLimit === "string") return clusterLimit;
  const clientLive = await livePromptCount(db, "client_domain_id", clientId, "slots");
  if (typeof clientLive === "string") return clientLive;
  let clusterLive: number | null = null;
  if (clusterId) {
    const n = await livePromptCount(db, "cluster_id", clusterId, "slots");
    if (typeof n === "string") return n;
    clusterLive = n;
  }
  const limits = { clientLive, clusterLive, clusterLimit };
  return { room: promptRoom(limits), limits };
}

/** Whether one more live cluster fits: refuseCluster()'s message, null when it does. Undoing a cluster stop asks this (stop.ts). */
export async function readClusterRefusal(db: SupabaseClient, clientId: string): Promise<string | null> {
  const clusterLimit = await clusterLimitOf(db, clientId);
  if (typeof clusterLimit === "string") return clusterLimit;
  const live = await liveCount(db, "tracked_clusters", "client_domain_id", clientId);
  if (typeof live === "string") return live;
  return refuseCluster(live, clusterLimit);
}

/**
 * A branded prompt. A prompt that names the client's own brand or domain will
 * nearly always name the client, so it lifts the named rate without measuring
 * what a buyer asks. The matcher is the same as the runner's "named":
 * namesSubject on the brand and domain, plus each brand alias.
 *
 * R133 (Danny, 30 Sep 2026, danny.md line 118): tracking one is the client's
 * choice. This replaces the refusal shipped in 9fde8d4. No writer refuses a
 * branded prompt now; the dashboard and /admin/tracking put BRANDED_CHIP on it
 * as a warning. The free scan still drops them (brand-name.ts,
 * branded-questions.test.mts), because the scan measures unprompted naming.
 */
export const BRANDED_CHIP = "Names the brand";
export const BRANDED_NOTE = "This prompt names your brand, so answers to it will nearly always name you. Kept because you chose it.";

export type Subject = { brand: string | null; domain: string; aliases?: readonly string[] | null };

export function namesBrandIn(text: string, s: Subject): boolean {
  const brand = s.brand?.trim() || s.domain;
  return namesSubject(text, brand, s.domain) || (s.aliases ?? []).filter(Boolean).some((a) => namesSubject(text, a));
}

/** The client's brand, domain and aliases, for the branded chip. */
export async function readSubject(db: SupabaseClient, clientId: string): Promise<Subject | string> {
  const { data, error } = await db.from("client_domains").select("domain, brand_name, brand_aliases").eq("id", clientId).single();
  if (error) return `Could not read the client: ${error.message}`;
  return { brand: (data.brand_name as string | null) ?? null, domain: data.domain as string, aliases: (data.brand_aliases as string[] | null) ?? [] };
}

/**
 * A prompt to insert. The origin fields (13 Oct 2026, DIY P2) are written only
 * when given, so a writer that sets none still inserts before the
 * prompt_origins migration is applied. `allowance` is never taken from the
 * row: it is `insertPrompts`' `opts.allowance`, so the pool a row lands in is
 * always the pool it was counted against.
 */
export type PromptRow = {
  text: string;
  source: string;
  added_on: string;
  added_by: string;
  angle?: string | null;
  origin_kind?: "setup" | "client" | "nomada" | "placement" | "opportunity" | "momentum";
  origin_ref?: string | null;
  allowance?: "placement" | null;
};

/**
 * Insert prompts into a client (and a cluster, or ungrouped). The whole batch is refused if it does not fit.
 * With `opts.allowance = "placement"` (DIY P2) the rows go into a cluster in the placement allowance: counted
 * against PLACEMENT_PROMPTS_PER_CLIENT, and never against the angle slots or the client's cluster_limit x 5.
 */
export async function insertPrompts(db: SupabaseClient, clientId: string, clusterId: string | null, rows: PromptRow[], opts: { allowance?: "placement" } = {}): Promise<Written> {
  if (!rows.length) return { ok: true, ids: [] };
  const placement = opts.allowance === "placement";
  if (placement) {
    if (!clusterId) return { ok: false, message: "A placement prompt goes in its placement's cluster." };
    const live = await livePromptCount(db, "client_domain_id", clientId, "placement");
    if (typeof live === "string") return { ok: false, message: live };
    const refused = refusePlacementPrompts(live, rows.length);
    if (refused) return { ok: false, message: refused };
  } else {
    const read = await readPromptRoom(db, clientId, clusterId);
    if (typeof read === "string") return { ok: false, message: read };
    const refused = refusePrompts(read.limits, rows.length);
    if (refused) return { ok: false, message: refused };
  }
  const { data, error } = await db
    .from("tracked_questions")
    .insert(rows.map((r) => ({ ...withoutAllowance(r), ...(placement ? { allowance: "placement" } : {}), client_domain_id: clientId, cluster_id: clusterId })))
    .select("id");
  // ON-1 review (9 Oct 2026): the room and text reads above are not a lock. Two saves of a cluster's drafts at once -
  // a double click before the page hydrates, or setup and Clusters in two tabs - both pass them, and one cluster would
  // be asked ten prompts a day. tracked_questions_cluster_live_text_uniq (20261009040000) refuses the second insert,
  // and as one statement it refuses all its rows: it is the duplicate refusal, in the slot rule's own words.
  if (error?.code === "23505") return { ok: false, message: PROMPT_TRACKED };
  if (error) return { ok: false, message: `Could not add the prompts: ${error.message}` };
  return { ok: true, ids: (data ?? []).map((r) => r.id as string) };
}

function withoutAllowance(r: PromptRow): Omit<PromptRow, "allowance"> {
  const out: PromptRow = { ...r };
  delete out.allowance;
  return out;
}

export type KeywordRow = { keyword: string; added_on: string; added_by: string; search_volume?: number | null; intent?: string | null };

/** Insert a keyword, ungrouped or as a cluster's one keyword (linked through `tracked_clusters.keyword_id`). */
export async function insertKeyword(db: SupabaseClient, clientId: string, clusterId: string | null, row: KeywordRow): Promise<Written> {
  const clusterLimit = await clusterLimitOf(db, clientId);
  if (typeof clusterLimit === "string") return { ok: false, message: clusterLimit };
  const clientLive = await liveCount(db, "tracked_keywords", "client_domain_id", clientId);
  if (typeof clientLive === "string") return { ok: false, message: clientLive };
  let clusterHasLive: boolean | null = null;
  if (clusterId) {
    const { data: c, error } = await db.from("tracked_clusters").select("keyword_id").eq("id", clusterId).eq("client_domain_id", clientId).single();
    if (error) return { ok: false, message: `Could not read the cluster: ${error.message}` };
    clusterHasLive = false;
    if (c.keyword_id) {
      const { data: k, error: kErr } = await db.from("tracked_keywords").select("stopped_on").eq("id", c.keyword_id as string).maybeSingle();
      if (kErr) return { ok: false, message: `Could not read the cluster's keyword: ${kErr.message}` };
      clusterHasLive = !!k && k.stopped_on === null;
    }
  }
  const refused = refuseKeyword({ clientLive, clusterHasLive, clusterLimit });
  if (refused) return { ok: false, message: refused };
  const { data, error } = await db.from("tracked_keywords").insert({ ...row, client_domain_id: clientId }).select("id").single();
  if (error) return { ok: false, message: `Could not add the keyword: ${error.message}` };
  if (clusterId) {
    const { error: lErr } = await db.from("tracked_clusters").update({ keyword_id: data.id }).eq("id", clusterId);
    if (lErr) return { ok: false, message: `Keyword added, but not linked to its cluster: ${lErr.message}` };
  }
  return { ok: true, ids: [data.id as string] };
}

export type ClusterRow = { name: string; tier: string; started_on: string; keyword_id?: string | null };

/** Insert a cluster, refused at `cluster_limit` live. */
export async function insertCluster(db: SupabaseClient, clientId: string, row: ClusterRow): Promise<Written> {
  const clusterLimit = await clusterLimitOf(db, clientId);
  if (typeof clusterLimit === "string") return { ok: false, message: clusterLimit };
  const live = await liveCount(db, "tracked_clusters", "client_domain_id", clientId);
  if (typeof live === "string") return { ok: false, message: live };
  const refused = refuseCluster(live, clusterLimit);
  if (refused) return { ok: false, message: refused };
  const { data, error } = await db.from("tracked_clusters").insert({ ...row, client_domain_id: clientId }).select("id").single();
  if (error) return { ok: false, message: `Could not add the cluster: ${error.message}` };
  return { ok: true, ids: [data.id as string] };
}

// ---- Grouping (BRIEF-3 C3). Prompts and keywords move into a cluster; nothing is re-created. ----

/** The five angles, one per scan question kind (`anthropic.ts` QuestionKind, migration 3's check). */
export const ANGLES = ["category", "positioning", "sector", "outcome", "comparison"] as const;
export type Angle = (typeof ANGLES)[number];

/** A scan question's kind is its angle; anything else is none. */
export function angleFor(kind: unknown): Angle | null {
  return (ANGLES as readonly string[]).includes(String(kind)) ? (kind as Angle) : null;
}

/**
 * Which of `ids` may be grouped into a cluster that already has `clusterLive`
 * live prompts: all of them, or a refusal. Each id must be a live, ungrouped
 * prompt of this client - a prompt is in one cluster, and moving it out of
 * another one is not grouping. Clusters of fewer than 5 are allowed (R111: 5,
 * 5 and 4), and what is not picked stays ungrouped and still read daily.
 */
export function refuseGrouping(p: { ids: string[]; ungrouped: ReadonlySet<string>; clusterLive: number }): string | null {
  if (!p.ids.length) return "Pick at least one prompt.";
  if (new Set(p.ids).size !== p.ids.length) return "A prompt was picked twice.";
  if (p.ids.some((id) => !p.ungrouped.has(id))) return "Only this client's live ungrouped prompts can be grouped.";
  if (p.clusterLive + p.ids.length > PROMPTS_PER_CLUSTER) {
    return `That cluster has ${p.clusterLive} live prompts; ${p.ids.length} more would pass ${PROMPTS_PER_CLUSTER}.`;
  }
  return null;
}

/** Move live ungrouped prompts into a cluster, setting an angle where one is known and none is set. */
export async function groupPrompts(db: SupabaseClient, clientId: string, clusterId: string, ids: string[], angles: ReadonlyMap<string, Angle | null> = new Map()): Promise<Written> {
  const { data: live, error } = await db.from("tracked_questions").select("id, angle").eq("client_domain_id", clientId).is("cluster_id", null).is("stopped_on", null);
  if (error) return { ok: false, message: `Could not read the ungrouped prompts: ${error.message}` };
  const clusterLive = await livePromptCount(db, "cluster_id", clusterId, "slots");
  if (typeof clusterLive === "string") return { ok: false, message: clusterLive };
  const refused = refuseGrouping({ ids, ungrouped: new Set((live ?? []).map((r) => r.id as string)), clusterLive });
  if (refused) return { ok: false, message: refused };
  for (const id of ids) {
    const had = (live ?? []).find((r) => r.id === id)?.angle ?? null;
    const angle = had ?? angles.get(id) ?? null;
    const { error: uErr } = await db.from("tracked_questions").update({ cluster_id: clusterId, angle }).eq("id", id).is("cluster_id", null);
    if (uErr) return { ok: false, message: `Could not group a prompt: ${uErr.message}` };
  }
  return { ok: true, ids };
}

/**
 * The angle a prompt moved into a cluster takes when it has none: the first of
 * ANGLES no live prompt of that cluster holds, so a stopped prompt's slot is
 * the one filled. Null when every angle is held.
 */
export function freeAngle(held: readonly (string | null)[]): Angle | null {
  return ANGLES.find((a) => !held.includes(a)) ?? null;
}

/**
 * R170 part 2 (Danny, 2 Oct 2026, danny.md line 180): "Move into a cluster"
 * on the Clusters page. One live ungrouped prompt into one live cluster of
 * this client, owners and editors only, under refuseGrouping's rules.
 */
export async function moveIntoCluster(db: SupabaseClient, p: { clientId: string; clusterId: string; id: string; role: string }): Promise<Written> {
  if (p.role !== "owner" && p.role !== "editor") return { ok: false, message: "Only owners and editors can change what is tracked." };
  const { data: c, error } = await db.from("tracked_clusters").select("id, stopped_on").eq("id", p.clusterId).eq("client_domain_id", p.clientId).maybeSingle();
  if (error) return { ok: false, message: `Could not read the cluster: ${error.message}` };
  if (!c) return { ok: false, message: "That cluster is not on this client." };
  if (c.stopped_on !== null) return { ok: false, message: "That cluster is stopped." };
  const { data: held, error: hErr } = await db.from("tracked_questions").select("angle").eq("cluster_id", p.clusterId).is("stopped_on", null);
  if (hErr) return { ok: false, message: `Could not read the cluster's prompts: ${hErr.message}` };
  return groupPrompts(db, p.clientId, p.clusterId, [p.id], new Map([[p.id, freeAngle((held ?? []).map((q) => q.angle as string | null))]]));
}

/** Make a live ungrouped keyword a cluster's one keyword. Refused if the cluster has a live one already. */
export async function linkKeyword(db: SupabaseClient, clientId: string, clusterId: string, keywordId: string): Promise<Written> {
  const { data: c, error } = await db.from("tracked_clusters").select("keyword_id").eq("id", clusterId).eq("client_domain_id", clientId).single();
  if (error) return { ok: false, message: `Could not read the cluster: ${error.message}` };
  if (c.keyword_id) {
    const { data: k, error: kErr } = await db.from("tracked_keywords").select("stopped_on").eq("id", c.keyword_id as string).maybeSingle();
    if (kErr) return { ok: false, message: `Could not read the cluster's keyword: ${kErr.message}` };
    if (k && k.stopped_on === null) return { ok: false, message: "That cluster already has its keyword." };
  }
  const { data: taken, error: tErr } = await db.from("tracked_clusters").select("id").eq("keyword_id", keywordId).is("stopped_on", null);
  if (tErr) return { ok: false, message: `Could not check the keyword: ${tErr.message}` };
  if ((taken ?? []).length) return { ok: false, message: "That keyword is already another cluster's." };
  const { error: lErr } = await db.from("tracked_clusters").update({ keyword_id: keywordId }).eq("id", clusterId);
  if (lErr) return { ok: false, message: `Could not link the keyword: ${lErr.message}` };
  return { ok: true, ids: [keywordId] };
}

/** Readings a prompt or keyword has; any at all fixes its text (see `refuseEdit`). */
export async function readingsFor(db: SupabaseClient, kind: "prompt" | "keyword", id: string): Promise<number | string> {
  const [table, column] = kind === "prompt" ? ["tracking_answers", "question_id"] : ["tracking_serp", "keyword_id"];
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, id);
  if (error) return `Could not count the readings: ${error.message}`;
  return count ?? 0;
}

/**
 * "Cancel trial" (Danny, 8 Oct 2026). There is no Stripe portal, so an owner
 * cancels in Settings > Billing: the subscription is set to end when the
 * trial does (cancel_at_period_end, no charge), the client keeps tracking
 * until then, and the end arrives as customer.subscription.deleted through the
 * existing plan-ended handling. After the trial the 30 days' notice terms
 * apply unchanged, so there is nothing to cancel here once it is over.
 */
export function refuseTrialCancel(p: { role: string; trialEndsAt: string | null; cancelledAt: string | null; subscriptionId: string | null; now: number }): string | null {
  if (p.role !== "owner") return "Only an owner can cancel the trial.";
  if (!p.trialEndsAt || new Date(p.trialEndsAt).getTime() <= p.now) return "There is no free trial running to cancel.";
  if (p.cancelledAt) return "The trial is already cancelled.";
  if (!p.subscriptionId) return "We could not find the trial's subscription. Ask us and we will cancel it.";
  return null;
}

export async function cancelTrial(
  db: SupabaseClient,
  p: { clientId: string; role: string; by: string; now: number; cancel: (subscriptionId: string) => Promise<boolean> },
): Promise<Written> {
  const { data: c, error: cErr } = await db.from("client_domains").select("trial_ends_at, trial_cancelled_at").eq("id", p.clientId).maybeSingle();
  if (cErr) return { ok: false, message: `could not read the client: ${cErr.message}` };
  const { data: o, error: oErr } = await db
    .from("orders")
    .select("stripe_subscription_id")
    .eq("client_domain_id", p.clientId)
    .not("trial_ends_at", "is", null)
    .not("stripe_subscription_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (oErr) return { ok: false, message: `could not read the order: ${oErr.message}` };
  const subscriptionId = (o?.[0]?.stripe_subscription_id as string | undefined) ?? null;
  const refused = refuseTrialCancel({ role: p.role, trialEndsAt: (c?.trial_ends_at as string | null) ?? null, cancelledAt: (c?.trial_cancelled_at as string | null) ?? null, subscriptionId, now: p.now });
  if (refused) return { ok: false, message: refused };
  if (!(await p.cancel(subscriptionId!))) return { ok: false, message: "Stripe did not take the cancellation. Please try again." };
  const at = new Date(p.now).toISOString();
  const { error: wErr } = await db.from("client_domains").update({ trial_cancelled_at: at }).eq("id", p.clientId).is("trial_cancelled_at", null);
  // Stripe already holds the cancellation, so a failed stamp is logged rather
  // than reported as a refusal: the owner was not charged either way.
  if (wErr) console.error(`[app] trial cancelled in Stripe but trial_cancelled_at not set on ${p.clientId}: ${wErr.message}`);
  const { error: eErr } = await db.from("dashboard_events").insert({ client_domain_id: p.clientId, member_email: p.by, event: "trial_cancelled", path: "/settings", props: {} });
  if (eErr) console.warn(`[app] trial_cancelled event not recorded: ${eErr.message}`);
  return { ok: true, ids: [p.clientId] };
}
