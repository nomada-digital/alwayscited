import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Placements from "@/components/app/Placements";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { pickKind } from "@/lib/tracking/placement-figures";
import { placementsScreen } from "@/lib/tracking/placements-screen";
import { rangeQuery } from "@/lib/tracking/overview-data";
import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";
import { loadPromptOrigins } from "@/lib/diy/prompts/origins";
import { loadPlacementPromptsOn } from "@/lib/diy/prompts/placement-prompt";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Placements - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's placements (T13, R97 part 3, 30 Sep 2026; BRIEF-2 T13 route
 * appPath(`/[client]/placements?cluster=&from=&to=`)). Same membership rule as the
 * overview. Open to a client on mentioned or above, and to any client with a
 * placement logged (a row Nomada logged is the client's to see); anyone else
 * gets a 404. What it reads is placements-screen.ts, shared with the CSV.
 */
export default async function ClientPlacements({
  params,
  searchParams,
}: {
  params: Promise<{ client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/placements`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  // 13 Oct 2026, DIY P2: the origins say which prompt each placement added; the switch says whether a client sees that line.
  // 13 Oct 2026 review: the screen leaves the placement prompts out of its named figures, so it takes the same origins.
  const reading = loadPromptOrigins(client.id);
  const [screen, upgrade, origins, promptLines] = await Promise.all([placementsScreen(repo, client, sp, today, reading), repo.upgradeContext(client.id, email, today), reading, loadPlacementPromptsOn()]);
  if (!screen) notFound();
  const { range } = screen;
  const keep: Record<string, string> = screen.stated ? { from: range.from, to: range.to } : {};
  const href = (c: string) => appPath(`/${slug}/placements?${new URLSearchParams({ cluster: c, ...keep })}`);
  const csvHref = `/api/app/${encodeURIComponent(slug)}/report?${new URLSearchParams({ kind: "placements", cluster: screen.cluster.id, ...keep })}`;

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters current="Placements" placements clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Placements
          brand={client.brand ?? client.domain}
          engines={engines}
          range={range}
          today={today}
          startedOn={client.started_on}
          clusters={screen.clusters.map((c) => ({ id: c.id, name: c.name, href: href(c.id) }))}
          cluster={screen.cluster}
          keyword={screen.keyword}
          prompts={screen.prompts}
          placementPrompts={screen.placementPrompts}
          view={screen.view}
          series={screen.series}
          kind={pickKind(typeof sp.type === "string" ? sp.type : null)}
          sel={typeof sp.sel === "string" && screen.view.rows.some((r) => r.id === sp.sel) ? sp.sel : null}
          query={{ cluster: screen.cluster.id, ...keep }}
          path={appPath(`/${slug}/placements`)}
          csvHref={csvHref}
          origins={origins}
          promptLines={promptLines}
          firstCited={screen.firstCited}
          promptRows={screen.promptRows}
        />
      </div>
    </div>
  );
}
