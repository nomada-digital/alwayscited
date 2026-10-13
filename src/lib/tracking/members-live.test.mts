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
 *
 * Extended 13 Oct 2026 (dashboard speed work) to embedded reads. The shell
 * (shell.ts) and Settings' team (settings-data.ts) now read both tables
 * inside another table's select - `dashboard_member_clients(client_domain_id)`
 * - rather than with a `.from()` of their own. An embedded read is a read:
 * it must carry `.is("<its path>.removed_at", null)`, and it counts as the
 * file reading members, or reading their scope.
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

/** `path` is set on an embedded read: the dotted path PostgREST filters it by, e.g. `accounts.dashboard_members`. */
type Call = { file: string; table: string; chain: string; path?: string };

const TABLES = ["dashboard_members", "dashboard_member_clients"];

/** A chain from `.from(`, up to the end of its statement. */
const chainFrom = (text: string, at: number) => {
  const rest = text.slice(at);
  const end = rest.search(/;|\n\s*\n|,\n\s*db\.from\(/);
  return end < 0 ? rest : rest.slice(0, end);
};

/** A select argument as written: a string, or a constant of this file resolved, `${...}` and all, as far as this file holds them. */
function selectArg(text: string, chain: string): string | null {
  const m = chain.match(/\.select\(\s*(?:(["'`])([^"'`]*)\1|([A-Za-z_$][\w$]*)\s*[),])/);
  if (!m) return null;
  if (m[2] !== undefined) return m[2];
  const resolve = (name: string, depth: number): string | null => {
    const c = text.match(new RegExp(`const\\s+${name}\\s*(?::[^=]*)?=\\s*(["'\`])([^"'\`]*)\\1`));
    if (!c) return null;
    return depth > 4 ? c[2]! : c[2]!.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, inner: string) => resolve(inner, depth + 1) ?? all);
  };
  return resolve(m[3]!, 0);
}

/** Every embedded resource in a select list, with its path: an alias names it when there is one, a `!hint` never does. */
export function embedsIn(select: string, parent = ""): { table: string; path: string }[] {
  const out: { table: string; path: string }[] = [];
  let depth = 0;
  let item = "";
  const flush = () => {
    const m = item.trim().match(/^(?:([\w]+)\s*:\s*)?([\w]+)(?:![\w]+)?\s*\(([\s\S]*)\)$/);
    if (m) {
      const path = parent ? `${parent}.${m[1] ?? m[2]}` : (m[1] ?? m[2]!);
      out.push({ table: m[2]!, path }, ...embedsIn(m[3]!, path));
    }
    item = "";
  };
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) flush();
    else item += ch;
  }
  flush();
  return out;
}

/**
 * Each `.from("dashboard_members")` and `.from("dashboard_member_clients")` chain, up to the end of its statement;
 * and, since 13 Oct 2026, each read of either table embedded in another table's select, with its path.
 */
export function memberCalls(file: string, text: string): Call[] {
  const direct = [...text.matchAll(/\.from\("(dashboard_members|dashboard_member_clients)"\)/g)].map((m) => ({ file, table: m[1]!, chain: chainFrom(text, m.index) }));
  const embedded = [...text.matchAll(/\.from\("(\w+)"\)/g)].flatMap((m) => {
    const chain = chainFrom(text, m.index);
    const arg = selectArg(text, chain);
    return arg ? embedsIn(arg).filter((e) => TABLES.includes(e.table)).map((e) => ({ file, table: e.table, chain, path: e.path })) : [];
  });
  return [...direct, ...embedded];
}

/** Why a call breaks the rule, or null when it keeps it. An embedded read must filter its own path. */
export function breaks(c: Pick<Call, "chain" | "path">): string | null {
  if (c.path) return c.chain.includes(`.is("${c.path}.removed_at", null)`) ? null : `embeds ${c.path} without .is("${c.path}.removed_at", null)`;
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
 *
 * Moved 13 Oct 2026 (dashboard speed work) to what the walk finds, 19 and 17,
 * and 7 and 6 for the scope table, now that embedded reads count: clientsFor's
 * read is shell.ts's, made with the payment columns and once more without
 * them when that fails (two calls, each embedding the scope: two scope reads),
 * and Settings' team read is one read of the client row that embeds its
 * account's members and their scope (one members read, one scope read), where
 * it was a .from() of each.
 */
const CALL_FLOOR = 19;
const FILTERED_FLOOR = 17;
const SCOPE_CALL_FLOOR = 7;
const SCOPE_FILTERED_FLOOR = 6;

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
  // 13 Oct 2026 (dashboard speed work): clientsFor's read moved to shell.ts, embedding the scope rather than reading it.
  "src/lib/tracking/shell.ts": "readShell, behind member.ts clientsFor: every /app page's and route's client list, the switcher and the 404.",
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
    // 13 Oct 2026: the scope read through readScopes, or embedded in the members read itself (removed_at held above).
    assert.ok(/\breadScopes\(/.test(src) || SCOPES.some((c) => c.file === file && c.path), `${file} reads members and no longer reads their scope`);
    assert.match(src, /\b(sees|visibleClients)\(/, `${file} reads the scope and no longer applies it`);
  }
  for (const [file, { reads: n, why }] of Object.entries(NO_SCOPE)) {
    assert.ok(why.length > 40, `${file} needs a reason`);
    assert.equal(reads.get(file), n, `${file}: a read was added or went; record why it need not apply the scope`);
  }
});

test("clientsFor applies the scope, on Supabase and on the fixture", () => {
  // 13 Oct 2026 (dashboard speed work): clientsFor is shell.ts readShell, held for the request; the scope comes
  // embedded in the members read (SHELL_READ) and is applied by visibleClients as before. shell.test.mts runs it.
  const member = code(readFileSync(join(ROOT, "src/lib/tracking/member.ts"), "utf8"));
  assert.match(member, /export const clientsFor = cache\(\(email: string\) => readShell\(supabaseAdmin\(\), email\)\);/, "clientsFor is no longer shell.ts's read");
  const shell = code(readFileSync(join(ROOT, "src/lib/tracking/shell.ts"), "utf8"));
  const body = shell.slice(shell.indexOf("export async function readShell"));
  assert.ok(body.length > 200, "readShell is gone from shell.ts");
  const at = (s: string) => body.indexOf(s);
  assert.match(shell, /export const SHELL_READ = `id, account_id, role, dashboard_member_clients\(client_domain_id\), /, "the members read no longer embeds their scope");
  assert.match(shell, /export const SHELL_READ_UNPAID = `id, account_id, role, dashboard_member_clients\(client_domain_id\), /, "the read without payment columns no longer embeds the scope");
  assert.ok(at('.from("dashboard_members").select(SHELL_READ)') >= 0 && at("const scopes = scopesFrom(") > at('.from("dashboard_members").select(SHELL_READ)'), "readShell reads the members' scope");
  // 9 Oct 2026 (merge of wave 2 packages 2 and 3): the scoped list is held in `clients` and returned through
  // BL-2's payment columns, which only add the banner's columns to the clients visibleClients let through.
  assert.ok(at("const clients = visibleClients(mine, scopes, rows)") > at("const scopes = scopesFrom("), "readShell keeps only what visibleClients lets through");
  assert.ok(at("return withPayment(clients,") > at("const clients = visibleClients(mine, scopes, rows)"), "readShell returns the scoped list, with payment state added and nothing else");
  const repo = code(readFileSync(join(ROOT, "src/lib/tracking/repo.ts"), "utf8"));
  assert.match(repo, /async clientsFor\(email\) \{\s*return fixtureClients\(fixture\(\), email\);/, "the fixture's clientsFor applies the scope");
});

test("owners are never limited: invites make editors and viewers only, and the admin clears an owner's scope", () => {
  const team = code(readFileSync(join(ROOT, "src/lib/tracking/team.ts"), "utf8"));
  assert.match(team, /readRole = \(raw: unknown\): InviteRole \| null => \(raw === "editor" \|\| raw === "viewer" \? raw : null\)/);
  const actions = code(readFileSync(join(ROOT, "src/app/admin/tracking/actions.ts"), "utf8"));
  assert.match(actions, /if \(role === "owner"\) \{\s*const e = await clearScope\(db, \{ memberId: added\.id as string, by: "nomada" \}\);/, "setMember no longer clears the scope of an owner it makes");
});

// 13 Oct 2026 (dashboard speed work): an embedded read is held to its own path's removed_at, at any depth.
test("census probe: an embedded read without its own removed_at filter fires, at any depth; with it, it passes", () => {
  const SEL = "brand_aliases, accounts!client_domains_account_id_fkey(dashboard_members(id, dashboard_member_clients(client_domain_id)))";
  const calls = (chain: string) => memberCalls("probe.ts", `const SEL = "${SEL}";\nconst { data } = await db.from("client_domains").select(SEL)${chain};`).filter((c) => c.path);
  assert.deepEqual(calls("").map((c) => c.path), ["accounts.dashboard_members", "accounts.dashboard_members.dashboard_member_clients"], "the embedded paths, the hint left out");
  assert.ok(calls("").every((c) => breaks(c)), "an unfiltered embed fires");
  assert.ok(breaks(calls('.is("accounts.dashboard_members.removed_at", null)')[1]!), "the scope's own filter is still missing");
  assert.ok(calls('.is("accounts.dashboard_members.removed_at", null).is("accounts.dashboard_members.dashboard_member_clients.removed_at", null)').every((c) => !breaks(c)));
  assert.ok(breaks(calls('.is("removed_at", null)')[0]!), "the top-level filter is not the embed's");
  const inline = memberCalls("probe.ts", 'const r = await db.from("dashboard_members").select("id, scope:dashboard_member_clients(client_domain_id)").is("removed_at", null);').filter((c) => c.path);
  assert.deepEqual(inline.map((c) => [c.path, Boolean(breaks(c))]), [["scope", true]], "an alias names the path, and an inline select is read too");
});

test("census probe: a new membership read with no scope fires; a comment is not the scope; a write is not a read", () => {
  const probe = memberCalls("src/app/api/app/new/route.ts", `const { data } = await db.from("dashboard_members").select("account_id").eq("email", e).is("removed_at", null);`);
  assert.equal(probe.filter(isRead).length, 1, "the probe is a read");
  assert.ok(!(probe[0]!.file in APPLIES_SCOPE) && !(probe[0]!.file in NO_SCOPE), "an unlisted file is on neither list, so the census names it");
  assert.doesNotMatch(code(`// readScopes(db, ids) used to be here\nconst x = 1;`), /\breadScopes\(/, "a comment does not count as applying the scope");
  const write = memberCalls("probe.ts", `const { data, error } = await db.from("dashboard_members").upsert({ email }, { onConflict: "account_id,email" }).select("id").single();`);
  assert.equal(write.filter(isRead).length, 0, "a write handing back its row is not a read");
});
