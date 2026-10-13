import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { FIXTURE_SECOND_CLIENT, expandFixture, fixtureClients, fixtureSettings, fixtureState } from "./fixture-mode.ts";
import { FIXTURE_CHECK_VOLUME, fixtureAddCluster, fixtureCheck, fixtureEditPrompts, fixtureFillSlot, fixtureGroup, fixtureStop, fixtureTeam, fixtureWrites } from "./fixture-writes.ts";
import { addDays } from "./figures.ts";
import { MEMBERS_PER_CLIENT, SCOPE_NOT_READY, TEAM_WHY } from "./team.ts";

/**
 * R168 (Danny, 2 Oct 2026, danny.md lines 177-179): TRACKING_FIXTURE_WRITE=1,
 * the writable fixture. Refused in production as TRACKING_FIXTURE is; the
 * writes follow stop.ts's rules on the fixture's rows.
 */

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));

test("R168: TRACKING_FIXTURE_WRITE=1 is refused in production, with or without TRACKING_FIXTURE", () => {
  assert.throws(() => fixtureWrites({ TRACKING_FIXTURE_WRITE: "1", VERCEL_ENV: "production" }), /refuses/);
  assert.throws(() => fixtureWrites({ TRACKING_FIXTURE_WRITE: "1", TRACKING_FIXTURE: "1", VERCEL_ENV: "production" }), /refuses/);
});

test("R168: writes are on only with both switches exactly 1, outside production", () => {
  assert.equal(fixtureWrites({}), false);
  assert.equal(fixtureWrites({ TRACKING_FIXTURE: "1" }), false, "the fixture alone stays read-only");
  assert.equal(fixtureWrites({ TRACKING_FIXTURE_WRITE: "1" }), false, "no fixture, nothing to write to");
  assert.equal(fixtureWrites({ TRACKING_FIXTURE_WRITE: "true", TRACKING_FIXTURE: "1" }), false);
  assert.equal(fixtureWrites({ TRACKING_FIXTURE_WRITE: "1", TRACKING_FIXTURE: "1" }), true);
  assert.equal(fixtureWrites({ TRACKING_FIXTURE_WRITE: "1", TRACKING_FIXTURE: "1", VERCEL_ENV: "preview" }), true);
});

test("R168: the stop and undo routes ask the writable fixture before refusing", () => {
  // "keyword" added 2 Oct 2026 (R179): Use this keyword on a pending cluster.
  for (const route of ["stop", "prompt", "edit", "member", "check", "cluster", "group", "setup", "keyword"]) {
    const src = readFileSync(new URL(`../../app/api/app/[client]/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(src, route === "setup" ? /confirmFixtureSetup\(\)/ : route === "check" ? /writableFixture\(\)/ : /writeFixture\(/, `${route} writes to the fixture`);
  }
});

const first = fx.data.questions.find((q) => q.stopped_on === null && q.cluster_id !== null)!;
const day = addDays(fx.today, 1);

test("R168: a prompt stops from tomorrow, and undo brings it back", () => {
  const s = fixtureStop(fx, { kind: "prompt", id: first.id, today: fx.today, role: "owner", undo: false });
  assert.ok(s.ok);
  assert.equal(s.fixture.data.questions.find((q) => q.id === first.id)!.stopped_on, day);
  assert.equal(s.fixture.data.questions.filter((q) => q.stopped_on !== null).length, 1, "only that prompt");
  assert.ok(fx.data.questions.every((q) => q.stopped_on === null), "the fixture in is untouched");
  const again = fixtureStop(s.fixture, { kind: "prompt", id: first.id, today: fx.today, role: "owner", undo: false });
  assert.deepEqual(again, { ok: false, message: "It is already stopped." });
  const u = fixtureStop(s.fixture, { kind: "prompt", id: first.id, today: fx.today, role: "editor", undo: true });
  assert.ok(u.ok);
  assert.equal(u.fixture.data.questions.find((q) => q.id === first.id)!.stopped_on, null);
});

test("R168: viewers, unknown ids, and an undo after the stop took effect are refused", () => {
  assert.equal(fixtureStop(fx, { kind: "prompt", id: first.id, today: fx.today, role: "viewer", undo: false }).ok, false);
  assert.equal(fixtureStop(fx, { kind: "prompt", id: "nope", today: fx.today, role: "owner", undo: false }).ok, false);
  const s = fixtureStop(fx, { kind: "prompt", id: first.id, today: fx.today, role: "owner", undo: false });
  assert.ok(s.ok);
  const late = fixtureStop(s.fixture, { kind: "prompt", id: first.id, today: day, role: "owner", undo: true });
  assert.deepEqual(late, { ok: false, message: "That stop has taken effect. Add it again as a new one." });
});

test("R168: a cluster stops with its keyword and live prompts; undo brings back only those stopped on its day", () => {
  const c = fx.data.clusters.find((x) => x.stopped_on === null && x.keyword_id)!;
  const own = fixtureStop(fx, { kind: "prompt", id: fx.data.questions.find((q) => q.cluster_id === c.id)!.id, today: addDays(fx.today, -2), role: "owner", undo: false });
  assert.ok(own.ok, "one prompt stopped on its own, earlier");
  const s = fixtureStop(own.fixture, { kind: "cluster", id: c.id, today: fx.today, role: "owner", undo: false });
  assert.ok(s.ok);
  assert.equal(s.fixture.data.clusters.find((x) => x.id === c.id)!.stopped_on, day);
  assert.equal(s.fixture.data.keywords.find((k) => k.id === c.keyword_id)!.stopped_on, day);
  assert.ok(s.fixture.data.questions.filter((q) => q.cluster_id === c.id).every((q) => q.stopped_on !== null));
  const inside = s.fixture.data.questions.find((q) => q.cluster_id === c.id && q.stopped_on === day)!;
  assert.match((fixtureStop(s.fixture, { kind: "prompt", id: inside.id, today: fx.today, role: "owner", undo: true }) as { message: string }).message, /Undo the cluster/);
  const u = fixtureStop(s.fixture, { kind: "cluster", id: c.id, today: fx.today, role: "owner", undo: true });
  assert.ok(u.ok);
  const mine = u.fixture.data.questions.filter((q) => q.cluster_id === c.id);
  assert.equal(mine.filter((q) => q.stopped_on !== null).length, 1, "the prompt stopped on its own stays stopped");
  assert.equal(u.fixture.data.keywords.find((k) => k.id === c.keyword_id)!.stopped_on, null);
});

test("R168 part 2: a free slot takes a new prompt from tomorrow, at the stopped prompt's angle; the rules refuse as slot.ts does", () => {
  const c = first.cluster_id!;
  const s = fixtureStop(fx, { kind: "prompt", id: first.id, today: fx.today, role: "owner", undo: false });
  assert.ok(s.ok);
  const text = "Which tool sends invoices fastest?";
  assert.equal(fixtureFillSlot(fx, { clusterId: c, angle: "outcome", text, today: fx.today, role: "owner" }).ok, false, "a cluster with 5 live prompts has no slot");
  const a = fixtureFillSlot(s.fixture, { clusterId: c, angle: "outcome", text: `  ${text}  `, today: fx.today, role: "editor" });
  assert.ok(a.ok && a.id);
  const row = a.fixture.data.questions.find((q) => q.id === a.id)!;
  assert.deepEqual([row.text, row.added_on, row.angle, row.cluster_id, row.stopped_on], [text, day, "outcome", c, null]);
  assert.ok(!fx.data.questions.some((q) => q.id === a.id), "a new id");
  const other = fx.data.questions.find((q) => q.cluster_id === c && q.id !== first.id)!.text;
  assert.equal(fixtureFillSlot(s.fixture, { clusterId: c, angle: null, text: "short", today: fx.today, role: "owner" }).ok, false, "too short");
  assert.equal(fixtureFillSlot(s.fixture, { clusterId: c, angle: null, text: other, today: fx.today, role: "owner" }).ok, false, "already tracked");
  assert.equal(fixtureFillSlot(s.fixture, { clusterId: c, angle: null, text, today: fx.today, role: "viewer" }).ok, false, "viewer");
  assert.equal(fixtureFillSlot(s.fixture, { clusterId: "nope", angle: null, text, today: fx.today, role: "owner" }).ok, false, "not this client's");
});

test("R168 part 2: a pending cluster's prompts are rewritten in place; a prompt with readings is fixed", () => {
  const c = first.cluster_id!;
  const edits = [{ id: first.id, text: "Which invoicing app do freelancers pick first?" }];
  const fresh = { ...fx, data: { ...fx.data, answers: fx.data.answers.filter((x) => x.question_id !== first.id) } };
  const e = fixtureEditPrompts(fresh, { clusterId: c, edits, role: "owner" });
  assert.ok(e.ok);
  assert.equal(e.fixture.data.questions.find((q) => q.id === first.id)!.text, edits[0]!.text);
  assert.equal(e.fixture.data.questions.filter((q, i) => q !== fresh.data.questions[i]).length, 1, "only that prompt");
  assert.deepEqual(fixtureEditPrompts(fx, { clusterId: c, edits, role: "owner" }), { ok: false, message: "It already has readings, so its text is fixed. Stop it and add a new one." });
  assert.equal(fixtureEditPrompts(fresh, { clusterId: c, edits, role: "viewer" }).ok, false);
});

test("R168 part 3: invite, role and remove change fixture.members under team.ts's rules", () => {
  const now = "2026-10-02T00:00:00Z";
  const live = (f: typeof fx) => f.members.filter((m) => !m.removed_at).map((m) => `${m.email}:${m.role}`);
  const i = fixtureTeam(fx, { op: "invite", email: "new@example.com", role: "viewer", scope: null, slug: "tallyroo", now });
  assert.ok(i.ok);
  assert.ok(live(i.fixture).includes("new@example.com:viewer"));
  const back = fixtureTeam(fx, { op: "invite", email: "gone@example.com", role: "viewer", scope: null, slug: "tallyroo", now });
  assert.ok(back.ok);
  assert.equal(back.fixture.members.filter((m) => m.email === "gone@example.com").length, 1, "a removed row is revived, not duplicated");
  assert.ok(live(back.fixture).includes("gone@example.com:viewer"));
  assert.equal(fixtureTeam(fx, { op: "invite", email: "editor@example.com", role: "viewer", scope: null, slug: "tallyroo", now }).ok, false, "already on the team");
  const r = fixtureTeam(fx, { op: "role", email: "editor@example.com", role: "viewer", scope: null, slug: "tallyroo", now });
  assert.ok(r.ok && live(r.fixture).includes("editor@example.com:viewer"));
  assert.equal(fixtureTeam(fx, { op: "role", email: "viewer@example.com", role: "viewer", scope: null, slug: "tallyroo", now }).ok, false, "already a viewer");
  const x = fixtureTeam(fx, { op: "remove", email: "viewer@example.com", role: null, scope: null, slug: "tallyroo", now });
  assert.ok(x.ok);
  assert.equal(x.fixture.members.find((m) => m.email === "viewer@example.com")!.removed_at, now, "removing never deletes");
  assert.equal(fixtureTeam(fx, { op: "remove", email: fx.member.email, role: null, scope: null, slug: "tallyroo", now }).ok, false, "never yourself");
  const editor = { ...fx, member: { email: "editor@example.com", role: "editor" } };
  assert.deepEqual(fixtureTeam(editor, { op: "invite", email: "new@example.com", role: "viewer", scope: null, slug: "tallyroo", now }), { ok: false, message: "Only owners can change the team." });
});

test("AG-1 (9 Oct 2026): on the two-clients fixture an invite is to this client only unless it says every client; Remove takes one client", () => {
  const now = "2026-10-09T09:00:00Z";
  const two = fixtureState(fx, { TRACKING_FIXTURE_STATE: "two-clients" });
  const b = FIXTURE_SECOND_CLIENT.id;
  const team = (f: typeof two, id: string) => fixtureSettings(f, id).members.map((m) => m.email);
  // Invited on Tallyroo with no scope word: Tallyroo only.
  const i = fixtureTeam(two, { op: "invite", email: "new@example.com", role: "viewer", scope: null, slug: "tallyroo", now });
  assert.ok(i.ok);
  assert.deepEqual(i.fixture.members.find((m) => m.email === "new@example.com")!.clients, [two.client.id]);
  assert.ok(team(i.fixture, two.client.id).includes("new@example.com"));
  assert.ok(!team(i.fixture, b).includes("new@example.com"), "Ledgerline's Settings does not list them");
  // Every client: no list.
  const e = fixtureTeam(two, { op: "invite", email: "staff@example.com", role: "editor", scope: "account", slug: "ledgerline", now });
  assert.ok(e.ok && !("clients" in e.fixture.members.find((m) => m.email === "staff@example.com")!));
  // books@ sees Ledgerline only, so on Tallyroo they are not "already": Tallyroo joins their list.
  const add = fixtureTeam(two, { op: "invite", email: "books@example.com", role: "editor", scope: "client", slug: "tallyroo", now });
  assert.ok(add.ok);
  assert.deepEqual(add.fixture.members.find((m) => m.email === "books@example.com")!.clients, [b, two.client.id]);
  // Remove on Tallyroo takes Tallyroo only from them; on Ledgerline it then takes their last, and them.
  const off = fixtureTeam(add.fixture, { op: "remove", email: "books@example.com", role: null, scope: null, slug: "tallyroo", now });
  assert.ok(off.ok);
  const books = off.fixture.members.find((m) => m.email === "books@example.com")!;
  assert.deepEqual([books.clients, books.removed_at ?? null], [[b], null]);
  const gone = fixtureTeam(off.fixture, { op: "remove", email: "books@example.com", role: null, scope: null, slug: "ledgerline", now });
  assert.ok(gone.ok);
  assert.equal(gone.fixture.members.find((m) => m.email === "books@example.com")!.removed_at, now);
  // Remove on Tallyroo cannot reach someone who does not see it.
  assert.equal(fixtureTeam(two, { op: "remove", email: "books@example.com", role: null, scope: null, slug: "tallyroo", now }).ok, false);
  // The scoped viewer's session sees Tallyroo only; a post on Ledgerline's route is refused before any rule.
  const lead = fixtureState(fx, { TRACKING_FIXTURE_STATE: "two-clients", TRACKING_FIXTURE_ROLE: "scoped" });
  assert.deepEqual(fixtureClients(lead, lead.member.email).map((c) => c.slug), ["tallyroo"]);
  assert.equal(fixtureTeam({ ...two, member: { email: "owner@example.com", role: "owner" } }, { op: "invite", email: "x@example.com", role: "viewer", scope: null, slug: "nowhere", now }).ok, false, "an unknown client is refused");
});

/**
 * AG-1 review (9 Oct 2026). The fixture runs the member route's planTeam, so
 * the review's cases hold on it: a one-client invite is that client only; an
 * every-client invite is held to the cap on Ledgerline too; and, with
 * TRACKING_FIXTURE_SCOPING=0 (the deploy before its migration), an invite can
 * only be to every client.
 */
test("AG-1 review: one-client invites are that client only; an every-client invite counts on every client; before the migration, every client only", () => {
  const now = "2026-10-09T12:00:00Z";
  // The default fixture has one client: the invitee is limited to it, so a client the account gains later stays hidden.
  const one = fixtureTeam(fx, { op: "invite", email: "lead@client.example", role: "viewer", scope: "account", slug: "tallyroo", now });
  assert.ok(one.ok);
  assert.deepEqual(one.fixture.members.find((m) => m.email === "lead@client.example")!.clients, [fx.client.id]);

  // The review's repro: Ledgerline full with Ledgerline-only members, then an every-client invite from Tallyroo.
  const two = fixtureState(fx, { TRACKING_FIXTURE_STATE: "two-clients" });
  const b = FIXTURE_SECOND_CLIENT.id;
  let full = two;
  for (let i = 0; fixtureSettings(full, b).members.length < MEMBERS_PER_CLIENT; i++) {
    const r = fixtureTeam(full, { op: "invite", email: `l${i}@ledgerline.example`, role: "viewer", scope: "client", slug: "ledgerline", now });
    assert.ok(r.ok);
    full = r.fixture;
  }
  assert.deepEqual(fixtureTeam(full, { op: "invite", email: "late@example.com", role: "viewer", scope: "client", slug: "ledgerline", now }), { ok: false, message: TEAM_WHY.full });
  assert.deepEqual(fixtureTeam(full, { op: "invite", email: "late@example.com", role: "viewer", scope: "account", slug: "tallyroo", now }), { ok: false, message: TEAM_WHY.fullOther });
  assert.equal(fixtureSettings(full, b).members.length, MEMBERS_PER_CLIENT, "Ledgerline stays at ten");
  const tallyOnly = fixtureTeam(full, { op: "invite", email: "late@example.com", role: "viewer", scope: "client", slug: "tallyroo", now });
  assert.ok(tallyOnly.ok, "to Tallyroo only, Ledgerline is not touched");

  // Before the migration: nobody is limited, the invite is to every client, and one client cannot be asked for.
  const before = fixtureState(fx, { TRACKING_FIXTURE_STATE: "two-clients", TRACKING_FIXTURE_SCOPING: "0" });
  assert.equal(before.scoping, false);
  assert.deepEqual(fixtureTeam(before, { op: "invite", email: "new@example.com", role: "viewer", scope: "client", slug: "tallyroo", now }), { ok: false, message: SCOPE_NOT_READY });
  const wide = fixtureTeam(before, { op: "invite", email: "new@example.com", role: "viewer", scope: "account", slug: "tallyroo", now });
  assert.ok(wide.ok && !("clients" in wide.fixture.members.find((m) => m.email === "new@example.com")!));
  const solo = fixtureTeam(fixtureState(fx, { TRACKING_FIXTURE_SCOPING: "0" }), { op: "invite", email: "new@example.com", role: "viewer", scope: null, slug: "tallyroo", now });
  assert.ok(solo.ok && !("clients" in solo.fixture.members.find((m) => m.email === "new@example.com")!), "one client before the migration: every client, as before AG-1");
});

test("R168 part 4: Check keyword on the fixture runs the free prechecks, then a canned signed pass; the save verifies it", () => {
  assert.equal(fixtureCheck(fx, "how to do bookkeeping").check.ok, false, "informational is refused for real");
  assert.deepEqual(fixtureCheck(fx, "how to do bookkeeping").check, { ...fixtureCheck(fx, "how to do bookkeeping").check, reason: "informational" });
  assert.equal(fixtureCheck(fx, fx.data.keywords[0]!.keyword).check.ok, false, "already tracked");
  assert.equal(fixtureCheck(fx, `${fx.client.brand} pricing`).check.ok, false, "own brand");
  const kw = "invoicing software for contractors";
  const c = fixtureCheck(fx, kw);
  assert.ok(c.check.ok && c.sig);
  const prompts = ["Which invoicing tool do contractors pick?", "Which invoicing tool is easiest for contractors?", "Which invoicing tool do builders recommend?", "Which invoicing tool gets contractors paid fastest?", "What is a good alternative to the usual contractor invoicing tool?"];
  const base = { keyword: kw, volume: FIXTURE_CHECK_VOLUME, intent: "commercial", sig: c.sig!, prompts, role: "owner" };
  const live = fx.data.clusters.filter((x) => x.stopped_on === null).length;
  const room = { ...fx, client: { ...fx.client, cluster_limit: live + 1 } };
  const a = fixtureAddCluster(room, base);
  assert.ok(a.ok && a.id, a.ok ? "" : a.message);
  const cl = a.fixture.data.clusters.find((x) => x.id === a.id)!;
  const kwRow = a.fixture.data.keywords.find((k) => k.id === cl.keyword_id)!;
  assert.deepEqual([cl.name, cl.started_on, kwRow.keyword, kwRow.search_volume, kwRow.intent], [kw, day, kw, FIXTURE_CHECK_VOLUME, "commercial"]);
  const qs = a.fixture.data.questions.filter((q) => q.cluster_id === a.id);
  assert.deepEqual(qs.map((q) => q.angle), ["category", "positioning", "sector", "outcome", "comparison"]);
  assert.equal(new Set(a.fixture.data.questions.map((q) => q.id)).size, a.fixture.data.questions.length, "new ids");
  assert.equal(fixtureAddCluster(room, { ...base, sig: "0".repeat(64) }).ok, false, "a hand-made signature is refused");
  assert.equal(fixtureAddCluster(room, { ...base, volume: 99999 }).ok, false, "a changed volume does not verify");
  assert.equal(fixtureAddCluster(room, { ...base, role: "viewer" }).ok, false, "viewer");
  assert.equal(fixtureAddCluster(a.fixture, base).ok, false, "a second add of the same keyword is refused");
  assert.match((fixtureAddCluster(fx, base) as { message: string }).message, /At the limit of 10 clusters/, "the default fixture is at 10 of 10");
});

test("R170 part 2: an ungrouped prompt moves into a live cluster with room, at the angle the stopped prompt freed", () => {
  const c = first.cluster_id!;
  const other = fx.data.questions.find((q) => q.stopped_on === null && q.cluster_id !== null && q.cluster_id !== c)!;
  const loose = { ...fx, data: { ...fx.data, questions: fx.data.questions.map((q) => (q.id === other.id ? { ...q, cluster_id: null, angle: null } : q)) } };
  assert.match((fixtureGroup(loose, { clusterId: c, id: other.id, role: "owner" }) as { message: string }).message, /has 5 live/, "a full cluster is refused");
  const s = fixtureStop(loose, { kind: "prompt", id: first.id, today: fx.today, role: "owner", undo: false });
  assert.ok(s.ok);
  const m = fixtureGroup(s.fixture, { clusterId: c, id: other.id, role: "editor" });
  assert.ok(m.ok, m.ok ? "" : m.message);
  const row = m.fixture.data.questions.find((q) => q.id === other.id)!;
  assert.deepEqual([row.cluster_id, row.angle, row.text, row.stopped_on], [c, first.angle, other.text, null]);
  assert.equal(m.fixture.data.questions.filter((q, i) => q !== s.fixture.data.questions[i]).length, 1, "only that prompt");
  assert.equal(fixtureGroup(s.fixture, { clusterId: c, id: other.id, role: "viewer" }).ok, false, "viewer");
  assert.equal(fixtureGroup(s.fixture, { clusterId: c, id: first.id, role: "owner" }).ok, false, "a prompt already in a cluster is not grouped");
  assert.equal(fixtureGroup(s.fixture, { clusterId: "nope", id: other.id, role: "owner" }).ok, false, "not this client's cluster");
  const stopped = fixtureStop(s.fixture, { kind: "cluster", id: c, today: fx.today, role: "owner", undo: false });
  assert.ok(stopped.ok);
  assert.equal(fixtureGroup(stopped.fixture, { clusterId: c, id: other.id, role: "owner" }).ok, false, "a stopped cluster is refused");
});

test("13 Oct 2026, DIY P2: on the placed state a stopped angle prompt's slot fills beside c1's three placement prompts, as limits.ts counts", () => {
  const placed = fixtureState(fx, { TRACKING_FIXTURE_STATE: "placed" });
  const angle = placed.data.questions.find((q) => q.cluster_id === "c1" && q.angle === "category")!;
  const full = fixtureFillSlot(placed, { clusterId: "c1", angle: "category", text: "A sixth angle prompt for c1", today: placed.today, role: "owner" });
  assert.equal(full.ok, false, "five angle prompts live: no slot, whatever the placement prompts");
  const stopped = fixtureStop(placed, { kind: "prompt", id: angle.id, today: placed.today, role: "owner", undo: false });
  assert.ok(stopped.ok);
  const filled = fixtureFillSlot(stopped.fixture, { clusterId: "c1", angle: "category", text: "Which accounting app do freelance writers use?", today: placed.today, role: "owner" });
  assert.equal(filled.ok, true, "four angle prompts and three placement prompts live: one slot free");
  const twin = fixtureFillSlot(stopped.fixture, { clusterId: "c1", angle: "category", text: "best accounting apps for small businesses", today: placed.today, role: "owner" });
  assert.equal(twin.ok, false, "a placement prompt's text is still a live prompt in the cluster");
});
