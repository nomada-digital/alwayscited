import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { scopesFrom, sees } from "./scope.ts";

/**
 * What Settings reads beyond the client row (R142, BRIEF-4 P2, 1 Oct 2026):
 * the names we match and the live members who see this client.
 *
 * `clients` (AG-1, 9 Oct 2026): how many clients the member is limited to,
 * this one among them, or null when they see every client on the account.
 *
 * 13 Oct 2026 (dashboard speed work): one read instead of four in a row. The
 * client row embeds its account, the account its live members, each member
 * their live scope rows, and the account its clients with a slug, all through
 * the foreign keys - so the account id is never read into this module at all.
 */
export type Member = { email: string; name: string | null; role: string; last_login_at: string | null; clients: number | null };
/**
 * accountClients: the clients on the account /app can show (a slug set), so
 * Settings can say who sees what and ask an invite's scope when there are two
 * or more. From 8 Oct 2026 (audit security-2) it carried a warning that every
 * member saw them all; members are scoped from 9 Oct (AG-1, scope.ts).
 * scoping: false while dashboard_member_clients is not there yet - everyone
 * then sees every client, and no invite can be limited to one. Since the read
 * embeds that table it is always true here: the table is applied
 * (20261009010000), and a read that cannot find it fails like any other.
 */
export type SettingsData = { aliases: string[]; members: Member[]; accountClients: number; scoping: boolean };

/** The client's aliases, its account's live members with their live scope, and the account's clients. Hinted as shell.ts hints it. */
const SETTINGS_READ =
  "brand_aliases, accounts!client_domains_account_id_fkey(dashboard_members(id, email, name, role, last_login_at, created_at, dashboard_member_clients(client_domain_id)), client_domains!client_domains_account_id_fkey(id))";

type MemberRow = { id: unknown; email: unknown; name: unknown; role: unknown; last_login_at: unknown; created_at: unknown; dashboard_member_clients: { client_domain_id: unknown }[] | null };
type Account = { dashboard_members: MemberRow[] | null; client_domains: { id: unknown }[] | null };

const at = (r: MemberRow) => {
  const t = Date.parse(String(r.created_at ?? ""));
  return Number.isFinite(t) ? t : 0;
};

export async function loadSettings(clientId: string): Promise<SettingsData> {
  const { data: client, error } = await supabaseAdmin()
    .from("client_domains")
    .select(SETTINGS_READ)
    .eq("id", clientId)
    .is("accounts.dashboard_members.removed_at", null)
    .is("accounts.dashboard_members.dashboard_member_clients.removed_at", null)
    .not("accounts.client_domains.slug", "is", null)
    .single();
  if (error) throw new Error(`could not read the client's team: ${error.message}`);
  const row = client as { brand_aliases: string[] | null; accounts: Account | Account[] | null };
  const account = Array.isArray(row.accounts) ? (row.accounts[0] ?? null) : row.accounts;
  if (!account) throw new Error("could not read the client's team: no account came back");
  // Oldest member first, as the separate read's order by created_at had them.
  const rows = [...(account.dashboard_members ?? [])].sort((a, b) => at(a) - at(b));
  // AG-1: a member limited to other clients is not on this client's team.
  const scopes = scopesFrom(rows.flatMap((r) => (r.dashboard_member_clients ?? []).map((s) => ({ member_id: r.id, client_domain_id: s.client_domain_id }))));
  return {
    accountClients: account.client_domains?.length ?? 1,
    scoping: true,
    aliases: (row.brand_aliases ?? []).filter(Boolean),
    members: rows
      .filter((r) => sees(scopes.get(String(r.id)), clientId))
      .map((r) => ({
        email: r.email as string,
        name: (r.name as string | null) ?? null,
        role: r.role as string,
        last_login_at: (r.last_login_at as string | null) ?? null,
        clients: scopes.get(String(r.id))?.length ?? null,
      })),
  };
}
