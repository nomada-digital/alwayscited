import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { afterSubscription } from "./payment.ts";
import { SCAN_CLIENTS_READ, clientOfSubscription, onInvoicePaymentFailed, recordPayment, subscriptionClient, type SubscriptionEvidence } from "./subscription-events.ts";

/**
 * Which client a subscription's event lands on (9 Oct 2026, review of
 * 2c6dc99). The review found it was the newest client made from the
 * subscription's scan, whoever's it was: with two accounts on one scan, a
 * failed renewal on the first put its Stripe invoice page on the second's
 * banner, and an unpaid one ended the second while it paid.
 *
 * The handler itself runs here, against a stand-in for the supabase-js query
 * builder that holds rows in memory and applies the update's PostgREST `or`
 * filter as newerThanRecorded writes it. Nothing reaches Stripe or Supabase.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** `col.is.null` and `col.lte."<iso>"`, comma-joined: the two terms newerThanRecorded writes. */
function orFilter(expr: string): (r: Row) => boolean {
  const terms = expr.split(/,(?=[a-z_]+\.)/).map((t) => {
    const m = t.match(/^([a-z_]+)\.(is|lte)\.(.+)$/);
    assert.ok(m, `the stand-in does not know the filter term ${t}`);
    const [, col, op, raw] = m;
    if (op === "is") {
      assert.equal(raw, "null");
      return (r: Row) => (r[col!] ?? null) === null;
    }
    const v = Date.parse(raw!.replace(/^"|"$/g, ""));
    assert.ok(Number.isFinite(v), `not a time: ${raw}`);
    return (r: Row) => typeof r[col!] === "string" && Date.parse(r[col!] as string) <= v;
  });
  return (r) => terms.some((f) => f(r));
}

function fakeDb(tables: Tables, opts: { failReads?: Set<string> } = {}) {
  const writes: { table: string; ids: unknown[]; patch: Row }[] = [];
  const query = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const q = { op: "select" as "select" | "update", cols: null as string | null, patch: null as Row | null, orderBy: null as [string, boolean] | null, lim: null as number | null, one: false };
    const b = {
      select(cols: string) {
        if (q.op === "select") q.cols = cols;
        return b;
      },
      update(patch: Row) {
        q.op = "update";
        q.patch = patch;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      or: (expr: string) => (filters.push(orFilter(expr)), b),
      order: (c: string, o: { ascending?: boolean } = {}) => ((q.orderBy = [c, o.ascending !== false]), b),
      limit: (n: number) => ((q.lim = n), b),
      maybeSingle: () => ((q.one = true), b),
      then(resolve: (v: { data: unknown; error: { message: string } | null }) => void) {
        resolve(run());
      },
    };
    const run = (): { data: unknown; error: { message: string } | null } => {
      const rows = (tables[table] ??= []);
      if (opts.failReads?.has(table)) return { data: null, error: { message: `${table} refused by the test` } };
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (q.op === "update") {
        for (const r of hit) Object.assign(r, q.patch);
        writes.push({ table, ids: hit.map((r) => r.id), patch: q.patch! });
        return { data: null, error: null };
      }
      let out = hit;
      if (q.orderBy) {
        const [c, asc] = q.orderBy;
        out = [...out].sort((a, z) => (String(a[c]) < String(z[c]) ? -1 : String(a[c]) > String(z[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (q.lim !== null) out = out.slice(0, q.lim);
      const picked = out.map((r) => (q.cols ? Object.fromEntries(q.cols.split(",").map((c) => [c.trim(), r[c.trim()] ?? null])) : { ...r }));
      if (q.one) return { data: picked[0] ?? null, error: null };
      return { data: picked, error: null };
    };
    return b;
  };
  return { db: { from: query } as unknown as SupabaseClient, writes };
}

const T0 = 1_790_000_000;
const TOKEN = "ab".repeat(16);
const SCAN = "scan-1";
const PAGE_A = "https://invoice.stripe.com/i/acct_fixture/invoice_of_account_a";
const PAGE_B = "https://invoice.stripe.com/i/acct_fixture/invoice_of_account_b";

const client = (id: string, account: string, created: string): Row => ({
  id,
  account_id: account,
  source_scan_id: SCAN,
  created_at: created,
  status: "active",
  payment_status: null,
  payment_status_at: null,
  payment_retry_at: null,
  payment_invoice_url: null,
  payment_ended_at: null,
});

/**
 * Two accounts bought the same scan: account a first (client A, sub_a), then
 * account b (client B, sub_b), so B is the newest client made from the scan.
 * `orders` picks which of the two order rows exist; P is a client Nomada made
 * by hand from the same scan (admin/tracking/actions.ts), with no order.
 */
function world(o: { orderA?: boolean; orderB?: boolean; pilot?: boolean } = {}): Tables {
  const { orderA = true, orderB = true, pilot = false } = o;
  return {
    scans: [{ id: SCAN, public_token: TOKEN }],
    client_domains: [client("A", "acct-a", "2026-10-01T09:00:00Z"), client("B", "acct-b", "2026-10-02T09:00:00Z"), ...(pilot ? [client("P", "acct-p", "2026-10-03T09:00:00Z")] : [])],
    orders: [
      ...(orderA ? [{ stripe_session_id: "cs_a", stripe_subscription_id: "sub_a", client_domain_id: "A", email: "a@a.example" }] : []),
      ...(orderB ? [{ stripe_session_id: "cs_b", stripe_subscription_id: "sub_b", client_domain_id: "B", email: "b@b.example" }] : []),
    ],
  };
}

/** A renewal's failed charge on one subscription, in API 2025-03-31's shape, carrying the scan both bought. */
const failedRenewal = (sub: string, page: string, at = T0) => ({
  id: `in_${sub}`,
  billing_reason: "subscription_cycle",
  next_payment_attempt: at + 3 * 86_400,
  hosted_invoice_url: page,
  parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata: { scan_token: TOKEN } } },
});

const rowOf = (t: Tables, id: string) => t.client_domains!.find((r) => r.id === id)!;
const PAYMENT_COLS = ["status", "payment_status", "payment_status_at", "payment_retry_at", "payment_invoice_url", "payment_ended_at"];
const paymentOf = (t: Tables, id: string) => Object.fromEntries(PAYMENT_COLS.map((c) => [c, rowOf(t, id)[c]]));

test("reproduced: the newest client from the scan is the other account's, which the scan-first lookup took", () => {
  const t = world();
  const newest = [...t.client_domains!].filter((r) => r.source_scan_id === SCAN).sort((a, z) => String(z.created_at).localeCompare(String(a.created_at)))[0];
  assert.equal(newest!.id, "B", "sub_a's events went to B before 9 Oct 2026");
});

test("a failed renewal on one account's subscription writes its invoice to its own client and never to the other's", async () => {
  const t = world();
  const { db, writes } = fakeDb(t);
  const untouchedB = paymentOf(t, "B");
  assert.equal(await onInvoicePaymentFailed(db, failedRenewal("sub_a", PAGE_A), T0), true);
  assert.deepEqual(paymentOf(t, "A"), { status: "active", payment_status: "past_due", payment_status_at: new Date(T0 * 1000).toISOString(), payment_retry_at: new Date((T0 + 3 * 86_400) * 1000).toISOString(), payment_invoice_url: PAGE_A, payment_ended_at: null });
  assert.deepEqual(paymentOf(t, "B"), untouchedB, "account b's banner carries nothing of account a's");
  assert.deepEqual(writes.map((w) => w.ids), [["A"]]);
  // And the other way round.
  assert.equal(await onInvoicePaymentFailed(db, failedRenewal("sub_b", PAGE_B, T0 + 60), T0 + 60), true);
  assert.equal(rowOf(t, "B").payment_invoice_url, PAGE_B);
  assert.equal(rowOf(t, "A").payment_invoice_url, PAGE_A);
});

test("an unpaid subscription ends its own client; the other account's paying client keeps tracking", async () => {
  const t = world();
  const { db } = fakeDb(t);
  // As signup.ts onSubscriptionUpdated composes it: the client, then the payment step.
  const sub = { id: "sub_a", status: "unpaid", metadata: { scan_token: TOKEN } };
  const c = await clientOfSubscription(db, sub);
  assert.deepEqual(c, { id: "A", exact: true });
  let ended = 0;
  assert.equal(await recordPayment(db, c as { id: string; exact: boolean }, "sub_a", T0, (row) => afterSubscription(row, sub, T0), async () => (ended++, true)), true);
  assert.equal(rowOf(t, "A").status, "ended");
  assert.equal(rowOf(t, "B").status, "active");
  assert.equal(rowOf(t, "B").payment_status, null);
  assert.equal(ended, 0, "unpaid is a payment end, not a cancellation");
});

test("in every arrangement of order rows and pilots, one subscription's failed invoice never writes to a client it did not buy", async () => {
  let n = 0;
  for (const orderA of [true, false]) for (const orderB of [true, false]) for (const pilot of [true, false]) for (const sub of ["sub_a", "sub_b", "sub_unknown"]) {
    const t = world({ orderA, orderB, pilot });
    const { db, writes } = fakeDb(t);
    assert.equal(await onInvoicePaymentFailed(db, failedRenewal(sub, PAGE_A), T0), true);
    const own = sub === "sub_a" && orderA ? "A" : sub === "sub_b" && orderB ? "B" : null;
    const label = JSON.stringify({ orderA, orderB, pilot, sub });
    assert.deepEqual(writes.flatMap((w) => w.ids), own ? [own] : [], label);
    for (const id of ["A", "B", ...(pilot ? ["P"] : [])].filter((x) => x !== own)) assert.equal(rowOf(t, id).payment_invoice_url, null, `${id}: ${label}`);
    n += 1;
  }
  assert.equal(n, 24);
});

test("with no order row, the scan finds only the one client no other subscription bought, and it gets no payment step", async () => {
  // Signup has made B's client but not yet written its order row: A is sub_a's, so B is the only candidate.
  const race = world({ orderB: false });
  const { db } = fakeDb(race);
  assert.deepEqual(await clientOfSubscription(db, { id: "sub_b", metadata: { scan_token: TOKEN } }), { id: "B", exact: false });
  // The same before B's client exists: A belongs to sub_a, so nothing.
  const early: Tables = { ...world({ orderB: false }), client_domains: [client("A", "acct-a", "2026-10-01T09:00:00Z")] };
  assert.equal(await clientOfSubscription(fakeDb(early).db, { id: "sub_b", metadata: { scan_token: TOKEN } }), null);
  // A pilot made by hand and a buyer with no order row: two candidates, so neither.
  assert.equal(await clientOfSubscription(fakeDb(world({ orderB: false, pilot: true })).db, { id: "sub_b", metadata: { scan_token: TOKEN } }), null);
  // A guessed client keeps what it had before BL-2 (signup.ts) but gets no payment step.
  const before = paymentOf(race, "B");
  assert.equal(await recordPayment(db, { id: "B", exact: false }, "sub_b", T0, (row) => afterSubscription(row, { status: "unpaid" }, T0), async () => assert.fail("no end for a guess")), true);
  assert.deepEqual(paymentOf(race, "B"), before);
});

test("an order row with no client finds nothing, even when the scan has clients", async () => {
  const t = world();
  t.orders!.push({ stripe_session_id: "cs_c", stripe_subscription_id: "sub_c", client_domain_id: null, email: "c@c.example" });
  assert.equal(await clientOfSubscription(fakeDb(t).db, { id: "sub_c", metadata: { scan_token: TOKEN } }), null);
  // An order with no scan (R158) is found by its row alone, as before.
  t.orders!.push({ stripe_session_id: "cs_d", stripe_subscription_id: "sub_d", client_domain_id: "A", email: "a@a.example" });
  assert.deepEqual(await clientOfSubscription(fakeDb(t).db, { id: "sub_d", metadata: {} }), { id: "A", exact: true });
});

test("a failed read is false, so Stripe retries; nothing is written", async () => {
  for (const table of ["orders", "scans", "client_domains"]) {
    const t = world({ orderA: table !== "orders" ? false : true });
    const { db, writes } = fakeDb(t, { failReads: new Set([table]) });
    assert.equal(await onInvoicePaymentFailed(db, failedRenewal("sub_a", PAGE_A), T0), false, table);
    assert.deepEqual(writes, [], table);
  }
});

test("the rule on its own: the order row first, then the one unbought client from the scan, else none", () => {
  const e = (o: Partial<SubscriptionEvidence>): SubscriptionEvidence => ({ subscriptionId: "sub_x", ordered: [], fromScan: [], truncated: false, bought: [], ...o });
  assert.deepEqual(subscriptionClient(e({ ordered: [null, "A"], fromScan: ["B"] })).client, { id: "A", exact: true });
  assert.equal(subscriptionClient(e({ ordered: [null], fromScan: ["B"] })).client, null);
  assert.equal(subscriptionClient(e({})).client, null);
  assert.deepEqual(subscriptionClient(e({ fromScan: ["B", "A"], bought: [{ client: "A", subscription: "sub_a" }] })).client, { id: "B", exact: false });
  // An order row naming this very subscription, or none, does not rule a client out.
  assert.deepEqual(subscriptionClient(e({ fromScan: ["B"], bought: [{ client: "B", subscription: null }] })).client, { id: "B", exact: false });
  assert.equal(subscriptionClient(e({ fromScan: ["B", "P"] })).client, null, "two and nothing says which");
  assert.equal(subscriptionClient(e({ fromScan: ["A"], bought: [{ client: "A", subscription: "sub_a" }] })).client, null);
  // A read that hit its limit may have missed a client, so it is not read as one.
  assert.equal(subscriptionClient(e({ fromScan: ["B"], truncated: true })).client, null);
  assert.ok(SCAN_CLIENTS_READ >= 10);
});

/**
 * #11 payment_failed (brief 2e, 18 Oct 2026): the webhook hands in the mailer, and it is called with the client the
 * order row names, only when this invoice wrote the past-due state - never for a first invoice, a stale event, a
 * client guessed from the scan, or a subscription that is not ours.
 */
test("the payment_failed mailer is called once, for the client this invoice marked past due, and for nothing else", async () => {
  const calls: string[] = [];
  const mail = async (_db: unknown, clientId: string, invoice: Record<string, unknown>) => {
    calls.push(`${clientId} ${String(invoice.id)}`);
  };
  const t = world();
  const { db } = fakeDb(t);
  assert.equal(await onInvoicePaymentFailed(db, failedRenewal("sub_a", PAGE_A), T0, mail), true);
  assert.deepEqual(calls, ["A in_sub_a"]);
  // An older event than the one recorded writes nothing, so mails nothing.
  assert.equal(await onInvoicePaymentFailed(db, failedRenewal("sub_a", PAGE_A, T0 - 600), T0 - 600, mail), true);
  // A subscription's first invoice is Checkout's to show.
  assert.equal(await onInvoicePaymentFailed(db, { ...failedRenewal("sub_b", PAGE_B), billing_reason: "subscription_create" }, T0, mail), true);
  // A subscription with no order row and a scan two accounts bought: no client, no mail.
  const { db: db2 } = fakeDb(world({ orderA: false, orderB: false }));
  assert.equal(await onInvoicePaymentFailed(db2, failedRenewal("sub_x", PAGE_A), T0, mail), true);
  assert.deepEqual(calls, ["A in_sub_a"]);
});
