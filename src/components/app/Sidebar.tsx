import type { ReactNode } from "react";

import Link from "@/components/app/AppLink";
import BrandMark from "@/components/BrandMark";
import EngineLogo from "@/components/EngineLogo";
import TierName, { type TierKey } from "@/components/TierName";
import { PACK_CLUSTERS, TRACKED_BASIS, TRACKED_PRICE, contactUrlFor } from "@/config/pricing";
import { trialStatus } from "@/config/trial";
import { MICRO, T } from "@/config/tokens";
import { VIEWER_REASON } from "@/lib/diy/plan/transitions";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import { KEYWORDS_PER_CLUSTER, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { planBanner } from "@/lib/tracking/plan-banner";
import { refuseRole } from "@/lib/tracking/stop";

import ActionsBadge from "./ActionsBadge";
import MenuCloser from "./MenuCloser";
import { ADD_ITEMS, CLUSTER_NAV, CLUSTER_TABS, GROUPS, NAV, PLACEMENTS_ITEM, TABS, TAB_LABEL, addHref, navHref } from "./nav";
import { appPath, siteHref } from "@/lib/app-host";

const WORDS = ["no", "one", "two", "three", "four", "five"];

/**
 * The dashboard sidebar (T3, 29 Sep 2026), from boards/Main.dc.html: lockup,
 * client switcher, nav, plan card, member. Shared by /app/[client] and the
 * parity fixture so the two cannot drift.
 *
 * R104 (29 Sep 2026): the sidebar is the full height of the viewport and
 * pinned, with the plan card and member at its foot as the board draws them.
 * Below 860px it gives way to Mobile.dc.html's shell - a top bar with the
 * lockup and the client, and four tabs along the bottom. All three are in the
 * server HTML and swapped by CSS, so the phone shell stands with JS off.
 */

// The item lists and where each goes live in nav.ts, where the R131 census reads them.

// R123 (30 Sep 2026): one line icon per nav item, boards-3/common.py's ICONS
// at the board's sizes - 18px in the sidebar, 20px on the phone tabs. The
// flat client's keywords item takes the board's search mark.
const ICONS: Record<string, ReactNode> = {
  Overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  Clusters: (
    <>
      <circle cx="5" cy="6" r="1.6" />
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="5" cy="18" r="1.6" />
      <path d="M7 6c6 0 6 6 10 6M7 18c6 0 6-6 10-6M7 12h10" />
      <circle cx="19" cy="12" r="2.2" />
    </>
  ),
  "Who is named": <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  "Cited pages": (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  Reports: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  Settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
};
// boards-3/Placements.dc.html draws Placements with the link mark.
ICONS[PLACEMENTS_ITEM] = ICONS["Cited pages"];
// 13 Oct 2026, DIY P5: AI visibility is a spark (answers), Actions a ticked list. Same 24px grid and stroke.
ICONS["AI visibility"] = (
  <>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </>
);
ICONS.Actions = (
  <>
    <path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17" />
    <path d="M11 6.5h9M11 12.5h9M11 18.5h9" />
  </>
);
// 13 Oct 2026, DIY P9: Google is the search mark, Opportunities a target, Your pages a page holding a code block (its
// schema fixes). Same 24px grid and stroke.
ICONS.Google = (
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </>
);
ICONS.Opportunities = (
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </>
);
ICONS["Your pages"] = (
  <>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5" />
  </>
);
// The phone's fifth tab (audit mobile-10): the pages the four tabs leave out.
ICONS.More = (
  <>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </>
);

function NavIcon({ item, size }: { item: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {ICONS[item]}
    </svg>
  );
}

type Client = {
  /** The client_domains id: the Actions badge reads this week's items by it. None on /app/parity, which draws no badge. */
  id?: string;
  slug: string;
  domain: string;
  brand: string | null;
  market: string;
  trial_ends_at?: string | null;
  trial_cancelled_at?: string | null;
  status?: string;
  /** BL-2 (9 Oct 2026): the payment state the webhook records (lib/checkout/payment.ts). */
  payment_status?: string | null;
  payment_retry_at?: string | null;
  payment_invoice_url?: string | null;
  payment_ended_at?: string | null;
};

function Lockup({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: `${size}px`, fontWeight: 700, letterSpacing: "-0.02em" }}>
      <BrandMark id="app-side" size={15} />
      <TierName tier="tracked" />
    </div>
  );
}

function Initial({ name, size }: { name: string; size: number }) {
  return (
    <span aria-hidden="true" style={{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size / 3.5)}px`, background: T.ink, color: T.surface, display: "flex", alignItems: "center", justifyContent: "center", fontSize: `${Math.round(size * 0.45)}px`, fontWeight: 700, flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function Sidebar({
  client,
  others,
  email,
  role,
  tier,
  engines,
  clusters = false,
  current = "Overview",
  clusterLimit,
  packPrice = null,
  upsell = false,
  placements = false,
  keep = "",
}: {
  client: Client;
  others: Client[];
  email: string;
  role: string;
  tier: TierKey;
  engines: readonly Engine[];
  /** The client has cluster rows: the cluster-first nav. */
  clusters?: boolean;
  /** The nav item for this page (T6 part 1, 30 Sep 2026). */
  current?: string;
  /** The client's cluster_limit, for "alwaystracked, 10 clusters" and the basis under it. */
  clusterLimit?: number;
  /** The pack's price in the client's market, "$49"; null draws no pack link. */
  packPrice?: string | null;
  /** upsell_mode is nomada: the plan card may name the next tier and the pack. */
  upsell?: boolean;
  /** A cluster is placed (mentioned or above) or has placements: the nav shows Placements (T13). */
  placements?: boolean;
  /** The stated range as a query, rangeQuery's "?from=&to=&compare=" or "" (DS38): every nav link carries it. */
  keep?: string;
}) {
  const nav: readonly string[] = (clusters ? CLUSTER_NAV : NAV).filter((n) => placements || n !== PLACEMENTS_ITEM);
  const tabs: readonly string[] = clusters ? CLUSTER_TABS : TABS;
  const name = client.brand ?? client.domain;
  // The alwaystracked trial (8 Oct 2026): "Free trial - ends <date>. Then $129 a month." or the cancelled line.
  const ended = client.status === "ended";
  const trial = ended ? null : trialStatus({ trialEndsAt: client.trial_ends_at ?? null, cancelled: Boolean(client.trial_cancelled_at), market: client.market, price: TRACKED_PRICE });
  // The plan banner (8 Oct 2026, audit activation-12, activation-5; BL-2's payment state, 9 Oct 2026): decided in plan-banner.ts.
  const banner = planBanner({ client: { ...client, name }, role, upsell, billing: appPath(`/${client.slug}/settings`) + "#set-billing", price: TRACKED_PRICE });
  const tone = banner ? { trial: { bg: T.wash, line: T.washLine }, ended: { bg: T.chip, line: T.line }, payment: { bg: T.warnBg, line: T.line } }[banner.tone] : null;
  // R130 (30 Sep 2026): a built screen is a link; an unbuilt one is drawn
  // disabled with "Coming soon" - no href, not focusable, aria-disabled.
  // R151 (1 Oct): the nav and tabs are AppLinks, so moving between screens is
  // a soft navigation with the pending bar, not a full reload. The client
  // switcher stays a plain <a>: a different client is a fresh page.
  // DS38 (2 Oct 2026, R173 pass 4): a stated range rides along, so Clusters after a 7-day Overview is still 7 days.
  const hrefOf = (item: string) => {
    const href = navHref(item, client.slug);
    return href && href + keep;
  };
  const more = nav.filter((item) => !tabs.includes(item) && hrefOf(item));
  // Audit mobile-10 (8 Oct 2026): on Who is named, Cited pages or Placements no tab was current and
  // More looked idle, so nothing on a phone said where you were. More is the fifth tab and is current then.
  const moreOn = more.includes(current);
  // 13 Oct 2026, DIY P5 (spec 10 sections 3.1 and 3.2): the nav in its groups, as this client's nav has them, and
  // More's sheet in the same groups as headed lists. A group with nothing in it is not drawn.
  const groups = GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => nav.includes(i)) })).filter((g) => g.items.length);
  const moreGroups = groups.map((g) => ({ label: g.label, items: g.items.filter((i) => more.includes(i)) })).filter((g) => g.items.length);
  // "+ Add" (spec 10 section 3.1): owners and editors. A viewer, and anyone on an ended client (writeRole), see it
  // disabled with the reason; the forms it opens refuse them too.
  const canAdd = refuseRole(writeRole({ role, status: client.status })) === null;
  const addWhy = ended ? "This client's tracking has ended, so nothing can be added." : VIEWER_REASON;
  const groupId = (where: string, label: string) => `nav-${where}-${label.toLowerCase()}`;
  const addLink: React.CSSProperties = { display: "flex", alignItems: "center", minHeight: "44px", padding: "0 10px", borderRadius: "8px", fontSize: "14px", fontWeight: 500, color: T.ink, textDecoration: "none" };
  const addButton: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", height: "40px", padding: "0 14px", boxSizing: "border-box", borderRadius: "10px", fontSize: "14px", fontWeight: 600, listStyle: "none" };
  const chip: React.CSSProperties = { display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 10px", border: `1px solid ${T.line}`, borderRadius: "10px", fontSize: "14px", fontWeight: 700, boxSizing: "border-box", minWidth: 0 };
  const tab: React.CSSProperties = { position: "relative", flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "10px 0 6px", fontSize: "11px", fontWeight: 600, textDecoration: "none" };
  const chipName = (
    <>
      <Initial name={name} size={22} />
      <span title={name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </>
  );
  return (
    <>
      {/* DS9 (2 Oct 2026, R172 keyboard probe): the site's skip link sits in SiteChrome, which /app
          drops, and on the phone the tabs come before the page. Same classes as the site's. */}
      <a href="#app-content" className="btn-primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:px-4 focus:py-3 focus:text-sm focus:inline-flex focus:items-center focus:min-h-11">
        Skip to content
      </a>
      {banner ? (
        // Page furniture, not an announcement: a labelled region rather than role=status, which re-read itself on every soft navigation (review of 2379757).
        <aside aria-label="Your plan" className="app-banner" style={{ flex: "1 1 100%", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "4px 12px", padding: "10px 16px", fontSize: "14px", lineHeight: 1.4, textAlign: "center", boxSizing: "border-box", background: tone!.bg, borderBottom: `1px solid ${tone!.line}`, color: T.ink }}>
          <span>{banner.text}</span>
          {/* An external link is Stripe's invoice page (BL-2): no referrer, so the client's dashboard URL stays here. */}
          {banner.link ? <a href={banner.link.href} rel={banner.link.external ? "noreferrer" : undefined} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", fontWeight: 600, color: T.accent, textDecoration: "underline", textUnderlineOffset: "2px" }}>{banner.link.label}</a> : null}
        </aside>
      ) : null}
      <header className="app-topbar" style={{ alignItems: "center", justifyContent: "space-between", height: "60px", padding: "0 16px", background: T.surface, borderBottom: `1px solid ${T.line}`, flex: "1 1 100%", minWidth: 0, boxSizing: "border-box" }}>
        <Lockup size={16} />
        {/* DS5 (2 Oct 2026, R172 pass 1): the sidebar's switcher is hidden on the phone shell, so
            a member of several clients could only reach the first. The chip opens the same list,
            a <details> so it works with JS off. */}
        <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, maxWidth: "70%" }}>
        {others.length ? (
          <details className="app-switch" style={{ position: "relative", minWidth: 0 }}>
            <summary aria-label={`${name}: switch client`} style={chip}>
              {chipName}
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: T.soft }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <nav aria-label="Switch client" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, minWidth: "220px", maxWidth: "calc(100vw - 32px)", display: "grid", padding: "6px", background: T.surface, border: `1px solid ${T.line}`, borderRadius: "12px", boxSizing: "border-box" }}>
              {others.map((c) => (
                <a key={c.slug} href={appPath(`/${c.slug}`)} style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "44px", padding: "0 10px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, color: T.ink, textDecoration: "none", overflowWrap: "anywhere" }}>
                  <Initial name={c.brand ?? c.domain} size={22} />
                  {c.brand ?? c.domain}
                </a>
              ))}
            </nav>
          </details>
        ) : (
          // With one client there is nothing to switch to, so the name is a label, not a bordered control (audit mobile-10).
          <span style={{ ...chip, border: 0, padding: 0 }}>{chipName}</span>
        )}
        </span>
      </header>

      <aside className="app-side" style={{ flex: "0 0 248px", position: "sticky", top: 0, height: "100vh", overflowY: "auto", boxSizing: "border-box", borderRight: `1px solid ${T.line}`, padding: "24px 16px", display: "flex", flexDirection: "column", gap: "24px", background: T.surface }}>
        <div style={{ padding: "4px 8px" }}>
          <Lockup size={17} />
        </div>

        <div style={{ border: `1px solid ${T.line}`, borderRadius: "12px", padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Initial name={name} size={32} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: "14px", fontWeight: 700 }}>{name}</span>
              <span style={{ fontSize: "12px", color: T.soft }}>
                {client.domain}, {client.market === "UK" ? "United Kingdom" : "United States"}
              </span>
            </span>
          </div>
          {others.length ? (
            <nav aria-label="Switch client" style={{ marginTop: "10px", display: "grid", gap: "4px" }}>
              {others.map((c) => (
                <a key={c.slug} href={appPath(`/${c.slug}`)} style={{ fontSize: "13px", color: T.accent }}>
                  {c.brand ?? c.domain}
                </a>
              ))}
            </nav>
          ) : null}
        </div>

        {/* 13 Oct 2026, DIY P5 (spec 10 section 3.1): "+ Add", links to forms that already exist. A <details>, so it
            opens with JS off; MenuCloser closes it on Escape, a click outside and a move to another page. */}
        {canAdd ? (
          <details className="app-add" style={{ position: "relative", margin: "-8px 0" }}>
            <summary style={{ ...addButton, width: "100%", border: `1px solid ${T.line}`, background: T.surface, color: T.ink, cursor: "pointer" }}>
              <span aria-hidden="true" style={{ fontSize: "18px", lineHeight: 1 }}>+</span>
              Add
            </summary>
            {/* A group, not a nav landmark: links to forms (five since wave 2), inside the sidebar's own region (host.spec.mts reads the first nav's links as the dashboard's). */}
            <div role="group" aria-label="Add" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 30, display: "grid", padding: "6px", background: T.surface, border: `1px solid ${T.line}`, borderRadius: "12px", boxSizing: "border-box", boxShadow: `0 8px 24px color-mix(in srgb, ${T.ink} 12%, transparent)` }}>
              {ADD_ITEMS.map((a) => (
                <Link key={a.label} href={addHref(a, client.slug, keep)} style={addLink}>
                  {a.label}
                </Link>
              ))}
            </div>
          </details>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "-8px 0" }}>
            <span aria-disabled="true" aria-describedby="add-why" data-add="off" style={{ ...addButton, border: `1px dashed ${T.line}`, color: T.soft, cursor: "default" }}>
              <span aria-hidden="true" style={{ fontSize: "18px", lineHeight: 1 }}>+</span>
              Add
            </span>
            <p id="add-why" style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: T.soft }}>
              {addWhy}
            </p>
          </div>
        )}

        <nav aria-label="Dashboard" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {groups.map((g) => (
            <div key={g.label ?? "top"} role={g.label ? "group" : undefined} aria-labelledby={g.label ? groupId("side", g.label) : undefined} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {g.label ? (
                <span id={groupId("side", g.label)} style={{ ...MICRO, padding: "0 12px 4px" }}>
                  {g.label}
                </span>
              ) : null}
              {g.items.map((item) => {
                const on = item === current;
                const href = hrefOf(item);
                const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: "12px", height: "40px", padding: "0 12px", borderRadius: "10px", fontSize: "14px", textDecoration: "none" };
                if (!href) {
                  return (
                    <span key={item} aria-disabled="true" style={{ ...row, color: T.soft, fontWeight: 500, cursor: "default" }}>
                      <span style={{ display: "flex" }}>
                        <NavIcon item={item} size={18} />
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>{item}</span>
                      <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 600, color: T.soft, background: T.chip, borderRadius: "999px", padding: "2px 6px", whiteSpace: "nowrap" }}>Coming soon</span>
                    </span>
                  );
                }
                return (
                  <Link
                    key={item}
                    href={href}
                    aria-current={on ? "page" : undefined}
                    style={{ ...row, background: on ? T.wash : "transparent", color: on ? T.accent : T.ink, fontWeight: on ? 600 : 500 }}
                  >
                    <span style={{ display: "flex", color: on ? T.accent : T.soft }}>
                      <NavIcon item={item} size={18} />
                    </span>
                    {item}
                    {/* The only badge (spec 10 section 3.1): "2 of 3 this week", read by its own small component. */}
                    {item === "Actions" && client.id ? <ActionsBadge clientId={client.id} /> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* T11 (30 Sep 2026): boards-3/common.py's plan card. On tracked, Claude is the dashed fifth tile (BRIEF decision 9);
            the "joins" line and the pack link are upsell, so they draw only in nomada mode, never in agency or off. */}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRadius: "14px", background: T.chip }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>Your plan</div>
          <div style={{ fontSize: "15px", fontWeight: 700 }}>
            <TierName tier={tier} />
            {clusters && clusterLimit ? `, ${clusterLimit} clusters` : null}
          </div>
          {ended ? null : <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
            {clusters && clusterLimit ? `${clusterLimit * PROMPTS_PER_CLUSTER} prompts and ${clusterLimit * KEYWORDS_PER_CLUSTER} Google keywords, checked every day on ${WORDS[engines.length] ?? engines.length} engines.` : `${TRACKED_BASIS}.`}
          </p>}
          {trial ? <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, fontWeight: 600, color: T.ink }}>{trial}</p> : null}
          {ended ? <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, fontWeight: 600, color: T.ink }}>Tracking has ended. No more checks run.</p> : null}
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {engines.map((e) => (
              <EngineLogo key={e} engine={e} size={18} title={ENGINE_SPECS[e].label} />
            ))}
            {engines.includes("claude") ? null : (
              <span title={`${ENGINE_SPECS.claude.label}, from alwaysmentioned`} style={{ display: "inline-flex", width: "18px", height: "18px", borderRadius: "6px", border: `1px dashed ${T.faint}`, boxSizing: "border-box", alignItems: "center", justifyContent: "center" }}>
                <EngineLogo engine="claude" size={11} title={`${ENGINE_SPECS.claude.label}, from alwaysmentioned`} />
              </span>
            )}
          </div>
          {upsell && !ended && !engines.includes("claude") ? (
            <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: T.soft }}>
              Claude joins as a fifth engine on <TierName tier="mentioned" />.
            </p>
          ) : null}
          {upsell && !ended && clusters && packPrice ? (
            // R151 (3 Oct 2026): was bare /contact, so the enquiry arrived with no plan; now "About <their tier>", as every tier's call does.
            <a href={siteHref(contactUrlFor(tier))} style={{ fontSize: "13px", fontWeight: 600, color: T.accent }}>
              {`Add ${PACK_CLUSTERS} clusters for ${packPrice} a month`}
            </a>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 8px", fontSize: "13px" }}>
          <span aria-hidden="true" style={{ width: "30px", height: "30px", borderRadius: "50%", background: T.wash, color: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>
            {email.charAt(0).toUpperCase()}
          </span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{email}</span>
            <span style={{ color: T.soft }}>
              {role}
              {" · "}
              <form method="post" action="/api/app/logout" style={{ display: "inline" }}>
                <button type="submit" style={{ background: "none", border: "none", padding: 0, color: T.accent, fontSize: "13px", cursor: "pointer" }}>
                  Log out
                </button>
              </form>
            </span>
          </span>
        </div>
      </aside>

      <nav aria-label="Dashboard sections" className="app-tabs" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, background: T.surface, borderTop: `1px solid ${T.line}`, paddingBottom: "8px" }}>
        {tabs.map((item) => {
          const on = item === current;
          const href = hrefOf(item);
          if (!href) {
            return (
              <span key={item} aria-disabled="true" style={{ ...tab, gap: "2px", color: T.soft, cursor: "default" }}>
                <NavIcon item={item} size={20} />
                {item}
                <span style={{ fontSize: "9px", fontWeight: 500 }}>Coming soon</span>
              </span>
            );
          }
          return (
            <Link key={item} href={href} aria-current={on ? "page" : undefined} className="app-tab" style={{ ...tab, color: on ? T.accent : T.soft }}>
              <NavIcon item={item} size={20} />
              {/* 13 Oct 2026, DIY P5: "AI" on the tab for AI visibility (TAB_LABEL); the same item, current on its page. */}
              <span className="app-tab-label">{TAB_LABEL[item] ?? item}</span>
              {item === "Actions" && client.id ? <ActionsBadge clientId={client.id} compact /> : null}
            </Link>
          );
        })}
        {/* DS6 (2 Oct 2026, R172 pass 1): the sidebar items the four tabs leave out (Who is named,
            Cited pages, Placements) and Log out. Audit mobile-10 (8 Oct 2026): this was a chip in the
            top bar, which scrolled away - 3,000px down Placements, the only way to them was back up -
            and never showed the page you were on. As the fifth tab it is always in reach and is
            current on its pages. Still a <details>, so it opens with JS off; MenuCloser closes it. */}
        {more.length ? (
          <details className="app-more" style={{ flex: "1 1 0", minWidth: 0 }}>
            <summary className="app-tab" style={{ ...tab, width: "100%", boxSizing: "border-box", color: moreOn ? T.accent : T.soft }}>
              <NavIcon item="More" size={20} />
              <span className="app-tab-label">More</span>
              {moreOn ? <span className="sr-only">{`, current page: ${current}`}</span> : null}
            </summary>
            {/* 13 Oct 2026, DIY P5 (spec 10 section 3.2): the sheet holds the groups as headed lists, and "+ Add" first,
                which on a phone has no room in the top bar. Held under the screen's height, scrolling inside itself. */}
            <nav aria-label="More of the dashboard" style={{ position: "absolute", right: "8px", bottom: "calc(100% + 8px)", zIndex: 30, minWidth: "220px", maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 96px)", overflowY: "auto", display: "grid", padding: "6px", background: T.surface, border: `1px solid ${T.line}`, borderRadius: "12px", boxSizing: "border-box", boxShadow: `0 8px 24px color-mix(in srgb, ${T.ink} 12%, transparent)` }}>
              <div role="group" aria-labelledby={groupId("more", "add")} style={{ display: "grid" }}>
                <span id={groupId("more", "add")} style={{ ...MICRO, padding: "6px 10px 2px" }}>
                  Add
                </span>
                {canAdd ? (
                  ADD_ITEMS.map((a) => (
                    <Link key={a.label} href={addHref(a, client.slug, keep)} style={addLink}>
                      {a.label}
                    </Link>
                  ))
                ) : (
                  <p id="add-why-sm" data-add="off" style={{ margin: 0, padding: "4px 10px 8px", fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
                    {addWhy}
                  </p>
                )}
              </div>
              {moreGroups.map((g) => (
                <div key={g.label ?? "top"} role={g.label ? "group" : undefined} aria-labelledby={g.label ? groupId("more", g.label) : undefined} style={{ display: "grid", borderTop: `1px solid ${T.line}`, marginTop: "4px", paddingTop: "4px" }}>
                  {g.label ? (
                    <span id={groupId("more", g.label)} style={{ ...MICRO, padding: "6px 10px 2px" }}>
                      {g.label}
                    </span>
                  ) : null}
                  {g.items.map((item) => {
                    const on = item === current;
                    return (
                      <Link key={item} href={hrefOf(item)!} aria-current={on ? "page" : undefined} style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", padding: "0 10px", borderRadius: "8px", fontSize: "14px", fontWeight: on ? 600 : 500, color: on ? T.accent : T.ink, background: on ? T.wash : "transparent", textDecoration: "none" }}>
                        <span style={{ display: "flex", color: on ? T.accent : T.soft }}>
                          <NavIcon item={item} size={18} />
                        </span>
                        {item}
                      </Link>
                    );
                  })}
                </div>
              ))}
              <form method="post" action="/api/app/logout" style={{ margin: "4px 0 0", borderTop: `1px solid ${T.line}`, paddingTop: "4px" }}>
                <button type="submit" style={{ width: "100%", minHeight: "44px", padding: "0 10px", textAlign: "left", background: "none", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 500, color: T.accent, cursor: "pointer" }}>
                  Log out
                </button>
              </form>
            </nav>
          </details>
        ) : null}
      </nav>
      <MenuCloser selector="details.app-more, details.app-switch, details.app-add" />
    </>
  );
}
