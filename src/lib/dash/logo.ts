import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** A client's logo address (client_domains.logo_url), or null: none set, the column not there yet, or a read that failed. Never fatal. */
export async function clientLogo(db: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await db.from("client_domains").select("logo_url").eq("id", clientId).maybeSingle();
  return error ? null : ((data as { logo_url?: string | null } | null)?.logo_url ?? null);
}
