/**
 * Pricing configuration.
 *
 * Static by design: pricing must be deterministic and instant, and a displayed
 * price must not be able to change between someone seeing it and ordering it.
 *
 * All prices USD, monthly.
 *
 * The free surface is a one-off scan, promoted in the hero. It is not a tier -
 * every plan below is paid, because ongoing checks cost us money per account
 * and "free forever" was never true. There is no free tile.
 *
 * Each tier links to its own page. The homepage gets to the packages; the
 * detail of what is included lives on the package page.
 *
 * Outstanding: D1 (alwayscited placements per month) and D4 (sector list and
 * per-sector prices). Feature lines for those are omitted rather than guessed.
 */

import { TIER_PLAIN, type TierKey } from "@/components/TierName";
import { listIf, onlyIf } from "@/config/capabilities";
// The site's one list joiner. A second copy of "a, b and c" written here is
// the two-copies-of-one-function species this repo has already paid for once.
import { listOf } from "@/config/scan-shape";
import { TRIAL, TRIAL_CTA } from "@/config/trial";
// The sector tiers' "from" is computed, never typed (pricing spec section 3).
import { MAX_CLUSTERS, fromLabel, fromPrice } from "@/config/sector-pricing";
import type { Engine } from "@/lib/scan/engines";

/** Single destination for every CTA until real signup and booking flows exist. */
export const CONTACT_URL = "/contact";

/**
 * /contact for one tier, as `?tier=<plain tier word>` - the one pattern for
 * carrying a tier to the form, read back by ContactTier and posted with the
 * enquiry. The sector tiles' call CTAs add their picks (R69). alwaystracked
 * used it until it had a checkout (Danny, 26 Sep 2026; R91); since R148
 * (1 Oct 2026) no alwaystracked CTA does.
 */
export const CONTACT_TIER_PARAM = "tier";
export function contactUrlFor(tier: TierKey): string {
  return `${CONTACT_URL}?${CONTACT_TIER_PARAM}=${encodeURIComponent(TIER_PLAIN[tier])}`;
}

/**
 * The order form for one tier (R91, pricing spec section 5, 30 Sep 2026), in
 * the same `?tier=<plain tier word>` form /checkout reads back. The tier
 * pages' primary CTA for the three checkout tiers; a pick that prices as a
 * call still goes to contactUrlFor (SelectionCta).
 */
export const CHECKOUT_URL = "/checkout";
export function checkoutUrlFor(tier: TierKey): string {
  return `${CHECKOUT_URL}?${CONTACT_TIER_PARAM}=${encodeURIComponent(TIER_PLAIN[tier])}`;
}

/**
 * What the tracking base price covers: 10 clusters, each one Google keyword
 * joined to the 5 prompts buyers ask AI about it - 50 prompts and 10 keywords
 * (BRIEF-3, Danny, 29 Sep 2026; R112, danny.md line 104). Until 29 Sep this was
 * "20 questions and 10 keywords".
 *
 * Declared here because it is what the price buys, and a number that says
 * what a price includes is a claim to a buyer in the same way the price is.
 * The question count was once typed on four surfaces and two of them
 * disagreed ("checked weekly" against "a week").
 *
 * Literals, because the price censuses resolve `${NAME}` in the basis against
 * `export const NAME = <digits>;` here. The limits the server enforces live in
 * `src/lib/tracking/limits.ts`; `tracked-basis.test.mts` holds these equal to
 * them, so the copy cannot promise a cluster the API refuses.
 */
export const TRACKED_CLUSTERS = 10;
export const TRACKED_PROMPTS = 50;
export const TRACKED_KEYWORDS = 10;

/**
 * What the paid tiers deliver each month on one keyword cluster, as the
 * package pages' "On top, each month" block states it (Danny, 16 Oct 2026):
 * one cluster worked per plan (more are added at checkout), placements on alwaysmentioned and up, and at least this many link
 * insertions on alwayscited and up, written "2+".
 */
export const MONTHLY_CLUSTERS_WORKED = 1;
export const MONTHLY_PLACEMENTS = 3;
export const MONTHLY_INSERTIONS_MIN = 2;

/** What one +$49 pack adds (spec section 1, re-cut as clusters by R112). */
export const PACK_CLUSTERS = 5;
export const PACK_PROMPTS = 25;
export const PACK_KEYWORDS = 5;

/**
 * alwaystracked's "from" in each market (pricing spec sections 1 and 3): $129,
 * UK £99. The one tier priced here rather than in sector-prices.json. The
 * tier's basePrice below is the US half, written as a literal because the
 * price censuses read it as one; price-claims holds the two equal.
 */
export const TRACKED_PRICE = { us: 129, uk: 99 } as const;

/** What the tracking price covers, as every surface says it (spec section 8). */
export const TRACKED_BASIS = `${TRACKED_CLUSTERS} clusters: ${TRACKED_PROMPTS} prompts and ${TRACKED_KEYWORDS} keywords, checked daily`;

/**
 * The extra tracking pack, on any tier (spec section 1): +$49 / £39 a month
 * for another PACK_CLUSTERS clusters (PACK_PROMPTS prompts, PACK_KEYWORDS keywords).
 *
 * One currency at a time (Danny, 28 Sep 2026, danny.md line 62, R61): the line
 * used to print "+$49 / £39" whatever the page's market toggle said. `{price}`
 * is filled with the active market's figure by `PackLine` in SectorPrice.tsx;
 * the server, and a visitor with no script, read the US one, as they do every
 * other price on the page. For the higher tiers this is the second sentence of
 * the spec's line; the first is CLUSTERS_LINE below.
 */
export const TRACKING_PACK_PRICE = { us: 49, uk: 39 } as const;
export const TRACKING_PACK_LINE = `Extra tracking pack: {price}/mo for +${PACK_CLUSTERS} clusters (${PACK_PROMPTS} prompts, ${PACK_KEYWORDS} keywords).`;
/** The pack's price in one client's market, as the dashboard prints it: "$49", UK "£39". */
export function trackingPackPrice(market: string): string {
  return market === "UK" ? `£${TRACKING_PACK_PRICE.uk}` : `$${TRACKING_PACK_PRICE.us}`;
}
export function trackingPackLine(price: string): string {
  return TRACKING_PACK_LINE.replace("{price}", "+" + price);
}

/**
 * The first sentence of the spec's add-on line for the two tiers sold per
 * cluster (section 8). Held back until checkout existed; /checkout now takes
 * 1 to MAX_CLUSTERS clusters and sends more to a call (session.ts, R50 section
 * 5, 3768369), so the sentence is true. The figure is the one checkout
 * enforces, not typed (30 Sep 2026).
 */
export const CLUSTERS_LINE = `Add keyword clusters: up to ${MAX_CLUSTERS} at checkout, more on a call.`;

/**
 * Which engines each tier reads (pricing spec, Danny, 27 Sep 2026, sections 1
 * and 4). alwaystracked reads the four the free scan reads; every higher tier
 * adds Claude as a fifth on the plan's own prompts. The +$49 tracking pack
 * stays at four on every tier (open decision 4), so this is the plan, not the
 * pack. One list, read by every surface that draws the logos, so a tile cannot
 * show five where the tier page shows four.
 */
export const TRACKING_ENGINES: readonly Engine[] = ["google_aio", "chatgpt", "gemini", "perplexity"];
export const PLAN_ENGINES: readonly Engine[] = [...TRACKING_ENGINES, "claude"];
export function enginesFor(tier: TierKey): readonly Engine[] {
  return tier === "tracked" ? TRACKING_ENGINES : PLAN_ENGINES;
}

export type Tier = {
  id: string;
  /** Which lockup the TierName component renders. */
  key: TierKey;
  /** Plan variant, rendered outside the brand word. */
  qualifier?: string;
  /** Unstyled one-word form for plain-text contexts (meta, alt, JSON-LD). */
  plainName: string;
  /** Base monthly price in USD. null = not a numeric price. */
  basePrice: number | null;
  priceLabel: string;
  /**
   * What the headline price actually buys, shown under it.
   *
   * A bare "$99/mo" is not quotable: an agency puts it in front of a client,
   * then finds the price moves with prompt count and check frequency. The
   * basis travels with the number so that cannot happen.
   */
  priceBasis?: string;
  positioning: string;
  /** The package page this tier links to. */
  href: string;
  includes: string[];
  cta: { label: string; href: string };
  /**
   * The tier's buying verb, on the packages table's button and the tier
   * page's primary CTA - one set, here only (Danny, 28 Sep 2026, R79). Not
   * `cta.label`, which is the secondary "See what is included" link.
   */
  action: string;
  emphasis?: boolean;
};

/**
 * Ascending intensity. Critique 2.3: alwaystracked is split into two cards so
 * the free and paid offers are not one card with two prices.
 */
export const TIERS: Tier[] = [
  {
    id: "tracked",
    key: "tracked",
    plainName: TIER_PLAIN.tracked,
    // Pricing spec section 1 (27 Sep 2026): from $129, UK £99. The one tier
    // priced here rather than in sector-prices.json.
    basePrice: 129,
    priceLabel: "from $129/mo",
    // Spec section 8: the daily basis. The add-on is its own line, in the
    // page's market (TRACKING_PACK_LINE, R61).
    priceBasis: `${TRACKED_CLUSTERS} clusters: ${TRACKED_PROMPTS} prompts and ${TRACKED_KEYWORDS} keywords, checked daily`,
    positioning: "Know what your coverage did",
    href: "/alwaystracked",
    // Checkout lists the first three. Coverage matching, the host article's
    // position and white-label reports are not built for this tier, so each
    // waits on its capability (LB1, 8 Oct 2026, config/capabilities.ts).
    includes: [
      "Ongoing AI visibility tracking",
      "Category leaderboard and cited sources",
      ...listIf("coverageUpload", "Coverage matching, URL for URL"),
      onlyIf("hostArticleRankings", "Google positions for the article and the client page") ?? "Google positions for the client page",
      ...listIf("reportBranding", "White-label reports"),
    ],
    cta: { label: "See what is included", href: "/alwaystracked" },
    // The trial names itself on the button while it is on (8 Oct 2026, config/trial.ts).
    action: TRIAL.enabled ? TRIAL_CTA : "Start tracking",
  },
  {
    id: "mentioned",
    key: "mentioned",
    plainName: TIER_PLAIN.mentioned,
    basePrice: fromPrice("mentioned", "us"),
    priceLabel: fromLabel("mentioned"),
    positioning: "Get named when AI recommends",
    href: "/alwaysmentioned",
    includes: [
      "3 placements a month on one keyword cluster",
      "Placed in sources the engines already cite",
      `Everything in ${TIER_PLAIN.tracked}`,
    ],
    cta: { label: "See what is included", href: "/alwaysmentioned" },
    action: "Get recommended",
  },
  {
    id: "cited",
    key: "cited",
    plainName: TIER_PLAIN.cited,
    basePrice: fromPrice("cited", "us"),
    priceLabel: fromLabel("cited"),
    positioning: "Get cited, and rank for it",
    href: "/alwayscited",
    includes: [
      "Schema work on your pages",
      "Link insertions from the placements",
      `Everything in ${TIER_PLAIN.mentioned}`,
    ],
    cta: { label: "See what is included", href: "/alwayscited" },
    action: "Get cited",
    emphasis: true,
  },
  {
    id: "everywhere",
    key: "everywhere",
    plainName: TIER_PLAIN.everywhere,
    basePrice: null,
    priceLabel: "Book a call",
    // Danny, 28 Sep 2026 (danny.md 73, R72): brand PR on top of the
    // alwayscited plan, sold to brands direct - no longer a portfolio.
    priceBasis: `Where brand PR comes in. Earned coverage in the press and trade media your buyers read, on top of everything in ${TIER_PLAIN.cited}, so you lead the whole conversation, not just search and AI answers. Scoped on a call, sold to brands direct.`,
    positioning: "Be the name everywhere buyers look",
    href: "/alwayseverywhere",
    includes: [
      `Everything in ${TIER_PLAIN.cited}`,
      "Brand PR for earned media",
      "Run by our senior team",
    ],
    cta: { label: "See what is included", href: "/alwayseverywhere" },
    action: "Be everywhere",
  },
];

/**
 * Which tiers a visitor can read a price for, and which are a call.
 *
 * Derived here because four surfaces asserted the answer by hand and all four
 * were wrong. `/how-it-works` said "Every price is published, from tracking
 * alone up to alwayseverywhere" - naming, as the top of the published range,
 * the one tier whose `priceLabel` is "Book a call". The closing CTA on that
 * page and on /what-is-aeo said the same thing twice over, the 404 page's tier
 * link said "Four tiers, every price published on the page", and
 * /what-is-aeo's pricing FAQ opened "Ours are published rather than quoted."
 *
 * What makes it the expensive kind of wrong is that the site already says the
 * opposite, correctly, on the tier's own page: /alwayseverywhere explains that
 * the number of brands and markets changes the work "so we quote it rather
 * than post a figure we would have to renegotiate". A buyer could read both
 * sentences on one visit.
 *
 * Two readers of `basePrice` already understand this and neither was joined to
 * the copy: `priceProse` returns null for a tier with no number, and
 * `PackagePage`'s `serviceSchema` emits no Offer node for one. The copy is the
 * third reader and it was typed. It is derived now, so the day
 * `alwayseverywhere` gets a figure the sentences correct themselves rather
 * than a test asking somebody to.
 *
 * `basePrice === null` is the same test those two make. `isPriceLabel` in
 * price-label.ts answers the neighbouring question - whether the LABEL is a
 * price, which is what decides the type size - and `price-claims.test.mts`
 * holds the two in agreement rather than letting this file pick one.
 */
export const PRICED_TIERS: Tier[] = TIERS.filter((t) => t.basePrice !== null);

/** The complement. A tier here has a call where its price would be. */
export const QUOTED_TIERS: Tier[] = TIERS.filter((t) => t.basePrice === null);

/**
 * The dearest tier a visitor can read a price for.
 *
 * `TIERS` is documented above as ascending intensity, so this is the last
 * priced entry rather than a named one. Taken off the end of a derived list
 * instead of by a fixed index into `TIERS`, which is the ladder-with-a-ceiling
 * shape this repo keeps finding - a rung picked by position against a list
 * that can grow. Undefined only if nothing is priced, which the clauses below
 * handle rather than assume away.
 */
export const DEAREST_PRICED_TIER: Tier | undefined = PRICED_TIERS[PRICED_TIERS.length - 1];

/**
 * What the site may claim about the prices it publishes.
 *
 * Plain text, carrying `plainName` rather than markup, for the reason every
 * other shared string here is plain: it has to serve JSON-LD and meta as well
 * as body copy, and `TierText` renders the lockup on the way to the page. See
 * the note on `TierText` itself.
 *
 * Kept as two clauses rather than one sentence because /what-is-aeo needs to
 * interleave the figures between them, and a second phrasing written there to
 * get that is how the four copies above happened in the first place.
 */
export function publishedPricesClause(): string {
  if (!DEAREST_PRICED_TIER) return "";
  if (QUOTED_TIERS.length === 0) {
    return `Every price is published, up to and including ${DEAREST_PRICED_TIER.plainName}.`;
  }
  return `Every price up to the ${DEAREST_PRICED_TIER.plainName} plan is published.`;
}

/**
 * The other half: what is quoted, and why.
 *
 * Empty when nothing is quoted, so a caller joining the two gets the whole
 * claim and no dangling clause. The reason is not invented here - it is what
 * /alwayseverywhere already tells a reader, reduced to one clause, and it
 * avoids a pronoun so it still reads if a second tier is ever quoted.
 */
export function quotedPricesClause(): string {
  if (QUOTED_TIERS.length === 0) return "";
  const names = QUOTED_TIERS.map((t) => t.plainName);
  const list = names.length === 1 ? names[0] : listOf(names);
  return `We quote ${list}, because the number of brands and markets changes the work.`;
}

/** Both clauses, for the surfaces that want the whole claim in one string. */
export function pricePublication(): string {
  return [publishedPricesClause(), quotedPricesClause()].filter(Boolean).join(" ");
}

/**
 * The headline price as a sentence says it, for every context that cannot
 * carry the UI label: meta descriptions, OG and Twitter text, plain-text
 * email. "$995/mo" is a price tag; "$995 a month" is prose.
 *
 * It exists because all three priced pages typed their own price into
 * `metadata.description` on the line below the one that resolves the tier.
 * A price in a meta description is the claim a buyer reads in a search result
 * before they ever reach the page, so it is the worst of the three places for
 * a number nothing keeps in step - and `c2bf546` is this same mistake made
 * once already, in copy rather than in config, when the homepage sold a floor
 * as a flat price.
 *
 * Derived from `priceLabel` rather than rebuilt from `basePrice`, so the
 * "from" on a tier whose price moves with volume travels with the number.
 * Dropping it is the one bug the deleted `priceFor` had already been fixed
 * for; the note at the bottom of this file records that, and this is the
 * function that would otherwise have rediscovered it.
 *
 * A tier with no numeric price gets null rather than a string. Its label is a
 * call to action - "Book a call" - and a sentence about money is the one place
 * that must not be dropped into. The caller leaves the clause out instead.
 */
export function priceProse(tier: Tier): string | null {
  if (tier.basePrice === null) return null;
  return tier.priceLabel.replace("/mo", " a month");
}

/**
 * Sector pricing - removed, not forgotten. Still outstanding on D4 (the sector
 * list, and the alwaysmentioned and alwayscited price for each).
 *
 * This file used to carry `Sector`, an empty `SECTORS`, `formatUsd`,
 * `priceFor` and a `sectorPriced` flag on every tier, all of it feeding
 * `SectorPricing.tsx`. That component went in the redesign, and nothing has
 * imported any of it since - so what was left was a types-and-helpers block
 * whose doc comment told the next reader that "the selector below renders
 * only once this is populated". There is no selector below. A comment that
 * sends somebody looking for a component that was deleted costs more than the
 * code it documents.
 *
 * The decision it was really recording is the part worth keeping, so it is
 * stated here instead: **per-sector prices are not known and are not to be
 * invented.** Until Danny supplies the sector list with a price for
 * alwaysmentioned and alwayscited in each, every tier shows its base price
 * and no sector selector exists anywhere on the site.
 *
 * Bringing it back is a small job against a populated list - one entry per
 * sector, `{ id, label, prices: { mentioned, cited } }` - plus a resolver that
 * keeps a label saying more than its number ("from $99/mo") rather than
 * rebuilding the string from `basePrice` and silently dropping the "from".
 * That last detail is the one bug the old `priceFor` had already been fixed
 * for, and it is recorded here so it is not rediscovered the hard way.
 */
