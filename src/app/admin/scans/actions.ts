"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { refuseUnlessAdmin } from "@/app/admin/admin-auth";
import { addClusterKeyword } from "@/lib/scan/cluster-keyword";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";
import { TEAM_COOKIE, TEAM_COOKIE_DAYS, teamCookieValue } from "@/lib/team-cookie";

export type AdminResult = { ok: boolean; message: string };

/** A scan link (alwayscited.com/scan/<token>) or the bare token. */
const TOKEN = /([0-9a-f]{32})\/?(?:[?#].*)?$/i;

/**
 * "Add keyword" (Luke, 3 Nov 2026): a finished scan without a cluster keyword
 * gains one and its Google position, on the same link. Checked against the
 * admin's Basic auth here as well as at the proxy (admin-auth.ts says why).
 * lib/scan/cluster-keyword.ts addClusterKeyword has the rest.
 */
export async function addKeyword(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const raw = String(form.get("scan") ?? "").trim();
  if (raw.length > ADMIN_LIMITS.scan) return { ok: false, message: "That is not a scan link." };
  const token = raw.match(TOKEN)?.[1]?.toLowerCase();
  if (!token) return { ok: false, message: "Paste a scan link, alwayscited.com/scan/..." };
  const out = await addClusterKeyword(token);
  revalidatePath("/admin/scans");
  revalidatePath("/scan/" + token);
  return out;
}

/**
 * "Mark this browser as team" (Danny, 3 Nov 2026): this browser skips the report gate on new scans and its scans are
 * marked internal, out of the hub's lead counts. A signed cookie (lib/team-cookie.ts), because the admin's Basic auth
 * only reaches /admin and the scan page cannot see it. Sends nothing, spends nothing; the same admin check first.
 */
export async function markTeamBrowser(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const jar = await cookies();
  if (form.get("off") === "1") {
    jar.delete(TEAM_COOKIE);
    revalidatePath("/admin/scans");
    return { ok: true, message: "This browser is no longer marked as team. New scans ask for an email." };
  }
  const value = teamCookieValue();
  if (!value) return { ok: false, message: "IP_HASH_SALT is not set, so the team cookie cannot be signed." };
  jar.set(TEAM_COOKIE, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TEAM_COOKIE_DAYS * 86_400 });
  revalidatePath("/admin/scans");
  return { ok: true, message: `This browser is marked as team for ${TEAM_COOKIE_DAYS} days: no email gate, scans marked internal.` };
}
