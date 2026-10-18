import "server-only";

import { cache } from "react";

import { trackingDay } from "@/lib/tracking/decide";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";
import { hashToken } from "@/lib/tracking/session";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { FIXTURE_EMAIL, dashFixturePath, fixtureClient, fixtureRaw } from "./fixture";
import { type ClientRow, loadRaw } from "./load";
import type { Raw } from "./types";

/**
 * Who is looking at the dashboards host, and which clients they may see.
 * The same session table and membership rule as /app (member.ts): a client
 * outside the member's list is a 404. The session cookie is per host
 * (`__Host-`), so a member signs in on this host once, through /login here.
 */

export type DashClient = { id: string; slug: string; domain: string; brand: string | null; tier: string; role: string };

export const dashEmail = cache(async (): Promise<string | null> => {
  if (dashFixturePath()) return FIXTURE_EMAIL;
  return sessionEmail();
});

export const dashClients = cache(async (email: string): Promise<(DashClient & Record<string, unknown>)[]> => {
  if (dashFixturePath()) {
    const c = fixtureClient();
    return [{ ...c, role: "owner" }];
  }
  return (await clientsFor(email)) as (DashClient & Record<string, unknown>)[];
});

/** One client's rows for this request, or null when the member may not see it. */
export const dashRaw = cache(async (email: string, slug: string): Promise<Raw | null> => {
  if (dashFixturePath()) {
    const raw = fixtureRaw();
    return raw.client.slug === slug ? raw : null;
  }
  const clients = await clientsFor(email);
  const c = clients.find((x) => x.slug === slug);
  if (!c) return null;
  return loadRaw(c as Parameters<typeof loadRaw>[0], c.role, trackingDay());
});

/**
 * A demo link's rows (17 Oct 2026): the client the proxy's verified token
 * names, read with no session. Read-only by construction - nothing on this
 * path writes, and the demo pages never call the ops route (useOps keeps a
 * demo's edits in the browser). Role "owner" only so the editing controls
 * draw; there is no session behind it for any write route to accept.
 */
export const demoRaw = cache(async (slug: string): Promise<Raw | null> => {
  if (dashFixturePath()) {
    const raw = fixtureRaw();
    return raw.client.slug === slug ? raw : null;
  }
  const { data, error } = await supabaseAdmin()
    .from("client_domains")
    .select("id, slug, domain, brand_name, market, tier, started_on, cluster_limit, trial_ends_at, status")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`could not read the demo client: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Omit<ClientRow, "brand"> & { brand_name: string | null };
  return loadRaw({ ...row, brand: row.brand_name }, "owner", trackingDay());
});

/**
 * A view-as token from the agency hub (18 Oct 2026, host.ts VIEW_HEADER): the
 * client it opens, the agency user it was minted for, and the owner whose
 * dashboard it shows - or null when it is unknown, expired, revoked, or for
 * another client. Checked on every request, never trusted from the URL alone,
 * and every request it serves is counted on its row (who and when stay with
 * the token: dashboard_view_tokens). Nothing is written to the client's own
 * rows: no session, no last_login_at, no dashboard_events.
 */
export const viewAs = cache(async (token: string, slug: string): Promise<{ by: string; ownerEmail: string; expiresAt: string } | null> => {
  if (dashFixturePath()) return null;
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("dashboard_view_tokens")
    .select("token_hash, slug, created_by, as_email, expires_at, first_used_at, uses")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (error) {
    console.warn(`[dash] could not read a view-as token: ${error.message}`);
    return null;
  }
  const row = data as { token_hash: string; slug: string; created_by: string; as_email: string; expires_at: string; first_used_at: string | null; uses: number } | null;
  if (!row || row.slug !== slug) return null;
  const { error: uErr } = await db
    .from("dashboard_view_tokens")
    .update({ uses: row.uses + 1, last_used_at: now, ...(row.first_used_at ? {} : { first_used_at: now }) })
    .eq("token_hash", row.token_hash);
  if (uErr) console.warn(`[dash] could not count a view-as use: ${uErr.message}`);
  // as_email is the owner as hub_view_as found them at mint time; dashRaw still checks they are a live member.
  return { by: row.created_by, ownerEmail: row.as_email, expiresAt: row.expires_at };
});
