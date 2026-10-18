import assert from "node:assert/strict";
import { test } from "node:test";

import { retentionPass } from "./retention-purge.ts";

/**
 * The retention pass against a recording fake (18 Oct 2026). Every write is a destructive one, so the rules that
 * matter are tested: nothing is deleted while the switch is off, the log row comes first, the account goes only with
 * its last client, and a member of another account keeps their sign-in.
 */
type Call = { table: string; op: string; filters: string[] };

function fakeDb(state: { settings: Record<string, unknown>; ended: Record<string, unknown>[]; otherClients: number; members: string[]; elsewhere: string[] }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const c: Call = { table, op: "select", filters: [] };
    const q: Record<string, unknown> = {};
    const chain = (name: string) => (...a: unknown[]) => { c.filters.push(`${name}(${a.map((x) => JSON.stringify(x)).join(",")})`); return q; };
    for (const f of ["eq", "neq", "in", "not", "lt", "order", "limit", "is"]) q[f] = chain(f);
    q.select = (_cols?: string, opts?: { count?: string }) => { if (c.op === "select") c.op = opts?.count ? "count" : "select"; return q; };
    q.insert = (row: unknown) => { c.op = "insert"; c.filters.push(JSON.stringify(row)); return q; };
    q.delete = () => { c.op = "delete"; return q; };
    q.then = (res: (v: unknown) => unknown) => {
      calls.push(c);
      let out: unknown = { data: [], error: null };
      if (table === "app_settings") out = { data: Object.entries(state.settings).map(([key, value]) => ({ key, value })), error: null };
      else if (table === "client_domains" && c.op === "select") out = { data: state.ended, error: null };
      else if (table === "client_domains" && c.op === "count") out = { count: state.otherClients, error: null };
      else if (table === "client_domains" && c.op === "delete") out = { data: [{ id: "c1" }], error: null };
      else if (table === "dashboard_members" && c.filters.some((f) => f.startsWith("neq"))) out = { data: state.elsewhere.map((email) => ({ email })), error: null };
      else if (table === "dashboard_members") out = { data: state.members.map((email) => ({ email })), error: null };
      return Promise.resolve(out).then(res);
    };
    return q;
  };
  return { db: { from } as unknown as Parameters<typeof retentionPass>[0], calls };
}

const NOW = Date.parse("2027-02-01T00:00:00Z");
const dueClient = { id: "c1", slug: "tallyroo-com", domain: "tallyroo.com", account_id: "a1", status: "ended", ended_at: "2026-10-01T00:00:00Z" };
const deletes = (calls: Call[]) => calls.filter((c) => c.op === "delete").map((c) => c.table);

test("switch off (or unreadable, or anything but true): a dry run that reports who is due and deletes nothing", async () => {
  for (const enabled of [false, "true", undefined]) {
    const { db, calls } = fakeDb({ settings: enabled === undefined ? {} : { retention_purge_enabled: enabled }, ended: [dueClient], otherClients: 0, members: ["owner@tallyroo.com"], elsewhere: [] });
    const r = await retentionPass(db, NOW);
    assert.equal(r.enabled, false);
    assert.deepEqual(r.due.map((d) => d.slug), ["tallyroo-com"]);
    assert.deepEqual(r.purged, []);
    assert.deepEqual(deletes(calls), [], `nothing deleted with the switch at ${String(enabled)}`);
    assert.equal(calls.filter((c) => c.op === "insert").length, 0);
  }
});

test("switch on: the log row first, then the client's scope, DIY reads and row; the account only with its last client", async () => {
  const { db, calls } = fakeDb({ settings: { retention_purge_enabled: true }, ended: [dueClient], otherClients: 0, members: ["owner@tallyroo.com", "shared@ledgerline.com"], elsewhere: ["shared@ledgerline.com"] });
  const r = await retentionPass(db, NOW);
  assert.deepEqual(r.purged, ["tallyroo-com"]);
  const writes = calls.filter((c) => c.op === "insert" || c.op === "delete").map((c) => `${c.op} ${c.table}`);
  assert.deepEqual(writes, ["insert retention_purges", "delete dashboard_member_clients", "delete diy_reads", "delete client_domains", "delete dashboard_sessions", "delete dashboard_login_tokens", "delete accounts"]);
  const sess = calls.find((c) => c.table === "dashboard_sessions")!;
  assert.ok(sess.filters.some((f) => f.includes("owner@tallyroo.com")) && !sess.filters.some((f) => f.includes("shared@ledgerline.com")), "a member of another account keeps their sign-in");
  assert.ok(calls.find((c) => c.table === "client_domains" && c.op === "delete")!.filters.includes('eq("status","ended")'), "the delete re-checks the client is still ended");
});

test("switch on, the account has other clients: only the client goes", async () => {
  const { db, calls } = fakeDb({ settings: { retention_purge_enabled: true }, ended: [dueClient], otherClients: 2, members: ["owner@tallyroo.com"], elsewhere: [] });
  await retentionPass(db, NOW);
  assert.deepEqual(deletes(calls), ["dashboard_member_clients", "diy_reads", "client_domains"]);
});

test("a retention_days row below the policy is ignored: never purged early", async () => {
  const { db } = fakeDb({ settings: { retention_purge_enabled: false, retention_days: 7 }, ended: [], otherClients: 0, members: [], elsewhere: [] });
  assert.equal((await retentionPass(db, NOW)).days, 90);
});
