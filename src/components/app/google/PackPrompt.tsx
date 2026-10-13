import Link from "@/components/app/AppLink";

import type { TierKey } from "@/components/TierName";
import { contactUrlFor } from "@/config/pricing";
import { T } from "@/config/tokens";
import { siteHref } from "@/lib/app-host";
import type { PromptCopy, Surface } from "@/lib/tracking/upgrade-prompts";

/**
 * U7 (13 Oct 2026, DIY P6; spec 10 section 2.7): a gaining-ground keyword is
 * waiting and every cluster is in use. Its words are upgrade-prompts.ts's
 * (rowCopy U7: the keyword, the cluster count and the pack line from
 * pricing.ts, never a typed price); drawn as UpgradePrompt draws a prompt,
 * inside the panel whose facts trigger it, with its "Shown because" line.
 *
 * The pack is not self-serve yet (BL-3), so its button is "Ask us": a link to
 * the contact page for the client's plan, as the Add panel's pack offer is.
 * UpgradePrompt's Ask posts the triggering ids to /ask, which takes the
 * mentioned and cited prompts only, so this one is its own small card. In
 * agency mode there is no Nomada link: the words say "More clusters is the
 * next step" and the ask is the agency's. "Hide for 30 days" is the same
 * /hide form, with the pack cta, so it works with JS off.
 */
export default function PackPrompt({ copy, slug, tier, agency, keep = {}, surface }: { copy: PromptCopy; slug: string; tier: TierKey; agency: boolean; keep?: Record<string, string>; surface: Surface }) {
  const view = new URLSearchParams({ ...keep, surface }).toString();
  return (
    <div role="note" aria-label="Upgrade" data-usage-shown="pack" data-upgrade-row="U7" style={{ margin: "14px 18px 18px", padding: "18px", borderRadius: "14px", background: T.wash, border: `1px solid ${T.washLine}`, display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ fontSize: "15px", fontWeight: 700, color: T.ink }}>{copy.title}</span>
          <span style={{ fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{copy.lead}</span>
        </div>
        <form method="post" action={`/api/app/${encodeURIComponent(slug)}/hide?${view}`} style={{ margin: 0, flexShrink: 0 }}>
          <input id={`up-hide-pack-${surface}`} type="hidden" name="cta" value="pack" />
          <button type="submit" aria-label="Hide for 30 days" title="Hide for 30 days" style={{ width: "44px", height: "44px", border: 0, borderRadius: "8px", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </form>
      </div>
      {agency ? null : (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Link href={siteHref(contactUrlFor(tier))} data-usage="cta_click" data-usage-cta="pack" style={{ display: "flex", alignItems: "center", height: "44px", padding: "0 16px", borderRadius: "12px", border: `1px solid ${T.line}`, background: T.surface, color: T.ink, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
            {copy.ask}
          </Link>
        </div>
      )}
      <span style={{ fontSize: "12px", color: T.soft }}>{copy.why}</span>
    </div>
  );
}
