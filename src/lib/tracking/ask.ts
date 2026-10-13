import type { SupabaseClient } from "@supabase/supabase-js";

import { ADMIN_LIMITS } from "./decide.ts";

/**
 * "Ask about these" and "Ask us to pick one" (BRIEF-2 T11, BRIEF-3 T6, 30 Sep
 * 2026; boards-3/CTAs.dc.html). A member asks; the ask goes by email to
 * whoever looks after the account - us, or in `agency` mode the agency's
 * contact - with the member as reply-to, and is recorded in cta_events as
 * `asked`. Three asks per member per day, counted off those rows. Any member
 * may ask, viewers included: an ask changes nothing that is tracked. With
 * `upsell_mode = 'off'` there is nobody to ask, so it is refused.
 *
 * Two asks: a keyword the Add a cluster check refused, "Ask us to pick one"
 * (cta `cluster`), and an upgrade prompt's "Ask about these N" (its own cta,
 * the triggering items listed). Both share the recipient and the cap.
 */

export const ASKS_PER_MEMBER_PER_DAY = 3;

export type UpsellMode = "nomada" | "agency" | "off";
export type AskCta = "mentioned" | "cited" | "everywhere" | "pack" | "cluster";

export const upsellMode = (v: unknown): UpsellMode => (v === "agency" || v === "off" ? v : "nomada");

/**
 * Who the ask goes to. `null` in `to` means our own contact destination; the
 * sender reads that itself, so no caller can supply an address. The agency
 * contact is accounts.upsell_contact_email, written only by Nomada in
 * /admin/tracking; an agency account with none set comes to us rather than
 * being lost.
 */
export function askRecipient(mode: UpsellMode, agencyContact: string | null): { to: string | null; who: string } | null {
  if (mode === "off") return null;
  if (mode === "agency" && agencyContact) return { to: agencyContact, who: "your account contact" };
  return { to: null, who: "nomada digital" };
}

/** The "Ask us to pick one" keyword, trimmed and single-spaced, as the check route bounds it. */
export function readAskKeyword(raw: unknown): string | null {
  const kw = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, ADMIN_LIMITS.question) : "";
  return kw || null;
}

/** The email: plain text, the client, the member and what they asked about. Tier names only outside agency mode. */
export function askMail(p: { brand: string; domain: string; member: string; keyword: string; mode: UpsellMode }): { subject: string; text: string } {
  const where = p.mode === "agency" ? "their dashboard" : "their alwaystracked dashboard";
  return {
    subject: `Pick a cluster keyword for ${p.brand}`,
    text: [
      `${p.member} (${p.brand}, ${p.domain}) asked from ${where} for a keyword to track as a cluster.`,
      "",
      `The keyword they tried: ${p.keyword}`,
      "It did not pass the keyword check (search volume and a buying intent).",
      "",
      "Reply to this email to answer them.",
    ].join("\n"),
  };
}

/**
 * An upgrade prompt's "Ask about these N" (T11 part 5, 30 Sep 2026): the
 * prompt's cta and the ids of the prompts or keywords that triggered it. The
 * route resolves the ids against this client's own rows, so the mail lists
 * only what the client tracks, never text a form sent. Only the two prompts
 * with an ask are accepted; alwayseverywhere's second button is "Book a call".
 */
export type UpgradeAskCta = "mentioned" | "cited";

export const readUpgradeCta = (raw: unknown): UpgradeAskCta | null => (raw === "mentioned" || raw === "cited" ? raw : null);

/**
 * Settings' "Ask us to change these" (R142 part 3, 1 Oct 2026; BRIEF-4 P2):
 * the names we match. Clients never edit aliases - an alias changes what
 * "named" means, so nomada sets them in /admin/tracking - so the ask carries
 * the names as they stand, read on the server, and the reply does the rest.
 * cta_events' check has no `aliases` value and widening it is not additive
 * DDL, so the row is recorded as cta `cluster` with trigger
 * `{ about: "aliases" }`; it counts toward the same daily cap. Billing's
 * "Ask us" is the same ask about billing, until the Stripe portal is checked.
 */
export type AskAbout = "aliases" | "billing";
export const readAskAbout = (raw: unknown): AskAbout | null => (raw === "aliases" || raw === "billing" ? raw : null);

/** Billing's ask: who and which dashboard; the reply is the conversation. */
export function billingAskMail(p: { brand: string; domain: string; member: string; mode: UpsellMode }): { subject: string; text: string } {
  const where = p.mode === "agency" ? "their dashboard" : "their alwaystracked dashboard";
  return {
    subject: `Billing question from ${p.brand}`,
    text: [`${p.member} (${p.brand}, ${p.domain}) asked from ${where} about their billing.`, "", "Reply to this email to answer them."].join("\n"),
  };
}

export function aliasAskMail(p: { brand: string; domain: string; member: string; names: string[]; mode: UpsellMode }): { subject: string; text: string } {
  const where = p.mode === "agency" ? "their dashboard" : "their alwaystracked dashboard";
  return {
    subject: `Change the names matched for ${p.brand}`,
    text: [
      `${p.member} (${p.brand}, ${p.domain}) asked from ${where} to change the names we match.`,
      "",
      "The names matched now:",
      ...p.names.map((n) => `- ${n}`),
      "",
      "Reply to this email to ask what to change, then set it in /admin/tracking.",
    ].join("\n"),
  };
}

/**
 * "Suggest this to your account lead" (13 Oct 2026, DIY P7; spec 10 sections
 * 2.2, 3.6 and 4.7): an ask about pages on Opportunities - one from its
 * detail page on a placed tier ("Ask your agency about this page" in agency
 * mode), or the pages U3 and U8 were shown for. The action carries
 * `kind=opportunity` and the ids, and nothing else: the server reads each
 * page's URL, title and our counts from this client's own rows, and no text
 * a form sent reaches the mail. Nomada sees the URL; the client never sees
 * Nomada's targets. The recipient and the daily cap are the asks' own.
 */
export const readAskKind = (raw: unknown): "opportunity" | null => (raw === "opportunity" ? "opportunity" : null);

/** The most pages one opportunity ask names: the pursuit cap. */
export const ASK_PAGES_MAX = 10;

/** One page as the opportunity ask's mail lists it: read from the row, never from the form. */
export type AskPage = { url: string; title: string | null; route: string; answers: number; prompts: number; to: string | null; competitors: string[] };

export function opportunityAskMail(p: { brand: string; domain: string; member: string; pages: AskPage[]; mode: UpsellMode }): { subject: string; text: string } {
  const where = p.mode === "agency" ? "their dashboard" : "their alwaystracked dashboard";
  const one = p.pages.length === 1;
  const line = (g: AskPage) => {
    const cited = g.answers ? `cited in ${g.answers} answer${g.answers === 1 ? "" : "s"} to ${g.prompts} of their prompts${g.to ? ` in the 28 days to ${g.to}` : ""}` : "not cited in their answers yet";
    const names = g.competitors.length ? `; the answers citing it name ${g.competitors.join(", ")}` : "";
    return [`- ${g.url}`, ...(g.title ? [`  ${g.title}`] : []), `  ${g.route}: ${cited}${names}.`];
  };
  return {
    subject: one ? `${p.brand} suggested a page` : `${p.brand} suggested ${p.pages.length} pages`,
    text: [`${p.member} (${p.brand}, ${p.domain}) suggested ${one ? "this page" : "these pages"} from ${where}, on Opportunities.`, "", ...p.pages.flatMap(line), "", "Reply to this email to answer them."].join("\n"),
  };
}

/** The most ids one ask carries: every prompt a client could track, with packs. */
export const ASK_ITEMS_MAX = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The form's `items` ids, split on commas: uuids only, once each, at most ASK_ITEMS_MAX. */
export function readAskItems(raw: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of raw) if (typeof v === "string" && UUID.test(v) && out.size < ASK_ITEMS_MAX) out.add(v.toLowerCase());
  return [...out];
}

/** What the items are called, in the mail and the toast. */
export const askItemWord = (cta: UpgradeAskCta, n: number) => (cta === "mentioned" ? (n === 1 ? "prompt" : "prompts") : n === 1 ? "keyword" : "keywords");

/** The upgrade ask's email: the prompt that was showing and its items, one a line. No tier name in agency mode. */
export function upgradeAskMail(p: { brand: string; domain: string; member: string; cta: UpgradeAskCta; items: string[]; mode: UpsellMode }): { subject: string; text: string } {
  const where = p.mode === "agency" ? "their dashboard" : "their alwaystracked dashboard";
  const what = askItemWord(p.cta, p.items.length);
  const why = p.cta === "mentioned" ? `${p.items.length} ${what} that named them in no answer this period` : `${p.items.length} cluster ${what} at #11 to #20 on Google today`;
  const next = p.mode === "agency" ? "" : ` The prompt pointed to ${p.cta === "mentioned" ? "alwaysmentioned" : "alwayscited"}.`;
  return {
    subject: `${p.brand} asked about ${p.items.length} ${what}`,
    text: [
      `${p.member} (${p.brand}, ${p.domain}) asked from ${where} about ${why}.${next}`,
      "",
      ...p.items.map((t) => `- ${t}`),
      "",
      "Reply to this email to answer them.",
    ].join("\n"),
  };
}

/** The toast, as the board's: who it went to, what went with it, and who will be answered. */
export const askToast = (who: string, member: string, attached?: string) =>
  `Sent to ${who}${attached ? ` with the ${attached} attached` : ""}. ${who === "nomada digital" ? "We'll" : "They'll"} reply to ${member}.`;

/**
 * R151 (3 Oct 2026): a refused ask's line, by the route's `ask` code. The day's
 * cap read "Try again later" like a failed send, and later in the day it is
 * still refused; it resets at midnight UTC, so it says tomorrow.
 */
export const ASK_REFUSED = {
  refused: "That ask did not send. Try again later.",
  capped: `You have sent today's ${ASKS_PER_MEMBER_PER_DAY} asks. Ask again tomorrow.`,
} as const;
export const askRefusal = (raw: unknown): string | null => (raw === "refused" || raw === "capped" ? ASK_REFUSED[raw] : null);

export type AskGate ={ ok: true } | { ok: false; reason: "off" | "capped" | "read_failed" };

/** The day's cap, counted off this member's `asked` rows since midnight UTC. */
export async function askGate(db: SupabaseClient, p: { clientId: string; email: string; today: string }): Promise<AskGate> {
  const { count, error } = await db
    .from("cta_events")
    .select("id", { count: "exact", head: true })
    .eq("client_domain_id", p.clientId)
    .eq("member_email", p.email)
    .eq("action", "asked")
    .gte("created_at", `${p.today}T00:00:00Z`);
  if (error) return { ok: false, reason: "read_failed" };
  return (count ?? 0) >= ASKS_PER_MEMBER_PER_DAY ? { ok: false, reason: "capped" } : { ok: true };
}

export async function recordAsk(db: SupabaseClient, p: { clientId: string; email: string; cta: AskCta; trigger: Record<string, string> }): Promise<boolean> {
  const { error } = await db.from("cta_events").insert({ client_domain_id: p.clientId, member_email: p.email, cta: p.cta, action: "asked", trigger: p.trigger });
  return !error;
}

/**
 * "Hide for 30 days": one `hidden` row for this member and cta. upgrade-context
 * reads it back through hiddenCtas for HIDE_DAYS; nothing else is changed.
 * `trigger` (13 Oct 2026, DIY P4; spec 10 section 2.7 "Recording") is where it
 * was hidden, upgrade-prompts.ts upgradeTrigger's ids only; none writes `{}`
 * as before.
 */
export async function recordHidden(db: SupabaseClient, p: { clientId: string; email: string; cta: AskCta; trigger?: Record<string, string> }): Promise<boolean> {
  const { error } = await db.from("cta_events").insert({ client_domain_id: p.clientId, member_email: p.email, cta: p.cta, action: "hidden", trigger: p.trigger ?? {} });
  return !error;
}

/** The hide form's cta: any prompt's, since each can be hidden. */
export const readHideCta = (raw: unknown): AskCta | null =>
  raw === "mentioned" || raw === "cited" || raw === "everywhere" || raw === "pack" || raw === "cluster" ? raw : null;
