import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { APP_LIMITS } from "../../../config/contact.ts";
import {
  ENDED_REASON,
  HIDE_DAYS,
  PLAN_DONE,
  PLAN_WHY,
  VIEWER_REASON,
  decide,
  hidePatch,
  isHidden,
  movePatch,
  movesFrom,
  planToast,
  readChanged,
  readNoteText,
  readOwner,
  readTitle,
  refuseMove,
  refusePlanRole,
} from "./transitions.ts";
import type { PlanForm } from "./transitions.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const ctx = { role: "owner", today: "2026-10-13", now: "2026-10-13T10:00:00.000Z", by: "owner@example.com", members: [{ email: "owner@example.com" }, { email: "Editor@example.com" }], clusters: ["c1", "c2"] };
const form = (o: Partial<PlanForm>): PlanForm => ({ do: "move", id: "i1", to: null, changed: null, note: null, owner: null, title: null, cluster: null, ...o });
const item = (status: "suggested" | "todo" | "doing" | "done" | "dropped", startedOn: string | null = null) => ({ id: "i1", status, startedOn });

test("roles: owners and editors write; a viewer, or a role we do not know, is refused with the viewer line", () => {
  assert.equal(refusePlanRole("owner"), null);
  assert.equal(refusePlanRole("editor"), null);
  assert.equal(refusePlanRole("viewer"), VIEWER_REASON);
  assert.equal(refusePlanRole(""), VIEWER_REASON);
  assert.equal(VIEWER_REASON, "Viewers can't change this. Ask an owner or editor.");
  assert.deepEqual(decide(form({ do: "start" }), item("suggested"), { ...ctx, role: "viewer" }), { op: "refuse", why: "viewer" });
  assert.deepEqual(decide(form({ do: "add", title: "x" }), null, { ...ctx, role: "viewer" }), { op: "refuse", why: "viewer" });
});

test("an ended client is read-only: the route and the page judge writes by writeRole(client), which reads an ended client as a viewer", () => {
  // member.ts writeRole imports server-only, so its use is held here by source; its rule is member.ts's own.
  const route = readFileSync(join(ROOT, "src/app/api/app/[client]/plan/route.ts"), "utf8");
  const page = readFileSync(join(ROOT, "src/app/app/[client]/plan/page.tsx"), "utf8");
  assert.match(route, /role: writeRole\(client\)/);
  assert.match(page, /const canWrite = refuseRole\(writeRole\(client\)\) === null;/);
  assert.match(page, /client\.status === "ended" \? ENDED_REASON : VIEWER_REASON/);
  assert.match(ENDED_REASON, /read-only/);
});

test("allowed moves", () => {
  assert.equal(refuseMove("suggested", "todo"), null);
  assert.equal(refuseMove("suggested", "doing"), null);
  assert.equal(refuseMove("suggested", "dropped"), null);
  for (const from of ["todo", "doing", "done"] as const) for (const to of ["todo", "doing", "done", "dropped"] as const) if (from !== to) assert.equal(refuseMove(from, to), null, `${from} -> ${to}`);
  assert.equal(refuseMove("dropped", "todo"), null);
  assert.deepEqual(movesFrom("todo"), ["doing", "done", "dropped"]);
  assert.deepEqual(movesFrom("done"), ["todo", "doing", "dropped"]);
  assert.deepEqual(movesFrom("dropped"), ["todo"]);
});

test("refused moves: back to Suggested, a suggestion straight to Done, a dropped item anywhere but To do, and staying put", () => {
  for (const from of ["todo", "doing", "done", "dropped"] as const) assert.notEqual(refuseMove(from, "suggested"), null);
  assert.notEqual(refuseMove("suggested", "done"), null);
  assert.notEqual(refuseMove("dropped", "doing"), null);
  assert.notEqual(refuseMove("dropped", "done"), null);
  assert.notEqual(refuseMove("todo", "todo"), null);
  assert.deepEqual(decide(form({ to: "done" }), item("suggested"), ctx), { op: "refuse", why: "move" });
  assert.deepEqual(decide(form({ to: "nonsense" }), item("todo"), ctx), { op: "refuse", why: "move" });
  assert.deepEqual(decide(form({ do: "accept" }), item("todo"), ctx), { op: "refuse", why: "move" });
  assert.deepEqual(decide(form({ do: "later" }), item("doing"), ctx), { op: "refuse", why: "move" });
});

test("Start, Accept and Not now on a suggestion", () => {
  const start = decide(form({ do: "start" }), item("suggested"), ctx);
  assert.equal(start.op, "update");
  if (start.op !== "update") return;
  assert.equal(start.expect, "suggested");
  assert.equal(start.done, "started");
  assert.deepEqual(start.patch, { status: "doing", status_at: ctx.now, status_by: ctx.by, started_on: ctx.today });
  const accept = decide(form({ do: "accept" }), item("suggested"), ctx);
  assert.equal(accept.op === "update" && accept.patch.status, "todo");
  const later = decide(form({ do: "later" }), item("suggested"), ctx);
  assert.equal(later.op === "update" && later.done, "hidden");
  assert.equal(later.op === "update" && later.patch.hidden_until, "2026-10-27");
  assert.equal(later.op === "update" && later.patch.status, undefined, "Not now keeps it a suggestion");
  assert.equal(HIDE_DAYS, 14);
});

test("hidden: until the day hidden_until names, then back", () => {
  const p = hidePatch({ today: "2026-10-13", now: ctx.now, by: ctx.by });
  assert.equal(isHidden({ hiddenUntil: p.hidden_until! }, "2026-10-26"), true);
  assert.equal(isHidden({ hiddenUntil: p.hidden_until! }, "2026-10-27"), false);
  assert.equal(isHidden({ hiddenUntil: null }, "2026-10-13"), false);
});

test("Done stamps done_on and keeps the answer to 'Did you change the page?'; leaving Done clears both and any verification", () => {
  const done = decide(form({ to: "done", changed: "partly" }), item("doing", "2026-10-01"), ctx);
  assert.equal(done.op, "update");
  if (done.op !== "update") return;
  assert.deepEqual(done.patch, { status: "done", status_at: ctx.now, status_by: ctx.by, done_on: ctx.today, readout_base: { changed: "partly" } });
  const unanswered = movePatch({ status: "doing", startedOn: "2026-10-01" }, "done", { today: ctx.today, now: ctx.now, by: ctx.by, changed: readChanged("maybe") });
  assert.deepEqual(unanswered.readout_base, {}, "an answer that is not yes, partly or no is no answer");
  const reopened = movePatch({ status: "done", startedOn: "2026-10-01" }, "doing", { today: ctx.today, now: ctx.now, by: ctx.by });
  assert.equal(reopened.done_on, null);
  assert.equal(reopened.readout_base, null);
  assert.equal(reopened.verified, null);
  assert.equal(reopened.started_on, undefined, "started_on is stamped once");
});

test("drop, note and assign", () => {
  const drop = decide(form({ do: "drop" }), item("todo"), ctx);
  assert.equal(drop.op === "update" && drop.patch.status, "dropped");
  const note = decide(form({ do: "note", note: "  call   them  " }), item("todo"), ctx);
  assert.deepEqual(note.op === "update" && note.patch, { note: "call them" });
  assert.deepEqual(decide(form({ do: "note", note: "" }), item("todo"), ctx).op === "update" && (decide(form({ do: "note", note: "" }), item("todo"), ctx) as { patch: object }).patch, { note: null });
  assert.deepEqual(decide(form({ do: "note", note: "x".repeat(APP_LIMITS.note + 1) }), item("todo"), ctx), { op: "refuse", why: "note" });
  const assign = decide(form({ do: "assign", owner: "EDITOR@example.com " }), item("todo"), ctx);
  assert.deepEqual(assign.op === "update" && assign.patch, { owner_email: "Editor@example.com" }, "matched without case, stored as the member's own address");
  assert.deepEqual(decide(form({ do: "assign", owner: "" }), item("todo"), ctx).op === "update", true);
  assert.deepEqual(decide(form({ do: "assign", owner: "stranger@example.com" }), item("todo"), ctx), { op: "refuse", why: "owner" });
  assert.deepEqual(readOwner("x".repeat(300), ctx.members), { ok: false, why: "owner" });
});

test("a post about an item this client does not have is 'gone'", () => {
  assert.deepEqual(decide(form({ do: "start" }), null, ctx), { op: "refuse", why: "gone" });
  assert.deepEqual(decide(form({ do: "move", to: "doing" }), null, ctx), { op: "refuse", why: "gone" });
});

test("task title bounds: 1-200 characters once whitespace is squashed", () => {
  assert.equal(APP_LIMITS.task, 200);
  assert.deepEqual(readTitle(""), { ok: false, why: "title" });
  assert.deepEqual(readTitle("   \n  "), { ok: false, why: "title" });
  assert.deepEqual(readTitle(null), { ok: false, why: "title" });
  assert.deepEqual(readTitle("a"), { ok: true, title: "a" });
  assert.deepEqual(readTitle("x".repeat(200)), { ok: true, title: "x".repeat(200) });
  assert.deepEqual(readTitle("x".repeat(201)), { ok: false, why: "title" });
  assert.deepEqual(readTitle("  Ask   for a   review "), { ok: true, title: "Ask for a review" });
  assert.deepEqual(decide(form({ do: "add", title: "Ask for a review", cluster: "c2" }), null, ctx), { op: "insert", title: "Ask for a review", clusterId: "c2", done: "added" });
  assert.deepEqual(decide(form({ do: "add", title: "Ask", cluster: "" }), null, ctx), { op: "insert", title: "Ask", clusterId: null, done: "added" });
  assert.deepEqual(decide(form({ do: "add", title: "Ask", cluster: "c9" }), null, ctx), { op: "refuse", why: "cluster" });
  assert.deepEqual(decide(form({ do: "add", title: "x".repeat(201) }), null, ctx), { op: "refuse", why: "title" });
  assert.deepEqual(readNoteText("x".repeat(200)), { ok: true, note: "x".repeat(200) });
});

test("the toast: fixed words for known codes only, nothing echoed", () => {
  for (const d of PLAN_DONE) assert.ok(planToast(d, null), d);
  for (const w of PLAN_WHY) assert.ok(planToast("refused", w), w);
  assert.equal(planToast("refused", "<script>"), planToast("refused", "failed"));
  assert.equal(planToast("nonsense", null), null);
  assert.equal(planToast(null, "viewer"), null);
  assert.equal(planToast("refused", "viewer"), VIEWER_REASON);
});
