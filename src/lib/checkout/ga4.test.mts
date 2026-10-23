import assert from "node:assert/strict";
import { test } from "node:test";

import { ga4Purchase, sendGa4Purchase } from "./ga4.ts";
import type { CompletedOrder } from "./webhook.ts";

/**
 * The server-side GA4 purchase (15 Oct 2026, Danny approved GA4 with a consent
 * banner in chat). Pure shape, then the never-fatal send.
 */

const ORDER: CompletedOrder = {
  sessionId: "cs_test_123",
  email: "buyer@agency.com",
  tier: "cited",
  sector: "saas",
  quantity: 2,
  market: "uk",
  keyword: "crm for agencies",
  scanToken: null,
  website: "agency.com",
  subscriptionId: "sub_1",
  customerId: "cus_1",
  amountTotal: 499000,
  currency: "gbp",
  trialDays: null,
  gaClientId: "123456789.1700000000",
  promotionId: null,
  amountDiscount: null,
  monthlyAmount: null,
};

const ID = "G-TEST123456";

test("no secret, or the placeholder id, sends nothing", () => {
  assert.equal(ga4Purchase(ORDER, undefined, ID), null);
  assert.equal(ga4Purchase(ORDER, "  ", ID), null);
  assert.equal(ga4Purchase(ORDER, "secret", "G-PENDING_SETUP"), null, "the placeholder id is inert");
});

test("a purchase carries the order and nothing about the buyer", () => {
  const r = ga4Purchase(ORDER, "secret", ID)!;
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, "https://www.google-analytics.com/mp/collect");
  assert.equal(u.searchParams.get("measurement_id"), ID);
  assert.equal(r.body.client_id, "123456789.1700000000");
  const [ev] = r.body.events as { name: string; params: Record<string, unknown> }[];
  assert.equal(ev!.name, "purchase");
  assert.deepEqual(ev!.params, {
    transaction_id: "cs_test_123",
    value: 4990,
    currency: "GBP",
    items: [{ item_id: "cited", item_name: "alwayscited", quantity: 2 }],
    plan: "alwayscited",
    market: "uk",
  });
  const sent = JSON.stringify(r.body);
  for (const secret of ["buyer@agency.com", "agency.com", "crm for agencies"]) assert.ok(!sent.includes(secret), `${secret} reached GA`);
});

test("a trial is start_trial at value 0, and a missing client id gets a random one", () => {
  const r = ga4Purchase({ ...ORDER, trialDays: 14, gaClientId: null, tier: "tracked", quantity: 1 }, "secret", ID)!;
  const [ev] = r.body.events as { name: string; params: Record<string, unknown> }[];
  assert.equal(ev!.name, "start_trial");
  assert.equal(ev!.params.value, 0);
  assert.match(String(r.body.client_id), /^\d+\.\d+$/);
});

test("the send never throws, and skips without a secret", async () => {
  assert.equal(await sendGa4Purchase(ORDER, undefined), "skipped");
  const boom = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  // 17 Oct 2026: the live id is the real property's, so this reaches the fetch - which fails, and is reported as
  // failed rather than thrown, so a GA outage can never fail the Stripe webhook.
  assert.equal(await sendGa4Purchase(ORDER, "secret", boom), "failed");
});
