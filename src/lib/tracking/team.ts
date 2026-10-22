import type { SupabaseClient } from "@supabase/supabase-js";

import { APP_LIMITS } from "../../config/contact.ts";
import { isPlausibleEmail, normalizeEmail } from "../email-address.ts";
import { appPath } from "../app-host.ts";
import { dashLink } from "../dash/host.ts";
import { count } from "../plural.ts";
import { type ClientScope, type InviteScope, addScope, clearScope, dropScope, readScopes, sees } from "./scope.ts";

/**
 * Team on Settings - R142 part 2 (1 Oct 2026; BRIEF-4 P2 "2. Team"). Owners
 * invite, change a role and remove; editors and viewers only read the list.
 *
 * Removing never deletes: it sets `removed_at` and `removed_by`, and every
 * membership read requires `removed_at is null`, so the removed email's next
 * request 404s. A removed member is re-invited on the same row by clearing
 * `removed_at` (`unique (account_id, email)` holds). Owners are made in
 * /admin/tracking only; no one changes or removes themselves, and the last
 * owner can be neither demoted nor removed.
 *
 * Caps: 10 live members who see a client, 20 invites per owner per day,
 * counted off `dashboard_events` rows with event `member_invite`.
 *
 * Per-client scope (AG-1, audit security-2; 9 Oct 2026, scope.ts): Settings
 * lists, counts and changes only the members who see the client it is on.
 * Every invite is to this client only unless the owner picks every client,
 * which the form offers on an account with two or more; a member limited to
 * some clients loses only this one on Remove, and the member goes when it was
 * their last. A member keeps one role on the account, so an invite or a role
 * change on one client sets the role they have on all of theirs.
 *
 * Pure rules first so the tests run each one - planTeam is all of them, in
 * the member route's order - and the writers are the network half.
 */

/** Where an invited member signs in, printed in the invite email (M1, 5 Oct 2026). */
const DASHBOARD_SIGN_IN = dashLink("/login").replace(/^https?:\/\//, "");   // the dashboards host (22 Oct 2026)

/** Live members who see one client (AG-1, 9 Oct 2026: was 10 an account, MEMBERS_PER_ACCOUNT). */
export const MEMBERS_PER_CLIENT = 10;
export const INVITES_PER_OWNER_PER_DAY = 20;
export const EMAIL_MAX = APP_LIMITS.email;
export const INVITE_EVENT = "member_invite";

export type TeamOp = "invite" | "role" | "remove";
export type InviteRole = "editor" | "viewer";
/**
 * A member as the rules read them. `id` is the dashboard_members row, read by
 * readTeam and absent from rows a test builds. `clients` is their scope
 * (scope.ts): absent or null is every client on the account.
 */
export type TeamRow = { email: string; role: string; removed_at: string | null; id?: string; clients?: ClientScope };

/** Trimmed, lowercased and format-checked by the site's one shape check, or null. */
export function readEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = normalizeEmail(raw);
  return e.length <= EMAIL_MAX && isPlausibleEmail(e) ? e : null;
}

export const readRole = (raw: unknown): InviteRole | null => (raw === "editor" || raw === "viewer" ? raw : null);

/** An invite's posted scope word, or null when the form sent none it knows (inviteScope decides then). */
export const readScopeWord = (raw: unknown): InviteScope | null => (raw === "client" || raw === "account" ? raw : null);

export type TeamForm = { op: TeamOp; email: string; role: InviteRole | null; scope: InviteScope | null };

/** The posted form, or null if it is not a change this page makes. */
export function readTeamForm(get: (k: string) => unknown): TeamForm | null {
  const op = get("op");
  if (op !== "invite" && op !== "role" && op !== "remove") return null;
  const email = readEmail(get("email"));
  if (!email) return null;
  const role = readRole(get("role"));
  if (op !== "remove" && !role) return null;
  return { op, email, role: op === "remove" ? null : role, scope: op === "invite" ? readScopeWord(get("scope")) : null };
}

/**
 * What an invite grants (AG-1, 9 Oct 2026).
 *
 * Once dashboard_member_clients is there, an invite is to this client only
 * unless the owner picked every client, and anything but an explicit
 * "account" - a missing or garbled field included - is this client only, so
 * a bad post never shows someone more than was meant. The form offers every
 * client only on an account with two or more; a one-client account's invite
 * is this client whatever the post says. Review, 9 Oct 2026: it was every
 * client, which read as "nothing else to show" but showed the invitee any
 * client the account gained later - a second checkout with the same email
 * lands on the same account (signup.ts) - which is the LB2 leak again.
 *
 * Before the table is there nothing can be limited: a one-client account
 * invites to every client, as every invite did before AG-1; an account with
 * two or more invites to every client only when the form says so, and
 * planTeam refuses anything else (SCOPE_NOT_READY).
 */
export function inviteScope(raw: unknown, accountClients: number, scoping: boolean): InviteScope {
  if (accountClients < 2) return scoping ? "client" : "account";
  return raw === "account" ? "account" : "client";
}

/** Why an invite to one client is refused before 20261009010000 is applied; the route logs it and the page says "Reload". */
export const SCOPE_NOT_READY = "an invite to one client needs dashboard_member_clients, which is not there yet";

/** The live rows that see this client: everyone Settings on it lists, counts and may change. */
export function onClient<T extends { clients?: ClientScope }>(rows: readonly T[], clientId: string): T[] {
  return rows.filter((r) => sees(r.clients, clientId));
}

/**
 * What Remove on this client's Settings takes away (AG-1). A member who sees
 * every client leaves the account. A member limited to this client and others
 * loses this one. A member limited to this client only leaves the account:
 * dropping their last client would leave them seeing every one.
 */
export type RemoveKind = "account" | "client" | "last";
export function removeKind(row: TeamRow): RemoveKind {
  if (!row.clients) return "account";
  return row.clients.length > 1 ? "client" : "last";
}

const live = (rows: TeamRow[]) => rows.filter((r) => r.removed_at === null);

/**
 * Every refusal's words, once, by a code the route carries back in the URL
 * (R151, 3 Oct 2026): a refused change used to come back as "Reload the page
 * and try again" whatever the reason, so an owner inviting someone already on
 * the team, or over the cap, was told to retry something that cannot work (NN/g
 * heuristic 9). Only the code travels; the page draws these fixed words.
 */
export const TEAM_WHY = {
  actor: "Only owners can change the team.",
  email: "That email address does not look right. Type it in full, like name@example.com.",
  already: "They are already on the team.",
  full: `A dashboard has at most ${MEMBERS_PER_CLIENT} members. Remove someone to make room.`,
  // AG-1 review (9 Oct 2026): an invite to every client is counted on each client it adds them to.
  fullOther: `Another client on this account has ${MEMBERS_PER_CLIENT} members already. Invite them to this client only, or remove someone there.`,
  limit: "That is today's invite limit. Try again tomorrow.",
  self: "You cannot change or remove yourself.",
  gone: "They are not on the team.",
  owner: "A dashboard needs at least one owner.",
  editor: "They are already an editor.",
  viewer: "They are already a viewer.",
} as const;
export type TeamWhy = keyof typeof TEAM_WHY;

/** The refusals the invite form answers on its own field rather than in the page's toast. */
export const INVITE_WHYS: readonly TeamWhy[] = ["email", "already", "full", "fullOther", "limit"];

/** A code from the URL, or the code of one of TEAM_WHY's sentences; anything else is null. */
export function teamWhy(raw: unknown): TeamWhy | null {
  if (typeof raw !== "string") return null;
  if (Object.hasOwn(TEAM_WHY, raw)) return raw as TeamWhy;
  const hit = Object.entries(TEAM_WHY).find(([, words]) => words === raw);
  return hit ? (hit[0] as TeamWhy) : null;
}

/** Only an owner changes the team. */
export const refuseActor = (role: string): string | null => (role === "owner" ? null : TEAM_WHY.actor);

/** `rows` are the members who see this client (onClient, in planTeam): one limited to other clients is not "already" here. */
export function refuseInvite(p: { rows: TeamRow[]; email: string; invitesToday: number }): string | null {
  const row = p.rows.find((r) => r.email === p.email);
  if (row && row.removed_at === null) return TEAM_WHY.already;
  if (live(p.rows).length >= MEMBERS_PER_CLIENT) return TEAM_WHY.full;
  if (p.invitesToday >= INVITES_PER_OWNER_PER_DAY) return TEAM_WHY.limit;
  return null;
}

/**
 * An invite to every client puts them on each client of the account, so each
 * is held to MEMBERS_PER_CLIENT, not only the one whose Settings posted (AG-1
 * review, 9 Oct 2026: ten on Ledgerline, and an every-client invite from
 * Tallyroo made eleven). A client they already see gains no one. `rows` is
 * the whole live team, not one client's.
 */
export function refuseEveryClient(p: { rows: TeamRow[]; email: string; clientIds: readonly string[] }): string | null {
  const full = p.clientIds.some((id) => {
    const there = onClient(live(p.rows), id);
    return !there.some((r) => r.email === p.email) && there.length >= MEMBERS_PER_CLIENT;
  });
  return full ? TEAM_WHY.fullOther : null;
}

/** A change to someone else's live row; never your own, never the last owner. */
export function refuseChange(p: { rows: TeamRow[]; actor: string; email: string; op: "role" | "remove"; role: InviteRole | null }): string | null {
  if (p.email === p.actor) return TEAM_WHY.self;
  const row = live(p.rows).find((r) => r.email === p.email);
  if (!row) return TEAM_WHY.gone;
  if (row.role === "owner" && live(p.rows).filter((r) => r.role === "owner").length <= 1) return TEAM_WHY.owner;
  if (p.op === "role" && row.role === p.role) return p.role === "editor" ? TEAM_WHY.editor : TEAM_WHY.viewer;
  return null;
}

/** What the member route writes once every rule has passed: planTeam's answer. */
export type TeamPlan =
  | { op: "invite"; role: InviteRole; scope: InviteScope; elsewhere: TeamRow | null }
  | { op: "role"; role: InviteRole; row: TeamRow }
  | { op: "remove"; row: TeamRow };

/**
 * Every rule the member route runs before a write, in its order, and what to
 * write; a refusal's words otherwise (AG-1 review, 9 Oct 2026). The route
 * and the fixture (fixture-writes.ts fixtureTeam) both call it, so the
 * fixture's e2e runs the route's rules, and no caller narrows the team for a
 * rule: `rows` is the account's whole live team (readTeam).
 *
 * - The team on this client is who sees it (onClient). Remove and a role
 *   change reach only them; "already" and the cap are counted on them.
 * - The invite's scope is inviteScope's; before the scope table is there an
 *   invite to one client is refused.
 * - An invite to every client is held to the cap on each client too.
 * - Someone live on the account for other clients only is `elsewhere`, found
 *   on the whole team: invite keeps their row and adds this client to it.
 */
export function planTeam(p: { form: TeamForm; actor: string; rows: TeamRow[]; scoping: boolean; clientId: string; clientIds: readonly string[]; invitesToday: number }): TeamPlan | string {
  const team = live(p.rows);
  const here = onClient(team, p.clientId);
  const { op, email, role } = p.form;
  if (op === "invite") {
    if (!role) return "Pick a role.";
    const ids = [...new Set([p.clientId, ...p.clientIds])];
    const scope = inviteScope(p.form.scope, ids.length, p.scoping);
    if (scope === "client" && !p.scoping) return SCOPE_NOT_READY;
    const no = refuseInvite({ rows: here, email, invitesToday: p.invitesToday });
    if (no) return no;
    const full = scope === "account" ? refuseEveryClient({ rows: team, email, clientIds: ids }) : null;
    if (full) return full;
    return { op, role, scope, elsewhere: team.find((r) => r.email === email) ?? null };
  }
  const no = refuseChange({ rows: here, actor: p.actor, email, op, role });
  if (no) return no;
  const row = here.find((r) => r.email === email)!;
  if (op === "remove") return { op, row };
  return role ? { op, role, row } : "Pick a role.";
}

// ---- Where the route sends the browser back to, and the toast the page draws. ----

export type TeamDone = "invited" | "removed" | "role" | "refused";

/**
 * The same return on the dashboards host (18 Oct 2026 brief 2d): Settings is `${base}/<slug>/settings` there,
 * `base` being dash/host.ts dashBase ("" on its own host, "/dashboards" on the main one). Same query, same rules.
 */
export function dashTeamReturn(base: string, slug: string, done: TeamDone, email: string | null, why: TeamWhy | null = null): string {
  const q = new URLSearchParams({ team: done, ...(email && done !== "refused" ? { who: email } : {}), ...(done === "refused" && why ? { why } : {}) });
  const at = done === "refused" && why && INVITE_WHYS.includes(why) ? "" : "#members";
  return `${base}/${encodeURIComponent(slug)}/settings?${q}${at}`;
}

export function teamReturn(slug: string, done: TeamDone, email: string | null, keep: Record<string, string> = {}, why: TeamWhy | null = null): string {
  // DS40 (2 Oct 2026, R173 pass 4): the range the form posted with (readKept's from, to, compare) comes back too.
  const range = Object.fromEntries(Object.entries(keep).filter(([k]) => k === "from" || k === "to" || k === "compare"));
  // A refusal carries its code, never the address (an address in a URL lands in request logs).
  const q = new URLSearchParams({ ...range, team: done, ...(email && done !== "refused" ? { who: email } : {}), ...(done === "refused" && why ? { why } : {}) });
  // An invite refusal carries no fragment: its form opens with the field autofocused, which scrolls it into view,
  // and a fragment target stops the browser running autofocus (as the setup 303s found, 21c7c6a).
  const at = done === "refused" && why && INVITE_WHYS.includes(why) ? "" : "#set-team";
  return appPath(`/${encodeURIComponent(slug)}/settings?${q}${at}`);
}

/** The invite form's own refusal line: a refused invite whose code is one of INVITE_WHYS, else null. */
export function inviteRefusal(done: unknown, why: unknown): string | null {
  const w = done === "refused" ? teamWhy(why) : null;
  return w && INVITE_WHYS.includes(w) ? TEAM_WHY[w] : null;
}

/**
 * Fixed words; the only thing from the URL is an email that passes readEmail,
 * and only where the team agrees with it (R146, 1 Oct 2026): "Invited" needs
 * them on the team now and "Removed" needs them off it, so a typed link cannot
 * put a stranger's address in a confirmation. A refusal says its reason when
 * its code is known; an invite refusal is the form's line (inviteRefusal), not this.
 */
export function teamToast(done: unknown, who: unknown, roleNow: string | null, why: unknown = null): string | null {
  const email = readEmail(who);
  if (done === "refused") {
    if (inviteRefusal(done, why)) return null;
    const w = teamWhy(why);
    return w ? TEAM_WHY[w] : "That change did not go through. Reload the page and try again.";
  }
  if (!email) return null;
  if (done === "invited") return roleNow === null ? null : `Invited ${email}.`;
  if (done === "removed") return roleNow === null ? `Removed ${email}.` : null;
  if (done === "role" && (roleNow === "editor" || roleNow === "viewer")) return `${email} is now ${roleNow === "editor" ? "an editor" : "a viewer"}.`;
  return null;
}

// ---- The invite mail (BRIEF-4 P2 words). No login token: the invitee signs in the normal way. ----

/** "1 other client", "2 other clients". */
export const otherClients = (k: number): string => count(k, "other client");

/**
 * `everyClient` (AG-1, 9 Oct 2026): the account's client count when the invite
 * is to every client on an account with two or more, so the mail says what
 * they will see. An invite to one client reads as it always did, naming that
 * client only - it does not tell the invitee there are others.
 */
export function inviteMail(p: { inviter: string; domain: string; role: InviteRole; agency: boolean; everyClient?: number | null }): { subject: string; text: string } {
  // agency mode names no nomada tier or brand.
  const board = p.agency ? "dashboard" : "alwayscited dashboard";
  const as = p.role === "editor" ? "an editor" : "a viewer";
  const signIn = `Sign in with this email address at ${DASHBOARD_SIGN_IN} - we'll send you a link.\n`;
  if (p.everyClient && p.everyClient > 1) {
    const rest = p.everyClient - 1;
    return {
      subject: `You've been added to the ${p.domain} dashboard and ${rest} more`,
      text: `${p.inviter} added you to the ${board} for ${p.domain} and the ${otherClients(rest)} on their account, as ${as}. ${signIn}`,
    };
  }
  return {
    subject: `You've been added to the ${p.domain} dashboard`,
    text: `${p.inviter} added you to the ${board} for ${p.domain} as ${as}. ${signIn}`,
  };
}

// ---- Settings' words for who sees what (AG-1, 9 Oct 2026). Drawn for owners, on an account with two or more clients. ----

/** "both clients", "all 3 clients": every client on an account with two or more. */
const allClients = (n: number) => (n === 2 ? "both clients" : `all ${n} clients`);

/** The line under a member saying which clients they see, or null on an account with one client. `clients` null is every client. */
export function scopeLine(clients: number | null, accountClients: number, domain: string): string | null {
  if (accountClients < 2) return null;
  if (clients === null) return `Sees ${allClients(accountClients)} on this account`;
  return clients > 1 ? `Sees ${domain} and ${otherClients(clients - 1)}` : `Sees only ${domain}`;
}

/**
 * What the invite form says about who the invitee will see (AG-1 review,
 * 9 Oct 2026), as inviteScope decides it. `ask` is the choice, drawn on an
 * account with two or more clients once the scope table is there: this
 * client only, checked, or every client - which says it takes in any client
 * added later, as it does. Otherwise one line, and before the table a hidden
 * every-client field, since that is all an invite can be then.
 */
export type InviteChoice = { ask: { only: string; every: string } | null; line: string | null; hidden: InviteScope | null };
export function inviteChoice(accountClients: number, scoping: boolean, domain: string): InviteChoice {
  if (!scoping) {
    const line = accountClients > 1 ? `They will see all ${accountClients} clients on this account, and any added later.` : `They will see ${domain}, and any client added to this account later.`;
    return { ask: null, line, hidden: "account" };
  }
  if (accountClients > 1) return { ask: { only: `Only ${domain}`, every: `Every client on this account (${accountClients} now, and any added later)` }, line: null, hidden: null };
  return { ask: null, line: `They will see ${domain} only, not any client added to this account later.`, hidden: null };
}

/** What Remove's confirm says they lose, as removeKind decides it. */
export function removeLine(clients: number | null, accountClients: number, domain: string): string {
  if (accountClients < 2) return "They lose access to this dashboard at once.";
  if (clients === null) return `They lose access to ${allClients(accountClients)} on this account at once.`;
  return clients > 1 ? `They lose access to ${domain} at once, and keep the ${otherClients(clients - 1)} they see.` : `They lose access to ${domain} at once.`;
}

// ---- The writers. Each reads the account's rows, asks the rule, then writes. ----

export type TeamResult = { ok: true } | { ok: false; message: string };

/**
 * The account's live members, each with their member id and scope. A removed
 * one is not on the team, and an invite revives their row. Every member of the
 * account, not only those who see this client: planTeam narrows them with
 * onClient, and an invite needs to know who is on the account for other
 * clients and who sees each client. `scoping` is false while
 * dashboard_member_clients is not there yet.
 */
export async function readTeam(db: SupabaseClient, accountId: string): Promise<{ rows: TeamRow[]; scoping: boolean } | string> {
  const { data, error } = await db.from("dashboard_members").select("id, email, role, removed_at").eq("account_id", accountId).is("removed_at", null);
  if (error) return `Could not read the team: ${error.message}`;
  const ids = (data ?? []).map((r) => r.id as string);
  const scopes = await readScopes(db, ids).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
  if (typeof scopes === "string") return `Could not read the team: ${scopes}`;
  return {
    scoping: scopes.ready,
    rows: (data ?? []).map((r) => ({ id: r.id as string, email: r.email as string, role: r.role as string, removed_at: (r.removed_at as string | null) ?? null, clients: scopes.of.get(r.id as string) ?? null })),
  };
}

export async function invitesToday(db: SupabaseClient, p: { email: string; today: string }): Promise<number | string> {
  const { count, error } = await db
    .from("dashboard_events")
    .select("id", { count: "exact", head: true })
    .eq("member_email", p.email)
    .eq("event", INVITE_EVENT)
    .gte("created_at", `${p.today}T00:00:00Z`);
  return error || count === null ? `Could not count today's invites: ${error?.message ?? "no count"}` : count;
}

/**
 * The member row, written live or not yet live, and its id. An upsert on
 * `unique (account_id, email)`: a new row, or a removed one brought back on
 * the same row with the new role.
 */
async function writeMember(db: SupabaseClient, p: { accountId: string; email: string; role: InviteRole; by: string; live: boolean }): Promise<{ id: string } | { error: string }> {
  const { data, error } = await db
    .from("dashboard_members")
    .upsert(
      { account_id: p.accountId, email: p.email, role: p.role, invited_by: p.by, removed_at: p.live ? null : new Date().toISOString(), removed_by: p.live ? null : "invite not finished" },
      { onConflict: "account_id,email" },
    )
    .select("id")
    .single();
  return error || !data ? { error: error?.message ?? "no row" } : { id: data.id as string };
}

/**
 * Invite to this client, or to every client on the account (AG-1, 9 Oct 2026).
 * planTeam has already turned away anyone who sees this client.
 *
 * Someone live on the account for other clients only (`elsewhere`) keeps their
 * row (keepRow): this client joins their list, or for every client the list
 * goes. Anyone else - new, or removed - is written not yet live, their scope
 * set, and only then made live, so a write that fails on the way leaves
 * nobody seeing more than they were invited to. Their old scope rows are
 * cleared first, while they are not live, so a member removed while limited
 * does not come back with it.
 */
export async function invite(
  db: SupabaseClient,
  p: { accountId: string; clientId: string; email: string; role: InviteRole; by: string; scope: InviteScope; elsewhere: TeamRow | null },
): Promise<TeamResult> {
  const failed = (why: string): TeamResult => ({ ok: false, message: `Could not invite them: ${why}` });
  const kept = p.elsewhere ? await keepRow(db, { ...p, elsewhere: p.elsewhere }) : false;
  if (typeof kept === "string") return failed(kept);
  if (!kept) {
    const pending = await writeMember(db, { ...p, live: false });
    if ("error" in pending) return failed(pending.error);
    const cleared = await clearScope(db, { memberId: pending.id, by: p.by });
    if (cleared) return failed(cleared);
    if (p.scope === "client") {
      const e = await addScope(db, { memberId: pending.id, clientId: p.clientId, by: p.by });
      if (e) return failed(e);
    }
    const w = await writeMember(db, { ...p, live: true });
    if ("error" in w) return failed(w.error);
  }
  const { error: eErr } = await db.from("dashboard_events").insert({ client_domain_id: p.clientId, member_email: p.by, event: INVITE_EVENT, path: "/settings", props: {} });
  // The member is in; a lost count row only loosens the daily cap by one.
  if (eErr) console.warn(`[app] invite not counted: ${eErr.message}`);
  return { ok: true };
}

/**
 * The invite of someone live on the account for other clients only: their
 * scope first, then their role, set only while their row is still live. True
 * when it was. False when a Remove on another client took them off the
 * account in between: invite then starts again as for someone removed.
 *
 * Never a revive (AG-1 review, 9 Oct 2026). This used writeMember's upsert,
 * which clears removed_at; landing after a Remove of their last client, it
 * brought them back live, and the Remove's scope clear that followed left
 * them with no client - which reads as every client.
 */
async function keepRow(db: SupabaseClient, p: { accountId: string; clientId: string; role: InviteRole; by: string; scope: InviteScope; elsewhere: TeamRow }): Promise<boolean | string> {
  const id = p.elsewhere.id;
  if (!id) return "their row has no id";
  const e = p.scope === "client" ? await addScope(db, { memberId: id, clientId: p.clientId, by: p.by }) : await clearScope(db, { memberId: id, by: p.by });
  if (e) return e;
  const { data, error } = await db.from("dashboard_members").update({ role: p.role }).eq("account_id", p.accountId).eq("id", id).is("removed_at", null).select("id");
  if (error) return error.message;
  return (data ?? []).length > 0;
}

export async function changeRole(db: SupabaseClient, p: { accountId: string; email: string; role: InviteRole }): Promise<TeamResult> {
  const { error } = await db.from("dashboard_members").update({ role: p.role }).eq("account_id", p.accountId).eq("email", p.email).is("removed_at", null);
  return error ? { ok: false, message: `Could not change the role: ${error.message}` } : { ok: true };
}

/**
 * Remove on this client's Settings (removeKind). `row` is their live row as
 * readTeam read it, already checked by planTeam to see this client.
 *
 * Off one of several clients: that scope row goes. Then, if a second Remove on
 * another client got there at the same moment and left them none, the member
 * goes too - a live member with no client reads as every client.
 * Off the account, or off their last client: the member row goes, and their
 * scope rows are left as they are. Nothing reads a removed member's scope, and
 * the next invite clears it while they are still not live. AG-1 review,
 * 9 Oct 2026: clearing it here, after the member row, raced an invite on
 * another client - one that had just made them live with that client in
 * their scope lost it to this clear, and read as every client.
 */
export async function removeMember(db: SupabaseClient, p: { accountId: string; email: string; by: string; clientId: string; row: TeamRow }): Promise<TeamResult> {
  if (removeKind(p.row) === "client") {
    if (!p.row.id) return { ok: false, message: "Could not remove them: their row has no id" };
    const e = await dropScope(db, { memberId: p.row.id, clientId: p.clientId, by: p.by });
    if (e) return { ok: false, message: `Could not remove them: ${e}` };
    // A read that fails counts as none left: removing them is the side that shows nobody too much.
    const left = await readScopes(db, [p.row.id]).catch(() => null);
    if (left?.of.get(p.row.id)?.length) return { ok: true };
  }
  const { error } = await db
    .from("dashboard_members")
    .update({ removed_at: new Date().toISOString(), removed_by: p.by })
    .eq("account_id", p.accountId)
    .eq("email", p.email)
    .is("removed_at", null);
  return error ? { ok: false, message: `Could not remove them: ${error.message}` } : { ok: true };
}
