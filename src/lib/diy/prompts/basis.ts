import { type Rate, basis, rate } from "../../tracking/figures.ts";

import { type PromptOrigin, isPlacementPrompt } from "./origins.ts";

/**
 * What a figure counts once prompts are added from placements (13 Oct 2026
 * review; spec 10 section 6.7, "Honesty", and the basis line of section 4.1
 * row 4). A prompt written from a placement's own title is more likely to name
 * the client than the prompts the client chose, so a figure that counts it
 * says so, beside the figure:
 *
 * - **Clusters and one cluster** keep the cluster's figures as the Overview
 *   and every other page count them - over all its prompts - and add the
 *   basis line "Includes 3 prompts added from placements", with the same
 *   figure over the chosen prompts alone, like for like (the role spec 6.7
 *   gives `/ai?origin=chosen`, which is P4's page and not on this branch).
 * - **Placements** leaves them out of its named figures instead
 *   (placements-screen.ts): each span there is "at go-live" against "now",
 *   and a placement's prompt is first asked the morning after it went live,
 *   so it could only ever be on the "now" side. Its line says what is left
 *   out.
 *
 * Pure. Which definition each page uses is Danny's to confirm before
 * placement_prompts_enabled is turned on (handoff, 13 Oct 2026).
 */

/** A prompt as a card tallies it: its answers naming the client in the range, over its answers. */
export type Tallied = { id: string; now: { num: number; den: number } };

export type PlacementBasis = {
  /** Prompts added from placements that the figure counts: those with answers in the range. */
  count: number;
  /** The same figure over the other prompts: the ones the client chose. */
  chosen: Rate;
};

/** Null when no prompt added from a placement is in the figure, so no basis line is drawn. */
export function placementBasis(prompts: readonly Tallied[], origins: ReadonlyMap<string, PromptOrigin>): PlacementBasis | null {
  const counted = prompts.filter((p) => isPlacementPrompt(origins, p.id) && p.now.den > 0).length;
  if (!counted) return null;
  const chosen = prompts.filter((p) => !isPlacementPrompt(origins, p.id));
  return { count: counted, chosen: rate(chosen.reduce((n, p) => n + p.now.num, 0), chosen.reduce((n, p) => n + p.now.den, 0)) };
}

const promptsWord = (n: number) => (n === 1 ? "1 prompt" : `${n.toLocaleString("en-GB")} prompts`);

/** "Includes 3 prompts added from placements." - the short form, beside a figure with no room for more. */
export const includesLine = (n: number): string => `Includes ${promptsWord(n)} added from placements.`;

/** "Includes 3 prompts added from placements. Without them, 14 of 45 answers named you (31%)." */
export function placementBasisLine(b: PlacementBasis): string {
  const without = b.chosen.den ? ` Without them, ${basis(b.chosen, "answers")} named you (${b.chosen.pct}%).` : " Without them there are no answers in this range.";
  return `${includesLine(b.count)}${without}`;
}

/** The Placements page's line: what its named figures leave out, and what its citation counts keep. */
export function leftOutLine(leftOut: number, all: number): string {
  return `“Answers naming you” and the named spans leave out the ${promptsWord(leftOut)} added from placements. The citation counts read answers to all ${promptsWord(all)}.`;
}
