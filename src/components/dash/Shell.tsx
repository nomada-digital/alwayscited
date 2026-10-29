import BrandMark from "@/components/BrandMark";
import TierName, { TIER_PLAIN } from "@/components/TierName";
import { SITE_ORIGIN } from "@/lib/app-host";
import { CONTACT_EMAIL } from "@/config/contact";
import type { Workspace } from "@/lib/dash/types";
import { showsPlacements } from "@/lib/links/gate";
import type { PlanBanner } from "@/lib/tracking/plan-banner";

import { Meter } from "./Figures";
import { ClientSwitch, Nav } from "./Nav";

/**
 * The dashboards host's frame: the alwayscited lockup, the site and its plan,
 * the sections, and the plan's allowances, always in view, so a full one is
 * seen before an add is refused.
 */
export default function Shell({ ws, others, base, demo = false, viewAs = null, banner = null, waiting = null, children }: { ws: Workspace; others: { slug: string; domain: string }[]; base: string; demo?: boolean; viewAs?: { by: string; expiresAt: string } | null; banner?: PlanBanner | null; waiting?: string | null; children: React.ReactNode }) {
  const root = `${base}/${ws.client.slug}`;
  const a = ws.allowances;
  const items = [
    { href: root, label: "Overview", icon: "overview" },
    // Paid plans: the clusters we work on, under the plan's own name (Danny, 17 Oct 2026). Plain text - a tier lockup never sits in a link.
    ...(ws.client.tier !== "tracked" ? [{ href: `${root}/managed`, label: TIER_PLAIN[ws.client.tier], icon: "plan", n: ws.clusters.filter((c) => c.managed).length || null }] : []),
    // 29 Oct 2026: placements (alwaysmentioned and up) and link insertions (the alwayscited plan and up), from the link team's sheets.
    ...(showsPlacements(ws.client.tier) ? [{ href: `${root}/links`, label: "Your links", icon: "ext" }] : []),
    { href: `${root}/clusters`, label: "Clusters", icon: "clusters", n: ws.clusters.length },
    { href: `${root}/ai`, label: "AI visibility", icon: "ai" },
    { href: `${root}/google`, label: "Search positions", icon: "google" },
    // Map pack geo-grids (22 Oct 2026): only for a client with a grid set up.
    ...(ws.localGrids ? [{ href: `${root}/local`, label: "Map pack", icon: "local" }] : []),
    { href: `${root}/sources`, label: "Sources", icon: "sources" },
    { href: `${root}/opportunities`, label: "Opportunities", icon: "opportunities", n: ws.opportunities.length || null },
    { href: `${root}/integrations`, label: "Integrations", icon: "integrations" },
    { href: `${root}/plan`, label: "Plan", icon: "plan" },
    // 18 Oct 2026 brief 2g: paid plans always see what alwaystracked would keep. Plain text, as above.
    ...(ws.client.tier !== "tracked" ? [{ href: `${root}/alwaystracked`, label: `Your ${TIER_PLAIN.tracked} view`, icon: "overview" }] : []),
    { href: `${root}/settings`, label: "Settings", icon: "settings" },
  ];
  return (
    <div className="dash">
      <aside className="dash-side">
        {/* Not a link: the lockup's tier word may sit in a link only in the site header (result-copy.test.mts); Overview is just below. */}
        <div className="dash-logo">
          <BrandMark id="dash" size={16} />
          <TierName tier="cited" />
          <small>dashboard</small>
        </div>
        <div className="dash-client">
          <b title={ws.client.domain}>{ws.client.brand ?? ws.client.domain}</b>
          <span><TierName tier={ws.client.tier} />{ws.client.trial_ends_at && !ws.client.payment_status ? " · trial" : ""}</span>
          <ClientSwitch current={ws.client.slug} others={others} base={base} />
        </div>
        <Nav items={items} root={root} />
        <div className="dash-side-foot">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 8px" }}>
            <Meter label="Clusters" used={a.clusters.used} limit={a.clusters.limit} />
            <Meter label="Keywords" used={a.keywords.used} limit={a.keywords.limit} />
            <Meter label="Prompts" used={a.prompts.used} limit={a.prompts.limit} />
          </div>
          <div className="dash-help">
            <a href={`${SITE_ORIGIN}/help`}>Help centre</a>
            <a href={`mailto:${CONTACT_EMAIL}`}>Email us</a>
          </div>
          {demo ? null : (
            <form action="/api/dash/logout" method="post">
              <button type="submit">Sign out</button>
            </form>
          )}
        </div>
      </aside>
      {/* A shared demo link (17 Oct 2026): said on every page, and edits there stay in the browser (useOps). */}
      {demo && !viewAs ? <span className="demo-badge" role="note" title="A shared demo. Changes made here are not saved.">Demo, read-only</span> : null}
      <div className="dash-main" id="dash-content">
        <div className="dash-inner">
          {/* The agency hub's "What the customer sees" (18 Oct 2026): said on every page; nothing here saves or charges. */}
          {viewAs ? (
            <div className="banner warn view-as" style={{ marginBottom: 16 }} role="note">
              <span><b>Viewing as customer</b> · read-only. This is {ws.client.domain}&apos;s dashboard as its owner sees it; nothing you do here is saved or charged. Opened by {viewAs.by}.</span>
            </div>
          ) : null}
          {banner ? (
            <div className={`banner${banner.tone === "trial" ? "" : " warn"}`} style={{ marginBottom: 16 }} role={banner.tone === "trial" ? "status" : "alert"}>
              <span>{banner.text}</span>
              {banner.link ? <a className="btn sm" href={banner.link.href} {...(banner.link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{banner.link.label}</a> : null}
            </div>
          ) : null}
          {waiting ? (
            <div className="banner" style={{ marginBottom: 16 }} role="status"><span>{waiting}</span></div>
          ) : null}
          {!ws.canWrite && !demo ? (
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>You can view this dashboard. An owner or editor can change what is tracked.</p>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

export function PageHead({ micro, title, intro, children }: { micro?: React.ReactNode; title: React.ReactNode; intro?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="dash-head">
      <div>
        {micro ? <div className="dash-micro">{micro}</div> : null}
        <h1>{title}</h1>
        {intro ? <p>{intro}</p> : null}
      </div>
      {children ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div> : null}
    </header>
  );
}
