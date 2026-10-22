import "server-only";

import { invoiceRows, type InvoiceRow } from "@/lib/checkout/invoice";
import { listInvoices } from "@/lib/checkout/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Plan > Billing's invoice history (22 Oct 2026): the client's invoices, read live from Stripe for the customer on
 * its latest order row - never a customer id from the request. Null rows mean "nothing to show yet" (no card order,
 * e.g. a comped account); a string is why it could not be read, said on the page.
 */
export async function readInvoices(clientId: string): Promise<{ rows: InvoiceRow[] | null; why: string | null }> {
  const { data, error } = await supabaseAdmin()
    .from("orders")
    .select("stripe_customer_id")
    .eq("client_domain_id", clientId)
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(`[dash] invoices: order not read: ${error.message}`);
    return { rows: null, why: "Your invoices could not be read just now. Open billing to see them on Stripe." };
  }
  const customer = data?.[0]?.stripe_customer_id as string | undefined;
  if (!customer) return { rows: null, why: null };
  const r = await listInvoices(customer);
  if (!r.ok) {
    console.warn(`[dash] invoices: Stripe refused ${r.reason} ${r.status ?? ""}`);
    return { rows: null, why: "Your invoices could not be read just now. Open billing to see them on Stripe." };
  }
  return { rows: invoiceRows(r.data), why: null };
}
