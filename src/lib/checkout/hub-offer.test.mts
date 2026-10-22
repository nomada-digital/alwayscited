import assert from "node:assert/strict";
import { test } from "node:test";

import { firstChargeAt, HUB_OFFER_KIND, hubOfferForm, isHubOffer } from "./hub-offer.ts";
import { handleWebhook, signStripePayload, type WebhookDeps } from "./webhook.ts";

/** The agency hub's subscription offer (22 Oct 2026): the Session form, the first charge, and the webhook's routing. */

const SECRET = "whsec_hub_offer_fixture";
const NOW = 1_792_670_400; // 22 Oct 2026 12:00 UTC
const CLIENT = "1e7b78e4-0b81-4130-a277-b2f9cc4cc473";
const PROJECT = "5b0d5c1e-2f6a-4b8e-9c1d-0a1b2c3d4e5f";

test("the first charge is midnight UTC after the last included day, never in the past", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  assert.equal(firstChargeAt("2026-12-23", now), Date.parse("2026-12-24T00:00:00Z") / 1000);
  assert.equal(firstChargeAt("2026-10-31", now), null, "an included period already over starts now");
  assert.equal(firstChargeAt("2026-11-01", Date.parse("2026-11-01T23:30:00Z")), null, "under an hour away starts now");
  assert.equal(firstChargeAt(null, now), null);
  assert.equal(firstChargeAt("23/12/2026", now), null);
});

test("the form: the client's plan at the given price, VAT as checkout charges it, the offer marked on Session and subscription", () => {
  const f = hubOfferForm({ clientId: CLIENT, slug: "alistairmacphotography-com", market: "uk", email: "info@example.com", unitAmount: 99, name: "alwaystracked", anchor: 1_798_070_400, hubProjectId: PROJECT, origin: "https://alwayscited.com" });
  assert.equal(f.get("mode"), "subscription");
  assert.equal(f.get("customer_email"), "info@example.com");
  assert.equal(f.get("line_items[0][price_data][currency]"), "gbp");
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "9900");
  assert.equal(f.get("line_items[0][price_data][tax_behavior]"), "exclusive");
  assert.equal(f.get("automatic_tax[enabled]"), "true");
  assert.equal(f.get("subscription_data[billing_cycle_anchor]"), "1798070400");
  assert.equal(f.get("subscription_data[proration_behavior]"), "none");
  assert.equal(f.get("subscription_data[trial_period_days]"), null, "no trial, so no trial emails");
  for (const where of ["metadata", "subscription_data[metadata]"]) {
    assert.equal(f.get(`${where}[kind]`), HUB_OFFER_KIND);
    assert.equal(f.get(`${where}[client_domain_id]`), CLIENT);
    assert.equal(f.get(`${where}[hub_project_id]`), PROJECT);
    assert.equal(f.get(`${where}[tier]`), "tracked");
    assert.equal(f.get(`${where}[market]`), "uk");
  }
  const now = hubOfferForm({ clientId: CLIENT, slug: "x-com", market: "us", email: null, unitAmount: 129, name: "alwaystracked", anchor: null, hubProjectId: PROJECT, origin: "https://alwayscited.com" });
  assert.equal(now.get("subscription_data[billing_cycle_anchor]"), null);
  assert.equal(now.get("customer_email"), null);
  assert.equal(now.get("line_items[0][price_data][currency]"), "usd");
  assert.ok(isHubOffer({ metadata: { kind: HUB_OFFER_KIND } }) && !isHubOffer({ metadata: { kind: "pack" } }) && !isHubOffer({}));
});

function deps() {
  const calls: string[] = [];
  const d: WebhookDeps = {
    record: async () => "new",
    forget: async (id) => void calls.push(`forget ${id}`),
    completed: async () => (calls.push("signup"), true),
    updated: async () => (calls.push("updated"), true),
    deleted: async () => (calls.push("deleted"), true),
    trialWillEnd: async () => true,
    paymentFailed: async () => true,
    packCompleted: async () => (calls.push("pack"), true),
    hubOfferCompleted: async (s) => (calls.push(`offer ${(s.metadata as Record<string, string>).client_domain_id}`), true),
  };
  return { d, calls };
}
const post = (event: unknown, d: WebhookDeps) => {
  const raw = JSON.stringify(event);
  return handleWebhook(raw, signStripePayload(raw, SECRET, NOW), SECRET, d, NOW);
};

test("a completed offer goes to its own handler, never signup, so it never makes a client", async () => {
  const { d, calls } = deps();
  const a = await post({ id: "evt_offer", type: "checkout.session.completed", created: NOW, data: { object: { id: "cs_offer", metadata: { kind: HUB_OFFER_KIND, client_domain_id: CLIENT } } } }, d);
  assert.equal(a.status, 200);
  assert.deepEqual(calls, [`offer ${CLIENT}`]);
});

test("the offer's later subscription events are the client's own and take the usual path", async () => {
  const { d, calls } = deps();
  await post({ id: "evt_offer_sub", type: "customer.subscription.updated", created: NOW, data: { object: { id: "sub_offer", metadata: { kind: HUB_OFFER_KIND } }, previous_attributes: {} } }, d);
  assert.deepEqual(calls, ["updated"]);
});

test("a failed offer write is forgotten, so Stripe retries", async () => {
  const { d, calls } = deps();
  d.hubOfferCompleted = async () => false;
  const a = await post({ id: "evt_offer_fail", type: "checkout.session.completed", created: NOW, data: { object: { id: "cs_offer", metadata: { kind: HUB_OFFER_KIND } } } }, d);
  assert.equal(a.status, 500);
  assert.deepEqual(calls, ["forget evt_offer_fail"]);
});
