import assert from "node:assert/strict";
import { test } from "node:test";

import { addMonthsUtc, cancelAtFor, CONTRACT_OFFER_KIND, contractOfferForm, contractOfferId, firstChargeOf, isOfferToken, offerState, offerTerms, type ContractOffer } from "./contract-offer.ts";
import { completedOrder, handleWebhook, orderEmailText, signStripePayload, type WebhookDeps } from "./webhook.ts";

/** Contract offers (31 Oct 2026): the Session form, the end date, and the webhook's order - end date first, then signup. */

const SECRET = "whsec_contract_offer_fixture";
const NOW = 1_793_448_000; // 31 Oct 2026 12:00 UTC
const ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const OFFER: ContractOffer = {
  id: ID,
  client_name: "Example Ltd",
  agreement_date: "2026-10-26",
  tier: "cited",
  market: "uk",
  website: "example.com",
  keyword: "example keyword",
  email: null,
  monthly_amount: 99500,
  charges: 6,
  first_charge_on: null,
  expires_at: "2026-12-01T00:00:00Z",
  used_at: null,
};

test("a token is 64 hex; an offer is open until used or expired", () => {
  assert.ok(isOfferToken("a".repeat(64)));
  assert.ok(!isOfferToken("A".repeat(64)) && !isOfferToken("a".repeat(63)) && !isOfferToken("../x"));
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(offerState(OFFER, now), "open");
  assert.equal(offerState({ ...OFFER, used_at: "2026-11-01T00:00:00Z" }, now), "used");
  assert.equal(offerState({ ...OFFER, expires_at: "2026-10-31T00:00:00Z" }, now), "expired");
});

test("the end date is the anchor plus the agreed payments, a 31st clamped as Stripe bills it", () => {
  const nov1 = Date.parse("2026-11-01T10:15:00Z") / 1000;
  assert.equal(cancelAtFor(nov1, 6), Date.parse("2027-05-01T10:15:00Z") / 1000, "six payments: 1 Nov to 1 Apr, ends 1 May");
  assert.equal(addMonthsUtc(Date.parse("2027-01-31T00:00:00Z") / 1000, 1), Date.parse("2027-02-28T00:00:00Z") / 1000);
  assert.equal(addMonthsUtc(Date.parse("2026-08-31T00:00:00Z") / 1000, 6), Date.parse("2027-02-28T00:00:00Z") / 1000);
  assert.equal(addMonthsUtc(Date.parse("2026-12-15T00:00:00Z") / 1000, 1), Date.parse("2027-01-15T00:00:00Z") / 1000, "across the year");
});

test("a set first payment is midnight UTC that day, never in the past", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  assert.equal(firstChargeOf("2026-12-01", now), Date.parse("2026-12-01T00:00:00Z") / 1000);
  assert.equal(firstChargeOf("2026-10-31", now), null);
  assert.equal(firstChargeOf(null, now), null);
  assert.equal(firstChargeOf("1/12/2026", now), null);
});

test("the terms the page and Stripe both show", () => {
  const t = offerTerms(OFFER);
  assert.equal(t.price, "£995 + VAT a month");
  assert.equal(t.payments, "Six monthly payments, then the plan ends");
  assert.equal(t.agreement, "Billed under the agreement signed on 26 October 2026. Its terms apply in place of alwayscited.com's standard terms.");
  assert.equal(t.first, null);
  assert.equal(offerTerms({ ...OFFER, first_charge_on: "2026-12-01" }).first, "First payment on 1 December 2026.");
  assert.equal(offerTerms({ ...OFFER, monthly_amount: 99550, market: "us", charges: 18 }).price, "$995.50 a month");
});

test("the form: the offer's price and plan, VAT as checkout charges it, no codes, the offer marked on Session and subscription", () => {
  const f = contractOfferForm(OFFER, { email: "a@example.com", planName: "alwayscited", origin: "https://alwayscited.com", backUrl: "https://alwayscited.com/checkout/offer/x", anchor: null });
  assert.equal(f.get("mode"), "subscription");
  assert.equal(f.get("customer_email"), "a@example.com");
  assert.equal(f.get("line_items[0][price_data][currency]"), "gbp");
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "99500");
  assert.equal(f.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(f.get("line_items[0][price_data][product_data][name]"), "alwayscited");
  assert.equal(f.get("line_items[0][price_data][tax_behavior]"), "exclusive");
  assert.equal(f.get("automatic_tax[enabled]"), "true");
  assert.equal(f.get("billing_address_collection"), "required");
  assert.equal(f.get("allow_promotion_codes"), null, "an agreed price takes no codes");
  assert.equal(f.get("subscription_data[trial_period_days]"), null);
  assert.equal(f.get("subscription_data[billing_cycle_anchor]"), null, "no first-payment day: taken at checkout");
  assert.match(f.get("custom_text[submit][message]") ?? "", /in place of alwayscited\.com's standard terms/);
  assert.match(f.get("success_url") ?? "", /plan=cited&from=site/);
  for (const where of ["metadata", "subscription_data[metadata]"]) {
    assert.equal(f.get(`${where}[kind]`), CONTRACT_OFFER_KIND);
    assert.equal(f.get(`${where}[offer_id]`), ID);
    assert.equal(f.get(`${where}[tier]`), "cited");
    assert.equal(f.get(`${where}[market]`), "uk");
    assert.equal(f.get(`${where}[website]`), "example.com");
    assert.equal(f.get(`${where}[keyword]`), "example keyword");
    assert.equal(f.get(`${where}[monthly_amount]`), "99500");
    assert.equal(f.get(`${where}[charges]`), "6");
  }
  const later = contractOfferForm(OFFER, { email: "a@example.com", planName: "alwayscited", origin: "https://alwayscited.com", backUrl: "x", anchor: 1_796_083_200 });
  assert.equal(later.get("subscription_data[billing_cycle_anchor]"), "1796083200");
  assert.equal(later.get("subscription_data[proration_behavior]"), "none");
});

test("the completed order carries the offer's payments into the order email; other orders do not", () => {
  const session = { id: "cs_c", customer_email: "a@example.com", metadata: { kind: CONTRACT_OFFER_KIND, offer_id: ID, tier: "cited", market: "uk", quantity: "1", website: "example.com", monthly_amount: "99500", charges: "6" } };
  const o = completedOrder(session);
  assert.equal(o.contractCharges, 6);
  assert.equal(o.tier, "cited");
  assert.equal(o.website, "example.com");
  assert.equal(o.monthlyAmount, 99500);
  assert.match(orderEmailText(o, "made", "https://alwayscited.com").text, /Contract offer: billed under a signed agreement, 6 monthly payment\(s\)/);
  assert.equal(completedOrder({ id: "cs_x", metadata: { tier: "cited", charges: "6" } }).contractCharges, null);
  assert.equal(contractOfferId(session), ID);
  assert.equal(contractOfferId({ metadata: { kind: "hub_offer", offer_id: ID } }), null);
});

function deps() {
  const calls: string[] = [];
  const d: WebhookDeps = {
    record: async () => "new",
    forget: async (id) => void calls.push(`forget ${id}`),
    completed: async (o) => (calls.push(`signup ${o.website}`), true),
    updated: async () => (calls.push("updated"), true),
    deleted: async () => (calls.push("deleted"), true),
    trialWillEnd: async () => true,
    paymentFailed: async () => true,
    hubOfferCompleted: async () => (calls.push("hub offer"), true),
    contractOfferCompleted: async () => (calls.push("end date"), true),
  };
  return { d, calls };
}
const post = (event: unknown, d: WebhookDeps) => {
  const raw = JSON.stringify(event);
  return handleWebhook(raw, signStripePayload(raw, SECRET, NOW), SECRET, d, NOW);
};
const completed = (id: string, metadata: Record<string, string>) => ({ id, type: "checkout.session.completed", created: NOW, data: { object: { id: "cs_c", metadata } } });

test("a completed contract offer sets its end date, then runs the usual signup", async () => {
  const { d, calls } = deps();
  const a = await post(completed("evt_c", { kind: CONTRACT_OFFER_KIND, offer_id: ID, website: "example.com" }), d);
  assert.equal(a.status, 200);
  assert.deepEqual(calls, ["end date", "signup example.com"]);
});

test("an end date not set stops before signup and is forgotten, so Stripe retries the whole of it", async () => {
  const { d, calls } = deps();
  d.contractOfferCompleted = async () => (calls.push("end date"), false);
  const a = await post(completed("evt_c_fail", { kind: CONTRACT_OFFER_KIND, offer_id: ID }), d);
  assert.equal(a.status, 500);
  assert.deepEqual(calls, ["end date", "forget evt_c_fail"]);
});

test("any other completed checkout never asks for an end date", async () => {
  const { d, calls } = deps();
  await post(completed("evt_plain", { tier: "cited", website: "example.com" }), d);
  assert.deepEqual(calls, ["signup example.com"]);
});
