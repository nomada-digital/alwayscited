/**
 * Which plan nudge, if any, a client's own readings support (17 Oct 2026).
 * Pure: thresholds from config/nudges.ts, figures from the Workspace, so the
 * rule is tested without a page. At most one upgrade nudge is returned - the
 * next plan up, never two steps - and the pack offer is separate, because
 * running out of room is not a reason to change plan.
 *
 * Every nudge carries the figures it was decided on, said in the client's
 * own numbers, and nothing else: no claim about what a plan will achieve.
 */

import { NUDGES } from "../../config/nudges.ts";

import type { TierKey, Workspace } from "./types.ts";

export type NudgeId = "to-mentioned" | "to-cited" | "to-everywhere" | "pack";
export type Nudge = { id: NudgeId; to: TierKey | null; headline: string; evidence: string[] };
export type NudgeConfig = typeof NUDGES;
export type NudgeContext = { markets: number; daysOnPlan: number | null };

const pct = (n: number) => `${Math.round(n * 100)}%`;

function topCompetitor(ws: Workspace): { name: string; answers: number } | null {
  return ws.brands.find((b) => !b.you) ?? null;
}

function youNamed(ws: Workspace): number {
  return ws.brands.filter((b) => b.you).reduce((n, b) => n + b.answers, 0);
}

/** The upgrade nudge for this client, or null. */
export function upgradeNudge(ws: Workspace, ctx: NudgeContext, cfg: NudgeConfig = NUDGES): Nudge | null {
  if (ws.window.readings < cfg.minReadings || ws.window.answers === 0) return null;
  const tier = ws.client.tier;
  const named = ws.window.named / ws.window.answers;
  const top = topCompetitor(ws);
  const you = youNamed(ws);

  if (tier === "tracked") {
    const outnamed = top && top.answers >= Math.max(1, you) * cfg.mentioned.competitorMultiple;
    if (named >= cfg.mentioned.maxNamedRate && !outnamed) return null;
    const evidence = [`AI named you in ${ws.window.named} of ${ws.window.answers} answers (${pct(named)}) over your last ${ws.window.readings} readings.`];
    if (top) evidence.push(`${top.name} was named in ${top.answers}${you ? `, ${Math.round(top.answers / Math.max(1, you))} times as often as you` : ""}.`);
    return { id: "to-mentioned", to: "mentioned", headline: top && outnamed ? `${top.name} is recommended far more often than you` : "AI rarely names you yet", evidence };
  }

  if (tier === "mentioned") {
    const cited = ws.window.cited / ws.window.answers;
    const managed = ws.clusters.filter((c) => c.managed);
    const weak = managed.filter((c) => c.headPos === null || c.headPos > cfg.cited.outsidePosition);
    if (cited >= cfg.cited.maxCitedShare || !weak.length) return null;
    const evidence = [`Your own site was cited in ${ws.window.cited} of ${ws.window.answers} answers (${pct(cited)}).`];
    for (const c of weak.slice(0, 2)) evidence.push(`"${c.headKeyword ?? c.name}" ${c.headPos === null ? "is not in Google's top 100" : `is at #${c.headPos} on Google`}.`);
    return { id: "to-cited", to: "cited", headline: "You are named, but your site is rarely the source", evidence };
  }

  if (tier === "cited") {
    const managed = ws.clusters.filter((c) => c.managed).length;
    const markets = ctx.markets >= cfg.everywhere.minMarkets;
    const settled = (ctx.daysOnPlan ?? 0) >= cfg.everywhere.minDaysOnPlan && managed >= cfg.everywhere.minManagedClusters;
    const outnamed = top && top.answers >= Math.max(1, you) * cfg.everywhere.competitorMultiple;
    if (!markets && !(settled && outnamed)) return null;
    const evidence: string[] = [];
    if (markets) evidence.push(`You track ${ctx.markets} markets.`);
    if (settled && outnamed && top) evidence.push(`${top.name} is still named ${Math.round(top.answers / Math.max(1, you))} times as often as you, across ${managed} clusters we work on.`);
    return { id: "to-everywhere", to: "everywhere", headline: "There may be room to lead the wider conversation", evidence };
  }
  return null;
}

/** The extra-tracking-pack offer, when an allowance is nearly full. Tracking plans only buy packs. */
export function packNudge(ws: Workspace, cfg: NudgeConfig = NUDGES): Nudge | null {
  const full = (["clusters", "keywords", "prompts"] as const).filter((k) => ws.allowances[k].limit > 0 && ws.allowances[k].used / ws.allowances[k].limit >= cfg.pack.atShare);
  if (!full.length) return null;
  return {
    id: "pack",
    to: null,
    headline: "You are close to your tracking allowance",
    evidence: full.map((k) => `${ws.allowances[k].used} of ${ws.allowances[k].limit} ${k} in use.`),
  };
}

/** Whether a dismissal made at `at` (epoch ms) still holds at `now`. */
export function stillDismissed(at: number | null, now: number, cfg: NudgeConfig = NUDGES): boolean {
  return at !== null && Number.isFinite(at) && now - at < cfg.dismissDays * 86_400_000;
}
