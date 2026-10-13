import SubmitButton from "@/components/app/SubmitButton";
import Link from "@/components/app/AppLink";

import TierName from "@/components/TierName";
import { TIERS } from "@/config/pricing";
import { siteHref } from "@/lib/app-host";
import { T } from "@/config/tokens";
import type { PromptCopy, PromptCta, Surface } from "@/lib/tracking/upgrade-prompts";

/**
 * One upgrade prompt, drawn inside the panel whose data triggers it
 * (BRIEF-2 T11 parts 4-5, 30 Sep 2026; boards-3/CTAs.dc.html). Never a banner
 * or a modal. The words are upgrade-prompts.ts's; the button's label and page
 * are the tier's own in pricing.ts, with `?from=app`. In agency mode there is
 * no tier name and no tier button, only the ask (the copy says so).
 *
 * "Ask about these N" posts the triggering ids to /ask and "Hide for 30 days"
 * (the x) posts the cta to /hide, both plain HTML forms, so JS off still
 * works. With no ids there is nothing to ask about and the ask does not draw.
 * Both actions carry `keep`, the Clusters page's range, filter and search, so
 * the 303 lands on the same view (DS16, 2 Oct 2026).
 * The dark alwayseverywhere card waits on its panel.
 *
 * `surface` (13 Oct 2026, DIY P4; spec 10 section 2.7 "Recording", review of
 * P4): the page drawing the prompt, carried in both actions' query beside
 * `keep`. The hide and ask routes record it in `cta_events.trigger` and, for
 * `ai`, return to AI visibility with its view rather than to Clusters.
 * Clusters' call is unchanged and reads as "clusters".
 */
export default function UpgradePrompt({ copy, cta, slug, items, keep = {}, surface = "clusters" }: { copy: PromptCopy; cta: PromptCta; slug: string; items: string[]; keep?: Record<string, string>; surface?: Surface }) {
  const tier = copy.tier ? TIERS.find((t) => t.key === copy.tier) : undefined;
  const api = `/api/app/${encodeURIComponent(slug)}`;
  const view = new URLSearchParams({ ...keep, surface }).toString();
  const kept = view ? `?${view}` : "";
  return (
    <div role="note" aria-label="Upgrade" data-usage-shown={cta} style={{ margin: "14px 18px 18px", padding: "18px", borderRadius: "14px", background: T.wash, border: `1px solid ${T.washLine}`, display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ fontSize: "15px", fontWeight: 700, color: T.ink }}>{copy.title}</span>
          <span style={{ fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
            {copy.lead}
            {copy.tier ? (
              <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                <TierName tier={copy.tier} />
              </span>
            ) : null}
            {copy.tail}
          </span>
        </div>
        <form method="post" action={`${api}/hide${kept}`} style={{ margin: 0, flexShrink: 0 }}>
          <input id="up-hide-cta" type="hidden" name="cta" value={cta} />
          <button type="submit" aria-label="Hide for 30 days" title="Hide for 30 days" style={{ width: "32px", height: "32px", border: 0, borderRadius: "8px", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </form>
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {copy.button && tier ? (
          <Link href={siteHref(`${tier.href}?from=app`)} data-usage="cta_click" data-usage-cta={cta} style={{ display: "flex", alignItems: "center", height: "44px", padding: "0 16px", borderRadius: "12px", background: T.accent, color: T.surface, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
            {tier.action}
          </Link>
        ) : null}
        {items.length ? (
          <form method="post" action={`${api}/ask${kept}`} style={{ margin: 0 }}>
            <input id="up-ask-cta" type="hidden" name="cta" value={cta} />
            <input id="up-ask-items" type="hidden" name="items" value={items.join(",")} />
            <SubmitButton busy="Sending..." style={{ height: "44px", padding: "0 16px", border: `1px solid ${T.line}`, borderRadius: "12px", background: "transparent", color: T.ink, fontFamily: "inherit", fontSize: "14px", fontWeight: 600 }}>
              {copy.ask}
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <span style={{ fontSize: "12px", color: T.soft }}>{copy.why}</span>
    </div>
  );
}
