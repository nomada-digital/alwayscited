"use client";

import { useEffect, useRef, useState } from "react";

import { MarketToggle, useSeededMarket } from "@/components/SectorPrice";
import { CHECKOUT_LIMITS } from "@/config/contact";
import { TRACKED_PRICE, contactUrlFor } from "@/config/pricing";
import { TRIAL_CTA, trialLine } from "@/config/trial";
import { CURRENCY, MARKETS, MAX_CLUSTERS, SECTORS, formatPrice, quoteFor, type Market } from "@/config/sector-pricing";
import { withSelection, type Selection } from "@/config/sector-selection";
import { CARD, MICRO, T } from "@/config/tokens";
import { gaClientId, track } from "@/lib/analytics";
import type { CheckoutTier } from "@/lib/checkout/session";
import { TIER_PLAIN } from "@/lib/tier-text";

/**
 * The order summary card (Danny, 1 Oct 2026, danny.md lines 156-157): plan,
 * three inclusions, the market toggle the tier pages use, the price, then
 * the email, the keyword and one button. /checkout never asks for the market
 * in a dropdown; it comes from the tier page's link or the toggle, and the
 * price follows the toggle with no reload.
 *
 * Plain HTML still works with no script: the toggle's pills are links back
 * here in the other market, and on the per-cluster tiers the sector and
 * cluster picks sit in their own GET form with "Update price". The email is
 * only ever in the POST form, so it never reaches a URL.
 */

const ERRORS: Record<string, string> = {
  email: "Type your email again, in the form name@company.com.",
  keyword: `A keyword target of at least ${CHECKOUT_LIMITS.keyword.min} characters is needed.`,
  website: "Type your website again, in the form company.com.",
  failed: "The checkout did not open. Please try again, or book a call.",
};

const fieldError: React.CSSProperties = { display: "block", marginTop: "6px", fontSize: "13px", fontWeight: 400, letterSpacing: 0, textTransform: "none", color: T.badFg };

const field: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: "6px",
  padding: "10px 12px",
  fontFamily: "inherit",
  fontSize: "15px",
  color: T.ink,
  background: T.surface,
  border: `1px solid ${T.line}`,
  borderRadius: "10px",
};

const button: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "15px",
  fontWeight: 600,
  borderRadius: "999px",
  padding: "12px 22px",
  cursor: "pointer",
};

const rule: React.CSSProperties = { borderTop: `1px solid ${T.line}`, margin: "20px 0 0", paddingTop: "20px" };

type Props = {
  tier: CheckoutTier;
  tierPlain: string;
  plan: React.ReactNode;
  tierPage: string;
  /** The plan's first three inclusions, through TierText on the server. */
  includes: React.ReactNode[];
  initial: Selection;
  scan: string | null;
  keyword: string;
  /** Asked only without a scan: the webhook builds the dashboard for it (R158, 1 Oct 2026). */
  website: string;
  error?: string;
};

function priceFor(tier: CheckoutTier, sel: Selection): { price: string | null; amount: number | null; call: boolean } {
  if (tier === "tracked") return { price: `${formatPrice(TRACKED_PRICE[sel.market], sel.market)}/mo`, amount: TRACKED_PRICE[sel.market], call: false };
  if (sel.qty > MAX_CLUSTERS) return { price: null, amount: null, call: true };
  if (!sel.sector) return { price: null, amount: null, call: false };
  const quote = quoteFor(sel.sector, sel.market, tier, sel.qty);
  return quote.kind === "call" ? { price: null, amount: null, call: true } : { price: `${formatPrice(quote.amount, sel.market)}/mo`, amount: quote.amount, call: false };
}

export default function CheckoutOrder({ tier, tierPlain, plan, tierPage, includes, initial, scan, keyword, website, error }: Props) {
  const market = useSeededMarket(initial.market);
  const [sector, setSector] = useState(initial.sector);
  const [qty, setQty] = useState(initial.qty);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // R151 (1 Oct 2026): the order posts to /api/checkout, which opens Stripe -
  // a second or two with nothing moving, and a second click opened a second
  // session. Busy from submit; back from Stripe restores this page from the
  // bfcache with busy still set, so pageshow clears it.
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const perCluster = tier !== "tracked";
  const sel: Selection = { sector, qty, market };
  const { price, amount, call } = priceFor(tier, sel);
  // The GA client id, filled at submit and only after a yes to analytics (lib/analytics.ts).
  const gaField = useRef<HTMLInputElement>(null);
  const base = `/checkout?tier=${tierPlain}${scan ? `&scan=${scan}` : ""}`;
  const links = Object.fromEntries(MARKETS.map((m) => [m, withSelection(base, { ...sel, market: m as Market })])) as Record<Market, string>;

  // The URL follows the picks, so a reload or a shared link is the same order.
  useEffect(() => {
    if (!mounted) return;
    const url = withSelection(base, sel);
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", url);
  });

  return (
    <div style={{ ...CARD, padding: "24px", marginTop: "26px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>{plan}</div>
        <a href={tierPage} style={{ fontSize: "14px", color: T.accent }}>
          What the plan includes
        </a>
      </div>
      <ul style={{ margin: "12px 0 0", paddingLeft: "18px", listStyle: "disc", fontSize: "14.5px", lineHeight: 1.7, color: T.soft }}>
        {includes.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      <div style={rule}>
        <MarketToggle links={links} initial={initial.market} style={{ color: T.ink }} />
        {perCluster ? (
          <form method="get" action="/checkout" style={{ display: "grid", gap: "14px", marginTop: "16px" }}>
            <input type="hidden" id="checkout-pick-tier" name="tier" value={tierPlain} maxLength={CHECKOUT_LIMITS.tier} />
            {scan ? <input type="hidden" id="checkout-pick-scan" name="scan" value={scan} maxLength={CHECKOUT_LIMITS.scan} /> : null}
            <input type="hidden" name="market" value={market} maxLength={CHECKOUT_LIMITS.market} />
            <label style={MICRO}>
              Sector
              <select name="sector" value={sector} onChange={(e) => setSector(e.target.value)} style={field}>
                <option value="">Pick a sector</option>
                {SECTORS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={MICRO}>
              Clusters
              <select name="clusters" value={String(Math.min(qty, MAX_CLUSTERS))} onChange={(e) => setQty(Number(e.target.value))} style={field}>
                {Array.from({ length: MAX_CLUSTERS }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </option>
                ))}
              </select>
              {/* The spec's "more on a call" at checkout (R50 section 8). */}
              <span style={{ display: "block", marginTop: "6px", fontSize: "13px", fontWeight: 400, letterSpacing: 0, textTransform: "none", color: T.soft }}>
                More than {MAX_CLUSTERS}?{" "}
                <a href={withSelection(contactUrlFor(tier), sel)} style={{ color: T.accent }}>
                  We set that up on a call
                </a>
                .
              </span>
            </label>
            {/* With script the price follows the selects; without, this re-prices. */}
            {mounted ? null : (
              <button type="submit" style={{ ...button, justifySelf: "start", background: "transparent", color: T.ink, border: `1px solid ${T.line}` }}>
                Update price
              </button>
            )}
          </form>
        ) : null}
        <div style={{ marginTop: "16px", fontSize: "26px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }} data-figure="checkout-price" aria-live="polite">
          {price ?? (call ? "Book a call" : "Pick a sector")}
          {/* UK prices are before VAT, which Stripe Tax adds on its page (R129, 30 Sep 2026). */}
          {price && market === "uk" ? <span style={{ fontSize: "15px", fontWeight: 500, letterSpacing: 0, color: T.soft }}> plus VAT</span> : null}
        </div>
        {/* The alwaystracked trial, only while config/trial.ts has it on. A
            repeat domain or email is told on Stripe's own form that it pays
            from today; no checkout sells a pack yet, so there is no pack line. */}
        {trialLine(tier) ? <p style={{ margin: "6px 0 0", fontSize: "14px", lineHeight: 1.5, color: T.ink, fontWeight: 600 }}>{trialLine(tier)}</p> : null}
      </div>

      {call ? (
        <p style={{ ...rule, fontSize: "15px", lineHeight: 1.7, color: T.soft }}>
          These picks are priced on a call.{" "}
          <a href={withSelection(contactUrlFor(tier), sel)} style={{ color: T.accent, fontWeight: 600 }}>
            Book a call
          </a>
        </p>
      ) : price ? (
        <form
          method="post"
          action="/api/checkout"
          onSubmit={(e) => {
            if (busy) {
              e.preventDefault();
              return;
            }
            setBusy(true);
            if (gaField.current) gaField.current.value = gaClientId() ?? "";
            track("begin_checkout", { plan: TIER_PLAIN[tier], market, currency: CURRENCY[market].code, value: amount ?? undefined });
          }}
          style={rule}
        >
          <input type="hidden" id="checkout-tier" name="tier" value={tier} maxLength={CHECKOUT_LIMITS.tier} />
          <input type="hidden" id="checkout-market" name="market" value={market} maxLength={CHECKOUT_LIMITS.market} />
          <input type="hidden" ref={gaField} id="checkout-ga" name="ga_client_id" defaultValue="" maxLength={CHECKOUT_LIMITS.gaClientId} />
          {scan ? <input type="hidden" id="checkout-scan" name="scan" value={scan} maxLength={CHECKOUT_LIMITS.scan} /> : null}
          {perCluster ? (
            <>
              <input type="hidden" id="checkout-sector" name="sector" value={sector} maxLength={CHECKOUT_LIMITS.sector} />
              <input type="hidden" id="checkout-quantity" name="quantity" value={String(qty)} maxLength={CHECKOUT_LIMITS.clusters} />
            </>
          ) : null}
          {error === "failed" ? (
            <p role="alert" style={{ margin: "0 0 14px", fontSize: "14px", color: T.badFg }}>
              {ERRORS.failed}
            </p>
          ) : null}
          <div style={{ display: "grid", gap: "14px" }}>
            <label style={MICRO}>
              Email
              <input
                type="email"
                id="checkout-email"
                name="email"
                required
                maxLength={CHECKOUT_LIMITS.email}
                autoComplete="email"
                autoFocus={error === "email"}
                aria-invalid={error === "email" || undefined}
                aria-describedby={error === "email" ? "checkout-email-error" : undefined}
                style={field}
              />
              {error === "email" ? (
                <span id="checkout-email-error" role="alert" style={fieldError}>
                  {ERRORS.email}
                </span>
              ) : null}
            </label>
            {scan ? null : (
              <label style={MICRO}>
                Your website
                <input
                  type="text"
                  id="checkout-website"
                  name="website"
                  defaultValue={website}
                  required
                  maxLength={CHECKOUT_LIMITS.website}
                  placeholder="company.com"
                  autoComplete="url"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus={error === "website"}
                  aria-invalid={error === "website" || undefined}
                  aria-describedby={error === "website" ? "checkout-website-error" : undefined}
                  style={field}
                />
                {error === "website" ? (
                  <span id="checkout-website-error" role="alert" style={fieldError}>
                    {ERRORS.website}
                  </span>
                ) : null}
              </label>
            )}
            <label style={MICRO}>
              {perCluster ? "Keyword target" : "Keyword target (optional)"}
              <input
                type="text"
                id="checkout-keyword"
                name="keyword"
                defaultValue={keyword}
                required={perCluster}
                minLength={perCluster ? CHECKOUT_LIMITS.keyword.min : undefined}
                maxLength={CHECKOUT_LIMITS.keyword.max}
                autoFocus={error === "keyword"}
                aria-invalid={error === "keyword" || undefined}
                aria-describedby={error === "keyword" ? "checkout-keyword-error" : undefined}
                style={field}
              />
              {error === "keyword" ? (
                <span id="checkout-keyword-error" role="alert" style={fieldError}>
                  {ERRORS.keyword}
                </span>
              ) : null}
            </label>
          </div>
          <p style={{ margin: "16px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
            {trialLine(tier) ? "Free for 14 days, then billed monthly. After the first charge, 30 days' notice to cancel." : <>Billed monthly. 30 days&apos; notice to cancel{perCluster ? ", because placements may still be in progress" : ""}.</>}
            {perCluster ? " A refund if the keyword turns out not to be workable." : ""}
          </p>
          <button type="submit" aria-disabled={busy || undefined} style={{ ...button, width: "100%", marginTop: "16px", background: T.accent, color: T.surface, border: `1px solid ${T.accent}`, cursor: busy ? "progress" : "pointer" }}>
            {busy ? (
              <>
                <span className="btn-spin" aria-hidden="true" />
                Opening payment...
              </>
            ) : (
              trialLine(tier) ? TRIAL_CTA : "Continue to payment"
            )}
          </button>
          <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: "13px", lineHeight: 1.6, color: T.soft }}>Got a promo code? Add it on the next page.</p>
        </form>
      ) : null}
    </div>
  );
}
