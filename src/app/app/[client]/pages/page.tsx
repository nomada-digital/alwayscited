import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Sidebar from "@/components/app/Sidebar";
import { preloadActionsBadge } from "@/components/app/ActionsBadge";
import Bots from "@/components/app/pages/Bots";
import ExamplesLibrary from "@/components/app/pages/ExamplesLibrary";
import KeyPagesList from "@/components/app/pages/KeyPagesList";
import YourPages from "@/components/app/pages/YourPages";
import { SectionError } from "@/components/app/pages/parts";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { allowanceMonth, usedUpLine } from "@/lib/diy/core/allowances";
import { isOwnUrl } from "@/lib/diy/pages/key-pages";
import { loadPages } from "@/lib/diy/pages/load";
import { pickCluster, pickIssue, pickView } from "@/lib/diy/pages/paths";
import { raisesBlocking } from "@/lib/diy/pages/robots";
import { ENDED_REASON, VIEWER_REASON, pagesToast } from "@/lib/diy/pages/toast";
import { filterRows, listRows, siteStrip } from "@/lib/diy/pages/view";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { urlKey } from "@/lib/tracking/placements";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Your pages - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * Your pages (13 Oct 2026, DIY P8; spec 10 section 4.9): the key pages, the
 * crawlers, and the schema examples library. Same membership rule as every
 * /app/[client] page: no session is the login page, a slug that is not one of
 * the session's clients a 404.
 *
 * Query keys, each bounded here (section 3.5): `view` one of VIEWS
 * (pickView), `issue` one of ISSUES (pickIssue), `cluster` one of this
 * client's clusters (pickCluster against its own ids), `url` a page address
 * on this client's own domain (isOwnUrl, cut to 500 characters), `done` and
 * `why` the pages route's codes, drawn through pagesToast's fixed words.
 *
 * No loading.tsx, though spec 10 section 3.3 lists one, for the reason the
 * Actions and AI visibility pages record: a segment loading boundary streams
 * before the login redirect and the membership 404 run, so both would answer
 * 200, and its streamed content needs script to show (2.1 item 9). AppLink's
 * pending bar is the loading state.
 */
export default async function ClientPages({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/pages`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  preloadActionsBadge(client.id);
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const now = repo.now();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const canWrite = refuseRole(writeRole(client)) === null;
  const reason = client.status === "ended" ? ENDED_REASON : VIEWER_REASON;

  const load = await loadPages({ repo, client, email, today, now });
  const input = load.input;
  const clusterIds = input ? input.clusters.map((c) => c.id) : [];
  const view = pickView(one("view"));
  const filters = { issue: pickIssue(one("issue")), cluster: pickCluster(one("cluster"), clusterIds) };
  const rawUrl = one("url");
  const focusKey = rawUrl && rawUrl.length <= 500 && isOwnUrl(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`, client.domain) ? urlKey(rawUrl) : null;

  const all = input ? listRows(input) : null;
  const rows = all ? filterRows(all, filters) : null;
  const site = input && all ? siteStrip(input, all, raisesBlocking) : null;
  const live = input ? input.keyPages.filter((k) => k.removedOn === null) : [];
  const removed = input ? input.keyPages.filter((k) => k.removedOn !== null && !live.some((l) => l.urlKey === k.urlKey)).length : 0;
  const checksUsed = load.usage?.rows.find((r) => r.key === "page_checks")?.used ?? null;
  const toast = pagesToast(one("done"), one("why"), { resets: allowanceMonth(client.market, now).resetsLabel, checksLine: checksUsed === null ? null : usedUpLine("page_checks", checksUsed, load.diy, now) });
  const usedClusters = new Set(live.flatMap((k) => k.clusterIds));
  const clusterPills = input ? input.clusters.filter((c) => c.stoppedOn === null && (usedClusters.has(c.id) || c.id === filters.cluster)).map((c) => ({ id: c.id, name: c.name })) : [];

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(input?.clusters.length ?? 0) > 0} current="Your pages" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={load.upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <YourPages slug={slug} view={view} keep={{ ...(filters.issue ? { issue: filters.issue } : {}), ...(filters.cluster ? { cluster: filters.cluster } : {}) }} toast={toast} readOnly={canWrite ? null : reason} failedNight={load.failedNight}>
          {view === "examples" ? (
            <ExamplesLibrary />
          ) : !input ? (
            <SectionError label={view === "bots" ? "Crawlers" : "Your key pages"} />
          ) : view === "bots" ? (
            <Bots bot={input.bots[0] ?? null} pages={live} />
          ) : (
            <KeyPagesList
              slug={slug}
              rows={rows}
              all={all?.length ?? 0}
              site={live.length ? site : null}
              filters={filters}
              clusters={clusterPills}
              canWrite={canWrite}
              reason={reason}
              focus={focusKey ? { key: focusKey, row: (all ?? []).find((r) => r.page.urlKey === focusKey) ?? null } : null}
              prefill={focusKey && !(all ?? []).some((r) => r.page.urlKey === focusKey) ? `https://${focusKey}` : ""}
              day0={live.length === 0}
              removed={removed}
              citedRead={load.citedRead}
            />
          )}
        </YourPages>
      </div>
    </div>
  );
}
