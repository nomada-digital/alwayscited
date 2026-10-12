import "server-only";

import { enginesFor } from "@/config/pricing";
import { type TierKey } from "@/components/TierName";
import { extractBrands } from "@/lib/scan/anthropic";
import { brandKey, namesSubject, subjectKeys } from "@/lib/scan/brand-name";
import { readEngine, readKeywordPosition } from "@/lib/scan/dataforseo";
import { type Market } from "@/lib/scan/domain";
import { type Citation, type Engine, knownEngines } from "@/lib/scan/engines";
import { recordModelCallDebit } from "@/lib/scan/spend";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";

import {
  type BrandGap,
  TRACKING_STALL_MS,
  liveOn,
  readTrackingSettings,
  billedCost,
  extractWithRetry,
  extractionWindowMs,
  failureSummary,
  keywordOutcome,
  missingColumn,
  readFailureReason,
  readRetryDelay,
  refuseRun,
  runOutcome,
  trackingDay,
} from "./decide.ts";
import { firstReading } from "@/lib/email/lifecycle";
import { lifecycleOn, sendLifecycle } from "@/lib/email/lifecycle-mail";
import { siteUrl } from "@/lib/scan/verify-email";
import { appUrl } from "@/lib/app-host";
import { TIER_PLAIN } from "@/lib/tier-text";
import { upsellMode } from "./ask.ts";
import { dispatchRun } from "./dispatch.ts";
import { keywordsOnPage1, namedRate } from "./figures.ts";
import { reportRunHealthSafely } from "./health-io.ts";
import { sendLinkAlerts } from "./link-mail.ts";
import { decideLinkCheck, isLinkCheckDay, type LinkRow, readPlacement } from "./placements.ts";
import {
  type RunForRerun,
  askRerun,
  claimRerun,
  closedMarker,
  dayRows,
  hasBrandsOk,
  keepsOld,
  readKept,
  readStoredTexts,
  rebrandAnswers,
  restored,
  retryAnswers,
  retryKeywords,
  rerunVerdict,
} from "./rerun.ts";
import { readTrackable } from "./run-health.ts";

/**
 * The daily alwaystracked runner - T1 of
 * docs/tracked-dashboard-2026-09-29/BRIEF.md (Danny, 29 Sep 2026).
 *
 * `/api/cron/track` calls `dispatchTrackingRuns` once a day; each client's run
 * is handed to its own `/api/track/run` invocation, which calls
 * `runTrackingDay`. Every decision that can be made without a socket is in
 * `decide.ts`, where it is tested.
 *
 * The reads are the scan's own: `readEngine` for each question on each of the
 * tier's engines, `readKeywordPosition` for each keyword, `namesSubject` for
 * "named" (plus the client's brand aliases - one matcher, BRIEF decision 5)
 * and `extractBrands` for who else is named, batched per engine the way the
 * scan batches it rather than one call per answer.
 */

/** The scan pipeline's pool size, for the same reason: the tail sets the finish, not the burst. */
const CONCURRENCY = 28;

/** Against the 300s function ceiling, as the scan budgets itself. */
const RUN_BUDGET_MS = 270_000;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function message(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}

/** Today's tracking spend so far, across every client, off the run rows. */
async function trackingSpentOn(day: string): Promise<number> {
  const db = supabaseAdmin();
  const rows = await selectAll<{ dfs_cost: number | string | null }>((from, to) =>
    db.from("tracking_runs").select("dfs_cost").eq("run_date", day).order("id", { ascending: true }).range(from, to),
  );
  return rows.reduce((total, r) => total + Number(r.dfs_cost ?? 0), 0);
}

async function trackingSettings() {
  const { data, error } = await supabaseAdmin()
    .from("app_settings")
    .select("key, value")
    .in("key", ["tracking_enabled", "tracking_daily_cost_cap_usd"]);
  if (error) throw new Error(`could not read the tracking settings: ${error.message}`);
  return readTrackingSettings((data ?? []) as { key: string; value: unknown }[]);
}

/**
 * Write why a dispatch failed onto the run, leaving it queued so "Run now"
 * can post it again. Only a queued row: a run already claimed keeps its own.
 */
async function recordDispatchFailure(runId: string, reason: string): Promise<void> {
  const { error } = await supabaseAdmin().from("tracking_runs").update({ error: reason }).eq("id", runId).eq("status", "queued");
  if (error) throw new Error(error.message);
}

/**
 * Fire one run's invocation and do not wait for it. Also the admin "Run now" path (T2).
 *
 * Always to the canonical origin (dispatch.ts) - the 30 Sep cron dispatched
 * to its own req.url origin and neither pilot's run was ever claimed. The run
 * route answers 202 at once and does the work after its response, in its own
 * invocation, so this await is a handshake, not the run. Awaited because a
 * fire-and-forget fetch can be frozen with this function before it leaves. A
 * dispatch that fails writes its reason on the row, which stays queued.
 */
export async function dispatchTrackingRun(runId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  await dispatchRun(runId, secret, fetch, recordDispatchFailure);
}

/**
 * "Run now" on today's failed, partial or stalled run (9 Oct 2026, audit
 * reliability-4; rerun.ts). Refused by rerunVerdict - only today's, and never
 * a run or re-run still reading inside TRACKING_STALL_MS - and by the same
 * switch and daily cap the runner reads at its claim, before anything is
 * written. Then asked for by a compare-and-swap that writes only the marker:
 * the run's status and error line stay as they are until a pass closes it
 * (review of b2e0019). The caller dispatches it as any run.
 */
export async function requestRerun(run: RunForRerun, today: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const verdict = rerunVerdict(run, today);
  if (!verdict.ok) return verdict;
  const refusal = refuseRun(await trackingSettings(), await trackingSpentOn(today));
  if (refusal) return { ok: false, message: `Not re-run: ${refusal}.` };
  if (!(await askRerun(supabaseAdmin(), run, verdict.of))) return { ok: false, message: "Today's run changed while you asked. Refresh and look again." };
  return { ok: true };
}

/**
 * Insert today's run row for every client that should be tracked, and hand
 * each one to its own invocation. Returns how many were dispatched.
 */
export async function dispatchTrackingRuns(now: Date = new Date()): Promise<{
  day: string;
  dispatched: number;
  skipped: number;
  refused?: string;
}> {
  const db = supabaseAdmin();
  const day = trackingDay(now);

  const refusal = refuseRun(await trackingSettings(), await trackingSpentOn(day));
  if (refusal) return { day, dispatched: 0, skipped: 0, refused: refusal };

  // Every active client with shouldTrack's verdict over its live prompts,
  // every page of both reads (run-health.ts readTrackable; audit
  // reliability-2): one unpaged select stopped at PostgREST's thousand rows.
  let dispatched = 0;
  let skipped = 0;
  for (const client of await readTrackable(db, day)) {
    if (!client.track) {
      skipped += 1;
      continue;
    }
    // One row per client per day, unique; a second cron call inserts nothing.
    const { data: inserted, error: iErr } = await db
      .from("tracking_runs")
      .upsert(
        { client_domain_id: client.id, run_date: day, engines: [...enginesFor((client.tier as TierKey) ?? "tracked")] },
        { onConflict: "client_domain_id,run_date", ignoreDuplicates: true },
      )
      .select("id");
    if (iErr) {
      console.warn(`[track] could not open today's run for ${client.id}: ${iErr.message}`);
      continue;
    }
    const runId = inserted?.[0]?.id as string | undefined;
    if (!runId) continue;
    try {
      await dispatchTrackingRun(runId);
      dispatched += 1;
    } catch (err) {
      console.warn(`[track] could not dispatch run ${runId}: ${message(err)}`);
    }
  }
  return { day, dispatched, skipped };
}

type AnswerRow = {
  question_id: string;
  engine: Engine;
  answered: boolean;
  named: boolean;
  response_text: string | null;
  citations: Citation[];
  cost: number;
  failed: boolean;
  /** Why a failed read failed, for the run's error line. */
  reason?: string;
};

/**
 * One client's day: claim the run, read every live question on the tier's
 * engines and every live keyword, write the rows, close the run.
 *
 * Idempotent by the claim: only a `queued` row moves to `running`, so a run
 * already running or finished is skipped, however many times it is posted.
 *
 * A re-run (9 Oct 2026, audit reliability-4; rerun.ts) is a failed, partial
 * or stalled run "Run now" asked to be read again, with a marker in step_ms
 * and its status and error line left as they were. The queued claim does not
 * take it; claimRerun does, by a compare-and-swap on the ask. It is bounded
 * the same way, reads again only what did not come back, adds its spend to
 * the run's, and if the cap refuses it or it throws, leaves the run as it
 * was. The cron's pass is claimed as before, carries no marker, keeps
 * nothing, and reads and writes exactly as before.
 *
 * Every run, as it closes, asks whether the day has settled with a client not
 * complete (run-health.ts reportRunHealth): the last one to close sends the
 * day's one summary.
 */
export async function runTrackingDay(runId: string): Promise<{ status: string; skipped?: string }> {
  const db = supabaseAdmin();
  const started = Date.now();
  const remainingMs = () => RUN_BUDGET_MS - (Date.now() - started);

  const { data: claimed, error: claimErr } = await db
    .from("tracking_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "queued")
    .select("id, client_domain_id, run_date, engines");
  if (claimErr) throw new Error(`could not claim run ${runId}: ${claimErr.message}`);
  // Not queued: a re-run "Run now" asked for, if one is waiting (rerun.ts
  // claimRerun). Nothing else is claimed here, so a run posted twice is
  // still skipped.
  const again = claimed?.[0] ? null : await claimRerun(db, runId);
  const run = claimed?.[0] ?? again?.run;
  if (!run) return { status: "skipped", skipped: "not queued - already running or finished" };

  // Null on the cron's pass. On a re-run, what the run was and what its
  // earlier passes spent: the day's cap sums dfs_cost off the run rows, so a
  // re-run adds to it rather than writing over what was already billed.
  const rerun = again?.marker ?? null;
  const prior = { dfs: Number(again?.run.dfs_cost ?? 0) || 0, calls: Number(again?.run.model_calls ?? 0) || 0 };
  const spend = { dfs: 0, calls: 0 };
  let domainForDebit: string | undefined;

  // `fields` null: a re-run that read nothing it can stand behind leaves the
  // run's status, error line and finished_at as they were (rerun.ts restored),
  // and says why on its marker.
  const close = async (fields: Record<string, unknown> | null, why: string | null = null) => {
    const { error } = await db
      .from("tracking_runs")
      .update({
        ...(fields ? { ...fields, finished_at: new Date().toISOString() } : {}),
        dfs_cost: Number((prior.dfs + spend.dfs).toFixed(4)),
        model_calls: prior.calls + spend.calls,
        step_ms: { total: Date.now() - started, ...(rerun ? { rerun: closedMarker(rerun, why) } : {}) },
      })
      .eq("id", runId);
    if (error) console.warn(`[track] could not close run ${runId}: ${error.message}`);
    await recordModelCallDebit({ calls: spend.calls, reason: "tracking_run", domain: domainForDebit });
  };

  try {
    const refusal = refuseRun(await trackingSettings(), await trackingSpentOn(run.run_date as string));
    if (refusal) {
      const why = `re-run refused: ${refusal}`;
      const out = rerun ? restored(rerun, why) : { status: "failed", error: refusal };
      await close(out, rerun ? why : null);
      await reportRunHealthSafely(run.run_date as string);
      return { status: out?.status ?? rerun!.of, skipped: refusal };
    }

    const { data: client, error: clErr } = await db
      .from("client_domains")
      .select("id, domain, brand_name, topic, market, brand_aliases")
      .eq("id", run.client_domain_id)
      .single();
    if (clErr) throw new Error(`could not read the client: ${clErr.message}`);
    const domain = client.domain as string;
    domainForDebit = domain;
    const brand = (client.brand_name as string | null) ?? domain;
    const aliases = ((client.brand_aliases as string[] | null) ?? []).filter(Boolean);
    const market = client.market as Market;
    const day = run.run_date as string;

    const [{ data: qs, error: qErr }, { data: ks, error: kErr }] = await Promise.all([
      db.from("tracked_questions").select("id, text, added_on, stopped_on").eq("client_domain_id", client.id),
      db.from("tracked_keywords").select("id, keyword, added_on, stopped_on").eq("client_domain_id", client.id),
    ]);
    if (qErr) throw new Error(`could not read the questions: ${qErr.message}`);
    if (kErr) throw new Error(`could not read the keywords: ${kErr.message}`);
    const questions = (qs ?? []).filter((q) => liveOn(q as { added_on: string; stopped_on: string | null }, day));
    const keywords = (ks ?? []).filter((k) => liveOn(k as { added_on: string; stopped_on: string | null }, day));

    const engines = knownEngines(run.engines as string[] | null);
    const names = (prose: string) =>
      namesSubject(prose, brand, domain) || aliases.some((a) => namesSubject(prose, a));

    // The day's reads. A re-run asks again only those the run holds no
    // answered row or position for (rerun.ts retryAnswers, retryKeywords),
    // and reads the brands of an answer whose brands were not read from its
    // stored text, never the engine (rebrandAnswers); the cron's pass, with
    // nothing kept, asks every one and has nothing stored to read.
    const every = questions.flatMap((q) => engines.map((engine) => ({ q, engine })));
    const kept = rerun ? await readKept(db, runId) : null;
    const askAgain = kept ? retryAnswers(kept) : null;
    const rebrand = kept ? rebrandAnswers(kept, rerun!.error) : null;
    const readAgain = kept ? retryKeywords(kept) : null;
    const stored: AnswerRow[] = kept && rebrand
      ? (await readStoredTexts(db, runId, kept, rebrand)).map((s) => ({ question_id: s.question_id, engine: s.engine as Engine, answered: true, named: s.named, response_text: s.response_text, citations: [], cost: 0, failed: false }))
      : [];
    const jobs = askAgain ? every.filter(({ q, engine }) => askAgain(q.id as string, engine)) : every;
    const keywordJobs = readAgain ? keywords.filter((k) => readAgain(k.id as string)) : keywords;
    // A read that throws is retried where decide.ts says a retry is worth it
    // (429, 5xx, DataForSEO's 5xxxx), with backoff, inside the run's budget.
    // Every attempt's billed cost is kept, failed or not. A SERP with no AI
    // Overview does not throw: it is answered=false with its cost, a silence.
    // Google claiming an Overview that did not arrive gets the scan's one retry.
    const answers = await mapWithConcurrency(jobs, CONCURRENCY, async ({ q, engine }): Promise<AnswerRow> => {
      const base = { question_id: q.id as string, engine, citations: [] as Citation[] };
      let cost = 0;
      let reason = "out of time before the read";
      let claimRetried = false;
      for (let attempt = 0; ; attempt++) {
        if (remainingMs() < 5000) break;
        try {
          const read = await readEngine(engine, q.text as string, market, remainingMs());
          spend.dfs += read.cost;
          cost += read.cost;
          const claimedButAbsent = !read.answered && (read.raw as { claimed_but_absent?: boolean } | null)?.claimed_but_absent;
          if (claimedButAbsent && !claimRetried && remainingMs() >= 15_000) {
            claimRetried = true;
            continue;
          }
          return {
            ...base,
            answered: read.answered,
            named: read.answered && names(read.prose),
            response_text: read.prose || null,
            citations: read.citations,
            cost,
            failed: false,
          };
        } catch (err) {
          const billed = billedCost(err);
          spend.dfs += billed;
          cost += billed;
          reason = readFailureReason(err);
          const wait = readRetryDelay(err, attempt, remainingMs());
          if (wait !== null) {
            await sleep(wait);
            continue;
          }
          console.warn(`[track] ${runId} ${engine} read failed: ${message(err)}`);
          break;
        }
      }
      return { ...base, answered: false, named: false, response_text: null, cost, failed: true, reason };
    });

    // A keyword read: null is "not in the top 20", a finding; an empty SERP or
    // an error is a failed read with its reason, never a silent null.
    const serp = await mapWithConcurrency(keywordJobs, CONCURRENCY, async (k) => {
      let cost = 0;
      let reason = "out of time before the read";
      for (let attempt = 0; ; attempt++) {
        if (remainingMs() < 5000) break;
        try {
          const read = await readKeywordPosition(k.keyword as string, domain, market, remainingMs());
          spend.dfs += read.cost;
          cost += read.cost;
          const out = keywordOutcome(read.rank);
          if (out.failed) {
            reason = out.reason;
            break;
          }
          return { k, failed: false as const, rank: out.rank, url: read.url, cost, top: read.top };
        } catch (err) {
          const billed = billedCost(err);
          spend.dfs += billed;
          cost += billed;
          reason = readFailureReason(err);
          const wait = readRetryDelay(err, attempt, remainingMs());
          if (wait !== null) {
            await sleep(wait);
            continue;
          }
          console.warn(`[track] ${runId} keyword read failed: ${message(err)}`);
          break;
        }
      }
      return { k, failed: true as const, rank: null, url: null, cost, reason };
    });

    // Who else is named: one extraction per engine over that engine's answers,
    // as the scan does it, then attributed back to each answer with the same
    // matcher that decides "named". Never fatal - the reads are already paid for.
    //
    // Never silent either (8 Oct 2026, audit reliability-1 / data-6). This
    // read only the brands, so a batch that failed stored its answers as
    // naming no other brand, on a run marked complete. A failed batch is now
    // retried once while the budget allows; an answer still unread is stored
    // brands_ok=false, which every brand figure leaves out, and its engine is
    // a BrandGap, so the run is partial and its error line says which. One
    // deadline bounds both passes (decide.ts extractionWindowMs), and it is
    // hard: extractWithRetry stops waiting when it fires, because the SDK's
    // sleep between its own retries does not hear the signal. The requests
    // are counted as they leave, so a pass it stopped waiting on is billed.
    const subject = subjectKeys(brand, domain);
    const others = new Map<Engine, string[]>();
    const unread = new Set<AnswerRow>();
    const gaps: BrandGap[] = [];
    const context = { topic: (client.topic as string | null) ?? "", brand };
    const signal = AbortSignal.timeout(extractionWindowMs(remainingMs()));
    await Promise.all(
      engines.map(async (engine) => {
        const read = [...answers, ...stored].filter((a) => a.engine === engine && a.answered && a.response_text);
        if (!read.length) return;
        const out = await extractWithRetry(read.map((a) => a.response_text!), (blocks, billed) => extractBrands(blocks, context, { signal, billed }), remainingMs, signal);
        spend.calls += out.calls;
        const seen = new Map<string, string>();
        for (const name of out.names) {
          const key = brandKey(name.trim());
          if (key && !subject.has(key) && !seen.has(key)) seen.set(key, name.trim());
        }
        others.set(engine, [...seen.values()]);
        if (!out.unread.length) return;
        for (const i of out.unread) unread.add(read[i]!);
        // On a re-run, the engine's answered rows its extraction did not touch had their brands read: they are the day's answers too.
        const answered = read.length + (kept ? kept.answers.filter((a) => a.engine === engine && a.answered && !rebrand!(a.question_id, a.engine)).length : 0);
        gaps.push({ engine, unread: out.unread.length, answered, reason: out.reason });
        console.warn(`[track] ${runId} ${engine} brand extraction: other brands not read in ${out.unread.length} of ${answered} answers (${out.reason})`);
      }),
    );

    const brandsIn = (a: AnswerRow) => (a.response_text ? (others.get(a.engine) ?? []).filter((n) => namesSubject(a.response_text!, n)) : []);
    const answerRows = answers.map((a) => ({
      run_id: runId,
      client_domain_id: client.id,
      run_date: day,
      question_id: a.question_id,
      engine: a.engine,
      answered: a.answered,
      named: a.named,
      response_text: a.response_text,
      brands: brandsIn(a),
      citations: a.citations,
      cost: Number(a.cost.toFixed(4)),
    }));
    // A re-read that failed again leaves the row the run holds (rerun.ts
    // keepsOld); on the cron's pass nothing is kept and every row is written.
    const written = answerRows.filter((_, i) => !keepsOld(kept, answers[i]!));
    if (written.length) {
      // brands_ok is 20261008020000's column. A deploy landing before that
      // migration names a column the table lacks, so the reads are stored
      // without it rather than lost; the run's error line still names any gap.
      const withOk = answerRows.map((r, i) => ({ ...r, brands_ok: !unread.has(answers[i]!) })).filter((_, i) => !keepsOld(kept, answers[i]!));
      for (const rows of [withOk, written]) {
        const { error } = await db.from("tracking_answers").upsert(rows, { onConflict: "run_id,question_id,engine" });
        if (!error) break;
        if (rows === withOk && missingColumn(error, "brands_ok")) {
          console.warn(`[track] ${runId} tracking_answers has no brands_ok yet; answers stored without it`);
          continue;
        }
        throw new Error(`could not store the answers: ${error.message}`);
      }
    }
    // A stored answer whose brands were read again: only its brands, and
    // brands_ok where the column exists, are written. One still unread is
    // left brands_ok=false, and its engine is a gap on the error line.
    await mapWithConcurrency(stored.filter((a) => !unread.has(a)), CONCURRENCY, async (a) => {
      const brands = brandsIn(a);
      const { error } = await db
        .from("tracking_answers")
        .update(hasBrandsOk(kept!) ? { brands, brands_ok: true } : { brands })
        .eq("run_id", runId)
        .eq("question_id", a.question_id)
        .eq("engine", a.engine);
      if (error) throw new Error(`could not store the brands read again: ${error.message}`);
    });

    const serpRead = serp.filter((s) => !s.failed);
    const serpRows = serpRead
      .map((s) => ({
        run_id: runId,
        client_domain_id: client.id,
        run_date: day,
        keyword_id: s.k.id,
        position: s.rank,
        url: s.url,
        cost: Number(s.cost.toFixed(4)),
      }));
    if (serpRows.length) {
      // MS-1 (12 Oct 2026): each keyword's organic top 20 rides in `top`, 20261012000000's
      // column. A deploy landing before that migration stores the positions without it rather
      // than losing them, as the brands_ok write does.
      const withTop = serpRows.map((r, i) => ({ ...r, top: serpRead[i]!.top }));
      for (const rows of [withTop, serpRows]) {
        const { error } = await db.from("tracking_serp").upsert(rows, { onConflict: "run_id,keyword_id" });
        if (!error) break;
        if (rows === withTop && missingColumn(error, "top")) {
          console.warn(`[track] ${runId} tracking_serp has no top yet; positions stored without it`);
          continue;
        }
        throw new Error(`could not store the keyword positions: ${error.message}`);
      }
    }

    // BRIEF-2 T12 (R96): the Sunday link check of this client's live
    // placements. Never fatal - the reads are stored - and never changes
    // status; a failed fetch records nothing (placements.ts decideLinkCheck).
    // Logged, so a check that broke shows in the run's log rather than hiding.
    // Once a client a Sunday: a re-run of the day does not check again, so
    // its alert cannot go twice (9 Oct 2026; mail-doors.test.mts).
    if (isLinkCheckDay(day)) {
      if (rerun) {
        console.log(`[track] ${runId} link check: not repeated on a re-run`);
      } else {
        try {
          const { data: ps, error: pErr } = await db
            .from("placements")
            .select("id, url, last_checked_on, link_present")
            .eq("client_domain_id", client.id)
            .eq("status", "live");
          if (pErr) throw new Error(pErr.message);
          const alerts: string[] = [];
          await mapWithConcurrency((ps ?? []) as (LinkRow & { id: string })[], CONCURRENCY, async (p) => {
            if (remainingMs() < 15_000) return;
            const out = decideLinkCheck(p, await readPlacement(p.url, fetch), domain, day);
            if (out.alert) alerts.push(out.alert);
            if (!out.write) return;
            const { error } = await db.from("placements").update({ ...out.write, updated_at: new Date().toISOString() }).eq("id", p.id);
            if (error) console.warn(`[track] ${runId} placement ${p.id} not updated: ${error.message}`);
          });
          console.log(`[track] ${runId} link check: ${(ps ?? []).length} live placements, ${alerts.length} alerts`);
          if (alerts.length && !(await sendLinkAlerts({ domain, lines: alerts }))) console.warn(`[track] ${runId} link alert not sent`);
        } catch (err) {
          console.warn(`[track] ${runId} link check failed: ${message(err)}`);
        }
      }
    }

    // The whole day's reads, re-read or not: on the cron's pass these are
    // answers.length + serp.length. A re-run's failures are the reads it asked
    // again that still did not come back.
    const reads = every.length + keywords.length;
    const failures = [
      ...answers.flatMap((a) => (a.failed ? [{ engine: a.engine as string, reason: a.reason ?? "unknown" }] : [])),
      ...serp.flatMap((x) => (x.failed ? [{ engine: "keyword", reason: x.reason ?? "unknown" }] : [])),
    ];
    const status = runOutcome(reads, failures.length, gaps.length);
    await close({ status, error: failureSummary(reads, failures, gaps) });
    // Not when an earlier pass of this run landed: first_reading was asked then.
    if (status !== "failed" && !rerun?.landed) {
      const range = { from: day, to: day };
      const all = kept ? dayRows(kept, written, serpRows) : { answers: answerRows, serp: serpRows };
      await mailFirstReading(db, runId, client.id as string, domain, {
        named: namedRate(all.answers, range),
        page1: keywordsOnPage1(all.serp, range, keywords.length),
      });
    }
    await reportRunHealthSafely(day);
    return { status };
  } catch (err) {
    // A re-run that throws leaves the run as it found it, with why on its marker.
    const why = `re-run failed: ${message(err)}`;
    await close(rerun ? restored(rerun, why) : { status: "failed", error: message(err) }, rerun ? why : null);
    await reportRunHealthSafely(run.run_date as string);
    throw err;
  }
}

/**
 * first_reading (R159, danny.md line 164): after a client's first run that
 * did not fail, its live owners get the day's headline - the Overview's own
 * namedRate and keywordsOnPage1, not a new figure. Only when its flag is on
 * (off until Danny approves it), never in agency mode (the email names
 * alwayscited and the tier), and only when this run is the client's only one
 * that finished, so a later run never sends it. Never fatal: the reads are stored.
 */
async function mailFirstReading(
  db: ReturnType<typeof supabaseAdmin>,
  runId: string,
  clientId: string,
  domain: string,
  f: { named: { num: number; den: number }; page1: { num: number; den: number } },
): Promise<void> {
  try {
    if (!(await lifecycleOn(db, "first_reading"))) return;
    const { count, error: rErr } = await db.from("tracking_runs").select("id", { count: "exact", head: true }).eq("client_domain_id", clientId).in("status", ["complete", "partial"]);
    if (rErr) throw new Error(rErr.message);
    if (count !== 1) return;
    const { data: c, error: cErr } = await db.from("client_domains").select("account_id, tier").eq("id", clientId).single();
    if (cErr) throw new Error(cErr.message);
    const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode").eq("id", c.account_id).maybeSingle();
    if (aErr || !account) throw new Error(aErr?.message ?? "no account");
    if (upsellMode(account.upsell_mode) === "agency") return;
    const { data: owners, error: oErr } = await db.from("dashboard_members").select("email").eq("account_id", c.account_id).eq("role", "owner").is("removed_at", null);
    if (oErr) throw new Error(oErr.message);
    const tier = ((c.tier as string) in TIER_PLAIN ? c.tier : "tracked") as TierKey;
    const mail = firstReading({ tier, domain, named: f.named.num, answers: f.named.den, page1: f.page1.num, keywords: f.page1.den, link: appUrl("/", siteUrl()) });
    for (const m of owners ?? []) {
      if (!(await sendLifecycle({ memberEmail: m.email as string, mail }))) console.warn(`[track] ${runId} first_reading not sent`);
    }
  } catch (err) {
    console.warn(`[track] ${runId} first_reading skipped: ${message(err)}`);
  }
}

/**
 * Close tracking runs the platform killed: `running` for longer than
 * TRACKING_STALL_MS, marked failed. Called from the stall reaper's cron.
 * Compare-and-swap on status, and `.select("id")` so a reap that did nothing
 * is distinguishable from one that closed a run.
 */
export async function reapStalledTrackingRuns(now: number = Date.now()): Promise<{ ids: string[] }> {
  const cutoff = new Date(now - TRACKING_STALL_MS).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("tracking_runs")
    .update({ status: "failed", error: "the run was stopped before it could record a result, and was closed by the stall sweep", finished_at: new Date(now).toISOString() })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");
  if (error) throw new Error(`could not close stalled tracking runs: ${error.message}`);
  return { ids: (data ?? []).map((r) => r.id as string) };
}
