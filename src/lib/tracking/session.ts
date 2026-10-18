import { createHash, randomBytes } from "node:crypto";

/**
 * The dashboard's own login - T3 of docs/tracked-dashboard-2026-09-29/BRIEF.md
 * decision 2 (Danny, 29 Sep 2026): an email magic link through Resend, not
 * Supabase Auth, so no dashboard config, no SMTP credential and no auth-schema
 * change. Everything decidable without a socket is here, where
 * `session.test.mts` runs it; imports are relative for `node --test`.
 */

/** A login link lasts 15 minutes and works once. */
export const LOGIN_TTL_MS = 15 * 60 * 1000;

/** A session is a 30-day cookie. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Link requests per hour: 5 per email, 20 per hashed IP. */
export const LOGIN_PER_EMAIL_PER_HOUR = 5;
export const LOGIN_PER_IP_PER_HOUR = 20;

/**
 * 18 Oct 2026: form-spraying bots asked for links for about forty strangers'
 * addresses, three times each within seconds, from forty-odd IPs - under both
 * hourly caps. No mail went (strangers never get one), but every request was a
 * row. A burst cap per hashed IP stops the repeat, and strangers' rows are
 * stored only up to an hourly ceiling across everyone; past it the request is
 * answered the same and nothing is written. A member's request never meets
 * the second cap, so a bot wave cannot lock a member out.
 */
export const LOGIN_PER_IP_PER_MINUTE = 2;
export const LOGIN_STRANGER_ROWS_PER_HOUR = 10;

/**
 * The session cookie (M1, 5 Oct 2026).
 *
 * `__Host-` is a prefix the browser enforces rather than a name we chose: it
 * refuses the cookie unless it is Secure, path `/`, and carries no Domain -
 * which is exactly how `sessionCookie()` below has always set it. The reason
 * to ask for the guarantee now is the move to `app.alwayscited.com`: a cookie
 * without the prefix can be written by any sibling host on the registrable
 * domain, and the dashboard is about to have siblings.
 *
 * The old name is read and cleared on sign-out, so a member holding one is
 * signed out once rather than left with a cookie nothing looks at. Two live
 * members and four unexpired sessions on 5 Oct 2026.
 */
export const SESSION_COOKIE = "__Host-ac_session";

/** What the cookie was called before the host move. Read nowhere; cleared on sign-out. */
export const LEGACY_SESSION_COOKIE = "ac_session";

/** What the login page always says, member or not - it never discloses membership. */
export const LOGIN_SENT = "If that address has access, we've sent a link.";

/** 32 random bytes, hex. Only its sha256 is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 bytes as hex. */
export const TOKEN_CHARS = 64;

/** A token as it arrives in a URL or form: 64 hex characters, or nothing. */
export function isTokenShape(token: unknown): token is string {
  return typeof token === "string" && token.length === TOKEN_CHARS && /^[0-9a-f]+$/.test(token);
}

/** May another link be sent? Counts are this hour's requests so far. */
export function mayRequestLink(emailCount: number, ipCount: number, ipLastMinute = 0): boolean {
  return emailCount < LOGIN_PER_EMAIL_PER_HOUR && ipCount < LOGIN_PER_IP_PER_HOUR && ipLastMinute < LOGIN_PER_IP_PER_MINUTE;
}

/** Store a non-member's request? Only while this hour's stranger rows, across every address, are under the ceiling. */
export function mayRecordStranger(strangerRowsThisHour: number): boolean {
  return strangerRowsThisHour < LOGIN_STRANGER_ROWS_PER_HOUR;
}

/** A login token row is usable once, before it expires. */
export function tokenUsable(row: { expires_at: string; used_at: string | null } | null, now: number = Date.now()): boolean {
  return !!row && row.used_at === null && Date.parse(row.expires_at) > now;
}

/** The cookie's attributes: httpOnly, Secure, SameSite=Lax, 30 days, whole site. */
export function sessionCookie(value: string) {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
