import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import AiVisibility from "@/components/app/ai/AiVisibility";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { pickAngle, pickDir, pickOrigin, pickPage, pickSort } from "@/lib/diy/ai/prompt-table";
import { ASK_ITEMS_MAX, askRefusal, askToast } from "@/lib/tracking/ask";
import { clusterSearch } from "@/lib/tracking/cluster-figures";
import { formatDay } from "@/lib/tracking/figures";
import { HIDE_DAYS, hiddenUntil } from "@/lib/tracking/upgrade-prompts";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "AI visibility - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's AI visibility page (13 Oct 2026, DIY P4; spec 10 section 4.2:
 * appPath(`/[client]/ai`)), for the range the URL states. Same membership
 * rule as the overview: a slug the session is not a live member of is a 404.
 *
 * No loading.tsx, though spec 10 section 3.3 lists one: measured on the build
 * (13 Oct 2026), its Suspense boundary streams the page into a hidden div that
 * only script reveals, so with JS off the page stayed on the skeleton -
 * against section 2.1 item 9 ("works without JavaScript") and the decision
 * AppLink.tsx records (R151): no loading.tsx under /app/[client], whose
 * stream would also answer 200 before the session and slug checks. AppLink's
 * pending bar is the loading state, as on every other /app page.
 *
 * Every other key is a whitelist or a clamp: `?cluster=` one of this
 * client's clusters, `?eng=` one of its tier's engines, `?angle=`,
 * `?origin=`, `?sort=` and `?dir=` from fixed lists, `?page=` 1-50, `?q=` cut
 * to APP_LIMITS.search, `?lfl=1` and `?missing=1` flags.
 *
 * Review of P4 (13 Oct 2026; section 3.6): U1's Hide and Ask return here, so
 * the page reads their toast keys as Clusters does - `hid`, `ask`, `via`, `n`
 * and `of`, each a fixed code drawn as fixed words, nothing echoed.
 */
export default async function ClientAi({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/ai`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  const [data, upgrade] = await Promise.all([repo.loadOverview(client.id, range, compare), repo.upgradeContext(client.id, email, today)]);
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const cluster = (data.clusters ?? []).some((c) => c.id === one("cluster")) ? one("cluster") : null;
  const engine = engines.find((e) => e === one("eng")) ?? null;
  // U1's way back (hide and ask routes, `surface=ai`): the same codes and words as the Clusters page's toast.
  const ask = one("ask");
  const n = Number(one("n"));
  const of = one("of");
  const attached = Number.isInteger(n) && n > 0 && n <= ASK_ITEMS_MAX && (of === "prompts" || of === "keywords") ? `${n} ${n === 1 ? of.slice(0, -1) : of}` : undefined;
  const hid = one("hid") === "1" && !ask;
  const unhid = one("hid") === "0" && !ask;
  const asked = ask === "sent" ? askToast(one("via") === "agency" ? "your account contact" : "nomada digital", email, attached) : askRefusal(ask) ?? (hid ? `Hidden for ${HIDE_DAYS} days, until ${formatDay(hiddenUntil(today))}. Only you stop seeing it.` : unhid ? "That did not hide. Try again." : null);

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(data.clusters?.length ?? 0) > 0} current="AI visibility" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <AiVisibility
          brand={client.brand ?? client.domain}
          domain={client.domain}
          slug={slug}
          tier={tier}
          engines={engines}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          data={data}
          cluster={cluster}
          angle={pickAngle(one("angle"))}
          origin={pickOrigin(one("origin"))}
          engine={engine}
          lfl={one("lfl") === "1"}
          missing={one("missing") === "1"}
          q={clusterSearch(one("q"))}
          sort={pickSort(one("sort"))}
          dir={pickDir(one("dir"))}
          page={pickPage(one("page"))}
          mode={upgrade.mode}
          hidden={upgrade.hidden}
          notice={asked ? { text: asked, done: ask === "sent" || hid } : null}
        />
      </div>
    </div>
  );
}
