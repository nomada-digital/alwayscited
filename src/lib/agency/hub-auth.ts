import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Who may call /api/hub/agency (29 Oct 2026): the agency hub's edge functions, server to server. Either header is
 * enough:
 *
 * - `x-hub-secret` equal to HUB_OFFER_SECRET, as /api/hub/offer reads it - when that secret is set on both sides;
 * - `x-ac-key`, the alwayscited project's service key the hub already holds as AC_SERVICE_KEY (sync-alwayscited-scans
 *   and alwayscited-admin read this database with it). It is accepted when it is this deployment's own
 *   SUPABASE_SERVICE_ROLE_KEY, or when Supabase's admin endpoint answers it - which only a service key of this
 *   project does. A holder of that key can already read and write every table here, so it is given nothing new.
 *
 * Neither: 403. Nothing is cached; the hub calls this a handful of times a day.
 */
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function hubAuthorised(req: Request, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.HUB_OFFER_SECRET;
  const given = req.headers.get("x-hub-secret") ?? "";
  if (secret && given && same(given, secret)) return true;
  const key = req.headers.get("x-ac-key") ?? "";
  if (key.length < 20 || key.length > 4096) return false;
  const own = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (own && same(key, own)) return true;
  const url = process.env.SUPABASE_URL;
  if (!url) return false;
  try {
    const res = await fetchImpl(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: key, ...(key.startsWith("eyJ") ? { authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(8_000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
