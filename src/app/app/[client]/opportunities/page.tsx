import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Sidebar from "@/components/app/Sidebar";
import { preloadActionsBadge } from "@/components/app/ActionsBadge";
import UpgradePrompt from "@/components/app/UpgradePrompt";
import Opportunities, { type OppView } from "@/components/app/opportunities/Opportunities";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { section } from "@/lib/diy/plan/data";
import { answerLinker, promptPlaces } from "@/lib/diy/opportunities/links";
import { citedEmpty, headerCounts, headerLine, listRow, listed, pursuing, pursuingRow, tabCounts } from "@/lib/diy/opportunities/payload";
import { type OppKeep } from "@/lib/diy/opportunities/paths";
import { ENDED_REASON, VIEWER_REASON, oppToast, pursuitCap } from "@/lib/diy/opportunities/status";
import { ACTIVE, TAB_LENSES, type TabLens } from "@/lib/diy/opportunities/types";
import { citedWorld, linkCheckWords, loadCitedSummary, loadOppWorld } from "@/lib/diy/opportunities/world";
import { loadPromptOrigins } from "@/lib/diy/prompts/origins";
import { ENGINE_SPECS } from "@/lib/scan/engines";
import { clusterSearch } from "@/lib/tracking/cluster-figures";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";
import { pickRow, rowCopy } from "@/lib/tracking/upgrade-prompts";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Opportunities - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/** Rows a page of the list holds. */
const PER_PAGE = 25;

const pickView = (raw: string | null): OppView => (raw === "pursuing" || raw === "methods" ? raw : "list");
const pickLens = (raw: string | null): TabLens => ((TAB_LENSES as readonly string[]).includes(raw ?? "") ? (raw as TabLens) : "cited");
const pickPage = (raw: string | null): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 1;
};

/**
 * Opportunities (13 Oct 2026, DIY P7; spec 10 sections 3.3, 3.5 and 4.7).
 * Same membership rule as every /app/[client] page: no session is the login
 * page, a slug that is not one of the session's clients a 404.
 *
 * Query keys, each bounded here (section 3.5): `view` list, pursuing or
 * methods; `lens` one of the six tabs; `cluster` one of this client's
 * clusters; `engine` one of its tier's engines; `q` cut as every search is;
 * `page` 1-50; `done` and `why` the routes' toast codes, drawn through
 * oppToast's fixed words.
 *
 * Each section reads on its own and a failed read says so (section 3.4). No
 * loading.tsx, as on Actions: a segment loading boundary streams before the
 * login redirect and the membership 404 run, so both would answer 200
 * (node_modules/next/dist/docs, loading.md "Status Codes").
 */
export default async function ClientOpportunities({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/opportunities`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  preloadActionsBadge(client.id);
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const canWrite = refuseRole(writeRole(client)) === null;
  const reason = client.status === "ended" ? ENDED_REASON : VIEWER_REASON;

  const lens = pickLens(one("lens"));
  // 13 Oct 2026 (dashboard speed work): on the cited tab, the answers its empty state is summarised from are read with
  // the first reads, on the same structure read, rather than after them; used only when the tab turns out empty.
  // Review, same day: that is the default tab, so once the refresh job fills the table the read is thrown away on most
  // views - 28 days of answers. Kept, since while the tab is empty it saves a round trip after the others, and cut to
  // their citations (world.ts citedWorld): the brands are no part of the summary.
  const structureP = repo.structure(client.id);
  const citedP = lens === "cited" ? citedWorld(repo, client, structureP) : undefined;
  citedP?.catch(() => {});
  const [structure, upgrade, world, origins] = await Promise.all([structureP, repo.upgradeContext(client.id, email, today), section("opportunities", () => loadOppWorld(repo, client)), loadPromptOrigins(client.id)]);
  const view = pickView(one("view"));
  const cluster = structure.clusters.some((c) => c.id === one("cluster")) ? one("cluster") : null;
  const engine = engines.find((e) => e === one("engine")) ?? null;
  const q = clusterSearch(one("q"));
  const page = pickPage(one("page"));
  const keep: OppKeep = { ...(view !== "list" ? { view } : {}), ...(lens !== "cited" ? { lens } : {}), ...(cluster ? { cluster } : {}), ...(engine ? { engine } : {}), ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}) };

  const trial = Boolean(client.trial_ends_at && Date.parse(client.trial_ends_at) > repo.now());
  const cap = pursuitCap({ trial });
  const rows = world.ok ? world.value.rows : [];
  const active = rows.filter((o) => ACTIVE.includes(o.status));
  const dark = world.ok ? !world.value.enabled : false;
  const clusterNames = new Map(structure.clusters.map((c) => [c.id, c.name]));
  const { range } = rangeFrom({}, today, client.started_on);
  const clusterPath = (id: string) => appPath(`/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(id)}`);
  const answerLink = answerLinker(promptPlaces(structure, range, today), clusterPath, range);
  const ctx = { today, brand: client.brand ?? client.domain, clusters: clusterNames, reads: world.ok ? world.value.reads : new Map(), dark, answerLink, path: (p: string) => appPath(`/${encodeURIComponent(slug)}${p}`) };

  // The list: this tab's new rows, in the stated order, under the filters; then the page of them.
  const term = q.trim().toLowerCase();
  const all = listed(rows, lens).filter((o) => (!cluster || o.clusterId === cluster) && (!engine || o.evidence.engines.includes(engine)) && (!term || `${o.title ?? ""} ${o.url} ${o.domain}`.toLowerCase().includes(term)));
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const shown = all.slice((Math.min(page, pages) - 1) * PER_PAGE, Math.min(page, pages) * PER_PAGE);
  const usedClusters = new Set(listed(rows, lens).map((o) => o.clusterId).filter((c): c is string => c !== null));
  // The cited tab's empty states (section 4.7), said only as far as the reads show (payload.ts citedEmpty). The
  // summary needs the window's answers, so it is drawn only when the tab is empty, from the read begun above.
  let empty: string | null = null;
  if (world.ok && lens === "cited" && !listed(rows, "cited").length) {
    const cited = await section("cited pages", () => loadCitedSummary(repo, client, world.value, citedP));
    empty = citedEmpty(cited.ok ? cited.value : null, rows);
  }

  // U8 at the pursuit limit (section 2.7), by the one-per-screen rule; never on an empty, error or dark state, and
  // none for an ended client (section 2.2).
  const facts = { tier, mode: upgrade.mode, state: !world.ok ? ("error" as const) : dark ? ("dark" as const) : ("ok" as const), startedOn: client.started_on ?? today, today, hidden: upgrade.hidden, pursuits: { active: active.length, cap } };
  const row = client.status === "ended" ? null : pickRow(facts);
  const copy = row === "U8" ? rowCopy("U8", facts) : null;
  const upgradeSlot = copy ? <UpgradePrompt copy={copy} cta="mentioned" slug={slug} items={active.map((o) => o.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id))} keep={{ kind: "opportunity" }} surface="opportunities" /> : null;
  const prompts = new Map(structure.questions.map((x) => [x.id, x.text]));

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={structure.clusters.length > 0} current="Opportunities" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Opportunities
          slug={slug}
          view={view}
          lens={lens}
          keep={keep}
          header={world.ok ? headerLine(headerCounts(rows), world.value.refreshedTo) : ""}
          tabs={world.ok ? tabCounts(rows) : null}
          rows={world.ok ? shown.map((o) => listRow(o, ctx)) : null}
          total={all.length}
          page={Math.min(page, pages)}
          pages={pages}
          clusters={structure.clusters.filter((c) => usedClusters.has(c.id) || c.id === cluster).map((c) => ({ id: c.id, name: c.name }))}
          cluster={cluster}
          engines={engines.map((e) => ({ key: e, label: ENGINE_SPECS[e].label }))}
          engine={engine}
          q={q}
          toast={oppToast(one("done"), one("why"), { cap, ...linkCheckWords(client, repo.now()) })}
          readOnly={canWrite ? null : reason}
          canWrite={canWrite}
          cap={{ active: active.length, cap, atCap: active.length >= cap, line: `You're working ${cap} pages at once. Mark one won, declined or not for us to pursue another.` }}
          dark={dark}
          jobFailed={world.ok ? world.value.jobFailed : false}
          empty={empty}
          pursuing={world.ok ? pursuing(rows).map((o) => pursuingRow(o, { ...ctx, prompts, promptHref: (id) => {
            const c = structure.questions.find((x) => x.id === id)?.cluster_id;
            return c ? clusterPath(c) : null;
          }, domain: client.domain, addedBy: (pid) => (origins.get(pid)?.kind === "opportunity" ? origins.get(pid)!.ref : null) })) : null}
          upgrade={upgradeSlot}
        />
      </div>
    </div>
  );
}
