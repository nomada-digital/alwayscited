import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { appPath } from "@/lib/app-host";
import { diyFixtureWrites } from "@/lib/diy/core/fixture";
import { planFixture } from "@/lib/diy/plan/data";
import { type Decision, ITEM_ID, type PlanDone, type PlanForm, type PlanWhy, decide, isPlanDo } from "@/lib/diy/plan/transitions";
import { KIND_GROUPS, PLAN_STATUSES } from "@/lib/diy/plan/types";
import { getPlanItem, insertTask, patchRow, taskRow, updatePlanItem } from "@/lib/diy/plan/write";
import { itemOf } from "@/lib/diy/plan/data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { isUsageEvent } from "@/lib/tracking/usage";
import { recordUsage } from "@/lib/tracking/usage-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** No read is paid for and nothing waits on a vendor: a session read, one item read and one write (spec 10 section 3.6). */
export const maxDuration = 60;

/**
 * The Actions page's writes (13 Oct 2026, DIY P3; spec 10 sections 3.6 and
 * 4.6): accept, start, later (hide 14 days), move, drop, add (an own task),
 * note and assign. Posted by plain HTML forms on Actions and on the
 * Overview's This week, so every one works with JS off; the answer is a 303
 * back to the page with `done=` and, on a refusal, `why=` - fixed codes whose
 * words are transitions.ts planToast's. Nothing typed is echoed in the URL.
 *
 * The session decides the member, and the slug must be one of their clients
 * or the answer is the page's own 404. Owners and editors write; a viewer,
 * and anyone on an ended client (writeRole), is refused. The rule for each
 * post is transitions.ts `decide`, on the item as read; the update is held to
 * this client's row and to the status it was read with, so two members
 * moving one card cannot both win.
 *
 * On the fixture the same rule runs on the rows held in memory, with
 * TRACKING_FIXTURE_WRITE=1; without it the preview refuses to save.
 */

const ID = /^[0-9A-Za-z_-]{1,64}$/;

/** The page state the form's action carries, each key to its own whitelist; the page checks the cluster against its own. */
function readKeep(sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  const view = sp.get("view");
  if (view === "board" || view === "list") out.view = view;
  const status = sp.get("status");
  if (status && (PLAN_STATUSES as readonly string[]).includes(status)) out.status = status;
  const kind = sp.get("kind");
  if (kind && (KIND_GROUPS as readonly string[]).includes(kind)) out.kind = kind;
  const cluster = sp.get("cluster");
  if (cluster && ID.test(cluster)) out.cluster = cluster;
  return out;
}

const field = (form: FormData | null, k: string): unknown => form?.get(k) ?? null;

/** Until the shell adds the plan events to USAGE_EVENTS (usage.ts is a registry file), nothing is recorded. */
async function recordPlanUsage(db: SupabaseClient, p: { clientId: string; email: string; today: string; event: "plan_move" | "plan_task_added" | "plan_hidden" }) {
  if (!isUsageEvent(p.event)) return;
  await recordUsage(db, { clientId: p.clientId, email: p.email, event: p.event, path: "/plan", today: p.today });
}

export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const keep = readKeep(sp);
  const toOverview = sp.get("back") === "overview";
  const toWeek = sp.get("at") === "week";
  // The item rides in the action's query and `do` on the button pressed, so the forms need no hidden field.
  const rawId = sp.get("id");
  const id = rawId !== null && ITEM_ID.test(rawId) ? rawId : null;
  const form = await req.formData().catch(() => null);
  const d = field(form, "do");
  if (!isPlanDo(d)) return NextResponse.json({ error: "Not a change this page can make." }, { status: 400 });
  const post: PlanForm = { do: d, id, to: field(form, "to"), changed: field(form, "changed"), note: field(form, "note"), owner: field(form, "owner"), title: field(form, "title"), cluster: field(form, "cluster") };

  const back = (done: PlanDone, why: PlanWhy | null = null, itemId: string | null = id) => {
    if (toOverview) return NextResponse.redirect(dashUrl(req, appPath(`/${encodeURIComponent(slug)}?${new URLSearchParams({ plan: done })}#this-week`)), 303);
    const q = new URLSearchParams({ ...keep, done, ...(why ? { why } : {}) });
    const hash = toWeek ? "#this-week" : d === "add" && done !== "added" ? "#new-task" : itemId ? `#item-${itemId}` : "";
    return NextResponse.redirect(dashUrl(req, appPath(`/${encodeURIComponent(slug)}/plan?${q}${hash}`)), 303);
  };

  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await repo.clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const today = repo.today();
  const now = new Date(repo.now()).toISOString();
  // Only the post that needs them reads them: the team for assign, the clusters for add.
  const members = d === "assign" ? (await repo.settings(client.id)).members : [];
  const clusters = d === "add" ? (await repo.structure(client.id)).clusters.filter((c) => c.stopped_on === null).map((c) => c.id) : [];
  const rule = (item: Parameters<typeof decide>[1]): Decision => decide(post, item, { role: writeRole(client), today, now, by: email, members, clusters });

  if (fixtureMode()) {
    const fx = planFixture();
    const rows = fx.rows();
    const at = id ? rows.findIndex((r) => String(r.id) === id && r.client_domain_id === client.id) : -1;
    const decision = rule(at >= 0 ? itemOf(rows[at]!) : null);
    if (decision.op === "refuse") return back("refused", decision.why);
    if (!diyFixtureWrites()) return back("refused", "readonly");
    if (decision.op === "insert") {
      const key = `fx-${rows.length + 1}-${Date.now().toString(36)}`;
      const row = { id: key, created_at: now, ...taskRow(client.id, { title: decision.title, clusterId: decision.clusterId, by: email, now, key }) };
      fx.write([...rows, row]);
      return back("added", null, key);
    }
    const next = patchRow(rows[at]!, decision.patch, decision.expect);
    if (!next) return back("refused", "gone");
    fx.write(rows.map((r, i) => (i === at ? next : r)));
    return back(decision.done);
  }

  const db = supabaseAdmin();
  try {
    const decision = rule(id ? await getPlanItem(db, client.id, id) : null);
    if (decision.op === "refuse") {
      console.warn(`[diy] plan ${d} refused: ${decision.why}`);
      return back("refused", decision.why);
    }
    if (decision.op === "insert") {
      const added = await insertTask(db, client.id, { title: decision.title, clusterId: decision.clusterId, by: email, now });
      await recordPlanUsage(db, { clientId: client.id, email, today, event: "plan_task_added" });
      return back("added", null, added);
    }
    if (!(await updatePlanItem(db, client.id, decision.id, decision.patch, decision.expect))) return back("refused", "gone");
    if (d !== "note" && d !== "assign") await recordPlanUsage(db, { clientId: client.id, email, today, event: d === "later" ? "plan_hidden" : "plan_move" });
    return back(decision.done);
  } catch (err) {
    console.warn(`[diy] plan ${d}: ${err instanceof Error ? err.message : String(err)}`);
    return back("refused", "failed");
  }
}
