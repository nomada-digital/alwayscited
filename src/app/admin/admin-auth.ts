import "server-only";

import { headers } from "next/headers";

import { constantTimeEqual, decodeBasicAuth } from "@/lib/constant-time";

/**
 * The proxy's Basic auth check, repeated inside an admin server action. A
 * server action is invoked by its action id and Next answers that id on any
 * path, so the /admin proxy alone does not hold it. Moved here from
 * /admin/tracking/actions.ts on 3 Nov 2026 so /admin/scans' "Add keyword"
 * checks with the same code. Null when the caller is the admin.
 */
export async function refuseUnlessAdmin(): Promise<{ ok: false; message: string } | null> {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password) return { ok: false, message: "Admin access is not configured." };
  const creds = decodeBasicAuth((await headers()).get("authorization") ?? "");
  if (!creds) return { ok: false, message: "Not authorised." };
  const userOk = constantTimeEqual(creds.user, user);
  const passwordOk = constantTimeEqual(creds.password, password);
  return userOk && passwordOk ? null : { ok: false, message: "Not authorised." };
}
