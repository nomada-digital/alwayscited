import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Clusters, { type StopToast } from "@/components/app/Clusters";
import Sidebar from "@/components/app/Sidebar";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { MARKETS, isMarket } from "@/lib/scan/domain";
import { keywordForm } from "@/lib/scan/dataforseo-request";
import { verdictFromQuery } from "@/lib/tracking/add-cluster";
import { ASK_ITEMS_MAX, askRefusal, askToast } from "@/lib/tracking/ask";
import { clusterSearch } from "@/lib/tracking/cluster-figures";
import { formatDay } from "@/lib/tracking/figures";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { slotRefusal } from "@/lib/tracking/slot";
import { BULK_ID, BULK_MAX, refuseRole } from "@/lib/tracking/stop";
import { HIDE_DAYS, hiddenUntil } from "@/lib/tracking/upgrade-prompts";
import { appPath } from "@/lib/app-host";
import { loadPromptOrigins } from "@/lib/diy/prompts/origins";
import { loadFootprint } from "@/lib/diy/keywords/data";
import { trackedSet } from "@/lib/diy/keywords/momentum";
import { footprintFacts, suggestedClusters } from "@/lib/diy/keywords/setup-suggestions";
import { section } from "@/lib/diy/plan/data";
import { trackingPackLine } from "@/config/pricing";
import { fixtureMode } from "@/lib/tracking/fixture-mode";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Clusters - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's Clusters page (BRIEF-3 T6, route 8: appPath(`/[client]/clusters`)),
 * for the range the URL states. Same membership rule as the overview: a slug
 * the session is not a member of is a 404.
 *
 * 13 Oct 2026, DIY P6 (spec 10 sections 3.5, 4.10 and 6.6): `src` is read,
 * `gaining` only, and posted by the Add panel as a hidden field, so a cluster
 * added from a gaining-ground keyword gets Momentum prompts. While a slot is
 * free, Suggested clusters lists up to 5 keywords from the Google footprint
 * (gaining ground first); at the limit, U7 offers the pack when one is
 * waiting. Both read the stored footprint only, and both are hidden while
 * diy_enabled is off (the dark rule).
 */
export default async function ClientClusters({
  params,
  searchParams,
}: {
  params: Promise<{ client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/clusters`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const { range, compare } = rangeFrom(sp, today, client.started_on);
  // 13 Oct 2026, DIY P2: each prompt's origin, for its chip and the "From placements" sub-list (loadOverview reads no origin column).
  const [data, upgrade, typed, origins, footprint, settings] = await Promise.all([
    repo.loadOverview(client.id, range, compare),
    repo.upgradeContext(client.id, email, today),
    repo.orderKeyword(client.id),
    loadPromptOrigins(client.id),
    loadFootprint(client.id),
    // DIY P6: the brand's aliases for the footprint's brand rule; the footprint read carries them in production.
    fixtureMode() ? section("clusters aliases", () => repo.settings(client.id)) : Promise.resolve(null),
  ]);
  const subject = { brand: client.brand ?? null, domain: client.domain, aliases: settings?.ok ? settings.value.aliases : footprint.aliases };
  const { latest, gaining } = footprintFacts(footprint, { tracked: data.keywords, subject, today });
  const suggested = suggestedClusters({ latest, gaining, tracked: trackedSet(data.keywords, today), subject });
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const f = one("filter");
  const done = one("done");
  const kind = one("kind");
  const id = one("id");
  // DS13: a bulk stop or move adds `ok` of `ticked`; only whole numbers within BULK_MAX are drawn.
  const ok = Number(one("ok"));
  const ticked = Number(one("ticked"));
  const count = id === BULK_ID && Number.isInteger(ok) && Number.isInteger(ticked) && ok >= 0 && ok <= ticked && ticked <= BULK_MAX ? { n: ok, of: ticked } : undefined;
  const toast: StopToast | null =
    (done === "stopped" || done === "undone" || done === "added" || done === "saved" || done === "moved" || done === "refused" || done === "unselected" || done === "rekeyed") && (kind === "prompt" || kind === "cluster") && id ? { done, kind, id, count, why: done === "refused" ? slotRefusal(one("why")) : null } : null;

  // Add a cluster (part 3b): `?add=1` opens the panel; the check's 303 adds `kw` and `ck`.
  const kw = (one("kw") ?? "").slice(0, 200);
  const market = MARKETS[isMarket(client.market) ? client.market : "US"].label;
  const adding = one("add") === "1" ? { kw, check: verdictFromQuery(one, keywordForm(kw), `the ${market}`), sig: (one("sig") ?? "").slice(0, 64) } : null;
  // R179: a pending card's Change keyword comes back with `rk` naming the card; `redraft` names the card whose inputs take fresh drafts.
  const rk = (one("rk") ?? "").slice(0, 64);
  const rekey = rk && !adding ? { card: rk, kw, check: verdictFromQuery(one, keywordForm(kw), `the ${market}`), sig: (one("sig") ?? "").slice(0, 64) } : null;
  const redraft = (one("redraft") ?? "").slice(0, 64) || null;
  // T11 /ask: the 303 carries a few words (who, and for "Ask about these" the count and noun); the line is built here.
  const ask = one("ask");
  const n = Number(one("n"));
  const of = one("of");
  const attached = Number.isInteger(n) && n > 0 && n <= ASK_ITEMS_MAX && (of === "prompts" || of === "keywords") ? `${n} ${n === 1 ? of.slice(0, -1) : of}` : undefined;
  const packPrice = trackingPackPrice(client.market);
  // DS29: "Hide for 30 days" says what it did and for how long, in the same done pill as a sent ask.
  const hid = one("hid") === "1" && !ask;
  // R151 (3 Oct 2026): a hide that was not recorded came back with no word, the prompt still there.
  const unhid = one("hid") === "0" && !ask;
  const asked = ask === "sent" ? askToast(one("via") === "agency" ? "your account contact" : "nomada digital", email, attached) : askRefusal(ask) ?? (hid ? `Hidden for ${HIDE_DAYS} days, until ${formatDay(hiddenUntil(today))}. Only you stop seeing it.` : unhid ? "That did not hide. Try again." : null);

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters current="Clusters" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={packPrice} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Clusters
          brand={client.brand ?? client.domain}
          subject={{ brand: client.brand, domain: client.domain }}
          market={client.market}
          engines={engines}
          today={today}
          range={range}
          compareMode={compare}
          startedOn={client.started_on}
          now={repo.now()}
          data={data}
          clusterLimit={client.cluster_limit ?? CLUSTER_BASE}
          open={one("open")}
          filter={f === "named" || f === "never" ? f : "all"}
          q={clusterSearch(one("q"))}
          slug={slug}
          canWrite={refuseRole(writeRole(client)) === null}
          toast={toast}
          adding={adding}
          rekey={rekey}
          typed={typed}
          redraft={redraft}
          asked={asked}
          askSent={ask === "sent" || hid}
          packPrice={packPrice}
          upgrade={{ tier, mode: upgrade.mode, hidden: upgrade.hidden, startedOn: client.started_on ?? today, domain: client.domain }}
          origins={origins}
          src={one("src") === "gaining" ? "gaining" : null}
          suggested={suggested}
          gaining={gaining?.rows[0]?.keyword ?? null}
          packLine={trackingPackLine(packPrice)}
        />
      </div>
    </div>
  );
}
