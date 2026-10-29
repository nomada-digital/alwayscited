import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../supabase/page.ts";
import { TRACKING_STALL_MS, missingColumn, trackingDay } from "./decide.ts";
import { runIsStalled } from "./dispatch.ts";

/**
 * Re-running a day's failed reads (9 Oct 2026, audit reliability-4).
 *
 * Before this a failed, partial or killed run could never be read again: "Run
 * now" refused anything not queued, the runner's claim moves only queued to
 * running, and (client, run_date) is unique. Pilot history says retryable
 * failure is common - 10 of 22 runs from 30 Sep to 8 Oct finished partial,
 * most on google_aio (verifier read, 8 Oct 2026) - and a day not read is a day the dashboard can never
 * show.
 *
 * So "Run now" on today's failed, partial or stalled run asks for a re-run
 * (askRerun) and dispatches it down the same signed path as the cron. The
 * runner claims it (claimRerun) under the same tracking_enabled switch and
 * daily cost cap, and reads again only what did not come back:
 *
 * - an answer with no row, or one that came back unanswered, is asked of the
 *   engine again (retryAnswers); so is a keyword with no position stored
 *   (retryKeywords);
 * - an answer that came back but whose other brands were not read has only
 *   its brands read again, from the text stored, by the same one extraction
 *   per engine (rebrandAnswers) - the engine is not asked again, and the
 *   row's text, named and citations stay as they were read;
 * - everything else is left as it was read.
 *
 * Unanswered includes a SERP with no AI Overview, which is a silence and not
 * a failure. The rows cannot tell the two apart - a failed read is stored
 * answered=false with no text, as a silence is - so a re-run asks both again
 * rather than guess, and a re-read that fails leaves the row it found in
 * place (keepsOld) and counts as a failed read. That over-counts, never
 * under-counts: the error line never calls a read good that was not re-read.
 *
 * Only today's run. A reading is dated by its run's run_date, and a read made
 * tomorrow stored under today would be a backfill the dashboard cannot tell
 * from a reading.
 *
 * A re-run never leaves the day worse than it found it, by construction
 * (review of b2e0019, 9 Oct 2026). The ask and the claim move nothing a
 * reader reads: a failed or partial run keeps its status, error line and
 * finished_at, so the client's Overview, the run notes, the health JSON and
 * the stall sweep see the run exactly as before, while it is asked, while it
 * reads, and for good if it is never claimed or is killed. Only the pass's
 * own close writes them, from what the day's rows now hold. A re-run the cap
 * refuses or that throws closes without touching them (restored). The ask
 * lives in a marker in step_ms (nothing else reads tracking_runs.step_ms),
 * which also holds whether an earlier pass of the run landed, so
 * first_reading - sent after a client's first run that did not fail - is not
 * sent twice for one day.
 *
 * Loadable by node --test: relative imports, no server-only, the database
 * passed in (rerun.test.mts runs it against an in-memory one).
 */

export type RerunOf = "failed" | "partial" | "stalled" | "changed";

/** Where an asked re-run is: waiting for the run route's claim, claimed and reading, or closed by its pass. */
export type RerunState = "asked" | "reading" | "closed";

/** What a run asked to be re-run carries in step_ms, from the ask until it is asked again. */
export type RerunMarker = {
  /** The status it was asked from; a stalled run is one left `running`. */
  of: RerunOf;
  /** Its error line then. */
  error: string | null;
  /** When it was asked. */
  at: string;
  /** How many times this run has been asked to re-run. */
  n: number;
  /** Whether a pass of this run already closed not failed, so first_reading was considered then. */
  landed: boolean;
  state: RerunState;
  /** Why a closed re-run left the run as it found it - refused at the claim, or thrown - for /admin/tracking. */
  why: string | null;
};

/** The label of "Run now" on a run that can be re-run, as /admin/tracking renders it and the summary mail names it. */
export const RERUN_BUTTON = "Re-run failed reads";

/** The marker on a run's step_ms, or null on the cron's pass (or anything unreadable). */
export function rerunMarker(stepMs: unknown): RerunMarker | null {
  const m = (stepMs as { rerun?: unknown } | null)?.rerun as Partial<RerunMarker> | undefined;
  if (!m || typeof m !== "object") return null;
  if (m.of !== "failed" && m.of !== "partial" && m.of !== "stalled" && m.of !== "changed") return null;
  return {
    of: m.of,
    error: typeof m.error === "string" ? m.error : null,
    at: typeof m.at === "string" ? m.at : "",
    n: typeof m.n === "number" && Number.isFinite(m.n) ? m.n : 1,
    landed: m.landed === true,
    // A state this does not know is closed: nothing claims it.
    state: m.state === "asked" || m.state === "reading" ? m.state : "closed",
    why: typeof m.why === "string" ? m.why : null,
  };
}

export type RunForRerun = {
  id: string;
  run_date: string;
  status: string;
  error: string | null;
  started_at: string | null;
  step_ms?: unknown;
};

const hhmm = (iso: string | null) => (iso ? `${iso.slice(11, 16)}Z` : "an unknown time");

/** A pass claimed at `startedAt` that has not closed in TRACKING_STALL_MS was stopped by the platform. */
const stalledSince = (startedAt: string | null, now: number) => runIsStalled({ status: "running", started_at: startedAt }, now);

/** step_ms as an object to add the marker to, keeping the pass's own timing. */
const stepObject = (stepMs: unknown): Record<string, unknown> => (stepMs && typeof stepMs === "object" && !Array.isArray(stepMs) ? { ...(stepMs as Record<string, unknown>) } : {});

/**
 * Whether a run that is not queued may be re-run, and from what. Queued runs
 * are "Run now"'s first path, which dispatches without asking anything.
 */
export function rerunVerdict(run: RunForRerun, today: string, now: number = Date.now()): { ok: true; of: RerunOf } | { ok: false; message: string } {
  if (run.run_date !== today) return { ok: false, message: "Only today's run can be re-run: a reading is dated the day it is read." };
  if (rerunMarker(run.step_ms)?.state === "reading" && !stalledSince(run.started_at, now)) {
    return { ok: false, message: `A re-run of today's run is reading (since ${hhmm(run.started_at)}). Look again once it closes, or after ${TRACKING_STALL_MS / 60_000} minutes if it never does.` };
  }
  if (run.status === "failed" || run.status === "partial") return { ok: true, of: run.status };
  if (run.status === "running") {
    if (runIsStalled(run, now)) return { ok: true, of: "stalled" };
    return { ok: false, message: `Today's run is running (since ${hhmm(run.started_at)}). It can be re-run once it ends, or after ${TRACKING_STALL_MS / 60_000} minutes if it never does.` };
  }
  return { ok: false, message: `Today's run is already ${run.status}.` };
}

/**
 * A complete run asked again because staff changed what the client tracks (29 Oct 2026, lib/agency/edit.ts): a
 * keyword change makes a new cluster with new prompts and a new keyword, and "regenerate prompts and re-run checks
 * now" reads them today rather than at tomorrow's 05:00. The re-run reads only what has no row yet - the new
 * prompts and keyword - exactly as a partial run's re-run reads what did not come back; everything the run read
 * stays as it was. Asked only by that edit, never by "Run now"; otherwise as rerunVerdict.
 */
export function changeVerdict(run: RunForRerun, today: string, now: number = Date.now()): { ok: true; of: RerunOf } | { ok: false; message: string } {
  if (run.run_date === today && run.status === "complete" && rerunMarker(run.step_ms)?.state !== "reading") return { ok: true, of: "changed" };
  return rerunVerdict(run, today, now);
}

/** The marker an ask writes: the run as it was, counted, with landed carried forward. */
export function nextMarker(run: RunForRerun, of: RerunOf, now: number = Date.now()): RerunMarker {
  const prev = rerunMarker(run.step_ms);
  return {
    of,
    error: of === "stalled" ? (run.error ?? "the run was stopped before it could record a result") : run.error,
    at: new Date(now).toISOString(),
    n: (prev?.n ?? 0) + 1,
    landed: of === "partial" || of === "changed" || prev?.landed === true,
    state: "asked",
    why: null,
  };
}

/**
 * Ask for a re-run of a failed, partial or stalled run: write its marker,
 * and nothing else. A compare-and-swap on the status read and on the marker
 * read (none, or the same ask in the same state), and on a start older than
 * TRACKING_STALL_MS for a running row or a re-run reading, so a run that is
 * genuinely still reading - or that was asked or claimed again a moment ago -
 * is never asked under itself. True when this call wrote the marker.
 */
export async function askRerun(db: SupabaseClient, run: RunForRerun, of: RerunOf, now: number = Date.now()): Promise<boolean> {
  const prev = rerunMarker(run.step_ms);
  const ask = { step_ms: { ...stepObject(run.step_ms), rerun: nextMarker(run, of, now) } };
  const staleBefore = run.status === "running" || prev?.state === "reading" ? new Date(now - TRACKING_STALL_MS).toISOString() : null;
  const { data, error } = await asRead(db.from("tracking_runs").update(ask).eq("id", run.id).eq("status", run.status), prev, staleBefore).select("id");
  if (error) throw new Error(`could not ask for a re-run of run ${run.id}: ${error.message}`);
  return (data ?? []).length === 1;
}

type Filters<B> = { eq(column: string, value: string): B; lt(column: string, value: string): B; is(column: string, value: null): B };

/** The ask's swap: the marker as it was read (none, or the same ask in the same state), and a stale start when one is needed. */
function asRead<B extends Filters<B>>(swap: B, prev: RerunMarker | null, staleBefore: string | null): B {
  const started = staleBefore ? swap.lt("started_at", staleBefore) : swap;
  return prev ? started.eq("step_ms->rerun->>at", prev.at).eq("step_ms->rerun->>state", prev.state) : started.is("step_ms->rerun", null);
}

/** The statuses a re-run is asked from: failed, partial, running for a stalled run, and complete for a change. */
const ASKED_FROM = new Set(["failed", "partial", "running", "complete"]);

/**
 * The run route's claim of an asked re-run, for a run its queued claim did
 * not take. Today's only, and only the ask it read: a compare-and-swap moves
 * the marker from asked to reading and starts the pass's clock (started_at,
 * which the stall check and a second ask read). The status, error line and
 * finished_at are not touched. Null when there is no ask to claim, so the cron
 * posting a run twice still skips it.
 */
export async function claimRerun(db: SupabaseClient, runId: string, now: number = Date.now()): Promise<{ run: Record<string, unknown>; marker: RerunMarker } | null> {
  const { data, error } = await db.from("tracking_runs").select("run_date, status, step_ms").eq("id", runId).maybeSingle();
  if (error) throw new Error(`could not read run ${runId}: ${error.message}`);
  const asked = rerunMarker(data?.step_ms);
  if (!data || asked?.state !== "asked" || !ASKED_FROM.has(data.status as string) || data.run_date !== trackingDay(new Date(now))) return null;
  const marker: RerunMarker = { ...asked, state: "reading" };
  const { data: claimed, error: cErr } = await db
    .from("tracking_runs")
    .update({ started_at: new Date(now).toISOString(), step_ms: { ...stepObject(data.step_ms), rerun: marker } })
    .eq("id", runId)
    .eq("status", data.status as string)
    .eq("step_ms->rerun->>at", asked.at)
    .eq("step_ms->rerun->>state", "asked")
    .select("id, client_domain_id, run_date, engines, dfs_cost, model_calls");
  if (cErr) throw new Error(`could not claim the re-run of run ${runId}: ${cErr.message}`);
  const run = (claimed as Record<string, unknown>[] | null)?.[0];
  return run ? { run, marker } : null;
}

/** The marker a re-run's pass closes with: closed, and why when it left the run as it was. */
export function closedMarker(m: RerunMarker, why: string | null): RerunMarker {
  return { ...m, state: "closed", why };
}

/**
 * How a re-run that read nothing it can stand behind - refused at the claim,
 * or thrown - closes. A failed or partial run is left as it was: null, so
 * its status, error line and finished_at are not written. A stalled run was
 * dead before it was asked and closes failed with its line, as the stall
 * sweep would close it.
 */
export function restored(m: RerunMarker, why: string): { status: "failed"; error: string } | null {
  if (m.of !== "stalled") return null;
  return { status: "failed", error: [m.error, why].filter(Boolean).join(" - ").slice(0, 500) };
}

/** What /admin/tracking says of today's run's re-run, or null when none was asked. */
export function rerunLine(run: { started_at: string | null; step_ms?: unknown }, now: number = Date.now()): string | null {
  const m = rerunMarker(run.step_ms);
  if (!m) return null;
  const which = m.n > 1 ? `re-run ${m.n}` : "re-run";
  if (m.state === "asked") return `${which} asked at ${hhmm(m.at)} and not claimed yet`;
  if (m.state === "reading") {
    return stalledSince(run.started_at, now)
      ? `${which} stopped before it closed (claimed ${hhmm(run.started_at)}); the run's status is as it was`
      : `${which} reading since ${hhmm(run.started_at)}`;
  }
  if (!m.why) return `${which} asked at ${hhmm(m.at)} has closed`;
  return m.of === "stalled" ? `${which} closed the stopped run as failed: ${m.why}` : `${which} left the run as it was: ${m.why}`;
}

/** A stored answer of the run being re-run, as much of it as the re-run needs. */
export type KeptAnswer = {
  run_date: string;
  question_id: string;
  engine: string;
  answered: boolean;
  named: boolean;
  brands: string[];
  /** Absent when tracking_answers has no brands_ok column yet (20261008020000 not applied), as figures.ts AnswerRow reads it. */
  brands_ok?: boolean;
};

export type KeptSerp = { run_date: string; keyword_id: string; position: number | null };

/** What the run already stored, read before a re-run asks anything. */
export type Kept = { answers: KeptAnswer[]; serp: KeptSerp[] };

export const jobKey = (questionId: string, engine: string) => `${questionId} ${engine}`;

/**
 * The run's stored answers and keyword positions, every page of each. A
 * deploy can land before 20261008020000, so a select naming brands_ok goes
 * again without it, as read-shape.ts readAnswers does.
 */
export async function readKept(db: SupabaseClient, runId: string): Promise<Kept> {
  let raw: Record<string, unknown>[];
  try {
    raw = await selectAll<Record<string, unknown>>((from, to) =>
      db.from("tracking_answers").select("run_date, question_id, engine, answered, named, brands, brands_ok").eq("run_id", runId).order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    if (!missingColumn(err, "brands_ok")) throw new Error(`could not read the run's answers: ${err instanceof Error ? err.message : String(err)}`);
    raw = await selectAll<Record<string, unknown>>((from, to) =>
      db.from("tracking_answers").select("run_date, question_id, engine, answered, named, brands").eq("run_id", runId).order("id", { ascending: true }).range(from, to),
    );
  }
  const serp = await selectAll<Record<string, unknown>>((from, to) =>
    db.from("tracking_serp").select("run_date, keyword_id, position").eq("run_id", runId).order("id", { ascending: true }).range(from, to),
  );
  return {
    answers: raw.map((a) => ({
      run_date: a.run_date as string,
      question_id: a.question_id as string,
      engine: a.engine as string,
      answered: a.answered === true,
      named: a.named === true,
      brands: Array.isArray(a.brands) ? (a.brands as unknown[]).filter((b): b is string => typeof b === "string") : [],
      ...(typeof a.brands_ok === "boolean" ? { brands_ok: a.brands_ok } : {}),
    })),
    serp: serp.map((s) => ({ run_date: s.run_date as string, keyword_id: s.keyword_id as string, position: typeof s.position === "number" ? s.position : null })),
  };
}

/** Whether the run's rows carry brands_ok, i.e. 20261008020000 is applied. */
export function hasBrandsOk(kept: Kept): boolean {
  return !kept.answers.some((a) => a.brands_ok === undefined);
}

/**
 * The engines a run's error line says brand extraction missed - "brand
 * extraction failed - chatgpt: other brands not read in 12 of 20 answers"
 * (decide.ts failureSummary). Read only when the rows cannot say it
 * themselves, before brands_ok exists.
 */
export function brandGapEngines(error: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const at = error ? error.indexOf("brand extraction failed") : -1;
  if (at < 0) return out;
  for (const m of error!.slice(at).matchAll(/(?:- |; )([a-z_]+): other brands not read/g)) out.add(m[1]!);
  return out;
}

/**
 * Which answers a re-run asks the engine again: every (prompt, engine) of the
 * day the run holds no row for, or a row that did not come back answered. An
 * answer that came back is never asked again, whatever its brands.
 */
export function retryAnswers(kept: Kept): (questionId: string, engine: string) => boolean {
  const answered = new Set(kept.answers.filter((a) => a.answered).map((a) => jobKey(a.question_id, a.engine)));
  return (questionId, engine) => !answered.has(jobKey(questionId, engine));
}

/**
 * Which answers a re-run reads the other brands of again, from the text
 * stored: answered, with brands_ok false. Without the brands_ok column no row
 * can say which of an engine's answers were missed, so every answered row of
 * an engine the error line names as a brand gap - one extraction per engine,
 * still never a read of the engine.
 */
export function rebrandAnswers(kept: Kept, priorError: string | null): (questionId: string, engine: string) => boolean {
  const gapEngines = hasBrandsOk(kept) ? null : brandGapEngines(priorError);
  const again = new Set(
    kept.answers.filter((a) => a.answered && (gapEngines ? gapEngines.has(a.engine) : a.brands_ok === false)).map((a) => jobKey(a.question_id, a.engine)),
  );
  return (questionId, engine) => again.has(jobKey(questionId, engine));
}

export type StoredText = { question_id: string; engine: string; named: boolean; response_text: string };

/** The stored text of the answers `want` names, every page, for rebrandAnswers. Nothing is read when it names none. */
export async function readStoredTexts(db: SupabaseClient, runId: string, kept: Kept, want: (questionId: string, engine: string) => boolean): Promise<StoredText[]> {
  if (!kept.answers.some((a) => want(a.question_id, a.engine))) return [];
  const rows = await selectAll<Record<string, unknown>>((from, to) =>
    db.from("tracking_answers").select("question_id, engine, named, response_text").eq("run_id", runId).eq("answered", true).order("id", { ascending: true }).range(from, to),
  ).catch((err: unknown) => {
    throw new Error(`could not read the run's stored answers: ${err instanceof Error ? err.message : String(err)}`);
  });
  return rows
    .filter((r) => typeof r.response_text === "string" && r.response_text && want(r.question_id as string, r.engine as string))
    .map((r) => ({ question_id: r.question_id as string, engine: r.engine as string, named: r.named === true, response_text: r.response_text as string }));
}

/** Which keywords a re-run reads again: those with no position stored, which is how a failed keyword read is left. */
export function retryKeywords(kept: Kept): (keywordId: string) => boolean {
  const stored = new Set(kept.serp.map((s) => s.keyword_id));
  return (keywordId) => !stored.has(keywordId);
}

/** A re-read that failed again leaves the row the run already holds; only the cron's first pass, with nothing kept, writes a failed read. */
export function keepsOld(kept: Kept | null, a: { question_id: string; engine: string; failed: boolean }): boolean {
  if (!kept || !a.failed) return false;
  return kept.answers.some((k) => k.question_id === a.question_id && k.engine === a.engine);
}

/**
 * The day's rows once a re-run has written: what it kept, with every row it
 * wrote in place of the one it replaced. first_reading's figures are the
 * day's, not only the re-read's.
 */
export function dayRows<A extends { question_id: string; engine: string }, S extends { keyword_id: string }>(
  kept: Kept,
  answers: A[],
  serp: S[],
): { answers: (A | KeptAnswer)[]; serp: (S | KeptSerp)[] } {
  const a = new Map<string, A | KeptAnswer>(kept.answers.map((k) => [jobKey(k.question_id, k.engine), k]));
  for (const r of answers) a.set(jobKey(r.question_id, r.engine), r);
  const s = new Map<string, S | KeptSerp>(kept.serp.map((k) => [k.keyword_id, k]));
  for (const r of serp) s.set(r.keyword_id, r);
  return { answers: [...a.values()], serp: [...s.values()] };
}
