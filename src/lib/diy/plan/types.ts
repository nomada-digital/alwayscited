import type { SupabaseClient } from "@supabase/supabase-js";

import type { Day } from "../../tracking/figures.ts";
import type { DiyClient } from "../core/client.ts";
import type { Grade } from "../core/evidence.ts";

/**
 * The Plan's model (13 Oct 2026, DIY P3; spec 10 sections 4.6 and 6.1).
 * "Plan" is the internal name: the client sees "Actions" (section 1.1 row
 * 33), and only the route, the table and this code keep the old word.
 *
 * Every advice engine writes candidate actions into one table, plan_items,
 * through one contract, `Candidate`, so they share one card. P3 owns the
 * contract; each package registers a `CandidateSource` in
 * src/lib/diy/wiring.ts (the shell packages do the registering).
 *
 * Plain module, relative imports only, so node --test loads it.
 */

/** Every kind an item can be, as plan_items.kind's check lists them. */
export const PLAN_KINDS = [
  "unblock_crawler",
  "fix_page_status",
  "add_schema",
  "fix_schema",
  "rework_page",
  "pick_target_page",
  "resolve_split",
  "get_onto_page",
  "claim_profile",
  "answer_thread",
  "publish_own",
  "refresh_own",
  "send_correction",
  "earn_link",
  "ask_for_link",
  "reclaim_link",
  "track_keyword",
  "recover_keyword",
  "recover_prompt",
  "own_task",
] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** A candidate's severity, in the order the weekly pick takes them (section 6.1). */
export const SEVERITIES = ["blocking", "slipping", "closest", "gap", "tidy"] as const;
export type Severity = (typeof SEVERITIES)[number];
/** A stored item's severity: a member's own task is `own`, outside the order. */
export type ItemSeverity = Severity | "own";

/** The statuses, as plan_items.status's check lists them, in board order. */
export const PLAN_STATUSES = ["suggested", "todo", "doing", "done", "dropped"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const EFFORTS = ["minutes", "hour", "days"] as const;
export type Effort = (typeof EFFORTS)[number];

/** One fact behind an item: counts and dates, and where it can be seen. */
export type WhyFact = { text: string; href?: string };

/**
 * What every advice engine hands the Plan (section 6.1, the candidate
 * contract).
 *
 * `href` and each `why[].href` are paths under the client's dashboard -
 * "/clusters/c3?prompt=2" - and the page resolves them with appPath when it
 * draws them. Not built with appPath when gathered (13 Oct 2026, DIY P3): an
 * href is stored, and appPath's answer depends on APP_HOST, which can change
 * after the row is written (the dashboard host goes live dark, M1). A path
 * that is not one (`//host`, `https://`) is never stored (`clientPath`).
 */
export type Candidate = {
  /** Stable across runs: "schema:org:<keyPageId>", "opp:<opportunityId>", "kw-left-p1:<keywordId>". Unique per client. */
  dedupeKey: string;
  kind: PlanKind;
  severity: Severity;
  clusterId: string | null;
  /** Verb first, at most 70 characters in copy. */
  title: string;
  /** 1-3 facts with counts and dates. */
  why: WhyFact[];
  grade: Grade;
  sourceId?: string;
  effort: Effort;
  /** Where to act: the fix, the brief or the example. A client path, as above. */
  href: string;
  ref?: { table: string; id: string };
  /** Tie-break only (search volume). */
  volume?: number;
  /** Tie-break only: the day of the newest reading behind it. Newer first. */
  evidenceOn?: Day;
};

export type CandidateSource = {
  /** Unique across CANDIDATE_SOURCES, e.g. "tracking". */
  name: string;
  gather(db: SupabaseClient, client: DiyClient, today: Day): Promise<Candidate[]>;
};

/** "Did you change the page?", asked when an item is marked done. */
export const CHANGED = ["yes", "partly", "no"] as const;
export type Changed = (typeof CHANGED)[number];

/** What verification wrote (`markVerified`), drawn as the card's Verified line. */
export type Verified = { by: string; at: Day; text: string };

/** What the readout starts from, written when an item is marked done. */
export type ReadoutBase = { changed?: Changed };

/** One plan_items row as the pages and the job read it. */
export type PlanItem = {
  id: string;
  clusterId: string | null;
  kind: PlanKind;
  severity: ItemSeverity;
  status: PlanStatus;
  title: string;
  why: WhyFact[];
  grade: Grade | null;
  sourceId: string | null;
  effort: Effort | null;
  href: string | null;
  refTable: string | null;
  refId: string | null;
  dedupeKey: string;
  weekOf: Day | null;
  newSinceMonday: boolean;
  ownerEmail: string | null;
  note: string | null;
  hiddenUntil: Day | null;
  createdBy: string;
  createdAt: string;
  statusAt: string;
  statusBy: string | null;
  startedOn: Day | null;
  doneOn: Day | null;
  verified: Verified | null;
  readoutBase: ReadoutBase | null;
  /** The candidate's tie-breaks, kept so the Suggested column takes section 6.1's order, the weekly pick's (review, 13 Oct 2026). */
  volume: number | null;
  evidenceOn: Day | null;
  /** The weekly job's own bookkeeping (section 6.1, stale suggestions): the last day it was gathered, and runs since. */
  seenOn: Day | null;
  missed: number;
  missedOn: Day | null;
};

/** The columns every read of plan_items takes, named. */
export const PLAN_COLUMNS =
  "id, cluster_id, kind, severity, status, title, why, grade, source_id, effort, href, ref_table, ref_id, dedupe_key, week_of, new_since_monday, owner_email, note, hidden_until, created_by, created_at, status_at, status_by, started_on, done_on, verified, readout_base, volume, evidence_on, seen_on, missed, missed_on";

// ---- Words. The page and the cards read these; nothing types its own. ----

export const SEVERITY_LABEL: Record<ItemSeverity, string> = {
  blocking: "Blocking",
  slipping: "Slipping",
  closest: "Closest win",
  gap: "Biggest gap",
  tidy: "Tidy-up",
  own: "Your task",
};

export const STATUS_LABEL: Record<PlanStatus, string> = {
  suggested: "Suggested",
  todo: "To do",
  doing: "Doing",
  done: "Done",
  dropped: "Dropped",
};

/** Our estimate, always labelled as one. */
export const EFFORT_LABEL: Record<Effort, string> = {
  minutes: "about 15 minutes",
  hour: "about an hour",
  days: "a few days",
};

export const CHANGED_LABEL: Record<Changed, string> = { yes: "Yes", partly: "Partly", no: "No" };

/** The filter groups (section 4.6, Filters), in the order the page lists them. */
export const KIND_GROUPS = ["pages", "opportunities", "keywords", "tasks"] as const;
export type KindGroup = (typeof KIND_GROUPS)[number];

export const KIND_GROUP_LABEL: Record<KindGroup, string> = {
  pages: "Your pages",
  opportunities: "Opportunities and links",
  keywords: "Keywords and prompts",
  tasks: "Your tasks",
};

/** Which group each kind is filtered under. publish_own and refresh_own come from Opportunities' own-page lens, so they sit there. */
export const KIND_GROUP: Record<PlanKind, KindGroup> = {
  unblock_crawler: "pages",
  fix_page_status: "pages",
  add_schema: "pages",
  fix_schema: "pages",
  rework_page: "pages",
  pick_target_page: "pages",
  resolve_split: "pages",
  get_onto_page: "opportunities",
  claim_profile: "opportunities",
  answer_thread: "opportunities",
  publish_own: "opportunities",
  refresh_own: "opportunities",
  send_correction: "opportunities",
  earn_link: "opportunities",
  ask_for_link: "opportunities",
  reclaim_link: "opportunities",
  track_keyword: "keywords",
  recover_keyword: "keywords",
  recover_prompt: "keywords",
  own_task: "tasks",
};

/**
 * The primary button's words on a This week card (section 4.1 row 6): the
 * one that does the job. Fixes, briefs, tracking and examples have their own
 * place to act, and a slipping keyword or prompt its cluster's page; anything
 * else opens the item in Actions. Drawn only when the item has an href.
 */
export function actLabel(kind: PlanKind): string {
  switch (kind) {
    case "unblock_crawler":
    case "fix_page_status":
    case "add_schema":
    case "fix_schema":
      return "Open fix";
    case "get_onto_page":
    case "claim_profile":
    case "answer_thread":
    case "publish_own":
    case "refresh_own":
    case "send_correction":
    case "earn_link":
    case "ask_for_link":
    case "reclaim_link":
      return "Open brief";
    case "track_keyword":
      return "Track";
    case "rework_page":
      return "See the example";
    // Slipping, from tracking: the cluster's own page is where its answers and positions are.
    case "recover_keyword":
    case "recover_prompt":
      return "Open the cluster";
    default:
      return "Open in Actions";
  }
}

/**
 * Kinds that act on one of the client's own pages, where "Did you change the
 * page?" tells verification what to look for. Elsewhere the page is someone
 * else's, or there is none, and the control does not ask.
 */
export const ASKS_CHANGED: ReadonlySet<PlanKind> = new Set<PlanKind>(["unblock_crawler", "fix_page_status", "add_schema", "fix_schema", "rework_page", "pick_target_page", "resolve_split", "publish_own", "refresh_own", "recover_keyword"]);

/** A title as copy shows it: at most 70 characters, cut at a word with an ellipsis. Stored titles may be longer (the column allows 200). */
export const TITLE_COPY = 70;

export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * A path under the client's dashboard, or null. Only `/` followed by
 * something that is not a second slash or a backslash, with no scheme and no
 * control character: anything else could leave the dashboard.
 */
export function clientPath(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  if (!/^\/(?![/\\])/.test(v) || /[\u0000-\u001f\\]/.test(v) || /^\/[^?#]*:/.test(v)) return null;
  return v;
}
