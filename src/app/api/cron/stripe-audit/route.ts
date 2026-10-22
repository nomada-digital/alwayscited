import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { auditInvoices } from "@/lib/checkout/invoice";
import { stripeAuditReads } from "@/lib/checkout/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The weekly Stripe invoice audit (22 Oct 2026, invoice.ts): read only, never a write, never a charge. What the live
 * account's recent invoices say about its invoice template (business name, VAT number, footer), the customers'
 * addresses and tax IDs, automatic tax and UK VAT taken; whether Stripe Tax is active; and whether the webhook
 * endpoint is subscribed to invoice.paid. Counts and yes/no only - no customer, no email, no amount - in the answer
 * and in the log line, so the Vercel log is where it is read. Vercel Cron calls it with Bearer <CRON_SECRET>.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const r = await stripeAuditReads();
  const why = (x: { ok: boolean; reason?: string; status?: number }) => (x.ok ? null : `${x.reason}${x.status ? " " + x.status : ""}`);
  const tax = r.tax.ok ? r.tax.body : null;
  const hooks = r.hooks.ok ? ((r.hooks.body.data ?? []) as Record<string, unknown>[]) : [];
  const ours = hooks.filter((h) => typeof h.url === "string" && /alwayscited\.com\/api\/stripe\/webhook/.test(h.url as string));
  const events = new Set(ours.flatMap((h) => (Array.isArray(h.enabled_events) ? (h.enabled_events as string[]) : [])));
  const out = {
    at: new Date().toISOString(),
    invoices: r.invoices.ok ? auditInvoices((r.invoices.body.data ?? []) as Record<string, unknown>[]) : { refused: why(r.invoices) },
    stripe_tax: tax ? { status: tax.status ?? null, head_office_country: ((tax.head_office as Record<string, unknown> | null)?.address as Record<string, unknown> | undefined)?.country ?? null,
      default_tax_behavior: (tax.defaults as Record<string, unknown> | undefined)?.tax_behavior ?? null } : { refused: why(r.tax) },
    tax_rates_active: r.rates.ok ? ((r.rates.body.data ?? []) as unknown[]).length : { refused: why(r.rates) },
    webhook: r.hooks.ok ? { endpoints: ours.length, all_events: events.has("*"), invoice_paid: events.has("*") || events.has("invoice.paid"),
      invoice_payment_failed: events.has("*") || events.has("invoice.payment_failed") } : { refused: why(r.hooks) },
  };
  console.log(`[stripe-audit] ${JSON.stringify(out)}`);
  return NextResponse.json(out);
}
