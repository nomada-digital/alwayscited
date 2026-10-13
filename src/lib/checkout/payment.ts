/**
 * Payment state (BL-2, 9 Oct 2026): what a client's Stripe subscription says
 * about being paid, and what the webhook does with it. Pure, so every rule is
 * tested with recorded payloads and never a live call; subscription-events.ts
 * and signup.ts do the reads and writes, into the columns
 * 20261009030000_payment_state.sql adds.
 *
 * Before this, customer.subscription.updated rewrote only cluster_limit and
 * trial_ends_at, and the runner dispatches every client whose status is
 * active (runner.ts dispatchTrackingRuns). A card that failed for good left
 * the client tracked every day at our cost, and its owner was never told.
 *
 * - past_due: Stripe is still retrying. Tracking carries on and the owner
 *   sees a banner with what to do (tracking/plan-banner.ts).
 * - unpaid, paused, incomplete_expired: Stripe has stopped trying, or never
 *   will. The client ends, as a cancellation ends it - nothing is deleted -
 *   and payment_ended_at says why. incomplete_expired is not in the BL-2
 *   spec's list: it is the one other status in which Stripe never charges
 *   the subscription again.
 * - canceled: the client ends through the same path as
 *   customer.subscription.deleted (signup.ts endClient), whichever of the two
 *   events arrives first.
 * - active or trialing again: the failure is over. A client ended for payment
 *   is made active again; one ended any other way stays ended.
 *
 * Stripe does not promise to deliver events in order, so each write carries
 * the event's own `created` time and is made only over an older one
 * (newerThanRecorded): an unpaid that arrives after the payment that cleared
 * it ends nobody.
 */

/** Statuses in which Stripe has stopped charging, so tracking stops. */
export const PAYMENT_ENDS: readonly string[] = ["unpaid", "paused", "incomplete_expired"];

/** Every subscription status Stripe documents; anything else is not recorded. */
export const SUBSCRIPTION_STATUSES: readonly string[] = ["trialing", "active", "past_due", "unpaid", "paused", "canceled", "incomplete", "incomplete_expired"];

/** What the webhook reads back before it decides. */
export const PAYMENT_READ = "status, payment_status, payment_status_at, payment_ended_at";

/**
 * The banner's columns. Read on their own until 13 Oct 2026; since the
 * dashboard speed work they ride in the shell's one read (tracking/shell.ts),
 * which is read again without them when it fails, so a failure here still
 * costs the banner and never the dashboard.
 */
export const PAYMENT_BANNER_READ = "payment_status, payment_retry_at, payment_invoice_url, payment_ended_at";

export type PaymentRow = { status: string | null; payment_status: string | null; payment_status_at: string | null; payment_ended_at: string | null };

export type PaymentWrite = {
  payment_status: string;
  payment_status_at: string;
  payment_retry_at?: string | null;
  payment_invoice_url?: string | null;
  payment_ended_at?: string | null;
  status?: "ended" | "active";
};

/**
 * What one event does to a client: the columns to write in one update (null
 * for none), whether that update ends or restores it, and whether the
 * subscription is cancelled, which ends it through endClient instead.
 */
export type PaymentStep = { write: PaymentWrite | null; end: boolean; restore: boolean; cancel: boolean };

const NOTHING: PaymentStep = { write: null, end: false, restore: false, cancel: false };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const iso = (s: number) => new Date(s * 1000).toISOString();

/** An event older than the one that set the recorded status. Ties go to the later arrival. */
export function staleEvent(row: Pick<PaymentRow, "payment_status_at">, atS: number): boolean {
  if (!row.payment_status_at) return false;
  const was = Date.parse(row.payment_status_at);
  return Number.isFinite(was) && was > atS * 1000;
}

/**
 * The same rule in the update itself, as a PostgREST filter: two events read
 * at once cannot both write, the older last. Quoted, so the timestamp's
 * colons and dots are read as a value.
 */
export function newerThanRecorded(atS: number): string {
  return `payment_status_at.is.null,payment_status_at.lte."${iso(atS)}"`;
}

/** Whether this client was ended by a payment status, so a payment can bring it back. */
export function endedForPayment(row: Pick<PaymentRow, "status" | "payment_ended_at">): boolean {
  return row.status === "ended" && Boolean(row.payment_ended_at);
}

/**
 * customer.subscription.updated (and .deleted, whose status is canceled):
 * the subscription's own status, recorded, and the client ended or restored
 * in the same write. A paid status clears the failed invoice's retry date
 * and link.
 */
export function afterSubscription(row: PaymentRow, sub: Record<string, unknown>, atS: number): PaymentStep {
  const s = str(sub.status);
  if (!SUBSCRIPTION_STATUSES.includes(s) || staleEvent(row, atS)) return NOTHING;
  const at = iso(atS);
  const paid = s === "active" || s === "trialing";
  const end = PAYMENT_ENDS.includes(s) && row.status !== "ended";
  const restore = endedForPayment(row) && (paid || s === "past_due");
  const cancel = s === "canceled";
  const write: PaymentWrite = {
    payment_status: s,
    payment_status_at: at,
    ...(paid ? { payment_retry_at: null, payment_invoice_url: null } : {}),
    // Ended for payment, or no longer: a cancellation is the end that sticks.
    ...(end ? { payment_ended_at: at, status: "ended" as const } : restore ? { payment_ended_at: null, status: "active" as const } : cancel ? { payment_ended_at: null } : {}),
  };
  return { write, end, restore, cancel };
}

/** The subscription an invoice belongs to: `parent.subscription_details` from API 2025-03-31, `subscription` before it. */
export function invoiceSubscription(invoice: Record<string, unknown>): { id: string; metadata: Record<string, unknown> } | null {
  const parent = ((invoice.parent ?? {}) as Record<string, unknown>).subscription_details as Record<string, unknown> | undefined;
  const legacy = invoice.subscription;
  const id = str(parent?.subscription) || str(legacy) || str((legacy as Record<string, unknown> | null)?.id);
  if (!/^sub_[A-Za-z0-9]{1,200}$/.test(id)) return null;
  const metadata = (parent?.metadata ?? (invoice.subscription_details as Record<string, unknown> | undefined)?.metadata ?? {}) as Record<string, unknown>;
  return { id, metadata };
}

/**
 * Stripe's hosted page for the failed invoice, where it can be paid with
 * another card. Only a Stripe invoice URL is kept, so no payload can put any
 * other link in front of an owner.
 */
export function hostedInvoiceUrl(invoice: Record<string, unknown>): string | null {
  const u = str(invoice.hosted_invoice_url);
  return u.length <= 600 && /^https:\/\/invoice\.stripe\.com\/[A-Za-z0-9/_\-.~?=&%]+$/.test(u) ? u : null;
}

/**
 * invoice.payment_failed: the subscription is past due, with the date Stripe
 * tries the card again (null when it will not) and the invoice's own page.
 *
 * A subscription's first invoice is left alone: Checkout shows that failure
 * to the buyer on its own form and makes no client. (This said a scan bought
 * twice would otherwise mark its first order's client. That mix-up reached
 * renewals too, and is closed where the client is found: by the
 * subscription's order row, subscription-events.ts, 9 Oct 2026.) An invoice
 * never moves the client's status - only the subscription's own events end
 * or restore it - and does not write over a status that has already stopped
 * tracking.
 */
export function afterFailedInvoice(row: PaymentRow, invoice: Record<string, unknown>, atS: number): PaymentStep {
  if (str(invoice.billing_reason) === "subscription_create") return NOTHING;
  if (staleEvent(row, atS)) return NOTHING;
  if (PAYMENT_ENDS.includes(row.payment_status ?? "") || row.payment_status === "canceled") return NOTHING;
  const next = typeof invoice.next_payment_attempt === "number" ? iso(invoice.next_payment_attempt) : null;
  return { ...NOTHING, write: { payment_status: "past_due", payment_status_at: iso(atS), payment_retry_at: next, payment_invoice_url: hostedInvoiceUrl(invoice) } };
}

/** What the dashboard knows about a client's payment. */
export type PaymentView = { payment_status: string | null; payment_retry_at: string | null; payment_invoice_url: string | null; payment_ended_at: string | null };

/**
 * The banner's columns joined onto the clients (tracking/shell.ts). Their
 * failure - the columns not there yet, or anything else - costs the banner
 * and never the dashboard: a paying client's data is not held back because
 * we could not read whether they paid. `rows` is null when the read with
 * them failed and the shell read again without, and every client is then
 * drawn as if nothing were wrong.
 */
export function withPayment<C extends { id: string }>(clients: C[], rows: Record<string, unknown>[] | null): (C & Partial<PaymentView>)[] {
  if (!rows) return clients;
  const by = new Map(rows.map((r) => [str(r.id), r]));
  return clients.map((c) => {
    const r = by.get(c.id);
    if (!r) return c;
    return {
      ...c,
      payment_status: str(r.payment_status) || null,
      payment_retry_at: str(r.payment_retry_at) || null,
      // Checked again on the way out, as on the way in.
      payment_invoice_url: hostedInvoiceUrl({ hosted_invoice_url: r.payment_invoice_url }),
      payment_ended_at: str(r.payment_ended_at) || null,
    };
  });
}
