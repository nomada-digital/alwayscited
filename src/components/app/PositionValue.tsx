import type { CSSProperties } from "react";

import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import type { PositionSlot } from "@/lib/tracking/position-slot";

/**
 * A cluster keyword's Google slot (13 Oct 2026, Danny): the position as a
 * figure, or the words for why there is none - "Not in top 20 (UK)", "Not
 * checked yet", "Not measured that day" - never a bare "-" (position-slot.ts).
 * The short form is what the eye reads; a screen reader reads the full
 * sentence, which the hover shows too.
 *
 * `big` is the figure's style, `words` the style the words take, so each
 * surface keeps its own sizes: the words are smaller, and wrap in the slot.
 */
export default function PositionValue({ slot, big, words }: { slot: PositionSlot; big: CSSProperties; words: CSSProperties }) {
  return (
    <span title={slot.full} data-position={slot.kind} style={slot.kind === "ranked" ? big : words}>
      <span aria-hidden="true">{slot.short}</span>
      <span className="sr-only">{slot.full}</span>
    </span>
  );
}

/** The words' default look: the slot's soft ink, bold enough to read as the slot's answer. */
export const POSITION_WORDS: CSSProperties = { fontSize: "13px", fontWeight: 600, lineHeight: 1.3, color: T.soft };

/**
 * "See who ranks" (13 Oct 2026, Danny): the Google page's row for this keyword, opened on who holds page 1 at its
 * latest reading - drawn only where that page has a stored top 20 to show (keywords/data.ts loadWhoRanks).
 */
export function WhoRanks({ href, keyword, className }: { href: string; keyword: string; className?: string }) {
  return (
    <Link href={href} className={className} style={{ fontSize: "12px", fontWeight: 600, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>
      See who ranks
      <span className="sr-only">{`: Google's page 1 for '${keyword}'`}</span>
    </Link>
  );
}
