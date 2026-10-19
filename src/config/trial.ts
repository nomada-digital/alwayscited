import type { TierKey } from "../lib/tier-text.ts";
import { clockIn, marketZone } from "../lib/tracking/check-time.ts";

/**
 * The alwaystracked free trial (Danny, 8 Oct 2026): 14 days, card required,
 * the first charge on day 15.
 *
 * Built dark, then switched on 8 Oct 2026 at Danny's request ("add messaging
 * to indicate a 14-day free trial for alwaystracked"). A code constant rather
 * than an app_settings row, because every surface that shows the price is a
 * static page and a settings read there would make it dynamic. Turning it
 * off again is this one line.
 *
 * Every reader takes `enabled` as a parameter defaulting to this, so the tests
 * run both states while the build runs the shipped one.
 */
export const TRIAL = { enabled: true, days: 14 } as const;

/** The alwaystracked button label while the trial is on - the offer, in the verb. */
export const TRIAL_CTA = "Start 14-day free trial";

/** The line every alwaystracked price surface gains while the trial is on. */
export const TRIAL_LINE = "14 days free, card required. Cancel before day 15 and you pay nothing.";

/** The trial line for a tier's price, or null: only alwaystracked, only while on. */
export function trialLine(tier: TierKey, enabled: boolean = TRIAL.enabled): string | null {
  return enabled && tier === "tracked" ? TRIAL_LINE : null;
}

/**
 * Who gets the trial at checkout: alwaystracked with no extra packs, a domain
 * and an email that have never been through alwayscited before.
 * `repeat` is what the order and client reads found; null when nothing did.
 */
export type TrialRepeat = "email" | "domain" | null;

export function trialApplies(p: { tier: string; packs: number; repeat: TrialRepeat }, enabled: boolean = TRIAL.enabled): boolean {
  return enabled && p.tier === "tracked" && p.packs === 0 && p.repeat === null;
}

/**
 * The line Stripe shows above Pay when an order that could have had the trial
 * does not - a repeat, or packs. Never a refusal: the paid order goes ahead.
 */
export function noTrialLine(p: { tier: string; packs: number; repeat: TrialRepeat }, enabled: boolean = TRIAL.enabled): string | null {
  if (!enabled || p.tier !== "tracked") return null;
  if (p.packs > 0) return "No free trial with extra tracking packs, so the first charge is today.";
  // One sentence for either match (8 Oct 2026, audit security-3): naming which
  // one matched told anyone typing a rival's website or email into checkout
  // whether it was an alwayscited customer.
  if (p.repeat) return "The free trial is for first-time customers, so this order starts paid and the first charge is today.";
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The moment a trial ends and Stripe charges, in the client's own time zone:
 * "22 Oct 2026, 7:30pm ET" for a US client, "22 Oct 2026, 14:30 UK time" for
 * a UK one (8 Oct 2026, audit activation-3). A bare London date could read a
 * day after the charge - a US checkout at 4:30pm PT ends at 23:30 UTC, which
 * is the next day in London.
 */
export function trialMoment(iso: string, market: string): string {
  const t = new Date(iso);
  // The zone and the time's wording are check-time.ts's, which the dashboard's check times use too (9 Oct 2026).
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: marketZone(market), day: "numeric", month: "numeric", year: "numeric" }).formatToParts(t).map((p) => [p.type, p.value]));
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${clockIn(t, market)}`;
}

/** What the first charge will be, in the client's currency: "$129 a month", UK "£99 + VAT a month". */
export function trialCharge(market: string, price: { us: number; uk: number }): string {
  return market.toLowerCase() === "uk" ? `£${price.uk} + VAT a month` : `$${price.us} a month`;
}

/**
 * The dashboard's plan line while a trial is running or cancelled, or null
 * when the client is not on one (or it has ended).
 */
export function trialStatus(p: { trialEndsAt: string | null; cancelled: boolean; market: string; price: { us: number; uk: number }; now?: number }): string | null {
  if (!p.trialEndsAt) return null;
  if (new Date(p.trialEndsAt).getTime() <= (p.now ?? Date.now())) return null;
  const at = trialMoment(p.trialEndsAt, p.market);
  return p.cancelled ? `Trial cancelled - tracking stops ${at}` : `Free trial - ends ${at}. Then ${trialCharge(p.market, p.price)}.`;
}

/**
 * A paid plan's terms, in the words /legal's trial clause and the help centre
 * both use (9 Oct 2026, review of MK-2): the help had typed its own "thirty
 * days to stop" beside this one, a second copy of the notice period that
 * nothing held to the first. One string, so the two cannot drift.
 */
export const PLAN_TERMS = "monthly, no minimum term, thirty days to stop";

/**
 * The trial clause for /legal, drawn only while the trial is on. A draft:
 * legal copy for Danny to read before the switch, not reviewed by a lawyer.
 * Plain sentences so llms and the test read the same words the page does.
 */
export const TRIAL_TERMS: readonly string[] = [
  "alwaystracked comes with a 14-day free trial for a website and an email address that have not used us before. There is one trial per website and one per email address, ever; a repeat order is taken as a paid one, and the order form says so before you pay.",
  "The trial starts when you complete checkout, not at the first check, so days spent setting up count towards the 14.",
  "We take a card at checkout and charge nothing during the trial. The first charge is the monthly price - plus VAT in the UK - on day 15. The date is in the strip across the top of your dashboard, and Stripe shows it before you pay.",
  "To cancel during the trial, an owner opens Plan in the dashboard and uses Open billing, under Billing, to cancel on Stripe's billing page, or emails us. Tracking carries on until the trial ends and nothing is charged.",
  `Once the first charge is taken, the plan's usual terms apply: ${PLAN_TERMS}. Orders with extra tracking packs, and the other plans, have no trial.`,
];
