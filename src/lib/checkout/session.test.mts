import assert from "node:assert/strict";
import { test } from "node:test";

import { quoteFor, SECTORS } from "../../config/sector-pricing.ts";
import { parseSelection, tierFromPlain } from "../../config/sector-selection.ts";
import { TIER_PLAIN } from "../tier-text.ts";
import { checkoutRequest, type CheckoutContext, type Order } from "./session.ts";

/** R91 (29 Sep 2026): the Session a checkout asks Stripe for. No Stripe call is made here. */

// Made-up figures: the rule under test is that the context's figure is used, not what it is.
const ctx: CheckoutContext = { trackedPrice: { us: 7, uk: 5 }, names: { tracked: "t-name", mentioned: "m-name", cited: "c-name" }, origin: "https://alwayscited.com" };
const priced = SECTORS.find((s) => s.prices)!;
const order = (o: Partial<Order> = {}): Order => ({ tier: "mentioned", sector: priced.id, quantity: 3, market: "us", email: "Buyer@Example.com", keyword: "accounting software", website: "https://www.Buyer-Site.com/about", ...o });

test("the amount comes from the price config, times quantity, in cents", () => {
  const r = checkoutRequest(order(), ctx);
  assert.equal(r.kind, "session");
  if (r.kind !== "session") return;
  const one = quoteFor(priced.id, "us", "mentioned", 1);
  assert.equal(one.kind, "price");
  if (one.kind !== "price") return;
  assert.equal(r.form.get("line_items[0][price_data][unit_amount]"), String(one.amount * 100));
  assert.equal(r.form.get("line_items[0][quantity]"), "3");
  assert.equal(r.amount, one.amount * 3);
  assert.equal(r.form.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(r.form.get("line_items[0][price_data][product_data][name]"), "m-name");
});

test("every Session allows promotion codes, is monthly, and returns to alwayscited.com", () => {
  for (const o of [order(), order({ tier: "cited", market: "uk" }), order({ tier: "tracked", sector: "", keyword: "" })]) {
    const r = checkoutRequest(o, ctx);
    assert.equal(r.kind, "session", JSON.stringify(o));
    if (r.kind !== "session") continue;
    assert.equal(r.form.get("allow_promotion_codes"), "true");
    assert.equal(r.form.get("mode"), "subscription");
    assert.equal(r.form.get("line_items[0][price_data][recurring][interval]"), "month");
    assert.ok(r.form.get("success_url")!.startsWith("https://alwayscited.com/"));
    assert.ok(r.form.get("cancel_url")!.startsWith("https://alwayscited.com/"));
    assert.equal(r.form.get("customer_email"), "buyer@example.com");
  }
});

test("the success URL names the plan, and from=scan only when a scan token rides on the order, else from=site (R148 pass 8; R158, 1 Oct 2026)", () => {
  const tok = "0123456789abcdef0123456789abcdef";
  const withScan = checkoutRequest(order({ tier: "tracked", sector: "", keyword: "", scan: tok }), ctx);
  const without = checkoutRequest(order({ tier: "cited" }), ctx);
  const junk = checkoutRequest(order({ scan: "not-a-token" }), ctx);
  assert.ok(withScan.kind === "session" && without.kind === "session" && junk.kind === "session");
  assert.equal(withScan.form.get("success_url"), "https://alwayscited.com/checkout/done?session={CHECKOUT_SESSION_ID}&plan=tracked&from=scan");
  assert.equal(without.form.get("success_url"), "https://alwayscited.com/checkout/done?session={CHECKOUT_SESSION_ID}&plan=cited&from=site");
  assert.equal(junk.form.get("success_url"), "https://alwayscited.com/checkout/done?session={CHECKOUT_SESSION_ID}&plan=mentioned&from=site");
});

test("Stripe's back link returns to /checkout with the picks, read back by the page's own parsers, never the email (R151, 1 Oct 2026)", () => {
  const real: CheckoutContext = { ...ctx, names: { tracked: TIER_PLAIN.tracked, mentioned: TIER_PLAIN.mentioned, cited: TIER_PLAIN.cited } };
  const tok = "0123456789abcdef0123456789abcdef";
  const cited = checkoutRequest(order({ tier: "cited", market: "uk" }), real);
  const tracked = checkoutRequest(order({ tier: "tracked", sector: "", keyword: "", scan: tok }), real);
  assert.ok(cited.kind === "session" && tracked.kind === "session");
  const a = new URL(cited.form.get("cancel_url")!);
  assert.equal(a.origin + a.pathname, "https://alwayscited.com/checkout");
  assert.equal(tierFromPlain(a.searchParams.get("tier")), "cited");
  assert.deepEqual(parseSelection(a.searchParams), { sector: priced.id, qty: 3, market: "uk" });
  assert.equal(a.searchParams.get("keyword"), "accounting software");
  assert.equal(a.searchParams.get("website"), "buyer-site.com");
  const b = new URL(tracked.form.get("cancel_url")!);
  assert.equal(tierFromPlain(b.searchParams.get("tier")), "tracked");
  assert.equal(b.searchParams.get("scan"), tok);
  assert.equal(b.searchParams.get("website"), null);
  for (const r of [cited, tracked]) assert.ok(!r.form.get("cancel_url")!.toLowerCase().includes("example.com"), "the email stays out of the URL");
});

test("an order without a scan needs the buyer's website, carried normalised; with a scan it is not asked (R158, 1 Oct 2026)", () => {
  const tok = "0123456789abcdef0123456789abcdef";
  for (const website of [undefined, "", "   ", "not a site", "localhost", `${"a".repeat(250)}.com`]) {
    assert.equal(checkoutRequest(order({ website }), ctx).kind, "invalid", `website ${JSON.stringify(website)}`);
    assert.equal(checkoutRequest(order({ tier: "tracked", sector: "", keyword: "", website }), ctx).kind, "invalid");
  }
  const r = checkoutRequest(order(), ctx);
  assert.ok(r.kind === "session");
  assert.equal(r.form.get("metadata[website]"), "buyer-site.com");
  assert.equal(r.form.get("subscription_data[metadata][website]"), "buyer-site.com");
  const withScan = checkoutRequest(order({ scan: tok, website: undefined }), ctx);
  assert.ok(withScan.kind === "session");
  assert.equal(withScan.form.get("metadata[website]"), null, "the scan names the domain");
  assert.equal(withScan.form.get("metadata[scan_token]"), tok);
});

test("every Session charges tax through Stripe Tax on a tax-exclusive price (R129, 30 Sep 2026)", () => {
  for (const tier of ["tracked", "mentioned", "cited"]) {
    for (const market of ["uk", "us"]) {
      const r = checkoutRequest(order({ tier, market }), ctx);
      assert.equal(r.kind, "session");
      if (r.kind !== "session") continue;
      assert.equal(r.form.get("automatic_tax[enabled]"), "true");
      assert.equal(r.form.get("tax_id_collection[enabled]"), "true");
      assert.equal(r.form.get("billing_address_collection"), "required");
      assert.equal(r.form.get("line_items[0][price_data][tax_behavior]"), "exclusive", "prices are before VAT");
      // 23 Oct 2026: the buyer's name has its own field, so Customer.name is never an address line.
      assert.equal(r.form.get("name_collection[individual][enabled]"), "true");
      // 23 Oct 2026: the monthly price before VAT rides on the Session and the subscription, for the hub's book value.
      assert.match(r.form.get("metadata[monthly_amount]") ?? "", /^\d+$/);
      assert.equal(r.form.get("subscription_data[metadata][monthly_amount]"), r.form.get("metadata[monthly_amount]"));
      assert.equal(Number(r.form.get("metadata[monthly_amount]")), Math.round(r.amount * 100), "unit times quantity, in pence or cents");
    }
  }
});

test("alwaystracked is one subscription at the configured price per market", () => {
  const r = checkoutRequest(order({ tier: "tracked", market: "uk", quantity: 4, sector: "", keyword: "" }), ctx);
  assert.equal(r.kind, "session");
  if (r.kind !== "session") return;
  assert.equal(r.form.get("line_items[0][price_data][unit_amount]"), "500");
  assert.equal(r.form.get("line_items[0][quantity]"), "1");
  assert.equal(r.currency, "gbp");
});

test("what the spec sells by call is refused as a call, never a Session", () => {
  assert.equal(checkoutRequest(order({ tier: "everywhere" }), ctx).kind, "call");
  assert.equal(checkoutRequest(order({ sector: "other" }), ctx).kind, "call");
  assert.equal(checkoutRequest(order({ quantity: 11 }), ctx).kind, "call");
});

test("an order the browser could forge is refused, and no field sets the amount", () => {
  assert.equal(checkoutRequest(order({ market: "eu" }), ctx).kind, "invalid");
  assert.equal(checkoutRequest(order({ email: "nope" }), ctx).kind, "invalid");
  assert.equal(checkoutRequest(order({ keyword: " " }), ctx).kind, "invalid");
  assert.equal(checkoutRequest(order({ quantity: 0 }), ctx).kind, "invalid");
  assert.equal(checkoutRequest(order({ quantity: 1.5 }), ctx).kind, "invalid");
  const forged = checkoutRequest({ ...order(), amount: 1 } as Order, ctx);
  const honest = checkoutRequest(order(), ctx);
  assert.ok(forged.kind === "session" && honest.kind === "session");
  assert.equal(forged.form.toString(), honest.form.toString());
});

/**
 * Danny, 18 Oct 2026: "site is right. stripe should adjust the amount based on the keyword cluster though as the price
 * varies." The site's price for a cluster is its sector's (sector-prices.json, read by pricing.ts through
 * sector-pricing.ts) times the clusters bought. Checked here against the JSON itself, not against quoteFor, for every
 * priced sector, both markets, both checkout tiers and every quantity /checkout sells: the Stripe Session's
 * unit_amount is the sector's price in cents, its quantity the clusters, and its currency the market's.
 * "From $1,395" is the cheapest sector; an entertainment-sector alwaysmentioned order is $1,795 - which is what
 * the one cancelled test subscription was.
 */
test("the Stripe amount is pricing.ts's price for the order's sector, for every sector, market, tier and quantity (18 Oct 2026)", async () => {
  const { readFileSync } = await import("node:fs");
  const { MAX_CLUSTERS } = await import("../../config/sector-pricing.ts");
  const raw = JSON.parse(readFileSync(new URL("../../config/sector-prices.json", import.meta.url), "utf8")) as Record<string, { us: unknown; uk: unknown }>;
  let checked = 0;
  for (const [id, e] of Object.entries(raw)) {
    for (const market of ["us", "uk"] as const) {
      for (const tier of ["mentioned", "cited"] as const) {
        for (let q = 1; q <= MAX_CLUSTERS; q++) {
          const r = checkoutRequest(order({ sector: id, market, tier, quantity: q }), ctx);
          const prices = e[market];
          if (typeof prices !== "object" || prices === null) {
            assert.equal(r.kind, "call", `${id} is priced on a call, so no Session`);
            continue;
          }
          const unit = (prices as Record<string, number>)[tier];
          assert.equal(r.kind, "session", `${id} ${market} ${tier} x${q}`);
          if (r.kind !== "session") continue;
          assert.equal(r.form.get("line_items[0][price_data][unit_amount]"), String(unit * 100), `${id} ${market} ${tier}: unit`);
          assert.equal(r.form.get("line_items[0][quantity]"), String(q), `${id} ${market} ${tier}: quantity`);
          assert.equal(r.form.get("line_items[0][price_data][currency]"), market === "uk" ? "gbp" : "usd");
          assert.equal(r.amount, unit * q, `${id} ${market} ${tier} x${q}: the amount shown before checkout`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 19 * 2 * 2 * MAX_CLUSTERS, `expected every priced band checked, got ${checked}`);
  // The one cancelled test subscription's figure, for the record.
  const ent = checkoutRequest(order({ sector: "entertainment", market: "us", tier: "mentioned", quantity: 1 }), ctx);
  assert.equal(ent.kind === "session" && ent.form.get("line_items[0][price_data][unit_amount]"), "179500");
});

test("an extra tracking pack is charged pricing.ts's TRACKING_PACK_PRICE for the client's market, never a typed figure", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../../app/api/dash/[client]/pack/route.ts", import.meta.url), "utf8");
  assert.match(route, /unitAmount: TRACKING_PACK_PRICE\[market\]/);
  const { packCheckoutForm } = await import("./packs.ts");
  const f = packCheckoutForm({ customer: "cus_x", clientId: "c", slug: "s", market: "uk", unitAmount: 39, name: "n", returnTo: "https://x" });
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "3900");
  assert.equal(f.get("line_items[0][price_data][currency]"), "gbp");
});
