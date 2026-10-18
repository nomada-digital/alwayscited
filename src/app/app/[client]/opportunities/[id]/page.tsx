import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Sidebar from "@/components/app/Sidebar";
import { preloadActionsBadge } from "@/components/app/ActionsBadge";
import UpgradePrompt from "@/components/app/UpgradePrompt";
import OppDetail from "@/components/app/opportunities/OppDetail";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { section } from "@/lib/diy/plan/data";
import { brief, targetPage } from "@/lib/diy/opportunities/brief";
import { chosenTarget } from "@/lib/dash/target";
import { askLabel, historyLines, movesFor, promptState, statusLine } from "@/lib/diy/opportunities/detail";
import { answerLinker, promptPlaces } from "@/lib/diy/opportunities/links";
import { firstCitedLines, lastCitedText, pathOf, typesLine, u3LeavesOut, whyFacts } from "@/lib/diy/opportunities/payload";
import { offeredPrompt } from "@/lib/diy/opportunities/prompt-step";
import { U3_ROUTES } from "@/lib/diy/opportunities/routes";
import { ENDED_REASON, VIEWER_REASON, oppToast, pursuitCap } from "@/lib/diy/opportunities/status";
import { ACTIVE, OPP_ID, PAGE_TYPE_LABEL, ROUTE_LABEL } from "@/lib/diy/opportunities/types";
import { linkCheckWords, loadOppWorld, loadTargets } from "@/lib/diy/opportunities/world";
import { loadPromptOrigins } from "@/lib/diy/prompts/origins";
import { swapCandidates } from "@/lib/diy/prompts/swap";
import { addDays } from "@/lib/tracking/figures";
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
  title: "Opportunity - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One opportunity (13 Oct 2026, DIY P7; spec 10 sections 3.3, 3.5 and 4.7).
 * Same membership rule as every /app/[client] page, and `[id]` must be one of
 * this client's opportunities - never one on a page where another client has
 * been placed, which no list shows either - else the page's 404.
 *
 * Query keys, each bounded here (section 3.5): `swap` (1) opens the swap
 * picker; `done` and `why` are the routes' toast codes, drawn through
 * oppToast's fixed words.
 */
export default async function ClientOpportunity({ params, searchParams }: { params: Promise<{ client: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  // 13 Oct 2026, DIY P9: back to this opportunity after signing in, as the one-cluster and key-page pages come back to theirs.
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/opportunities/${(await params).id}`), await searchParams));
  const { client: slug, id } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  preloadActionsBadge(client.id);
  if (!OPP_ID.test(id)) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const canWrite = refuseRole(writeRole(client)) === null;
  const reason = client.status === "ended" ? ENDED_REASON : VIEWER_REASON;

  const [structure, upgrade, world] = await Promise.all([repo.structure(client.id), repo.upgradeContext(client.id, email, today), loadOppWorld(repo, client)]);
  const opp = world.rows.find((o) => o.id === id);
  if (!opp) notFound();
  const swapOpen = one("swap") === "1";
  const dark = !world.enabled;
  const facts = world.reads.get(opp.urlKey) ?? null;
  const shown = dark ? null : facts;
  const cluster = opp.clusterId ? (structure.clusters.find((c) => c.id === opp.clusterId) ?? null) : null;
  const keyword = cluster?.keyword_id ? (structure.keywords.find((k) => k.id === cluster.keyword_id) ?? null) : null;
  const brand = client.brand ?? client.domain;

  const [targets, origins, verdicts] = await Promise.all([
    section("opportunity targets", () => loadTargets(client, keyword?.id ?? null, today, world.entry)),
    loadPromptOrigins(client.id),
    cluster ? section("opportunity swap", () => repo.loadOverview(client.id, { from: addDays(today, -27), to: today }, "none", { answers: "verdicts", cluster: cluster.id })) : Promise.resolve(null),
  ]);
  const keyPage = targets.ok ? (targets.value.keyPages.find((p) => cluster && p.clusterIds.includes(cluster.id))?.url ?? null) : null;
  // 18 Oct 2026: the page a person chose for the cluster (dash/target.ts) wins over the ranking URL and the blog rule.
  const chosen = targets.ok && cluster ? chosenTarget(targets.value.keyPages.map((p) => ({ url: p.url, origin: p.origin ?? "", cluster_ids: p.clusterIds, added_on: p.addedOn ?? "", removed_on: null })), cluster.id) : null;
  const target = targetPage({ domain: client.domain, chosen, ranking: targets.ok ? targets.value.ranking : null, keyPage, intent: keyword?.intent ?? null });
  const b = brief({ opp, facts: shown, brand, target });

  const { range } = rangeFrom({}, today, client.started_on);
  const clusterPath = (c: string) => appPath(`/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(c)}`);
  const ctx = { today, brand, clusters: new Map(structure.clusters.map((c) => [c.id, c.name])), reads: world.reads, dark, answerLink: answerLinker(promptPlaces(structure, range, today), clusterPath, range), path: (p: string) => appPath(`/${encodeURIComponent(slug)}${p}`) };

  // The prompt step (section 6.7): the cluster's live prompts, the one this page added or links, and the swap picker's counts.
  const live = cluster
    ? structure.questions.filter((q) => q.cluster_id === cluster.id && q.stopped_on === null).map((q) => ({ id: q.id, text: q.text, angle: q.angle, added_on: q.added_on, placement: origins.get(q.id)?.placement === true }))
    : [];
  const promptRow = opp.promptId ? (structure.questions.find((q) => q.id === opp.promptId) ?? null) : null;
  const offered = offeredPrompt(opp, shown, keyword?.keyword ?? null, client.market);
  const candidates = verdicts && verdicts.ok ? swapCandidates(live, verdicts.value.answers, { today }) : [];
  const prompt = promptState({
    opp,
    offered,
    cluster: cluster ? { id: cluster.id, name: cluster.name } : null,
    live,
    prompt: promptRow ? { id: promptRow.id, text: promptRow.text, origin_ref: origins.get(promptRow.id)?.ref ?? null, added_on: promptRow.added_on, stopped_on: promptRow.stopped_on } : null,
    today,
    candidates,
  });

  const prompts = new Map(structure.questions.map((q) => [q.id, q.text]));
  const trial = Boolean(client.trial_ends_at && Date.parse(client.trial_ends_at) > repo.now());
  const cap = pursuitCap({ trial });
  const active = world.rows.filter((o) => ACTIVE.includes(o.status)).length;
  const clusterOpen = world.rows.filter((o) => o.clusterId === opp.clusterId && o.status === "new" && o.live).length;
  // U3 only from the page as read (payload.ts u3LeavesOut), and no upgrade surface for an ended client (section 2.2).
  const ended = client.status === "ended";
  const facts3 = { tier, mode: upgrade.mode, state: dark ? ("dark" as const) : ("ok" as const), startedOn: client.started_on ?? today, today, hidden: upgrade.hidden, leavesOut: u3LeavesOut(opp, shown, { dark, clusterOpen, routes: U3_ROUTES }) };
  const row = ended ? null : pickRow(facts3);
  const copy = row === "U3" ? rowCopy("U3", facts3) : null;
  const upgradeSlot = copy ? <UpgradePrompt copy={copy} cta="mentioned" slug={slug} items={/^[0-9a-f-]{36}$/i.test(opp.id) ? [opp.id] : []} keep={{ kind: "opportunity", id: opp.id }} surface="opportunity" /> : null;
  const who = upgrade.mode === "agency" ? "your account contact" : "nomada digital";
  const canVerify = !dark && (opp.status === "pursuing" || opp.status === "pitched" || opp.status === "won") && opp.lens !== "link_domain" && opp.lens !== "own";

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={structure.clusters.length > 0} current="Opportunities" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <OppDetail
          slug={slug}
          id={opp.id}
          title={opp.lens === "own" && opp.route === "publish_own" ? `Publish your own ${opp.pageType ? PAGE_TYPE_LABEL[opp.pageType].toLowerCase() : "page"}` : (shown?.status === "ok" && shown.title) || opp.title || pathOf(opp.url)}
          url={opp.url}
          domain={pathOf(opp.url)}
          types={typesLine({ ...opp, title: shown?.status === "ok" ? shown.title : opp.title })}
          route={ROUTE_LABEL[opp.route]}
          status={opp.status}
          statusLine={statusLine(opp)}
          cluster={cluster ? { id: cluster.id, name: cluster.name } : null}
          clusterHref={cluster ? clusterPath(cluster.id) : null}
          toast={oppToast(one("done"), one("why"), { cap, who, member: email, ...linkCheckWords(client, repo.now()) })}
          readOnly={canWrite ? null : reason}
          canWrite={canWrite}
          cap={{ active, cap, atCap: active >= cap, line: `You're working ${cap} pages at once. Mark one won, declined or not for us to pursue another.` }}
          dark={dark}
          jobFailed={world.jobFailed}
          why={whyFacts(opp, ctx)}
          whyChip={{ id: "opp-why-data", text: "Seen in your data", grade: "your_data" }}
          whatItIs={b.whatItIs}
          target={{ label: b.targetLabel, url: b.target.url }}
          targetRule={b.targetRule}
          anchor={b.anchor}
          playbook={b.playbook}
          playbookExtra={opp.route === "answer_thread" ? lastCitedText(opp, today) : null}
          pitch={b.pitch}
          who={b.who}
          moves={movesFor(opp.status)}
          note={opp.note}
          verification={opp.verified?.text ?? null}
          canVerify={canVerify}
          prompt={prompt}
          swapOpen={swapOpen}
          history={historyLines(opp.history)}
          firstCited={firstCitedLines(opp, prompts)}
          ask={(() => {
            const label = askLabel({ placed: placedTier(tier), mode: upgrade.mode, ended });
            return label ? { label } : null;
          })()}
          upgrade={upgradeSlot}
        />
      </div>
    </div>
  );
}
