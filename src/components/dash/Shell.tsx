import BrandMark from "@/components/BrandMark";
import TierName from "@/components/TierName";
import type { Workspace } from "@/lib/dash/types";

import { Meter } from "./Figures";
import { ClientSwitch, Nav } from "./Nav";

/**
 * The dashboards host's frame: the alwayscited lockup, the site and its plan,
 * the sections, and the plan's allowances, always in view, so a full one is
 * seen before an add is refused.
 */
export default function Shell({ ws, others, base, children }: { ws: Workspace; others: { slug: string; domain: string }[]; base: string; children: React.ReactNode }) {
  const root = `${base}/${ws.client.slug}`;
  const a = ws.allowances;
  const items = [
    { href: root, label: "Overview", icon: "overview" },
    { href: `${root}/clusters`, label: "Clusters", icon: "clusters", n: ws.clusters.length },
    { href: `${root}/ai`, label: "AI visibility", icon: "ai" },
    { href: `${root}/google`, label: "Search positions", icon: "google" },
    { href: `${root}/sources`, label: "Sources", icon: "sources" },
    { href: `${root}/opportunities`, label: "Opportunities", icon: "opportunities", n: ws.opportunities.length || null },
    { href: `${root}/integrations`, label: "Integrations", icon: "integrations" },
    { href: `${root}/plan`, label: "Plan", icon: "plan" },
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
          <form action="/api/dash/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="dash-main" id="dash-content">
        <div className="dash-inner">{children}</div>
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
