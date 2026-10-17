import type { SupabaseClient } from "@supabase/supabase-js";

import type { Day } from "../../tracking/figures.ts";

import type { DiyClient } from "./client.ts";

/**
 * The DIY job system's types and its due computation (13 Oct 2026, DIY P1
 * milestone M1; spec 10 section 5.7). Pure, with relative imports only, so
 * node --test loads it.
 *
 * Every per-client job is a `diy_jobs` row on (client_domain_id, kind,
 * due_on). The dispatcher (dispatch.ts, the rest of P1) runs from the two
 * existing night crons, asks `dueJobs` which kinds are due for each active
 * client, and upserts one row per answer; the worker claims rows and runs
 * each kind's handler. Nothing here reads or writes a table.
 *
 * Days here are UTC days (`diyDay`): the night passes run at 03:30 and 03:45
 * UTC, the ledger sums "today" in UTC, and the Plan's Monday is UTC's.
 */

/** How often a kind runs. `event` kinds are queued by something happening (setup confirm), never by the calendar. */
export type Cadence = "daily" | "weekly" | "monthly" | "event";

/** What a handler reports. `deferred` is a cap refusal: the worker re-queues it for tomorrow. */
export type JobOutcome = "ok" | "skipped" | "deferred" | "failed";

/** Who a paid read is for: the night's scheduled jobs, an onboarding job, or a member pressing a button. */
export type ReadTrigger = "scheduled" | "on_demand" | "onboarding";

/** The on-demand actions a member can spend on (`diy_reads.action`). */
/** 17 Oct 2026: `keyword_research` is the dashboards host's "Find keywords" (lib/dash/research.ts). */
export type OnDemandAction = "page_check" | "example" | "verify" | "link_check" | "log" | "keyword_research";

declare const READ_CTX: unique symbol;

/**
 * The capability to make a paid read (spec 5.6 item 1). Branded, so it cannot
 * be written as an object literal: only the worker (for scheduled jobs) and
 * `runOnDemand` (for routes) mint one, in the rest of P1, and every paid door
 * takes one. A feature package that tried an uncapped paid read would not
 * typecheck. Free kinds are handed none.
 */
export type ReadCtx = {
  readonly [READ_CTX]: true;
  readonly client: DiyClient;
  readonly trigger: ReadTrigger;
  /** The on-demand action this read is counted under, or null for a job. */
  readonly action: OnDemandAction | null;
  /** Epoch ms the caller must be finished by. */
  readonly deadlineMs: number;
};

/** What a handler's `run` is given (spec 5.7, plus `onboarding`). */
export type JobContext = {
  db: SupabaseClient;
  client: DiyClient;
  /** The UTC day the worker is running for. */
  today: Day;
  /** Epoch ms the handler must hand back by; the worker's 270 s budget. */
  deadlineMs: number;
  /** True when this run is the client's onboarding run of the kind (first dispatch after setup confirm). */
  onboarding: boolean;
  /** Paid kinds only. A free kind gets none, so it can make own fetches only. */
  read?: ReadCtx;
};

export type JobResult = { outcome: JobOutcome; note?: string };

/** One kind of per-client job (spec 5.7, the job handler contract). Registered in `src/lib/diy/wiring.ts` `JOB_HANDLERS` by the shell packages. */
export type JobHandler = {
  /** Unique across JOB_HANDLERS, e.g. "footprint". */
  kind: string;
  /** Free kinds run even when diy_enabled is false. */
  paid: boolean;
  cadence: Cadence;
  /** Lower runs first. */
  priority: number;
  /** Run on the first dispatch after setup confirm. */
  onboarding: boolean;
  run(ctx: JobContext): Promise<JobResult>;
};

/** A handler as the due computation reads it: everything but `run`. */
export type JobSpec = Omit<JobHandler, "run">;

/** A kind's name: lower case, words joined by underscores, at most 40 characters, so it reads in a `diy_jobs.kind` cell and a note. */
export const JOB_KIND = /^[a-z][a-z0-9_]{1,39}$/;

/** The worker's run budget inside the route's `maxDuration` 300 (spec 5.7). */
export const WORKER_BUDGET_MS = 270_000;

/** A claim older than this is stale and may be taken again (spec 5.7: the compare-and-swap's 15 minutes). */
export const STALE_CLAIM_MS = 15 * 60_000;

/** After this many attempts a row stops retrying until the kind's next due date. */
export const MAX_ATTEMPTS = 3;

/** DataForSEO reads in flight per worker, and workers per night pass: 2 x 4 = at most 8 at once (spec 5.6 item 8). */
export const WORKER_POOL = 4;
export const WORKERS_PER_PASS = 2;

/** Monthly jobs run on the start day of the month, clamped to this, so every month has the day. */
export const MONTHLY_CLAMP = 28;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function ms(d: Day): number {
  if (!DAY.test(d)) throw new Error(`not a day: ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`not a day: ${d}`);
  return t;
}

const iso = (t: number): Day => new Date(t).toISOString().slice(0, 10);

/** The UTC day a moment falls on: the DIY job system's "today". */
export function diyDay(now: number): Day {
  return iso(now);
}

/** 0 for Sunday to 6 for Saturday, of a UTC day. */
export function weekdayOf(d: Day): number {
  return new Date(ms(d)).getUTCDay();
}

/**
 * The cadence's latest scheduled day on or before `today`, or null when none
 * is due by the calendar:
 *
 * - daily: today;
 * - weekly: the latest day with the anchor's weekday (the client's start weekday);
 * - monthly: the latest day whose day of the month is the anchor's, clamped to 28;
 * - event: never.
 *
 * Nothing is scheduled before the anchor (a client whose tracking starts
 * tomorrow has nothing due today). With no anchor, only daily is.
 */
export function slotOn(cadence: Cadence, anchor: Day | null, today: Day): Day | null {
  if (cadence === "event") return null;
  const t = ms(today);
  if (anchor !== null && t < ms(anchor)) return null;
  if (cadence === "daily") return today;
  if (anchor === null) return null;
  if (cadence === "weekly") {
    const back = (weekdayOf(today) - weekdayOf(anchor) + 7) % 7;
    return iso(t - back * DAY_MS);
  }
  const dom = Math.min(Number(anchor.slice(8, 10)), MONTHLY_CLAMP);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const here = Date.UTC(y, m, dom);
  const slot = here <= t ? here : Date.UTC(y, m - 1, dom);
  return slot < ms(anchor) ? null : iso(slot);
}

/**
 * The newest `diy_jobs` row of one kind for one client, whatever its state, as
 * the dispatcher reads it. `done_at` null is a row still waiting: carried from
 * a night that ran out of time, or retrying. Undefined reads as done, the
 * rule before 13 Oct 2026's review, for a caller that does not read it.
 */
export type LastJob = { due_on: Day; created_at: string; done_at?: string | null };

/** One row the dispatcher should upsert. `onboarding` rides in the row's payload, so the worker can tell the run apart. */
export type Due = { kind: string; due_on: Day; priority: number; onboarding: boolean };

export type DueInput = {
  /** The DIY switch (`app_settings.diy_enabled`, missing read as false). */
  enabled: boolean;
  /** The UTC day of the dispatch. */
  today: Day;
  /** The newest row of this kind for this client, or null when it was never queued. */
  last: LastJob | null;
  /**
   * When this kind's newest onboarding row for this client was queued
   * (`payload.onboarding` true), read with no lookback window, or null when
   * none ever was. Undefined falls back to `last.created_at`, the rule before
   * 13 Oct 2026's review: the dispatcher reads its rows over 62 days only, so
   * an `event` kind's onboarding row aged out of that window and the kind was
   * queued as onboarding again.
   */
  onboardedAt?: string | null;
};

/**
 * Whether one kind is due for one client today, and as which row (spec 5.7):
 *
 * 1. A paid kind is queued only when DIY is on and the client's setup is
 *    confirmed. Free kinds are queued for every active client.
 * 2. Onboarding: a kind with `onboarding` is due today when setup is
 *    confirmed and no onboarding row of the kind has been queued since the
 *    confirm (`onboardedAt`). That is the first dispatch after confirm, and,
 *    for a client confirmed before DIY was switched on, the first dispatch
 *    after it was.
 * 3. Otherwise by the calendar: due on its latest slot (`slotOn`) when the
 *    newest row of the kind is older than that slot and done. A row still
 *    waiting - carried from a night that ran out of time, or retrying - is the
 *    slot's row already, so nothing new is queued while it waits, whatever
 *    the cadence: a full night window does not grow its backlog by a row per
 *    daily kind per client per night (13 Oct 2026, review of DIY P1). A row
 *    that used its three attempts is closed (by the worker, or by the
 *    dispatcher's `expireAbandoned` when its third attempt never closed), so
 *    it stops there until the next slot.
 *
 * Ended and paused clients have nothing due (the dispatcher reads active ones only; `dueJobs` checks again).
 */
export function dueFor(spec: JobSpec, client: Pick<DiyClient, "startedOn" | "setupConfirmedAt">, p: DueInput): Due | null {
  const confirmed = client.setupConfirmedAt !== null;
  if (spec.paid && !(p.enabled && confirmed)) return null;
  const at = (due_on: Day, onboarding: boolean): Due => ({ kind: spec.kind, due_on, priority: spec.priority, onboarding });
  if (spec.onboarding && confirmed) {
    const since = Date.parse(client.setupConfirmedAt!);
    const onboarded = p.onboardedAt !== undefined ? p.onboardedAt : (p.last?.created_at ?? null);
    const queuedSince = onboarded !== null && Date.parse(onboarded) >= since;
    if (!queuedSince) return at(p.today, true);
  }
  const slot = slotOn(spec.cadence, client.startedOn, p.today);
  if (slot === null) return null;
  if (p.last !== null && (p.last.due_on >= slot || p.last.done_at === null)) return null;
  return at(slot, false);
}

/**
 * Every kind due for one client today, oldest slot first, then by priority.
 * `last` maps a kind to its newest row. Kinds must be unique (`refuseHandlers`).
 */
export function dueJobs(
  specs: readonly JobSpec[],
  client: Pick<DiyClient, "status" | "startedOn" | "setupConfirmedAt">,
  p: { enabled: boolean; today: Day; last: ReadonlyMap<string, LastJob>; onboarded?: ReadonlyMap<string, string> },
): Due[] {
  if (client.status !== "active") return [];
  return specs
    .map((s) =>
      dueFor(s, client, {
        enabled: p.enabled,
        today: p.today,
        last: p.last.get(s.kind) ?? null,
        ...(p.onboarded ? { onboardedAt: p.onboarded.get(s.kind) ?? null } : {}),
      }),
    )
    .filter((d): d is Due => d !== null)
    .sort(byClaimOrder);
}

/** The order rows are claimed in: oldest due first (carried rows before tonight's), then lower priority first, then kind. */
export function byClaimOrder(a: { due_on: Day; priority: number; kind: string }, b: { due_on: Day; priority: number; kind: string }): number {
  if (a.due_on !== b.due_on) return a.due_on < b.due_on ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

/** A `diy_jobs` row as the claim reads it. */
export type ClaimRow = { due_on: Day; claimed_at: string | null; done_at: string | null; attempts: number };

/**
 * Whether a row may be claimed now: due, not done, under its attempts, and
 * never claimed or claimed more than STALE_CLAIM_MS ago. The worker's
 * compare-and-swap update states the same condition in SQL; this is its
 * pure twin, for the worker's tests and for the pages' "retry tonight" line.
 */
export function claimable(row: ClaimRow, today: Day, now: number): boolean {
  if (row.done_at !== null || row.due_on > today || row.attempts >= MAX_ATTEMPTS) return false;
  return row.claimed_at === null || now - Date.parse(row.claimed_at) > STALE_CLAIM_MS;
}

/**
 * `claimable`'s claim condition as a PostgREST filter, for the worker's claim
 * and the dispatcher's count: never claimed, or claimed before the stale
 * line. Quoted, so the timestamp's colons and dots are read as a value
 * (checkout/payment.ts newerThanRecorded). With `.lt("attempts",
 * MAX_ATTEMPTS)` beside it, the rows a worker can take are chosen in SQL,
 * before any limit (13 Oct 2026, review of DIY P1).
 */
export function unclaimedOrStale(now: number): string {
  return `claimed_at.is.null,claimed_at.lt."${new Date(now - STALE_CLAIM_MS).toISOString()}"`;
}

/**
 * What is wrong with a set of handlers, one line each; empty when nothing is.
 * Kinds are unique and well formed, and priorities fit `diy_jobs.priority`.
 * The shell packages' wiring test runs it over `JOB_HANDLERS`.
 */
export function refuseHandlers(specs: readonly JobSpec[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of specs) {
    if (!JOB_KIND.test(s.kind)) out.push(`${s.kind}: not a job kind (lower case, underscores, 2-40 characters)`);
    if (seen.has(s.kind)) out.push(`${s.kind}: registered twice`);
    seen.add(s.kind);
    if (!Number.isInteger(s.priority) || s.priority < 0 || s.priority > 32_767) out.push(`${s.kind}: priority must be a whole number from 0 (diy_jobs.priority is a smallint)`);
  }
  return out;
}
