/**
 * The dashboards "beta" switch (28 Nov 2026, Danny): changes that have been merged but not yet turned on for customers.
 * Off by default, so production looks as it did. A reviewer turns it on for their own browser by opening any dashboards page
 * with `?beta=ac28` (the proxy sets the cookie and drops the parameter) and off with `?beta=off`.
 *
 * Plain module, no imports, so proxy.ts and `node --test` can load it. Whether the cookie counts is decided on the server
 * (beta.ts): only a staff session, a demo link or the hub's view-as link sees the beta, never a customer, even with the cookie.
 */
export const BETA_PARAM = "beta";
export const BETA_COOKIE = "ac_beta";
export const BETA_CODE = "ac28";
export const BETA_MAX_AGE_S = 7 * 24 * 60 * 60;

/** True only for the exact code. */
export const betaCookieOn = (value: string | null | undefined): boolean => value === BETA_CODE;

/** What `?beta=` asks for: turn on (the code), turn off ("off"), or nothing. */
export function betaAsk(value: string | null | undefined): "on" | "off" | null {
  if (value === BETA_CODE) return "on";
  if (value === "off") return "off";
  return null;
}
