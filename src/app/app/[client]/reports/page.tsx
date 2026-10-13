import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Reports from "@/components/app/Reports";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { monthSlice, reportSpan } from "@/lib/tracking/read-shape";
import { monthFigures, reportMonths } from "@/lib/tracking/report-months";
import { runNote } from "@/lib/tracking/run-note";
import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Reports - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's Reports (R145, BRIEF-4 P5: appPath(`/[client]/reports`)). Same
 * membership rule as the overview. The picked range (`from/to`) sets the
 * download links only, so its picker has no compare control (DS26); the monthly cards are read from one load
 * covering every month since tracking started, each cut to its own range and the comparison before it.
 */
export default async function ClientReports({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/reports`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  const months = reportMonths(client.started_on, today);
  // perf-1 (8 Oct 2026): from the oldest month's own comparison to today, verdicts only - every card's like-for-like
  // has its rows, and nothing a card does not count is read (read-shape.ts reportSpan; "prev" on the whole span read
  // as far again before the first month as the history is long).
  const [data, upgrade, rows] = await Promise.all([repo.loadOverview(client.id, reportSpan(months, today), "none", { answers: "verdicts" }), repo.upgradeContext(client.id, email, today), repo.placements(client.id)]);
  const placed = placedTier(tier);

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} current="Reports" placements={placed} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Reports
          market={client.market}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          reportPath={`/api/app/${encodeURIComponent(slug)}/report`}
          placed={placed || rows.some((p) => p.status !== "removed")}
          months={months.map((m) => ({ ...m, figures: monthFigures(monthSlice(data, m.range), m.range, { startedOn: client.started_on, today, engines }) }))}
          note={runNote(data, range, today)}
        />
      </div>
    </div>
  );
}
