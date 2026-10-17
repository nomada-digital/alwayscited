import "server-only";

import { cache } from "react";

import { trackingDay } from "@/lib/tracking/decide";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";

import { FIXTURE_EMAIL, dashFixturePath, fixtureClient, fixtureRaw } from "./fixture";
import { loadRaw } from "./load";
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
