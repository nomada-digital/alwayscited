import { SITE_ORIGIN } from "@/lib/app-host";
import { packNudge, upgradeNudge, type NudgeContext, type NudgeId } from "@/lib/dash/nudges";
import { tierInfo } from "@/lib/dash/plan";
import type { Workspace } from "@/lib/dash/types";

import NudgeCard from "./NudgeCard";

/**
 * The one suggestion a page shows, if the readings support one: the next plan
 * up, or - on tracking plans only - an extra pack when an allowance is nearly
 * full. `only` limits a page to the suggestion that page's figures are about.
 */
export default function Nudges({ ws, base, ctx, only }: { ws: Workspace; base: string; ctx: NudgeContext; only?: NudgeId[] }) {
  const up = upgradeNudge(ws, ctx);
  const pack = ws.client.tier === "tracked" ? packNudge(ws) : null;
  const nudge = [up, pack].find((n) => n && (!only || only.includes(n.id))) ?? null;
  if (!nudge) return null;
  const slug = ws.client.slug;
  if (!nudge.to) {
    return <NudgeCard slug={slug} nudge={nudge} includes={[]} href={`${base}/${slug}/plan#pack`} label="See extra tracking" />;
  }
  const info = tierInfo(nudge.to);
  const includes = info.includes.filter((x) => !/^Everything in /.test(x));
  return <NudgeCard slug={slug} nudge={nudge} includes={includes} href={`${SITE_ORIGIN}${info.href}`} label="See how it works" />;
}
