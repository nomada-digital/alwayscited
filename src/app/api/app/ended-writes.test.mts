import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";

import { code } from "../../../lib/source-read.mts";
import { addNote } from "../../../lib/tracking/note.ts";
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
 * 13 Oct 2026, DIY P6: `keywords` joins - gaining ground's Dismiss and Restore (spec 10 section 3.6), owner and
 * editor only, refused through refuseRole(writeRole(client)) on the fixture and in Supabase alike.
 */
const TRACKED_WRITES = [
  "check", "cluster", "edit", "group", "keyword", "keywords", "note", "plan", "prompt", "setup", "stop",
  // 13 Oct 2026, DIY P7 (spec 10 section 3.6): Opportunities' statuses, with the Plan items and prompts a pursuit
  // writes, and the prompt step's add, undo and swap. Both judge writeRole(client), so an ended client is read-only.
  "opportunity", "prompt-offer",
];

/** Routes that read the member's own role, and why that is not writeRole's question. */
const ACCOUNT_ROLE: Record<string, string> = {
  member: "the team: refuseActor(client.role) decides who may invite or remove, which is the account's, not the tracking's",
  trial: "cancelling a trial at Stripe: cancelTrial's own rule, and an ended client has no trial left to cancel",
};

/** Routes that judge no role at all, and why. */
const NO_ROLE: Record<string, string> = {
  ask: "any member may ask Nomada or their agency (spec 10 section 2.2: viewers too), three a day",
  event: "a usage beacon: an event name and a route shape, never content",
  hide: "hides an upgrade prompt for the member who pressed it, for 30 days",
  report: "a CSV of what was read: a read, not a write",
};

const routes = readdirSync(ROUTES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const src = (r: string) => code(readFileSync(join(ROUTES, r, "route.ts"), "utf8"));

test("the walk finds the client routes, and every one is sorted into a list", () => {
  assert.ok(routes.length >= 16, `only ${routes.length} routes under /api/app/[client]: the walk has drifted`);
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

test("stop and note, the two the inventory found, hand writeRole's role to their writers", () => {
  assert.match(src("stop"), /stop\(supabaseAdmin\(\), \{ kind: "prompt", clientId: client\.id, id, today, role: writeRole\(client\), by: email \}\)/, "the bulk stop");
  assert.match(src("stop"), /const p = \{ kind: f\.kind, clientId: client\.id, id: f\.id, today: trackingDay\(\), role: writeRole\(client\) \};/, "the one-row stop and its undo");
  assert.match(src("note"), /addNote\(supabaseAdmin\(\), \{[^}]*role: writeRole\(client\),[^}]*\}\)/, "the note");
});

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

test("stop, undo and note refuse the viewer writeRole makes of an ended client's owner, before any read", async () => {
  const refused = { ok: false, message: "Only owners and editors can change what is tracked." };
  assert.deepEqual(await stop(untouched, { kind: "prompt", clientId: "cl", id: "q1", today: "2026-10-13", by: "owner@example.com", role: "viewer" }), refused);
  assert.deepEqual(await undoStop(untouched, { kind: "cluster", clientId: "cl", id: "c1", today: "2026-10-13", role: "viewer" }), refused);
  assert.deepEqual(await addNote(untouched, { clientId: "cl", clusterId: "c1", questionId: "q1", text: "Relaunched.", email: "owner@example.com", role: "viewer", today: "2026-10-13" }), refused);
});
