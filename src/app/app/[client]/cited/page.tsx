import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Cited from "@/components/app/Cited";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { clusterSearch } from "@/lib/tracking/cluster-figures";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";
import { citedFacts, citedKindKeys, pickCitedType } from "@/lib/diy/opportunities/cited";
import { readKinds } from "@/lib/diy/opportunities/data";
import { loadOppWorld } from "@/lib/diy/opportunities/world";
import { section } from "@/lib/diy/plan/data";
import { citedPageRows } from "@/lib/tracking/figures";
import { pickDomainType, pickPageType } from "@/lib/diy/opportunities/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Cited pages - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/** `?open=` is a page as citedPageRows writes it: a host, then a path. Anything else opens none. */
const openPage = (raw: string | null) => (raw && raw.length <= 300 && /^[a-z0-9.-]+\.[a-z0-9-]+(\/\S*)?$/.test(raw) ? raw : null);

/**
 * One client's Cited pages (R144, BRIEF-4 P4: appPath(`/[client]/cited`)), for the
 * range the URL states. Same membership rule as the overview. `?cluster=`
 * must be one of this client's clusters, `?engine=` one of its tier's
 * engines and `?kind=` yours or others; anything else is All.
 *
 * 13 Oct 2026, DIY P7 (spec 10 sections 3.5 and 4.5): `?type=` is one kind
 * of site (a domain type), and `?leaves=1` the pages that leave the client
 * out; both are facts, read as a section that says so when it cannot be read.
 */
export default async function ClientCited({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/cited`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  const [data, upgrade, placements] = await Promise.all([repo.loadOverview(client.id, range, compare), repo.upgradeContext(client.id, email, today), repo.placements(client.id)]);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const cluster = (data.clusters ?? []).some((c) => c.id === one("cluster")) ? one("cluster") : null;
  const engine = engines.find((e) => e === one("engine")) ?? null;
  const k = one("kind");
  const type = pickCitedType(one("type"));
  const leaves = one("leaves") === "1";
  // The page facts: types, who each page leaves out, and its opportunity, with other clients' placements subtracted.
  const facts = await section("cited facts", async () => {
    const world = await loadOppWorld(repo, client);
    const pages = citedPageRows(data.answers, range, client.domain).map((p) => ({ page: p.page, host: p.host }));
    const kinds = world.entry
      ? new Map((world.entry.kinds ?? []).map((x) => [x.key, { domain_type: pickDomainType(x.domain_type), page_type: pickPageType(x.page_type), set_by: x.set_by ?? "model" }] as const))
      : await readKinds(supabaseAdmin(), citedKindKeys(pages));
    return citedFacts({ pages, answers: data.answers, range, reads: world.reads, kinds, placedKeys: world.placedKeys, rows: world.rows });
  });

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} current="Cited pages" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Cited
          domain={client.domain}
          engines={engines}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          data={data}
          placements={placements}
          slug={slug}
          cluster={cluster}
          engine={engine}
          kind={k === "yours" || k === "others" ? k : "all"}
          all={one("all") === "1"}
          open={openPage(one("open"))}
          q={clusterSearch(one("q"))}
          diy={{ facts: facts.ok ? facts.value : null, type, leaves, oppHref: (id) => appPath(`/${encodeURIComponent(slug)}/opportunities/${encodeURIComponent(id)}`) }}
        />
      </div>
    </div>
  );
}
