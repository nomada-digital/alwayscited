"use server";

import { revalidatePath } from "next/cache";

import { refuseUnlessAdmin } from "@/app/admin/admin-auth";
import { addClusterKeyword } from "@/lib/scan/cluster-keyword";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";

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
