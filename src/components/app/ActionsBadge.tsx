import { cache } from "react";

import { T } from "@/config/tokens";
import { diyDay } from "@/lib/diy/core/jobs";
import { readPlan } from "@/lib/diy/plan/data";
import { weekCounts } from "@/lib/diy/plan/week";
import { badgeWords, readWeekItems } from "@/lib/diy/shell/work";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { trackingRepo } from "@/lib/tracking/repo";

/**
 * The Actions nav item's badge, "2 of 3 this week" (13 Oct 2026, DIY P5; spec
 * 10 section 3.1: the only badge). Done of this Monday's pinned items, as
 * Actions' own This week footer counts them (week.ts weekCounts), on the
 * Plan's UTC week. One small read of this week's rows, made once per request
 * however many times the shell draws it (the sidebar and the phone tab). A
 * failed read - before the plan_items migration is applied, say - draws no
 * badge and logs one line; it never reads as 0 of 0.
 */
const counts = cache(async (clientId: string): Promise<{ done: number; of: number } | null> => {
  try {
    const repo = trackingRepo();
    const today = diyDay(repo.now());
    const items = fixtureMode() ? await readPlan(() => supabaseAdmin(), clientId) : await readWeekItems(supabaseAdmin(), clientId, today);
    const c = weekCounts(items, today);
    return { done: c.done, of: c.of };
  } catch (err) {
    console.warn(`[diy] actions badge: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
});

export default async function ActionsBadge({ clientId, compact = false }: { clientId: string; compact?: boolean }) {
  const c = await counts(clientId);
  const words = c ? badgeWords(c) : null;
  if (!c || !words) return null;
  if (compact) {
    // The phone tab: a small "2/3" at the icon's corner, its words for a screen reader.
    return (
      <>
        <span aria-hidden="true" data-actions-badge="compact" style={{ position: "absolute", top: "4px", left: "calc(50% + 6px)", padding: "0 5px", borderRadius: "999px", background: T.wash, color: T.accent, border: `1px solid ${T.washLine}`, fontSize: "10px", fontWeight: 700, lineHeight: "14px", fontVariantNumeric: "tabular-nums" }}>
          {`${c.done}/${c.of}`}
        </span>
        <span className="sr-only">{`, ${words}`}</span>
      </>
    );
  }
  return (
    <span data-actions-badge="" style={{ marginLeft: "auto", padding: "1px 8px", borderRadius: "999px", background: T.chip, color: T.soft, fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <span className="sr-only">, </span>
      {words}
    </span>
  );
}
