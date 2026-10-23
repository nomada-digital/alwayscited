import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { askForNames, createCheckoutSession } from "./stripe.ts";

/** R91 part 2 (29 Sep 2026): the Stripe call, with a stubbed fetch. No request leaves this process. */

const KEY = "stub-key-for-tests";
const form = new URLSearchParams({ mode: "subscription", allow_promotion_codes: "true" });

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("no key: no request is made and the caller is told to fall back", async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const { f, calls } = stub(200, { url: "https://checkout.stripe.com/x" });
  assert.deepEqual(await createCheckoutSession(form, f), { ok: false, reason: "no_key" });
  assert.equal(calls.length, 0);
  if (before !== undefined) process.env.STRIPE_SECRET_KEY = before;
});

test("posts the form to Checkout Sessions with the key as a bearer and returns Stripe's url", async () => {
  process.env.STRIPE_SECRET_KEY = KEY;
  const { f, calls } = stub(200, { url: "https://checkout.stripe.com/c/pay/cs_live_x" });
  assert.deepEqual(await createCheckoutSession(form, f), { ok: true, url: "https://checkout.stripe.com/c/pay/cs_live_x" });
  assert.equal(calls[0]!.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
  assert.equal(calls[0]!.init.body, form.toString());
  delete process.env.STRIPE_SECRET_KEY;
});

test("a refusal returns Stripe's status and code, never the key", async () => {
  process.env.STRIPE_SECRET_KEY = KEY;
  const { f } = stub(403, { error: { type: "invalid_request_error", code: "secret_key_required" } });
  const r = await createCheckoutSession(form, f);
  assert.deepEqual(r, { ok: false, reason: "refused", status: 403, code: "secret_key_required" });
  assert.ok(!JSON.stringify(r).includes(KEY));
  delete process.env.STRIPE_SECRET_KEY;
});

test("a url that is not Stripe's checkout is refused rather than followed", async () => {
  process.env.STRIPE_SECRET_KEY = KEY;
  const { f } = stub(200, { url: "https://example.com/phish" });
  assert.equal((await createCheckoutSession(form, f)).ok, false);
  delete process.env.STRIPE_SECRET_KEY;
});

test("the route never reads an amount from the request and never logs the key", () => {
  const src = readFileSync(join(import.meta.dirname, "../../app/api/checkout/route.ts"), "utf8");
  assert.ok(!/field\("(amount|price|unit_amount)"/.test(src));
  assert.ok(src.includes("checkoutRequest("));
  assert.ok(!/console\.[a-z]+\([^)]*STRIPE_SECRET_KEY/.test(src));
  assert.ok(!src.includes("process.env.STRIPE_SECRET_KEY"), "the key is read only in stripe.ts");
});

test("a promotion code is read with its coupon, on either API shape, and only by a promo id (22 Oct 2026)", async () => {
  const { readPromotionCode } = await import("./stripe.ts");
  process.env.STRIPE_SECRET_KEY = KEY;
  const old = stub(200, { code: "TESTCODE", coupon: { percent_off: 100, duration: "once" } });
  assert.deepEqual(await readPromotionCode("promo_1ABC", old.f), { ok: true, code: "TESTCODE", percentOff: 100, amountOff: null, currency: null, duration: "once", months: null });
  assert.equal(old.calls[0]!.url, "https://api.stripe.com/v1/promotion_codes/promo_1ABC");
  assert.equal(old.calls[0]!.init.method, "GET");

  const calls: string[] = [];
  const fresh = (async (url: string) => {
    calls.push(url);
    const body = url.includes("/coupons/") ? { amount_off: 5000, currency: "gbp", duration: "repeating", duration_in_months: 3 } : { code: "NEWCODE", promotion: { type: "coupon", coupon: "co_1" } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await readPromotionCode("promo_2", fresh), { ok: true, code: "NEWCODE", percentOff: null, amountOff: 5000, currency: "gbp", duration: "repeating", months: 3 });
  assert.deepEqual(calls, ["https://api.stripe.com/v1/promotion_codes/promo_2", "https://api.stripe.com/v1/coupons/co_1"]);

  const none = stub(200, {});
  assert.deepEqual(await readPromotionCode("../customers", none.f), { ok: false, reason: "refused" });
  assert.equal(none.calls.length, 0);
  delete process.env.STRIPE_SECRET_KEY;
});

test("name fields are asked for, and a Session refused over them is made without them (23 Oct 2026)", async () => {
  // goodtrip's Stripe customer was named "11 Heworth Hall Drive": the name came off the billing form.
  const f = new URLSearchParams({ mode: "subscription" });
  askForNames(f);
  assert.equal(f.get("name_collection[individual][enabled]"), "true");
  assert.equal(f.get("name_collection[business][enabled]"), "true");
  assert.equal(f.get("name_collection[business][optional]"), "true");
  assert.equal(f.get("name_collection[individual][optional]"), null, "the full name is required");

  process.env.STRIPE_SECRET_KEY = KEY;
  const bodies: string[] = [];
  const older = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return bodies.length === 1
      ? new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "parameter_unknown", param: "name_collection" } }), { status: 400 })
      : new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_live_y" }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await createCheckoutSession(f, older), { ok: true, url: "https://checkout.stripe.com/c/pay/cs_live_y" });
  assert.equal(bodies.length, 2);
  assert.match(bodies[0]!, /name_collection/);
  assert.doesNotMatch(bodies[1]!, /name_collection/);
  assert.match(bodies[1]!, /mode=subscription/);

  // Any other refusal is not retried.
  const other = stub(400, { error: { code: "parameter_invalid_integer", param: "line_items[0][quantity]" } });
  const r = await createCheckoutSession(f, other.f);
  assert.equal(r.ok, false);
  assert.equal(other.calls.length, 1);
  delete process.env.STRIPE_SECRET_KEY;
});
