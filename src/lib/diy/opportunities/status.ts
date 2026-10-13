import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, formatDay } from "../../tracking/figures.ts";
import { urlKey as keyOf } from "../../tracking/placements.ts";
import { ASK_REFUSED } from "../../tracking/ask.ts";
import { refuseRole } from "../../tracking/stop.ts";
import { allowanceFor } from "../core/allowances.ts";
import { type RefusalCode, refusalWords } from "../core/caps.ts";
import type { Candidate } from "../plan/types.ts";
import { getPlanItem, updatePlanItem, upsertPlanItemFor } from "../plan/write.ts";

import { bare } from "./classify-rules.ts";
import { planKindFor } from "./routes.ts";
import { verificationOf } from "./verify.ts";
import {
  ACTIVE,
  type DismissReason,
  EMPTY_EVIDENCE,
  HISTORY_MAX,
  type HistoryEntry,
  type Lens,
  OPP_COLUMNS,
  OPP_LIMITS,
  type OppEvidence,
  type OppStatus,
  type Opportunity,
  PAGE_TYPE_LABEL,
  type PageType,
  type Route,
  STATUS_LABEL,
  isLens,
  isRoute,
  isStatus,
  pickDismiss,
  pickDomainType,
  pickPageType,
} from "./types.ts";

/**
 * Statuses: who may move an opportunity, from where to where, and the writes
 * (13 Oct 2026, DIY P7; spec 10 sections 2.2, 2.5, 3.6 and 4.7). The rule is
 * pure (`decideOpp`); the writes take the database, each looking at its own
 * error and each held to one client's row and to the status it was read
 * with, so two members moving one row cannot both win.
 *
 * | Do        | From                         | To         |
 * |-----------|------------------------------|------------|
 * | pursue    | new, declined, dismissed     | pursuing   |
 * | pitched   | pursuing                     | pitched    |
 * | won       | pursuing, pitched            | won        |
 * | decline   | pursuing, pitched            | declined   |
 * | dismiss   | new, pursuing, pitched       | dismissed (a reason from the fixed list) |
 * | reopen    | declined, dismissed, won     | new        |
 * | note      | any                          | unchanged (0-200 characters; empty clears) |
 *
 * Owners and editors only; a viewer, and anyone on an ended client
 * (writeRole), is refused. Pursuing is capped: 10 pages in Pursuing or
 * Pitched at once, 3 in the trial (allowances.ts `pursuits`, a focus rule).
 *
 * `ensureOpportunity` and `pursueOpportunity` are exported for P10's Links
 * route, and accept every lens, the link lenses included.
 */

export const OPP_DOS = ["pursue", "pitched", "won", "decline", "dismiss", "reopen", "note"] as const;
export type OppDo = (typeof OPP_DOS)[number];
export const isOppDo = (v: unknown): v is OppDo => typeof v === "string" && (OPP_DOS as readonly string[]).includes(v);

export type OppDone = "pursued" | "pitched" | "won" | "declined" | "dismissed" | "reopened" | "noted" | "logged" | "already" | "verified" | "asked" | "asked_agency" | "prompt_added" | "prompt_duplicate" | "prompt_undone" | "prompt_swapped" | "watching" | "refused";
export type OppWhy =
  | "viewer"
  | "ended"
  | "gone"
  | "move"
  | "cap"
  | "reason"
  | "note"
  | "failed"
  | "readonly"
  | "url"
  | "cannot_log"
  | "dark"
  | "spend"
  | "ask_refused"
  | "ask_capped"
  | "prompt"
  | "prompt_none"
  | "pending"
  // A paid read refused (spec 10 section 5.6), each with that section's words (caps.ts refusalWords).
  | "running"
  | "paused"
  | "daily"
  | "month"
  | "allowance"
  | "inactive";

/** Every code the routes answer with, so a page draws words only for a code it knows. */
export const OPP_DONE: readonly OppDone[] = ["pursued", "pitched", "won", "declined", "dismissed", "reopened", "noted", "logged", "already", "verified", "asked", "asked_agency", "prompt_added", "prompt_duplicate", "prompt_undone", "prompt_swapped", "watching", "refused"];

/**
 * A refused paid read as the toast code it is answered with (13 Oct 2026,
 * review of DIY P7: Verify now and Log a site dropped runOnDemand's refusal,
 * and Verify said "Checked just now" when the paid read had been refused).
 */
export function readWhy(code: RefusalCode): OppWhy {
  switch (code) {
    case "tracking_running":
      return "running";
    case "global_daily":
    case "model_headroom":
      return "paused";
    case "door_daily":
      return "daily";
    case "month_budget":
      return "month";
    case "allowance":
      return "allowance";
    case "disabled":
      return "dark";
    case "client_inactive":
      return "inactive";
    case "ledger_unreadable":
    case "deadline":
    case "fixture":
      return "spend";
  }
}

/** The refusal each read code stands for, so its words are section 5.6's own. */
const WHY_REFUSAL: Partial<Record<OppWhy, RefusalCode>> = { running: "tracking_running", paused: "global_daily", daily: "door_daily", month: "month_budget", allowance: "allowance", dark: "disabled", inactive: "client_inactive", spend: "ledger_unreadable" };

export const VIEWER_REASON = "Viewers can't change this. Ask an owner or editor.";
export const ENDED_REASON = "This account has ended, so its opportunities are read-only.";

const FROM: Record<Exclude<OppDo, "note">, readonly OppStatus[]> = {
  pursue: ["new", "declined", "dismissed"],
  pitched: ["pursuing"],
  won: ["pursuing", "pitched"],
  decline: ["pursuing", "pitched"],
  dismiss: ["new", "pursuing", "pitched"],
  reopen: ["declined", "dismissed", "won"],
};
const TO: Record<Exclude<OppDo, "note">, OppStatus> = { pursue: "pursuing", pitched: "pitched", won: "won", decline: "declined", dismiss: "dismissed", reopen: "new" };
const DONE: Record<OppDo, OppDone> = { pursue: "pursued", pitched: "pitched", won: "won", decline: "declined", dismiss: "dismissed", reopen: "reopened", note: "noted" };

export type OppPost = { do: OppDo; reason?: unknown; note?: unknown };
export type OppRuleCtx = { role: string; ended: boolean; trial: boolean; active: number; today: Day; now: string; by: string };

export type OppDecision = { op: "refuse"; why: OppWhy } | { op: "update"; patch: Record<string, unknown>; expect: OppStatus; done: OppDone; entry: HistoryEntry; to: OppStatus };

/** The most pages a client works at once: 10, or 3 in the trial. */
export const pursuitCap = (client: { trial: boolean }): number => allowanceFor("pursuits", client);

/** The rule for one post, on the row as read. Pure. */
export function decideOpp(post: OppPost, opp: Pick<Opportunity, "status" | "pursuedOn" | "note"> | null, ctx: OppRuleCtx): OppDecision {
  if (ctx.ended) return { op: "refuse", why: "ended" };
  if (refuseRole(ctx.role)) return { op: "refuse", why: "viewer" };
  if (!opp) return { op: "refuse", why: "gone" };
  if (post.do === "note") {
    const text = typeof post.note === "string" ? post.note.replace(/\s+/g, " ").trim() : "";
    if (text.length > OPP_LIMITS.note) return { op: "refuse", why: "note" };
    return { op: "update", patch: { note: text || null }, expect: opp.status, done: "noted", entry: { at: ctx.now, kind: "note", by: ctx.by, text: text ? "Note saved" : "Note cleared" }, to: opp.status };
  }
  if (!FROM[post.do].includes(opp.status)) return { op: "refuse", why: "move" };
  let reason: DismissReason | null = null;
  if (post.do === "dismiss") {
    reason = pickDismiss(post.reason);
    if (!reason) return { op: "refuse", why: "reason" };
  }
  if (post.do === "pursue" && ctx.active >= pursuitCap({ trial: ctx.trial })) return { op: "refuse", why: "cap" };
  const to = TO[post.do];
  const patch: Record<string, unknown> = { status: to, status_at: ctx.now, status_by: ctx.by, dismiss_reason: reason, updated_at: ctx.now };
  if (post.do === "pursue" && !opp.pursuedOn) patch.pursued_on = ctx.today;
  return { op: "update", patch, expect: opp.status, done: DONE[post.do], entry: { at: ctx.now, kind: "status", status: to, by: ctx.by }, to };
}

/**
 * The toast's fixed words for a route answer. Nothing is echoed from the URL.
 * `who` is the ask's recipient as the page may name it: "nomada digital",
 * or "your account contact" - always the latter in agency mode. `resets` is
 * the day this client's allowance month turns ("1 Nov"), and `allowanceLine`
 * the used-up line for its link checks, which Log a site and Verify now share.
 */
export function oppToast(done: string | null, why: string | null, p: { cap: number; who?: string; member?: string; resets?: string; allowanceLine?: string | null } = { cap: 10 }): { tone: "good" | "bad"; text: string } | null {
  const refusal = why ? WHY_REFUSAL[why as OppWhy] : undefined;
  const readWords = refusal ? refusalWords(refusal, { resets: p.resets ?? "the 1st", allowanceLine: p.allowanceLine }) : null;
  // Logged, but the paid read behind it was refused: the row is kept, and the page is read overnight.
  if (done === "logged" && readWords) return { tone: "good", text: `Logged. It wasn't read just now: ${readWords.charAt(0).toLowerCase()}${readWords.slice(1)}` };
  const ok: Record<string, string> = {
    pursued: "Pursuing. It is checked weekly from now on.",
    pitched: "Marked pitched.",
    won: "Marked won. We'll check the page for your name and link.",
    declined: "Marked declined.",
    dismissed: "Marked not for us. It won't be suggested again.",
    reopened: "Reopened.",
    noted: "Note saved.",
    logged: "Logged. Its facts are below once it has been read.",
    already: "This page is already in your opportunities. Here it is.",
    verified: "Checked just now. The result is under Verification.",
    asked: `Sent to ${p.who ?? "nomada digital"}. ${p.who && p.who !== "nomada digital" ? "They'll" : "We'll"} reply to ${p.member ?? "you"}.`,
    asked_agency: `Sent to your account contact. They'll reply to ${p.member ?? "you"}.`,
    prompt_added: "Prompt added. It is first asked tomorrow; Undo takes it back until then.",
    prompt_duplicate: "A prompt you track already measures this page. Nothing was added.",
    prompt_undone: "Prompt taken back. The page is still pursued and watched.",
    prompt_swapped: "Swapped. The new prompt is first asked tomorrow; the old one stops after today's check.",
    watching: "Watching the page, with no prompt added.",
  };
  const no: Record<string, string> = {
    viewer: VIEWER_REASON,
    ended: ENDED_REASON,
    gone: "That page has changed or gone since you opened it. The list is up to date now.",
    move: "That isn't a move this page can make from where it is.",
    cap: `You're working ${p.cap} pages at once. Mark one won, declined or not for us to pursue another.`,
    reason: "Pick why it isn't for you.",
    note: `Notes are up to ${OPP_LIMITS.note} characters.`,
    failed: "That didn't save. Try again in a moment.",
    readonly: "This preview doesn't save changes.",
    url: "That isn't a web address we can read. Paste the page's full address, starting https://.",
    cannot_log: "That page can't be logged here.",
    dark: readWords ?? "This check isn't switched on yet.",
    spend: readWords ?? "We couldn't start that check just now. Try again in a few minutes.",
    running: readWords ?? "",
    paused: readWords ?? "",
    daily: readWords ?? "",
    month: readWords ?? "",
    allowance: readWords ?? "",
    inactive: readWords ?? "",
    ask_refused: ASK_REFUSED.refused,
    ask_capped: ASK_REFUSED.capped,
    prompt: "That prompt change didn't go through. The cluster is as it was.",
    prompt_none: "This page gives no prompt to add. It is watched for citations.",
    pending: "That prompt has had its first reading, so it stays. Stop it from Clusters if you want.",
  };
  if (done === "refused") return why && no[why] ? { tone: "bad", text: no[why]! } : { tone: "bad", text: no.failed! };
  return done && ok[done] ? { tone: "good", text: ok[done]! } : null;
}

// ---- Reading a row. ----

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): Day | null => (typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A stored history read back: named fields only, at most HISTORY_MAX. */
export function historyOf(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as { at?: unknown }).at === "string")
    .map((e) => ({
      at: String(e.at),
      kind: e.kind === "verify" || e.kind === "prompt" || e.kind === "note" ? e.kind : "status",
      ...(typeof e.status === "string" && (Object.keys(STATUS_LABEL) as string[]).includes(e.status) ? { status: e.status as OppStatus } : {}),
      ...(typeof e.by === "string" ? { by: e.by.slice(0, 254) } : {}),
      ...(typeof e.text === "string" ? { text: e.text.slice(0, 300) } : {}),
    }))
    .slice(-HISTORY_MAX) as HistoryEntry[];
}

/** One more history entry, the oldest dropped past HISTORY_MAX. */
export const withEntry = (h: readonly HistoryEntry[], e: HistoryEntry): HistoryEntry[] => [...h, e].slice(-HISTORY_MAX);

// ---- Writes. ----

/** One of this client's opportunities, or null. A failed read throws. */
export async function getOpportunityRow(db: SupabaseClient, clientId: string, id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from("opportunities").select(OPP_COLUMNS).eq("client_domain_id", clientId).eq("id", id).maybeSingle();
  if (error) throw new Error(`could not read the opportunity: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

/** How many pages this client has in Pursuing or Pitched. A failed count throws: it is never read as room. */
export async function countActive(db: SupabaseClient, clientId: string): Promise<number> {
  const { count, error } = await db.from("opportunities").select("id", { count: "exact", head: true }).eq("client_domain_id", clientId).in("status", [...ACTIVE]);
  if (error) throw new Error(`could not count the pursued pages: ${error.message || "no reason given"}`);
  if (typeof count !== "number") throw new Error("could not count the pursued pages: no count came back");
  return count;
}

/** Apply a decision to one row, only while its status is still the one it was read with. True when a row moved. */
export async function applyDecision(db: SupabaseClient, clientId: string, id: string, d: Extract<OppDecision, { op: "update" }>, history: readonly HistoryEntry[]): Promise<boolean> {
  const { data, error } = await db
    .from("opportunities")
    .update({ ...d.patch, history: withEntry(history, d.entry) })
    .eq("client_domain_id", clientId)
    .eq("id", id)
    .eq("status", d.expect)
    .select("id");
  if (error) throw new Error(`could not update the opportunity: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

export type EnsureInput = {
  lens: Lens;
  url: string;
  route: Route;
  urlKey?: string;
  domain?: string;
  title?: string | null;
  clusterId?: string | null;
  pageType?: PageType | null;
  domainType?: string | null;
  evidence?: OppEvidence;
  today: Day;
  now: string;
};

/** The row ensureOpportunity inserts. Pure, so the fixture twin writes the same shape. */
export function newRow(clientId: string, input: EnsureInput): Record<string, unknown> | null {
  if (!isLens(input.lens) || !isRoute(input.route)) return null;
  const url = input.url.trim().slice(0, OPP_LIMITS.url);
  const key = input.urlKey ?? keyOf(url);
  let host = input.domain ?? null;
  if (!host) {
    try {
      host = bare(new URL(url).hostname);
    } catch {
      host = null;
    }
  }
  if (!key || !host || !url) return null;
  return {
    client_domain_id: clientId,
    cluster_id: input.clusterId ?? null,
    lens: input.lens,
    url,
    url_key: key,
    domain: host,
    title: input.title ? input.title.slice(0, 300) : null,
    page_type: input.pageType ?? null,
    domain_type: input.domainType ?? null,
    route: input.route,
    status: "new",
    evidence: input.evidence ?? EMPTY_EVIDENCE(input.today),
    first_seen: input.today,
    last_seen: input.today,
    live: true,
    created_at: input.now,
    updated_at: input.now,
    history: [],
  };
}

/**
 * This client's opportunity for a page and lens, made when there is none
 * (every lens, the link lenses included: P10 calls this from Links). Answers
 * its id and whether this call made it; null for an input that is not one
 * (an unknown lens or route, a URL with no host). A duplicate insert - two
 * posts at once - reads the one that won.
 */
export async function ensureOpportunity(db: SupabaseClient, clientId: string, input: EnsureInput): Promise<{ id: string; created: boolean } | null> {
  const row = newRow(clientId, input);
  if (!row) return null;
  const read = async () => {
    const { data, error } = await db.from("opportunities").select("id").eq("client_domain_id", clientId).eq("url_key", row.url_key as string).eq("lens", input.lens).maybeSingle();
    if (error) throw new Error(`could not read the opportunity: ${error.message}`);
    return data ? String((data as { id: unknown }).id) : null;
  };
  const had = await read();
  if (had) return { id: had, created: false };
  const { data, error } = await db.from("opportunities").insert(row).select("id").single();
  if (!error) return { id: String((data as { id: unknown }).id), created: true };
  if (error.code !== "23505") throw new Error(`could not add the opportunity: ${error.message}`);
  const won = await read();
  if (!won) throw new Error("the opportunity was neither added nor found");
  return { id: won, created: false };
}

// ---- The Plan item a pursuit makes (section 4.7, Pursue). ----

/** The Plan item for a pursued page: verb first, its facts, the brief as where to act. Pure. */
export function planCandidate(o: Pick<Opportunity, "id" | "route" | "domain" | "title" | "clusterId" | "evidence" | "pageType" | "urlKey">): Candidate {
  const kw = o.evidence.keyword;
  const type = o.pageType ? PAGE_TYPE_LABEL[o.pageType as PageType].toLowerCase() : "page";
  const titles: Record<Route, string> = {
    ask_added: `Ask to be added to ${o.domain}'s ${type}`,
    send_correction: `Send ${o.domain} a correction`,
    get_listed: `Get listed or reviewed on ${o.domain}`,
    answer_thread: `Answer the thread on ${o.domain}`,
    offer_resource: `Offer ${o.domain} a resource`,
    publish_own: kw ? `Publish your own ${type} for '${kw}'` : `Publish your own ${type}`,
    refresh_own: kw ? `Refresh your ${type} for '${kw}'` : `Refresh your ${type}`,
    earn_link: `Earn a link from ${o.domain}`,
    ask_for_link: `Ask ${o.domain} for a link`,
    leave_it: `Read ${o.domain}`,
  };
  const e = o.evidence;
  const why: Candidate["why"] = [];
  if (e.answers > 0) why.push({ text: `Cited in ${e.answers} answer${e.answers === 1 ? "" : "s"} to ${e.prompt_count} of your prompts in the 28 days to ${formatDay(e.to)}; ${e.leaves_out} left you out.`, href: `/opportunities/${o.id}` });
  if (e.rank !== null && e.keyword) why.push({ text: `Ranks #${e.rank} on Google for '${e.keyword}'.`, href: `/opportunities/${o.id}` });
  if (!why.length) why.push({ text: "Pursued from Opportunities.", href: `/opportunities/${o.id}` });
  const effort: Candidate["effort"] = o.route === "answer_thread" || o.route === "send_correction" ? "minutes" : o.route === "publish_own" ? "days" : "hour";
  return {
    dedupeKey: `opp:${o.id}`,
    kind: planKindFor(o.route),
    severity: "gap",
    clusterId: o.clusterId,
    title: titles[o.route],
    why,
    grade: "your_data",
    effort,
    href: `/opportunities/${o.id}`,
    ref: { table: "opportunities", id: o.id },
    evidenceOn: e.last_cited ?? undefined,
  };
}

/**
 * Keeps the opportunity's Plan item in step with it: Doing while pursued,
 * Done when won, Dropped when declined or not for us. Never fatal - a Plan
 * that could not be written is logged and the status change stands.
 */
export async function syncPlanItem(db: SupabaseClient, clientId: string, o: Parameters<typeof planCandidate>[0], to: "doing" | "done" | "dropped", p: { today: Day; now: string; by: string }): Promise<boolean> {
  try {
    const made = await upsertPlanItemFor(db, clientId, planCandidate(o), { today: p.today });
    if (!made) return false;
    const item = await getPlanItem(db, clientId, made.id);
    if (!item || item.status === to) return true;
    if (to === "dropped" && item.status === "done") return true;
    const patch: Record<string, unknown> = { status: to, status_at: p.now, status_by: p.by };
    if (to === "doing" && !item.startedOn) patch.started_on = p.today;
    if (to === "done") Object.assign(patch, { done_on: p.today, started_on: item.startedOn ?? p.today });
    return await updatePlanItem(db, clientId, item.id, patch, item.status);
  } catch (err) {
    console.warn(`[diy] opportunity plan: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** The Plan move a status change makes, or null for none. */
export function planMoveFor(to: OppStatus): "doing" | "done" | "dropped" | null {
  if (to === "pursuing" || to === "pitched") return "doing";
  if (to === "won") return "done";
  if (to === "declined" || to === "dismissed") return "dropped";
  return null;
}

export type PursueAnswer = { ok: true; done: OppDone } | { ok: false; why: OppWhy };

/**
 * Pursue one of this client's opportunities (section 4.7): the cap, the move
 * to Pursuing, its first-pursued day, and its Plan item in Doing. The prompt
 * step is the route's (prompt-step.ts), after this; link lenses have none.
 * Exported for P10, which ensures a link row first and pursues it here.
 */
export async function pursueOpportunity(
  db: SupabaseClient,
  client: { id: string; trial: boolean; ended: boolean },
  id: string,
  p: { role: string; by: string; today: Day; now: string },
): Promise<PursueAnswer> {
  const row = await getOpportunityRow(db, client.id, id);
  const opp = row ? opportunityOf(row) : null;
  const active = await countActive(db, client.id);
  const d = decideOpp({ do: "pursue" }, opp, { role: p.role, ended: client.ended, trial: client.trial, active, today: p.today, now: p.now, by: p.by });
  if (d.op === "refuse") return { ok: false, why: d.why };
  if (!(await applyDecision(db, client.id, id, d, opp!.history))) return { ok: false, why: "gone" };
  await syncPlanItem(db, client.id, opp!, "doing", p);
  return { ok: true, done: d.done };
}

// ---- Reading a row back. Here rather than in data.ts, so status.ts stands alone for P10. ----

/** An evidence snapshot read back: the allow-listed keys only, each checked. */
export function evidenceOf(v: unknown, fallbackTo: Day): OppEvidence {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  const strs = (x: unknown, max: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 120).slice(0, max) : []);
  const openRaw = o.open && typeof o.open === "object" ? (o.open as Record<string, unknown>) : null;
  const open = openRaw && typeof openRaw.prompt === "string" && day(openRaw.day) && typeof openRaw.engine === "string" ? { prompt: openRaw.prompt, day: day(openRaw.day)!, engine: openRaw.engine } : null;
  return {
    to: day(o.to) ?? fallbackTo,
    answers: n(o.answers),
    leaves_out: n(o.leaves_out),
    others_named: n(o.others_named),
    prompts: strs(o.prompts, 20),
    prompt_count: n(o.prompt_count),
    engines: strs(o.engines, 8),
    competitors: strs(o.competitors, 5),
    days_14: n(o.days_14),
    days_7: n(o.days_7),
    last_cited: day(o.last_cited),
    rank: typeof o.rank === "number" && o.rank >= 1 && o.rank <= 100 ? Math.floor(o.rank) : null,
    keyword: typeof o.keyword === "string" ? o.keyword.slice(0, 200) : null,
    open,
    ...(o.own_type !== undefined ? { own_type: pickPageType(o.own_type) } : {}),
    ...(o.own_seen !== undefined ? { own_seen: n(o.own_seen) } : {}),
  };
}

/** One opportunities row as an Opportunity, or null when its lens, route or status is not one the table allows. */
export function opportunityOf(r: Record<string, unknown>): Opportunity | null {
  const id = r.id === undefined || r.id === null ? null : String(r.id);
  if (!id || !isLens(r.lens) || !isRoute(r.route) || !isStatus(r.status) || typeof r.url !== "string" || typeof r.url_key !== "string") return null;
  const fallbackTo = day(r.last_seen) ?? day(r.created_at) ?? "1970-01-01";
  const evidence = evidenceOf(r.evidence, fallbackTo);
  const firstSeen = day(r.first_seen);
  const fc = r.first_cited && typeof r.first_cited === "object" ? (r.first_cited as Record<string, unknown>) : null;
  const firstCited: Opportunity["firstCited"] = fc
    ? Object.fromEntries(
        Object.entries(fc)
          .filter(([, v]) => !!v && typeof v === "object" && day((v as { day?: unknown }).day) && typeof (v as { prompt?: unknown }).prompt === "string")
          .map(([k, v]) => [k, { day: day((v as { day: unknown }).day)!, prompt: String((v as { prompt: unknown }).prompt) }]),
      )
    : null;
  return {
    id,
    clientId: String(r.client_domain_id ?? ""),
    clusterId: str(r.cluster_id),
    lens: r.lens,
    url: r.url,
    urlKey: r.url_key,
    domain: typeof r.domain === "string" ? r.domain : "",
    title: str(r.title),
    pageType: pickPageType(r.page_type),
    domainType: pickDomainType(r.domain_type),
    route: r.route,
    status: r.status,
    dismissReason: pickDismiss(r.dismiss_reason),
    evidence,
    firstSeen,
    lastSeen: day(r.last_seen),
    live: r.live !== false,
    revealedAt: str(r.revealed_at),
    statusAt: str(r.status_at),
    statusBy: str(r.status_by),
    pursuedOn: day(r.pursued_on),
    note: str(r.note),
    promptId: str(r.prompt_id),
    verified: verificationOf(r.verified),
    firstCited: firstCited && Object.keys(firstCited).length ? firstCited : null,
    history: historyOf(r.history),
    createdAt: str(r.created_at) ?? "",
  };
}
