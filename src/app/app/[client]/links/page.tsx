import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Sidebar from "@/components/app/Sidebar";
import UpgradePrompt from "@/components/app/UpgradePrompt";
import Links from "@/components/app/links/Links";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { allowanceFor, allowanceMonth, usedUpLine } from "@/lib/diy/core/allowances";
import { linksToast, ENDED_REASON, VIEWER_REASON } from "@/lib/diy/links/toast";
import { pickView } from "@/lib/diy/links/types";
import { linksPage, revealFacts } from "@/lib/diy/links/view";
import { loadActivePursuits, loadChecksUsed, loadLinksWorld } from "@/lib/diy/links/world";
import { section } from "@/lib/diy/plan/data";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { rangeQuery } from "@/lib/tracking/overview-data";
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
  title: "Links - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * Links (13 Oct 2026, DIY P10; spec 10 sections 3.3, 3.5 and 4.8). Same
 * membership rule as every /app/[client] page: no session is the login page,
 * a slug that is not one of the session's clients a 404.
 *
 * Query keys, each bounded here (section 3.5): `view` one of the five views;
 * `done` and `why` the links route's codes, drawn through linksToast's fixed
 * words. The spec's `page` key is not read: the gap shows its top 25 and a
 * count, never a second page, which would be a way round the cap.
 *
 * Each section reads on its own and a failed read says so in its own card
 * (section 3.4; loadLinksWorld, view.ts `errors`): Check a link and the
 * pursued wins never wait on the paid sections' reads. No loading.tsx, as on
 * Actions and Opportunities: a segment loading boundary streams before the
 * login redirect and the membership 404 run, so both would answer 200
 * (node_modules/next/dist/docs, loading.md "Status Codes").
 */
export default async function ClientLinks({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/links`), await searchParams));
  const { client: slug } = await params;
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
  const view = pickView(one("view"));
  const trial = Boolean(client.trial_ends_at && Date.parse(client.trial_ends_at) > now);

  const [structure, upgrade, world, active, checksUsed] = await Promise.all([
    repo.structure(client.id),
    repo.upgradeContext(client.id, email, today),
    section("links", () => loadLinksWorld(repo, client)),
    section("links pursuits", () => loadActivePursuits(repo, client)),
    section("links checks", () => loadChecksUsed(repo, client, now)),
  ]);
  // loadLinksWorld reads each part on its own and never throws for one; `world` fails only if the page model can't be built.
  const page = world.ok ? linksPage(world.value, { client: { domain: client.domain, trial, market: client.market }, now, today }) : null;
  const month = allowanceMonth(client.market, now);
  const cap = allowanceFor("pursuits", { trial });
  const checkLimit = allowanceFor("link_checks", { trial });
  // One count for one allowance (usage-meter.ts countUsage "link_checks"): the checks that needed our paid reader, Verify
  // now's the same, and each site logged. A page our own fetch reads uses none (13 Oct 2026, review of DIY P10).
  const usedUp = checksUsed.ok ? usedUpLine("link_checks", checksUsed.value, { trial, market: client.market }, now) : null;
  const checks = {
    line: checksUsed.ok ? `Link checks this month: ${Math.min(checksUsed.value, checkLimit)} of ${checkLimit}, shared with Verify now and Log a site on Opportunities. A check uses one only when the page blocks our own reader; a logged site always does. They reset on ${month.resetsLabel}.` : null,
    usedUp: usedUp ? `${usedUp} A page we can read ourselves is still checked; one that blocks our reader waits until then.` : null,
  };
  const revealLine = page?.targets ? usedUpLine("link_targets", page.targets.used, { trial, market: client.market }, now) : null;

  // U5 at the reveal cap (section 2.7), on the targets view only, by the one-per-screen rule; never on an empty,
  // error or dark state, and none for an ended client (section 2.2).
  const facts = { tier, mode: upgrade.mode, state: !page ? ("error" as const) : page.state === "ready" ? ("ok" as const) : ("dark" as const), startedOn: client.started_on ?? today, today, hidden: upgrade.hidden, reveals: revealFacts(page?.targets ?? null) };
  const row = client.status === "ended" || view !== "targets" ? null : pickRow(facts);
  const copy = row === "U5" ? rowCopy("U5", facts) : null;
  const items = structure.keywords.filter((k) => !k.stopped_on).map((k) => k.id);
  const upgradeSlot = copy ? <UpgradePrompt copy={copy} cta="cited" slug={slug} items={items} keep={{}} surface="links" /> : null;

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters={structure.clusters.length > 0} current="Links" placements={placedTier(tier)} clusterLimit={client.cluster_limit ?? CLUSTER_BASE} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Links
          slug={slug}
          view={view}
          page={page}
          brand={client.brand ?? client.domain}
          domain={client.domain}
          toast={linksToast(one("done"), one("why"), { cap, resets: month.resetsLabel, revealLine, checkLine: checks.usedUp })}
          readOnly={canWrite ? null : reason}
          canWrite={canWrite}
          cap={{ atCap: active.ok ? active.value >= cap : false, line: `You're working ${cap} pages at once. Mark one won, declined or not for us to pursue another.` }}
          checks={checks}
          upgrade={upgradeSlot}
        />
      </div>
    </div>
  );
}
