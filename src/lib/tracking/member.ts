import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { SESSION_COOKIE, hashToken, isTokenShape } from "./session.ts";
import { readShell } from "./shell.ts";

/**
 * Who is looking at /app, and which clients they may see (T3, 29 Sep 2026).
 * A member sees the clients on the accounts they belong to - every one, or,
 * since AG-1 (9 Oct 2026, scope.ts), only those their scope lists. Every /app
 * page and route finds its client in this list, so a client outside it is a
 * 404 and is never in the switcher.
 *
 * 13 Oct 2026 (dashboard speed work): the list is one embedded read
 * (shell.ts), and both answers are held for the request with React `cache`,
 * so a second caller in one render - the Actions badge, a section that needs
 * the client again - costs no round trip. React scopes `cache` to one
 * request; nothing is held across requests or members.
 */

export type { MemberClient } from "./shell.ts";

/** The signed-in email, or null. */
export const sessionEmail = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isTokenShape(token)) return null;
  const { data, error } = await supabaseAdmin()
    .from("dashboard_sessions")
    .select("email")
    .eq("token_hash", hashToken(token))
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw new Error(`could not read the session: ${error.message}`);
  return (data?.[0]?.email as string | undefined) ?? null;
});

/** Every client this email may see, oldest first, with the member's role on it. A failed read throws (shell.ts). */
export const clientsFor = cache((email: string) => readShell(supabaseAdmin(), email));

/**
 * The role a write is judged with (8 Oct 2026, review of 2379757). An ended
 * client's history stays readable, but nothing new is tracked for it - the
 * runner skips it - so adding or editing clusters, prompts and keywords would
 * promise a check that never comes. It is read-only to everyone, which the
 * routes' existing viewer refusals and the pages' canWrite already enforce.
 */
export function writeRole(c: { role: string; status?: string }): string {
  return c.status === "ended" ? "viewer" : c.role;
}
