import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../supabase/page.ts";
import { type SkippedClient, clusterLiveOn, liveOn, shouldTrack, skipAlerts, skipReason, trackingDay } from "./decide.ts";
import { CHECK_HOUR_UTC } from "./check-time.ts";
import { runIsStalled, runIsStuck } from "./dispatch.ts";
import { RERUN_BUTTON } from "./rerun.ts";

/**
 * Run health - whether each client that should have been read today was
 * (9 Oct 2026, audit reliability-6 and spec OP-1).
 *
 * Every tracking failure ended in console.warn. A failed, partial, stalled or
 * missing run reached nobody, and a missed alwaystracked day cannot be read
 * again later, so a gap nobody hears about by the morning is a gap for good.
 * This is one reading of a day's runs against who should have run, used by
 * four things that must not disagree:
 *
 * - reportRunHealth: one summary to our own inbox (health-mail.ts) once the
 *   day has settled with any client not complete - sent by whichever run
 *   closes last, or by the daily cron when nothing was dispatched, claimed
 *   once per day in dashboard_events;
 * - /api/health/runs: a JSON for an uptime monitor, 503 once the deadline has
 *   passed with any client not complete or partial (healthAnswer);
 * - the fleet strip on /admin/tracking;
 * - the daily dispatch itself, through readTrackable, so "who should have
 *   run" is the dispatcher's own rule and not a second copy of it.
 *
 * Loadable by node --test: relative imports, no server-only, the database and
 * the sender passed in (run-health.test.mts runs it against an in-memory one).
 */

/** Where a client's day stands. */
export type RunState =
  | "complete"
  | "partial"
  | "failed"
  /** Opened and not claimed yet - in flight. */
  | "queued"
  /** Claimed and reading - in flight. */
  | "running"
  /** Queued past TRACKING_STUCK_MS with no dispatch error: never claimed. */
  | "stuck"
  /** Running past TRACKING_STALL_MS: killed by the platform. */
  | "stalled"
  /** Queued with a dispatch error on it: nothing will pick it up without "Run now". */
  | "undispatched"
  /** Should have run and has no row. */
  | "missing";

export const RUN_STATES: readonly RunState[] = ["complete", "partial", "failed", "queued", "running", "stuck", "stalled", "undispatched", "missing"];

/** The states still in flight. Anything else is where the day ends unless somebody acts. */
const IN_FLIGHT = new Set<RunState>(["queued", "running"]);

/** What a client's day counts as for the monitor: read, even if some reads failed. */
const READ = new Set<RunState>(["complete", "partial"]);

export type HealthRun = {
  client_domain_id: string;
  status: string;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at?: string | null;
  dfs_cost?: number | string | null;
};

export type TrackableClient = {
  id: string;
  domain: string;
  status: string | null;
  started_on: string | null;
  tier: string | null;
  activeQuestions: number;
  /** decide.ts shouldTrack on the day: whether the daily dispatch opens a run for it. */
  track: boolean;
};

export type ClientHealth = { id: string; domain: string; state: RunState; error: string | null };

export type RunHealth = {
  day: string;
  /** Clients that should have a run on the day (shouldTrack). */
  expected: number;
  /** Every expected client, and any other client with a run on the day. */
  clients: ClientHealth[];
  counts: Record<RunState, number>;
  /** Nothing is in flight: the day ends as it stands unless somebody acts. */
  settled: boolean;
  /** Every client listed was read, complete or partial. */
  ok: boolean;
  /** Clients with live clusters the dispatch skipped (decide.ts skipAlerts), for the summary mail. */
  skippedLive: SkippedClient[];
};

/** One run's state at `now`. A status this file does not know reads as failed rather than as fine. */
export function runState(run: HealthRun | undefined, now: number): RunState {
  if (!run) return "missing";
  switch (run.status) {
    case "complete":
    case "partial":
    case "failed":
      return run.status;
    case "queued":
      if (run.error) return "undispatched";
      return runIsStuck(run, now) ? "stuck" : "queued";
    case "running":
      return runIsStalled(run, now) ? "stalled" : "running";
    default:
      return "failed";
  }
}

/** Problems first, worst first, then by domain - the order the summary and the strip list them in. */
const ORDER: Record<RunState, number> = { missing: 0, undispatched: 1, stuck: 2, stalled: 3, failed: 4, partial: 5, running: 6, queued: 7, complete: 8 };

export function runHealth(p: { day: string; now: number; clients: readonly TrackableClient[]; runs: readonly HealthRun[]; skips?: readonly SkippedClient[] }): RunHealth {
  const byClient = new Map(p.runs.map((r) => [r.client_domain_id, r]));
  const domains = new Map(p.clients.map((c) => [c.id, c.domain]));
  const expected = p.clients.filter((c) => c.track);
  const ids = [...new Set([...expected.map((c) => c.id), ...p.runs.map((r) => r.client_domain_id)])];
  const clients = ids
    .map((id) => {
      const run = byClient.get(id);
      return { id, domain: domains.get(id) ?? id, state: runState(run, p.now), error: run?.error ?? null };
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.domain.localeCompare(b.domain));
  const counts = Object.fromEntries(RUN_STATES.map((s) => [s, 0])) as Record<RunState, number>;
  for (const c of clients) counts[c.state] += 1;
  return {
    day: p.day,
    expected: expected.length,
    clients,
    counts,
    settled: clients.every((c) => !IN_FLIGHT.has(c.state)),
    ok: clients.every((c) => READ.has(c.state)),
    skippedLive: skipAlerts(p.skips ?? [], p.day),
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** One skipped client as the summary lists it. */
export const skipLine = (s: SkippedClient) => `- ${s.domain}: skipped - ${s.reason}, ${plural(s.liveClusters, "live cluster")}`;

/**
 * By when a day's runs should all be read: two hours after the check, 07:00
 * UTC on the day. The cron fires at CHECK_HOUR_UTC, which is the same London
 * day in summer and winter, and a run takes under five minutes, so two hours
 * is room for a re-run (OP-1: "Danny knows by 07:00 UTC"). Counted from
 * check-time.ts's hour, not typed, so the two cannot drift (9 Oct 2026).
 */
export const HEALTH_GRACE_HOURS = 2;

export function healthDeadline(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) + (CHECK_HOUR_UTC + HEALTH_GRACE_HOURS) * 3_600_000;
}

/**
 * What /api/health/runs answers: 503 once the deadline has passed with any
 * client not read, so a monitor that knows only status codes alerts on it;
 * 200 otherwise, before the deadline whatever the state. A partial run is
 * read - it is in the summary mail, not a page. A run asked to re-run keeps
 * its status until the re-run closes (rerun.ts), so Danny's own re-run of a
 * partial client never turns this 503.
 *
 * No domain, id, cost and no count of anything (review of 50013ab, 9 Oct
 * 2026): only the names of the states unread clients are in. Counts by
 * state added up to how many clients there are - before 05:00 UTC, or on a
 * day the cron does not fire, every client is "missing" - and anyone can
 * read this. The counts are on /admin/tracking, behind its Basic auth.
 */
export function healthAnswer(h: RunHealth, now: number): { status: 200 | 503; body: Record<string, unknown> } {
  const deadline = healthDeadline(h.day);
  const late = !h.ok && now >= deadline;
  const unread = RUN_STATES.filter((s) => !READ.has(s) && h.counts[s] > 0);
  return {
    status: late ? 503 : 200,
    body: {
      day: h.day,
      checked_at: new Date(now).toISOString(),
      deadline: new Date(deadline).toISOString(),
      ok: h.ok,
      late,
      unread,
    },
  };
}

/** How a state reads in the summary and on the strip. */
export const STATE_WORDS: Record<RunState, string> = {
  complete: "complete",
  partial: "partial",
  failed: "failed",
  queued: "queued",
  running: "running",
  stuck: "never claimed",
  stalled: "stalled (running past 15 minutes)",
  undispatched: "not dispatched",
  missing: "no run",
};

/**
 * The summary: one line per client not complete, its state and its run's
 * error line, and where to act. Plain text, to our own inbox only.
 */
export function healthMail(h: RunHealth, p: { today: string; adminUrl: string; note?: string | null }): { subject: string; text: string } {
  const looking = h.clients.filter((c) => c.state !== "complete");
  const skipped = h.skippedLive ?? [];
  const total = h.clients.length + skipped.length;
  const skipBlock = skipped.length
    ? ["", `Skipped by the daily check, though ${skipped.length === 1 ? "it has" : "they have"} live clusters - nothing was read for ${skipped.length === 1 ? "it" : "them"}:`, ...skipped.map(skipLine), "A paused client is set back with client_domains.status = 'active'; it is read from the next daily check."]
    : [];
  if (!looking.length && skipped.length) {
    return {
      subject: `alwaystracked run health ${h.day}: ${plural(skipped.length, "client")} with live clusters skipped`,
      text: [`The daily check for ${h.day} (London) read ${h.clients.length ? `all ${plural(h.clients.length, "client")} it dispatched` : "no client"}, and skipped ${plural(skipped.length, "client")} that ${skipped.length === 1 ? "has" : "have"} live clusters.`, ...(p.note ? ["", p.note] : []), ...skipBlock].join("\n"),
    };
  }
  if (!looking.length) {
    // 13 Oct 2026, DIY P1: every tracking run complete, sent for the DIY line the send appends.
    return {
      subject: `alwaystracked run health ${h.day}: every client complete; DIY night to look at`,
      text: [`The daily check for ${h.day} (London) read all ${total} client${total === 1 ? "" : "s"} complete. The DIY night below needs a look.`, ...(p.note ? ["", p.note] : [])].join("\n"),
    };
  }
  const tally = RUN_STATES.filter((s) => h.counts[s] > 0)
    .map((s) => `${STATE_WORDS[s]} ${h.counts[s]}`)
    .join(", ");
  const act =
    h.day === p.today
      ? `"${RERUN_BUTTON}" on /admin/tracking reads a failed, partial or stalled run's missing reads again, today only: ${p.adminUrl}`
      : `This is ${h.day}'s summary, sent the morning after because the day never settled or the mail did not go. That day can no longer be re-run: ${p.adminUrl}`;
  return {
    subject: `alwaystracked run health ${h.day}: ${looking.length + skipped.length} of ${total} client${total === 1 ? "" : "s"} to look at`,
    text: [
      `The daily check for ${h.day} (London) has ${looking.length} of ${total} client${total === 1 ? "" : "s"} not complete.`,
      tally,
      ...(p.note ? ["", p.note] : []),
      "",
      ...looking.map((c) => `- ${c.domain}: ${STATE_WORDS[c.state]}${c.error ? ` - ${c.error}` : ""}`),
      ...skipBlock,
      "",
      act,
    ].join("\n"),
  };
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Every active client and whether the daily dispatch reads it on `day` -
 * decide.ts shouldTrack over its live prompts. The dispatch and every health
 * reading call this, so they cannot disagree about who should have run.
 *
 * Paged (9 Oct 2026, audit reliability-2). The dispatch read every unstopped
 * prompt across every client in one select, and PostgREST answers a select
 * with at most db-max-rows rows - 1000 by default - and says so nowhere. Past
 * a thousand live prompts (about twenty full alwaystracked clients) the rows
 * beyond it were dropped, those clients counted no live prompt, were skipped
 * and got no run, and nothing errored. Ended clients' prompts are never
 * stopped, so they use up the thousand too.
 */
export async function readTrackable(db: SupabaseClient, day: string): Promise<TrackableClient[]> {
  let clients: Record<string, unknown>[];
  let prompts: { client_domain_id: string; added_on: string; stopped_on: string | null }[];
  try {
    clients = await selectAll<Record<string, unknown>>((from, to) =>
      db.from("client_domains").select("id, domain, status, started_on, tier").eq("status", "active").is("archived_at", null).order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    throw new Error(`could not read the tracked clients: ${msg(err)}`);
  }
  try {
    prompts = await selectAll<{ client_domain_id: string; added_on: string; stopped_on: string | null }>((from, to) =>
      db.from("tracked_questions").select("client_domain_id, added_on, stopped_on").is("stopped_on", null).order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    throw new Error(`could not read the tracked questions: ${msg(err)}`);
  }
  const live = new Map<string, number>();
  for (const q of prompts) {
    if (!liveOn(q, day)) continue;
    live.set(q.client_domain_id, (live.get(q.client_domain_id) ?? 0) + 1);
  }
  return clients.map((c) => {
    const client = {
      id: c.id as string,
      status: c.status as string | null,
      started_on: c.started_on as string | null,
      activeQuestions: live.get(c.id as string) ?? 0,
    };
    return { ...client, domain: c.domain as string, tier: c.tier as string | null, track: shouldTrack(client, day) };
  });
}

/**
 * Every client the daily dispatch does not read on `day`, and why (decide.ts skipReason): paused clients, which
 * readTrackable never reads, and active ones it reads and skips (no live prompt, a start still to come). Ended
 * clients are left out - stopped on purpose, and kept only for the 90 days of retention. Each carries its live
 * clusters and prompts, so skipAlerts can tell a client somebody expects to be tracked from one that is not
 * ready. Paged like readTrackable (20 Oct 2026).
 */
export async function readSkips(db: SupabaseClient, day: string): Promise<SkippedClient[]> {
  let clients: Record<string, unknown>[];
  let prompts: { client_domain_id: string; added_on: string; stopped_on: string | null }[];
  let clusters: { client_domain_id: string; started_on: string | null; stopped_on: string | null }[];
  try {
    clients = await selectAll<Record<string, unknown>>((from, to) =>
      db.from("client_domains").select("id, domain, status, started_on").in("status", ["active", "paused"]).is("archived_at", null).order("id", { ascending: true }).range(from, to),
    );
    prompts = await selectAll<{ client_domain_id: string; added_on: string; stopped_on: string | null }>((from, to) =>
      db.from("tracked_questions").select("client_domain_id, added_on, stopped_on").is("stopped_on", null).order("id", { ascending: true }).range(from, to),
    );
    clusters = await selectAll<{ client_domain_id: string; started_on: string | null; stopped_on: string | null }>((from, to) =>
      db.from("tracked_clusters").select("client_domain_id, started_on, stopped_on").is("stopped_on", null).order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    throw new Error(`could not read the skipped clients: ${msg(err)}`);
  }
  const count = <T extends { client_domain_id: string }>(rows: T[], live: (r: T) => boolean) => {
    const m = new Map<string, number>();
    for (const r of rows) if (live(r)) m.set(r.client_domain_id, (m.get(r.client_domain_id) ?? 0) + 1);
    return m;
  };
  const livePrompts = count(prompts, (q) => liveOn(q, day));
  const liveClusters = count(clusters, (c) => clusterLiveOn(c, day));
  const out: SkippedClient[] = [];
  for (const c of clients) {
    const id = c.id as string;
    const client = { id, status: c.status as string | null, started_on: c.started_on as string | null, activeQuestions: livePrompts.get(id) ?? 0 };
    const reason = skipReason(client, day);
    if (reason) out.push({ ...client, domain: c.domain as string, reason, liveClusters: liveClusters.get(id) ?? 0 });
  }
  return out;
}

/** The dashboard_events row that records one client's skip on one day (props.day, props.reason). */
export const TRACKING_SKIP_EVENT = "tracking_skip";

/**
 * The dispatch's record of who it skipped and why (20 Oct 2026): a log line per client - a warning when it has
 * live clusters (decide.ts skipAlerts) - and one tracking_skip row per client per day, so a second call the same
 * day records nothing twice. Never throws: the dispatch has done its work whatever this does.
 */
export async function recordSkips(db: SupabaseClient, day: string): Promise<{ skips: SkippedClient[]; alerts: number; recorded: number; error?: string }> {
  let skips: SkippedClient[];
  try {
    skips = await readSkips(db, day);
  } catch (err) {
    console.warn(`[track] skips for ${day} not read: ${msg(err)}`);
    return { skips: [], alerts: 0, recorded: 0, error: msg(err) };
  }
  const alerts = new Set(skipAlerts(skips, day).map((s) => s.id));
  for (const s of skips) {
    const line = `[track] skipped ${s.domain} on ${day}: ${s.reason} (${s.liveClusters} live cluster${s.liveClusters === 1 ? "" : "s"}, ${s.activeQuestions} live prompt${s.activeQuestions === 1 ? "" : "s"})`;
    if (alerts.has(s.id)) console.warn(line);
    else console.log(line);
  }
  if (!skips.length) return { skips, alerts: 0, recorded: 0 };
  const { data: had, error: rErr } = await db.from("dashboard_events").select("client_domain_id").eq("event", TRACKING_SKIP_EVENT).eq("props->>day", day);
  if (rErr) {
    console.warn(`[track] skips for ${day} not recorded: ${rErr.message}`);
    return { skips, alerts: alerts.size, recorded: 0, error: rErr.message };
  }
  const done = new Set(((had ?? []) as { client_domain_id: string }[]).map((r) => r.client_domain_id));
  let recorded = 0;
  for (const s of skips) {
    if (done.has(s.id)) continue;
    const { error } = await db.from("dashboard_events").insert({
      client_domain_id: s.id,
      member_email: null,
      event: TRACKING_SKIP_EVENT,
      path: null,
      props: { day, reason: s.reason, status: s.status, live_clusters: s.liveClusters, live_prompts: s.activeQuestions, alert: alerts.has(s.id) },
    });
    if (error) console.warn(`[track] skip of ${s.domain} on ${day} not recorded: ${error.message}`);
    else recorded += 1;
  }
  return { skips, alerts: alerts.size, recorded };
}

/** Every run on `day`, every page. */
export async function readDayRuns(db: SupabaseClient, day: string): Promise<HealthRun[]> {
  try {
    return await selectAll<HealthRun>((from, to) =>
      db
        .from("tracking_runs")
        .select("client_domain_id, status, error, created_at, started_at, finished_at, dfs_cost")
        .eq("run_date", day)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    throw new Error(`could not read the day's runs: ${msg(err)}`);
  }
}

/** A day's health as the monitor, the strip and the summary read it. */
export async function readRunHealth(db: SupabaseClient, day: string, now: number): Promise<RunHealth> {
  const [runs, clients] = await Promise.all([readDayRuns(db, day), readTrackable(db, day)]);
  return runHealth({ day, now, clients, runs });
}

/** The dashboard_events row that claims a day's summary, keyed on props.day; unique per day with 20261009000000. */
export const RUN_HEALTH_EVENT = "run_health_mail";

/** A claim whose mail reached nobody, renamed so the next reading of the day may send it. */
export const RUN_HEALTH_UNSENT = "run_health_unsent";

/**
 * A claim still unsent this long after it was made was made by a function
 * the platform stopped before the send. A function lives at most 300s
 * (/api/track/run's maxDuration), so ten minutes is never one still sending.
 */
export const RUN_HEALTH_CLAIM_STALE_MS = 10 * 60 * 1000;

/** Whether a claim read back was left by a function that died between the claim and the send. */
export function claimAbandoned(props: unknown, now: number): boolean {
  const p = props as { sent?: unknown; at?: unknown } | null;
  if (p?.sent !== false) return false;
  const at = typeof p.at === "string" ? Date.parse(p.at) : NaN;
  return !Number.isFinite(at) || now - at > RUN_HEALTH_CLAIM_STALE_MS;
}

export type HealthIo = {
  send: (mail: { subject: string; text: string }) => Promise<boolean>;
  adminUrl: string;
  /**
   * 13 Oct 2026, DIY P1 (spec 10 section 5.6): the DIY night's line when it
   * needs a look - paused at a cap, jobs carried to tonight, or unreadable -
   * else null (src/lib/diy/core/health.ts diyAttention). Asked only on a day
   * every client's run was complete, and only for today, so a clean tracking
   * day still mails a DIY problem and the next morning's catch-up for the day
   * before never carries tonight's line. The send itself appends the DIY line
   * to every summary (health-mail.ts).
   */
  diyAttention?: (now: number) => Promise<string | null>;
};

export type ReportOutcome = "sent" | "unsent" | "taken" | "healthy" | "pending";

/**
 * Send the day's summary if the day has settled with any client not
 * complete, and nobody has sent it. Called by every run as it closes - all
 * but the last return at the first read, a sibling still in flight - and by
 * the daily cron after it dispatches, which sends at once when nothing was
 * dispatched (the switch, the cap, a failed read of the clients) and, for the
 * day before, sends what was never sent: a day with a run the platform killed
 * never settles while it is running, and the stall sweep has closed it by the
 * next morning.
 *
 * Claimed before the send, as lifecycle-sweep.ts claims its emails: a
 * run_health_mail row in dashboard_events with props.day, read first, and
 * made exact by 20261009000000's unique index (two runs closing together both
 * reading no claim). Without the index two such runs can both send. A send
 * that reaches nobody renames its claim, so the next reading may try again.
 *
 * A claim is made sent=false and marked sent=true after the send (review of
 * 50013ab, 9 Oct 2026). The last run of a slow day closes near the end of its
 * 300s, and a function stopped between the claim and the send held the claim
 * for good: the day's summary never went. A claim still unsent after
 * RUN_HEALTH_CLAIM_STALE_MS is released by a compare-and-swap and claimed
 * again, by the next run to close or by the next morning's catch-up. A
 * function stopped after the send and before the mark sends it twice; a
 * second copy of an internal mail is the better failure than none.
 *
 * `note` is what the dispatcher knows and the rows cannot say: why nothing
 * was dispatched.
 *
 * A day every client read complete is "healthy" and sends nothing, unless the
 * DIY night needs a look (`io.diyAttention`, 13 Oct 2026, DIY P1): then the
 * day's one summary goes anyway, on the same claim, saying tracking was clean.
 */
export async function reportRunHealth(db: SupabaseClient, io: HealthIo, p: { day: string; now: number; note?: string | null }): Promise<ReportOutcome> {
  const runs = await readDayRuns(db, p.day);
  if (runs.some((r) => IN_FLIGHT.has(runState(r, p.now)))) return "pending";
  const h = runHealth({ day: p.day, now: p.now, clients: await readTrackable(db, p.day), runs, skips: await readSkips(db, p.day) });
  if (!h.settled) return "pending";
  if (h.clients.every((c) => c.state === "complete") && h.skippedLive.length === 0) {
    const diy = io.diyAttention && p.day === trackingDay(new Date(p.now)) ? await io.diyAttention(p.now) : null;
    if (!diy) return "healthy";
  }

  const { data: held, error: sErr } = await db.from("dashboard_events").select("id, props").eq("event", RUN_HEALTH_EVENT).eq("props->>day", p.day).limit(1);
  if (sErr) throw new Error(`could not read the run-health claim: ${sErr.message}`);
  const prior = (held ?? [])[0] as { id: number; props: unknown } | undefined;
  if (prior) {
    if (!claimAbandoned(prior.props, p.now)) return "taken";
    const { data: freed, error: fErr } = await db
      .from("dashboard_events")
      .update({ event: RUN_HEALTH_UNSENT })
      .eq("id", prior.id)
      .eq("event", RUN_HEALTH_EVENT)
      .eq("props->>sent", "false")
      .select("id");
    if (fErr) throw new Error(`could not release an abandoned run-health claim: ${fErr.message}`);
    if (!(freed ?? []).length) return "taken";
  }
  const at = new Date(p.now).toISOString();
  const { data: claim, error: cErr } = await db
    .from("dashboard_events")
    .insert({ client_domain_id: null, member_email: null, event: RUN_HEALTH_EVENT, path: null, props: { day: p.day, sent: false, at } })
    .select("id")
    .single();
  if (cErr) {
    if (cErr.code === "23505") return "taken";
    throw new Error(`could not claim the run-health mail: ${cErr.message}`);
  }
  if (await io.send(healthMail(h, { today: trackingDay(new Date(p.now)), adminUrl: io.adminUrl, note: p.note }))) {
    const { error: mErr } = await db.from("dashboard_events").update({ props: { day: p.day, sent: true, at } }).eq("id", claim.id as number);
    if (mErr) console.warn(`[track] run-health mail for ${p.day} sent, and its claim not marked sent, so it may go again: ${mErr.message}`);
    return "sent";
  }
  const { error: uErr } = await db.from("dashboard_events").update({ event: RUN_HEALTH_UNSENT }).eq("id", claim.id as number);
  if (uErr) console.warn(`[track] run-health mail for ${p.day} not sent, and its claim not released: ${uErr.message}`);
  return "unsent";
}
