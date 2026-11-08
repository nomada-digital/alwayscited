import assert from "node:assert/strict";
import { test } from "node:test";

import { addedClusterTier, applyOp } from "./ops.ts";
import { limitsLine, packageExcludes, money, nextMonthStart, refuseSwap, refuseUpgrade, serpChances, upgradePrice, upsellSignals } from "./plan-change.ts";
import type { PlanSwap, PlanUpgrade, Raw, RawCluster } from "./types.ts";

/**
 * Customer controls (Danny, 7 Nov 2026): a cluster added self-serve fills a paid slot and is otherwise tracking
 * only; swaps start on the 1st of next month, one at a time; adding to the plan is a priced request, never a
 * charge; and the page-1 lists come from the snapshot, leaving out what is tracked and the brand's own name.
 */

const cl = (id: string, tier: string, stopped_on: string | null = null): RawCluster => ({ id, name: `cluster ${id}`, keyword_id: null, tier, started_on: "2026-10-01", stopped_on });

function raw(over: Partial<Raw> = {}, client: Partial<Raw["client"]> = {}): Raw {
  return {
    client: { id: "c1", slug: "mor", domain: "mortalentboutique.com", brand: "MOR Talent Boutique", market: "UK", tier: "cited", status: "active", started_on: "2026-10-31", cluster_limit: 10, trial_ends_at: null, payment_status: null, brand_aliases: [], plan_slots: 1, ...client },
    role: "owner",
    today: "2026-11-07",
    clusters: [cl("a", "cited")],
    groups: [],
    keywords: [{ id: "w1", keyword: "household staff agency", search_volume: 50, intent: null, added_on: "2026-10-31", stopped_on: null, cluster_id: "a", group_id: null }],
    prompts: [],
    runs: [],
    serp: [],
    answers: [],
    footprint: null,
    opportunities: [],
    placements: [],
    connections: [],
    consoleRows: [],
    groupsReady: true,
    ...over,
  };
}

test("a cluster added fills the plan's paid slots first, then is tracking only", () => {
  // MOR: one paid cluster, set up - the next is tracking only.
  assert.equal(addedClusterTier(raw()), "tracked");
  // Two paid, one set up: the next goes on the plan.
  assert.equal(addedClusterTier(raw({}, { plan_slots: 2 })), "cited");
  // A new customer with nothing set up: the first cluster is the plan's, even with no order to read.
  assert.equal(addedClusterTier(raw({ clusters: [] }, { plan_slots: null })), "cited");
  // No order: as many as are set up now, so an invoiced client gains none for free.
  assert.equal(addedClusterTier(raw({ clusters: [cl("a", "cited"), cl("b", "cited")] }, { plan_slots: null })), "tracked");
  // A stopped plan cluster frees its slot; a tracking plan only ever tracks.
  assert.equal(addedClusterTier(raw({ clusters: [cl("a", "cited", "2026-11-02")] })), "cited");
  assert.equal(addedClusterTier(raw({ clusters: [] }, { tier: "tracked" })), "tracked");
  // applyOp draws what the server writes.
  const next = applyOp(raw(), { op: "cluster.add", tempId: "t1", name: "nanny agency", keyword: "nanny agency" }, { by: "" });
  assert.equal(next.clusters.find((c) => c.id === "t1")?.tier, "tracked");
});

test("a swap takes effect on the 1st of next month", () => {
  assert.equal(nextMonthStart("2026-11-07"), "2026-12-01");
  assert.equal(nextMonthStart("2026-12-31"), "2027-01-01");
  assert.equal(nextMonthStart("2026-11-01"), "2026-12-01");
});

test("a swap: owner only, a plan cluster out, a tracking-only cluster in, one at a time", () => {
  const r = raw({ clusters: [cl("a", "cited"), cl("b", "tracked"), cl("c", "tracked", "2026-11-05")] });
  assert.equal(refuseSwap(r, "a", "b", null), null);
  assert.match(refuseSwap({ ...r, role: "editor" }, "a", "b", null)!, /owner/);
  assert.match(refuseSwap(r, "b", "a", null)!, /not one we work on/);
  assert.match(refuseSwap(r, "a", "c", null)!, /removed/);
  assert.match(refuseSwap(r, "a", "a", null)!, /not one we work on|already on your plan/);
  const pending: PlanSwap = { id: "s1", from_cluster_id: "a", to_cluster_id: "b", effective_on: "2026-12-01", status: "pending", requested_by: "m@x.com", created_at: "2026-11-07T10:00:00Z" };
  assert.match(refuseSwap(r, "a", "b", pending)!, /already booked for 1 December 2026/);
  assert.match(refuseSwap(raw({}, { tier: "tracked" }), "a", "b", null)!, /tracking only/);
});

test("adding to the plan: owner only, a tracking-only cluster or a keyword, never twice", () => {
  const r = raw({ clusters: [cl("a", "cited"), cl("b", "tracked")] });
  assert.equal(refuseUpgrade(r, "b", null, []), null);
  assert.equal(refuseUpgrade(r, null, "nanny agency", []), null);
  assert.match(refuseUpgrade(r, "a", null, [])!, /already on your plan/);
  assert.match(refuseUpgrade({ ...r, role: "viewer" }, "b", null, [])!, /owner/);
  const open: PlanUpgrade = { id: "u1", cluster_id: "b", keyword: null, price_amount: 99500, currency: "gbp", price_source: "order", status: "requested", requested_by: "m@x.com", created_at: "2026-11-07T10:00:00Z" };
  assert.match(refuseUpgrade(r, "b", null, [open])!, /already asked/);
  assert.match(refuseUpgrade(r, null, "x", [])!, /Name the keyword/);
  assert.match(refuseUpgrade(raw({}, { tier: "tracked" }), null, "nanny agency", [])!, /paid plan/);
});

test("the price of one more plan cluster: the sector table, else the customer's own order, else a call", () => {
  const sector = (s: string, m: "us" | "uk") => (s === "recruitment" ? (m === "uk" ? 1195 : 1495) : null);
  assert.deepEqual(upgradePrice({ sector: "recruitment", market: "UK", quantity: 2, monthly_amount: 239000, currency: "gbp" }, "UK", sector), { amount: 119500, currency: "gbp", source: "sector" });
  // MOR: no sector, a custom £995 for one cluster.
  assert.deepEqual(upgradePrice({ sector: null, market: null, quantity: 1, monthly_amount: 99500, currency: "gbp" }, "UK", sector), { amount: 99500, currency: "gbp", source: "order" });
  assert.deepEqual(upgradePrice(null, "US", sector), { amount: null, currency: null, source: "call" });
  assert.equal(money(99500, "gbp"), "£995");
  assert.equal(money(149550, "usd"), "$1,495.50");
  assert.equal(money(null, "gbp"), null);
});

test("the shared allowance reads as one line", () => {
  assert.equal(limitsLine({ prompts: { used: 5, limit: 50 }, clusters: { used: 1, limit: 10 } }), "5 of 50 prompts · 1 of 10 clusters");
});

test("page 1 and close to page 1: untracked, unbranded, by volume", () => {
  const r = raw({
    footprint: {
      pulled_on: "2026-11-01",
      rows: [
        { k: "household staff agency", p: 4, u: "/", v: 90 },
        { k: "nanny agency london", p: 7, u: "/nannies", v: 300 },
        { k: "butler agency", p: 2, u: "/", v: 40 },
        { k: "mor talent boutique", p: 1, u: "/", v: 70 },
        { k: "private chef agency", p: 14, u: "/", v: 200 },
        { k: "estate manager jobs", p: 33, u: "/", v: 500 },
      ],
    },
  });
  const c = serpChances(r);
  assert.deepEqual(c.page1.map((x) => x.keyword), ["nanny agency london", "butler agency"]);
  assert.deepEqual(c.close.map((x) => x.keyword), ["private chef agency"]);
  const s = upsellSignals({ ...r, clusters: [cl("a", "cited"), { ...cl("b", "tracked"), name: "nannies" }] });
  assert.deepEqual([s.trackingOnly, s.page1, s.close], [["nannies"], 2, 1]);
  assert.equal(serpChances(raw()).page1.length, 0);
});

test("no ranking-target KPI, no link insertions; anything else excluded stays excluded", () => {
  assert.deepEqual(packageExcludes({ ranking_kpi: false, excluded_deliverables: [] }), ["insertions"]);
  assert.deepEqual(packageExcludes({ ranking_kpi: true, excluded_deliverables: ["schema"] }), ["schema"]);
  assert.deepEqual(packageExcludes({ ranking_kpi: false, excluded_deliverables: ["insertions"] }), ["insertions"]);
  assert.deepEqual(packageExcludes(null), []);
});
