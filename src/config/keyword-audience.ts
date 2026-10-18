/**
 * Find keywords' B2B / B2C toggle (Danny, 18 Oct 2026: "a way to generate
 * terms that are aligned with consumers or businesses"). The words that mark
 * a search as a business buyer's or a consumer's, the extra seed each side
 * asks DataForSEO about, and the sectors that set the default. Read by
 * src/lib/dash/audience.ts only.
 */

export const AUDIENCES = ["all", "b2b", "b2c"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Whole words or phrases; matched case-insensitively at word boundaries. */
export const AUDIENCE_TERMS: Record<Exclude<Audience, "all">, readonly string[]> = {
  b2b: ["software", "platform", "provider", "providers", "agency", "agencies", "for business", "for businesses", "business", "enterprise", "pricing", "vs", "versus", "solution", "solutions", "services", "service", "companies", "company", "firm", "firms", "wholesale", "b2b", "vendor", "vendors", "consultant", "consultancy", "outsourcing", "saas"],
  b2c: ["best", "cheap", "cheapest", "near me", "reviews", "review", "for home", "buy", "deals", "deal", "how to", "top rated", "top-rated", "affordable", "discount", "sale", "for kids", "for men", "for women", "gift", "diy"],
};

/** The extra seed each side asks for related searches with: "<seed> services", "best <seed>". */
export const AUDIENCE_SEED: Record<Exclude<Audience, "all">, (seed: string) => string> = {
  b2b: (seed) => `${seed} services`,
  b2c: (seed) => `best ${seed}`,
};

/** The default from the order's sector (config/sector-prices.json ids); anything else starts on All. */
export const SECTOR_AUDIENCE: Record<string, Exclude<Audience, "all">> = {
  business: "b2b",
  marketing: "b2b",
  legal: "b2b",
  technology: "b2b",
  careers: "b2b",
  manufacturing: "b2b",
  science: "b2b",
  retail: "b2c",
  travel: "b2c",
  food: "b2c",
  home: "b2c",
  entertainment: "b2c",
  sports: "b2c",
  animals: "b2c",
};
