/**
 * Invoices (Danny, 22 Oct 2026: "we need to provide an invoice over email to the customer too").
 *
 * Every alwayscited plan is a Stripe subscription (session.ts, packs.ts, hub-offer.ts), so Stripe makes an invoice
 * for each payment - the first one, a trial's conversion, every renewal and every pack - with automatic tax on
 * prices set ex-VAT (tax_behavior exclusive). Stripe emails it only when the account's Customer emails settings say
 * so, which the API cannot set; so as well, on invoice.paid, our own "Payment received" email links the invoice's
 * Stripe page and its PDF (invoice-mail.ts), and Plan > Billing lists every invoice (the dashboards host).
 *
 * Pure: the facts of an Invoice object as Stripe sends it, the rows Plan shows, and the read-only audit summary.
 * Only Stripe's own invoice links are ever kept, so no payload can put another link in front of a customer.
 */

export type InvoiceFacts = {
  id: string;
  number: string | null;
  customerEmail: string | null;
  customer: string | null;
  subscriptionId: string | null;
  /** Minor units (pence, cents). */
  total: number;
  amountPaid: number;
  tax: number;
  currency: "gbp" | "usd" | string;
  status: string | null;
  billingReason: string | null;
  created: number | null;
  paidAt: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Stripe's hosted invoice page and its PDF, and nothing else. */
export const stripeInvoiceUrl = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https:\/\/(invoice\.stripe\.com|pay\.stripe\.com)\/[^\s"'<>]{1,1500}$/.test(s) ? s : null;
};

export function invoiceFacts(inv: Record<string, unknown>): InvoiceFacts | null {
  const id = str(inv.id);
  if (!id || !/^in_[A-Za-z0-9]{1,200}$/.test(id)) return null;
  const parent = ((inv.parent ?? {}) as Record<string, unknown>).subscription_details as Record<string, unknown> | undefined;
  const sub = str(parent?.subscription) ?? str(inv.subscription) ?? str((inv.subscription as Record<string, unknown> | null)?.id);
  const transitions = (inv.status_transitions ?? {}) as Record<string, unknown>;
  const line0 = (((inv.lines as Record<string, unknown> | undefined)?.data ?? []) as Record<string, unknown>[])[0];
  const period = (line0?.period ?? {}) as Record<string, unknown>;
  const taxes = Array.isArray(inv.total_taxes) ? (inv.total_taxes as Record<string, unknown>[]).reduce((s, t) => s + (int(t.amount) ?? 0), 0) : null;
  return {
    id,
    number: str(inv.number),
    customerEmail: str(inv.customer_email)?.toLowerCase() ?? null,
    customer: str(inv.customer) ?? str((inv.customer as Record<string, unknown> | null)?.id),
    subscriptionId: sub && /^sub_[A-Za-z0-9]{1,200}$/.test(sub) ? sub : null,
    total: int(inv.total) ?? 0,
    amountPaid: int(inv.amount_paid) ?? 0,
    tax: taxes ?? int(inv.tax) ?? 0,
    currency: (str(inv.currency) ?? "gbp").toLowerCase(),
    status: str(inv.status),
    billingReason: str(inv.billing_reason),
    created: int(inv.created),
    paidAt: int(transitions.paid_at),
    periodStart: int(period.start),
    periodEnd: int(period.end),
    hostedUrl: stripeInvoiceUrl(inv.hosted_invoice_url),
    pdfUrl: stripeInvoiceUrl(inv.invoice_pdf),
  };
}

/** "£99.00", "$129.00": minor units to the invoice's own currency. */
export function money(minor: number, currency: string): string {
  const sym = currency === "usd" ? "$" : currency === "gbp" ? "£" : `${currency.toUpperCase()} `;
  return `${minor < 0 ? "-" : ""}${sym}${(Math.abs(minor) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Which payments get the "Payment received" email: money actually taken. A trial's opening £0 invoice is not one. */
export const worthTelling = (f: InvoiceFacts) => f.amountPaid > 0 && (f.status === "paid" || f.status === null);

/** What kind of payment it was, in words: the first, a trial converting, a renewal, a change. */
export function paymentKind(f: InvoiceFacts): string {
  switch (f.billingReason) {
    case "subscription_create": return "your first payment";
    case "subscription_cycle": return "your monthly renewal";
    case "subscription_update": return "a change to your plan";
    default: return "a payment";
  }
}

export type InvoiceRow = { id: string; number: string | null; date: number | null; amount: string; status: string; hostedUrl: string | null; pdfUrl: string | null };

const STATUS: Record<string, string> = { paid: "Paid", open: "Due", void: "Void", uncollectible: "Unpaid", draft: "Draft" };

/** Plan > Billing's rows: newest first, drafts left out (a customer never sees a draft). */
export function invoiceRows(list: readonly Record<string, unknown>[]): InvoiceRow[] {
  return list
    .map(invoiceFacts)
    .filter((f): f is InvoiceFacts => !!f && f.status !== "draft")
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((f) => ({ id: f.id, number: f.number, date: f.paidAt ?? f.created, amount: money(f.total, f.currency), status: STATUS[f.status ?? ""] ?? (f.status ?? "-"), hostedUrl: f.hostedUrl, pdfUrl: f.pdfUrl }));
}

/**
 * The read-only audit (stripe-audit cron): what the live invoices say about the account's invoice settings, as
 * counts and yes/no only - no customer, no email, no amount. Stripe copies the account's invoice template onto each
 * invoice (account_name, account_tax_ids, footer), so they show whether Settings > Invoices is filled in.
 */
export type InvoiceAudit = {
  invoices: number;
  byStatus: Record<string, number>;
  byReason: Record<string, number>;
  paid: number;
  withAccountName: number;
  accountNames: string[];
  withAccountTaxId: number;
  withFooter: number;
  withCustomerAddress: number;
  withCustomerTaxId: number;
  automaticTax: number;
  ukWithTax: number;
  ukPaid: number;
  withPdf: number;
};

export function auditInvoices(list: readonly Record<string, unknown>[]): InvoiceAudit {
  const a: InvoiceAudit = { invoices: 0, byStatus: {}, byReason: {}, paid: 0, withAccountName: 0, accountNames: [], withAccountTaxId: 0, withFooter: 0,
    withCustomerAddress: 0, withCustomerTaxId: 0, automaticTax: 0, ukWithTax: 0, ukPaid: 0, withPdf: 0 };
  const names = new Set<string>();
  for (const inv of list) {
    const f = invoiceFacts(inv);
    if (!f) continue;
    a.invoices++;
    a.byStatus[f.status ?? "none"] = (a.byStatus[f.status ?? "none"] ?? 0) + 1;
    a.byReason[f.billingReason ?? "none"] = (a.byReason[f.billingReason ?? "none"] ?? 0) + 1;
    if (f.status === "paid") a.paid++;
    const name = str(inv.account_name);
    if (name) { a.withAccountName++; names.add(name); }
    if (Array.isArray(inv.account_tax_ids) && inv.account_tax_ids.length) a.withAccountTaxId++;
    if (str(inv.footer)) a.withFooter++;
    const addr = (inv.customer_address ?? null) as Record<string, unknown> | null;
    if (addr && (str(addr.line1) || str(addr.postal_code))) a.withCustomerAddress++;
    if (Array.isArray(inv.customer_tax_ids) && inv.customer_tax_ids.length) a.withCustomerTaxId++;
    if ((inv.automatic_tax as Record<string, unknown> | undefined)?.enabled === true) a.automaticTax++;
    if (str(addr?.country) === "GB" && f.status === "paid" && f.amountPaid > 0) {
      a.ukPaid++;
      if (f.tax > 0) a.ukWithTax++;
    }
    if (f.pdfUrl) a.withPdf++;
  }
  a.accountNames = [...names].slice(0, 3);
  return a;
}
