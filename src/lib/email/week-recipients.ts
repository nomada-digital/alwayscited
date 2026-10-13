import type { SupabaseClient } from "@supabase/supabase-js";

import { readScopes, sees } from "../tracking/scope.ts";

/**
 * Who gets the Monday "This week" email for one client (13 Oct 2026, DIY P9;
 * spec 10 section 7.10): the account's live owners and editors who can see
 * that client. A member with live scope rows sees only those clients
 * (scope.ts); no rows is every client on the account. A failed scope read
 * throws, through readScopes - it must never widen who is mailed - unless
 * the table is not there yet, when everyone sees every client.
 *
 * Viewers are not mailed: the email is a list of things to do, and a viewer
 * cannot move an Actions item. Plain module, relative imports: node --test
 * runs it through lifecycle-sweep.test.mts.
 */
export async function weekRecipients(db: SupabaseClient, accountId: string, clientId: string): Promise<string[]> {
  const { data: members, error } = await db.from("dashboard_members").select("id, email, role").eq("account_id", accountId).in("role", ["owner", "editor"]).is("removed_at", null);
  if (error) throw new Error(`could not read the members: ${error.message}`);
  if (!members?.length) return [];
  const scopes = await readScopes(db, members.map((m) => String(m.id)));
  return members.filter((m) => sees(scopes.of.get(String(m.id)), clientId)).map((m) => String(m.email));
}
