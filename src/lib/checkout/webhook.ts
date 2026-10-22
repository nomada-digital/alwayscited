import { createHmac, timingSafeEqual } from "node:crypto";

import { isPlausibleDomain, normalizeDomain } from "../scan/domain.ts";
import type { CouponTerms } from "./stripe.ts";

/**
 * The Stripe webhook's rules - BRIEF-3 C4 (docs/tracked-dashboard-2026-09-29/
 * BRIEF-3-clusters.md), R92/R110/R117, 30 Sep 2026.
 *
 * Pure apart from what the caller injects, so every rule is tested with a
 * recorded fixture and never a live call: the signature is checked against
 * the raw body before anything is parsed; with no secret the door answers
 * 503 and acts on nothing, never skips the check; the event id is recorded
 * first and a replay answers 200 and does nothing; only the events the
 * endpoint is registered for are acted on.
 */

/** Stripe's own default tolerance for a signature's timestamp. */
export const SIGNATURE_TOLERANCE_S = 300;

/**
 * customer.subscription.trial_will_end joined on 8 Oct 2026 (audit
 * activation-1): Stripe sends it three days before a trial ends, and it is
 * trial_ending's fallback trigger beside the daily cron. Acted on only once
 * the Stripe endpoint is subscribed to it - until then Stripe never posts it.
 *
 * invoice.payment_failed joined on 9 Oct 2026 (BL-2, payment.ts): each failed
 * attempt carries the date Stripe tries again and the invoice's own page,
 * which customer.subscription.updated does not - it fires once, when the
 * status first moves to past_due. The same proviso: Stripe posts it only
 * once the endpoint is subscribed to it.
 */
export const HANDLED_EVENTS = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.trial_will_end", "invoice.payment_failed"] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** `Stripe-Signature: t=<unix>,v1=<hex>[,v1=...]`, HMAC-SHA256 of `${t}.${body}`. */
export function verifyStripeSignature(raw: string, header: string | null, secret: string, nowS: number = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t" && v && /^\d+$/.test(v)) t = Number(v);
    if (k === "v1" && v && /^[0-9a-f]{64}$/i.test(v)) sigs.push(v.toLowerCase());
  }
  if (t === null || !sigs.length || Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S) return false;
  const want = Buffer.from(hmacHex(secret, `${t}.${raw}`));
  return sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** For tests: the header Stripe would send. */
export function signStripePayload(raw: string, secret: string, t: number): string {
  return `t=${t},v1=${hmacHex(secret, `${t}.${raw}`)}`;
}

/** `created` is when Stripe made the event, unix seconds: payment.ts orders by it, as Stripe does not order delivery. */
export type StripeEvent = { id: string; type: string; created?: number; data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> } };

/** What checkout.session.completed carries that signup needs, read from the Session and its metadata. */
export type CompletedOrder = {
  sessionId: string;
  email: string | null;
  tier: string;
  sector: string;
  quantity: number;
  market: string;
  keyword: string;
  scanToken: string | null;
  /** The buyer's website, set at /checkout only when there is no scan (R158, 1 Oct 2026). */
  website: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  amountTotal: number | null;
  currency: string | null;
  /** The trial's length when checkout gave one (config/trial.ts), else null. */
  trialDays: number | null;
  /** The buyer's GA client id, set at checkout only after a yes to analytics (15 Oct 2026), else null. */
  gaClientId: string | null;
  /** The promotion code's id when the buyer entered one at Stripe (22 Oct 2026), else null. */
  promotionId: string | null;
  /** What the discount took off this first payment, in the smallest unit; null when none. */
  amountDiscount: number | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** session.ts normalised it; metadata is still read as untrusted. */
function siteOf(v: string): string | null {
  const d = normalizeDomain(v);
  return d && isPlausibleDomain(d) ? d : null;
}

export function completedOrder(session: Record<string, unknown>): CompletedOrder {
  const m = (session.metadata ?? {}) as Record<string, unknown>;
  const details = (session.customer_details ?? {}) as Record<string, unknown>;
  const email = (str(details.email) || str(session.customer_email)).trim().toLowerCase() || null;
  const scan = str(m.scan_token);
  return {
    sessionId: str(session.id),
    email,
    tier: str(m.tier),
    sector: str(m.sector),
    quantity: Number(str(m.quantity)) || 1,
    market: str(m.market),
    keyword: str(m.keyword),
    scanToken: /^[0-9a-f]{32}$/i.test(scan) ? scan.toLowerCase() : null,
    website: siteOf(str(m.website)),
    subscriptionId: str(session.subscription) || null,
    customerId: str(session.customer) || null,
    amountTotal: typeof session.amount_total === "number" ? session.amount_total : null,
    currency: str(session.currency) || null,
    trialDays: /^\d{1,2}$/.test(str(m.trial_days)) ? Number(str(m.trial_days)) : null,
    gaClientId: /^\d{1,12}\.\d{1,12}$/.test(str(m.ga_client_id)) ? str(m.ga_client_id) : null,
    promotionId: promotionOf(session),
    amountDiscount: discountOf(session),
  };
}

/** The Session's promotion code id: `discounts[].promotion_code`, an id or an expanded object. */
function promotionOf(session: Record<string, unknown>): string | null {
  const list = Array.isArray(session.discounts) ? (session.discounts as Record<string, unknown>[]) : [];
  for (const d of list) {
    const p = d?.promotion_code;
    const id = typeof p === "string" ? p : typeof (p as { id?: unknown } | null)?.id === "string" ? (p as { id: string }).id : "";
    if (/^promo_[A-Za-z0-9]{1,200}$/.test(id)) return id;
  }
  return null;
}

function discountOf(session: Record<string, unknown>): number | null {
  const v = ((session.total_details ?? {}) as Record<string, unknown>).amount_discount;
  return typeof v === "number" && v > 0 ? v : null;
}

/** What the promotion line is built from: the code's read, and the subscription's next invoice dates. */
export type PromotionFacts = {
  read: ({ ok: true; code: string } & CouponTerms) | { ok: false; reason: string };
  /** Unix seconds; null when the subscription was not read. */
  trialEnd: number | null;
  currentPeriodEnd: number | null;
};

function addMonths(sec: number, n: number): number {
  const d = new Date(sec * 1000);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return Math.floor(d.getTime() / 1000);
}

/**
 * When the first invoice at full price is due, unix seconds, or null when none is (a forever code) or it cannot be
 * told. The plans bill monthly. `once` takes the first invoice only - the one at checkout, or the trial's - so the
 * next invoice is full price. `repeating` covers every invoice for its months from checkout (`now`), so the first
 * renewal on or after that.
 */
export function firstFullPrice(terms: { duration: string | null; months: number | null }, next: { trialEnd: number | null; currentPeriodEnd: number | null }, now: number): number | null {
  const upcoming = next.trialEnd && next.trialEnd > now ? next.trialEnd : next.currentPeriodEnd;
  if (!upcoming || terms.duration === "forever" || !terms.duration) return null;
  if (terms.duration === "once") return upcoming;
  if (!terms.months || terms.months < 1) return null;
  const ends = addMonths(now, terms.months);
  let at = upcoming;
  for (let i = 0; at < ends && i < 240; i++) at = addMonths(upcoming, i + 1);
  return at;
}

/**
 * The order email's promotion line (22 Oct 2026, after the goodtrip order went through at 0 on a 100% test code and
 * read like a sale): the code, the discount and the first full-price charge. Null when no code was used.
 */
export function promotionLine(o: CompletedOrder, facts: PromotionFacts | null, now: number, when: (sec: number) => string): string | null {
  if (!o.promotionId && !o.amountDiscount) return null;
  const cur = (o.currency ?? "").toUpperCase();
  const took = o.amountDiscount ? `, ${(o.amountDiscount / 100).toFixed(2)} ${cur} off this payment` : "";
  if (!facts || !facts.read.ok) {
    const why = facts && !facts.read.ok ? facts.read.reason : "not read";
    return `Promotion code: ${o.promotionId ?? "applied"}${took}. Code, duration and first full-price charge NOT read (${why}) - check the subscription in Stripe.`;
  }
  const r = facts.read;
  const off = r.percentOff !== null ? `${r.percentOff}% off` : r.amountOff !== null ? `${(r.amountOff / 100).toFixed(2)} ${(r.currency ?? cur).toUpperCase()} off` : "discount";
  const lasts = r.duration === "once" ? "once" : r.duration === "repeating" ? `for ${r.months ?? "?"} month(s)` : r.duration === "forever" ? "forever" : "duration unknown";
  const at = firstFullPrice(r, facts, now);
  const full =
    r.duration === "forever"
      ? "none - the code applies to every invoice"
      : at
        ? when(at)
        : "not known - check the subscription in Stripe";
  return `Promotion code: ${r.code} (${off}, ${lasts})${took}. First full-price charge: ${full}.`;
}

/**
 * The public.orders row for a completed Session (pricing spec section 5,
 * migration 20260930020000_orders.sql, applied and read back 30 Sep: R126).
 * Null, with the reason, when the order breaks one of the table's checks, so
 * a refused row is named in the order email instead of failing the signup.
 */
export type OrderRow = {
  stripe_session_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  tier: string;
  sector: string | null;
  quantity: number;
  market: string;
  email: string;
  keyword: string | null;
  scan_token: string | null;
  amount_total: number | null;
  currency: string | null;
  client_domain_id: string | null;
  /** When a trial ends and the first charge is due; null for a paid order. */
  trial_ends_at: string | null;
};

export function orderRow(o: CompletedOrder, clientId: string | null, trialEndsAt: string | null = null): { row: OrderRow } | { row: null; reason: string } {
  if (!o.sessionId) return { row: null, reason: "no Session id" };
  if (!o.email) return { row: null, reason: "no buyer email" };
  if (!["tracked", "mentioned", "cited"].includes(o.tier)) return { row: null, reason: `unknown tier "${o.tier}"` };
  if (o.market !== "uk" && o.market !== "us") return { row: null, reason: `unknown market "${o.market}"` };
  if (!Number.isInteger(o.quantity) || o.quantity < 1 || o.quantity > 100) return { row: null, reason: `quantity ${o.quantity} out of range` };
  const currency = o.currency?.toLowerCase() ?? null;
  return {
    row: {
      stripe_session_id: o.sessionId,
      stripe_customer_id: o.customerId,
      stripe_subscription_id: o.subscriptionId,
      tier: o.tier,
      sector: o.sector || null,
      quantity: o.quantity,
      market: o.market,
      email: o.email,
      keyword: o.keyword || null,
      scan_token: o.scanToken,
      amount_total: o.amountTotal !== null && o.amountTotal >= 0 ? o.amountTotal : null,
      currency: currency === "gbp" || currency === "usd" ? currency : null,
      client_domain_id: clientId,
      trial_ends_at: trialEndsAt,
    },
  };
}

/**
 * The market a signup's client is tracked in (18 Oct 2026): the plan paid for,
 * never the scan's. Checkout prices and charges the order's market on its own
 * and never compared it with the scan the buyer came from, so a UK plan bought
 * from a US scan's link made a US client, read in the US every day. The scan
 * still names the site; its cluster keyword, volume and prompts were read in
 * its own market, so they prefill the client only when that market is the one
 * paid for (`useScan`). An order with no market of its own (none since
 * checkout began recording it) falls back to the scan's.
 */
export function signupMarket(orderMarket: string, scanMarket: string | null): { market: "UK" | "US" | null; useScan: boolean } {
  const paid = orderMarket === "uk" ? "UK" : orderMarket === "us" ? "US" : null;
  const scan = scanMarket === "UK" || scanMarket === "US" ? scanMarket : null;
  if (paid) return { market: paid, useScan: scan === paid };
  return { market: scan, useScan: scan !== null };
}

/**
 * Where a signup picks up when Stripe retries it (R148 pass 8, 1 Oct 2026).
 * A run that fails after the first cluster is made (keyword or prompts
 * refused, owner not added) is retried; without this the retry made a second
 * cluster of the same name, and once the cluster is reused its keyword would
 * be refused forever ("already has its keyword"). So: the client's live
 * cluster of that name is reused, and its keyword and prompts are written
 * only if it has none yet.
 */
export function signupResume(existing: { id: string; keywordId: string | null; livePrompts: number } | null): { clusterId: string | null; keyword: boolean; prompts: boolean } {
  if (!existing) return { clusterId: null, keyword: true, prompts: true };
  return { clusterId: existing.id, keyword: !existing.keywordId, prompts: existing.livePrompts === 0 };
}

/**
 * The clusters a paid order still needs (R158, Danny, 1 Oct 2026, danny.md
 * 168): one per cluster bought, every one "Needs a keyword" unless the scan
 * chose cluster 1's keyword. `existing` is the names of the client's live
 * clusters, so a Stripe retry makes only the ones the last attempt did not.
 */
export function clustersToMake(quantity: number, first: string, needsKeyword: string, existing: string[]): string[] {
  const want = Array.from({ length: Math.max(1, quantity) }, (_, i) => (i === 0 ? first : needsKeyword));
  const left = [...existing];
  return want.filter((name) => {
    const i = left.indexOf(name);
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
}

/** The subscription's scan token, set on it at checkout (subscription_data[metadata]). */
export function subscriptionScanToken(sub: Record<string, unknown>): string | null {
  const t = str(((sub.metadata ?? {}) as Record<string, unknown>).scan_token);
  return /^[0-9a-f]{32}$/i.test(t) ? t.toLowerCase() : null;
}

/**
 * Packs on a subscription: the quantity of the item marked `kind=pack`, on the
 * item or its price. No checkout sells a pack yet, so today this is 0 and the
 * client sits at the base limit (limits.ts clusterLimitFor).
 */
export function packsOn(sub: Record<string, unknown>): number {
  const items = (((sub.items ?? {}) as Record<string, unknown>).data ?? []) as Record<string, unknown>[];
  let packs = 0;
  for (const it of items) {
    const own = str(((it.metadata ?? {}) as Record<string, unknown>).kind);
    const price = str((((it.price ?? {}) as Record<string, unknown>).metadata as Record<string, unknown> | undefined)?.kind);
    if (own === "pack" || price === "pack") packs += typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 1;
  }
  return packs;
}

export type WebhookDeps = {
  /** Insert the event id. "duplicate" when it was already there. */
  record: (id: string, type: string) => Promise<"new" | "duplicate" | "failed">;
  /** Undo `record` when the handler failed, so Stripe's retry is acted on. */
  forget: (id: string) => Promise<void>;
  completed: (order: CompletedOrder, eventId: string) => Promise<boolean>;
  /**
   * `previous` is the event's previous_attributes, which is how a trial's
   * conversion is seen. `at` is the event's created time (eventTime), which
   * orders the payment writes.
   */
  updated: (sub: Record<string, unknown>, previous: Record<string, unknown>, at: number) => Promise<boolean>;
  deleted: (sub: Record<string, unknown>, at: number) => Promise<boolean>;
  trialWillEnd: (sub: Record<string, unknown>) => Promise<boolean>;
  /** invoice.payment_failed (BL-2, 9 Oct 2026); the object is the Invoice. */
  paymentFailed: (invoice: Record<string, unknown>, at: number) => Promise<boolean>;
  /** 17 Oct 2026: an extra tracking pack's Checkout completed (packs.ts onPackCompleted). Absent: acknowledged, nothing done. */
  packCompleted?: (session: Record<string, unknown>) => Promise<boolean>;
  /** A pack subscription changed, or ended when `ended` (packs.ts onPackChanged). */
  packChanged?: (sub: Record<string, unknown>, ended: boolean) => Promise<boolean>;
  /** 22 Oct 2026: the agency hub's subscription offer was taken (hub-offer.ts onHubOfferCompleted). Absent: acknowledged, nothing done. */
  hubOfferCompleted?: (session: Record<string, unknown>) => Promise<boolean>;
};

/** The event's created time; the moment it arrived when Stripe's is missing, so a write is never undated. */
export function eventTime(event: { created?: unknown }, nowS: number = Math.floor(Date.now() / 1000)): number {
  return typeof event.created === "number" && Number.isInteger(event.created) && event.created > 0 ? event.created : nowS;
}

/** A session or subscription marked as an extra tracking pack (packs.ts PACK_KIND). Inline so this file stays dependency-free. */
function isPackObject(o: Record<string, unknown>): boolean {
  const m = o.metadata;
  return !!m && typeof m === "object" && (m as Record<string, unknown>).kind === "pack";
}

/** A Session marked as the agency hub's subscription offer (hub-offer.ts HUB_OFFER_KIND). Inline, as isPackObject. */
function isHubOfferObject(o: Record<string, unknown>): boolean {
  const m = o.metadata;
  return !!m && typeof m === "object" && (m as Record<string, unknown>).kind === "hub_offer";
}

export type WebhookAnswer = { status: number; body: { ok?: true; ignored?: string; error?: string } };

export async function handleWebhook(raw: string, signature: string | null, secret: string | undefined, deps: WebhookDeps, nowS?: number): Promise<WebhookAnswer> {
  if (!secret) return { status: 503, body: { error: "not_configured" } };
  if (!verifyStripeSignature(raw, signature, secret, nowS)) return { status: 400, body: { error: "bad_signature" } };
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return { status: 400, body: { error: "bad_body" } };
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
    return { status: 400, body: { error: "bad_body" } };
  }
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return { status: 200, body: { ok: true, ignored: event.type } };

  const recorded = await deps.record(event.id, event.type);
  if (recorded === "failed") return { status: 500, body: { error: "record_failed" } };
  if (recorded === "duplicate") return { status: 200, body: { ok: true, ignored: "duplicate" } };

  const obj = event.data.object;
  const type = event.type as HandledEvent;
  const at = eventTime(event, nowS);
  // 17 Oct 2026: an extra tracking pack (packs.ts) is its own subscription, marked kind=pack. It goes to its own
  // handler before anything else is asked, so a pack never runs the signup path and never makes a client.
  const pack = isPackObject(obj);
  // 22 Oct 2026: the hub's offer (hub-offer.ts) is a subscription for a client that already exists. Its completed
  // Session goes to its own handler, so it never runs signup and never makes a client; its later subscription events
  // are the client's own (the order row names the subscription) and take the usual path below.
  const offer = type === "checkout.session.completed" && isHubOfferObject(obj);
  const done = offer
    ? await (deps.hubOfferCompleted?.(obj) ?? Promise.resolve(true))
    : pack
    ? type === "checkout.session.completed"
      ? await (deps.packCompleted?.(obj) ?? Promise.resolve(true))
      : type === "customer.subscription.updated" || type === "customer.subscription.deleted"
        ? await (deps.packChanged?.(obj, type === "customer.subscription.deleted") ?? Promise.resolve(true))
        : true
    : type === "checkout.session.completed"
      ? await deps.completed(completedOrder(obj), event.id)
      : type === "customer.subscription.updated"
        ? await deps.updated(obj, event.data.previous_attributes ?? {}, at)
        : type === "customer.subscription.trial_will_end"
          ? await deps.trialWillEnd(obj)
          : type === "invoice.payment_failed"
            ? await deps.paymentFailed(obj, at)
            : await deps.deleted(obj, at);
  if (!done) {
    await deps.forget(event.id);
    return { status: 500, body: { error: "handler_failed" } };
  }
  return { status: 200, body: { ok: true } };
}

/** The order email to Danny (pricing spec section 5): plain text, what was bought and what the webhook did. */
export function orderEmailText(o: CompletedOrder, outcome: string, siteOrigin: string, trial: { firstCharge: string; amount: string } | null = null, promotion: string | null = null): { subject: string; text: string } {
  const amount = o.amountTotal !== null && o.currency ? `${(o.amountTotal / 100).toFixed(2)} ${o.currency.toUpperCase()}` : "unknown";
  const text = [
    "A checkout completed on alwayscited.com.",
    "",
    `Tier: ${o.tier || "unknown"}`,
    `Sector: ${o.sector || "-"}`,
    `Clusters: ${o.quantity}`,
    `Market: ${o.market || "unknown"}`,
    `Email: ${o.email ?? "none given"}`,
    `Keyword target: ${o.keyword || "-"}`,
    `First payment: ${amount}`,
    ...(promotion ? [promotion] : []),
    ...(trial ? [`Trial started - first charge ${trial.firstCharge}, ${trial.amount}`] : []),
    // Which path the signup took (R158, 1 Oct 2026): from the scan, or with no scan from the website.
    `Path: ${o.scanToken ? "scan" : "no scan"}`,
    `Scan: ${o.scanToken ? `${siteOrigin}/scan/${o.scanToken}` : "none"}`,
    `Website: ${o.scanToken ? "-" : (o.website ?? "none given - set the client up by hand in /admin/tracking")}`,
    `Stripe session: ${o.sessionId}`,
    "",
    `Set up: ${outcome}`,
    "",
    // ON-1 review (9 Oct 2026): setup is self-serve - the client checks each keyword and edits the five prompts drafted from it.
    o.tier === "tracked"
      ? "Setup is self-serve: the client checks each cluster's keyword on the setup page and saves the five prompts drafted from it. Nothing to book."
      : "Book the onboarding call. The client sets each cluster's keyword and prompts on the setup page; the call goes through them.",
  ].join("\n");
  return { subject: `Order: ${o.tier || "unknown tier"}, ${o.quantity} cluster(s), ${o.email ?? "no email"}`, text };
}

/**
 * A trial that just became a paying subscription: customer.subscription.updated
 * with status active where it was trialing. Logged; the client's
 * trial_ends_at follows Stripe's trial_end through trialEndsAtAfter below.
 */
export function trialConverted(sub: Record<string, unknown>, previous: Record<string, unknown>): boolean {
  return str(previous.status) === "trialing" && str(sub.status) === "active";
}

/**
 * What client_domains.trial_ends_at becomes after a
 * customer.subscription.updated, or undefined to leave it (8 Oct 2026, review
 * of 7e133a7).
 *
 * The column was Stripe's trial_end as signup read it, and nothing moved it
 * afterwards. A trial ended early in Stripe - charged on day 5 - still read
 * as running, so the daily cron would have sent trial_midpoint and
 * trial_ending to a paying client ("cancel before then and nothing is
 * charged"), and the sidebar and Settings kept the trial line and its Cancel.
 * Stripe's trial_end is the one source: it moves when a trial is extended,
 * and becomes the moment it ended when one is ended early. Once the
 * subscription has left its trial the column is never later than now, so
 * nothing reads the trial as running. An update that touches neither the
 * status out of trialing nor trial_end - a pack bought - leaves it alone.
 */
export function trialEndsAtAfter(sub: Record<string, unknown>, previous: Record<string, unknown>, nowMs: number = Date.now()): string | null | undefined {
  const left = str(previous.status) === "trialing" && str(sub.status) !== "trialing";
  const moved = Object.prototype.hasOwnProperty.call(previous, "trial_end");
  if (!left && !moved) return undefined;
  const end = typeof sub.trial_end === "number" ? sub.trial_end * 1000 : null;
  if (left) return new Date(Math.min(end ?? nowMs, nowMs)).toISOString();
  return end === null ? null : new Date(end).toISOString();
}

/**
 * trial_will_end is worth acting on only for a subscription still in its
 * trial: Stripe also sends it when a trial is ended early, and then the
 * reminder would arrive after the charge. `nowMs` for the tests.
 */
export function trialStillRunning(sub: Record<string, unknown>, nowMs: number = Date.now()): boolean {
  if (str(sub.status) !== "trialing") return false;
  return typeof sub.trial_end !== "number" || sub.trial_end * 1000 > nowMs;
}

/**
 * A trial set to end before its first charge (12 Oct 2026, email review H1).
 * The dashboard's Cancel trial was the only thing that wrote
 * trial_cancelled_at, but a trial is also cancelled by email to us (the help
 * page offers it; we cancel in Stripe) and in Stripe's customer portal, which
 * is set to cancel at period end. Those left the column empty, so
 * trial_ending and trial_midpoint told a client who had cancelled "From then
 * it is $129 a month, charged to the card". Stripe says it either way:
 * cancel_at_period_end, or cancel_at - the portal's and the Stripe
 * dashboard's scheduled cancel - no later than the trial's end, with an
 * hour's grace for Stripe's clock. A cancel_at after the trial's end is a
 * charge first, so not this.
 */
export function trialCancelPending(sub: Record<string, unknown>): boolean {
  if (str(sub.status) !== "trialing") return false;
  if (sub.cancel_at_period_end === true) return true;
  if (typeof sub.cancel_at !== "number") return false;
  return typeof sub.trial_end !== "number" || sub.cancel_at <= sub.trial_end + 3600;
}

/**
 * What client_domains.trial_cancelled_at becomes after a
 * customer.subscription.updated (12 Oct 2026, email review H1): the event's
 * time when a running trial is set to end uncharged (written only over an
 * empty column, so the dashboard's own stamp stands), null when this event
 * took that back (a renewal turned on again in the portal: the client will be
 * charged and is told so), or undefined to leave it - a subscription out of
 * its trial, or an update that touched neither cancel field.
 */
export function trialCancelledAfter(sub: Record<string, unknown>, previous: Record<string, unknown>, atS: number): string | null | undefined {
  if (str(sub.status) !== "trialing") return undefined;
  if (trialCancelPending(sub)) return new Date(atS * 1000).toISOString();
  const has = (k: string) => Object.prototype.hasOwnProperty.call(previous, k);
  return has("cancel_at_period_end") || has("cancel_at") ? null : undefined;
}
