import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import { code } from "../../../lib/source-read.mts";
import { stop, undoStop } from "../../../lib/tracking/stop.ts";

/**
 * An ended client is read-only on every write to what it tracks (13 Oct 2026,
 * DIY P5; the wave inventory found the stop and note routes handed the
 * member's own role to stop.ts and note.ts, so an owner of an ended client
 * could still stop, undo and note, where every other write refuses).
 *
 * The rule is member.ts `writeRole`: an ended client's member writes as a
 * viewer, and every writer refuses a viewer (stop.ts refuseRole). So:
 *
 * - every route under /api/app/[client] that writes tracked data judges its
 *   Supabase path through `writeRole(client)`, and none hands `client.role`
 *   to a write;
 * - the two account routes that read the member's own role are recorded with
 *   why, and the routes that judge no role are recorded too, so a new route
 *   is sorted into one of the three rather than slipping past;
 * - and the writers refuse the role writeRole gives, before any read or write.
 *
 * Fixture branches judge `fx.member.role`, as every route's does: the fixture
 * holds one member and its own state for an ended client.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const ROUTES = join(ROOT, "src", "app", "api", "app", "[client]");

/**
 * Routes that write what a client tracks, its plan, or its setup: each judges the role through writeRole(client).
 * 13 Oct 2026, DIY P6-P10: keywords, pages, opportunity, prompt-offer and links joined check, cluster, edit, group,
 * keyword, note, plan, prompt, setup and stop.
 * 19 Oct 2026: empty. Every one of those routes was deleted with the old /app dashboard (commit 78b1023, owner's
 * instruction: the customer dashboard is the dashboards host only); none had a caller left. The rule stands for any
 * tracked write added under /api/app/[client] again.
 */
const TRACKED_WRITES: string[] = [];

/**
 * Routes that read the member's own role, and why that is not writeRole's question.
 * 19 Oct 2026: `trial` left with the old /app dashboard (commit 78b1023); `member` remains.
 */
const ACCOUNT_ROLE: Record<string, string> = {
  member: "the team: refuseActor(client.role) decides who may invite or remove, which is the account's, not the tracking's",
};

/** Routes that judge no role at all, and why. */
/** 19 Oct 2026: empty. ask, event, hide and report were deleted with the old /app dashboard (commit 78b1023). */
const NO_ROLE: Record<string, string> = {};

const routes = readdirSync(ROUTES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const src = (r: string) => code(readFileSync(join(ROUTES, r, "route.ts"), "utf8"));

test("the walk finds the client routes, and every one is sorted into a list", () => {
  // Floor 16 until 19 Oct 2026; now 1: commit 78b1023 deleted every /api/app/[client] route but `member` with the old
  // /app dashboard, so one route is the whole tree. Fewer than one means the walk found nothing.
  assert.ok(routes.length >= 1, `only ${routes.length} routes under /api/app/[client]: the walk has drifted`);
  const sorted = new Set([...TRACKED_WRITES, ...Object.keys(ACCOUNT_ROLE), ...Object.keys(NO_ROLE)]);
  assert.deepEqual(
    routes.filter((r) => !sorted.has(r)),
    [],
    "a client route that says nothing about roles: add it to TRACKED_WRITES, ACCOUNT_ROLE or NO_ROLE with why",
  );
  for (const r of sorted) assert.ok(routes.includes(r), `${r} is listed and is no longer a route`);
});

test("every tracked write judges its Supabase path through writeRole(client), never the member's own role", () => {
  for (const r of TRACKED_WRITES) {
    const s = src(r);
    assert.ok(s.includes("writeRole(client)"), `${r}: no writeRole(client), so an ended client's owner writes as an owner`);
    assert.ok(!/\bclient\.role\b/.test(s), `${r}: reads client.role, which an ended client keeps`);
  }
});

// 19 Oct 2026: "stop and note, the two the inventory found, hand writeRole's role to their writers" is retired. Its
// subject was the /api/app/[client]/stop and /note routes, deleted with the old /app dashboard (commit 78b1023).

test("the account routes read the member's own role, and the rest judge none", () => {
  for (const r of Object.keys(ACCOUNT_ROLE)) assert.match(src(r), /\bclient\.role\b/, `${r} no longer reads the member's role: move it`);
  for (const r of Object.keys(NO_ROLE)) assert.ok(!/\bclient\.role\b|writeRole\(/.test(src(r)), `${r} judges a role now: move it`);
});

test("writeRole makes an ended client's member a viewer (member.ts is server-only, so its rule is read as written)", () => {
  const member = code(readFileSync(join(ROOT, "src", "lib", "tracking", "member.ts"), "utf8"));
  assert.ok(member.includes('return c.status === "ended" ? "viewer" : c.role;'), "writeRole's rule moved: re-read it here");
});

/** A database that fails the test if anything touches it: a refusal comes before any read or write. */
const untouched = new Proxy({}, { get: (_, k) => assert.fail(`the writer touched the database (${String(k)}) before refusing`) }) as unknown as SupabaseClient;

test("stop and undo refuse the viewer writeRole makes of an ended client's owner, before any read", async () => {
  const refused = { ok: false, message: "Only owners and editors can change what is tracked." };
  assert.deepEqual(await stop(untouched, { kind: "prompt", clientId: "cl", id: "q1", today: "2026-10-13", by: "owner@example.com", role: "viewer" }), refused);
  assert.deepEqual(await undoStop(untouched, { kind: "cluster", clientId: "cl", id: "c1", today: "2026-10-13", role: "viewer" }), refused);
  // 19 Oct 2026: the note writer (tracking/note.ts) was deleted with the old /app dashboard (commit 78b1023).
});
