import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import { type PromptOrigin, originAttr, originHref, originLabel } from "@/lib/diy/prompts/origins";
import type { UpsellMode } from "@/lib/tracking/ask";

/**
 * Where a prompt came from (13 Oct 2026, DIY P2; spec 10 sections 4.10 and
 * 6.7): Setup, You, nomada digital ("Your account contact" in agency mode),
 * Placement · <publication domain>, Opportunity or Momentum.
 *
 * Its props are fixed from wave 1, so no wave 2 package edits it or its
 * callers for links: `origin` (loadPromptOrigins' entry for the prompt, or
 * nothing, which draws nothing), `originRef` (the placement or opportunity id;
 * the entry's own when left out), `slug` and `mode` (accounts.upsell_mode).
 * `plain` draws the chip as text, for a row that is itself a link: one anchor
 * cannot hold another (OneCluster's prompt rows).
 *
 * Placement chips link to /placements, Opportunity chips to their
 * opportunity, Momentum chips to Google's gaining ground; the others are not
 * links. A linked chip's hit area is 44 px tall (spec 3.2) without making the
 * row taller: the padding that gives it is taken back by a negative margin.
 * Its `data-origin` follows its words, not the stored kind (originAttr): a
 * nomada chip outside nomada mode is "contact" in the markup too.
 */
export default function OriginChip({
  origin,
  originRef,
  slug,
  mode,
  plain = false,
}: {
  origin: PromptOrigin | null | undefined;
  originRef?: string | null;
  slug: string;
  mode: UpsellMode;
  plain?: boolean;
}) {
  if (!origin) return null;
  const o = originRef === undefined ? origin : { ...origin, ref: originRef };
  const label = originLabel(o, mode);
  const href = plain ? null : originHref(o, slug);
  const attr = originAttr(o.kind, mode);
  const tinted = o.kind === "placement" || o.kind === "opportunity" || o.kind === "momentum";
  const chip: React.CSSProperties = {
    flexShrink: 0,
    padding: "2px 8px",
    borderRadius: "999px",
    background: tinted ? T.wash : T.chip,
    color: tinted ? T.accent : T.soft,
    fontSize: "11px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    lineHeight: "16px",
  };
  const body = (
    <>
      <span className="sr-only">Origin: </span>
      {label}
    </>
  );
  if (!href) {
    return (
      <span data-origin={attr} style={chip}>
        {body}
      </span>
    );
  }
  return (
    <Link href={href} data-origin={attr} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", padding: "12px 0", margin: "-12px 0", textDecoration: "none" }}>
      <span style={{ ...chip, textDecoration: "underline", textDecorationColor: T.washLine, textUnderlineOffset: "2px" }}>{body}</span>
    </Link>
  );
}
