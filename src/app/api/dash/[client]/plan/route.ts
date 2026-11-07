import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { clientsFor } from "@/lib/tracking/member";
import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath, fixtureClient, fixturePlan } from "@/lib/dash/fixture";
import { NAME_MAX } from "@/lib/dash/ops";
import { cancelSwap, cancelUpgrade, planSlots, readPlanRequests, requestSwap, requestUpgrade } from "@/lib/dash/plan-requests";
import type { Raw, RawClient, TierKey } from "@/lib/dash/types";
import { loadStructure, writeOp } from "@/lib/dash/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Changing what the plan works on (7 Nov 2026; rules in lib/dash/plan-change.ts, writes in plan-requests.ts).
 * JSON in, JSON out, owners only:
 *
 *  - `{ action: "swap", from, to }` books a tracking-only cluster (`to`) into a plan cluster's place (`from`) from
 *    the 1st of next month. `keyword` in place of `to` first starts a tracking-only cluster for it.
 *  - `{ action: "upgrade", clusterId }` or `{ action: "upgrade", keyword }` asks for a cluster to be added to the
 *    plan, at the price it would add. A keyword is started as a tracking-only cluster when the allowance has room,
 *    so it is measured while the request waits. Nothing is charged: the customer success manager confirms.
 *  - `{ action: "swap.cancel" | "upgrade.cancel", id }`.
 *
 * Answers `{ ok: true, id, slack }` (slack: whether #alwayscited heard) or `{ ok: false, message }` in words the
 * page shows as they are.
 */
const ID = /^[0-9A-Za-z_-]{1,64}$/;
const idOf = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
const kwOf = (v: unknown) => (typeof v === "string" && v.trim().length >= 2 && v.length <= 200 ? v.replace(/\s+/g, " ").trim() : null);
const no = (message: string, status = 422) => Response.json({ ok: false, message }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return no("Your session has ended. Sign in again.", 401);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = b?.action;
  if (action !== "swap" && action !== "swap.cancel" && action !== "upgrade" && action !== "upgrade.cancel") return no("That change could not be read.", 400);
  if (dashFixturePath()) {
    // A local run: the same rules, held in memory (fixture.ts fixturePlan). Nothing reaches Slack or a database.
    if (fixtureClient().slug !== slug) return no("Not found.", 404);
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const r = fixturePlan({ action, from: str(b?.from), to: str(b?.to), keyword: kwOf(b?.keyword) ?? undefined, clusterId: str(b?.clusterId), id: str(b?.id) });
    return r.ok ? Response.json(r) : no(r.message);
  }

  const clients = await clientsFor(email).catch(() => null);
  if (!clients) return no("Could not read your access. Try again.", 502);
  const c = clients.find((x) => x.slug === slug);
  if (!c) return no("Not found.", 404);
  const db = supabaseAdmin();
  const client: RawClient = {
    id: c.id, slug: c.slug, domain: c.domain, brand: c.brand, market: c.market, tier: c.tier as TierKey, status: c.status ?? "active",
    started_on: c.started_on, cluster_limit: c.cluster_limit ?? 10, trial_ends_at: c.trial_ends_at ?? null, payment_status: null, brand_aliases: [],
    plan_slots: await planSlots(db, c.id, c.tier),
  };
  const read = async (): Promise<Raw | string> => {
    const s = await loadStructure(db, { client, role: c.role, today: trackingDay() });
    if (typeof s === "string") return s;
    return { ...s, planRequests: await readPlanRequests(db, c.id) };
  };
  let raw = await read().catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
  if (typeof raw === "string") return no(raw, 502);
  if (raw.role !== "owner") return no("Only the account owner can change the plan.", 403);

  /** A tracking-only cluster for a keyword, through the same op the Clusters page sends: its id, or why not. */
  const startCluster = async (keyword: string): Promise<string | { message: string }> => {
    const r = await writeOp(db, raw as Raw, { op: "cluster.add", tempId: "plan", name: keyword.slice(0, NAME_MAX), keyword }, email);
    if (!r.ok) return { message: r.message };
    const fresh = await read();
    if (typeof fresh === "string") return { message: fresh };
    raw = fresh;
    return r.ids.plan!;
  };

  if (action === "swap.cancel" || action === "upgrade.cancel") {
    const id = idOf(b?.id);
    if (!id) return no("That change could not be read.", 400);
    const r = action === "swap.cancel" ? await cancelSwap(db, raw, { id, by: email }) : await cancelUpgrade(db, raw, { id, by: email });
    return r.ok ? Response.json(r) : no(r.message, r.status);
  }

  if (action === "swap") {
    const from = idOf(b?.from);
    let to = idOf(b?.to);
    const keyword = kwOf(b?.keyword);
    if (!from || (!to && !keyword)) return no("Pick the cluster to swap out and the one to bring in.", 400);
    if (!to && keyword) {
      // Judged before the cluster is started, so a refused swap leaves nothing behind.
      if (raw.planRequests?.swap) return no("A swap is already booked. Cancel it first to choose another.");
      const made = await startCluster(keyword);
      if (typeof made !== "string") return no(made.message);
      to = made;
    }
    const r = await requestSwap(db, raw, { from, to: to!, by: email });
    return r.ok ? Response.json(r) : no(r.message, r.status);
  }

  // upgrade
  let clusterId = idOf(b?.clusterId);
  const keyword = clusterId ? null : kwOf(b?.keyword);
  if (!clusterId && !keyword) return no("Pick the cluster or keyword to add to your plan.", 400);
  if (keyword) {
    const k = keyword.toLowerCase();
    const have = raw.keywords.find((x) => x.stopped_on === null && x.keyword.toLowerCase() === k && x.cluster_id);
    const own = have ? raw.clusters.find((x) => x.id === have.cluster_id && x.keyword_id === have.id && x.stopped_on === null) : null;
    if (own) clusterId = own.id;
    else {
      // Measured while it waits when there is room; otherwise the request carries the keyword and we set it up.
      const made = await startCluster(keyword);
      if (typeof made === "string") clusterId = made;
    }
  }
  // A plan with a paid cluster not yet set up takes the new one as that cluster: nothing to ask for.
  const started = clusterId ? raw.clusters.find((x) => x.id === clusterId) : null;
  if (started && raw.client.tier !== "tracked" && started.tier === raw.client.tier && started.stopped_on === null) return Response.json({ ok: true, id: started.id, slack: false, onPlan: true });
  const r = await requestUpgrade(db, raw, { clusterId, keyword: clusterId ? null : keyword, by: email });
  return r.ok ? Response.json(r) : no(r.message, r.status);
}
