import "server-only";

import { cache } from "react";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { dashFixturePath } from "./fixture";
import { isSampleClient } from "./host";
import { type RecsResult, loadRecommendations, pick } from "./recommendations";
import { sampleRecommendations } from "./recommendations-sample";

/**
 * One client's recommendations for this request (22 Nov 2026). The layout (the nav's count) and the page both ask,
 * and React `cache` makes it one read. The generated sample client and a local run on a snapshot draw the sample
 * rows (recommendations-sample.ts), as no database is behind them; every other client, a demo or view-as link
 * included, is read with the service role and shows released rows only (recommendations.ts).
 */
export const readRecommendations = cache(async (clientId: string, today: string): Promise<RecsResult> => {
  if (isSampleClient(clientId) || dashFixturePath()) {
    const s = sampleRecommendations(today);
    return { ok: true, ...pick([...s.items, ...s.upgrades]) };
  }
  try {
    return await loadRecommendations(supabaseAdmin(), clientId);
  } catch {
    // No service client to read with: the page says so, as for any failed read.
    return { ok: false };
  }
});
