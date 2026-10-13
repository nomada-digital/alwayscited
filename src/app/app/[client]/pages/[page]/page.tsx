import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Sidebar from "@/components/app/Sidebar";
import UpgradePrompt from "@/components/app/UpgradePrompt";
import { BasicsPanel, HistoryPanel } from "@/components/app/pages/BasicsPanel";
import FitPanel, { type ExampleState, type FitView } from "@/components/app/pages/FitPanel";
import PageDetail from "@/components/app/pages/PageDetail";
import SchemaPanel from "@/components/app/pages/SchemaPanel";
import { SectionError } from "@/components/app/pages/parts";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { allowanceMonth, usedUpLine } from "@/lib/diy/core/allowances";
import { engineSentence } from "@/lib/diy/pages/answers";
import { OPPORTUNITY_COUNT } from "@/lib/diy/pages/data";
import { exampleState } from "@/lib/diy/pages/example";
import { loadPages } from "@/lib/diy/pages/load";
import { pickCluster, pickTab } from "@/lib/diy/pages/paths";
import { ENDED_REASON, VIEWER_REASON, pagesToast } from "@/lib/diy/pages/toast";
import { ORIGIN_LABEL, basicsTab, fitTab, historyRows, itemsOn, pageState, schemaTab, servedClusters, unreadableLine } from "@/lib/diy/pages/view";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { answerHref } from "@/lib/tracking/evidence";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { CLUSTER_BASE, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { rangeFrom, rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { dayPlan } from "@/lib/tracking/read-shape";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";
import { type Facts, pickRow, rowCopy } from "@/lib/tracking/upgrade-prompts";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Your page - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One key page (13 Oct 2026, DIY P8; spec 10 section 4.9): Schema, Fit and
 * examples, Basics and History. Same membership rule as every /app/[client]
 * page, and `[page]` must be a live key page of this client, else the page's
 * own 404.
 *
 * Query keys, each bounded here (section 3.5): `tab` one of TABS (pickTab),
 * `cluster` one of the clusters this page serves (pickCluster against them),
 * `done` and `why` the pages route's codes, drawn through pagesToast's fixed
 * words.
 *
 * No loading.tsx, for the reason the list page records.
 */
export default async function ClientPage({ params, searchParams }: { params: Promise<{ client: string; page: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/pages/${(await params).page}`), await searchParams));
  const { client: slug, page: pageId } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
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
  const page = input?.keyPages.find((k) => k.id === pageId && k.removedOn === null) ?? null;
  // A key page that is not this client's live one is the page's own 404; a failed read is said on the page.
  if (input && !page) notFound();
  const tab = pickTab(one("tab"));
  const resets = allowanceMonth(client.market, now).resetsLabel;
  const used = (k: "page_checks" | "examples") => load.usage?.rows.find((r) => r.key === k)?.used ?? null;
  const checksUsed = used("page_checks");
  const examplesUsed = used("examples");
  const checksOut = checksUsed === null ? null : usedUpLine("page_checks", checksUsed, load.diy, now);
  const examplesOut = examplesUsed === null ? null : usedUpLine("examples", examplesUsed, load.diy, now);
  const toast = pagesToast(one("done"), one("why"), { resets, examplesLine: examplesOut, checksLine: checksOut });

  const sidebar = (
    <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={(input?.clusters.length ?? 0) > 0} current="Your pages" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={load.upgrade.mode === "nomada"} />
  );
  if (!input || !page) {
    return (
      <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
        {sidebar}
        <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
          <SectionError label="Your page" />
        </div>
      </div>
    );
  }

  const state = pageState(page, input);
  const served = servedClusters(page, input);
  const cluster = pickCluster(one("cluster"), served.map((c) => c.id));
  const names = (id: string) => input.clusters.find((c) => c.id === id)?.name ?? null;
  const unreadable = state.own && state.own.status !== "ok" ? unreadableLine(state.own) : null;

  let body: React.ReactNode = null;
  if (tab === "schema") {
    body = state.own ? (
      <SchemaPanel slug={slug} pageId={page.id} pageUrl={page.url} tab={state.own.status === "ok" ? schemaTab(state) : null} canWrite={canWrite} reason={reason} enabled={load.enabled} checksOut={checksOut} />
    ) : (
      <>
        <section aria-label="Schema" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "18px 20px" }}>
          <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>This page hasn't been read yet. We read it with your other key pages each week.</p>
        </section>
        <SchemaPanel slug={slug} pageId={page.id} pageUrl={page.url} tab={null} canWrite={canWrite} reason={reason} enabled={load.enabled} checksOut={checksOut} />
      </>
    );
  } else if (tab === "fit") {
    const tabs = fitTab(state, input).filter((f) => !cluster || f.cluster.id === cluster);
    const facts = (keyword: string, fits: boolean, offPage1: number, readings: number): Facts => ({ tier, mode: load.upgrade.mode, state: "ok", startedOn: client.started_on ?? today, today, hidden: load.upgrade.hidden, fit: { keyword, fits, offPage1, readings } });
    let prompted = false;
    // The cluster page lists its prompts with the default range's rule (cluster-figures.ts clusterCards: live, or stopped within the range) in the
    // same order, and `?prompt=` is an index into that list, so the index is counted over the same list (13 Oct 2026, DIY P8 review).
    const clusterRangeFrom = rangeFrom({}, today, client.started_on ?? null).range.from;
    const fits: FitView[] = await Promise.all(
      tabs.map(async (f) => {
        // What the engines say: the first stored answer to one of the cluster's live prompts that names a competitor and cites a page.
        const listed = input.prompts.filter((p) => p.clusterId === f.cluster.id && (p.stoppedOn === null || p.stoppedOn > clusterRangeFrom));
        const prompts = input.prompts.filter((p) => p.clusterId === f.cluster.id && p.stoppedOn === null);
        let sentence: FitView["sentence"] = null;
        for (const p of prompts.slice(0, PROMPTS_PER_CLUSTER)) {
          try {
            const day = await repo.answerDay(client.id, dayPlan(p.id, today, null));
            const s = engineSentence(day.rows, client.brand ?? client.domain, engines);
            const index = listed.findIndex((x) => x.id === p.id);
            if (s && day.day) {
              sentence = { text: s.sentence, engine: s.engine, href: index >= 0 ? answerHref(appPath(`/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(f.cluster.id)}`), { prompt: String(index) }, { day: day.day, engine: s.engine }) : null };
              break;
            }
          } catch (err) {
            console.warn(`[diy] pages answers: ${err instanceof Error ? err.message : String(err)}`);
            break;
          }
        }
        const rows = input.examples.filter((e) => e.urlKey === page.urlKey && e.clusterId === f.cluster.id).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
        const latest = rows[0];
        const st = latest ? exampleState(latest, now) : null;
        const lastReady = rows.find((e) => e.status === "ready" && e.example);
        const example: ExampleState =
          st === "pending"
            ? { kind: "pending" }
            : st === "failed"
              ? { kind: "failed" }
              : lastReady?.example
                ? { kind: "ready", day: (lastReady.finishedAt ?? lastReady.requestedAt).slice(0, 10), example: lastReady.example, now: lastReady.now }
                : { kind: "none" };
        const count = f.verdict.kind === "different" ? await OPPORTUNITY_COUNT(fixtureMode() ? null : supabaseAdmin(), client.id, f.cluster.id) : null;
        let upgrade: React.ReactNode = null;
        if (!prompted && f.verdict.kind === "fits" && f.keyword) {
          const fx = facts(f.keyword.keyword, true, f.verdict.offPage1, f.verdict.readings);
          const row = pickRow(fx);
          const copy = row === "U6" ? rowCopy("U6", fx) : null;
          if (copy) {
            prompted = true;
            upgrade = <UpgradePrompt copy={copy} cta="cited" slug={slug} items={[f.keyword.id]} keep={{}} surface="pages" />;
          }
        }
        return { ...f, sentence, example, upgrade, count };
      }),
    );
    body = <FitPanel slug={slug} pageId={page.id} fits={fits} enabled={load.enabled} canWrite={canWrite} reason={reason} examplesOut={examplesOut} cited={tier === "cited"} agency={load.upgrade.mode === "agency"} opening={state.own?.status === "ok" ? (state.own.basics?.opening ?? null) : null} />;
  } else if (tab === "basics") {
    body = <BasicsPanel b={basicsTab(state)} />;
  } else {
    body = <HistoryPanel slug={slug} history={historyRows(page, input.checks)} items={load.items.ok ? itemsOn(page, load.items.value) : []} />;
  }

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      {sidebar}
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <PageDetail
          slug={slug}
          pageId={page.id}
          title={state.own?.basics?.title ?? page.urlKey}
          url={page.url}
          origin={ORIGIN_LABEL(page, names)}
          tab={tab}
          cluster={cluster}
          toast={toast}
          readOnly={canWrite ? null : reason}
          reason={reason}
          canWrite={canWrite}
          enabled={load.enabled}
          checksOut={checksOut}
          unreadable={unreadable}
        >
          {body}
          {tab === "history" && !load.items.ok ? <SectionError label="Actions on this page" /> : null}
        </PageDetail>
      </div>
    </div>
  );
}
