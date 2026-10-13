/**
 * The walkthrough ask's three required fields - the person's name, their
 * business category and their market (Danny, 13 Oct 2026: "name, category and
 * market are included in order for them to submit the form for a loom with
 * luke or demo with danny. These should be required fields.").
 *
 * One module for both ends. WalkthroughForm draws its options and its
 * messages from here, and both walkthrough routes read the posted values
 * through here, so the form cannot offer a category the server refuses or the
 * server accept one the form never offered. Plain, with no server-only
 * import, so the client form and `node --test` can both load it.
 *
 * The category list is the site's sector list - the one the packages table and
 * checkout price by (sector-prices.json through sector-pricing.ts) - and it
 * already ends in "Other", so nothing is added here. The markets are the two
 * the scan supports, in the scan's spelling, which is what scans.market stores
 * and what walkthrough_requests.market stores beside it.
 */

import { WALKTHROUGH_LIMITS } from "../../config/contact.ts";
import { SECTORS, sectorById } from "../../config/sector-pricing.ts";
import { MARKETS, isMarket, type Market } from "./domain.ts";

/** US first, as wherever both markets appear (pricing spec section 2). */
export const WALKTHROUGH_MARKETS: readonly Market[] = ["US", "UK"];

/** The category options: every sector, "Other" last, as the file orders them. */
export const WALKTHROUGH_CATEGORIES: readonly { id: string; label: string }[] = SECTORS.map((s) => ({ id: s.id, label: s.label }));

/** The fields the form shows an error under, in the order it shows them. */
export type WalkthroughField = "name" | "email" | "category" | "market";

export const WALKTHROUGH_REFUSAL = {
  name: "Tell us your name.",
  nameLong: `Your name can be up to ${WALKTHROUGH_LIMITS.name} characters.`,
  category: "Pick your business category.",
  market: "Pick your market.",
} as const;

/**
 * Which field each route refusal is about, so a message the route sends back
 * lands under the field it names rather than at the foot of the form.
 */
export const WALKTHROUGH_ERROR_FIELD: Readonly<Record<string, WalkthroughField>> = {
  bad_name: "name",
  bad_email: "email",
  personal_email: "email",
  bad_category: "category",
  bad_market: "market",
};

type Read<T> = { ok: true; value: T } | { ok: false; error: "bad_name" | "bad_category" | "bad_market"; message: string };

/**
 * A name as typed: control characters out, runs of whitespace one space, ends
 * trimmed. Refused when nothing is left, or over the bound - it goes into the
 * alert we send ourselves and into the row.
 *
 * Invisible format characters (Unicode Cf: zero-width space, the bidi
 * overrides, the byte-order mark) go too, and a name must hold at least one
 * letter or digit (13 Oct 2026, review: a lone U+200B is not whitespace to
 * `\s`, so it survived the trim and a "required" name reached the row and the
 * alert blank). The zero-width joiner and non-joiner stay, because some
 * scripts - Persian, the Indic ones - spell names with them.
 */
const FORMAT_CHARS = /\p{Cf}/gu;
const KEEP_FORMAT = new Set(["\u200c", "\u200d"]);

export function readWalkthroughName(raw: unknown): Read<string> {
  const name = (typeof raw === "string" ? raw : "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(FORMAT_CHARS, (c) => (KEEP_FORMAT.has(c) ? c : " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, error: "bad_name", message: WALKTHROUGH_REFUSAL.name };
  if (name.length > WALKTHROUGH_LIMITS.name) return { ok: false, error: "bad_name", message: WALKTHROUGH_REFUSAL.nameLong };
  return { ok: true, value: name };
}

/** A sector id from the list, and nothing else; stored as the id, shown by its label. */
export function readWalkthroughCategory(raw: unknown): Read<string> {
  if (typeof raw !== "string" || raw.length > WALKTHROUGH_LIMITS.category || !sectorById(raw)) {
    return { ok: false, error: "bad_category", message: WALKTHROUGH_REFUSAL.category };
  }
  return { ok: true, value: raw };
}

/** Exactly US or UK. */
export function readWalkthroughMarket(raw: unknown): Read<Market> {
  if (typeof raw !== "string" || raw.length > WALKTHROUGH_LIMITS.market || !isMarket(raw)) {
    return { ok: false, error: "bad_market", message: WALKTHROUGH_REFUSAL.market };
  }
  return { ok: true, value: raw };
}

/** What the ask stores and the alert carries, once all three have read. */
export type WalkthroughAsk = { name: string; category: string; market: Market };

/** The category as a person reads it: "Technology and software". */
export function categoryLabel(id: string): string {
  return sectorById(id)?.label ?? id;
}

/** "UK (United Kingdom)". */
export function marketLabel(m: Market): string {
  return `${m} (${MARKETS[m].label})`;
}
