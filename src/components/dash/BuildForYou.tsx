import { TIERS, checkoutUrlFor, contactUrlFor } from "@/config/pricing";
import { SITE_ORIGIN } from "@/lib/app-host";
import { type OfferTier, type Pricing, type Recommendation, upgradeCards } from "@/lib/dash/recommendations";

/**
 * Where an offer's price and link come from: config/pricing.ts and nowhere else (22 Nov 2026). A tier that prices as
 * a call (no base price) goes to the contact form, as the tier pages do; the rest go to the order form. The price
 * text is the tier's own priceLabel, so a change there is the only change needed.
 */
const tierOf = (t: OfferTier) => TIERS.find((x) => x.key === t);
export const PRICING: Pricing = {
  priceLabel: (t) => tierOf(t)?.priceLabel ?? "",
  href: (t) => `${SITE_ORIGIN}${tierOf(t)?.basePrice === null ? contactUrlFor(t) : checkoutUrlFor(t)}`,
};

/**
 * "We could build this for you": one quiet card, at most two offers, for a customer on alwaystracked only (the
 * cards are empty for any other plan). What we could do, why it matters, one link to the upgrade path. Nothing
 * here counts down, limits or presses.
 */
export default function BuildForYou({ upgrades, tier }: { upgrades: readonly Recommendation[]; tier: string }) {
  const cards = upgradeCards(upgrades, tier, PRICING);
  if (!cards.length) return null;
  return (
    <div className="dash-card rec-build">
      <div className="dash-card-head">
        <div>
          <h2>We could build this for you</h2>
          <p className="intro">Everything above you can do yourself. If you would rather hand a part of it over, this is what we could take on.</p>
        </div>
      </div>
      <div className="rec-build-list">
        {cards.map((c) => (
          <div key={c.id} className="rec-build-item">
            <b>{c.what}</b>
            <p className="muted">{c.why}</p>
            <div className="rec-build-foot">
              <a className="btn sm" href={c.href}>Look at this plan</a>
              {c.priceLabel ? <span className="faint">{c.priceLabel}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
