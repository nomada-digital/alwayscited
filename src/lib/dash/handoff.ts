import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed agency handoff (26 Nov 2026): how the hub opens a customer's dashboard in the agency view with no
 * magic-link sign-in. The hub signs `v1 \n slug \n by \n exp` with HMAC-SHA256 under a secret both sides hold
 * (HUB_HANDOFF_SECRET) and sends the browser to
 *
 *   https://dashboards.alwayscited.com/api/dash/handoff?slug=<slug>&by=<staff email>&exp=<unix seconds>&sig=<hex>
 *
 * The route (api/dash/handoff/route.ts) checks it and answers with the same read-only view-as the hub's "What the
 * customer sees" opens. The signature is good for HANDOFF_WINDOW_S, so a copied link dies within the minute; `by` is a
 * Nomada address and is part of what is signed. Pure apart from node:crypto, so the tests read it directly.
 */
export const HANDOFF_WINDOW_S = 60;

const body = (slug: string, by: string, exp: number) => `v1\n${slug}\n${by}\n${exp}`;

export function signHandoff(secret: string, slug: string, by: string, exp: number): string {
  return createHmac("sha256", secret).update(body(slug, by, exp)).digest("hex");
}

export type HandoffVerdict = { ok: true; slug: string; by: string } | { ok: false; reason: "not_configured" | "bad_request" | "expired" | "bad_signature" | "not_staff" };

export function verifyHandoff(secret: string | undefined, q: { slug?: string | null; by?: string | null; exp?: string | null; sig?: string | null }, nowMs = Date.now()): HandoffVerdict {
  if (!secret || secret.length < 32) return { ok: false, reason: "not_configured" };
  const slug = q.slug ?? "";
  const by = (q.by ?? "").trim().toLowerCase();
  const exp = Number(q.exp);
  const sig = q.sig ?? "";
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !/^[0-9a-f]{64}$/.test(sig) || !Number.isInteger(exp)) return { ok: false, reason: "bad_request" };
  const now = Math.floor(nowMs / 1000);
  // Expired, or signed for further ahead than a handoff ever is.
  if (exp < now || exp > now + HANDOFF_WINDOW_S) return { ok: false, reason: "expired" };
  const want = Buffer.from(signHandoff(secret, slug, by, exp), "hex");
  const got = Buffer.from(sig, "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "bad_signature" };
  if (!/^[^@\s]+@nomadadigital\.co\.uk$/.test(by)) return { ok: false, reason: "not_staff" };
  return { ok: true, slug, by };
}
