import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { auditInvoices, invoiceFacts, invoiceRows, money, paymentKind, stripeInvoiceUrl, worthTelling } from "./invoice.ts";
import { packCheckoutForm } from "./packs.ts";
import { HANDLED_EVENTS, handleWebhook, signStripePayload, type WebhookDeps } from "./webhook.ts";
import { checkoutRequest } from "./session.ts";
import { COMPANY_LINE } from "../../config/contact.ts";
import { flagFor, LIFECYCLE_EMAILS, TRANSACTIONAL_EMAILS, transactionalPreviews } from "../email/lifecycle.ts";

/** Invoices for every payment (Danny, 22 Oct 2026). Nothing here reaches Stripe, Resend or Supabase. */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const HOSTED = "https://invoice.stripe.com/i/acct_1Abc/live_YWNjdF8x";
const PDF = "https://pay.stripe.com/invoice/acct_1Abc/live_YWNjdF8x/pdf?s=ap";

// API 2025-03-31's Invoice: the subscription under parent, taxes under total_taxes
const invoice = (k: Record<string, unknown> = {}) => ({
  id: "in_1Fixture", object: "invoice", number: "AC-0007", customer: "cus_Fixture", customer_email: "Owner@Example.com",
  total: 11880, amount_paid: 11880, currency: "gbp", status: "paid", billing_reason: "subscription_cycle", created: 1_790_000_000,
  status_transitions: { paid_at: 1_790_000_100 }, total_taxes: [{ amount: 1980 }],
  parent: { type: "subscription_details", subscription_details: { subscription: "sub_Fixture", metadata: {} } },
  lines: { data: [{ period: { start: 1_790_000_000, end: 1_792_592_000 } }] },
  hosted_invoice_url: HOSTED, invoice_pdf: PDF,
  account_name: "Nomada Digital Ltd", account_tax_ids: ["txi_1"], footer: "Nomada Digital Ltd, registered in England",
  customer_address: { line1: "1 High St", postal_code: "YO1 1AA", country: "GB" }, customer_tax_ids: [], automatic_tax: { enabled: true, status: "complete" },
  ...k,
});

test("an invoice's facts, as Stripe sends them", () => {
  const f = invoiceFacts(invoice())!;
  assert.equal(f.subscriptionId, "sub_Fixture");
  assert.equal(f.customerEmail, "owner@example.com");
  assert.equal(f.tax, 1980);
  assert.equal(f.paidAt, 1_790_000_100);
  assert.equal(f.hostedUrl, HOSTED);
  assert.equal(f.pdfUrl, PDF);
  assert.equal(invoiceFacts({ id: "not_an_invoice" }), null);
  assert.equal(invoiceFacts(invoice({ subscription: "sub_Legacy", parent: null }))!.subscriptionId, "sub_Legacy", "the legacy shape too");
});

test("only Stripe's own invoice links are kept", () => {
  for (const bad of ["https://evil.example/invoice", "http://invoice.stripe.com/i/x", "https://invoice.stripe.com.evil.example/x", "javascript:alert(1)", 42]) {
    assert.equal(stripeInvoiceUrl(bad), null, String(bad));
  }
  assert.equal(invoiceFacts(invoice({ hosted_invoice_url: "https://evil.example/x" }))!.hostedUrl, null);
});

test("money taken is told: a trial's opening zero invoice is not, a conversion and a renewal are", () => {
  assert.equal(worthTelling(invoiceFacts(invoice({ amount_paid: 0, total: 0, billing_reason: "subscription_create" }))!), false);
  assert.equal(worthTelling(invoiceFacts(invoice({ billing_reason: "subscription_cycle" }))!), true);
  assert.equal(worthTelling(invoiceFacts(invoice({ status: "open" }))!), false);
  assert.equal(paymentKind(invoiceFacts(invoice({ billing_reason: "subscription_create" }))!), "your first payment");
  assert.equal(paymentKind(invoiceFacts(invoice())!), "your monthly renewal");
  assert.equal(money(11880, "gbp"), "£118.80");
  assert.equal(money(159500, "usd"), "$1,595.00");
});

test("Plan > Billing's rows: newest first, no drafts, the status in words", () => {
  const rows = invoiceRows([invoice({ id: "in_old", created: 1, status_transitions: {} }), invoice({ id: "in_new", created: 9 }), invoice({ id: "in_draft", status: "draft", created: 99 }),
    invoice({ id: "in_due", status: "open", created: 5, status_transitions: {} })]);
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [["in_new", "Paid"], ["in_due", "Due"], ["in_old", "Paid"]]);
  assert.equal(rows[0]!.amount, "£118.80");
  assert.equal(rows[0]!.pdfUrl, PDF);
});

test("the audit counts what the invoices say about the template, with no customer in it", () => {
  const a = auditInvoices([invoice(), invoice({ id: "in_2", account_tax_ids: [], footer: null, customer_address: { country: "US", line1: "x" }, total_taxes: [] }),
    invoice({ id: "in_3", amount_paid: 0, total: 0, status: "paid" })]);
  assert.equal(a.invoices, 3);
  assert.equal(a.withAccountTaxId, 2);
  assert.equal(a.withFooter, 2);
  assert.deepEqual(a.accountNames, ["Nomada Digital Ltd"]);
  assert.equal(a.ukPaid, 1, "a UK invoice that took money");
  assert.equal(a.ukWithTax, 1, "with VAT on it");
  assert.doesNotMatch(JSON.stringify(a), /example\.com|cus_|in_1|11880/, "no customer, invoice or amount in the audit");
});

test("invoice.paid is handled; the payment's handler gets the Invoice", async () => {
  assert.ok((HANDLED_EVENTS as readonly string[]).includes("invoice.paid"));
  const calls: string[] = [];
  const d = { record: async () => "new" as const, forget: async () => {}, completed: async () => true, updated: async () => true, deleted: async () => true,
    trialWillEnd: async () => true, paymentFailed: async () => true, paymentPaid: async (i: Record<string, unknown>) => (calls.push(`paid ${i.id}`), true) } satisfies WebhookDeps;
  const raw = JSON.stringify({ id: "evt_paid", type: "invoice.paid", created: 1_790_000_100, data: { object: invoice() } });
  const a = await handleWebhook(raw, signStripePayload(raw, "whsec_x", 1_790_000_200), "whsec_x", d, 1_790_000_200);
  assert.equal(a.status, 200);
  assert.deepEqual(calls, ["paid in_1Fixture"]);
});

test("every Checkout makes a VAT invoice: subscription mode, Stripe Tax on ex-VAT prices, the address and a tax ID", () => {
  const pack = packCheckoutForm({ customer: "cus_Fixture", clientId: "c1", slug: "acme-com", market: "uk", unitAmount: 39, name: "Extra tracking pack", returnTo: "https://dashboards.alwayscited.com/acme-com/plan" });
  for (const f of [pack]) {
    assert.equal(f.get("mode"), "subscription", "Stripe invoices every subscription payment");
    assert.equal(f.get("automatic_tax[enabled]"), "true");
    assert.equal(f.get("line_items[0][price_data][tax_behavior]"), "exclusive", "pricing.ts is ex-VAT");
    assert.equal(f.get("billing_address_collection"), "required");
    assert.equal(f.get("tax_id_collection[enabled]"), "true");
  }
  assert.equal(pack.get("customer_update[name]"), "auto", "Stripe needs it for a tax ID on an existing customer");
  for (const f of ["src/lib/checkout/session.ts", "src/lib/checkout/hub-offer.ts"]) {
    const src = read(f);
    for (const k of ['"mode", "subscription"', '"automatic_tax[enabled]", "true"', '"tax_id_collection[enabled]", "true"', '"billing_address_collection", "required"', '[tax_behavior]", "exclusive"']) {
      assert.ok(src.includes(k), `${f}: ${k}`);
    }
    // 23 Oct 2026: both make a new customer, so both ask for its name on its own field (askForNames).
    assert.ok(src.includes("askForNames(f);"), `${f}: askForNames`);
  }
  // no one-off (payment mode) Checkout anywhere: that would need invoice_creation[enabled]
  for (const f of fs.readdirSync(path.join(ROOT, "src/lib/checkout")).filter((n) => n.endsWith(".ts"))) {
    assert.doesNotMatch(read(`src/lib/checkout/${f}`), /"mode",\s*"payment"/, f);
  }
  void checkoutRequest;
});

test("payment received: a transactional email that ships on, one button to Stripe's invoice, the PDF linked", () => {
  assert.deepEqual([...TRANSACTIONAL_EMAILS], ["payment_received"]);
  assert.ok(!(LIFECYCLE_EMAILS as readonly string[]).includes("payment_received"), "not a lifecycle email, whose flags ship off");
  assert.match(read("supabase/migrations/20261022020000_payment_received_email.sql"), new RegExp(`\\('${flagFor("payment_received")}', 'true'::jsonb\\)`));
  assert.match(read("src/lib/email/lifecycle-flag.ts"), /return data\?\.value !== false;/, "a missing row is on; only false turns it off");
  for (const p of transactionalPreviews().payment_received) {
    const m = p.mail;
    assert.equal(m.html.match(/<td bgcolor=/g)?.length, 1, `${p.label}: one button`);
    assert.match(m.html, /href="https:\/\/invoice\.stripe\.com\/[^"]+"[^>]*>View your invoice/, `${p.label}: the button is Stripe's invoice page`);
    for (const part of [m.html, m.text]) assert.ok(part.includes(COMPANY_LINE), `${p.label}: company line`);
    assert.match(m.subject, /^Payment received - your invoice/);
    assert.doesNotMatch(m.subject + m.text, /AlwaysCited|Alwayscited|—|–/, `${p.label}: house style`);
  }
  const [uk, us, none] = transactionalPreviews().payment_received.map((p) => p.mail.text);
  assert.match(uk!, /including £19\.80 VAT/);
  assert.match(uk!, /You can also download the PDF \(https:\/\/pay\.stripe\.com\//);
  assert.match(uk!, /https:\/\/dashboards\.alwayscited\.com\/tallyroo-com\/plan#billing/);
  assert.doesNotMatch(us!, /VAT\b.*including/);
  assert.doesNotMatch(none!, /dashboards\.alwayscited\.com\/[a-z-]+\/plan/, "no Billing link when the invoice is no client's");
});

test("the webhook sends it once, after the flag, and never asks Stripe to retry for the email", () => {
  const src = read("src/lib/checkout/invoice-mail.ts");
  assert.match(src, /if \(!f \|\| !worthTelling\(f\)\) return true;/);
  assert.match(src, /if \(!\(await transactionalOn\(db, "payment_received"\)\)\) return true;/);
  assert.match(src, /const sent = await sendLifecycle\(\{ memberEmail: f\.customerEmail, mail \}\);/, "to the address that paid");
  const after = src.slice(src.indexOf("const sent ="));
  assert.doesNotMatch(after, /return false/, "a failed send never makes the event fail");
  assert.match(read("src/app/api/stripe/webhook/route.ts"), /paymentPaid: \(invoice\) => onInvoicePaid\(supabaseAdmin\(\), invoice\),/);
});

test("Plan > Billing lists the owner's invoices, read for the customer on the order row", () => {
  const page = read("src/app/dashboards/[client]/plan/page.tsx");
  assert.match(page, /const inv = ws\.role === "owner" && !demo && !viewAs \? await readInvoices\(raw\.client\.id\) : null;/);
  assert.match(page, /<th>Date<\/th><th>Invoice<\/th><th className="num">Amount<\/th><th>Status<\/th><th>PDF<\/th>/);
  assert.match(read("src/lib/dash/invoices.ts"), /\.eq\("client_domain_id", clientId\)[\s\S]*listInvoices\(customer\)/);
});

test("the audit is read only and weekly", () => {
  const route = read("src/app/api/cron/stripe-audit/route.ts");
  assert.doesNotMatch(route, /method:\s*"POST"|createCheckoutSession|cancelAtPeriodEnd/);
  const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
  assert.ok(crons.some((c) => c.path === "/api/cron/stripe-audit" && c.schedule === "0 6 * * 1"));
  const stripe = read("src/lib/checkout/stripe.ts");
  const audit = stripe.slice(stripe.indexOf("export async function stripeAuditReads"));
  assert.doesNotMatch(audit, /method: "POST"/);
});
