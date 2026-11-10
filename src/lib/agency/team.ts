import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";
import { upsellMode } from "@/lib/tracking/ask";
import { trackingDay } from "@/lib/tracking/decide";
import { sendInvite } from "@/lib/tracking/invite-mail";
import { inviteMessage } from "@/lib/tracking/invite-send";
import { changeRole, fullName, invite, invitesToday, planAgencyTeam, readAgencyRole, readEmail, readNamePart, readScopeWord, readTeam, removeMember, type TeamRow } from "@/lib/tracking/team";

/**
 * A customer's team from the hub's agency view (Danny, 10 Nov 2026): Nomada staff list it, invite by email as an
 * editor or viewer, change a role (owner included) and remove, through /api/hub/agency as every agency edit goes.
 * The rules are team.ts's (planAgencyTeam, which is planTeam with the staff member as the actor) and the writes are
 * its writers, so a change here lands exactly as an owner's on Settings would. The invite is the same email
 * (invite-send.ts, sent by invite-mail.ts), saying the staff member added them, with them as reply-to. Every change is a line in
 * agency_edits under the staff member's email; the invite also counts against their member_invite cap.
 *
 * The team is this client's: the members who see it (scope.ts), as Settings lists them.
 */

type Team = { accountId: string; rows: TeamRow[]; scoping: boolean; clientIds: string[] };

async function loadTeam(db: SupabaseClient, client: Client): Promise<Team | string> {
  const { data: row, error } = await db.from("client_domains").select("account_id").eq("id", client.id).maybeSingle();
  if (error || !row?.account_id) return `Could not read the customer's account: ${error?.message ?? "no account"}`;
  const accountId = row.account_id as string;
  const team = await readTeam(db, accountId);
  if (typeof team === "string") return team;
  const { data: ids, error: nErr } = await db.from("client_domains").select("id").eq("account_id", accountId).not("slug", "is", null);
  if (nErr || !ids) return `Could not read the account's clients: ${nErr?.message ?? "none"}`;
  return { accountId, rows: team.rows, scoping: team.scoping, clientIds: ids.map((c) => c.id as string) };
}

const here = (t: Team, clientId: string) => t.rows.filter((r) => r.removed_at === null && (!r.clients || r.clients.includes(clientId)));

/** The members who see this client, owners first, with whether each sees only some of the account's clients. */
export async function teamRead(db: SupabaseClient, client: Client): Promise<Done> {
  const t = await loadTeam(db, client);
  if (typeof t === "string") return { ok: false, message: t };
  const order = { owner: 0, editor: 1, viewer: 2 } as Record<string, number>;
  const members = here(t, client.id)
    .map((r) => ({ email: r.email, role: r.role, name: fullName(r.first, r.last), limited: !!r.clients }))
    .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || a.email.localeCompare(b.email));
  return { ok: true, message: `${members.length} on the team.`, data: { members, account_clients: t.clientIds.length } };
}

/** Invite, change a role or remove; `args` as the hub posts them. */
export async function teamChange(db: SupabaseClient, client: Client, by: string, op: "invite" | "role" | "remove", args: Record<string, unknown>): Promise<Done> {
  const email = readEmail(args.email);
  if (!email) return { ok: false, message: "That email address does not look right. Type it in full, like name@example.com." };
  const role = op === "remove" ? null : readAgencyRole(args.role);
  if (op !== "remove" && !role) return { ok: false, message: "Pick a role." };
  const t = await loadTeam(db, client);
  if (typeof t === "string") return { ok: false, message: t };
  const n = op === "invite" ? await invitesToday(db, { email: by, today: trackingDay() }) : 0;
  if (typeof n === "string") return { ok: false, message: n };
  const first = readNamePart(args.first) ?? undefined;
  const last = readNamePart(args.last);
  const plan = planAgencyTeam({ op, email, role, scope: readScopeWord(args.scope), first, last, actor: by, rows: t.rows, scoping: t.scoping, clientId: client.id, clientIds: t.clientIds, invitesToday: n });
  if (typeof plan === "string") return { ok: false, message: plan };

  if (plan.op === "invite") {
    const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode").eq("id", t.accountId).maybeSingle();
    if (aErr || !account) return { ok: false, message: `Could not read the account: ${aErr?.message ?? "none"}` };
    const r = await invite(db, { accountId: t.accountId, clientId: client.id, email, role: plan.role, by, scope: plan.scope, elsewhere: plan.elsewhere, first: plan.first, last: plan.last });
    if (!r.ok) return r;
    const everyClient = plan.scope === "account" && t.clientIds.length > 1 ? t.clientIds.length : null;
    const mail = await inviteMessage(db, { inviter: by, role: plan.role, tier: client.tier, domain: client.domain, agency: upsellMode(account.upsell_mode) === "agency", everyClient });
    const sent = await sendInvite({ to: email, replyTo: by, ...mail });
    await audit(db, client.id, by, "team_invite", email, null, { role: plan.role, scope: plan.scope, name: fullName(plan.first, plan.last), mailed: sent });
    return { ok: true, message: sent ? `Invited ${email} as ${plan.role}. They get an email with a sign-in link.` : `${email} is on the team as ${plan.role}, but the invite email did not send. They can still sign in at the dashboard's sign-in page.` };
  }
  if (plan.op === "remove") {
    const r = await removeMember(db, { accountId: t.accountId, email, by, clientId: client.id, row: plan.row });
    if (!r.ok) return r;
    await audit(db, client.id, by, "team_remove", email, { role: plan.row.role }, null);
    return { ok: true, message: `Removed ${email}. They can no longer sign in to this dashboard.` };
  }
  if (plan.op === "name") return { ok: false, message: "unknown change" };
  const next = plan.op === "owner" ? "owner" : plan.role;
  const r = await changeRole(db, { accountId: t.accountId, email, role: next });
  if (!r.ok) return r;
  await audit(db, client.id, by, "team_role", email, plan.row.role, next);
  return { ok: true, message: `${email} is now ${next === "owner" ? "an owner" : next === "editor" ? "an editor" : "a viewer"}.` };
}
