import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { clearScope, readScopes, scopeTableMissing, scopesFrom, sees, visibleClients } from "./scope.ts";
import { invite, readTeam, removeMember, type TeamRow } from "./team.ts";

/**
 * Per-client member scoping (AG-1, audit security-2, launch blocker LB2;
 * 9 Oct 2026). The acceptance, at the level a test can hold it: on an account
 * with clients A and B, a viewer invited to A only sees A and not B; an
 * account-wide member sees both; Remove on A takes A only from someone who
 * also sees B, and takes the member when A was their last. And the writes
 * fail closed: a write that fails half-way never leaves anyone seeing more
 * than they were invited to.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const MISSING = { code: "PGRST205", message: "Could not find the table 'public.dashboard_member_clients' in the schema cache" };

/** Primary or unique keys the fake upserts on, as the migrations declare them. */
const KEYS: Record<string, string[]> = { dashboard_members: ["account_id", "email"], dashboard_member_clients: ["member_id", "client_domain_id"] };

/**
 * A Supabase stand-in for the calls team.ts and scope.ts make. `missing`
 * tables answer every call as PostgREST does before a migration; a `fail`
 * entry "table verb" refuses that write. `log` records each write as
 * "verb table", in order. `before` runs ahead of each write and holds it
 * until it settles, so a test can land another request's writes in between.
 */
function fakeDb(tables: Tables, opts: { missing?: Set<string>; fail?: Set<string>; before?: (write: string) => Promise<void> | void } = {}) {
  let n = 0;
  const log: string[] = [];
  const query = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const q = { op: "select" as "select" | "insert" | "update" | "upsert", cols: null as string | null, row: null as Row | null, one: false, count: false };
    const b = {
      select(cols: string, o?: { count?: string; head?: boolean }) {
        q.cols = cols;
        if (o?.head) q.count = true;
        return b;
      },
      insert: (row: Row) => ((q.op = "insert"), (q.row = row), b),
      update: (row: Row) => ((q.op = "update"), (q.row = row), b),
      upsert: (row: Row) => ((q.op = "upsert"), (q.row = row), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), b),
      gte: () => b,
      order: () => b,
      single: () => ((q.one = true), b),
      maybeSingle: () => ((q.one = true), b),
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        const hold = q.op === "select" ? undefined : opts.before?.(`${q.op} ${table}`);
        if (hold) hold.then(() => resolve(run()), reject);
        else resolve(run());
      },
    };
    const pick = (r: Row) => (q.cols ? Object.fromEntries(q.cols.split(",").map((c) => [c.trim(), r[c.trim()] ?? null])) : r);
    const run = () => {
      if (opts.missing?.has(table)) return { data: null, count: null, error: MISSING };
      if (q.op !== "select") {
        log.push(`${q.op} ${table}`);
        if (opts.fail?.has(`${table} ${q.op}`)) return { data: null, error: { message: `${table} ${q.op} refused by the test` } };
      }
      const rows = (tables[table] ??= []);
      if (q.op === "insert") {
        rows.push({ id: `e${++n}`, ...q.row });
        return { data: null, error: null };
      }
      if (q.op === "upsert") {
        const key = KEYS[table]!;
        let row = rows.find((r) => key.every((k) => r[k] === q.row![k]));
        if (row) Object.assign(row, q.row);
        else rows.push((row = { id: `m${++n}`, ...q.row }));
        return { data: q.one ? pick(row) : [pick(row)], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (q.op === "update") {
        for (const r of hit) Object.assign(r, q.row);
        return { data: hit.map(pick), error: null };
      }
      if (q.count) return { data: null, count: hit.length, error: null };
      return { data: q.one ? (hit[0] ? pick(hit[0]) : null) : hit.map(pick), error: null };
    };
    return b;
  };
  return { db: { from: query } as unknown as SupabaseClient, log, tables };
}

/** Account a1 with clients A and B; the owner sees both, as every member made before AG-1 does. */
function account(extra: { members?: Row[]; scopes?: Row[] } = {}): Tables {
  return {
    client_domains: [
      { id: "A", account_id: "a1", slug: "a" },
      { id: "B", account_id: "a1", slug: "b" },
      { id: "Z", account_id: "a2", slug: "z" },
    ],
    dashboard_members: [{ id: "own", account_id: "a1", email: "owner@agency.example", role: "owner", removed_at: null }, ...(extra.members ?? [])],
    dashboard_member_clients: extra.scopes ?? [],
    dashboard_events: [],
  };
}

/** What clientsFor would answer for this email off these tables: the client ids it sees. */
async function seenBy(db: SupabaseClient, t: Tables, email: string): Promise<string[]> {
  const mine = t.dashboard_members.filter((m) => m.email === email && m.removed_at == null).map((m) => ({ id: String(m.id), account_id: String(m.account_id), role: String(m.role) }));
  const scopes = await readScopes(db, mine.map((m) => m.id));
  return visibleClients(mine, scopes.of, t.client_domains as { id: string; account_id: string }[]).map((v) => v.client.id);
}

const live = (t: Tables, email: string) => t.dashboard_members.find((m) => m.email === email)!;
const scopeOf = (t: Tables, memberId: unknown) =>
  t.dashboard_member_clients
    .filter((r) => r.member_id === memberId && r.removed_at == null)
    .map((r) => r.client_domain_id)
    .sort();

test("sees: no scope is every client; a scope is exactly its clients", () => {
  assert.equal(sees(null, "A"), true);
  assert.equal(sees(undefined, "A"), true);
  assert.equal(sees(["A"], "A"), true);
  assert.equal(sees(["A"], "B"), false);
  assert.equal(sees([], "A"), false, "an empty list is no client - only a member with no rows at all sees every one");
});

test("a missing table is told from every other failure: only PGRST205 or 42P01 naming dashboard_member_clients", () => {
  assert.equal(scopeTableMissing(MISSING), true);
  assert.equal(scopeTableMissing({ code: "42P01", message: 'relation "public.dashboard_member_clients" does not exist' }), true);
  assert.equal(scopeTableMissing({ code: "42703", message: "column dashboard_member_clients.removed_at does not exist" }), false, "a missing column is not a missing table");
  assert.equal(scopeTableMissing({ code: "PGRST205", message: "Could not find the table 'public.other' in the schema cache" }), false);
  assert.equal(scopeTableMissing({ message: "fetch failed" }), false);
  assert.equal(scopeTableMissing(null), false);
});

test("visibleClients: a member limited to A sees A; an account-wide member sees both; nobody sees another account", () => {
  const clients = [
    { id: "A", account_id: "a1" },
    { id: "B", account_id: "a1" },
    { id: "Z", account_id: "a2" },
  ];
  const scopes = scopesFrom([{ member_id: "lead", client_domain_id: "A" }]);
  assert.deepEqual(visibleClients([{ id: "lead", account_id: "a1", role: "viewer" }], scopes, clients).map((v) => `${v.client.id}:${v.role}`), ["A:viewer"]);
  assert.deepEqual(visibleClients([{ id: "staff", account_id: "a1", role: "editor" }], scopes, clients).map((v) => v.client.id), ["A", "B"]);
  assert.deepEqual(visibleClients([], scopes, clients), []);
});

test("readScopes: a missing table is no rows and not ready; any other failure throws rather than widening", async () => {
  const t = account({ scopes: [{ member_id: "own", client_domain_id: "A", removed_at: null }] });
  assert.deepEqual(await readScopes(fakeDb(t).db, ["own"]), { of: new Map([["own", ["A"]]]), ready: true });
  assert.deepEqual(await readScopes(fakeDb(t, { missing: new Set(["dashboard_member_clients"]) }).db, ["own"]), { of: new Map(), ready: false });
  const broken = { from: () => ({ select: () => ({ in: () => ({ is: async () => ({ data: null, error: { code: "57014", message: "statement timeout" } }) }) }) }) } as unknown as SupabaseClient;
  await assert.rejects(readScopes(broken, ["own"]), /statement timeout/);
  assert.equal(await clearScope(fakeDb(t, { missing: new Set(["dashboard_member_clients"]) }).db, { memberId: "own", by: "x" }), null, "nothing to clear before the table exists");
});

test("readTeam: every live member of the account with their scope; before the migration, everyone account-wide and scoping off", async () => {
  const t = account({ members: [{ id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null }], scopes: [{ member_id: "lead", client_domain_id: "A", removed_at: null }] });
  const team = await readTeam(fakeDb(t).db, "a1");
  assert.ok(typeof team !== "string");
  assert.equal(team.scoping, true);
  assert.deepEqual(team.rows.map((r) => `${r.email}:${r.clients?.join("+") ?? "every"}`), ["owner@agency.example:every", "lead@client.example:A"]);
  const before = await readTeam(fakeDb(t, { missing: new Set(["dashboard_member_clients"]) }).db, "a1");
  assert.ok(typeof before !== "string");
  assert.equal(before.scoping, false);
  assert.ok(before.rows.every((r) => r.clients === null));
});

const inviteTo = (db: SupabaseClient, over: Partial<Parameters<typeof invite>[1]> = {}) =>
  invite(db, { accountId: "a1", clientId: "A", email: "lead@client.example", role: "viewer", by: "owner@agency.example", scope: "client", elsewhere: null, first: "Ana", last: null, ...over });
const rm = (db: SupabaseClient, row: TeamRow) => removeMember(db, { accountId: "a1", email: row.email, by: "owner@agency.example", clientId: "A", row });

test("an invite to A only: the viewer sees A and not B; the member row goes live last", async () => {
  const t = account();
  const { db, log } = fakeDb(t);
  assert.deepEqual(await inviteTo(db), { ok: true });
  assert.deepEqual(log, ["upsert dashboard_members", "update dashboard_member_clients", "upsert dashboard_member_clients", "upsert dashboard_members", "insert dashboard_events"]);
  assert.equal(live(t, "lead@client.example").removed_at, null);
  assert.deepEqual(await seenBy(db, t, "lead@client.example"), ["A"], "/app/b is a 404 for them, and the switcher lists A only");
  assert.deepEqual(await seenBy(db, t, "owner@agency.example"), ["A", "B"], "the account-wide owner still sees both");
});

test("an invite to every client: no scope row, both clients", async () => {
  const t = account();
  const { db } = fakeDb(t);
  assert.deepEqual(await inviteTo(db, { scope: "account", email: "staff@agency.example", role: "editor" }), { ok: true });
  assert.deepEqual(scopeOf(t, live(t, "staff@agency.example").id), []);
  assert.deepEqual(await seenBy(db, t, "staff@agency.example"), ["A", "B"]);
});

test("fail closed: a scope write that fails leaves the invitee not live, so they see nothing", async () => {
  for (const fail of ["dashboard_member_clients upsert", "dashboard_member_clients update"]) {
    const t = account();
    const { db } = fakeDb(t, { fail: new Set([fail]) });
    const r = await inviteTo(db);
    assert.equal(r.ok, false, fail);
    assert.notEqual(live(t, "lead@client.example").removed_at, null, `${fail}: the row is written but not live`);
    assert.deepEqual(await seenBy(db, t, "lead@client.example"), [], `${fail}: they see no client`);
  }
  // Before the migration: an invite to one client cannot be written, and nobody goes live seeing everything.
  const t = account();
  const { db } = fakeDb(t, { missing: new Set(["dashboard_member_clients"]) });
  assert.equal((await inviteTo(db)).ok, false);
  assert.notEqual(live(t, "lead@client.example").removed_at, null);
  // An invite to every client works without the table, as every invite did before AG-1.
  assert.deepEqual(await inviteTo(db, { scope: "account", email: "staff@agency.example" }), { ok: true });
  assert.equal(live(t, "staff@agency.example").removed_at, null);
});

test("a removed member who was limited to B, invited back to A only, sees A only - the old scope does not come back", async () => {
  const t = account({
    members: [{ id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: "2026-10-01T00:00:00Z" }],
    scopes: [{ member_id: "lead", client_domain_id: "B", removed_at: null }],
  });
  const { db } = fakeDb(t);
  assert.deepEqual(await inviteTo(db), { ok: true });
  assert.deepEqual(scopeOf(t, "lead"), ["A"]);
  assert.deepEqual(await seenBy(db, t, "lead@client.example"), ["A"]);
});

test("someone on the account for B only, invited on A: A joins their list, or for every client the list goes", async () => {
  const lead: Row = { id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null };
  const elsewhere: TeamRow = { id: "lead", email: "lead@client.example", role: "viewer", removed_at: null, clients: ["B"] };
  const t = account({ members: [lead], scopes: [{ member_id: "lead", client_domain_id: "B", removed_at: null }] });
  const { db, log } = fakeDb(t);
  assert.deepEqual(await inviteTo(db, { elsewhere }), { ok: true });
  assert.deepEqual(scopeOf(t, "lead"), ["A", "B"]);
  // AG-1 review (9 Oct 2026): the row is never revived here - the role is set only while it is live.
  assert.deepEqual(log, ["upsert dashboard_member_clients", "update dashboard_members", "insert dashboard_events"]);
  const u = account({ members: [{ ...lead }], scopes: [{ member_id: "lead", client_domain_id: "B", removed_at: null }] });
  const fu = fakeDb(u);
  assert.deepEqual(await inviteTo(fu.db, { elsewhere, scope: "account" }), { ok: true });
  assert.deepEqual(await seenBy(fu.db, u, "lead@client.example"), ["A", "B"]);
});

/**
 * AG-1 review (9 Oct 2026). lead@ is limited to A. At the same moment the
 * owner on B invites them - B's team read found them on the account for A
 * only, so the invite keeps their row - and the owner on A removes them, A
 * being their last client. The review's interleaving: the invite's revive
 * landed after the Remove's member write, and the Remove's scope clear after
 * that, so lead@ was live with no client - every client on the account.
 * Here the Remove lands before each of the invite's writes in turn, and after
 * the last. The Remove now writes once, the member row, so that is every
 * order the two can run in.
 */
test("a Remove of their last client landing anywhere inside an invite on another client never leaves them seeing every client, or the one removed", async () => {
  const leadRow = { id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null };
  const onA: TeamRow = { id: "lead", email: "lead@client.example", role: "viewer", removed_at: null, clients: ["A"] };
  const outcomes = new Set<string>();
  for (let at = 0; ; at++) {
    const t = account({ members: [{ ...leadRow }], scopes: [{ member_id: "lead", client_domain_id: "A", removed_at: null }] });
    const plain = fakeDb(t);
    let n = 0;
    let landed = false;
    const gated = fakeDb(t, {
      before: async () => {
        if (n++ !== at) return;
        landed = true;
        assert.deepEqual(await rm(plain.db, onA), { ok: true });
      },
    });
    assert.deepEqual(await inviteTo(gated.db, { clientId: "B", elsewhere: onA }), { ok: true }, `Remove before write ${at}`);
    if (!landed) assert.deepEqual(await rm(plain.db, onA), { ok: true }, "and after every write");
    const seen = await seenBy(plain.db, t, "lead@client.example");
    const gone = live(t, "lead@client.example").removed_at !== null;
    assert.deepEqual(seen, gone ? [] : ["B"], `Remove before write ${at}: removed ${gone}, sees ${seen.join(", ") || "nothing"}`);
    outcomes.add(gone ? "removed" : "B only");
    if (!landed) break;
  }
  assert.deepEqual([...outcomes].sort(), ["B only", "removed"], "both orders were reached: the later write wins, and neither widens");
});

test("removed from A, then invited back to A by an owner who read the team after: A only", async () => {
  const t = account({ members: [{ id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null }], scopes: [{ member_id: "lead", client_domain_id: "A", removed_at: null }] });
  const { db } = fakeDb(t);
  assert.deepEqual(await rm(db, { id: "lead", email: "lead@client.example", role: "viewer", removed_at: null, clients: ["A"] }), { ok: true });
  assert.deepEqual(await inviteTo(db), { ok: true });
  assert.deepEqual(await seenBy(db, t, "lead@client.example"), ["A"]);
});

test("Remove on A: off A only for someone who also sees B; off the account when A was their last, or when they saw every client", async () => {
  const both: TeamRow = { id: "lead", email: "lead@client.example", role: "viewer", removed_at: null, clients: ["A", "B"] };
  const t = account({
    members: [{ id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null }],
    scopes: [
      { member_id: "lead", client_domain_id: "A", removed_at: null },
      { member_id: "lead", client_domain_id: "B", removed_at: null },
    ],
  });
  const { db } = fakeDb(t);
  assert.deepEqual(await rm(db, both), { ok: true });
  assert.equal(live(t, "lead@client.example").removed_at, null, "still on the account");
  assert.deepEqual(await seenBy(db, t, "lead@client.example"), ["B"]);

  const only = account({ members: [{ id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null }], scopes: [{ member_id: "lead", client_domain_id: "A", removed_at: null }] });
  const fo = fakeDb(only);
  assert.deepEqual(await rm(fo.db, { ...both, clients: ["A"] }), { ok: true });
  // AG-1 review (9 Oct 2026): their scope is left - a clear here raced an invite on another client. The next invite clears it before they are live.
  assert.deepEqual(fo.log, ["update dashboard_members"], "the member goes, and only the member row is written");
  assert.notEqual(live(only, "lead@client.example").removed_at, null);
  assert.deepEqual(scopeOf(only, "lead"), ["A"]);
  assert.deepEqual(await seenBy(fo.db, only, "lead@client.example"), []);

  const wide = account({ members: [{ id: "staff", account_id: "a1", email: "staff@agency.example", role: "editor", removed_at: null }] });
  const fw = fakeDb(wide);
  assert.deepEqual(await rm(fw.db, { id: "staff", email: "staff@agency.example", role: "editor", removed_at: null, clients: null }), { ok: true });
  assert.deepEqual(await seenBy(fw.db, wide, "staff@agency.example"), []);
});

test("two Removes at once, on A and on B, never leave a member with no client - which would read as every client", async () => {
  // The B Remove landed between this one's team read and its write: the page still thinks they see A and B.
  const t = account({
    members: [{ id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null }],
    scopes: [
      { member_id: "lead", client_domain_id: "A", removed_at: null },
      { member_id: "lead", client_domain_id: "B", removed_at: "2026-10-09T08:59:59Z" },
    ],
  });
  const { db } = fakeDb(t);
  assert.deepEqual(await rm(db, { id: "lead", email: "lead@client.example", role: "viewer", removed_at: null, clients: ["A", "B"] }), { ok: true });
  assert.notEqual(live(t, "lead@client.example").removed_at, null, "with no client left, the member goes");
  assert.deepEqual(await seenBy(db, t, "lead@client.example"), []);
});

test("a write that fails on Remove says so and leaves the member seeing no more than before", async () => {
  const t = account({ members: [{ id: "lead", account_id: "a1", email: "lead@client.example", role: "viewer", removed_at: null }], scopes: [{ member_id: "lead", client_domain_id: "A", removed_at: null }] });
  const { db } = fakeDb(t, { fail: new Set(["dashboard_members update"]) });
  const r = await rm(db, { id: "lead", email: "lead@client.example", role: "viewer", removed_at: null, clients: ["A"] });
  assert.equal(r.ok, false);
  assert.deepEqual(await seenBy(db, t, "lead@client.example"), ["A"], "the scope is untouched, so they do not widen to B");
});
