import { createHmac } from "node:crypto";

import { constantTimeEqual } from "../constant-time.ts";
import { isPlausibleEmail } from "../email-address.ts";
import { TASK_RATE_LIMIT, TASK_SE_ERROR, TASK_TOO_MANY } from "../scan/dataforseo-request.ts";

import { PROMPT_MAX } from "./prompt-text.ts";

/**
 * The decisions the daily tracking runner makes, with nothing in here that
 * needs a credential or a socket - so `decide.test.mts` can run every one.
 * `runner.ts` is the network half and imports `server-only`, which Node's
 * runner cannot load; anything moved back there has no executor.
 *
 * Imports are relative on purpose, for the same reason: `@/` does not resolve
 * under `node --test`.
 *
 * T1 of docs/tracked-dashboard-2026-09-29/BRIEF.md (Danny, 29 Sep 2026).
 */

/** Today's date as the dashboard dates a run: the calendar day in London. */
export function trackingDay(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is what a Postgres date column takes.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Which clients the cron dispatches a run for.
 *
 * Danny, 29 Sep 2026 (danny.md 86): client_domains already holds twelve rows,
 * every one `status = 'active'` by the migration's default and none with a
 * tracked question. A client with no active question is skipped - it would be
 * a run that reads nothing and a row that says "complete" about nothing - and
 * that is also what keeps those twelve out: only a client set up through
 * /admin/tracking has questions. `started_on` in the future is skipped too,
 * because additions start at the next daily check (BRIEF decision 7).
 */
export type ClientForDispatch = {
  id: string;
  status: string | null;
  started_on: string | null;
  activeQuestions: number;
};

export function shouldTrack(client: ClientForDispatch, today: string): boolean {
  return skipReason(client, today) === null;
}

/**
 * Why the daily dispatch skips a client on `today`, or null when it reads it -
 * shouldTrack's verdict with its reason, so the two cannot disagree.
 *
 * Every skip is now said (20 Oct 2026): alwayscited.com and nomadadigital.co.uk
 * sat at `paused` from 18 Oct, set by hand during the customer reset, and the
 * dispatch skipped them on 19 and 20 Oct without a log line or an email - run
 * health read active clients only, so the day looked clean.
 */
export function skipReason(client: ClientForDispatch, today: string): string | null {
  if (client.status !== "active") return `status is ${client.status ?? "not set"}`;
  // the start before the prompts: a client starting later has none live yet either, and its start is the reason
  if (client.started_on && client.started_on > today) return `starts on ${client.started_on}`;
  if (client.activeQuestions < 1) return "no live prompts";
  return null;
}

/** A skipped client, as the dispatch records it and run health reports it. */
export type SkippedClient = {
  id: string;
  domain: string;
  status: string | null;
  started_on: string | null;
  reason: string;
  liveClusters: number;
  activeQuestions: number;
};

/**
 * The skips somebody should hear about today: a client with live clusters that
 * is not being read. An ended client was stopped on purpose and one that starts
 * later is waiting for its first day, so neither is an alert; a paused client,
 * or an active one whose clusters have no live prompt, is.
 */
export function skipAlerts(skips: readonly SkippedClient[], today: string): SkippedClient[] {
  return skips.filter((s) => s.liveClusters > 0 && s.status !== "ended" && !(s.started_on && s.started_on > today));
}

/** A cluster is live on `day` once it has started, if it has a start, and until it is stopped. */
export function clusterLiveOn(row: { started_on: string | null; stopped_on: string | null }, day: string): boolean {
  return (row.started_on === null || row.started_on <= day) && (row.stopped_on === null || row.stopped_on > day);
}

/** A question or keyword is live on `day` if it was added by then and not yet stopped. */
export function liveOn(row: { added_on: string; stopped_on: string | null }, day: string): boolean {
  return row.added_on <= day && (row.stopped_on === null || row.stopped_on > day);
}

/**
 * The two tracking settings, read off app_settings rows.
 *
 * Fails closed: a missing or wrong-typed `tracking_enabled` is off, and a
 * missing cap is zero, so a settings read that half-worked cannot turn into
 * spend nobody bounded. The migration inserts both rows.
 */
export type TrackingSettings = { enabled: boolean; dailyCapUsd: number };

export function readTrackingSettings(rows: readonly { key: string; value: unknown }[]): TrackingSettings {
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const enabled = get("tracking_enabled") === true;
  const cap = Number(get("tracking_daily_cost_cap_usd"));
  return { enabled, dailyCapUsd: Number.isFinite(cap) && cap > 0 ? cap : 0 };
}

/** Null when a run may start, or the reason it may not. */
export function refuseRun(settings: TrackingSettings, spentTodayUsd: number): string | null {
  if (!settings.enabled) return "tracking is switched off (tracking_enabled)";
  if (spentTodayUsd >= settings.dailyCapUsd) {
    return `today's tracking spend $${spentTodayUsd.toFixed(2)} has reached the cap of $${settings.dailyCapUsd.toFixed(2)}`;
  }
  return null;
}

/**
 * The cron hands each run to its own invocation, signed so nobody else can.
 *
 * HMAC-SHA256 of the exact body, keyed on CRON_SECRET, hex. The run route
 * verifies against the raw text it received, before parsing it.
 */
export const RUN_SIGNATURE_HEADER = "x-track-signature";

export function signRun(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyRun(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  return constantTimeEqual(signature, signRun(body, secret));
}

/**
 * How a run ends. Complete only when every read landed; partial when some
 * failed after the retry; failed when none did, which is a run that measured
 * nothing and must not read as a day of zeros.
 *
 * `brandGaps` (8 Oct 2026, audit reliability-1 / data-6): engines whose brand
 * extraction left answers without the other brands named. Partial, never
 * failed - every read landed and is stored - and never complete, which is
 * what a run with a failed extraction said before, with no error line.
 */
export function runOutcome(reads: number, failed: number, brandGaps = 0): "complete" | "partial" | "failed" {
  if (reads > 0 && failed >= reads) return "failed";
  return failed > 0 || brandGaps > 0 ? "partial" : "complete";
}

/**
 * Brand extraction in the daily run (8 Oct 2026, audit reliability-1 /
 * data-6). `extractBrands` swallows a failed batch so the paid reads survive,
 * and returns which answers it covered; the runner read only the brands, so a
 * 529 stored every answer in the batch as naming no other brand. Those rows
 * shortened every rival's count and raised the client's share of voice.
 *
 * A batch that failed is retried once while the run has EXTRACT_RETRY_MIN_MS
 * left. An answer still unread is stored brands_ok=false and left out of
 * every brand figure, and the engine is a BrandGap on the run's error line.
 */
export type BrandGap = { engine: string; unread: number; answered: number; reason: string };

/**
 * Extraction starts after the reads, which may use RUN_BUDGET_MS to its last
 * five seconds, so it may run into the 30s the budget leaves under the
 * route's 300s - this much of it, keeping ten seconds to store the rows and
 * close the run. Before the bound, an extraction past 300s took every read
 * of the day with it, unstored, and the stall sweep marked the run failed.
 *
 * The bound is the runner stopping waiting (extractWithRetry's `signal`), not
 * the signal alone: the SDK sleeps out a `retry-after` between its retries
 * with no signal, so an aborted request could still keep the call open past
 * the window (review, 8 Oct 2026).
 */
export const EXTRACT_GRACE_MS = 20_000;

/** The retry starts only with this long left in the run's budget. */
export const EXTRACT_RETRY_MIN_MS = 30_000;

/** How long brand extraction may take from now, both passes: the run's budget plus the grace, never under 1ms. */
export function extractionWindowMs(remainingMs: number): number {
  return Number.isFinite(remainingMs) ? Math.max(1, remainingMs + EXTRACT_GRACE_MS) : EXTRACT_GRACE_MS;
}

/** Retry the failed batches once, only with time for it. */
export function retryExtraction(unread: number, remainingMs: number): boolean {
  return unread > 0 && remainingMs >= EXTRACT_RETRY_MIN_MS;
}

/** The retry is handed `retried` (indices into the engine's answers) and reports its failures by position in that list. */
export function stillUnread(retried: readonly number[], failedInRetry: readonly number[]): number[] {
  return failedInRetry.flatMap((i) => (retried[i] === undefined ? [] : [retried[i]!]));
}

/**
 * What `extractBrands` returns that the runner reads: `failedBlocks` index into
 * the blocks it was handed. Its `calls` is not read: the requests are counted
 * on the `billed` it is handed, live, so a pass abandoned at the deadline is
 * still billed for what it sent.
 */
export type Extracted = { brands: { brand: string }[]; failedBlocks: number[]; error?: string };

/** An extraction pass the deadline stopped waiting on. */
const OUT_OF_TIME = Symbol("out of time");

/**
 * `p`, or OUT_OF_TIME as soon as `signal` aborts, whichever comes first. `p`
 * is not stopped, only no longer waited on - the SDK may be sleeping out a
 * `retry-after` that no signal reaches - and its rejection is handled here,
 * so an abandoned pass that throws later is not an unhandled rejection.
 */
function byDeadline<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof OUT_OF_TIME> {
  if (!signal) return p;
  return new Promise((resolve, reject) => {
    const stop = () => resolve(OUT_OF_TIME);
    signal.addEventListener("abort", stop, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", stop);
        resolve(v);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(err);
      },
    );
    if (signal.aborted) stop();
  });
}

/**
 * One engine's brand extraction and its one retry, with the extractor passed
 * in so this runs under node --test. `unread` indexes `blocks`: the answers
 * whose batch failed both times, or all of them if the extractor threw - it
 * swallows a failed batch, so a throw is the unexpected case, and it used to
 * leave the engine's answers naming no one with a log line as the only trace.
 *
 * `signal` is the hard deadline (review, 8 Oct 2026). When it fires, the pass
 * in flight is no longer waited on and the answers it was handed are unread,
 * "out of time"; no pass starts after it. The extractor is handed the signal
 * by the caller, which cuts a request in flight short, but not the SDK's
 * sleep between retries, which is why this races it rather than trusting it.
 *
 * `calls` is read off `billed`, which the extractor tallies each request on as
 * it leaves: every request of every pass, failed batches' and an abandoned
 * pass's included. After the signal fires no request leaves (the SDK checks it
 * before each), so the count read at the deadline is the count.
 */
export async function extractWithRetry(
  blocks: readonly string[],
  extract: (blocks: string[], billed: { calls: number }) => Promise<Extracted>,
  remainingMs: () => number,
  signal?: AbortSignal,
): Promise<{ names: string[]; calls: number; unread: number[]; reason: string }> {
  const names: string[] = [];
  const billed = { calls: 0 };
  const pass = (some: string[]) => (signal?.aborted ? Promise.resolve(OUT_OF_TIME) : byDeadline(extract(some, billed), signal));
  let unread = blocks.map((_, i) => i);
  let reason = "";
  try {
    const out = await pass([...blocks]);
    if (out === OUT_OF_TIME) {
      reason = "out of time";
    } else {
      names.push(...out.brands.map((b) => b.brand));
      unread = out.failedBlocks;
      reason = out.error ?? "";
      if (retryExtraction(unread.length, remainingMs())) {
        const again = await pass(unread.map((i) => blocks[i]!));
        if (again === OUT_OF_TIME) {
          reason = "out of time";
        } else {
          names.push(...again.brands.map((b) => b.brand));
          unread = stillUnread(unread, again.failedBlocks);
          reason = again.error ?? reason;
        }
      }
    }
  } catch (err) {
    reason = (err instanceof Error ? err.message : String(err)).slice(0, 80);
  }
  return { names, calls: billed.calls, unread, reason: unread.length ? reason || "unknown" : "" };
}

/**
 * Whether a database error is `column` missing, as a select ("column
 * tracking_answers.brands_ok does not exist") or a write ("Could not find the
 * 'brands_ok' column ... in the schema cache") says it. A deploy can land
 * before its additive migration (AGENTS.md); the reads and the runner's write
 * that name brands_ok go again without it rather than fail.
 */
export function missingColumn(err: unknown, column: string): boolean {
  const msg = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg.includes(column) && /does not exist|could not find/i.test(msg);
}

/** The London day after `day` (YYYY-MM-DD). Additions start at the next daily check. */
export function dayAfter(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A client's dashboard slug off its domain: "www.tallyroo.com" -> "tallyroo-com". */
export function slugFor(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Field bounds for /admin/tracking, read by the form's `maxLength` and by the
 * actions. Question and keyword match the migration's check constraints
 * (8-300, 2-120); an email is at most 254 characters (RFC 5321).
 */
// question is prompt-text.ts's PROMPT_MAX, so the page's own check and every route hold one length (ON-1 review, 9 Oct 2026).
export const ADMIN_LIMITS = { scan: 200, email: 254, question: PROMPT_MAX, keyword: 120, id: 36 } as const;

/** Server-side limit:a new question or keyword is allowed only while the live count is under the limit. */
export function underLimit(liveCount: number, limit: number): boolean {
  return liveCount < limit;
}

/**
 * An account's upgrade prompts (R94, 29 Sep 2026; BRIEF-2): `nomada`, the
 * column's default, for brands sold direct; `agency` for an agency's client,
 * which names no Nomada tier and asks the agency, so it needs the agency's
 * contact email; `off` for none. Returns the row to write, or why not.
 */
export const UPSELL_MODES = ["nomada", "agency", "off"] as const;
export type UpsellMode = (typeof UPSELL_MODES)[number];

export function upsellSetting(mode: string, contact: string): { mode: UpsellMode; contact: string | null } | { error: string } {
  if (!(UPSELL_MODES as readonly string[]).includes(mode)) return { error: "Unknown prompt mode." };
  const email = contact.trim().toLowerCase();
  if (mode !== "agency") return { mode: mode as UpsellMode, contact: null };
  if (!email || email.length > ADMIN_LIMITS.email || !isPlausibleEmail(email)) return { error: "An agency account needs the agency's contact email." };
  return { mode: "agency", contact: email };
}

/** A `running` tracking run older than this was killed by the platform. */
export const TRACKING_STALL_MS = 15 * 60 * 1000;

/**
 * How a tracking read fails, retries and is summed up - 30 Sep 2026, after
 * both pilots' first real runs came back partial with every failure on
 * google_aio: rows with no text, cost 0 and no reason anywhere but a log.
 *
 * A read that got a SERP with no AI Overview is not in here at all: it is
 * answered=false with its real cost, a silence rather than a miss, which is
 * the scan's rule. Only a throw is a failed read.
 */

/** A read error as the DataForSEO layer throws it: HTTP status, task status and billed cost where known. */
export type ReadError = { status?: number; taskStatus?: number; cost?: number; name?: string; message?: string };

/** Retries after the first attempt, and the wait before each. */
export const READ_RETRY_DELAYS_MS = [1_000, 3_000] as const;

/**
 * The wait before retrying a failed read, or null for no retry. Retried: HTTP
 * 429 and 5xx, DataForSEO's server-side task codes (5xxxx), and 40101, the
 * search engine's own server error (R137, 30 Sep 2026); and since 9 Oct 2026
 * the account's own "not now" codes, 40202 and 40209 (dataforseo-request.ts
 * TASK_RATE_LIMIT, TASK_TOO_MANY), which come back with no task. The free scan's
 * engine reads use this same rule (pipeline.ts). Not retried: a
 * bad request, auth, a timeout (it already spent its budget), or a retry that
 * would not leave the read its minimum budget inside the run.
 */
export function readRetryDelay(err: unknown, attempt: number, remainingMs: number): number | null {
  const delay = READ_RETRY_DELAYS_MS[attempt];
  if (delay === undefined) return null;
  const e = (err ?? {}) as ReadError;
  const retryable =
    (typeof e.status === "number" && (e.status === 429 || e.status >= 500)) ||
    (typeof e.taskStatus === "number" && (e.taskStatus >= 50000 || e.taskStatus === TASK_SE_ERROR || e.taskStatus === TASK_RATE_LIMIT || e.taskStatus === TASK_TOO_MANY));
  if (!retryable) return null;
  return remainingMs - delay >= 10_000 ? delay : null;
}

/** What a failed attempt billed, when DataForSEO said. Never negative, never NaN. */
export function billedCost(err: unknown): number {
  const c = ((err ?? {}) as ReadError).cost;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? c : 0;
}

/** The reason a read failed, short enough to group and store: "HTTP 429", "task 50000 Internal Error", "timeout". */
export function readFailureReason(err: unknown): string {
  const e = (err ?? {}) as ReadError;
  if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
  if (typeof e.status === "number") return `HTTP ${e.status}`;
  const msg = typeof e.message === "string" ? e.message : String(err);
  const task = /^DataForSEO task (\S+): (.*)$/.exec(msg);
  if (task) return `task ${task[1]} ${task[2]}`.slice(0, 80);
  return msg.slice(0, 80);
}

/**
 * The run's error line: how many reads failed, then each engine's reasons
 * with a count - "4 of 21 reads failed - google_aio: 4 x HTTP 429". Null when
 * nothing failed. Keyword reads are listed as "keyword".
 *
 * Then any brand gap (8 Oct 2026, audit reliability-1 / data-6), after a
 * full stop - "brand extraction failed - chatgpt: other brands not read in 12
 * of 20 answers (language model error 529: Overloaded)" - so the days with
 * unread answers can be found from the runs, not only from the answers.
 */
export function failureSummary(reads: number, failures: readonly { engine: string; reason: string }[], gaps: readonly BrandGap[] = []): string | null {
  const lines: string[] = [];
  if (failures.length) {
    const groups = new Map<string, number>();
    for (const f of failures) {
      const key = `${f.engine}: ${f.reason}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const parts = [...groups].map(([key, n]) => {
      const [engine, ...rest] = key.split(": ");
      return `${engine}: ${n} x ${rest.join(": ")}`;
    });
    lines.push(`${failures.length} of ${reads} reads failed - ${parts.join("; ")}`);
  }
  if (gaps.length) {
    const parts = gaps.map((g) => `${g.engine}: other brands not read in ${g.unread} of ${g.answered} answers${g.reason ? ` (${g.reason})` : ""}`);
    lines.push(`brand extraction failed - ${parts.join("; ")}`);
  }
  return lines.length ? lines.join(". ").slice(0, 500) : null;
}

/**
 * Whether a partial run's error line (failureSummary) says reads failed, not
 * only a brand gap. No line is read failures: that is all partial meant
 * before 8 Oct 2026, and the fixture's runs carry none. The screens say "some
 * reads did not come back" only when this is true.
 */
export function readsFailedIn(error: string | null | undefined): boolean {
  return !error || !error.startsWith("brand extraction failed");
}

/**
 * A keyword read's outcome. An empty SERP (no organic results at all) is a
 * failed read with a reason, never a silent null; null stays "not in the top
 * SERP_DEPTH", which is a real finding. `rankOf` returns undefined for empty.
 */
export function keywordOutcome(rank: number | null | undefined): { failed: false; rank: number | null } | { failed: true; reason: string } {
  if (rank === undefined) return { failed: true, reason: "empty SERP: no organic results came back" };
  return { failed: false, rank };
}
