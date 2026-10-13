import { formatDay } from "../../tracking/figures.ts";
import type { LinkEvidence } from "../opportunities/types.ts";

import { ESTIMATE } from "./types.ts";

/**
 * Where a row pursued or revealed from Links came from, in words (13 Oct
 * 2026, review of DIY P10: such a row opened on an Opportunities page whose
 * "Why this page" was empty, and its Actions card read "Pursued from
 * Opportunities."). Links writes the facts into the row's evidence when it
 * makes the row (`opportunities.evidence.link`, P7's allow-listed reader);
 * these lines are what the detail page's "Why this page" and the Plan card
 * say. Pure, relative imports only, so P7's modules and node --test load it.
 *
 * The gap and the targets are DataForSEO's index, so they carry "DataForSEO
 * estimate, read <date>" and the first-seen date, and say what links to
 * what - never that a link would move anything. A mention is our own read.
 */

const and = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? "a site you compete with"));

/** The evidence a Links row is made with. */
export function gapEvidence(r: { names: readonly string[]; of: number; firstSeen: string | null }, readOn: string): LinkEvidence {
  return { from: "gap", read_on: readOn, links_to: r.names.slice(0, 3), of: r.of, anchor: null, first_seen: r.firstSeen };
}

export function targetEvidence(r: { links: readonly { target: string; anchor: string | null }[]; firstSeen: string | null }, readOn: string): LinkEvidence {
  return { from: "target", read_on: readOn, links_to: r.links.map((l) => l.target).slice(0, 3), of: null, anchor: r.links.find((l) => l.anchor)?.anchor?.slice(0, 120) ?? null, first_seen: r.firstSeen };
}

export function mentionEvidence(readOn: string): LinkEvidence {
  return { from: "mention", read_on: readOn, links_to: [], of: null, anchor: null, first_seen: null };
}

/** The one line: "Links to brightbook.example and countwise.example, 2 of the 3 sites you compete with, and not to you. First seen 3 Jun 2025. DataForSEO estimate, read 10 Sep." */
export function linkWhyLine(e: LinkEvidence): string {
  const seen = e.first_seen ? ` First seen ${formatDay(e.first_seen, true)}.` : "";
  const read = `${ESTIMATE}, read ${formatDay(e.read_on)}.`;
  if (e.from === "mention") return `Names you, with no link to your site: we read the page ourselves on ${formatDay(e.read_on)}.`;
  if (e.from === "gap") {
    const of = e.of ? `, ${e.links_to.length} of the ${e.of} sites you compete with,` : "";
    return `Links to ${and(e.links_to)}${of} and not to you.${seen} ${read}`;
  }
  return `Links to ${and(e.links_to)} from inside an article${e.anchor ? `, with '${e.anchor}'` : ""}, and not to you.${seen} ${read}`;
}

/** Where on Links the row's evidence is: its view and section. */
export function linkEvidenceHref(e: Pick<LinkEvidence, "from">): string {
  return e.from === "gap" ? "/links?view=gap#gap" : e.from === "target" ? "/links?view=targets#targets" : "/links?view=mentions#mentions";
}
