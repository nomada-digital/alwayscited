import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fakeDb } from "../../tracking/fake-db.mts";
import { loadPlanItems } from "./data.ts";
import { planRefresh } from "./refresh.ts";
import type { Candidate } from "./types.ts";
import { applyRefresh, itemsByRef, markVerified, patchRow, taskRow, updatePlanItem, upsertPlanItemFor } from "./write.ts";

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  dedupeKey: "schema:org:kp1",
  kind: "add_schema",
  severity: "tidy",
  clusterId: null,
  title: "Add Organization schema to your homepage",
  why: [{ text: "No Organization on tallyroo.com, read on 12 Oct." }],
  grade: "practice",
  effort: "minutes",
  href: "/clusters",
  ref: { table: "key_pages", id: "kp1" },
  ...o,
});

test("upsertPlanItemFor is idempotent on (client, dedupe key): a second call updates the one row", async () => {
  const { db, tables } = fakeDb({ plan_items: [] });
  const first = await upsertPlanItemFor(db, "me", cand(), { today: "2026-10-12" });
  assert.equal(first?.created, true);
  const second = await upsertPlanItemFor(db, "me", cand({ title: "Add Organization schema to the homepage" }), { today: "2026-10-13", weekOf: "2026-10-12" });
  assert.deepEqual(second, { id: first!.id, created: false });
  assert.equal(tables.plan_items!.length, 1);
  const row = tables.plan_items![0]!;
  assert.equal(row.title, "Add Organization schema to the homepage", "a suggestion follows its candidate");
  assert.equal(row.week_of, "2026-10-12");
  assert.equal(row.seen_on, "2026-10-13");
  assert.equal(row.status, "suggested");
  assert.equal(row.ref_table, "key_pages");
  // Another client's item with the same key is another item.
  await upsertPlanItemFor(db, "other", cand(), { today: "2026-10-13" });
  assert.equal(tables.plan_items!.length, 2);
});

test("an item the client moved keeps its words when its candidate comes again", async () => {
  const { db, tables } = fakeDb({ plan_items: [{ id: 9, client_domain_id: "me", dedupe_key: "schema:org:kp1", status: "doing", title: "Mine now" }] });
  assert.deepEqual(await upsertPlanItemFor(db, "me", cand({ title: "New words" }), { today: "2026-10-13" }), { id: "9", created: false });
  assert.equal(tables.plan_items![0]!.title, "Mine now");
  assert.equal(tables.plan_items![0]!.status, "doing");
});

test("a candidate that may not be stored writes nothing", async () => {
  const { db, calls } = fakeDb({ plan_items: [] });
  assert.equal(await upsertPlanItemFor(db, "me", cand({ why: [] }), { today: "2026-10-13" }), null);
  assert.deepEqual(calls, []);
});

test("a duplicate key on insert is read as another writer getting there first", async () => {
  // A stub of the three calls the race takes: the read finds nothing, the insert is refused as a duplicate, the read again finds it.
  let reads = 0;
  const writes: Record<string, unknown>[] = [];
  type Chain = Record<string, unknown> & { select(): Chain };
  const chain = (result: () => unknown): Chain => {
    const b = {} as Chain;
    for (const k of ["select", "eq", "insert", "update", "maybeSingle", "single"]) b[k] = (...a: unknown[]) => (k === "update" && writes.push(a[0] as Record<string, unknown>), b);
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(res(result()));
    return b;
  };
  const db = {
    from: () => ({
      select: () => chain(() => ({ data: reads++ === 0 ? null : { id: "x1", status: "suggested" }, error: null })).select(),
      insert: () => chain(() => ({ data: null, error: { code: "23505", message: "duplicate key value" } })),
      update: (p: Record<string, unknown>) => (writes.push(p), chain(() => ({ data: null, error: null }))),
    }),
  } as unknown as SupabaseClient;
  assert.deepEqual(await upsertPlanItemFor(db, "me", cand(), { today: "2026-10-13" }), { id: "x1", created: false });
  assert.equal(writes.length, 1);
});

test("an update is held to this client's row and to the status it was read with", async () => {
  const { db, tables } = fakeDb({ plan_items: [{ id: "a", client_domain_id: "me", status: "suggested" }, { id: "b", client_domain_id: "other", status: "suggested" }] });
  assert.equal(await updatePlanItem(db, "me", "b", { status: "doing" }, "suggested"), false, "another client's item");
  assert.equal(await updatePlanItem(db, "me", "a", { status: "doing" }, "todo"), false, "moved by someone else meanwhile");
  assert.equal(await updatePlanItem(db, "me", "a", { status: "doing" }, "suggested"), true);
  assert.equal(tables.plan_items![0]!.status, "doing");
  assert.equal(tables.plan_items![1]!.status, "suggested");
});

test("markVerified writes the verification on a done item only, and needs its words and its day", async () => {
  const { db, tables } = fakeDb({ plan_items: [{ id: "a", status: "done" }, { id: "b", status: "doing" }] });
  const v = { by: "key_pages_weekly", at: "2026-11-14", text: "Verified: Organization found with name, url, logo, 14 Nov" };
  assert.equal(await markVerified(db, "a", v), true);
  assert.deepEqual(tables.plan_items![0]!.verified, v);
  assert.equal(await markVerified(db, "b", v), false, "not done: nothing verified");
  assert.equal(tables.plan_items![1]!.verified, undefined);
  await assert.rejects(markVerified(db, "a", { ...v, text: " " }), /needs its text/);
  await assert.rejects(markVerified(db, "a", { ...v, at: "14 Nov" }), /needs its text/);
});

test("the verifying jobs find items by what they refer to, on this client", async () => {
  const { db } = fakeDb({
    plan_items: [
      { id: "a", client_domain_id: "me", ref_table: "key_pages", ref_id: "kp1", kind: "add_schema", severity: "tidy", status: "done", title: "t", dedupe_key: "k1" },
      { id: "b", client_domain_id: "other", ref_table: "key_pages", ref_id: "kp1", kind: "add_schema", severity: "tidy", status: "done", title: "t", dedupe_key: "k1" },
    ],
  });
  assert.deepEqual((await itemsByRef(db, "me", "key_pages", "kp1")).map((i) => i.id), ["a"]);
});

test("a task row: own task, Your task, To do, its own dedupe key", () => {
  const r = taskRow("me", { title: "Ask for reviews", clusterId: "c1", by: "owner@example.com", now: "2026-10-13T10:00:00.000Z", key: "u1" });
  assert.deepEqual(
    { kind: r.kind, severity: r.severity, status: r.status, dedupe_key: r.dedupe_key, created_by: r.created_by, why: r.why },
    { kind: "own_task", severity: "own", status: "todo", dedupe_key: "task:u1", created_by: "owner@example.com", why: [] },
  );
});

test("the fixture twin applies a patch only while the row has the status it was read with", () => {
  assert.deepEqual(patchRow({ id: "a", status: "todo" }, { status: "doing" }, "todo"), { id: "a", status: "doing" });
  assert.equal(patchRow({ id: "a", status: "done" }, { status: "doing" }, "todo"), null);
});

test("the nightly writes: applied once, run again they insert nothing new", async () => {
  const { db, tables } = fakeDb({ plan_items: [] });
  const c = [cand(), cand({ dedupeKey: "kw-left-p1:k1", kind: "recover_keyword", severity: "slipping", clusterId: "c1" })];
  const plan = planRefresh({ clientId: "me", candidates: c, complete: true, items: [], today: "2026-10-12", now: "2026-10-12T03:31:00Z" });
  assert.deepEqual(await applyRefresh(db, "me", plan), { inserted: 2, updated: 0 });
  assert.equal(tables.plan_items!.length, 2);
  assert.ok(tables.plan_items!.every((r) => r.week_of === "2026-10-12"));
  const again = planRefresh({ clientId: "me", candidates: c, complete: true, items: await loadPlanItems(db, "me"), today: "2026-10-12", now: "2026-10-12T03:46:00Z" });
  assert.deepEqual(await applyRefresh(db, "me", again), { inserted: 0, updated: 2 });
  assert.equal(tables.plan_items!.length, 2);
});

test("a failed nightly write fails the job with the count, after trying the rest", async () => {
  const { db, tables } = fakeDb({ plan_items: [] }, { failInsert: (_t, row) => row.dedupe_key === "bad" });
  const plan = { inserts: [{ dedupe_key: "bad" }, { dedupe_key: "good" }], updates: [] };
  await assert.rejects(applyRefresh(db, "me", plan), /1 plan writes failed/);
  assert.equal(tables.plan_items!.length, 1, "the good one still went in");
});

test("upsertPlanItemFor pins to a week without carrying an earlier week's 'New since Monday' (review, 13 Oct 2026)", async () => {
  const { db, tables } = fakeDb({ plan_items: [{ id: 7, client_domain_id: "me", dedupe_key: "schema:org:kp1", status: "suggested", week_of: "2026-10-12", new_since_monday: true }] });
  await upsertPlanItemFor(db, "me", cand({ severity: "blocking", kind: "unblock_crawler" }), { today: "2026-10-19", weekOf: "2026-10-19" });
  assert.equal(tables.plan_items![0]!.week_of, "2026-10-19");
  assert.equal(tables.plan_items![0]!.new_since_monday, false);
  await upsertPlanItemFor(db, "me", cand({ severity: "blocking", kind: "unblock_crawler" }), { today: "2026-10-21", weekOf: "2026-10-19", newSinceMonday: true });
  assert.equal(tables.plan_items![0]!.new_since_monday, true, "a caller that says it is new is believed");
  await upsertPlanItemFor(db, "me", cand(), { today: "2026-10-22" });
  assert.equal(tables.plan_items![0]!.new_since_monday, true, "no week given: the flag is left as it is");
});
