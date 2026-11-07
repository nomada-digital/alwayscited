import "server-only";

import { readFileSync } from "node:fs";

import { applyOp, editReplaces, refuseOp, type Op } from "./ops";
import { planShape } from "./plan";
import { nextMonthStart, refuseSwap, refuseUpgrade } from "./plan-change";
import type { FootRow, PlanUpgrade, Raw, RawClient, TierKey } from "./types";

/**
 * A local run of the dashboards host with no database (17 Oct 2026).
 * `DASH_FIXTURE=<path>` names a snapshot in the shape the Nomada prototype's
 * pull_ac_customer.py writes; it is read once, held in memory, and every op
 * applies to it there, so the editing flows can be driven end to end without
 * a write leaving the machine. A restart reads the file again.
 *
 * The snapshot is a customer's rows, so it is never committed (this repository
 * is public) - it lives outside the tree. Production refuses the switch, as
 * TRACKING_FIXTURE is refused (fixture-mode.ts).
 */

export const FIXTURE_EMAIL = "demo@dashboards.localhost";

export function dashFixturePath(env: Record<string, string | undefined> = process.env): string | null {
  const p = env.DASH_FIXTURE;
  if (!p) return null;
  if (env.VERCEL_ENV === "production") throw new Error("DASH_FIXTURE is set in production - the dashboards host refuses to start on a snapshot");
  return p;
}

type Snap = {
  domain: Record<string, unknown>;
  clusters: Raw["clusters"];
  keywords: Raw["keywords"];
  prompts: Raw["prompts"];
  runs: Raw["runs"];
  serp: Raw["serp"];
  answers: Raw["answers"];
  footprint: { pulled_on?: string; rows?: FootRow[] } | null;
  opportunities: Raw["opportunities"];
  groups?: Raw["groups"];
  placements?: Raw["placements"];
};

const KEY = Symbol.for("alwayscited.dashFixture");
type Store = { raw: Raw; n: number };

function store(): Store {
  const g = globalThis as { [KEY]?: Store };
  if (g[KEY]) return g[KEY];
  const path = dashFixturePath()!;
  const s = JSON.parse(readFileSync(path, "utf8")) as Snap;
  const d = s.domain;
  const today = [...s.runs.map((r) => r.run_date), ...s.answers.map((a) => a.run_date)].sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const tier = (process.env.DASH_FIXTURE_TIER ?? (d.tier as string) ?? "tracked") as TierKey;
  const client: RawClient = {
    id: String(d.id),
    slug: String(d.slug),
    domain: String(d.domain),
    brand: (d.brand_name as string | null) ?? null,
    market: String(d.market ?? "US"),
    tier,
    status: String(d.status ?? "active"),
    started_on: (d.started_on as string | null) ?? null,
    cluster_limit: Number(d.cluster_limit ?? 10),
    trial_ends_at: (d.trial_ends_at as string | null) ?? null,
    payment_status: (d.payment_status as string | null) ?? null,
    brand_aliases: (d.brand_aliases as string[] | null) ?? [],
    plan_slots: (d.plan_slots as number | null | undefined) ?? null,
    ...(d.order ? { order: d.order } : {}),
  };
  const clusters = s.clusters;
  const keywords = s.keywords.map((k) => ({ ...k, cluster_id: k.cluster_id ?? clusters.find((c) => c.keyword_id === k.id)?.id ?? null, group_id: k.group_id ?? null }));
  const raw: Raw = {
    client,
    role: "owner",
    today,
    clusters,
    groups: s.groups ?? [],
    keywords,
    prompts: s.prompts.map((p) => ({ ...p, group_id: p.group_id ?? null })),
    runs: s.runs,
    serp: s.serp,
    answers: s.answers,
    footprint: s.footprint ? { pulled_on: s.footprint.pulled_on ?? today, rows: s.footprint.rows ?? [] } : null,
    opportunities: s.opportunities ?? [],
    placements: s.placements ?? [],
    connections: [],
    consoleRows: [],
    groupsReady: true,
    planRequests: { swap: null, upgrades: [] },
  };
  g[KEY] = { raw, n: 0 };
  return g[KEY];
}

export function fixtureClient(): RawClient {
  return store().raw.client;
}

export function fixtureRaw(): Raw {
  return store().raw;
}

export function fixtureWrite(op: Op): { ok: true; ids: Record<string, string>; replaced?: string } | { ok: false; message: string; status?: number } {
  const s = store();
  const refused = refuseOp(s.raw, op, planShape());
  if (refused) return { ok: false, message: refused, status: 422 };
  const ids: Record<string, string> = {};
  const replaced = op.op === "prompt.edit" && editReplaces(s.raw, op.id) ? op.id : undefined;
  s.raw = applyOp(s.raw, op, {
    by: FIXTURE_EMAIL,
    newId: (t) => (ids[t] ??= `fx-${++s.n}-${t.slice(0, 8)}`),
  });
  return { ok: true, ids, ...(replaced ? { replaced } : {}) };
}

export function fixtureRequest(provider: "ga4" | "gsc" | "bing"): void {
  const s = store();
  const now = new Date().toISOString();
  s.raw = { ...s.raw, connections: [...s.raw.connections.filter((c) => c.provider !== provider), { provider, status: "requested", property: null, requested_at: now, connected_at: null, last_synced_at: null }] };
}

/**
 * A plan change on the snapshot (7 Nov 2026): the plan route's rules (plan-change.ts), held in memory like every
 * other fixture write, so the swap and add-to-plan flows can be driven end to end locally. A keyword starts a
 * tracking-only cluster through fixtureWrite first, as the route does. Nothing is posted anywhere.
 */
export function fixturePlan(b: { action: string; from?: string; to?: string; keyword?: string; clusterId?: string; id?: string }): { ok: true; id: string; slack: false; onPlan?: true } | { ok: false; message: string } {
  const s = store();
  const req = s.raw.planRequests ?? { swap: null, upgrades: [] };
  const now = new Date().toISOString();
  const start = (keyword: string): string | { message: string } => {
    const w = fixtureWrite({ op: "cluster.add", tempId: "plan", name: keyword, keyword });
    return w.ok ? w.ids.plan! : { message: w.message };
  };
  if (b.action === "swap.cancel") {
    if (!req.swap || req.swap.id !== b.id) return { ok: false, message: "That swap is not booked any more." };
    s.raw = { ...s.raw, planRequests: { ...req, swap: null } };
    return { ok: true, id: b.id, slack: false };
  }
  if (b.action === "upgrade.cancel") {
    if (!req.upgrades.some((u) => u.id === b.id)) return { ok: false, message: "That request is not waiting any more." };
    s.raw = { ...s.raw, planRequests: { ...req, upgrades: req.upgrades.filter((u) => u.id !== b.id) } };
    return { ok: true, id: b.id!, slack: false };
  }
  if (b.action === "swap") {
    let to = b.to ?? null;
    if (!to && b.keyword) {
      if (req.swap) return { ok: false, message: "A swap is already booked. Cancel it first to choose another." };
      const made = start(b.keyword);
      if (typeof made !== "string") return { ok: false, message: made.message };
      to = made;
    }
    const no = refuseSwap(s.raw, b.from ?? "", to ?? "", req.swap);
    if (no) return { ok: false, message: no };
    const id = `fx-swap-${++s.n}`;
    s.raw = { ...s.raw, planRequests: { ...req, swap: { id, from_cluster_id: b.from!, to_cluster_id: to!, effective_on: nextMonthStart(s.raw.today), status: "pending", requested_by: FIXTURE_EMAIL, created_at: now } } };
    return { ok: true, id, slack: false };
  }
  let clusterId = b.clusterId ?? null;
  if (!clusterId && b.keyword) {
    const made = start(b.keyword);
    if (typeof made === "string") clusterId = made;
  }
  const started = clusterId ? s.raw.clusters.find((c) => c.id === clusterId) : null;
  if (started && s.raw.client.tier !== "tracked" && started.tier === s.raw.client.tier) return { ok: true, id: started.id, slack: false, onPlan: true };
  const no = refuseUpgrade(s.raw, clusterId, clusterId ? null : (b.keyword ?? null), req.upgrades);
  if (no) return { ok: false, message: no };
  const u: PlanUpgrade = { id: `fx-up-${++s.n}`, cluster_id: clusterId, keyword: clusterId ? null : (b.keyword ?? null), price_amount: 99500, currency: "gbp", price_source: "order", status: "requested", requested_by: FIXTURE_EMAIL, created_at: now };
  s.raw = { ...s.raw, planRequests: { ...req, upgrades: [...req.upgrades, u] } };
  return { ok: true, id: u.id, slack: false };
}
