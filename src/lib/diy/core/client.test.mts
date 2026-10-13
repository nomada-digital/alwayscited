import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type Row, fakeDb } from "../../tracking/fake-db.mts";
import { expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";

import { type ClientRow, type DiyClient, DIY_CLIENT_COLUMNS, confirmedAt, diyClient, fixtureDiyClient, loadDiyClient, loadDiyClients, modeOf } from "./client.ts";

/**
 * DiyClient and its loaders (13 Oct 2026, DIY P1 milestone M1). Every
 * client is the same named fields however it is read, a failed read throws
 * rather than reading as "not set up" or "nomada", the mode comes through
 * the client row's join so no account id is read, and the fleet read is
 * paged past PostgREST's thousand rows.
 */

const NOW = Date.parse("2026-10-12T12:00:00Z");

const KEYS: (keyof DiyClient)[] = ["id", "slug", "domain", "brand", "market", "zone", "tier", "placed", "trial", "status", "startedOn", "setupConfirmedAt", "upsellMode"];

const row = (over: Partial<ClientRow> = {}): ClientRow => ({
  id: "c-1",
  slug: "tallyroo",
  domain: "tallyroo.com",
  brand_name: "Tallyroo",
  market: "US",
  tier: "tracked",
  started_on: "2026-06-10",
  status: "active",
  trial_ends_at: null,
  accounts: { upsell_mode: "nomada" },
  ...over,
});

test("a row and its facts make a DiyClient of named fields only", () => {
  const c = diyClient(row(), { setupConfirmedAt: "2026-06-09T12:00:00Z", upsellMode: "agency" }, NOW);
  assert.deepEqual(Object.keys(c).sort(), [...KEYS].sort(), "named fields only; the account join goes no further");
  assert.deepEqual(c, {
    id: "c-1",
    slug: "tallyroo",
    domain: "tallyroo.com",
    brand: "Tallyroo",
    market: "US",
    zone: "America/New_York",
    tier: "tracked",
    placed: false,
    trial: false,
    status: "active",
    startedOn: "2026-06-10",
    setupConfirmedAt: "2026-06-09T12:00:00Z",
    upsellMode: "agency",
  });
});

test("brand falls back to the domain, UK reads London's zone, placed tiers are placed", () => {
  const c = diyClient(row({ brand_name: null, market: "UK", tier: "mentioned" }), { setupConfirmedAt: null, upsellMode: undefined }, NOW);
  assert.equal(c.brand, "tallyroo.com");
  assert.equal(c.zone, "Europe/London");
  assert.equal(c.placed, true);
  assert.equal(c.upsellMode, "nomada", "an unknown or missing mode reads as ask.ts reads it");
  for (const tier of ["cited", "everywhere"]) assert.equal(diyClient(row({ tier }), { setupConfirmedAt: null, upsellMode: "off" }, NOW).placed, true);
});

test("the trial is a trial only while its end is ahead", () => {
  const at = (trial_ends_at: string | null) => diyClient(row({ trial_ends_at }), { setupConfirmedAt: null, upsellMode: "nomada" }, NOW).trial;
  assert.equal(at("2026-10-20T10:00:00Z"), true);
  assert.equal(at("2026-10-12T11:59:00Z"), false, "ended a minute ago");
  assert.equal(at(null), false);
  assert.equal(at("not a date"), false);
});

test("a status client_domains does not allow throws; null is active, as clientsFor reads it", () => {
  assert.equal(diyClient(row({ status: null }), { setupConfirmedAt: null, upsellMode: null }, NOW).status, "active");
  assert.equal(diyClient(row({ status: "ended" }), { setupConfirmedAt: null, upsellMode: null }, NOW).status, "ended");
  assert.throws(() => diyClient(row({ status: "deleted" }), { setupConfirmedAt: null, upsellMode: null }, NOW), /not one client_domains allows/);
});

test("setup counts from its first confirm", () => {
  const m = confirmedAt([
    { client_domain_id: "c-1", created_at: "2026-07-02T09:00:00Z" },
    { client_domain_id: "c-1", created_at: "2026-06-09T12:00:00Z" },
    { client_domain_id: null, created_at: "2026-06-01T00:00:00Z" },
  ]);
  assert.deepEqual([...m], [["c-1", "2026-06-09T12:00:00Z"]]);
});

function world(n = 3): Record<string, Row[]> {
  const clients: Row[] = Array.from({ length: n }, (_, i) => ({ ...row({ id: `c-${String(i).padStart(4, "0")}`, slug: `client-${i}`, accounts: { upsell_mode: i % 2 ? "agency" : "nomada" } }) }));
  return {
    client_domains: [
      ...clients,
      { ...row({ id: "c-ended", slug: "ended", status: "ended" }) },
      { ...row({ id: "c-paused", slug: "paused", status: "paused" }) },
      { ...row({ id: "c-noslug", slug: null }) },
    ],
    dashboard_events: [
      { client_domain_id: "c-0000", event: "setup_confirmed", created_at: "2026-06-09T12:00:00Z" },
      { client_domain_id: "c-0000", event: "view", created_at: "2026-06-01T12:00:00Z" },
      { client_domain_id: "c-0001", event: "setup_confirmed", created_at: "2026-07-01T08:00:00Z" },
      { client_domain_id: "c-0001", event: "setup_confirmed", created_at: "2026-06-20T08:00:00Z" },
    ],
  };
}

/**
 * fake-db.mts answers columns, not embeds. PostgREST answers
 * `accounts(upsell_mode)` under the key `accounts`, so the select is read
 * as that key, and the rows hold the join as PostgREST would return it.
 */
function joined(tables: Record<string, Row[]>, opts: { maxRows?: number } = {}) {
  const fake = fakeDb(tables, opts);
  const from = (t: string) => {
    const b = fake.db.from(t) as unknown as { select: (cols?: string) => unknown };
    const select = b.select.bind(b);
    b.select = (cols?: string) => select(cols?.replace("accounts(upsell_mode)", "accounts"));
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, calls: fake.calls };
}

test("the select joins the mode through the client row and reads no account id", () => {
  assert.match(DIY_CLIENT_COLUMNS, /accounts\(upsell_mode\)$/);
  assert.doesNotMatch(DIY_CLIENT_COLUMNS, /account_id/);
});

test("the fleet read: active clients with a slug, each with its account's mode and its first confirm", async () => {
  const { db } = joined(world());
  const out = await loadDiyClients(db, NOW);
  assert.deepEqual(out.map((c) => [c.id, c.upsellMode, c.setupConfirmedAt]), [
    ["c-0000", "nomada", "2026-06-09T12:00:00Z"],
    ["c-0001", "agency", "2026-06-20T08:00:00Z"],
    // 13 Oct 2026, lead: a client with no confirm that has started counts as set up from its start
    // (startedAsSetUp) - c-0002 started 10 Jun, so its paid jobs are no longer left waiting forever.
    ["c-0002", "nomada", "2026-06-10T00:00:00Z"],
  ]);
  assert.ok(out.every((c) => Object.keys(c).length === KEYS.length));
});

test("the fleet read is paged: 1,205 clients on a server that answers 1,000 rows a select are all read", async () => {
  const { db, calls } = joined(world(1205), { maxRows: 1000 });
  const out = await loadDiyClients(db, NOW);
  assert.equal(out.length, 1205);
  assert.ok(calls.filter((c) => c.table === "client_domains").every((c) => c.range !== null), "every select of the clients is ranged");
});

test("one client, whatever its status; null when there is none", async () => {
  const { db } = joined(world());
  const one = await loadDiyClient(db, "c-0001", NOW);
  assert.deepEqual([one?.upsellMode, one?.setupConfirmedAt, one?.status], ["agency", "2026-06-20T08:00:00Z", "active"]);
  assert.equal((await loadDiyClient(db, "c-ended", NOW))?.status, "ended");
  assert.equal((await loadDiyClient(db, "c-none", NOW)), null);
});

/** A database whose reads of one table fail, as postgrest-js reports a failure: no throw, an error. */
function failing(table: string, tables: Record<string, Row[]>): SupabaseClient {
  const { db } = joined(tables);
  const broken: Record<string, unknown> = {};
  const chain = new Proxy(broken, {
    get(_t, key) {
      if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { message: `${table} is unreadable` } }));
      return () => chain;
    },
  });
  return { from: (t: string) => (t === table ? chain : db.from(t)) } as unknown as SupabaseClient;
}

test("a failed read throws: a client is never read as unconfirmed or as nomada because a read failed", async () => {
  for (const table of ["client_domains", "dashboard_events"]) {
    await assert.rejects(loadDiyClients(failing(table, world()), NOW), new RegExp(`${table} is unreadable`), `the fleet read, ${table}`);
    await assert.rejects(loadDiyClient(failing(table, world()), "c-0001", NOW), new RegExp(`${table} is unreadable`), `one client, ${table}`);
  }
});

test("a client row with no account in its join throws, since account_id is not null", async () => {
  assert.throws(() => modeOf({ id: "c-1", accounts: null }), /came back with no account/);
  assert.equal(modeOf({ id: "c-1", accounts: [{ upsell_mode: "off" }] }), "off", "the array shape reads too");
  const t = world(1);
  t.client_domains![0]!.accounts = null;
  await assert.rejects(loadDiyClients(joined(t).db, NOW), /no account/);
});

const raw = JSON.parse(readFileSync(new URL("../../tracking/fixture.json", import.meta.url), "utf8"));

test("the tracking fixture's client, in its states", () => {
  const plain = fixtureState(expandFixture(raw), {});
  const c = fixtureDiyClient(plain.client, { setupConfirmed: true }, NOW);
  assert.deepEqual([c.id, c.brand, c.tier, c.placed, c.trial, c.status, c.startedOn, c.setupConfirmedAt, c.upsellMode], ["fixture", "Tallyroo", "tracked", false, false, "active", "2026-06-10", "2026-06-09T12:00:00Z", "nomada"]);
  assert.equal(fixtureDiyClient(plain.client, { setupConfirmed: false }, NOW).setupConfirmedAt, null);
  assert.equal(fixtureDiyClient(plain.client, { setupConfirmed: true, upsellMode: "agency" }, NOW).upsellMode, "agency");
  const trial = fixtureState(expandFixture(raw), { TRACKING_FIXTURE_STATE: "trial" });
  assert.equal(fixtureDiyClient(trial.client, { setupConfirmed: true }, Date.now()).trial, true, "the trial state's end is real time, nine days on");
  const ended = fixtureState(expandFixture(raw), { TRACKING_FIXTURE_STATE: "ended" });
  assert.equal(fixtureDiyClient(ended.client, { setupConfirmed: true }, NOW).status, "ended");
});

test("a client being tracked counts as set up from its start; a confirm still wins; a future start waits (13 Oct 2026)", async () => {
  const { startedAsSetUp } = await import("./client.ts");
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.equal(startedAsSetUp("2026-09-30", now), "2026-09-30T00:00:00Z", "set up by hand before the setup page");
  assert.equal(startedAsSetUp("2026-10-05", now), "2026-10-05T00:00:00Z", "set up by Nomada after it");
  assert.equal(startedAsSetUp("2026-10-14", now), null, "a trial whose first check is tomorrow waits");
  assert.equal(startedAsSetUp(null, now), null);
});
