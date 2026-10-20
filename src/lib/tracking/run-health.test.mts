import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { failureSummary } from "./decide.ts";
import { type Row, fakeDb } from "./fake-db.mts";
import { RERUN_BUTTON } from "./rerun.ts";
import {
  type HealthRun,
  type TrackableClient,
  RUN_HEALTH_CLAIM_STALE_MS,
  RUN_HEALTH_EVENT,
  RUN_HEALTH_UNSENT,
  claimAbandoned,
  healthAnswer,
  healthMail,
  readRunHealth,
  readSkips,
  readTrackable,
  recordSkips,
  reportRunHealth,
  TRACKING_SKIP_EVENT,
  runHealth,
  runState,
} from "./run-health.ts";

/**
 * Run health (9 Oct 2026, audit reliability-6, reliability-2, spec OP-1).
 *
 * Every tracking failure ended in a log line, so a failed, partial, stalled
 * or missing run reached nobody, and a missed alwaystracked day cannot be
 * read again later. These run the one reading the summary mail, the health
 * JSON, the admin strip and the dispatch share, against an in-memory
 * database (fake-db.mts) that caps every select at PostgREST's thousand rows.
 * No real database is read or written and no email is sent.
 */

const DAY = "2026-10-09";
/** 05:06 UTC on the day: the cron dispatched at 05:00 and the runs have had five minutes. */
const AFTER_RUNS = Date.parse(`${DAY}T05:06:00Z`);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const client = (id: string, domain: string, track = true): TrackableClient => ({ id, domain, status: "active", started_on: "2026-10-01", tier: "tracked", activeQuestions: track ? 5 : 0, track });
const run = (client_domain_id: string, status: string, extra: Partial<HealthRun> = {}): HealthRun => ({
  client_domain_id,
  status,
  error: null,
  created_at: `${DAY}T05:00:01Z`,
  started_at: status === "queued" ? null : `${DAY}T05:00:03Z`,
  ...extra,
});

test("a run's state: closed runs as they closed; in flight until stuck or stalled; no row is missing", () => {
  const now = Date.parse(`${DAY}T05:10:00Z`);
  assert.equal(runState(undefined, now), "missing");
  for (const s of ["complete", "partial", "failed"]) assert.equal(runState(run("a", s), now), s);
  assert.equal(runState(run("a", "queued"), now), "queued", "opened ten minutes ago and not claimed yet");
  assert.equal(runState(run("a", "queued"), Date.parse(`${DAY}T05:31:00Z`)), "stuck", "queued past 30 minutes: never claimed");
  assert.equal(runState(run("a", "queued", { error: "dispatch failed: the run route answered 500" }), now), "undispatched", "a dispatch error on it: nothing will pick it up");
  assert.equal(runState(run("a", "running"), now), "running");
  assert.equal(runState(run("a", "running"), Date.parse(`${DAY}T05:15:04Z`)), "stalled", "running past 15 minutes: the platform killed it");
  assert.equal(runState(run("a", "something new"), now), "failed", "a status this does not know is not read as fine");
  // A run asked to re-run keeps its status until the re-run closes (rerun.ts; review of b2e0019): the state is the row's.
  assert.equal(runState(run("a", "partial", { started_at: `${DAY}T09:00:00Z` }), Date.parse(`${DAY}T09:01:00Z`)), "partial");
});

test("the day's health: who should have run against what ran, problems first", () => {
  const h = runHealth({
    day: DAY,
    now: AFTER_RUNS,
    clients: [client("a", "tallyroo.com"), client("b", "ledgerline.com"), client("c", "thesmallbizstack.com"), client("d", "softwarecritic.com"), client("e", "freelancefieldnotes.com", false)],
    runs: [run("a", "complete"), run("b", "partial", { error: "4 of 21 reads failed - google_aio: 4 x HTTP 429" }), run("c", "failed", { error: "boom" }), run("x", "complete")],
  });
  assert.equal(h.expected, 4, "a client shouldTrack skips is not expected");
  assert.deepEqual(
    h.clients.map((c) => [c.domain, c.state]),
    [
      ["softwarecritic.com", "missing"],
      ["thesmallbizstack.com", "failed"],
      ["ledgerline.com", "partial"],
      ["tallyroo.com", "complete"],
      ["x", "complete"],
    ],
    "every expected client and every run, problems first; a run of a client no longer active is still listed",
  );
  assert.equal(h.counts.missing, 1);
  assert.equal(h.counts.complete, 2);
  assert.equal(h.settled, true);
  assert.equal(h.ok, false);
  const partialOnly = runHealth({ day: DAY, now: AFTER_RUNS, clients: [client("a", "tallyroo.com"), client("b", "ledgerline.com")], runs: [run("a", "complete"), run("b", "partial")] });
  assert.equal(partialOnly.ok, true, "a partial run was read: some reads failed, the day is not missing");
  const inFlight = runHealth({ day: DAY, now: AFTER_RUNS, clients: [client("a", "tallyroo.com"), client("b", "ledgerline.com")], runs: [run("a", "failed"), run("b", "running")] });
  assert.equal(inFlight.settled, false, "a sibling still reading: the day has not settled");
  const none = runHealth({ day: DAY, now: AFTER_RUNS, clients: [], runs: [] });
  assert.deepEqual([none.ok, none.settled, none.expected], [true, true, 0], "nothing to run is healthy, not an alarm");
});

test("the health JSON: 503 from 07:00 UTC for a day with a stalled run; 200 before, and for partial", () => {
  const clients = [client("a", "tallyroo.com"), client("b", "ledgerline.com")];
  const stalled = (now: number) => runHealth({ day: DAY, now, clients, runs: [run("a", "complete"), run("b", "running")] });
  const before = Date.parse(`${DAY}T06:59:00Z`);
  const after = Date.parse(`${DAY}T07:00:00Z`);
  assert.equal(stalled(before).counts.stalled, 1);
  assert.equal(healthAnswer(stalled(before), before).status, 200, "before the deadline whatever the runs are doing");
  const late = healthAnswer(stalled(after), after);
  assert.equal(late.status, 503);
  assert.deepEqual(late.body, { day: DAY, checked_at: `${DAY}T07:00:00.000Z`, deadline: `${DAY}T07:00:00.000Z`, ok: false, late: true, unread: ["stalled"] });
  const partial = runHealth({ day: DAY, now: after, clients, runs: [run("a", "complete"), run("b", "partial")] });
  assert.equal(healthAnswer(partial, after).status, 200, "partial is read; the mail says so, the monitor does not page");
  const missing = runHealth({ day: DAY, now: after, clients, runs: [] });
  assert.equal(healthAnswer(missing, after).status, 503, "the cron never fired: every client missing at 07:00");
  assert.deepEqual(healthAnswer(missing, after).body.unread, ["missing"]);
  // No client, id, cost and no count of anything in what anyone can read (review of 50013ab, 9 Oct 2026):
  // a count of missing clients before 05:00 UTC was the number of clients.
  const many = Array.from({ length: 17 }, (_, i) => client(`c${i}`, `client${i}.example`));
  const early = Date.parse(`${DAY}T04:00:00Z`);
  const night = healthAnswer(runHealth({ day: DAY, now: early, clients: many, runs: [] }), early);
  assert.deepEqual(night, { status: 200, body: { day: DAY, checked_at: `${DAY}T04:00:00.000Z`, deadline: `${DAY}T07:00:00.000Z`, ok: false, late: false, unread: ["missing"] } });
  for (const answer of [night, late, healthAnswer(runHealth({ day: DAY, now: after, clients, runs: [run("a", "failed", { error: "secret-ish detail", dfs_cost: 1.23 })] }), after)]) {
    const body = JSON.stringify(answer.body);
    for (const leak of ["tallyroo.com", "ledgerline.com", "client0", '"a"', "secret-ish", "1.23", "expected", "complete", "17"]) assert.ok(!body.includes(leak), `${leak} is in the public health JSON: ${body}`);
    assert.ok(!Object.values(answer.body).some((v) => typeof v === "number"), `a number in the public health JSON: ${body}`);
  }
});

test("the summary: one line per client not complete, with its error line, and where to act", () => {
  const error = failureSummary(21, [1, 2, 3, 4].map(() => ({ engine: "google_aio", reason: "HTTP 429" })));
  const h = runHealth({
    day: DAY,
    now: AFTER_RUNS,
    clients: [client("a", "tallyroo.com"), client("b", "ledgerline.com"), client("c", "thesmallbizstack.com")],
    runs: [run("a", "complete"), run("b", "partial", { error }), run("c", "failed", { error: "today's tracking spend $25.00 has reached the cap of $25.00" })],
  });
  const mail = healthMail(h, { today: DAY, adminUrl: "https://alwayscited.example/admin/tracking" });
  assert.equal(mail.subject, `alwaystracked run health ${DAY}: 2 of 3 clients to look at`);
  assert.match(mail.text, /- thesmallbizstack\.com: failed - today's tracking spend \$25\.00 has reached the cap of \$25\.00/);
  assert.match(mail.text, /- ledgerline\.com: partial - 4 of 21 reads failed - google_aio: 4 x HTTP 429/);
  assert.doesNotMatch(mail.text, /tallyroo\.com/, "a complete client is counted, not listed");
  assert.match(mail.text, /complete 1, partial 1, failed 1/);
  // The button as /admin/tracking renders it for a failed, partial or stalled run (review of 50013ab, 9 Oct 2026).
  assert.ok(mail.text.includes(`"${RERUN_BUTTON}" on /admin/tracking`), "the mail names the button the page shows");
  assert.match(mail.text, /today only: https:\/\/alwayscited\.example\/admin\/tracking/);
  assert.doesNotMatch(mail.text + mail.subject, /AlwaysCited|Alwayscited|Alwaystracked|AlwaysTracked|\u2014/, "lowercase brand, hyphens");
  const late = healthMail(h, { today: "2026-10-10", adminUrl: "https://alwayscited.example/admin/tracking", note: "The daily dispatch was refused: x." });
  assert.match(late.text, /can no longer be re-run/, "the morning-after summary does not offer a re-run of a past day");
  assert.match(late.text, /The daily dispatch was refused: x\./);
});

/** One London day of the database: clients, live prompts, runs. */
function day(over: { clients?: Row[]; prompts?: Row[]; runs?: Row[]; events?: Row[] } = {}) {
  return {
    client_domains: over.clients ?? [
      { id: "a", domain: "tallyroo.com", status: "active", started_on: "2026-10-01", tier: "tracked" },
      { id: "b", domain: "ledgerline.com", status: "active", started_on: "2026-10-01", tier: "tracked" },
    ],
    tracked_questions: over.prompts ?? [
      { id: "q1", client_domain_id: "a", added_on: "2026-10-01", stopped_on: null },
      { id: "q2", client_domain_id: "b", added_on: "2026-10-01", stopped_on: null },
    ],
    tracking_runs: (over.runs ?? []).map((r, i) => ({ id: `r${i}`, run_date: DAY, error: null, created_at: `${DAY}T05:00:01Z`, started_at: `${DAY}T05:00:03Z`, ...r })),
    dashboard_events: over.events ?? [],
  };
}

function outbox(fail = false) {
  const sent: { subject: string; text: string }[] = [];
  const state = { fail };
  return { sent, state, health: { adminUrl: "https://alwayscited.example/admin/tracking", send: async (m: { subject: string; text: string }) => (state.fail ? false : (sent.push(m), true)) } };
}

test("a forced failed run produces one internal email with its failure line, once a day", async () => {
  const { db, tables } = fakeDb(day({ runs: [{ client_domain_id: "a", status: "complete" }, { client_domain_id: "b", status: "failed", error: "could not store the answers: forced" }] }));
  const box = outbox();
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS }), "sent");
  assert.equal(box.sent.length, 1);
  assert.match(box.sent[0]!.text, /- ledgerline\.com: failed - could not store the answers: forced/);
  assert.deepEqual(
    tables.dashboard_events!.map((e) => [e.event, e.props, e.client_domain_id]),
    [[RUN_HEALTH_EVENT, { day: DAY, sent: true, at: `${DAY}T05:06:00.000Z` }, null]],
    "claimed before the send, keyed on the day, no client; marked sent after it",
  );
  // The next run to close, the cron, a re-run: the day's summary has gone.
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS + MIN }), "taken");
  assert.equal(box.sent.length, 1);
});

test("in flight: every run that closes before the last returns at the first read; the last one sends", async () => {
  const { db, tables, calls } = fakeDb(day({ runs: [{ client_domain_id: "a", status: "partial", error: "1 of 5 reads failed - chatgpt: 1 x HTTP 500" }, { client_domain_id: "b", status: "running" }] }));
  const box = outbox();
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS }), "pending");
  assert.deepEqual([...new Set(calls.map((c) => c.table))], ["tracking_runs"], "the day's runs read, then out: no client read, no claim");
  tables.tracking_runs![1]!.status = "complete";
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS }), "sent");
  assert.match(box.sent[0]!.text, /tallyroo\.com: partial - 1 of 5 reads failed/);
});

test("a day with every run complete sends nothing; a missing client is a problem", async () => {
  const box = outbox();
  const clean = fakeDb(day({ runs: [{ client_domain_id: "a", status: "complete" }, { client_domain_id: "b", status: "complete" }] }));
  assert.equal(await reportRunHealth(clean.db, box.health, { day: DAY, now: AFTER_RUNS }), "healthy");
  assert.equal(clean.tables.dashboard_events!.length, 0, "no claim for a healthy day");
  const gap = fakeDb(day({ runs: [{ client_domain_id: "a", status: "complete" }] }));
  assert.equal(await reportRunHealth(gap.db, box.health, { day: DAY, now: AFTER_RUNS }), "sent");
  assert.match(box.sent[0]!.text, /- ledgerline\.com: no run/);
  assert.equal(box.sent.length, 1);
});

test("13 Oct 2026, DIY P1: a clean tracking day still mails when the DIY night needs a look, for today only, on the same claim", async () => {
  const runs = [{ client_domain_id: "a", status: "complete" }, { client_domain_id: "b", status: "complete" }];
  const asked: number[] = [];
  const quiet = fakeDb(day({ runs }));
  const box = outbox();
  const io = (line: string | null) => ({ ...box.health, diyAttention: async (now: number) => (asked.push(now), line) });
  assert.equal(await reportRunHealth(quiet.db, io(null), { day: DAY, now: AFTER_RUNS }), "healthy", "a quiet DIY night sends nothing");
  const loud = fakeDb(day({ runs }));
  const line = "DIY reads overnight (9 Oct, UTC): DataForSEO $0.40 of $10.00, model $0.00 of $5.00; paused at cap: no; jobs carried to tonight: 4";
  assert.equal(await reportRunHealth(loud.db, io(line), { day: DAY, now: AFTER_RUNS }), "sent");
  assert.equal(box.sent.length, 1);
  assert.match(box.sent[0]!.subject, /every client complete; DIY night to look at/);
  assert.deepEqual(loud.tables.dashboard_events!.map((e) => e.event), [RUN_HEALTH_EVENT], "the day's one claim");
  assert.equal(await reportRunHealth(loud.db, io(line), { day: DAY, now: AFTER_RUNS + MIN }), "taken");
  const before = asked.length;
  const yesterday = fakeDb(day({ runs }));
  assert.equal(await reportRunHealth(yesterday.db, io(line), { day: DAY, now: AFTER_RUNS + 24 * 60 * MIN }), "healthy", "the next morning's catch-up never carries tonight's line");
  assert.equal(asked.length, before, "not even asked");
});

test("nothing dispatched: the cron's report sends at once, with why", async () => {
  const { db } = fakeDb(day());
  const box = outbox();
  const note = "The daily dispatch was refused: tracking is switched off (tracking_enabled).";
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: Date.parse(`${DAY}T05:00:02Z`), note }), "sent");
  assert.match(box.sent[0]!.subject, /2 of 2 clients to look at/);
  assert.ok(box.sent[0]!.text.includes(note));
});

test("a mail that reaches nobody releases its claim, and the next reading sends", async () => {
  const { db, tables } = fakeDb(day({ runs: [{ client_domain_id: "a", status: "failed", error: "x" }, { client_domain_id: "b", status: "complete" }] }));
  const box = outbox(true);
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS }), "unsent");
  assert.deepEqual(tables.dashboard_events!.map((e) => e.event), [RUN_HEALTH_UNSENT]);
  box.state.fail = false;
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS }), "sent");
  assert.equal(box.sent.length, 1);
});

test("a function stopped between the claim and the send: the summary still goes, once, after ten minutes", async () => {
  // Review of 50013ab (9 Oct 2026): the last run of a slow day closes near 290s of its 300s, and a
  // claim held by a function the platform stopped before the send kept the day's summary from ever going.
  const claim = { id: 7, event: RUN_HEALTH_EVENT, client_domain_id: null, member_email: null, path: null, props: { day: DAY, sent: false, at: iso(AFTER_RUNS) } };
  const { db, tables } = fakeDb(day({ runs: [{ client_domain_id: "a", status: "failed", error: "x" }, { client_domain_id: "b", status: "complete" }], events: [claim] }));
  const box = outbox();
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS + 2 * MIN }), "taken", "two minutes on: it may still be sending");
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS + RUN_HEALTH_CLAIM_STALE_MS + MIN }), "sent", "past ten minutes: no function is still sending it");
  assert.equal(box.sent.length, 1);
  assert.deepEqual(
    tables.dashboard_events!.map((e) => [e.event, (e.props as Row).sent]),
    [[RUN_HEALTH_UNSENT, false], [RUN_HEALTH_EVENT, true]],
    "the stopped claim released by a compare-and-swap, a new one made and marked sent",
  );
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS + 3 * RUN_HEALTH_CLAIM_STALE_MS }), "taken", "and never again");
  // The next morning's catch-up finds a claim stopped the evening before just the same.
  const stopped = fakeDb(day({ runs: [{ client_domain_id: "a", status: "failed", error: "x" }], events: [{ ...claim }] }));
  assert.equal(await reportRunHealth(stopped.db, box.health, { day: DAY, now: Date.parse("2026-10-10T05:00:30Z") }), "sent");
  assert.equal(box.sent.length, 2);
  assert.equal(claimAbandoned({ day: DAY }, AFTER_RUNS + 3 * RUN_HEALTH_CLAIM_STALE_MS), false, "a claim with no sent flag reads as sent");
  assert.equal(claimAbandoned({ day: DAY, sent: true, at: iso(AFTER_RUNS) }, AFTER_RUNS + 3 * RUN_HEALTH_CLAIM_STALE_MS), false);
});

test("two runs closing together: the unique index lets one claim through", async () => {
  // Both read no claim (the read is before either insert), then both insert.
  const { db, tables } = fakeDb(day({ runs: [{ client_domain_id: "a", status: "failed", error: "x" }, { client_domain_id: "b", status: "partial", error: "y" }] }));
  const box = outbox();
  const out = await Promise.all([reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS }), reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS })]);
  assert.deepEqual(out.sort(), ["sent", "taken"]);
  assert.equal(box.sent.length, 1);
  assert.equal(tables.dashboard_events!.length, 1);
});

test("the morning after: a day a killed run held open is summarised once the sweep has closed it", async () => {
  const { db, tables } = fakeDb(day({ runs: [{ client_domain_id: "a", status: "complete" }, { client_domain_id: "b", status: "running" }] }));
  const box = outbox();
  // 05:06 on the day: b was killed at 05:05 and is "running" - in flight, so nobody sends.
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: AFTER_RUNS }), "pending");
  // The 03:45 stall sweep closes it; the next morning's cron reports the day before.
  Object.assign(tables.tracking_runs![1]!, { status: "failed", error: "the run was stopped before it could record a result, and was closed by the stall sweep" });
  assert.equal(await reportRunHealth(db, box.health, { day: DAY, now: Date.parse("2026-10-10T05:00:30Z") }), "sent");
  assert.match(box.sent[0]!.text, /ledgerline\.com: failed - the run was stopped/);
  assert.match(box.sent[0]!.text, /can no longer be re-run/);
});

test("reliability-2: 2,500 live prompts across 25 clients - every client is counted and dispatched", async () => {
  const clients: Row[] = [];
  const prompts: Row[] = [];
  for (let c = 0; c < 25; c++) {
    const id = `c${String(c).padStart(2, "0")}`;
    clients.push({ id, domain: `client${c}.example`, status: "active", started_on: "2026-10-01", tier: "tracked" });
    for (let q = 0; q < 100; q++) prompts.push({ id: `${id}-q${String(q).padStart(3, "0")}`, client_domain_id: id, added_on: "2026-10-01", stopped_on: null });
  }
  // Prompts stopped or not yet live are not counted, and an ended client is never read.
  prompts.push({ id: "zz-stopped", client_domain_id: "c00", added_on: "2026-10-01", stopped_on: "2026-10-05" });
  prompts.push({ id: "zz-tomorrow", client_domain_id: "c01", added_on: "2026-10-10", stopped_on: null });
  clients.push({ id: "ended", domain: "ended.example", status: "ended", started_on: "2026-10-01", tier: "tracked" });
  const { db, calls } = fakeDb({ client_domains: clients, tracked_questions: prompts });

  // The read this replaced: one select, no range. PostgREST answers 1,000 rows.
  const { data: old } = (await db.from("tracked_questions").select("client_domain_id, added_on, stopped_on").is("stopped_on", null)) as { data: Row[] };
  const oldCounted = new Set(old.map((q) => q.client_domain_id));
  assert.equal(old.length, 1000, "the stand-in caps a select as PostgREST does");
  assert.ok(oldCounted.size < 25, `the unpaged read saw ${oldCounted.size} of 25 clients - the rest were skipped, silently`);

  const trackable = await readTrackable(db, DAY);
  assert.equal(trackable.length, 25, "active clients only");
  assert.deepEqual(new Set(trackable.map((c) => c.activeQuestions)), new Set([100]), "every client's live prompts, past the thousand");
  assert.equal(trackable.filter((c) => c.track).length, 25, "every client is dispatched");
  assert.ok(calls.filter((c) => c.table === "tracked_questions" && c.range).length >= 3, "read in pages");
});

test("readRunHealth reads every run of the day, past a thousand", async () => {
  const clients: Row[] = [];
  const runs: Row[] = [];
  for (let c = 0; c < 1200; c++) {
    const id = `c${String(c).padStart(4, "0")}`;
    clients.push({ id, domain: `client${c}.example`, status: "active", started_on: "2026-10-01", tier: "tracked" });
    runs.push({ id: `r${String(c).padStart(4, "0")}`, client_domain_id: id, run_date: DAY, status: "complete", error: null, created_at: `${DAY}T05:00:01Z`, started_at: `${DAY}T05:00:03Z` });
  }
  const prompts = clients.map((c) => ({ id: `q-${c.id as string}`, client_domain_id: c.id, added_on: "2026-10-01", stopped_on: null }));
  const { db } = fakeDb({ client_domains: clients, tracked_questions: prompts, tracking_runs: runs });
  const h = await readRunHealth(db, DAY, AFTER_RUNS);
  assert.equal(h.expected, 1200);
  assert.equal(h.counts.complete, 1200, "an unpaged read would have called 200 of them missing");
  assert.equal(h.counts.missing, 0);
});

test("census: the dispatch opens runs off readTrackable's verdict, and every health reading shares it", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const runner = read("./runner.ts");
  const body = runner.slice(runner.indexOf("export async function dispatchTrackingRuns"), runner.indexOf("type AnswerRow"));
  assert.match(body, /for \(const client of await readTrackable\(db, day\)\) \{\s*if \(!client\.track\) \{/);
  assert.doesNotMatch(body, /from\("tracked_questions"\)|from\("client_domains"\)/, "no second read of who should run");
  // The runner reports as it closes, on every way out of a claimed run.
  assert.equal([...runner.matchAll(/await reportRunHealthSafely\(/g)].length, 3, "refused, closed, thrown");
  const cron = read("../../app/api/cron/track/route.ts");
  assert.match(cron, /const health = await runHealthAfterDispatch\(note\);\s*const mail = await sweepLifecycleMailSafely\(\);/);
  const health = read("../../app/api/health/runs/route.ts");
  assert.match(health, /healthAnswer\(await readRunHealth\(supabaseAdmin\(\), day, now\), now\)/);
  assert.doesNotMatch(health, /reportRunHealth|from "resend"|health-mail|health-io/, "the public health JSON sends nothing");
  const page = read("../../app/admin/tracking/page.tsx");
  assert.match(page, /readRunHealth\(db, today, now\)/);
});

/** 19 Oct 2026 as it was: the two in-house profiles paused, with live clusters and prompts, and nothing else. */
function pausedDay(over: { status?: string; clusters?: Row[] } = {}) {
  const status = over.status ?? "paused";
  return {
    client_domains: [
      { id: "ac", domain: "alwayscited.com", status, started_on: "2026-10-19", tier: "cited" },
      { id: "nd", domain: "nomadadigital.co.uk", status, started_on: "2026-10-19", tier: "cited" },
      { id: "gone", domain: "ended.example", status: "ended", started_on: "2026-09-01", tier: "tracked" },
      { id: "new", domain: "starts-later.example", status: "active", started_on: "2026-10-25", tier: "tracked" },
    ],
    tracked_questions: [
      { id: "q1", client_domain_id: "ac", added_on: "2026-10-19", stopped_on: null },
      { id: "q2", client_domain_id: "nd", added_on: "2026-10-19", stopped_on: null },
      { id: "q3", client_domain_id: "gone", added_on: "2026-09-01", stopped_on: null },
      { id: "q4", client_domain_id: "new", added_on: "2026-10-25", stopped_on: null },
    ],
    tracked_clusters: over.clusters ?? [
      { id: "k1", client_domain_id: "ac", started_on: "2026-10-19", stopped_on: null },
      { id: "k2", client_domain_id: "nd", started_on: "2026-10-19", stopped_on: null },
      { id: "k3", client_domain_id: "nd", started_on: "2026-10-19", stopped_on: null },
      { id: "k4", client_domain_id: "gone", started_on: "2026-09-01", stopped_on: null },
      { id: "k5", client_domain_id: "new", started_on: "2026-10-25", stopped_on: null },
    ],
    tracking_runs: [] as Row[],
    dashboard_events: [] as Row[],
  };
}
const OCT19 = "2026-10-19";

test("20 Oct 2026: readSkips names every client the dispatch does not read, paused ones included, ended ones not", async () => {
  const { db } = fakeDb(pausedDay());
  const skips = await readSkips(db, OCT19);
  assert.deepEqual(
    skips.map((s) => [s.domain, s.reason, s.liveClusters]).sort(),
    [["alwayscited.com", "status is paused", 1], ["nomadadigital.co.uk", "status is paused", 2], ["starts-later.example", "starts on 2026-10-25", 0]],
  );
  assert.deepEqual(await readTrackable(db, OCT19).then((t) => t.filter((c) => c.track)), [], "and the dispatch reads none of them");
});

test("20 Oct 2026: a day that skips clients with live clusters sends the run-health mail, naming them; a paused client with nothing set up does not", async () => {
  const { db } = fakeDb(pausedDay());
  const box = outbox();
  assert.equal(await reportRunHealth(db, box.health, { day: OCT19, now: Date.parse(`${OCT19}T05:00:05Z`) }), "sent", "19 Oct went unreported; now it mails");
  assert.equal(box.sent.length, 1);
  assert.match(box.sent[0]!.subject, /2 clients with live clusters skipped/);
  assert.match(box.sent[0]!.text, /- alwayscited\.com: skipped - status is paused, 1 live cluster\n/);
  assert.match(box.sent[0]!.text, /- nomadadigital\.co\.uk: skipped - status is paused, 2 live clusters/);
  assert.doesNotMatch(box.sent[0]!.text, /ended\.example|starts-later\.example/, "ended and not-yet-started clients are not alerts");
  assert.equal(await reportRunHealth(db, box.health, { day: OCT19, now: Date.parse(`${OCT19}T05:01:00Z`) }), "taken", "once a day");

  const quiet = fakeDb(pausedDay({ clusters: [] }));
  assert.equal(await reportRunHealth(quiet.db, outbox().health, { day: OCT19, now: Date.parse(`${OCT19}T05:00:05Z`) }), "healthy", "no live cluster, nothing to say");
  const active = fakeDb(pausedDay({ status: "active" }));
  assert.equal(await readSkips(active.db, OCT19).then((s) => s.filter((x) => x.reason.startsWith("status")).length), 0, "set back to active: no longer skipped");
});

test("20 Oct 2026: recordSkips records each skipped client once a day, with its reason", async () => {
  const { db, tables } = fakeDb(pausedDay());
  const first = await recordSkips(db, OCT19);
  assert.equal(first.alerts, 2);
  assert.equal(first.recorded, 3);
  const rows = tables.dashboard_events!.filter((e) => e.event === TRACKING_SKIP_EVENT);
  assert.deepEqual(rows.map((e) => [e.client_domain_id, (e.props as Row).reason, (e.props as Row).alert]).sort(), [
    ["ac", "status is paused", true],
    ["nd", "status is paused", true],
    ["new", "starts on 2026-10-25", false],
  ]);
  assert.equal((await recordSkips(db, OCT19)).recorded, 0, "a second call the same day records nothing twice");
  assert.equal(tables.dashboard_events!.filter((e) => e.event === TRACKING_SKIP_EVENT).length, 3);
});
