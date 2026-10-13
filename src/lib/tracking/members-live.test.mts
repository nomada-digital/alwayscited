/**
 * Live-member census (R141, Danny, 30 Sep 2026, danny.md 134-136; BRIEF-4 P0).
 *
 * Removing a member never deletes the row: it sets `removed_at`. So every
 * read of `dashboard_members` - the page 404, API role checks, `clientsFor`,
 * the login link, the admin list - and every update must carry
 * `.is("removed_at", null)`, or a removed member keeps their access. A
 * `.delete()` on the table is refused outright. Upserts are writes that make
 * or revive a member and need no filter.
 *
 * Extended 9 Oct 2026 (AG-1, audit security-2, launch blocker LB2) to the
 * member's client scope, `dashboard_member_clients` (scope.ts):
 *
 * - the same removed_at rule on that table - a removed scope row still
 *   limiting, or still granting, is the same defect;
 * - every read of dashboard_members that decides who sees a client applies
 *   the scope, and every other read is recorded here with why it need not.
 *   A read that skips the scope shows a member limited to one client every
 *   client on the account, which is the defect the table exists to end.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { code } from "../source-read.mts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

type Call = { file: string; table: string; chain: string };

/** Each `.from("dashboard_members")` and `.from("dashboard_member_clients")` chain, up to the end of its statement. */
export function memberCalls(file: string, text: string): Call[] {
  return [...text.matchAll(/\.from\("(dashboard_members|dashboard_member_clients)"\)/g)].map((m) => {
    const rest = text.slice(m.index);
    const end = rest.search(/;|\n\s*\n|,\n\s*db\.from\(/);
    return { file, table: m[1]!, chain: end < 0 ? rest : rest.slice(0, end) };
  });
}

/** Why a call breaks the rule, or null when it keeps it. */
export function breaks(c: Pick<Call, "chain">): string | null {
  if (/\.delete\(/.test(c.chain)) return "deletes a member row - mark removed_at instead";
  if (/\.upsert\(/.test(c.chain)) return null;
  if (/\.(select|update)\(/.test(c.chain) && !/\.is\("removed_at", null\)/.test(c.chain)) return "reads or updates without .is(\"removed_at\", null)";
  return null;
}

const SOURCES = walk(join(ROOT, "src")).filter((f) => /\.tsx?$/.test(f) && !/\.test\.m?ts$/.test(f));
const CALLS = SOURCES.flatMap((f) => memberCalls(relative(ROOT, f), readFileSync(f, "utf8")));
const MEMBERS = CALLS.filter((c) => c.table === "dashboard_members");
const SCOPES = CALLS.filter((c) => c.table === "dashboard_member_clients");

/**
 * Floor, 1 Oct 2026: 7 calls - clientsFor, the login route's read, the auth
 * route's last_login_at, the admin list, admin remove and add, the checkout
 * signup's owner upsert. 5 of them reads or updates. 11 and 8 later the same
 * day (R142 part 2): team.ts's live-team read, role change and remove, and the
 * invite's upsert that revives a removed row.
 *
 * Moved 9 Oct 2026 (AG-1) to what the walk finds, 16 and 14: since the floor
 * was set, the runner's first_reading and lifecycle-sweep's two owner reads
 * (1 and 8 Oct), the admin create's owner upsert and Settings' team read were
 * already there unfloored; and two upserts now hand back their row's id with
 * .select (team.ts writeMember, the admin's setMember add), which the filter
 * below counts. The scope table's own: 4 calls - readScopes, addScope,
 * dropScope, clearScope - 3 of them reads or updates.
 *
 * Moved 9 Oct 2026 (AG-1 review) to 17 and 15: an invite to someone already
 * on the account for other clients sets their role with an update that
 * requires removed_at is null (team.ts keepRow), where it used to revive the
 * row with writeMember's upsert.
 */
const CALL_FLOOR = 17;
const FILTERED_FLOOR = 15;
const SCOPE_CALL_FLOOR = 4;
const SCOPE_FILTERED_FLOOR = 3;

test("census floor: the walk still finds the dashboard_members and dashboard_member_clients calls", () => {
  assert.ok(MEMBERS.length >= CALL_FLOOR, `${MEMBERS.length} dashboard_members calls, floor ${CALL_FLOOR}`);
  const filtered = MEMBERS.filter((c) => /\.(select|update)\(/.test(c.chain));
  assert.ok(filtered.length >= FILTERED_FLOOR, `${filtered.length} reads/updates, floor ${FILTERED_FLOOR}`);
  assert.ok(SCOPES.length >= SCOPE_CALL_FLOOR, `${SCOPES.length} dashboard_member_clients calls, floor ${SCOPE_CALL_FLOOR}`);
  const scoped = SCOPES.filter((c) => /\.(select|update)\(/.test(c.chain));
  assert.ok(scoped.length >= SCOPE_FILTERED_FLOOR, `${scoped.length} scope reads/updates, floor ${SCOPE_FILTERED_FLOOR}`);
});

test("every read and update of dashboard_members and dashboard_member_clients skips removed rows, and none deletes", () => {
  const bad = CALLS.map((c) => [c, breaks(c)] as const)
    .filter(([, why]) => why)
    .map(([c, why]) => `${c.file} (${c.table}): ${why}`);
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("the sign-in sets last_login_at", () => {
  const auth = MEMBERS.filter((c) => c.file.endsWith(join("api", "app", "auth", "route.ts")));
  assert.ok(auth.some((c) => /last_login_at/.test(c.chain)), "the auth route no longer records the sign-in");
});

test("census probe: an unfiltered read, an unfiltered update and a delete each fire, on either table", () => {
  const probe = (s: string) => breaks(memberCalls("probe.ts", s)[0]!);
  for (const t of ["dashboard_members", "dashboard_member_clients"]) {
    assert.ok(probe(`db.from("${t}").select("account_id, role").eq("email", email);`), t);
    assert.ok(probe(`db.from("${t}").update({ role }).eq("email", email);`), t);
    assert.ok(probe(`db.from("${t}").delete().eq("email", email);`), t);
    assert.equal(probe(`db.from("${t}").select("email").eq("email", email).is("removed_at", null);`), null, t);
  }
  assert.equal(probe(`db.from("dashboard_members").upsert({ email }, { onConflict: "account_id,email" });`), null);
  assert.equal(probe(`db.from("dashboard_member_clients").upsert({ member_id }, { onConflict: "member_id,client_domain_id" });`), null);
});

// ---- AG-1 (9 Oct 2026): every membership read applies the client scope, or says why it need not. ----

/** A read of dashboard_members: a select that is not a write handing back its row. */
const isRead = (c: Call) => c.table === "dashboard_members" && /\.select\(/.test(c.chain) && !/\.(update|upsert|insert)\(/.test(c.chain);

/**
 * The files whose dashboard_members reads decide who sees which client, and
 * so read the scope (readScopes) and apply it (sees or visibleClients) to what
 * they return. Each with what it answers.
 */
const APPLIES_SCOPE: Record<string, string> = {
  "src/lib/tracking/member.ts": "clientsFor: every /app page's and route's client list, the switcher and the 404.",
  "src/lib/tracking/settings-data.ts": "Settings' team list on one client.",
  "src/lib/tracking/team.ts": "readTeam: the member route's team, which onClient narrows to the client posted from.",
  "src/app/admin/tracking/page.tsx": "/admin/tracking's member line under each client.",
  // 13 Oct 2026, DIY P9 (spec 10 section 7.10): the Monday This week email goes to owners and editors, and an editor
  // limited to other clients must not be mailed this one's actions.
  "src/lib/email/week-recipients.ts": "weekRecipients: the This week email's owners and editors who can see the client.",
};

/**
 * The reads that do not apply the scope, each with why it need not, and how
 * many reads the file holds, so a second read in the same file is a question.
 */
const NO_SCOPE: Record<string, { reads: number; why: string }> = {
  "src/app/api/app/login/route.ts": {
    reads: 1,
    why:
      "asks only whether the address is a live member anywhere, to send a sign-in link; what they then see is clientsFor's. " +
      "A live member always sees at least one client: removing a member's last client removes the member (team.ts removeMember).",
  },
  "src/lib/tracking/runner.ts": {
    reads: 1,
    why: "first_reading mails the account's owners, and an owner is never limited: invites make only editors and viewers, and setMember clears the scope of anyone it makes an owner.",
  },
  "src/lib/email/lifecycle-sweep.ts": {
    reads: 2,
    why: "deliver and planEndedOwners mail the account's owners, never limited for the same reason as the runner's.",
  },
};

test("every read of dashboard_members applies the client scope, or is recorded with why it need not", () => {
  const reads = new Map<string, number>();
  for (const c of MEMBERS.filter(isRead)) reads.set(c.file, (reads.get(c.file) ?? 0) + 1);
  assert.deepEqual(
    [...reads.keys()].sort(),
    [...Object.keys(APPLIES_SCOPE), ...Object.keys(NO_SCOPE)].sort(),
    "a file reads dashboard_members and is on neither list. If what it reads decides who sees a client, apply the scope (scope.ts readScopes, then sees); otherwise record why it need not.",
  );
  for (const file of Object.keys(APPLIES_SCOPE)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    assert.match(src, /\breadScopes\(/, `${file} reads members and no longer reads their scope`);
    assert.match(src, /\b(sees|visibleClients)\(/, `${file} reads the scope and no longer applies it`);
  }
  for (const [file, { reads: n, why }] of Object.entries(NO_SCOPE)) {
    assert.ok(why.length > 40, `${file} needs a reason`);
    assert.equal(reads.get(file), n, `${file}: a read was added or went; record why it need not apply the scope`);
  }
});

test("clientsFor applies the scope, on Supabase and on the fixture", () => {
  const member = code(readFileSync(join(ROOT, "src/lib/tracking/member.ts"), "utf8"));
  const body = member.slice(member.indexOf("export async function clientsFor"), member.indexOf("export function writeRole"));
  assert.ok(body.length > 200, "clientsFor is gone from member.ts");
  const at = (s: string) => body.indexOf(s);
  assert.ok(at('.from("dashboard_members")') >= 0 && at("readScopes(db, mine.map((m) => m.id))") > at('.from("dashboard_members")'), "clientsFor reads the members' scope");
  // 9 Oct 2026 (merge of wave 2 packages 2 and 3): the scoped list is held in `clients` and returned through
  // BL-2's payment read, which only adds the banner's columns to the clients visibleClients let through.
  assert.ok(at("const clients = visibleClients(mine, scopes.of,") > at("readScopes("), "clientsFor keeps only what visibleClients lets through");
  assert.ok(at("return withPayment(clients,") > at("const clients = visibleClients(mine, scopes.of,"), "clientsFor returns the scoped list, with payment state added and nothing else");
  const repo = code(readFileSync(join(ROOT, "src/lib/tracking/repo.ts"), "utf8"));
  assert.match(repo, /async clientsFor\(email\) \{\s*return fixtureClients\(fixture\(\), email\);/, "the fixture's clientsFor applies the scope");
});

test("owners are never limited: invites make editors and viewers only, and the admin clears an owner's scope", () => {
  const team = code(readFileSync(join(ROOT, "src/lib/tracking/team.ts"), "utf8"));
  assert.match(team, /readRole = \(raw: unknown\): InviteRole \| null => \(raw === "editor" \|\| raw === "viewer" \? raw : null\)/);
  const actions = code(readFileSync(join(ROOT, "src/app/admin/tracking/actions.ts"), "utf8"));
  assert.match(actions, /if \(role === "owner"\) \{\s*const e = await clearScope\(db, \{ memberId: added\.id as string, by: "nomada" \}\);/, "setMember no longer clears the scope of an owner it makes");
});

test("census probe: a new membership read with no scope fires; a comment is not the scope; a write is not a read", () => {
  const probe = memberCalls("src/app/api/app/new/route.ts", `const { data } = await db.from("dashboard_members").select("account_id").eq("email", e).is("removed_at", null);`);
  assert.equal(probe.filter(isRead).length, 1, "the probe is a read");
  assert.ok(!(probe[0]!.file in APPLIES_SCOPE) && !(probe[0]!.file in NO_SCOPE), "an unlisted file is on neither list, so the census names it");
  assert.doesNotMatch(code(`// readScopes(db, ids) used to be here\nconst x = 1;`), /\breadScopes\(/, "a comment does not count as applying the scope");
  const write = memberCalls("probe.ts", `const { data, error } = await db.from("dashboard_members").upsert({ email }, { onConflict: "account_id,email" }).select("id").single();`);
  assert.equal(write.filter(isRead).length, 0, "a write handing back its row is not a read");
});
