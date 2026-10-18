import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { trialCharge, trialMoment } from "../../config/trial.ts";
import { actionsUrl, dashboardUrl, type Rendered } from "./lifecycle.ts";
import { mailTrialEnding, planEndedOwners, sweepLifecycleMail, type SweepIo } from "./lifecycle-sweep.ts";

/**
 * The lifecycle sweep, run (8 Oct 2026, review of 7e133a7).
 *
 * 7e133a7 shipped the daily cron's sends with a census that read regexes off
 * the source, and a run against an in-memory database that lived in a
 * scratchpad and so never ran again. This is that run, committed. The sweep
 * takes its sender as `io` (lifecycle-cron.ts hands it the real one), so here
 * it gets a recording sender that never reaches Resend, and a small stand-in
 * for the supabase-js query builder that holds the rows in memory, logs every
 * table read, enforces the unique index 20261008040000 adds, and can be told
 * to lose a race.
 *
 * Nothing is read from or written to a real database, and no email is sent.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** The mail events the unique partial index dashboard_events_lifecycle_mail_once covers. */
const ONCE = ["trial_mail_midpoint", "trial_mail_ending", "setup_mail_24h", "setup_mail_72h"];

function fakeDb(tables: Tables, opts: { beforeInsert?: (table: string, row: Row) => void; failReads?: Set<string> } = {}) {
  let nextId = 1000;
  const reads: string[] = [];
  const query = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      op: "select" as "select" | "insert" | "update",
      cols: null as string | null,
      row: null as Row | null,
      patch: null as Row | null,
      orderBy: null as [string, boolean] | null,
      lim: null as number | null,
      rng: null as [number, number] | null,
      one: null as "maybe" | "one" | null,
    };
    const b = {
      select(cols: string) {
        if (q.op === "select") q.cols = cols;
        return b;
      },
      insert(row: Row) {
        q.op = "insert";
        q.row = row;
        return b;
      },
      update(patch: Row) {
        q.op = "update";
        q.patch = patch;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), b),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), b),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), b),
      order: (c: string, o: { ascending?: boolean } = {}) => ((q.orderBy = [c, o.ascending !== false]), b),
      limit: (n: number) => ((q.lim = n), b),
      range: (from: number, to: number) => ((q.rng = [from, to]), b),
      maybeSingle: () => ((q.one = "maybe"), b),
      single: () => ((q.one = "one"), b),
      then(resolve: (v: { data: unknown; error: { code?: string; message: string } | null }) => void) {
        resolve(run());
      },
    };
    const run = (): { data: unknown; error: { code?: string; message: string } | null } => {
      const rows = (tables[table] ??= []);
      if (q.op === "insert") {
        opts.beforeInsert?.(table, q.row!);
        const row: Row = { id: nextId++, ...q.row };
        // 13 Oct 2026, DIY P9: and this_week's, 20261014200000's partial unique index on this_week_mail_<monday>.
        const once = (r: Row) => ONCE.includes(String(r.event)) || String(r.event).startsWith("this_week_mail_");
        if (table === "dashboard_events" && once(row) && rows.some((r) => once(r) && r.client_domain_id === row.client_domain_id && r.event === row.event)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "dashboard_events_lifecycle_mail_once"' } };
        }
        rows.push(row);
        return { data: q.one ? { id: row.id } : [{ id: row.id }], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (q.op === "update") {
        for (const r of hit) Object.assign(r, q.patch);
        return { data: hit, error: null };
      }
      reads.push(table);
      if (opts.failReads?.has(table)) return { data: null, error: { message: `${table} read refused by the test` } };
      let out = hit;
      if (q.orderBy) {
        const [c, asc] = q.orderBy;
        out = [...out].sort((a, z) => (String(a[c]) < String(z[c]) ? -1 : String(a[c]) > String(z[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (q.rng) out = out.slice(q.rng[0], q.rng[1] + 1);
      if (q.lim !== null) out = out.slice(0, q.lim);
      const picked = out.map((r) => (q.cols ? Object.fromEntries(q.cols.split(",").map((c) => [c.trim(), r[c.trim()] ?? null])) : { ...r }));
      if (q.one === "maybe") return { data: picked[0] ?? null, error: null };
      if (q.one === "one") return picked.length === 1 ? { data: picked[0], error: null } : { data: null, error: { message: "not one row" } };
      return { data: picked, error: null };
    };
    return b;
  };
  return { db: { from: query } as unknown as SupabaseClient, reads };
}

const ORIGIN = "https://alwayscited.example";
const PRICE = { us: 101, uk: 77 };

/** A sender that records and never reaches Resend; `fail` makes every send reach nobody. */
function recorder() {
  const outbox: { to: string; mail: Rendered }[] = [];
  const state = { fail: false };
  const io: SweepIo = {
    send: async ({ memberEmail, mail }) => {
      if (state.fail) return false;
      outbox.push({ to: memberEmail, mail });
      return true;
    },
    origin: ORIGIN,
    price: PRICE,
  };
  return { io, outbox, state };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Thursday 15 Oct 2026, 05:00 UTC - the cron's hour. */
const NOW = Date.parse("2026-10-15T05:00:00Z");
const at = (ms: number) => new Date(ms).toISOString();

const client = (id: string, account: string, extra: Row = {}): Row => ({
  id,
  account_id: account,
  domain: `${id}.com`,
  brand_name: null,
  market: "US",
  slug: `${id}-com`,
  status: "active",
  tier: "tracked",
  cluster_limit: 10,
  trial_ends_at: null,
  trial_cancelled_at: null,
  ...extra,
});

/**
 * The fixture: a1 and a3 are nomada accounts, a2 an agency.
 *
 * - c1: a 14-day trial a week in - trial_midpoint is due.
 * - c2: a UK trial ending in under three days - trial_ending is due.
 * - c3: the same trial as c1, cancelled - nothing.
 * - c4: the same trial as c1, on the agency account - nothing.
 * - c5: a checkout signup 33 hours ago, one cluster of ten with prompts - setup_mail_24h.
 * - c6: a checkout signup 73 hours ago that confirmed setup - nothing.
 * - c7: a client made by hand, no order - nothing.
 * - c11: a checkout signup 33 hours ago with both of its two clusters filled, never confirmed - nothing.
 * - c12: a trial ended early in Stripe, its trial_ends_at moved behind now by the webhook - nothing.
 */
function fixture(flags: Partial<Record<"trial_midpoint" | "trial_ending" | "setup_reminder", boolean>> = {}): Tables {
  const on = { trial_midpoint: true, trial_ending: true, setup_reminder: true, ...flags };
  return {
    app_settings: Object.entries(on).map(([n, v]) => ({ key: `email_${n}_enabled`, value: v })),
    accounts: [
      { id: "a1", upsell_mode: "nomada" },
      { id: "a2", upsell_mode: "agency" },
      { id: "a3", upsell_mode: null },
      { id: "a4", upsell_mode: "off" },
    ],
    client_domains: [
      client("c1", "a1", { trial_ends_at: at(NOW + 7 * DAY) }),
      client("c2", "a3", { trial_ends_at: at(NOW + 2 * DAY + 14.5 * HOUR), market: "UK" }),
      client("c3", "a1", { trial_ends_at: at(NOW + 7 * DAY), trial_cancelled_at: at(NOW - 4 * DAY) }),
      client("c4", "a2", { trial_ends_at: at(NOW + 7 * DAY) }),
      client("c5", "a3"),
      client("c6", "a3"),
      client("c7", "a1"),
      client("c11", "a3", { cluster_limit: 2 }),
      client("c12", "a1", { trial_ends_at: at(NOW - 2 * DAY) }),
    ],
    orders: [
      { client_domain_id: "c5", created_at: at(NOW - 33 * HOUR) },
      { client_domain_id: "c6", created_at: at(NOW - 73 * HOUR) },
      { client_domain_id: "c11", created_at: at(NOW - 33 * HOUR) },
    ],
    dashboard_events: [{ id: 1, client_domain_id: "c6", event: "setup_confirmed" }],
    dashboard_members: [
      { account_id: "a1", email: "owner1@example.com", role: "owner", removed_at: null },
      { account_id: "a1", email: "gone@example.com", role: "owner", removed_at: at(NOW - 14 * DAY) },
      { account_id: "a1", email: "viewer@example.com", role: "viewer", removed_at: null },
      { account_id: "a2", email: "agency@example.com", role: "owner", removed_at: null },
      { account_id: "a3", email: "owner3@example.com", role: "owner", removed_at: null },
      { account_id: "a4", email: "owner4@example.com", role: "owner", removed_at: null },
    ],
    tracking_runs: [{ client_domain_id: "c1", run_date: "2026-10-09", status: "complete" }],
    tracking_answers: [
      { id: 1, client_domain_id: "c1", run_date: "2026-10-09", question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: ["Xero"] },
      { id: 2, client_domain_id: "c1", run_date: "2026-10-09", question_id: "q2", engine: "chatgpt", answered: true, named: false, brands: ["Xero", "Sage"] },
      { id: 3, client_domain_id: "c1", run_date: "2026-10-10", question_id: "q1", engine: "perplexity", answered: false, named: false, brands: [] },
    ],
    tracked_clusters: [
      { id: "k1", client_domain_id: "c1", stopped_on: null },
      { id: "k5", client_domain_id: "c5", stopped_on: null },
      { id: "k11a", client_domain_id: "c11", stopped_on: null },
      { id: "k11b", client_domain_id: "c11", stopped_on: null },
    ],
    tracked_questions: [
      { client_domain_id: "c1", cluster_id: "k1", stopped_on: null },
      { client_domain_id: "c5", cluster_id: "k5", stopped_on: null },
      { client_domain_id: "c11", cluster_id: "k11a", stopped_on: null },
      { client_domain_id: "c11", cluster_id: "k11b", stopped_on: null },
    ],
  };
}

/** Each client's mail claims, as "client event". */
const claims = (t: Tables) =>
  t.dashboard_events
    .filter((e) => e.event !== "setup_confirmed")
    .map((e) => `${e.client_domain_id} ${e.event}`)
    .sort();

test("one run mails each due email once, to live owners only, and a second run mails nothing", async () => {
  const t = fixture();
  const { db } = fakeDb(t);
  const { io, outbox } = recorder();

  const first = await sweepLifecycleMail(db, io, NOW);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.sent.sort(), ["setup_mail_24h c5", "trial_ending c2", "trial_midpoint c1"]);
  assert.deepEqual(claims(t), ["c1 trial_mail_midpoint", "c2 trial_mail_ending", "c5 setup_mail_24h"], "one claim per email per client");
  assert.deepEqual(
    outbox.map((m) => `${m.to} ${m.mail.subject}`).sort(),
    // The subjects moved with the redesign (18 Oct 2026, brief 2e): the brief's own lines, the trial's end said as its
    // day in the client's zone (trialMoment's date), and a reminder to a client whose prompts are already read says
    // its setup is unfinished rather than that its first reading waits.
    [
      "owner1@example.com Seven days in: here's what a week of readings shows",
      `owner3@example.com Your trial ends on ${trialMoment(at(NOW + 2 * DAY + 14.5 * HOUR), "UK").split(",")[0]!.replace(/ \d{4}$/, "")}`,
      "owner3@example.com Your setup isn't finished yet",
    ].sort(),
    "no removed owner, no viewer, no agency account, no cancelled trial, no confirmed or hand-made client",
  );

  // What io carries is what the email says: the charge from io.price, the links on io.origin.
  const midpoint = outbox.find((m) => m.to === "owner1@example.com")!.mail;
  assert.ok(midpoint.text.includes(trialCharge("US", PRICE)), "the charge is worded from the price the sweep was handed");
  assert.ok(midpoint.text.includes(dashboardUrl("c1-com", ORIGIN)), "the button goes to the client's dashboard on the origin the sweep was handed");
  assert.match(midpoint.text, /since the first check on 9 Oct, c1\.com was named in 1 of 2 AI answers/i);

  const second = await sweepLifecycleMail(db, io, NOW + HOUR);
  assert.deepEqual(second, { sent: [], unsent: [], errors: [] });
  assert.equal(outbox.length, 3, "a second run the same morning mails nobody");
  assert.deepEqual(claims(t), ["c1 trial_mail_midpoint", "c2 trial_mail_ending", "c5 setup_mail_24h"]);
});

test("a setup reminder is not sent once every cluster has prompts", async () => {
  const t = fixture({ trial_midpoint: false, trial_ending: false });
  const { db } = fakeDb(t);
  const { io, outbox } = recorder();
  const out = await sweepLifecycleMail(db, io, NOW);
  assert.deepEqual(out.sent, ["setup_mail_24h c5"], "c11 has both of its two clusters filled: no '0 of your 2 clusters are still empty'");
  assert.ok(!claims(t).some((c) => c.startsWith("c11 ")), "and nothing is claimed for it");
  assert.doesNotMatch(outbox.map((m) => m.mail.text).join("\n"), /\b0 of your/);
});

test("Stripe's trial_will_end and the cron send trial_ending once between them", async () => {
  const t = fixture();
  const { db } = fakeDb(t);
  const { io, outbox } = recorder();
  await sweepLifecycleMail(db, io, NOW);
  assert.equal(await mailTrialEnding(db, io, "c2", NOW + HOUR), true);
  assert.equal(outbox.length, 3, "the cron sent c2's trial_ending; trial_will_end finds it sent");

  // Day 11 of c1's trial: Stripe is first, then the cron finds it sent.
  const day11 = NOW + 4 * DAY + 60_000;
  assert.equal(await mailTrialEnding(db, io, "c1", day11), true);
  assert.equal(outbox.length, 4);
  const later = await sweepLifecycleMail(db, io, day11 + HOUR);
  assert.deepEqual(later.sent, ["setup_mail_72h c5"], "c5's second reminder is due; c1's trial_ending is not sent again");
  assert.equal(claims(t).filter((c) => c === "c1 trial_mail_ending").length, 1);

  // Not for an agency account, a cancelled trial, or a trial already over.
  const before = outbox.length;
  for (const id of ["c4", "c3", "c12"]) assert.equal(await mailTrialEnding(db, io, id, NOW), true, id);
  assert.equal(outbox.length, before);
});

test("a send that reaches nobody releases its claim, and the next morning sends it", async () => {
  const t = fixture({ trial_midpoint: false, setup_reminder: false });
  const { db } = fakeDb(t);
  const { io, outbox, state } = recorder();
  state.fail = true;
  const failed = await sweepLifecycleMail(db, io, NOW);
  assert.deepEqual(failed.unsent, ["trial_ending c2"]);
  assert.deepEqual(failed.sent, []);
  assert.deepEqual(claims(t), ["c2 unsent_trial_mail_ending"], "renamed out of the sent set and out of the unique index");

  state.fail = false;
  const retried = await sweepLifecycleMail(db, io, NOW + DAY);
  assert.deepEqual(retried.sent, ["trial_ending c2"]);
  assert.deepEqual(claims(t), ["c2 trial_mail_ending", "c2 unsent_trial_mail_ending"]);
  assert.equal(outbox.length, 1);
});

test("a claim another run holds - the unique index's 23505 - is taken: no mail, nothing reported", async () => {
  const t = fixture({ trial_midpoint: false, setup_reminder: false });
  // Another cron invocation claims c2 between this run's read of the sent set and its insert.
  const { db } = fakeDb(t, {
    beforeInsert: (table, row) => {
      if (table === "dashboard_events" && row.client_domain_id === "c2" && !t.dashboard_events.some((e) => e.client_domain_id === "c2")) {
        t.dashboard_events.push({ id: 1, client_domain_id: "c2", event: row.event });
      }
    },
  });
  const { io, outbox } = recorder();
  const out = await sweepLifecycleMail(db, io, NOW);
  assert.deepEqual(out, { sent: [], unsent: [], errors: [] });
  assert.equal(outbox.length, 0, "the other run sends it");
  assert.deepEqual(claims(t), ["c2 trial_mail_ending"], "one claim, the other run's");
});

test("each email asks its own flag: off, its clients are not mailed", async () => {
  const t = fixture({ trial_midpoint: false });
  const { db } = fakeDb(t);
  const { io } = recorder();
  const out = await sweepLifecycleMail(db, io, NOW);
  assert.deepEqual(out.sent.sort(), ["setup_mail_24h c5", "trial_ending c2"], "c1's midpoint is due and its flag is off");
});

test("every flag off: nothing is read past the flags, and nothing is sent", async () => {
  const t = fixture({ trial_midpoint: false, trial_ending: false, setup_reminder: false });
  const { db, reads } = fakeDb(t);
  const { io, outbox } = recorder();
  assert.deepEqual(await sweepLifecycleMail(db, io, NOW), { sent: [], unsent: [], errors: [] });
  assert.equal(await mailTrialEnding(db, io, "c2", NOW), true);
  assert.deepEqual([...new Set(reads)], ["app_settings"], "only the flags were read");
  // 13 Oct 2026, DIY P9: five - the sweep asks this_week's flag too (missing here, so off).
  assert.equal(reads.length, 5, "four flags for the sweep, one for trial_will_end");
  assert.equal(outbox.length, 0);
  assert.deepEqual(claims(t), []);
});

test("a flag row that is missing or not jsonb true is off", async () => {
  const t = fixture();
  t.app_settings = [{ key: "email_trial_ending_enabled", value: "true" }];
  const { db } = fakeDb(t);
  const { io, outbox } = recorder();
  assert.deepEqual(await sweepLifecycleMail(db, io, NOW), { sent: [], unsent: [], errors: [] });
  assert.equal(outbox.length, 0);
});

test("a failed read on one client is reported and does not stop the others", async () => {
  const t = fixture({ trial_midpoint: false, setup_reminder: false });
  t.client_domains.push(client("c13", "a3", { trial_ends_at: at(NOW + DAY) }));
  const { db } = fakeDb(t, { failReads: new Set(["tracking_runs"]) });
  const { io, outbox } = recorder();
  const out = await sweepLifecycleMail(db, io, NOW);
  assert.equal(out.errors.length, 2, "c2 and c13 each could not read their runs");
  assert.match(out.errors[0]!, /^trial_ending c(2|13): could not read the runs/);
  assert.deepEqual(claims(t), [], "nothing is claimed for an email that was never built");
  assert.equal(outbox.length, 0);
  assert.equal(await mailTrialEnding(db, io, "c2", NOW), false, "trial_will_end answers false so Stripe retries");
});

/**
 * plan_ended (moved from signup.ts with this test): its copy sends the owner
 * to Billing to ask us to restart, and only upsell mode nomada has Ask us
 * there. A null mode is nomada, as upsellMode reads it.
 */
test("plan_ended goes to live owners in nomada mode only, and to nobody when the account is not read", async () => {
  const t = fixture();
  const { db } = fakeDb(t);
  assert.deepEqual(await planEndedOwners(db, "a1"), [{ email: "owner1@example.com" }], "no removed owner, no viewer");
  assert.deepEqual(await planEndedOwners(db, "a3"), [{ email: "owner3@example.com" }], "no mode set reads as nomada");
  assert.deepEqual(await planEndedOwners(db, "a2"), [], "agency");
  assert.deepEqual(await planEndedOwners(db, "a4"), [], "off");
  const { db: broken } = fakeDb(fixture(), { failReads: new Set(["accounts"]) });
  assert.deepEqual(await planEndedOwners(broken, "a1"), [], "the account read failed: nobody");
});

// ---- 13 Oct 2026, DIY P9 (spec 10 section 7.10): the Monday "This week" email ----

/** Monday 19 Oct 2026, 05:00 UTC: Monday in London (06:00) and in New York (01:00). */
const MONDAY = Date.parse("2026-10-19T05:00:00Z");

/**
 * The This week fixture. a1 is a nomada account, a2 an agency.
 *
 * - w1: UK, three items this week - mailed.
 * - w2: US, one item - mailed (still Monday in New York at 01:00).
 * - w3: on the agency account - never mailed until Danny answers the agency-mode question.
 * - w4: ended - nothing.
 * - w5: nothing pinned and no change held - an empty week is not mailed.
 *
 * Members of a1: an owner, an editor with no scope rows (every client), an editor limited to w2, a viewer, a removed
 * editor. Only the owner and the editors who can see the client are mailed.
 */
function weekFixture(on: boolean | "missing" = true): Tables {
  return {
    app_settings: on === "missing" ? [] : [{ key: "email_this_week_enabled", value: on }],
    accounts: [
      { id: "a1", upsell_mode: "nomada" },
      { id: "a2", upsell_mode: "agency" },
    ],
    client_domains: [client("w1", "a1", { market: "UK" }), client("w2", "a1"), client("w3", "a2", { market: "UK" }), client("w4", "a1", { status: "ended" }), client("w5", "a1", { market: "UK" })],
    dashboard_events: [],
    dashboard_members: [
      { id: "m-o", account_id: "a1", email: "owner@example.com", role: "owner", removed_at: null },
      { id: "m-e", account_id: "a1", email: "editor@example.com", role: "editor", removed_at: null },
      { id: "m-l", account_id: "a1", email: "limited@example.com", role: "editor", removed_at: null },
      { id: "m-v", account_id: "a1", email: "viewer@example.com", role: "viewer", removed_at: null },
      { id: "m-r", account_id: "a1", email: "removed@example.com", role: "editor", removed_at: at(MONDAY - 3 * DAY) },
      { id: "m-a", account_id: "a2", email: "agency@example.com", role: "owner", removed_at: null },
    ],
    dashboard_member_clients: [
      { member_id: "m-l", client_domain_id: "w2", removed_at: null },
      { member_id: "m-l", client_domain_id: "w1", removed_at: at(MONDAY - 10 * DAY) },
    ],
  };
}

/** A content source that records who it was asked about. */
function weekIo() {
  const r = recorder();
  const asked: string[] = [];
  const item = (title: string) => ({ severity: "tidy" as const, title, why: "A fact with its count (checked 17 Oct)." });
  r.io.thisWeek = async (c) => {
    asked.push(c.id);
    if (c.id === "w5") return { items: [], changes: { state: "ok", lines: [], more: 0 } };
    return { items: c.id === "w2" ? [item("One thing")] : [item("First"), item("Second"), item("Third")], changes: { state: "early" } };
  };
  return { ...r, asked };
}

const weekClaims = (t: Tables) => t.dashboard_events.map((e) => `${e.client_domain_id} ${e.event}`).sort();

test("This week: the flag off (or missing) sends nothing and reads nothing past the flags", async () => {
  for (const on of [false, "missing"] as const) {
    const t = weekFixture(on);
    const { db, reads } = fakeDb(t);
    const { io, outbox, asked } = weekIo();
    const out = await sweepLifecycleMail(db, io, MONDAY);
    assert.deepEqual(out, { sent: [], unsent: [], errors: [] });
    assert.equal(outbox.length, 0);
    assert.deepEqual(asked, [], "no content was read");
    assert.deepEqual([...new Set(reads)], ["app_settings"], "nothing read past the flags");
  }
});

test("This week on a Monday: owners and the editors who see the client, once a Monday, never agency, ended or an empty week", async () => {
  const t = weekFixture();
  const { db } = fakeDb(t);
  const { io, outbox, asked } = weekIo();

  const first = await sweepLifecycleMail(db, io, MONDAY);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.sent.sort(), ["this_week w1", "this_week w2"]);
  assert.deepEqual(weekClaims(t), ["w1 this_week_mail_2026-10-19", "w2 this_week_mail_2026-10-19"]);
  assert.deepEqual(asked.sort(), ["w1", "w2", "w5"], "never asked about the agency or the ended client");
  assert.deepEqual(
    outbox.map((m) => `${m.mail.subject} -> ${m.to}`).sort(),
    [
      "This week for w1.com: 3 actions -> editor@example.com",
      "This week for w1.com: 3 actions -> owner@example.com",
      "This week for w2.com: 1 action -> editor@example.com",
      "This week for w2.com: 1 action -> limited@example.com",
      "This week for w2.com: 1 action -> owner@example.com",
    ],
    "no viewer, no removed editor, and the editor limited to w2 gets only w2's",
  );
  const w1 = outbox.find((m) => m.mail.subject.startsWith("This week for w1.com"))!.mail;
  // "Open your actions" until 18 Oct 2026: the approved design's button is "Open this week".
  assert.ok(w1.text.includes(`Open this week: ${actionsUrl("w1-com", ORIGIN)}`), "the button opens the client's This week page on the origin the sweep was handed");
  assert.match(w1.text, /Week of 19 Oct 2026/);

  const again = await sweepLifecycleMail(db, io, MONDAY + 2 * HOUR);
  assert.deepEqual(again, { sent: [], unsent: [], errors: [] }, "a second run the same Monday mails nobody");
  const tuesday = await sweepLifecycleMail(db, io, MONDAY + DAY);
  assert.deepEqual(tuesday, { sent: [], unsent: [], errors: [] }, "not on a Tuesday");
  assert.equal(outbox.length, 5);

  const next = await sweepLifecycleMail(db, io, MONDAY + 7 * DAY);
  assert.deepEqual(next.sent.sort(), ["this_week w1", "this_week w2"], "next Monday is a new week");
  assert.ok(weekClaims(t).includes("w1 this_week_mail_2026-10-26"));
});

test("This week: a send that reached nobody releases its claim; a failed content read is that client's alone", async () => {
  const t = weekFixture();
  const { db } = fakeDb(t);
  const { io, state } = weekIo();
  state.fail = true;
  const out = await sweepLifecycleMail(db, io, MONDAY);
  assert.deepEqual(out.unsent.sort(), ["this_week w1", "this_week w2"]);
  assert.deepEqual(weekClaims(t), ["w1 unsent_this_week_mail_2026-10-19", "w2 unsent_this_week_mail_2026-10-19"]);

  const t2 = weekFixture();
  const { db: db2 } = fakeDb(t2);
  const w = weekIo();
  const inner = w.io.thisWeek!;
  w.io.thisWeek = async (c, today) => {
    if (c.id === "w1") throw new Error("the plan could not be read");
    return inner(c, today);
  };
  const out2 = await sweepLifecycleMail(db2, w.io, MONDAY);
  assert.deepEqual(out2.sent, ["this_week w2"]);
  assert.deepEqual(out2.errors, ["this_week w1: the plan could not be read"]);
});

test("This week with no content source is not built, whatever the flag says", async () => {
  const t = weekFixture();
  const { db } = fakeDb(t);
  const { io, outbox } = recorder();
  const out = await sweepLifecycleMail(db, io, MONDAY);
  assert.deepEqual(out, { sent: [], unsent: [], errors: [] });
  assert.equal(outbox.length, 0);
});

// ---- 18 Oct 2026, brief 2e: opt-outs, the per-recipient unsubscribe, and the week of readings ----

test("This week: a member who switched it off is not mailed; each recipient gets their own unsubscribe link and header", async () => {
  const t = weekFixture();
  (t.dashboard_members.find((m) => m.id === "m-e") as Row).this_week_opt_out = true;
  const { db } = fakeDb(t);
  const w = weekIo();
  w.io.unsubscribe = (email, clientId) => `https://dash.example/api/dash/unsubscribe?t=${clientId}.${email}`;
  const out = await sweepLifecycleMail(db, w.io, MONDAY);
  assert.deepEqual(out.sent.sort(), ["this_week w1", "this_week w2"]);
  assert.deepEqual(w.outbox.map((m) => m.to).sort(), ["limited@example.com", "owner@example.com", "owner@example.com"], "the editor who switched it off gets neither client's");
  for (const m of w.outbox) {
    const url = `https://dash.example/api/dash/unsubscribe?t=${m.mail.subject.includes("w1.com") ? "w1" : "w2"}.${m.to}`;
    assert.equal(m.mail.headers?.["List-Unsubscribe"], `<${url}>`, `${m.to}: their own link`);
    assert.equal(m.mail.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.ok(m.mail.text.includes(`Unsubscribe: ${url}`));
  }
});

test("This week with the dashboard's rows: figures in the subject, and not before a week of readings", async () => {
  const answers = (days: number) =>
    Array.from({ length: days }, (_, i) => ({ run_date: new Date(MONDAY - (i + 1) * DAY).toISOString().slice(0, 10), question_id: "p", engine: "chatgpt" as const, answered: true, named: i % 2 === 0 }));
  const merge = (days: number) => ({
    raw: {
      client: { id: "x", slug: "x", domain: "x.com", brand: null, market: "UK", tier: "tracked" as const, status: "active", started_on: null, cluster_limit: 10, trial_ends_at: null, payment_status: null, brand_aliases: [] },
      role: "owner",
      today: "2026-10-19",
      clusters: [],
      groups: [],
      keywords: [],
      prompts: [{ id: "p", text: "q", cluster_id: null, group_id: null, angle: null, added_on: "2026-10-01", stopped_on: null }],
      runs: [],
      serp: [],
      answers: answers(days),
      footprint: null,
      opportunities: [],
      placements: [],
      connections: [],
      consoleRows: [],
      groupsReady: true,
    },
    forms: new Map(),
    mode: "nomada" as const,
    agency: null,
    engines: ["ChatGPT"],
  });
  for (const [days, sends] of [
    [6, false],
    [14, true],
  ] as const) {
    const t = weekFixture();
    const { db } = fakeDb(t);
    const w = weekIo();
    w.io.client = async () => merge(days);
    const out = await sweepLifecycleMail(db, w.io, MONDAY);
    if (!sends) {
      assert.deepEqual(out, { sent: [], unsent: [], errors: [] }, "six readings: no Monday email yet");
      continue;
    }
    assert.deepEqual(out.sent.sort(), ["this_week w1", "this_week w2"]);
    assert.match(w.outbox[0]!.mail.subject, /^This week: named in \d+% of answers/);
  }
});
