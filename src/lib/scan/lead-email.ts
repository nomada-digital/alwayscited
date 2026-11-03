/**
 * The report gate's address rules (Danny, 3 Nov 2026: "Where should we send your report?" on the confirm step, before
 * anything runs). Pure, so Node's runner can execute it; the MX lookup is lead-email-mx.ts.
 *
 * - The format is `isPlausibleEmail`'s, the one every other form here uses.
 * - A disposable inbox is refused: it is an address given to not be reached, and the report is the reason we ask.
 * - A free-mail address (gmail.com and the like) is accepted and flagged, scans.email_free_domain, for the hub.
 * - An address or a scanned domain on INTERNAL_DOMAINS is the team's: the scan is marked internal and kept out of the
 *   hub's lead counts. A team scan of our own domain skips the gate entirely.
 *
 * Imports are relative and carry the extension, for the reason dataforseo-request.ts gives.
 */

import { isPlausibleEmail } from "../email-address.ts";
import { SCAN_LIMITS } from "../../config/contact.ts";

/** The team's own domains: an address on one, or a scan of one, is internal (Danny, 3 Nov 2026). */
export const INTERNAL_DOMAINS: readonly string[] = ["nomadadigital.co.uk", "alwayscited.com"];

/** Free mailbox providers: accepted, flagged. The hub's lead-intake list, with the common regional ones. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk", "msn.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "pm.me", "gmx.com", "gmx.co.uk", "mail.com", "zoho.com", "btinternet.com", "sky.com", "virginmedia.com",
]);

/**
 * Disposable inbox services, refused. Not exhaustive and cannot be: the common ones, which is where nearly all such
 * addresses come from. The MX check catches made-up domains; this catches real ones that exist to be thrown away.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "tempmail.com", "tempmail.net", "tempmailo.com",
  "throwawaymail.com", "yopmail.com", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email",
  "maildrop.cc", "dispostable.com", "mailnesia.com", "mintemail.com", "fakeinbox.com", "emailondeck.com",
  "mohmal.com", "moakt.com", "burnermail.io", "spamgourmet.com", "mailcatch.com", "tempr.email", "discard.email",
  "inboxkitten.com", "mail.tm", "33mail.com", "spambox.us", "temp-mail.io", "luxusmail.org", "tmail.ws",
]);

/** The domain part, lower case, without a leading www. */
export function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase().replace(/^www\./, "");
}

const onList = (domain: string, list: Iterable<string>) => {
  for (const d of list) if (domain === d || domain.endsWith("." + d)) return true;
  return false;
};

export const isInternalDomain = (domain: string) => onList(domain.toLowerCase().replace(/^www\./, ""), INTERNAL_DOMAINS);

/** What the gate makes of an address before the MX lookup. */
export type LeadCheck =
  | { ok: true; email: string; domain: string; free: boolean; internal: boolean }
  | { ok: false; message: string };

export function checkLeadEmail(raw: unknown): LeadCheck {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { ok: false, message: "Tell us where to send the report." };
  if (email.length > SCAN_LIMITS.email || !isPlausibleEmail(email)) return { ok: false, message: "That email address does not look right." };
  const domain = domainOf(email);
  if (onList(domain, DISPOSABLE_DOMAINS)) return { ok: false, message: "That looks like a disposable inbox. Use an address we can reach." };
  return { ok: true, email, domain, free: onList(domain, FREE_MAIL_DOMAINS), internal: isInternalDomain(domain) };
}

/** The optional first name: trimmed, cut to SCAN_LIMITS.name, null when empty. */
export function cleanLeadName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, SCAN_LIMITS.name) : "";
  return name || null;
}
