import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import Settings from "@/components/app/Settings";
import Sidebar from "@/components/app/Sidebar";
import { preloadActionsBadge } from "@/components/app/ActionsBadge";
import type { TierKey } from "@/components/TierName";
import { enginesFor, trackingPackPrice } from "@/config/pricing";
import { T } from "@/config/tokens";
import { CLUSTER_BASE } from "@/lib/tracking/limits";
import { rangeQuery } from "@/lib/tracking/overview-data";
import { placedTier } from "@/lib/tracking/placement-figures";
import { trackingRepo } from "@/lib/tracking/repo";
import { askRefusal, askToast } from "@/lib/tracking/ask";
import { inviteRefusal, teamToast } from "@/lib/tracking/team";
import { appPath } from "@/lib/app-host";
import { diyClient } from "@/lib/diy/core/client";
import { type DiyUsage, loadDiyUsage } from "@/lib/diy/core/usage-meter";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fixtureMode } from "@/lib/tracking/fixture-mode";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Settings - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * One client's Settings (R142, BRIEF-4 P2: appPath(`/[client]/settings`)). Same
 * membership rule as the overview: a slug the session is not a live member
 * of is a 404.
 */
export default async function ClientSettings({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/settings`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  preloadActionsBadge(client.id);
  const tier = (client.tier as TierKey) ?? "tracked";
  const engines = enginesFor(tier);
  const today = repo.today();
  // 13 Oct 2026, DIY P9 (spec 10 section 4.13): this month's research, counts only. Each count is read on its own
  // (loadDiyUsage); a whole failure says so in its section and the rest of Settings draws. 13 Oct 2026, DIY P10:
  // Links is built (wave 3), so the link targets row is drawn too ("Link targets: 5 of 5", section 4.13).
  // 13 Oct 2026 (dashboard speed work): read beside the rest rather than after it. The counts take the client's id,
  // market and trial only (usage-meter.ts), so they do not wait for the upsell mode.
  const researchP: Promise<DiyUsage | { failed: true }> = (async () => {
    try {
      const diy = diyClient(
        { id: client.id, slug: client.slug, domain: client.domain, brand_name: client.brand, market: client.market, tier: client.tier, started_on: client.started_on, status: client.status ?? "active", trial_ends_at: client.trial_ends_at ?? null },
        { setupConfirmedAt: null, upsellMode: null },
        repo.now(),
      );
      return await loadDiyUsage(fixtureMode() ? null : supabaseAdmin(), diy, repo.now());
    } catch (err) {
      console.warn(`[diy] settings research: ${err instanceof Error ? err.message : String(err)}`);
      return { failed: true as const };
    }
  })();
  // perf-4 (8 Oct 2026): Settings draws the clusters and prompts only, so no answer is read.
  const [structure, upgrade, settings, research] = await Promise.all([repo.structure(client.id), repo.upgradeContext(client.id, email, today), repo.settings(client.id), researchP]);
  const clusterLimit = client.cluster_limit ?? CLUSTER_BASE;
  // A stopped cluster frees its slot at once, as the Clusters page counts it.
  const inUse = (structure.clusters ?? []).filter((c) => c.stopped_on === null).length;

  return (
    <div className="app-shell" style={{ display: "flex", flexWrap: "wrap", minHeight: "100vh", color: T.ink }}>
      {/* DS39 (2 Oct 2026, R173 pass 4): Settings shows no range, but a range the nav brought in rides on to the next page. */}
      <Sidebar keep={rangeQuery(sp, today, client.started_on)} client={client} others={clients.filter((c) => c.slug !== slug)} email={email} role={client.role} tier={tier} engines={engines} clusters current="Settings" placements={placedTier(tier)} clusterLimit={clusterLimit} packPrice={trackingPackPrice(client.market)} upsell={upgrade.mode === "nomada"} />
      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 480px", minWidth: 0, padding: "36px 40px 48px", background: T.bg }}>
        <Settings
          domain={client.domain}
          brand={client.brand}
          market={client.market}
          tier={tier}
          clusterLimit={clusterLimit}
          clustersInUse={inUse}
          startedOn={client.started_on}
          today={today}
          aliases={settings.aliases}
          members={settings.members}
          email={email}
          mode={upgrade.mode}
          slug={slug}
          owner={client.role === "owner"}
          keep={rangeQuery(sp, today, client.started_on)}
          toast={
            sp.trial === "cancelled"
              ? "Trial cancelled. Tracking stops when the trial ends, and nothing is charged."
              : sp.trial === "refused"
                ? "The trial was not cancelled. Try again, or use Ask us and we will cancel it."
                : sp.ask === "sent"
              ? askToast(sp.via === "agency" ? "your account contact" : "nomada digital", email)
              : (askRefusal(sp.ask) ??
                teamToast(sp.team, sp.who, settings.members.find((m) => m.email === sp.who)?.role ?? null, sp.why))
          }
          inviteError={inviteRefusal(sp.team, sp.why)}
          trialEndsAt={client.trial_ends_at ?? null}
          trialCancelledAt={client.trial_cancelled_at ?? null}
          ended={client.status === "ended"}
          livePrompts={(structure.questions ?? []).filter((q) => q.stopped_on === null).length}
          accountClients={settings.accountClients}
          scoping={settings.scoping}
          research={research}
        />
      </div>
    </div>
  );
}
