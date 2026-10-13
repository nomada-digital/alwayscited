import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Activation from "@/components/app/Activation";
import Overview from "@/components/app/Overview";
import Sidebar from "@/components/app/Sidebar";
import { preloadActionsBadge } from "@/components/app/ActionsBadge";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { CARD, T } from "@/config/tokens";
import { activationShown, activationSteps } from "@/lib/tracking/activation";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { needsSetup, setupOutstanding, setupPath } from "@/lib/tracking/setup-landing";
import { refuseRole } from "@/lib/tracking/stop";
import { appPath } from "@/lib/app-host";
import { recentRange } from "@/lib/diy/changes/diff";
import ThisWeek from "@/components/app/plan/ThisWeek";
import WorkLog from "@/components/app/plan/WorkLog";
import { SECTION_ERROR } from "@/components/app/plan/Actions";
import { H2 as PLAN_H2, SECTION as PLAN_SECTION } from "@/components/app/plan/styles";
import { diyDay } from "@/lib/diy/core/jobs";
import { readPlan, section } from "@/lib/diy/plan/data";
import { ENDED_REASON, VIEWER_REASON, overviewPlanToast } from "@/lib/diy/plan/transitions";
import { thisWeek, weekCounts } from "@/lib/diy/plan/week";
import { workLog } from "@/lib/diy/plan/worklog";
import { loadPromptOrigins, originKinds } from "@/lib/diy/prompts/origins";
import { promptsAdded, workMarks } from "@/lib/diy/shell/work";
import { supabaseAdmin } from "@/lib/supabase/admin";
import WhereYouStand from "@/components/app/WhereYouStand";
import type { Watched } from "@/lib/diy/changes/diff";
import { loadFootprint, loadWhoRanks } from "@/lib/diy/keywords/data";
import { citedFacts } from "@/lib/diy/opportunities/cited";
import { oppDetailPath } from "@/lib/diy/opportunities/paths";
import { loadOppWorld } from "@/lib/diy/opportunities/world";
import { readPagesPart } from "@/lib/diy/pages/data";
import { isHomepage } from "@/lib/diy/pages/view";
import { beforeFirstCheck, whereYouStand } from "@/lib/diy/shell/day-zero";
import { citedPageRows } from "@/lib/tracking/figures";
import { firstCitedBy } from "@/lib/diy/prompts/placement-lines";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's dashboard: the sidebar (T3, 29 Sep 2026) and the overview
 * (T4), for the range the URL states - `?from=&to=&compare=`, BRIEF
 * decision 3.
 *
 * A slug the session's email is not a member of is a 404, not a 403, so
 * client slugs are not discoverable.
 */
export default async function ClientDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  preloadActionsBadge(client.id);
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  const placed = placedTier(tier);
  // ON-3 (9 Oct 2026, LB8): the activation checklist, for a client in its trial or first weeks only, so only they pay its two reads.
  // Settings' team read (member scoping applied there) and the usage rows a report or CSV leaves; a failed read leaves the list out.
  const checklist = activationShown({ status: client.status, startedOn: client.started_on, today, trialEndsAt: client.trial_ends_at ?? null, now: Date.now() });
  // 13 Oct 2026, DIY P4 (spec 10 section 4.1 row 5): "Since last check" reads the last week of checks whatever the
  // range shows. A range that holds that week (the default does) has read it already; any other takes one narrow read,
  // and a failed one is that section's failure alone - it says so, and the rest of the page draws.
  const week = recentRange(today);
  const holdsWeek = range.from <= week.from && range.to >= today;
  // 13 Oct 2026, DIY P5 (spec 10 section 7.6): the Plan's items for This week, the work log and the chart's work markers,
  // and P2's prompt origins for the basis line and the log. Each is its own section: a failed plan read says so where it
  // would have drawn, and origins never throw (an empty map draws no basis line).
  // 13 Oct 2026 (Danny): the cluster keywords whose page 1 the Google page has stored, for each card's "See who ranks".
  // 13 Oct 2026 (dashboard speed work): read from the start - only the fixture needs the overview's positions for it -
  // and so are P7's opportunities (wave 2 below), which only a client past its first check draws: one round trip
  // for the whole page, where each used to wait on the reads before it.
  const loaded = repo.loadOverview(client.id, range, compare);
  const oppRead = loadOppWorld(repo, client).then(
    (w) => ({ ok: true as const, value: w }),
    (err: unknown) => (console.warn(`[diy] overview opportunities: ${err instanceof Error ? err.message : String(err)}`), { ok: false as const }),
  );
  const [data, upgrade, rows, confirmed, team, reportOpened, weekRead, plan, origins, whoRanks, oppAll] = await Promise.all([
    loaded,
    repo.upgradeContext(client.id, email, today),
    repo.placements(client.id),
    needsSetup(client) || fixtureMode() ? repo.setupConfirmed(client.id) : null,
    checklist ? repo.settings(client.id).catch((err: unknown) => (console.warn(`[app] activation: the team was not read: ${err instanceof Error ? err.message : String(err)}`), null)) : null,
    checklist ? repo.reportOpened(client.id) : null,
    holdsWeek
      ? null
      : repo.loadOverview(client.id, week, "none").then(
          (d) => ({ ok: true as const, data: d }),
          (err: unknown) => (console.warn(`[diy] since-last-check: ${err instanceof Error ? err.message : String(err)}`), { ok: false as const }),
        ),
    section("overview plan", () => readPlan(() => supabaseAdmin(), client.id)),
    loadPromptOrigins(client.id),
    loadWhoRanks(client.id, range.to, () => loaded.then((d) => d.serp)),
    oppRead,
  ]);
  // DS10: a member who left setup before confirming gets back to it from here. Only a client that needs setup pays the read.
  const outstanding = setupOutstanding(client, confirmed, fixtureMode());
  // R173 pass 2 (pass 1's P3): the confirm route's 303 lands here; it is said only when the confirm reads back.
  const justConfirmed = sp.setup === "confirmed" && confirmed === true;
  const canWrite = refuseRole(writeRole(client)) === null;
  // R97 part 5: "Show placements" on the same rule as the placements screen - a placed tier, or any placement logged.
  const placements = placed || rows.some((p) => p.status !== "removed") ? rows : undefined;
  // This week (section 4.1 row 6), on the Plan's UTC week as Actions draws it, posting back here (`?plan=`).
  const utc = diyDay(repo.now());
  const reason = client.status === "ended" ? ENDED_REASON : VIEWER_REASON;
  const firstCheckYet = data.lastRun !== null;
  const weekNode = plan.ok ? (
    <ThisWeek
      items={thisWeek(plan.value, utc)}
      counts={weekCounts(plan.value, utc)}
      slug={slug}
      canWrite={canWrite}
      reason={reason}
      back="overview"
      empty={firstCheckYet ? undefined : "Your actions fill in after your first check."}
      toast={overviewPlanToast(typeof sp.plan === "string" ? sp.plan : null)}
    />
  ) : (
    <section id="this-week" aria-labelledby="wk-h" style={PLAN_SECTION}>
      <h2 id="wk-h" style={PLAN_H2}>
        This week
      </h2>
      <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
        {SECTION_ERROR}
      </p>
    </section>
  );
  // The work log (row 10): done items, placements live, prompts added after the first day with their origin.
  const logNode = plan.ok ? (
    <WorkLog slug={slug} entries={workLog({ today, items: plan.value, placements: rows, prompts: promptsAdded({ questions: data.questions, origins, mode: upgrade.mode, startedOn: client.started_on }) })} />
  ) : (
    <section aria-labelledby="log-h" style={PLAN_SECTION}>
      <h2 id="log-h" style={PLAN_H2}>
        Work log, last 30 days
      </h2>
      <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
        {SECTION_ERROR}
      </p>
    </section>
  );
  // The chart's work markers (row 8): Actions items started and done, placements live; a cluster's chart draws its own.
  const marks = workMarks({ slug, items: plan.ok ? plan.value : [], placements: rows });

  // ---- 13 Oct 2026, DIY P9 (spec 10 sections 4.1 and 7.10): wave 2 on the Overview ----
  // P7's opportunities, read once, for two things: the cited card's "Leaves you out" tags (row 9) and the pursued
  // pages whose first citation Since last check can report (section 6.8 line 8). A failed read draws neither, says
  // so in the log, and the rest of the page draws. Read with the first reads above; used only after the first check.
  const oppWorld = firstCheckYet ? oppAll : null;
  const OPEN_OPP = ["new", "pursuing", "pitched"];
  const leavesOut = oppWorld?.ok
    ? (() => {
        const pages = citedPageRows(data.answers, range, client.domain).map((p) => ({ page: p.page, host: p.host }));
        const f = citedFacts({ pages, answers: data.answers, range, reads: oppWorld.value.reads, kinds: new Map(), placedKeys: oppWorld.value.placedKeys, rows: oppWorld.value.rows.filter((o) => OPEN_OPP.includes(o.status)) });
        return new Map([...f.leaves].filter((k) => f.opps.has(k)).map((k) => [k, oppDetailPath(slug, f.opps.get(k)!)] as const));
      })()
    : undefined;
  // Watched (line 8): a pursued page's first citation since it was pursued (P7 keeps it per engine), and a live
  // placement's first citation - only for one gone live inside the range read, so "first" is a fact, not the
  // range's edge.
  const watched: Watched[] = [];
  if (oppWorld?.ok) {
    for (const o of oppWorld.value.rows) {
      if (!["pursuing", "pitched", "won"].includes(o.status) || !o.firstCited) continue;
      const first = Object.entries(o.firstCited).sort((a, b) => a[1].day.localeCompare(b[1].day))[0];
      if (first) watched.push({ urlKey: o.urlKey, label: `${o.domain}'s page`, href: oppDetailPath(slug, o.id), firstCited: { day: first[1].day, engine: first[0] } });
    }
  }
  if (placements) {
    const cites = data.answers.flatMap((a) => (a.citations ?? []).filter((c) => c.url).map((c) => ({ run_date: a.run_date, engine: a.engine, url: c.url! })));
    for (const p of placements) {
      if (p.status !== "live" || !p.live_on || p.live_on < range.from) continue;
      const first = firstCitedBy(cites, p.url_key, p.live_on, engines)[0];
      if (first) watched.push({ urlKey: p.url_key, label: `Your placement on ${p.url_key.split("/")[0]}`, href: appPath(`/${slug}/placements`), firstCited: first });
    }
  }
  // Day 0 (section 4.1, "Confirmed, no check yet"): "Where you stand today" from the reads that land before the first
  // check - the footprint (paid, so only while DIY is on and a pull exists) and our own key-page and robots.txt reads -
  // and "3 things you can do before your first check" from the open Blocking and Tidy-up items. Not for an ended client.
  const dayZero = !firstCheckYet && client.status !== "ended";
  const [footprint, keyPages, checks, bots] = dayZero
    ? await Promise.all([
        loadFootprint(client.id).catch((err: unknown) => (console.warn(`[diy] overview footprint: ${err instanceof Error ? err.message : String(err)}`), null)),
        section("overview key pages", () => readPagesPart("keyPages", fixtureMode() ? null : () => supabaseAdmin(), client.id, today)),
        section("overview page checks", () => readPagesPart("checks", fixtureMode() ? null : () => supabaseAdmin(), client.id, today)),
        section("overview bots", () => readPagesPart("bots", fixtureMode() ? null : () => supabaseAdmin(), client.id, today)),
      ])
    : [null, null, null, null];
  const stand = dayZero
    ? whereYouStand({
        domain: client.domain,
        market: client.market,
        pull: footprint?.enabled && footprint.pulls?.ok ? footprint.pulls.value.latest : null,
        bot: bots?.ok ? (bots.value[0] ?? null) : null,
        homepage: keyPages?.ok ? (keyPages.value.find((k) => k.removedOn === null && isHomepage(k, client.domain)) ?? null) : null,
        checks: checks?.ok ? checks.value : [],
      })
    : [];
  const firstThings = dayZero && plan.ok ? beforeFirstCheck(plan.value, utc) : [];
  const dayZeroWeek =
    firstThings.length > 0 ? (
      <ThisWeek
        items={firstThings}
        counts={{ done: 0, of: firstThings.length, open: weekCounts(plan.ok ? plan.value : [], utc).open }}
        slug={slug}
        canWrite={canWrite}
        reason={reason}
        back="overview"
        heading={`${firstThings.length === 1 ? "1 thing" : `${firstThings.length} things`} you can do before your first check`}
        tally={false}
        toast={overviewPlanToast(typeof sp.plan === "string" ? sp.plan : null)}
      />
    ) : null;
  const steps =
    checklist && team && reportOpened !== null
      ? activationSteps({
          slug,
          role: client.role,
          market: client.market,
          today,
          startedOn: client.started_on,
          confirmed,
          // As setupOutstanding reads it: the fixture's dates are frozen before SETUP_SINCE, so its own flag is the answer.
          setupNeeded: fixtureMode() || needsSetup(client),
          firstRead: data.lastRun !== null,
          livePrompts: data.questions.filter((q) => q.stopped_on === null).length,
          members: team.members,
          reportOpened,
          now: repo.now(),
        })
      : null;

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} placements={placed} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        {outstanding ? (
          <div style={{ ...CARD, borderRadius: "14px", padding: "14px 18px", marginBottom: "24px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px" }}>
            <p style={{ margin: 0, flex: "1 1 260px", fontSize: "15px", lineHeight: 1.6 }}>
              Your setup is not confirmed yet.{canWrite ? " Check your clusters and confirm them." : " An owner or editor confirms it."}
            </p>
            <a href={setupPath(slug)} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", color: T.accent, fontWeight: 600 }}>
              {canWrite ? "Finish setup" : "See setup"}
            </a>
          </div>
        ) : null}
        {justConfirmed ? (
          <p role="status" style={{ margin: "0 0 24px", padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, width: "fit-content", maxWidth: "100%", boxSizing: "border-box" }}>
            Setup confirmed.
          </p>
        ) : null}
        <Overview
          brand={client.brand ?? client.domain}
          domain={client.domain}
          market={client.market}
          engines={engines}
          startedOn={client.started_on}
          today={today}
          range={range}
          compareMode={compare}
          data={data}
          selected={typeof sp.cluster === "string" ? sp.cluster : undefined}
          clustersPath={appPath(`/${slug}/clusters`)}
          reportPath={`/api/app/${encodeURIComponent(slug)}/report`}
          clusterLimit={client.cluster_limit ?? CLUSTER_BASE}
          placements={placements}
          canWrite={canWrite}
          ended={client.status === "ended"}
          lead={steps ? <Activation steps={steps} /> : null}
          recent={weekRead ?? { ok: true, data }}
          thisWeek={dayZeroWeek ?? weekNode}
          dayZero={stand.length ? <WhereYouStand lines={stand} slug={slug} /> : null}
          watched={watched}
          leavesOut={leavesOut}
          workLog={logNode}
          origins={originKinds(origins)}
          marks={marks}
          whoRanks={whoRanks}
        />
      </div>
    </div>
  );
}
