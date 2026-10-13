import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import OneCluster from "@/components/app/OneCluster";
import Sidebar from "@/components/app/Sidebar";
import { preloadActionsBadge } from "@/components/app/ActionsBadge";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { clusterCards, clusterDetail, promptIndex } from "@/lib/tracking/cluster-figures";
import { firstCheckDay, firstReadComplete, resolveComparison } from "@/lib/tracking/figures";
import { engineTab, pickedDay } from "@/lib/tracking/latest-answers";
import { noteState } from "@/lib/tracking/note";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { dayPlan } from "@/lib/tracking/read-shape";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";
import { loadPromptOrigins } from "@/lib/diy/prompts/origins";
import { loadWhoRanks } from "@/lib/diy/keywords/data";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Cluster - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One cluster (BRIEF-3 T7, route 8: appPath(`/[client]/clusters/[cluster]?prompt=0-4`)),
 * for the range the URL states. Same membership rule as the overview; a
 * cluster id that is not this client's, or not in range, is a 404 too.
 */
export default async function ClientCluster({
  params,
  searchParams,
}: {
  params: Promise<{ client: string; cluster: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/clusters/${(await params).cluster}`), await searchParams));
  const { client: slug, cluster: id } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  preloadActionsBadge(client.id);
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  // perf-9 (8 Oct 2026): this cluster's prompts' answers only; every cluster and prompt is still read, for "N of M"
  // and for firstCheckDay, which reads every prompt as every other page does (audit data-10).
  const dataP = repo.loadOverview(client.id, range, compare, { cluster: id });
  // 13 Oct 2026 (dashboard speed work): what needs nothing from the overview starts with it - the account's mode, the
  // prompts' origins and the slot's "See who ranks" (only the fixture reads its positions) - rather than after it.
  const upgradeP = repo.upgradeContext(client.id, email, today);
  const originsP = loadPromptOrigins(client.id);
  const whoRanksP = loadWhoRanks(client.id, range.to, () => dataP.then((d) => d.serp));
  // A throw below (the overview's, or this cluster's 404) must not leave these rejecting unobserved; each await still throws.
  for (const p of [upgradeP, originsP, whoRanksP]) p.catch(() => {});
  const data = await dataP;
  const input = { clusters: data.clusters ?? [], questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: resolveComparison(range, compare, client.started_on, firstCheckDay(client.started_on, data.questions), firstReadComplete(data.runs, firstCheckDay(client.started_on, data.questions))).range, today, engines };
  const detail = clusterDetail(input, id);
  if (!detail) notFound();
  const cards = clusterCards(input);
  const prompt = promptIndex(sp.prompt, detail.card.prompts.length);
  const picked = detail.card.prompts[prompt];
  // DB-2 (9 Oct 2026): `?day=` shows that check's answers instead of the latest. Only the date comes from the
  // URL: the client is the session's member client above, the prompt one of this cluster's own (read-shape.ts dayPlan).
  const day = pickedDay(sp.day, today);
  // 13 Oct 2026, DIY P2: each prompt's origin, and the account's mode for the chips' words (loadOverview reads no origin column).
  // 13 Oct 2026 (Danny): whether the Google page has this keyword's page 1 stored, for the slot's "See who ranks".
  const [latest, notes, upgrade, origins, whoRanks] = await Promise.all([
    picked && detail.card.status !== "pending" ? repo.answerDay(client.id, dayPlan(picked.id, range.to, day)) : null,
    repo.clusterNotes(client.id, detail.card.prompts.map((p) => p.id)),
    upgradeP,
    originsP,
    whoRanksP,
  ]);

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters current="Clusters" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <OneCluster
          brand={client.brand ?? client.domain}
          domain={client.domain}
          market={client.market}
          engines={engines}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          data={data}
          detail={detail}
          index={cards.findIndex((c) => c.id === id) + 1}
          total={cards.length}
          prompt={prompt}
          latest={latest}
          day={day}
          notes={notes}
          canWrite={writeRole(client) === "owner" || writeRole(client) === "editor"}
          noteState={noteState(sp.note)}
          noteAction={`/api/app/${encodeURIComponent(slug)}/note`}
          engine={engineTab(sp.engine, engines)}
          clustersPath={appPath(`/${slug}/clusters`)}
          origins={origins}
          mode={upgrade.mode}
          slug={slug}
          placementsPath={appPath(`/${slug}/placements`)}
          whoRanks={whoRanks}
        />
      </div>
    </div>
  );
}
