import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { code } from "../source-read.mts";
import {
  INVITES_PER_OWNER_PER_DAY,
  MEMBERS_PER_CLIENT,
  SCOPE_NOT_READY,
  TEAM_WHY,
  type TeamForm,
  type TeamRow,
  inviteChoice,
  inviteMail,
  inviteRefusal,
  inviteScope,
  onClient,
  planTeam,
  readEmail,
  readTeamForm,
  refuseActor,
  refuseChange,
  refuseEveryClient,
  refuseInvite,
  removeKind,
  removeLine,
  scopeLine,
  teamReturn,
  teamToast,
  teamWhy,
} from "./team.ts";

/** R142 part 2 (1 Oct 2026; BRIEF-4 P2 Team): the rules the member route runs before any write. */

const row = (email: string, role: string, removed = false): TeamRow => ({ email, role, removed_at: removed ? "2026-09-30T10:00:00Z" : null });
const team = [row("owner@tallyroo.com", "owner"), row("ed@tallyroo.com", "editor"), row("vi@tallyroo.com", "viewer"), row("gone@tallyroo.com", "editor", true)];

test("an email is trimmed, lowercased, format-checked and at most 254 characters", () => {
  assert.equal(readEmail("  New@Tallyroo.COM "), "new@tallyroo.com");
  assert.equal(readEmail("not-an-email"), null);
  assert.equal(readEmail("a@b"), null);
  assert.equal(readEmail(`${"a".repeat(250)}@example.com`), null);
  assert.equal(readEmail(42), null);
});

test("the form: invite and role need Editor or Viewer, never owner; remove needs none", () => {
  const f = (o: Record<string, string>) => readTeamForm((k) => o[k] ?? null);
  // AG-1 (9 Oct 2026): the form carries the invite's scope word, null when it sent none it knows.
  assert.deepEqual(f({ op: "invite", email: "x@tallyroo.com", role: "viewer" }), { op: "invite", email: "x@tallyroo.com", role: "viewer", scope: null });
  assert.deepEqual(f({ op: "invite", email: "x@tallyroo.com", role: "viewer", scope: "account" }), { op: "invite", email: "x@tallyroo.com", role: "viewer", scope: "account" });
  assert.equal(f({ op: "invite", email: "x@tallyroo.com", role: "viewer", scope: "everyone" })!.scope, null);
  assert.equal(f({ op: "invite", email: "x@tallyroo.com", role: "owner" }), null);
  assert.equal(f({ op: "role", email: "x@tallyroo.com" }), null);
  assert.deepEqual(f({ op: "remove", email: "x@tallyroo.com", role: "owner", scope: "account" }), { op: "remove", email: "x@tallyroo.com", role: null, scope: null });
  assert.equal(f({ op: "delete", email: "x@tallyroo.com" }), null);
});

test("owner only", () => {
  assert.equal(refuseActor("owner"), null);
  assert.ok(refuseActor("editor"));
  assert.ok(refuseActor("viewer"));
});

test("invite refuses a live member and lets a removed one back on the same row", () => {
  assert.ok(refuseInvite({ rows: team, email: "ed@tallyroo.com", invitesToday: 0 }));
  assert.equal(refuseInvite({ rows: team, email: "gone@tallyroo.com", invitesToday: 0 }), null);
  assert.equal(refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: 0 }), null);
});

// 10 live members an account until 9 Oct 2026 (AG-1): 10 who see a client, as onClient narrows the rows the route passes.
test("invite caps: 10 live members a client, 20 invites an owner a day", () => {
  const full = Array.from({ length: MEMBERS_PER_CLIENT }, (_, i) => row(`m${i}@tallyroo.com`, i ? "editor" : "owner"));
  assert.ok(refuseInvite({ rows: full, email: "new@tallyroo.com", invitesToday: 0 }));
  // Removed rows do not count toward the ten.
  assert.equal(refuseInvite({ rows: [...full.slice(1), row("x@tallyroo.com", "editor", true)], email: "new@tallyroo.com", invitesToday: 0 }), null);
  assert.ok(refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: INVITES_PER_OWNER_PER_DAY }));
  assert.equal(refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: INVITES_PER_OWNER_PER_DAY - 1 }), null);
});

test("no one changes or removes themselves, nor the last owner", () => {
  const actor = "owner@tallyroo.com";
  assert.ok(refuseChange({ rows: team, actor, email: actor, op: "remove", role: null }));
  assert.ok(refuseChange({ rows: team, actor: "o2@tallyroo.com", email: actor, op: "remove", role: null }));
  assert.ok(refuseChange({ rows: team, actor: "o2@tallyroo.com", email: actor, op: "role", role: "editor" }));
  const two = [...team, row("o2@tallyroo.com", "owner")];
  assert.equal(refuseChange({ rows: two, actor: "o2@tallyroo.com", email: actor, op: "remove", role: null }), null);
  assert.equal(refuseChange({ rows: team, actor, email: "ed@tallyroo.com", op: "role", role: "viewer" }), null);
  assert.ok(refuseChange({ rows: team, actor, email: "ed@tallyroo.com", op: "role", role: "editor" }), "already an editor");
  assert.ok(refuseChange({ rows: team, actor, email: "gone@tallyroo.com", op: "remove", role: null }), "a removed member is not on the team");
});

test("the return URL and toast carry fixed words and a checked email only", () => {
  assert.equal(teamReturn("tallyroo", "invited", "new@tallyroo.com"), `/app/tallyroo/settings?${new URLSearchParams({ team: "invited", who: "new@tallyroo.com" })}#set-team`);
  assert.equal(teamReturn("tallyroo", "refused", "new@tallyroo.com"), "/app/tallyroo/settings?team=refused#set-team");
  // DS40 (2 Oct 2026): a stated range comes back ahead of the toast; any other kept key does not.
  assert.equal(teamReturn("tallyroo", "refused", null, { from: "2026-09-20", to: "2026-09-26", compare: "none", filter: "named", q: "x" }), "/app/tallyroo/settings?from=2026-09-20&to=2026-09-26&compare=none&team=refused#set-team");
  assert.equal(teamToast("invited", "new@tallyroo.com", "viewer"), "Invited new@tallyroo.com.");
  assert.equal(teamToast("invited", "stranger@tallyroo.com", null), null, "R146: not on the team, so nobody was invited");
  assert.equal(teamToast("removed", "gone@tallyroo.com", null), "Removed gone@tallyroo.com.");
  assert.equal(teamToast("removed", "still@tallyroo.com", "editor"), null, "R146: still on the team, so nobody was removed");
  assert.equal(teamToast("role", "vi@tallyroo.com", "viewer"), "vi@tallyroo.com is now a viewer.");
  assert.equal(teamToast("invited", "<script>@x", null), null);
  assert.equal(teamToast("role", "vi@tallyroo.com", null), null, "not a member any more: no claim about their role");
  assert.equal(teamToast("anything", "vi@tallyroo.com", null), null);
});

test("R151 (3 Oct 2026): a refusal comes back as its code and says its reason, never the address", () => {
  // Every sentence a rule returns has a code, so no rule's refusal falls back to "Reload the page".
  const said = [
    refuseActor("viewer"),
    refuseInvite({ rows: team, email: "ed@tallyroo.com", invitesToday: 0 }),
    refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: INVITES_PER_OWNER_PER_DAY }),
    refuseChange({ rows: team, actor: "o2@tallyroo.com", email: "o2@tallyroo.com", op: "remove", role: null }),
    refuseChange({ rows: team, actor: "o2@tallyroo.com", email: "gone@tallyroo.com", op: "remove", role: null }),
    refuseChange({ rows: team, actor: "o2@tallyroo.com", email: "ed@tallyroo.com", op: "role", role: "editor" }),
  ];
  for (const s of said) assert.ok(s && teamWhy(s), `no code for: ${s}`);
  assert.equal(new Set(Object.values(TEAM_WHY)).size, Object.keys(TEAM_WHY).length, "each code says a different sentence");
  // The URL carries the code, not the email; an invite refusal opens the invite form, whose field autofocuses.
  assert.equal(teamReturn("tallyroo", "refused", "ed@tallyroo.com", {}, "already"), "/app/tallyroo/settings?team=refused&why=already", "no fragment: a target stops autofocus");
  assert.equal(teamReturn("tallyroo", "refused", "o2@tallyroo.com", {}, "self"), "/app/tallyroo/settings?team=refused&why=self#set-team");
  assert.equal(teamReturn("tallyroo", "invited", "new@tallyroo.com", {}, "already"), `/app/tallyroo/settings?${new URLSearchParams({ team: "invited", who: "new@tallyroo.com" })}#set-team`);
  // The invite form draws its own refusals; the toast draws the rest, and nothing for an invite one.
  assert.equal(inviteRefusal("refused", "already"), TEAM_WHY.already);
  assert.equal(teamToast("refused", null, null, "already"), null);
  assert.equal(inviteRefusal("refused", "self"), null);
  assert.equal(teamToast("refused", null, null, "self"), TEAM_WHY.self);
  assert.equal(inviteRefusal("invited", "already"), null, "only a refusal");
  // A made-up code reads as before.
  assert.equal(teamToast("refused", null, null, "<b>x</b>"), "That change did not go through. Reload the page and try again.");
  assert.equal(inviteRefusal("refused", "toString"), null, "own keys only");
});

test("the invite mail: the brief's words, no login token, and no nomada tier in agency mode", () => {
  const m = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "editor", agency: false });
  assert.equal(m.subject, "You've been added to the tallyroo.com dashboard");
  assert.match(m.text, /^owner@tallyroo\.com added you to the alwayscited dashboard for tallyroo\.com as an editor\. Sign in with this email address at dashboards\.alwayscited\.com\/login - we'll send you a link\./);
  assert.doesNotMatch(m.text, /token|https?:\/\//);
  const a = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true });
  assert.doesNotMatch(`${a.subject} ${a.text.replace("dashboards.alwayscited.com/login", "")}`, /always(cited|tracked|mentioned|everywhere)|nomada/i);
});

// ---- AG-1 (9 Oct 2026): per-client scope. The writers' order and fail-closed behaviour are in scope.test.mts. ----

// AG-1 review, 9 Oct 2026: a one-client account invited to every client, so the invitee saw any client the account gained later.
test("AG-1: every invite is to this client only unless the owner picks every client, which only an account with two or more offers", () => {
  assert.equal(inviteScope(null, 1, true), "client", "one client: limited, so a client added later is not shown to them");
  assert.equal(inviteScope("account", 1, true), "client", "the one-client form offers no every-client, so a post saying it is not taken");
  assert.equal(inviteScope("account", 2, true), "account");
  assert.equal(inviteScope("client", 2, true), "client");
  assert.equal(inviteScope(null, 2, true), "client", "no field: this client only");
  assert.equal(inviteScope("everyone", 3, true), "client", "a garbled field never shows more than meant");
  // Before 20261009010000: nothing can be limited. One client invites to every client, as every invite did before AG-1.
  assert.equal(inviteScope(null, 1, false), "account");
  assert.equal(inviteScope("account", 2, false), "account");
  assert.equal(inviteScope(null, 2, false), "client", "two or more and no word: this client, which planTeam then refuses");
});

test("AG-1: the invite form says who they will see - the choice on two or more, else one line; before the table, every client and a hidden field", () => {
  assert.deepEqual(inviteChoice(2, true, "tallyroo.com"), {
    ask: { only: "Only tallyroo.com", every: "Every client on this account (2 now, and any added later)" },
    line: null,
    hidden: null,
  });
  assert.deepEqual(inviteChoice(1, true, "tallyroo.com"), { ask: null, line: "They will see tallyroo.com only, not any client added to this account later.", hidden: null });
  assert.deepEqual(inviteChoice(2, false, "tallyroo.com"), { ask: null, line: "They will see all 2 clients on this account, and any added later.", hidden: "account" });
  assert.deepEqual(inviteChoice(1, false, "tallyroo.com"), { ask: null, line: "They will see tallyroo.com, and any client added to this account later.", hidden: "account" });
  // What the form says is what the route grants.
  for (const [n, scoping] of [[1, true], [2, true], [1, false], [2, false]] as const) {
    const c = inviteChoice(n, scoping, "tallyroo.com");
    const posted = c.ask ? "client" : c.hidden;
    assert.equal(inviteScope(posted, n, scoping), c.ask || /only/.test(c.line ?? "") ? "client" : "account", `${n} clients, scoping ${scoping}`);
  }
});

test("AG-1: the team on a client is who sees it; someone limited to another client is not 'already' here", () => {
  const scoped: TeamRow[] = [
    row("owner@agency.example", "owner"),
    { ...row("lead@client-a.example", "viewer"), clients: ["A"] },
    { ...row("books@client-b.example", "editor"), clients: ["B"] },
  ];
  assert.deepEqual(onClient(scoped, "A").map((r) => r.email), ["owner@agency.example", "lead@client-a.example"]);
  assert.deepEqual(onClient(scoped, "B").map((r) => r.email), ["owner@agency.example", "books@client-b.example"]);
  assert.ok(refuseInvite({ rows: onClient(scoped, "A"), email: "lead@client-a.example", invitesToday: 0 }), "already sees A");
  assert.equal(refuseInvite({ rows: onClient(scoped, "A"), email: "books@client-b.example", invitesToday: 0 }), null, "on the account for B only, so A can be added");
  assert.ok(refuseChange({ rows: onClient(scoped, "A"), actor: "owner@agency.example", email: "books@client-b.example", op: "remove", role: null }), "Remove on A cannot reach someone who does not see A");
  // The cap is per client: ten who see B do not fill A.
  const b = Array.from({ length: MEMBERS_PER_CLIENT }, (_, i) => ({ ...row(`b${i}@client-b.example`, "viewer"), clients: ["B"] }));
  assert.equal(refuseInvite({ rows: onClient([...scoped, ...b], "A"), email: "new@client-a.example", invitesToday: 0 }), null);
  assert.equal(refuseInvite({ rows: onClient([...scoped, ...b], "B"), email: "new@client-b.example", invitesToday: 0 }), TEAM_WHY.full);
});

test("AG-1: Remove takes the account from an account-wide member, one client from a member with several, and the member with their last", () => {
  assert.equal(removeKind(row("x@agency.example", "editor")), "account");
  assert.equal(removeKind({ ...row("x@agency.example", "editor"), clients: null }), "account");
  assert.equal(removeKind({ ...row("x@client.example", "viewer"), clients: ["A", "B"] }), "client");
  assert.equal(removeKind({ ...row("x@client.example", "viewer"), clients: ["A"] }), "last");
});

test("AG-1: Settings says who sees what only on an account with two or more clients, and Remove says what it takes", () => {
  assert.equal(scopeLine(null, 1, "tallyroo.com"), null);
  assert.equal(scopeLine(null, 3, "tallyroo.com"), "Sees all 3 clients on this account");
  assert.equal(scopeLine(1, 3, "tallyroo.com"), "Sees only tallyroo.com");
  assert.equal(scopeLine(2, 3, "tallyroo.com"), "Sees tallyroo.com and 1 other client");
  assert.equal(scopeLine(3, 4, "tallyroo.com"), "Sees tallyroo.com and 2 other clients");
  assert.equal(removeLine(null, 1, "tallyroo.com"), "They lose access to this dashboard at once.");
  assert.equal(removeLine(null, 2, "tallyroo.com"), "They lose access to both clients on this account at once.");
  assert.equal(removeLine(null, 3, "tallyroo.com"), "They lose access to all 3 clients on this account at once.");
  assert.equal(scopeLine(null, 2, "tallyroo.com"), "Sees both clients on this account");
  assert.equal(removeLine(1, 2, "tallyroo.com"), "They lose access to tallyroo.com at once.");
  assert.equal(removeLine(2, 3, "tallyroo.com"), "They lose access to tallyroo.com at once, and keep the 1 other client they see.");
});

test("AG-1: an invite to every client says so in the mail; an invite to one client reads as before", () => {
  const one = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true, everyClient: null });
  assert.deepEqual(one, inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true }));
  assert.doesNotMatch(one.text, /other client|more/, "names this client only");
  const every = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "editor", agency: false, everyClient: 3 });
  assert.equal(every.subject, "You've been added to the tallyroo.com dashboard and 2 more");
  assert.match(every.text, /^owner@tallyroo\.com added you to the alwayscited dashboard for tallyroo\.com and the 2 other clients on their account, as an editor\. Sign in with this email address at dashboards\.alwayscited\.com\/login - we'll send you a link\./);
  const agency = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true, everyClient: 2 });
  assert.match(agency.text, /for tallyroo\.com and the 1 other client on their account, as a viewer/);
  assert.doesNotMatch(`${agency.subject} ${agency.text.replace("dashboards.alwayscited.com/login", "")}`, /always(cited|tracked|mentioned|everywhere)|nomada/i);
});

// ---- AG-1 review (9 Oct 2026): planTeam is every rule the member route runs, and the route and the fixture both call it. ----

const A = "A";
const B = "B";
const agency: TeamRow[] = [
  { ...row("owner@agency.example", "owner"), id: "own", clients: null },
  { ...row("staff@agency.example", "editor"), id: "staff", clients: null },
  { ...row("lead@client-a.example", "viewer"), id: "lead", clients: [A] },
  { ...row("books@client-b.example", "editor"), id: "books", clients: [B] },
];
const form = (o: Partial<TeamForm>): TeamForm => ({ op: "invite", email: "new@client-a.example", role: "viewer", scope: null, ...o });
const plan = (f: TeamForm, over: Partial<Parameters<typeof planTeam>[0]> = {}) =>
  planTeam({ form: f, actor: "owner@agency.example", rows: agency, scoping: true, clientId: A, clientIds: [A, B], invitesToday: 0, ...over });

test("planTeam: Remove and a role change on A reach only who sees A - never someone limited to B, whom Remove would take off the account", () => {
  assert.equal(plan(form({ op: "remove", email: "books@client-b.example", role: null })), TEAM_WHY.gone);
  assert.equal(plan(form({ op: "role", email: "books@client-b.example", role: "viewer" })), TEAM_WHY.gone);
  assert.deepEqual(plan(form({ op: "remove", email: "lead@client-a.example", role: null })), { op: "remove", row: agency[2] });
  assert.deepEqual(plan(form({ op: "role", email: "staff@agency.example", role: "viewer" })), { op: "role", role: "viewer", row: agency[1] });
  assert.equal(plan(form({ op: "remove", email: "owner@agency.example", role: null })), TEAM_WHY.self);
  // From B, books@ is there to remove.
  assert.deepEqual(plan(form({ op: "remove", email: "books@client-b.example", role: null }), { clientId: B }), { op: "remove", row: agency[3] });
});

test("planTeam: an invite finds someone on the account for other clients on the whole team, and refuses who already sees this client", () => {
  assert.deepEqual(plan(form({ email: "books@client-b.example" })), { op: "invite", role: "viewer", scope: "client", elsewhere: agency[3] });
  assert.deepEqual(plan(form({})), { op: "invite", role: "viewer", scope: "client", elsewhere: null });
  assert.equal(plan(form({ email: "lead@client-a.example" })), TEAM_WHY.already);
  assert.equal(plan(form({ email: "staff@agency.example", scope: "account" })), TEAM_WHY.already);
  assert.equal(plan(form({}), { invitesToday: INVITES_PER_OWNER_PER_DAY }), TEAM_WHY.limit);
});

test("planTeam: one client on the account is this client only; before the table, one client is every client and two refuse anything else", () => {
  const solo = [agency[0]!];
  assert.deepEqual(plan(form({ scope: "account" }), { rows: solo, clientIds: [A] }), { op: "invite", role: "viewer", scope: "client", elsewhere: null });
  assert.deepEqual(plan(form({}), { rows: solo, clientIds: [A], scoping: false }), { op: "invite", role: "viewer", scope: "account", elsewhere: null });
  assert.equal(plan(form({}), { scoping: false }), SCOPE_NOT_READY, "nowhere to write one client yet");
  assert.deepEqual(plan(form({ scope: "account" }), { scoping: false }), { op: "invite", role: "viewer", scope: "account", elsewhere: null });
  // The posting client counts even if the account read missed it.
  assert.equal((plan(form({ scope: "account" }), { clientIds: [B] }) as { scope: string }).scope, "account");
});

test("planTeam: an invite to every client is held to the cap on every client, not only the one it was sent from", () => {
  // The review's case: Ledgerline (B) has ten who see it; an every-client invite from Tallyroo (A) made eleven.
  const tenOnB = Array.from({ length: MEMBERS_PER_CLIENT - 3 }, (_, i) => ({ ...row(`b${i}@client-b.example`, "viewer"), clients: [B] }));
  const rows = [...agency, ...tenOnB];
  assert.equal(onClient(rows, B).length, MEMBERS_PER_CLIENT, "B is full: owner, staff, books and seven more");
  assert.equal(plan(form({ email: "x@agency.example" }), { rows, clientId: B }), TEAM_WHY.full, "from B, refused");
  assert.equal(plan(form({ email: "x@agency.example", scope: "account" }), { rows }), TEAM_WHY.fullOther, "from A to every client, refused too");
  assert.equal(refuseEveryClient({ rows, email: "x@agency.example", clientIds: [A, B] }), TEAM_WHY.fullOther);
  assert.deepEqual(plan(form({ email: "x@agency.example" }), { rows }), { op: "invite", role: "viewer", scope: "client", elsewhere: null }, "to A only: B is not touched");
  // Someone already seeing B adds nobody to it: books@, limited to B, can be given every client from A.
  assert.equal((plan(form({ email: "books@client-b.example", scope: "account" }), { rows }) as { scope: string }).scope, "account");
  assert.equal(refuseEveryClient({ rows: [...rows.slice(0, -1), row("gone@client-b.example", "viewer", true)], email: "x@agency.example", clientIds: [A, B] }), null, "a removed row is not counted");
  assert.notEqual(TEAM_WHY.fullOther, TEAM_WHY.full);
  assert.equal(inviteRefusal("refused", "fullOther"), TEAM_WHY.fullOther, "said on the invite form");
});

test("the member route and the fixture run planTeam on the account's whole live team, and write only what it planned", () => {
  const route = code(readFileSync(new URL("../../app/api/app/[client]/member/route.ts", import.meta.url), "utf8"));
  assert.match(route, /const plan = planTeam\(\{ form: f, actor: email, rows: team\.rows, scoping: team\.scoping, clientId: client\.id, clientIds, invitesToday: n \}\);\s*if \(typeof plan === "string"\) return refused\(plan\);/);
  assert.match(route, /const clientIds = ids\.map\(\(c\) => c\.id as string\);/);
  assert.match(route, /\.from\("client_domains"\)\.select\("id"\)\.eq\("account_id", accountId\)\.not\("slug", "is", null\)/, "clientIds are the account's slugged clients");
  assert.match(route, /await invite\(db, \{ accountId, clientId: client\.id, email: f\.email, role: plan\.role, by: email, scope: plan\.scope, elsewhere: plan\.elsewhere \}\)/);
  assert.match(route, /await changeRole\(db, \{ accountId, email: f\.email, role: plan\.role \}\)/);
  assert.match(route, /await removeMember\(db, \{ accountId, email: f\.email, by: email, clientId: client\.id, row: plan\.row \}\)/);
  assert.match(route, /const everyClient = plan\.scope === "account" && clientIds\.length > 1 \? clientIds\.length : null;/);
  assert.doesNotMatch(route, /\b(onClient|inviteScope|refuseInvite|refuseChange|refuseEveryClient)\(/, "the route runs no rule beside planTeam, and never narrows the team itself");
  const fixture = code(readFileSync(new URL("./fixture-writes.ts", import.meta.url), "utf8"));
  assert.match(fixture, /const plan = planTeam\(\{\s*form: [^\n]+,\s*actor: f\.member\.email,\s*rows: all,\s*scoping: f\.scoping !== false,\s*clientId: client\.id,\s*clientIds: fixtureAccount\(f\)\.map\(\(c\) => c\.id\),/);
  assert.doesNotMatch(fixture, /\b(onClient|inviteScope|refuseInvite|refuseChange|refuseEveryClient)\(/);
});

test("census probe: the route pin fires on a narrowed team and on a rule run outside planTeam", () => {
  const pin = /const plan = planTeam\(\{ form: f, actor: email, rows: team\.rows,/;
  assert.doesNotMatch("const plan = planTeam({ form: f, actor: email, rows: onClient(team.rows, client.id),", pin);
  assert.match("const no = refuseChange({ rows: team.rows, actor: email });", /\b(onClient|inviteScope|refuseInvite|refuseChange|refuseEveryClient)\(/);
});
