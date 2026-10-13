import type { SupabaseClient } from "@supabase/supabase-js";

import { addDays } from "../../tracking/figures.ts";

import { type DiyClient, loadDiyClient } from "./client.ts";
import { pool, realSleep, mintReadCtx } from "./ctx.ts";
import {
  type JobHandler,
  type JobOutcome,
  type JobResult,
  MAX_ATTEMPTS,
  STALE_CLAIM_MS,
  WORKER_BUDGET_MS,
  WORKER_POOL,
  byClaimOrder,
  claimable,
  diyDay,
  unclaimedOrStale,
} from "./jobs.ts";

/**
 * The DIY night worker, `runDiyWorker` (13 Oct 2026, DIY P1; spec 10 section
 * 5.7). Posted twice a pass by the dispatcher to `/api/diy/run`, which answers
 * 202 and runs this in `after()` under its `maxDuration` 300.
 *
 * It loops until its 270 s budget is nearly gone or nothing is left:
 *
 * 1. claim the next due job by compare-and-swap - the update matches only the
 *    row exactly as it was read (its `attempts`, and its `claimed_at` null or
 *    the stale value seen), not done, so two workers can never both take one,
 *    and a claim older than 15 minutes (a worker the platform killed) is taken
 *    again. The candidates are read claimable in SQL - under three attempts,
 *    never claimed or claimed before the stale line - before the limit, so
 *    rows that cannot be taken never fill the window and hide ones that can
 *    (13 Oct 2026, review of DIY P1: 100 rows stuck at three attempts sorted
 *    first for good and the worker answered "empty" over claimable jobs);
 * 2. run its handler, handing a paid kind a fresh ReadCtx that shares this
 *    worker's pool of 4 DataForSEO reads in flight (2 workers x 4 = at most 8
 *    at once), its one model call at a time, and its ledger lock, so every
 *    reservation the worker makes is decided after the one before it;
 * 3. close the row itself: `ok` and `skipped` done; `deferred` (a daily cap)
 *    done and queued again for tomorrow; `failed` with its message as the
 *    note - never swallowed - retried by a later pass until its third
 *    attempt, then closed until the kind's next due date.
 *
 * Handlers are idempotent (upserts on unique keys, reads cached by date), so
 * the stale reclaim double-running a slow job costs a repeat, not a wrong row
 * (section 8.1).
 *
 * Loadable by node --test: the database and handlers are handed in.
 */

/** No new job is claimed with less than this left: a handler started now would be cut off. */
export const CLAIM_MARGIN_MS = 20_000;

/** Candidates read per claim. The CAS takes one; the rest wait for the next turn of the loop. */
const CANDIDATES = 100;

/** `diy_jobs.note` is free text; this keeps it a line. */
const NOTE_MAX = 500;

export type WorkerDeps = {
  db: SupabaseClient;
  handlers: readonly JobHandler[];
  now?: () => number;
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  loadClient?: (db: SupabaseClient, id: string, now: number) => Promise<DiyClient | null>;
};

export type WorkerSummary = {
  claimed: number;
  outcomes: Record<JobOutcome, number>;
  stopped: "empty" | "budget" | "error";
  errors: string[];
};

type JobRow = {
  id: string;
  client_domain_id: string;
  kind: string;
  due_on: string;
  priority: number;
  payload: { onboarding?: boolean } | null;
  claimed_at: string | null;
  done_at: string | null;
  attempts: number;
};

const COLUMNS = "id, client_domain_id, kind, due_on, priority, payload, claimed_at, done_at, attempts";
const OUTCOMES: readonly JobOutcome[] = ["ok", "skipped", "deferred", "failed"];
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Claims one due job, or answers null when there is none to take. Throws when the table cannot be read. */
export async function claimNextJob(db: SupabaseClient, today: string, now: number): Promise<JobRow | null> {
  const { data, error } = await db
    .from("diy_jobs")
    .select(COLUMNS)
    .is("done_at", null)
    .lte("due_on", today)
    .lt("attempts", MAX_ATTEMPTS)
    .or(unclaimedOrStale(now))
    .order("due_on", { ascending: true })
    .order("priority", { ascending: true })
    .limit(CANDIDATES);
  if (error) throw new Error(`could not read the due DIY jobs: ${error.message}`);
  const rows = ((data ?? []) as JobRow[]).filter((r) => claimable(r, today, now)).sort(byClaimOrder);
  const at = new Date(now).toISOString();
  for (const row of rows) {
    const patch = { claimed_at: at, attempts: row.attempts + 1 };
    const { data: took, error: casErr } = await (row.claimed_at === null
      ? db.from("diy_jobs").update(patch).eq("id", row.id).eq("attempts", row.attempts).is("done_at", null).is("claimed_at", null).select("id")
      : db.from("diy_jobs").update(patch).eq("id", row.id).eq("attempts", row.attempts).is("done_at", null).eq("claimed_at", row.claimed_at).select("id"));
    if (casErr) throw new Error(`could not claim a DIY job: ${casErr.message}`);
    if (Array.isArray(took) && took.length === 1) return { ...row, claimed_at: at, attempts: row.attempts + 1 };
  }
  return null;
}

/** Closes a claimed row with what its handler reported. Never throws: a row left claimed is reclaimed once stale, and the failure is logged. */
export async function closeJob(db: SupabaseClient, job: JobRow, result: JobResult, now: number, today: string): Promise<void> {
  const note = result.note ? result.note.slice(0, NOTE_MAX) : null;
  const finished = result.outcome !== "failed" || job.attempts >= MAX_ATTEMPTS;
  try {
    const { error } = await db
      .from("diy_jobs")
      .update({ outcome: result.outcome, note, done_at: finished ? new Date(now).toISOString() : null })
      .eq("id", job.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[diy] worker: could not close job ${job.id} (${job.kind}, ${result.outcome}): ${msg(err)}`);
  }
  if (result.outcome !== "deferred") return;
  // A daily cap refused it: queued again for tomorrow, carrying onboarding.
  try {
    const { error } = await db
      .from("diy_jobs")
      .upsert(
        [{ client_domain_id: job.client_domain_id, kind: job.kind, due_on: addDays(today, 1), priority: job.priority, payload: job.payload ?? { onboarding: false } }],
        { onConflict: "client_domain_id,kind,due_on", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[diy] worker: could not queue ${job.kind} for ${job.client_domain_id} again tomorrow: ${msg(err)}`);
  }
}

/** How many abandoned rows one pass closes at most; the rest wait for the next pass. */
const EXPIRE_BATCH = 200;

/**
 * Closes the rows whose third attempt never closed: claimed three times, the
 * last claim stale, and no `done_at` - the platform stopped the worker on its
 * third attempt, or `closeJob`'s update failed. Nothing can claim them again
 * (three attempts is the most), so without this they would sit open for
 * good: counted as carried in the run-health line, and holding the kind's
 * next slot back (jobs.ts dueFor queues nothing while the newest row waits).
 * Each is closed as failed with a note that says so, keeping the note it had,
 * by a compare-and-swap on the row as read, so a row a worker closes at the
 * same moment is left as that worker wrote it. Answers how many it closed.
 * Throws when the rows cannot be read; a single row that fails to close is
 * logged and left for the next pass (13 Oct 2026, review of DIY P1).
 */
export async function expireAbandoned(db: SupabaseClient, now: number): Promise<number> {
  const stale = new Date(now - STALE_CLAIM_MS).toISOString();
  const { data, error } = await db
    .from("diy_jobs")
    .select("id, kind, attempts, claimed_at, note")
    .is("done_at", null)
    .gte("attempts", MAX_ATTEMPTS)
    .lt("claimed_at", stale)
    .order("claimed_at", { ascending: true })
    .limit(EXPIRE_BATCH);
  if (error) throw new Error(`could not read the abandoned DIY jobs: ${error.message}`);
  let closed = 0;
  for (const row of (data ?? []) as { id: string; kind: string; attempts: number; claimed_at: string; note: string | null }[]) {
    const note = `abandoned: attempt ${row.attempts} never closed (the worker was stopped, or its close failed)${row.note ? `; last note: ${row.note}` : ""}`.slice(0, NOTE_MAX);
    try {
      const { data: took, error: upErr } = await db
        .from("diy_jobs")
        .update({ done_at: new Date(now).toISOString(), outcome: "failed", note })
        .eq("id", row.id)
        .is("done_at", null)
        .eq("attempts", row.attempts)
        .eq("claimed_at", row.claimed_at)
        .select("id");
      if (upErr) throw new Error(upErr.message);
      if (Array.isArray(took) && took.length === 1) closed += 1;
    } catch (err) {
      console.warn(`[diy] could not close abandoned job ${row.id} (${row.kind}): ${msg(err)}`);
    }
  }
  return closed;
}

/** One worker's night: claim, run, close, until the budget is nearly spent or nothing is left. */
export async function runDiyWorker(deps: WorkerDeps): Promise<WorkerSummary> {
  const now = deps.now ?? Date.now;
  const started = now();
  const deadline = started + (deps.budgetMs ?? WORKER_BUDGET_MS);
  const today = diyDay(started);
  const byKind = new Map(deps.handlers.map((h) => [h.kind, h]));
  const clients = new Map<string, DiyClient | null>();
  const reads = pool(WORKER_POOL);
  const models = pool(1);
  // One reservation decided at a time across this worker's ctxs, so each
  // decision sees the reservation before it (ledger.ts reserve).
  const ledger = pool(1);
  const sleep = deps.sleep ?? realSleep;
  const loadClient = deps.loadClient ?? loadDiyClient;
  const summary: WorkerSummary = { claimed: 0, outcomes: { ok: 0, skipped: 0, deferred: 0, failed: 0 }, stopped: "budget", errors: [] };

  while (now() < deadline - CLAIM_MARGIN_MS) {
    let job: JobRow | null;
    try {
      job = await claimNextJob(deps.db, today, now());
    } catch (err) {
      summary.errors.push(msg(err));
      summary.stopped = "error";
      console.warn(`[diy] worker: ${msg(err)}`);
      return summary;
    }
    if (!job) {
      summary.stopped = "empty";
      return summary;
    }
    summary.claimed += 1;
    const result = await runOne(job);
    summary.outcomes[result.outcome] += 1;
    if (result.outcome === "failed") console.warn(`[diy] job ${job.kind} for ${job.client_domain_id} failed: ${result.note ?? "no note"}`);
    await closeJob(deps.db, job, result, now(), today);
  }
  return summary;

  async function runOne(job: JobRow): Promise<JobResult> {
    const handler = byKind.get(job.kind);
    // Nothing will ever run it: closed as failed at once rather than retried.
    if (!handler) return { outcome: "failed", note: `no handler is registered for ${job.kind}` };
    let client: DiyClient | null;
    try {
      if (!clients.has(job.client_domain_id)) clients.set(job.client_domain_id, await loadClient(deps.db, job.client_domain_id, now()));
      client = clients.get(job.client_domain_id) ?? null;
    } catch (err) {
      return { outcome: "failed", note: `could not read the client: ${msg(err)}` };
    }
    if (!client) return { outcome: "skipped", note: "the client no longer exists" };
    if (client.status !== "active") return { outcome: "skipped", note: `the client is ${client.status}` };
    const onboarding = job.payload?.onboarding === true;
    const read = handler.paid
      ? mintReadCtx({ client, trigger: onboarding ? "onboarding" : "scheduled", action: null, deadlineMs: deadline }, { db: deps.db, now, sleep, reads, models, ledger, fixture: false })
      : undefined;
    try {
      const out = await handler.run({ db: deps.db, client, today, deadlineMs: deadline, onboarding, read });
      if (!out || !OUTCOMES.includes(out.outcome)) return { outcome: "failed", note: `${job.kind} returned no outcome` };
      return out;
    } catch (err) {
      return { outcome: "failed", note: msg(err) };
    }
  }
}
