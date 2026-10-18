import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { FIXTURE_INVOICE_URL, expandFixture, fixtureState } from "./fixture-mode.ts";
import { UNPAID_INVOICE_DAYS, paymentDay, planBanner, type BannerClient } from "./plan-banner.ts";

/**
 * The plan banner (8 Oct 2026, audit activation-12, activation-5), decided in
 * plan-banner.ts from 9 Oct 2026 so BL-2's payment states could join it under
 * test: tracking ended (for payment or otherwise), a failed payment Stripe is
 * retrying, the free trial.
 */

const NOW = Date.parse("2026-10-09T12:00:00Z");
const PRICE = { us: 129, uk: 99 };
const BILLING = "/app/tallyroo-com/settings#set-billing";
const base: BannerClient = { name: "Tallyroo", market: "US", status: "active" };
const draw = (client: Partial<BannerClient>, role = "owner", upsell = true) => planBanner({ client: { ...base, ...client }, role, upsell, billing: BILLING, price: PRICE, now: NOW });
const PAGE = "https://invoice.stripe.com/i/acct_fixture/test_fixture_invoice";
const due = { payment_status: "past_due", payment_retry_at: "2026-10-12T15:00:00Z", payment_invoice_url: PAGE };

test("a failed payment Stripe is retrying: the owner is told, with the retry day and the invoice to pay", () => {
  assert.deepEqual(draw(due), { tone: "payment", text: "Your last payment did not go through. We try the card again on 12 Oct 2026.", link: { href: PAGE, label: "Pay the invoice", external: true } });
  // No invoice page recorded: Billing's Ask us, where Billing is ours; the account contact where it is not.
  assert.deepEqual(draw({ ...due, payment_invoice_url: null }), { tone: "payment", text: "Your last payment did not go through. We try the card again on 12 Oct 2026.", link: { href: BILLING, label: "Ask us about it" } });
  assert.deepEqual(draw({ ...due, payment_invoice_url: null }, "owner", false), { tone: "payment", text: "Your last payment did not go through. We try the card again on 12 Oct 2026. Your account contact can help.", link: null });
  // No retry to come, or one already past: no date is promised.
  assert.equal(draw({ ...due, payment_retry_at: null })!.text, "Your last payment did not go through.");
  assert.equal(draw({ ...due, payment_retry_at: "2026-10-09T11:00:00Z" })!.text, "Your last payment did not go through.");
});

test("only the owner sees the failed payment, and tracking is not said to have stopped", () => {
  for (const role of ["editor", "viewer"]) assert.equal(draw(due, role), null, role);
  assert.doesNotMatch(draw(due)!.text, /stop|ended/i);
});

test("ended for payment says why; ended any other way reads as before", () => {
  // No invoice to pay (or one too old to offer, below): the owner asks us, as any end does.
  const unpaid = { status: "ended", payment_status: "unpaid", payment_ended_at: "2026-10-08T12:00:00Z", payment_invoice_url: null };
  assert.deepEqual(draw(unpaid), { tone: "ended", text: "Tracking has stopped for Tallyroo because the plan is unpaid. Everything read so far stays here, read-only, until 6 Jan 2027.", link: { href: BILLING, label: "Ask us to restart it" } });
  assert.deepEqual(draw({ ...unpaid, payment_invoice_url: PAGE }, "viewer"), { tone: "ended", text: "Tracking has stopped for Tallyroo because the plan is unpaid. Everything read so far stays here, read-only, until 6 Jan 2027 - an owner can ask us to restart it.", link: null });
  assert.deepEqual(draw(unpaid, "owner", false), { tone: "ended", text: "Tracking has stopped for Tallyroo because the plan is unpaid. Everything read so far stays here, read-only, until 6 Jan 2027 - your account contact can restart it.", link: null });
  // As Sidebar drew it on 8 Oct 2026 (review of 2379757).
  assert.deepEqual(draw({ status: "ended" }), { tone: "ended", text: "Tracking has ended for Tallyroo. Everything read so far stays here.", link: { href: BILLING, label: "Ask us to restart it" } });
  assert.deepEqual(draw({ status: "ended" }, "editor"), { tone: "ended", text: "Tracking has ended for Tallyroo. Everything read so far stays here - an owner can ask us to restart it.", link: null });
  assert.deepEqual(draw({ status: "ended" }, "owner", false), { tone: "ended", text: "Tracking has ended for Tallyroo. Everything read so far stays here - your account contact can restart it.", link: null });
  // 18 Oct 2026: with the end known (ended_at, any reason), the 90 days it is kept are said (retention.ts).
  assert.deepEqual(draw({ status: "ended", ended_at: "2026-10-18T14:00:00Z" }), { tone: "ended", text: "Tracking has ended for Tallyroo. Everything read so far stays here, read-only, until 16 Jan 2027.", link: { href: BILLING, label: "Ask us to restart it" } });
  // Ended beats a past-due record the invoice wrote after the end (payment.ts: an invoice never moves the status).
  assert.equal(draw({ ...due, status: "ended", payment_ended_at: "2026-10-08T12:00:00Z" })!.tone, "ended");
});

/**
 * Review of 355d223 (9 Oct 2026): an unpaid end withheld the invoice it still
 * held, and sent the owner to us for something paying fixes. Stripe moves an
 * unpaid subscription to active when the invoice is paid
 * (Stripe's docs, /billing/subscriptions/overview, read 9 Oct 2026), and
 * afterSubscription then restores the client.
 */
test("an unpaid end gives the owner the invoice to pay, for a week; other payment ends still ask us", () => {
  const ended = { status: "ended", payment_status: "unpaid", payment_ended_at: "2026-10-08T12:00:00Z", payment_invoice_url: PAGE };
  const pay = { tone: "ended", text: "Tracking has stopped for Tallyroo because the plan is unpaid. Everything read so far stays here, read-only, until 6 Jan 2027, and tracking starts again once the invoice is paid.", link: { href: PAGE, label: "Pay the invoice", external: true } };
  assert.deepEqual(draw(ended), pay);
  assert.deepEqual(draw(ended, "owner", false), pay, "the owner pays Stripe whoever bills the account");
  // Not the owner: told as before, never handed the invoice.
  for (const role of ["editor", "viewer"]) assert.equal(draw(ended, role)!.link, null, role);
  // Paused and incomplete_expired: an invoice cannot bring them back, so Ask us.
  for (const payment_status of ["paused", "incomplete_expired"]) assert.equal(draw({ ...ended, payment_status })!.link?.label, "Ask us to restart it", payment_status);
  // Cancelled after it stopped (payment.ts clears payment_ended_at): final, as before.
  assert.equal(draw({ ...ended, payment_status: "canceled", payment_ended_at: null })!.link?.label, "Ask us to restart it");
  // Stripe's links expire (Stripe's docs, /invoicing/hosted-invoice-page): after a week, Ask us.
  const day = 86_400_000;
  assert.equal(draw({ ...ended, payment_ended_at: new Date(NOW - (UNPAID_INVOICE_DAYS * day - 60_000)).toISOString() })!.link?.label, "Pay the invoice");
  assert.equal(draw({ ...ended, payment_ended_at: new Date(NOW - UNPAID_INVOICE_DAYS * day).toISOString() })!.link?.label, "Ask us to restart it");
  assert.equal(draw({ ...ended, payment_ended_at: "not a time" })!.link?.label, "Ask us to restart it");
});

test("the trial reads as it did before the payment states joined", () => {
  const ends = "2026-10-18T12:00:00Z";
  assert.deepEqual(draw({ trial_ends_at: ends }), { tone: "trial", text: "Free trial: 9 days left, ends 18 Oct 2026, 8:00am ET.", link: { href: BILLING, label: "Billing" } });
  assert.equal(draw({ trial_ends_at: "2026-10-10T12:00:00Z" })!.text, "Free trial: 1 day left, ends 10 Oct 2026, 8:00am ET.");
  assert.deepEqual(draw({ trial_ends_at: ends, trial_cancelled_at: "2026-10-08T12:00:00Z" }), { tone: "trial", text: "Trial cancelled - tracking stops 18 Oct 2026, 8:00am ET", link: { href: BILLING, label: "Billing" } });
  assert.equal(draw({ trial_ends_at: "2026-10-08T12:00:00Z" }), null, "a trial that has ended");
  assert.equal(draw({}), null);
  assert.equal(draw({ status: "ended", trial_ends_at: ends })!.tone, "ended");
});

test("the retry day is the client's own: a US client's evening is not read as London's next day", () => {
  assert.equal(paymentDay("2026-10-14T03:00:00Z", "US"), "13 Oct 2026");
  assert.equal(paymentDay("2026-10-14T03:00:00Z", "UK"), "14 Oct 2026");
  assert.equal(paymentDay("2026-10-14T03:00:00Z", "uk"), "14 Oct 2026");
});

test("the copy keeps the house rules: no em-dash, no capitalised brand", () => {
  const texts: string[] = [];
  for (const c of [due, { ...due, payment_invoice_url: null }, { status: "ended" }, { status: "ended", payment_ended_at: "2026-10-08T12:00:00Z" }, { status: "ended", payment_status: "unpaid", payment_ended_at: "2026-10-08T12:00:00Z", payment_invoice_url: PAGE }]) {
    for (const role of ["owner", "viewer"]) for (const upsell of [true, false]) {
      const b = draw(c, role, upsell);
      if (b) texts.push(b.text, b.link?.label ?? "");
    }
  }
  assert.ok(texts.length >= 16);
  for (const t of texts) {
    assert.doesNotMatch(t, /—|–/, t);
    assert.doesNotMatch(t, /AlwaysCited|Alwayscited|always cited/, t);
  }
});

test("the past-due and unpaid fixture states draw their banners on the real fixture", () => {
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const at = (state: string, role = "owner") => {
    const c = fixtureState(fx, { TRACKING_FIXTURE_STATE: state }).client;
    return planBanner({ client: { ...c, name: c.brand }, role, upsell: true, billing: BILLING, price: PRICE });
  };
  const d = at("past-due");
  assert.equal(d?.tone, "payment");
  assert.match(d!.text, /^Your last payment did not go through\. We try the card again on \d{1,2} [A-Z][a-z]{2} \d{4}\.$/);
  assert.deepEqual(d!.link, { href: FIXTURE_INVOICE_URL, label: "Pay the invoice", external: true });
  assert.equal(at("past-due", "viewer"), null);
  assert.match(at("unpaid")!.text, /because the plan is unpaid/);
  assert.deepEqual(at("unpaid")!.link, { href: FIXTURE_INVOICE_URL, label: "Pay the invoice", external: true }, "the unpaid fixture ended yesterday, inside the week");
  assert.equal(at("unpaid", "viewer")!.link, null);
  assert.equal(at("default"), null);
});

// 18 Oct 2026, brief 2d: the /app Sidebar (components/app/Sidebar.tsx) retired with /app; every /app address 308s to
// the dashboards host. The rule holds there: pageData takes the banner from planBanner, signed in and on a view-as
// link alike, and the Shell draws it with no copy of its own and no referrer to an external page.
test("census: the dashboards Shell draws the banner planBanner decides, and sends no referrer to an external page", () => {
  const data = readFileSync(new URL("../dash/page-data.ts", import.meta.url), "utf8");
  assert.equal(data.match(/const banner = c \? planBanner\(\{/g)?.length, 2, "pageData no longer takes its banner from planBanner");
  const shell = readFileSync(new URL("../../components/dash/Shell.tsx", import.meta.url), "utf8");
  assert.ok(shell.includes("banner?: PlanBanner | null"), "the Shell no longer draws pageData's banner");
  for (const src of [data, shell]) for (const copy of ["Tracking has ended for", "Free trial: ", "did not go through"]) assert.ok(!src.includes(copy), `banner copy written outside plan-banner.ts: ${copy}`);
  assert.ok(shell.includes('{...(banner.link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}'));
});
