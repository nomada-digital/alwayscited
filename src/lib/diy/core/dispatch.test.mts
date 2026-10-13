import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyRun } from "../../tracking/decide.ts";

import {
  DIY_RUN_URL,
  DIY_SIGNATURE_HEADER,
  type FreeAnswer,
  NIGHT_WINDOW_UTC,
  dispatchDiyWork,
  enqueueOnboarding,
  inNightWindow,
  newestByClient,
  workerBody,
  workerPostProblem,
} from "./dispatch.ts";
import { fakeDiyDb, settingsRows, testClient } from "./fake-diy.mts";
import { type JobSpec, MAX_ATTEMPTS, STALE_CLAIM_MS } from "./jobs.ts";

/**
 * The DIY night dispatch on the fake database (13 Oct 2026, DIY P1; spec 10
 * section 5.7): no paid kind is queued while dark, the two free vendor reads
 * are made once a UTC day whatever the switch, two signed workers are posted
 * by the first pass and by the second only while due jobs remain.
 */

const NOW = Date.parse("2026-10-14T03:30:05Z");
const SECRET = "test-secret";
type Row = Record<string, unknown>;

const FREE_KIND: JobSpec = { kind: "plan_refresh", paid: false, cadence: "daily", priority: 1, onboarding: false };
const PAID_KIND: JobSpec = { kind: "footprint", paid: true, cadence: "weekly", priority: 3, onboarding: true };
const FREE_ONBOARD: JobSpec = { kind: "key_pages_weekly", paid: false, cadence: "weekly", priority: 4, onboarding: true };

function world(over: { enabled?: boolean; jobs?: Row[]; vendor?: Row[]; failFree?: string } = {}) {
  const fake = fakeDiyDb({ app_settings: settingsRows({ diy_enabled: over.enabled ?? false }), diy_jobs: [...(over.jobs ?? [])], diy_vendor_status: [...(over.vendor ?? [])] });
  fake.clock.now = NOW;
  const freeCalls: string[] = [];
  const free = async (path: string): Promise<FreeAnswer> => {
    freeCalls.push(path);
    if (over.failFree && path.includes(over.failFree)) throw new Error("DataForSEO 500: down");
    return path.includes("labs") ? { kind: "labs_status", googleDate: "2026-10-10", payload: { google: "2026-10-10" } } : { kind: "backlinks_filters", googleDate: null, payload: { groups: { backlinks: ["dofollow"] } } };
  };
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => (posts.push({ url, headers: init.headers, body: init.body }), { status: 202 });
  return { fake, free, freeCalls, posts, fetchImpl };
}

const run = (w: ReturnType<typeof world>, pass: 1 | 2, handlers: JobSpec[] = [FREE_KIND, PAID_KIND], clients = [testClient()]) =>
  dispatchDiyWork({ db: w.fake.db, handlers, pass, free: w.free, now: () => NOW, secret: SECRET, fetchImpl: w.fetchImpl as never, loadClients: async () => clients });

test("dark: no paid kind is queued, the free kinds are, and the two free vendor reads are still made", async () => {
  const w = world({ enabled: false });
  const out = await run(w, 1);
  assert.equal(out.enabled, false);
  assert.deepEqual(w.fake.tables.diy_jobs!.map((r) => r.kind), ["plan_refresh"]);
  assert.deepEqual(w.freeCalls.sort(), ["/v3/backlinks/available_filters", "/v3/dataforseo_labs/status"]);
  assert.deepEqual(
    w.fake.tables.diy_vendor_status!.map((r) => [r.kind, r.read_on, r.google_date]).sort(),
    [["backlinks_filters", "2026-10-14", null], ["labs_status", "2026-10-14", "2026-10-10"]],
  );
  assert.deepEqual(out.vendor, { labs_status: "read", backlinks_filters: "read" });
});

test("the vendor reads are made once a UTC day: the second pass finds them", async () => {
  const w = world();
  await run(w, 1);
  w.freeCalls.length = 0;
  const second = await run(w, 2);
  assert.deepEqual(w.freeCalls, []);
  assert.deepEqual(second.vendor, { labs_status: "had", backlinks_filters: "had" });
});

test("one free read failing does not stop the other, and its error is reported", async () => {
  const w = world({ failFree: "labs" });
  const out = await run(w, 1);
  assert.deepEqual(out.vendor, { labs_status: "failed", backlinks_filters: "read" });
  assert.match(out.errors.join("\n"), /labs_status: DataForSEO 500/);
});

test("switched on, a confirmed client's paid kinds are queued - onboarding first - and an unconfirmed client's are not", async () => {
  const w = world({ enabled: true });
  const confirmed = testClient();
  const waiting = testClient({ id: "c-waiting", setupConfirmedAt: null });
  await run(w, 1, [FREE_KIND, PAID_KIND], [confirmed, waiting]);
  const rows = w.fake.tables.diy_jobs!;
  assert.deepEqual(rows.filter((r) => r.client_domain_id === "c-tallyroo").map((r) => [r.kind, r.payload]).sort(), [["footprint", { onboarding: true }], ["plan_refresh", { onboarding: false }]]);
  assert.deepEqual(rows.filter((r) => r.client_domain_id === "c-waiting").map((r) => r.kind), ["plan_refresh"]);
});

test("a second pass queues nothing twice", async () => {
  const w = world({ enabled: true });
  await run(w, 1);
  const before = w.fake.tables.diy_jobs!.length;
  await run(w, 2);
  assert.equal(w.fake.tables.diy_jobs!.length, before);
});

test("the first pass posts two workers, signed with an HMAC of the body, to the site's own origin", async () => {
  const w = world();
  const out = await run(w, 1);
  assert.equal(out.pending, 1);
  assert.equal(out.posted, 2);
  assert.equal(w.posts.length, 2);
  for (const p of w.posts) {
    assert.equal(p.url, DIY_RUN_URL);
    assert.match(p.url, /^https:\/\/[^/]+\/api\/diy\/run$/);
    assert.ok(verifyRun(p.body, p.headers[DIY_SIGNATURE_HEADER]!, SECRET), "the worker route accepts the signature");
    assert.ok(!verifyRun(p.body, p.headers[DIY_SIGNATURE_HEADER]!, "another-secret"));
  }
  assert.deepEqual(w.posts.map((p) => JSON.parse(p.body).worker).sort(), [1, 2]);
});

test("the second pass posts its two only while claimable due jobs remain", async () => {
  const done = { id: "d1", client_domain_id: "c-tallyroo", kind: "plan_refresh", due_on: "2026-10-14", priority: 1, payload: null, claimed_at: "2026-10-14T03:30:10Z", done_at: "2026-10-14T03:31:00Z", attempts: 1, created_at: "2026-10-14T03:30:00Z" };
  const quiet = world({ jobs: [done] });
  const nothing = await run(quiet, 2, [FREE_KIND]);
  assert.equal(nothing.pending, 0);
  assert.equal(nothing.posted, 0, "everything is done: no worker is posted");
  const busy = world({ jobs: [{ ...done, id: "d2", kind: "other", done_at: null, claimed_at: null, attempts: 0 }] });
  const more = await run(busy, 2, [FREE_KIND]);
  assert.equal(more.posted, 2);
  const inFlight = world({ jobs: [{ ...done, id: "d3", done_at: null, claimed_at: new Date(NOW - 60_000).toISOString() }] });
  assert.equal((await run(inFlight, 2, [FREE_KIND])).posted, 0, "a job a pass-1 worker still holds is not pending");
});

test("no CRON_SECRET, no worker; a wrongly wired handler list queues nothing", async () => {
  const w = world();
  const out = await dispatchDiyWork({ db: w.fake.db, handlers: [FREE_KIND], pass: 1, free: w.free, now: () => NOW, secret: "", fetchImpl: w.fetchImpl as never, loadClients: async () => [testClient()] });
  assert.equal(out.posted, 0);
  assert.match(out.errors.join("\n"), /CRON_SECRET is not set/);
  const twice = world();
  const bad = await run(twice, 1, [FREE_KIND, { ...FREE_KIND }]);
  assert.equal(bad.queued, 0);
  assert.match(bad.errors.join("\n"), /registered twice/);
  assert.equal(twice.fake.tables.diy_jobs!.length, 0);
});

test("a failed settings read is off: free kinds queue, nothing paid does", async () => {
  const w = world({ enabled: true });
  const failing = fakeDiyDb(w.fake.tables, { failSelect: (t) => t === "app_settings" });
  failing.clock.now = NOW;
  const out = await dispatchDiyWork({ db: failing.db, handlers: [FREE_KIND, PAID_KIND], pass: 1, free: w.free, now: () => NOW, secret: SECRET, fetchImpl: w.fetchImpl as never, loadClients: async () => [testClient()] });
  assert.equal(out.enabled, false);
  assert.deepEqual(w.fake.tables.diy_jobs!.map((r) => r.kind), ["plan_refresh"]);
});

test("each client's newest row of each kind is the one due-ness is read from", () => {
  const last = newestByClient([
    { client_domain_id: "a", kind: "k", due_on: "2026-10-01", created_at: "2026-10-01T03:30:00Z" },
    { client_domain_id: "a", kind: "k", due_on: "2026-10-08", created_at: "2026-10-08T03:30:00Z" },
    { client_domain_id: "a", kind: "k", due_on: "2026-10-08", created_at: "2026-10-08T03:45:00Z" },
    { client_domain_id: "b", kind: "k", due_on: "2026-09-01", created_at: "2026-09-01T03:30:00Z" },
  ]);
  assert.deepEqual(last.get("a")!.get("k"), { due_on: "2026-10-08", created_at: "2026-10-08T03:45:00Z", done_at: null });
  assert.equal(last.get("b")!.get("k")!.due_on, "2026-09-01");
});

test("setup confirmed queues the onboarding runs for tonight: free ones always, paid ones only while DIY is on", async () => {
  const dark = world({ enabled: false });
  assert.equal(await enqueueOnboarding(dark.fake.db, "c-new", { handlers: [FREE_KIND, PAID_KIND, FREE_ONBOARD], now: NOW }), 1);
  assert.deepEqual(dark.fake.tables.diy_jobs!.map((r) => [r.kind, r.due_on, r.payload]), [["key_pages_weekly", "2026-10-14", { onboarding: true }]]);
  const on = world({ enabled: true });
  await enqueueOnboarding(on.fake.db, "c-new", { handlers: [FREE_KIND, PAID_KIND, FREE_ONBOARD], now: NOW });
  assert.deepEqual(on.fake.tables.diy_jobs!.map((r) => r.kind).sort(), ["footprint", "key_pages_weekly"]);
});

test("13 Oct 2026: a signed worker post is taken only on its own night - today's UTC day, 03:25 to 04:20 UTC", () => {
  const body = () => JSON.parse(workerBody({ pass: 1, worker: 1, day: "2026-10-14" })) as Record<string, unknown>;
  const at = (hhmm: string, day = "2026-10-14") => Date.parse(`${day}T${hhmm}:00Z`);
  assert.equal(workerPostProblem(body(), at("03:30")), null);
  assert.equal(workerPostProblem({ ...body(), pass: 2 }, at("04:19")), null);
  assert.equal(workerPostProblem(body(), at("04:20")), "outside the night window");
  assert.equal(workerPostProblem(body(), at("03:24")), "outside the night window");
  assert.equal(workerPostProblem(body(), at("05:05")), "outside the night window", "never in the tracking burst");
  assert.equal(workerPostProblem(body(), at("03:30", "2026-10-15")), "not tonight's post", "a replay the next night");
  assert.equal(workerPostProblem({ ...body(), worker: 0 }, at("03:30")), "bad worker");
  assert.equal(workerPostProblem({ ...body(), pass: 3 }, at("03:30")), "bad pass");
  assert.equal(workerPostProblem(null, at("03:30")), "bad worker");
  assert.deepEqual(NIGHT_WINDOW_UTC, { from: 205, to: 260 });
  assert.ok(inNightWindow(NOW), "the dispatcher's own posts fall inside it");
});

test("13 Oct 2026: a pass closes rows whose third attempt never closed, then queues the kind's next slot", async () => {
  const stale = new Date(NOW - STALE_CLAIM_MS - 60_000).toISOString();
  const dead = { id: "dead", client_domain_id: "c-tallyroo", kind: "plan_refresh", due_on: "2026-10-13", priority: 1, payload: null, claimed_at: stale, done_at: null, attempts: MAX_ATTEMPTS, outcome: null, note: null, created_at: "2026-10-13T03:30:00Z" };
  const w = world({ jobs: [dead] });
  const out = await run(w, 1, [FREE_KIND]);
  assert.equal(out.expired, 1);
  const rows = w.fake.tables.diy_jobs!;
  assert.ok(rows.find((r) => r.id === "dead")!.done_at, "closed");
  assert.deepEqual(rows.filter((r) => r.id !== "dead").map((r) => [r.kind, r.due_on]), [["plan_refresh", "2026-10-14"]], "and tonight's row queued");
  assert.equal(out.pending, 1);
});

test("13 Oct 2026: a daily row carried from last night is tonight's row; no second one is queued", async () => {
  const carried = { id: "c1", client_domain_id: "c-tallyroo", kind: "plan_refresh", due_on: "2026-10-13", priority: 1, payload: { onboarding: false }, claimed_at: null, done_at: null, attempts: 0, outcome: null, note: null, created_at: "2026-10-13T03:30:00Z" };
  const w = world({ jobs: [carried] });
  const out = await run(w, 1, [FREE_KIND]);
  assert.equal(out.queued, 0);
  assert.equal(w.fake.tables.diy_jobs!.length, 1);
  assert.equal(out.pending, 1, "the carried row is what tonight's workers take");
});

test("13 Oct 2026: an event kind onboarded long ago is not onboarded again when its row ages out of the lookback", async () => {
  const EVENT_ONBOARD: JobSpec = { kind: "setup_scan", paid: false, cadence: "event", priority: 2, onboarding: true };
  const old = { id: "o1", client_domain_id: "c-tallyroo", kind: "setup_scan", due_on: "2026-06-10", priority: 2, payload: { onboarding: true }, claimed_at: "2026-06-10T03:31:00Z", done_at: "2026-06-10T03:32:00Z", attempts: 1, outcome: "ok", note: null, created_at: "2026-06-10T03:30:00Z" };
  const w = world({ jobs: [old] });
  const client = testClient({ setupConfirmedAt: "2026-06-09T12:00:00Z" });
  const out = await run(w, 1, [EVENT_ONBOARD], [client]);
  assert.equal(out.queued, 0, "June's onboarding row counts, though it is outside the 62 days read for the calendar");
  const fresh = world();
  assert.equal((await run(fresh, 1, [EVENT_ONBOARD], [client])).queued, 1, "never onboarded: onboarded tonight");
});
