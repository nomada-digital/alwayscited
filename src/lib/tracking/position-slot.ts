import { SERP_DEPTH } from "../scan/dataforseo-request.ts";
import { type Market, isMarket } from "../scan/domain.ts";
import { type Day, type Range, formatDay } from "./figures.ts";

/**
 * What a cluster keyword's Google slot says (13 Oct 2026, Danny). Pure.
 *
 * The Overview's cluster cards, the Clusters page and the one-cluster page
 * drew a bare "-" for every keyword with no position, so "read today and not
 * in the top 20" looked the same as "not read at all" - and Danny, seeing his
 * own agency 3rd in his signed-in browser, read our "-" as a reading that had
 * gone missing. Trust rule 2 (spec 10 section 2.6): "Not measured" and
 * "measured, not in the top 20" are drawn differently and never mixed. So
 * each slot is one of five, each with a short form for the slot and a full
 * sentence for a screen reader and the hover:
 *
 * - **ranked**: "#3";
 * - **out**: read, and not in Google's top 20 - "Not in top 20 (UK)", with
 *   the market the reading was made for, because a reading is one market's;
 * - **pending**: the keyword's first check is still to come - "Not checked yet":
 *   the cluster's first check, or (review, 13 Oct 2026) a keyword a live cluster
 *   took after it started (ON-1), checked from the next daily check;
 * - **unread**: a live keyword with no reading in the range - "Not measured
 *   that day" on a one-day range, "Not measured in this range" on a longer one;
 * - **none**: the cluster has no keyword.
 *
 * The market is the client's (client_domains.market), read as the runner
 * reads it: the UK or the US (dataforseo-request.ts keywordRankRequest,
 * location by market, desktop, depth SERP_DEPTH).
 */

export type SlotKind = "ranked" | "out" | "pending" | "unread" | "none";
export type PositionSlot = { kind: SlotKind; short: string; full: string };

/** The client's market as the runner reads it; anything else is the US, as the Clusters page reads it. */
export function marketOf(market: string): Market {
  return isMarket(market) ? market : "US";
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

export function positionSlot(
  c: { keyword: string | null; position: number | null; positionRead: boolean; positionOn: Day | null; status: "live" | "added" | "pending"; keywordAhead?: boolean },
  market: string,
  range: Range | null = null,
): PositionSlot {
  const m = marketOf(market);
  const kw = c.keyword;
  if (kw === null) return { kind: "none", short: "No keyword", full: "This cluster has no Google keyword yet, so nothing is checked on Google." };
  const on = c.positionOn ? `, ${formatDay(c.positionOn)}` : "";
  if (c.position !== null) return { kind: "ranked", short: `#${c.position}`, full: `'${kw}' is ${ordinal(c.position)} on Google in the ${m} at its latest reading${on}.` };
  if (c.positionRead) return { kind: "out", short: `Not in top ${SERP_DEPTH} (${m})`, full: `'${kw}' is not in Google's top ${SERP_DEPTH} in the ${m} at its latest reading${on}.` };
  if (c.status === "pending" || c.keywordAhead) return { kind: "pending", short: "Not checked yet", full: `'${kw}' has not been checked on Google yet. Its first check is the next daily check.` };
  if (range && range.from === range.to) return { kind: "unread", short: "Not measured that day", full: `'${kw}' was not read on Google on ${formatDay(range.from)}.` };
  return { kind: "unread", short: "Not measured in this range", full: range ? `'${kw}' was not read on Google between ${formatDay(range.from)} and ${formatDay(range.to)}.` : `'${kw}' was not read on Google in this range.` };
}
