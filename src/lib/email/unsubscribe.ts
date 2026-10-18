import { createHmac, timingSafeEqual } from "node:crypto";

import { isPlausibleEmail } from "../email-address.ts";

/**
 * #7's one-click unsubscribe token (brief item 2e, 18 Oct 2026): a member's
 * address and the client the Monday summary was about, signed with an HMAC of
 * a server secret, so the link opts out exactly that member and nobody else,
 * and cannot be made for an address by anyone without the secret.
 *
 * The secret is handed in (the route and the sender read CRON_SECRET, as the
 * keyword check's signature does - check.ts verifyCheck); this module reads
 * no environment, so node --test runs it. No expiry: an unsubscribe link in a
 * month-old email still has to work (RFC 8058), and all it can do is stop one
 * member's Monday email.
 */

export type UnsubscribeClaim = { email: string; clientId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The longest token accepted: a 254-character address and a uuid, encoded, and the signature. */
export const UNSUBSCRIBE_TOKEN_MAX = 500;

const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(`unsubscribe.v1.${payload}`).digest("base64url");

/** The token for one member and client, or null with no usable secret. */
export function signUnsubscribe(secret: string, c: UnsubscribeClaim): string | null {
  if (secret.length < 16) return null;
  const payload = Buffer.from(JSON.stringify({ e: c.email.trim().toLowerCase(), c: c.clientId }), "utf8").toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
}

/** The member and client a token names, or null for anything not signed with this secret. */
export function verifyUnsubscribe(secret: string, token: string | null | undefined): UnsubscribeClaim | null {
  if (secret.length < 16 || !token || token.length > UNSUBSCRIBE_TOKEN_MAX) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const want = Buffer.from(mac(secret, m[1]!));
  const got = Buffer.from(m[2]!);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as { e?: unknown; c?: unknown };
    if (typeof p.e !== "string" || typeof p.c !== "string" || !UUID.test(p.c) || !isPlausibleEmail(p.e) || p.e.length > 254) return null;
    return { email: p.e, clientId: p.c };
  } catch {
    return null;
  }
}

/** The link a token goes in: a route under /api, so it answers on any host. */
export const unsubscribeLink = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}/api/dash/unsubscribe?t=${encodeURIComponent(token)}`;
