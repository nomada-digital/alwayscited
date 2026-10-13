import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Google from "@/components/app/google/Google";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackLine, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { appPath } from "@/lib/app-host";
import { loadFootprint, loadOthersPlaced, loadPursuing, loadSerpDetail } from "@/lib/diy/keywords/data";
import { pickBand, pickDir, pickId, pickIntent, pickPage, pickSort, pickView } from "@/lib/diy/keywords/keys";
import { readDone, readOnlyReason, readWhy } from "@/lib/diy/keywords/write";
import { section } from "@/lib/diy/plan/data";
import { clusterSearch } from "@/lib/tracking/cluster-figures";
import { comparisonRange } from "@/lib/tracking/figures";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Google - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's Google page (13 Oct 2026, DIY P6; spec 10 section 4.3:
 * appPath(`/[client]/google`)), for the range the URL states. Same membership
 * rule as the overview: a slug the session is not a live member of is a 404.
 *
 * No loading.tsx, though spec 10 sections 3.3 and 7.7 list one, for the
 * reason the AI visibility page records (13 Oct 2026, measured on the build
 * by P4): its Suspense boundary streams the page into a hidden div that only
 * script reveals, so with JS off the page stayed on the skeleton - against
 * section 2.1 item 9 - and the stream would answer 200 before the session
 * and slug checks (AppLink.tsx, R151). AppLink's pending bar is the loading
 * state, as on every other /app page.
 *
 * Every key is a whitelist or a clamp (keys.ts): `view`, `band`, `intent`,
 * `sort` and `dir` from fixed lists, `cluster` one of this client's
 * clusters, `row` one of its tracked keywords, `page` 1-50, `q` cut to
 * APP_LIMITS.search, `gaining=1` a flag, and `done`/`why` the keywords
 * route's toast codes, drawn as fixed words.
 *
 * Reads: loadOverview with no answers (the structure, the positions and the
 * runs); the tracked keywords' ranking URLs and Google's stored top 20; the
 * footprint, the dismissals and the job, only while diy_enabled is on; other
 * clients' placed pages, to leave them out of every list; and the client's
 * placements and pursued pages for the row chips. Each is a section: one
 * that fails says so and the rest of the page draws.
 */
export default async function ClientGoogle({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/google`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  const [data, upgrade, footprint, others, placements, pursuing, settings] = await Promise.all([
    repo.loadOverview(client.id, range, compare, { answers: "none" }),
    repo.upgradeContext(client.id, email, today),
    loadFootprint(client.id),
    loadOthersPlaced(client.id),
    section("google placements", () => repo.placements(client.id)),
    loadPursuing(client.id),
    // The brand's aliases for the brand rule: the footprint read carries them in production; the fixture's are its settings'.
    fixtureMode() ? section("google aliases", () => repo.settings(client.id)) : Promise.resolve(null),
  ]);
  const serp = await loadSerpDetail(client.id, { from: comparisonRange(range, compare)?.from ?? range.from, to: range.to }, data.serp);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const cluster = (data.clusters ?? []).some((c) => c.id === one("cluster")) ? one("cluster") : null;
  const rowId = pickId(one("row"));
  const row = rowId && data.keywords.some((k) => k.id === rowId) ? rowId : null;
  const placed = new Map<string, number>();
  if (placements.ok) for (const pl of placements.value) if (pl.status === "live") placed.set(pl.cluster_id, (placed.get(pl.cluster_id) ?? 0) + 1);

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} current="Google" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Google
          brand={client.brand ?? client.domain}
          domain={client.domain}
          slug={slug}
          tier={tier}
          mode={upgrade.mode}
          hidden={upgrade.hidden}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          data={data}
          view={pickView(one("view"))}
          gaining={one("gaining") === "1"}
          cluster={cluster}
          band={pickBand(one("band"))}
          intent={pickIntent(one("intent"))}
          q={clusterSearch(one("q"))}
          sort={pickSort(one("sort"))}
          dir={pickDir(one("dir"))}
          page={pickPage(one("page"))}
          row={row}
          canWrite={refuseRole(writeRole(client)) === null}
          readOnly={readOnlyReason(client)}
          clusterLimit={client.cluster_limit ?? CLUSTER_BASE}
          packLine={trackingPackLine(trackingPackPrice(client.market))}
          footprint={footprint}
          serp={serp}
          others={others}
          placed={placed}
          pursuing={pursuing}
          aliases={settings?.ok ? settings.value.aliases : footprint.aliases}
          notice={{ done: readDone(one("done")), why: readWhy(one("why")) }}
        />
      </div>
    </div>
  );
}
