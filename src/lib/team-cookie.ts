import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Mark this browser as team" (Danny, 3 Nov 2026). /admin/scans, behind the admin's Basic auth, sets this cookie; a
 * browser carrying it skips the report gate and its scans are marked internal. The admin realm only covers /admin, so
 * the scan page cannot see the Basic auth itself - this is how the team is known there.
 *
 * Signed, not secret: `v1.<issued ms>.<HMAC-SHA256>`, keyed off IP_HASH_SALT with its own label so the key is not
 * the salt itself. Valid for TEAM_COOKIE_DAYS. With no salt configured nothing verifies, so the gate stays on.
 */
export const TEAM_COOKIE = "ac_team";
export const TEAM_COOKIE_DAYS = 180;

function key(): string | null {
  const salt = process.env.IP_HASH_SALT;
  return salt ? createHmac("sha256", salt).update("alwayscited team cookie v1").digest("hex") : null;
}

const sign = (k: string, issued: number) => createHmac("sha256", k).update("v1." + issued).digest("hex");

export function teamCookieValue(now = Date.now()): string | null {
  const k = key();
  return k ? `v1.${now}.${sign(k, now)}` : null;
}

export function isTeamCookie(value: string | undefined | null, now = Date.now()): boolean {
  const k = key();
  const m = /^v1\.(\d{13})\.([0-9a-f]{64})$/.exec(value ?? "");
  if (!k || !m) return false;
  const issued = Number(m[1]);
  if (issued > now + 60_000 || now - issued > TEAM_COOKIE_DAYS * 86_400_000) return false;
  const want = Buffer.from(sign(k, issued), "hex");
  const got = Buffer.from(m[2], "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}
