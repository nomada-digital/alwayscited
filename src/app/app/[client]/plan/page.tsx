import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Sidebar from "@/components/app/Sidebar";
import Actions, { SECTION_ERROR } from "@/components/app/plan/Actions";
import { PlacementsGroup } from "@/components/app/plan/List";
import ThisWeek from "@/components/app/plan/ThisWeek";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { loadDiyClient } from "@/lib/diy/core/client";
import { diyDay } from "@/lib/diy/core/jobs";
import { arrange, pickCluster, pickGroup, pickStatus, pickView } from "@/lib/diy/plan/board";
import { readPlan, section } from "@/lib/diy/plan/data";
import { ownerLabel, placementsGroup } from "@/lib/diy/plan/placements";
import { type Readout, joinWindows, readout, readoutWindows } from "@/lib/diy/plan/readout";
import { ENDED_REASON, VIEWER_REASON, planToast } from "@/lib/diy/plan/transitions";
import { mondayOf, thisWeek, weekCounts } from "@/lib/diy/plan/week";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Actions - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * Actions (13 Oct 2026, DIY P3; spec 10 section 4.6): one list of what to
 * do, why, and what was read after it. Internally the Plan - the route, the
 * table and the code keep that word - and "Actions" to the client (section
 * 1.1 row 33). Same membership rule as every /app/[client] page: no session
 * is the login page, a slug that is not one of the session's clients a 404.
 *
 * Query keys, each bounded here (section 3.5): `view` board or list; `status`
 * a plan status; `kind` a kind group; `cluster` one of this client's
 * clusters; `done` and `why` the plan route's toast codes, drawn through
 * planToast's fixed words.
 *
 * Each section reads on its own and a failed read says so, never reads as
 * nothing (section 3.4). No loading.tsx: a segment loading boundary streams
 * before the login redirect and the membership 404 run, so both would answer
 * 200 (node_modules/next/dist/docs, loading.md "Status Codes"; AppLink.tsx,
 * R151), and its streamed content is swapped in by script, which JS-off
 * cannot run. The dashboard's pending bar is the loading state.
 */
export default async function ClientPlan({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/plan`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const canWrite = refuseRole(writeRole(client)) === null;
  const reason = client.status === "ended" ? ENDED_REASON : VIEWER_REASON;
  const placed = placedTier(tier);

  const [structure, upgrade, team, plan, placements] = await Promise.all([
    repo.structure(client.id),
    repo.upgradeContext(client.id, email, today),
    section("plan team", () => repo.settings(client.id)),
    section("plan items", () => readPlan(() => supabaseAdmin(), client.id)),
    section("plan placements", () => repo.placements(client.id)),
  ]);
  const clusters = structure.clusters.filter((c) => c.stopped_on === null).map((c) => ({ id: c.id, name: c.name }));
  const clusterNames = new Map(structure.clusters.map((c) => [c.id, c.name]));
  const items = plan.ok ? plan.value : [];

  const view = pickView(one("view"));
  const filters = { kind: pickGroup(one("kind")), cluster: pickCluster(one("cluster"), clusters.map((c) => c.id)), status: pickStatus(one("status")) };
  const keep = { ...(view ? { view } : {}), ...(filters.kind ? { kind: filters.kind } : {}), ...(filters.cluster ? { cluster: filters.cluster } : {}), ...(filters.status ? { status: filters.status } : {}) };

  // The readouts: verdicts in each done item's window before it and in the latest one, read only when one is 21
  // days old, and only those windows (readout.ts readoutWindows), never the whole history since the oldest.
  const windows = readoutWindows(items, today, client.started_on);
  const readings = windows
    ? await section("plan readouts", async () => {
        const opts = { answers: "verdicts" as const, structure, ...(windows.cluster ? { cluster: windows.cluster } : {}) };
        const parts = await Promise.all(windows.windows.map(async (w) => ({ window: w, ...(await repo.loadOverview(client.id, w, "none", opts)) })));
        return joinWindows(parts);
      })
    : null;
  const readouts = new Map<string, Readout | { kind: "error"; text: string } | null>();
  for (const i of items) {
    if (i.status !== "done") continue;
    const early = readout(i, { today, clusters: [], keywords: [], prompts: [], answers: [], serp: [], placements: [], items: [] });
    if (early?.kind === "early" || !i.clusterId || !readings) readouts.set(i.id, early);
    else if (!readings.ok) readouts.set(i.id, { kind: "error", text: SECTION_ERROR });
    else {
      const d = readings.value;
      // A failed placements read is said in the readout, never read as no placements (section 3.4).
      readouts.set(i.id, readout(i, { today, clusters: structure.clusters, keywords: structure.keywords, prompts: structure.questions, answers: d.answers, serp: d.serp, placements: placements.ok ? placements.value : null, items }));
    }
  }

  // The placed tiers' Placements group, owned by nomada digital or, in agency mode, the account contact. The mode is read
  // where a failed read throws (client.ts), so a failure hides the group rather than naming Nomada to an agency's client.
  let group: React.ReactNode = null;
  if (placed) {
    const mode = await section("plan mode", async () => {
      if (fixtureMode()) return upgrade.mode;
      const c = await loadDiyClient(supabaseAdmin(), client.id, repo.now());
      if (!c) throw new Error("no client row");
      return c.upsellMode;
    });
    const showList = view === "list" || filters.status === "dropped";
    const cls = showList ? undefined : view === null ? "plan-only-sm" : null;
    if (cls !== null) {
      group =
        mode.ok && placements.ok ? (
          <PlacementsGroup rows={placementsGroup(placements.value, clusterNames)} owner={ownerLabel(mode.value)} className={cls} />
        ) : (
          <section aria-label="Placements" className={cls} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "18px 20px" }}>
            <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
              {SECTION_ERROR}
            </p>
          </section>
        );
    }
  }

  const utc = diyDay(repo.now());
  const week = plan.ok ? thisWeek(items, utc) : [];
  const counts = weekCounts(items, utc);
  const arranged = plan.ok ? arrange(items, filters, today) : null;
  const started = client.started_on !== null && client.started_on <= today;
  const empty = plan.ok && items.length === 0;
  const emptyText = empty ? (started ? "Nothing open. New items arrive as your checks find them." : "Your actions fill in after your first check and your first page checks.") : null;
  const notice = !empty && arranged?.nothingOpen && !filters.status ? "Nothing open. New items arrive as your checks find them." : null;
  const members = team.ok ? team.value.members.map((m) => ({ email: m.email, name: m.name })) : null;

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={structure.clusters.length > 0} current="Actions" placements={placed} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Actions
          slug={slug}
          view={view}
          keep={keep}
          filters={filters}
          arranged={arranged}
          items={items}
          ctx={{ slug, keep, canWrite, reason, members, viewer: email, clusterNames, readouts, monday: mondayOf(utc) }}
          toast={planToast(one("done"), one("why"))}
          week={
            plan.ok && items.length ? (
              <ThisWeek items={week} counts={counts} slug={slug} canWrite={canWrite} reason={reason} keep={keep} />
            ) : null
          }
          clusters={clusters}
          placements={group}
          emptyText={emptyText}
          notice={notice}
          readOnly={canWrite ? null : reason}
        />
      </div>
    </div>
  );
}
