/**
 * One-click Search Console (Danny, 16 Nov 2026): the customer, or Nomada staff on their behalf, signs in with
 * Google and allows read-only Search Console access; we keep the refresh token, encrypted, server side only.
 * OAuth app "Nomada Digital" (project plucky-paratext-514819-v0), In production with openid, email and
 * webmasters.readonly only - non-sensitive, so no verification. Web client "GSC connect - alwayscited and hub".
 *
 * Env (Danny's, never in this repository): GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, and GSC_TOKEN_KEY - 32
 * random bytes, base64 - which encrypts refresh tokens (AES-256-GCM) and signs the state (HMAC-SHA256, a key derived
 * from it). The pure half: the URLs, the state, the cipher. node:crypto only, so gsc-oauth.test.mts runs it.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const REDIRECT_URI = "https://dashboards.alwayscited.com/api/google/callback";
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"];
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** A started sign-in has this long to come back. */
export const STATE_TTL_MS = 15 * 60 * 1000;
/** The cookie holding the sign-in's nonce, so a state replayed from another browser is refused. */
export const NONCE_COOKIE = "gsc_oauth_nonce";

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** The 32-byte key from GSC_TOKEN_KEY, or null when it is missing or the wrong length. */
export function tokenKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const k = Buffer.from(raw.trim(), "base64");
  return k.length === 32 ? k : null;
}

const signKey = (key: Buffer) => createHmac("sha256", key).update("gsc-oauth-state").digest();

export type OAuthState = { slug: string; by: string; staff: boolean; back: string; nonce: string; exp: number };

/** The state Google hands back: the payload and its signature, base64url, dot separated. */
export function signState(s: OAuthState, key: Buffer): string {
  const body = b64u(Buffer.from(JSON.stringify(s)));
  return `${body}.${b64u(createHmac("sha256", signKey(key)).update(body).digest())}`;
}

/** The state, when its signature holds, it has not expired and its nonce is this browser's; null otherwise. */
export function readState(raw: string, key: Buffer, nonce: string | undefined, now: number): OAuthState | null {
  const [body, sig] = String(raw ?? "").split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", signKey(key)).update(body).digest();
  const got = unb64u(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let s: OAuthState;
  try {
    s = JSON.parse(unb64u(body).toString("utf8")) as OAuthState;
  } catch {
    return null;
  }
  if (!s || typeof s.exp !== "number" || s.exp < now || !nonce || s.nonce !== nonce) return null;
  return s;
}

export const newNonce = (): string => b64u(randomBytes(18));

/** Google's consent page: offline access (a refresh token) and the consent screen every time, so one is always issued. */
export function authUrl(clientId: string, state: string, loginHint?: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) q.set("login_hint", loginHint);
  return `${AUTH_URL}?${q}`;
}

/** AES-256-GCM: iv.tag.ciphertext, base64url. */
export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(enc)}`;
}

export function open(sealed: string, key: Buffer): string | null {
  const [iv, tag, enc] = String(sealed ?? "").split(".");
  if (!iv || !tag || !enc) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, unb64u(iv));
    d.setAuthTag(unb64u(tag));
    return Buffer.concat([d.update(unb64u(enc)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The email in Google's id_token. It came straight from Google's token endpoint over TLS, so it is read, not verified again. */
export function idTokenEmail(idToken: unknown): string | null {
  const part = String(idToken ?? "").split(".")[1];
  if (!part) return null;
  try {
    const c = JSON.parse(unb64u(part).toString("utf8")) as { email?: string; email_verified?: boolean };
    return typeof c.email === "string" && c.email_verified !== false ? c.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Where the callback may send the browser back to: a path on the dashboards host, never another site. */
export function safeBack(path: unknown, slug: string): string {
  const p = String(path ?? "");
  return /^\/(?:view\/[0-9a-f]{64}\/)?[a-z0-9-]{1,80}(?:\/[a-z0-9/-]*)?$/.test(p) && p.includes(slug) ? p : `/${slug}/integrations`;
}

/** Whether the scopes Google granted include Search Console read. A customer can untick it on the consent screen. */
export const grantedSearchConsole = (scope: unknown): boolean => String(scope ?? "").split(/\s+/).some((s) => s === SCOPES[2] || s === "https://www.googleapis.com/auth/webmasters");
