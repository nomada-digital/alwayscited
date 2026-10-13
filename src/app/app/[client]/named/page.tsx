import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Named from "@/components/app/Named";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { clusterSearch } from "@/lib/tracking/cluster-figures";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { openKey } from "@/lib/tracking/named-figures";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { namedRead } from "@/lib/tracking/read-shape";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Who is named - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's Who is named page (R143, BRIEF-4 P3: appPath(`/[client]/named`)),
 * for the range the URL states. Same membership rule as the overview: a slug
 * the session is not a live member of is a 404. `?cluster=` must be one of
 * this client's clusters and `?engine=` one of its tier's engines; anything
 * else is All.
 */
export default async function ClientNamed({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/named`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  // 13 Oct 2026 (dashboard speed): no citations until a row is open (read-shape.ts namedRead).
  const open = openKey(sp.open);
  const [data, upgrade] = await Promise.all([repo.loadOverview(client.id, range, compare, { answers: namedRead(open) }), repo.upgradeContext(client.id, email, today)]);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const cluster = (data.clusters ?? []).some((c) => c.id === one("cluster")) ? one("cluster") : null;
  const engine = engines.find((e) => e === one("engine")) ?? null;

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} current="Who is named" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Named
          brand={client.brand ?? client.domain}
          domain={client.domain}
          engines={engines}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          data={data}
          slug={slug}
          cluster={cluster}
          engine={engine}
          all={one("all") === "1"}
          open={open}
          q={clusterSearch(one("q"))}
        />
      </div>
    </div>
  );
}
