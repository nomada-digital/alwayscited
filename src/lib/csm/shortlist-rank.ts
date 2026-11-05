/**
 * The placement shortlist for one cluster, ranked and queued over three months (Danny, 5 Nov 2026). AGENCY ONLY.
 *
 * Inputs are what shortlist.ts has read: the cluster's DR floor (serp-floor.ts), the client's live Opportunities
 * (pages the engines cite that leave the client out - all of which the client can see on their dashboard), and
 * Fatgrid listings for those pages' hosts, for the client's own domain, and from an inventory pull at the floor.
 *
 * - A cited page whose host is on Fatgrid is the strongest item: the engines already read it. A cited list page with
 *   link insertions on offer is a link insertion into that page; a cited host taking guest posts is a new listicle
 *   there. Both are flagged client_visible - "the client can see this one, we can buy it". Cited hosts are kept
 *   whatever their DR, because the engines citing them is the evidence the floor stands in for.
 * - Inventory hosts must reach the floor and have organic traffic (the fatgrid skill: traffic is proof of life).
 * - A self-referencing listicle on the client's own site only when its own DR reaches the floor: a new site's list
 *   will not rank, so it is not offered there.
 * - Month 1: quick wins - the cheaper half of the buyable inventory, and the own-site listicle. Months 2-3: the
 *   higher-impact and pricier items, cited hosts first, split in rank order.
 * - Above $500 an item carries a note for review (the fatgrid skill's flag); nothing is bought by code.
 *
 * Pure. Imports are relative and carry the extension, for the reason dataforseo-request.ts gives.
 */

import { normalizeDomain } from "../scan/domain.ts";
import { type Listing, priceFor } from "./fatgrid-request.ts";

export type Kind = "link_insertion" | "new_listicle" | "guest_post";

export type CitedPage = { opportunityId: string; url: string; domain: string; route: string | null; answers: number };

export type Candidate = {
  domain: string;
  pageUrl: string | null;
  kind: Kind;
  queueMonth: 1 | 2 | 3;
  priceUsd: number | null;
  dr: number | null;
  traffic: number | null;
  citedBy: number;
  score: number;
  opportunityId: string | null;
  clientVisible: boolean;
  ownSite: boolean;
  note: string | null;
};

/** Per month at most, so a queue stays something a person reads. */
export const PER_MONTH = 8;
/** The skill's review flag: an item above this is looked at before anyone buys it. */
export const REVIEW_PRICE_USD = 500;
/** An inventory host with less organic traffic than this is not proof it can rank. */
export const MIN_TRAFFIC = 1000;

const LIST_ROUTES = new Set(["ask_added"]);

function score(c: { citedBy: number; traffic: number | null; dr: number | null; priceUsd: number | null }, floor: number): number {
  const cited = c.citedBy > 0 ? 50 + 5 * Math.min(c.citedBy, 20) : 0;
  const traffic = Math.min(30, Math.log10((c.traffic ?? 0) + 1) * 6);
  const margin = c.dr === null ? 0 : Math.max(-20, Math.min(20, c.dr - floor));
  const cost = (c.priceUsd ?? 300) / 50;
  return Math.round((cited + traffic + margin - cost) * 10) / 10;
}

const reviewNote = (price: number | null) => (price !== null && price > REVIEW_PRICE_USD ? `Over $${REVIEW_PRICE_USD}: review before buying.` : null);

export function rankShortlist(p: {
  clientDomain: string;
  clientDr: number | null;
  floor: number;
  keyword: string | null;
  cited: readonly CitedPage[];
  listings: ReadonlyMap<string, Listing>;
  inventory: readonly { listing: Listing; offer: "guest_post" | "link_insertion" }[];
}): Candidate[] {
  const own = normalizeDomain(p.clientDomain);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Omit<Candidate, "score" | "queueMonth">) => {
    const key = `${c.domain}|${c.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...c, queueMonth: 2, score: score(c, p.floor) });
  };

  // Cited pages on buyable hosts, the strongest evidence, grouped by host and kind.
  const byHost = new Map<string, CitedPage[]>();
  for (const c of p.cited) {
    const d = normalizeDomain(c.domain);
    if (!d || d === own || d.endsWith(`.${own}`)) continue;
    byHost.set(d, [...(byHost.get(d) ?? []), c]);
  }
  for (const [domain, pages] of byHost) {
    const l = p.listings.get(domain);
    if (!l) continue;
    const top = [...pages].sort((a, b) => b.answers - a.answers)[0]!;
    const citedBy = pages.reduce((a, x) => a + x.answers, 0);
    const insertion = priceFor(l, "link_insertion");
    const guest = priceFor(l, "guest_post");
    const offersInsertion = l.offers.some((o) => o.type === "link_insertion");
    const offersGuest = l.offers.some((o) => o.type === "guest_post") || !l.offers.length;
    if (offersInsertion && LIST_ROUTES.has(top.route ?? "")) {
      add({ domain, pageUrl: top.url, kind: "link_insertion", priceUsd: insertion, dr: l.dr, traffic: l.traffic, citedBy, opportunityId: top.opportunityId, clientVisible: true, ownSite: false, note: reviewNote(insertion) });
    }
    if (offersGuest) {
      add({ domain, pageUrl: null, kind: "new_listicle", priceUsd: guest, dr: l.dr, traffic: l.traffic, citedBy, opportunityId: top.opportunityId, clientVisible: true, ownSite: false, note: reviewNote(guest) });
    }
  }

  // Inventory at the floor, with proof of life.
  for (const { listing: l, offer } of p.inventory) {
    const d = l.domain;
    if (d === own || d.endsWith(`.${own}`) || byHost.has(d)) continue;
    if ((l.traffic ?? 0) < MIN_TRAFFIC || (l.dr ?? 0) < p.floor) continue;
    const price = priceFor(l, offer);
    add({ domain: d, pageUrl: null, kind: offer === "link_insertion" ? "link_insertion" : "guest_post", priceUsd: price, dr: l.dr, traffic: l.traffic, citedBy: 0, opportunityId: null, clientVisible: false, ownSite: false, note: reviewNote(price) });
  }

  // Queue: quick wins in month 1 (the cheaper half of what is not cited), the rest by score into months 2 and 3.
  const notCited = out.filter((c) => c.citedBy === 0 && c.priceUsd !== null).sort((a, b) => a.priceUsd! - b.priceUsd!);
  const quick = new Set(notCited.slice(0, Math.min(PER_MONTH - 1, Math.ceil(notCited.length / 2))));
  const rest = out.filter((c) => !quick.has(c)).sort((a, b) => b.score - a.score);
  for (const c of quick) c.queueMonth = 1;
  rest.forEach((c, i) => (c.queueMonth = i < PER_MONTH ? 2 : 3));
  const queued = [...quick, ...rest.slice(0, PER_MONTH * 2)];

  // The client's own listicle, month 1, only where its domain has the authority to rank one.
  if (p.clientDr !== null && p.clientDr >= p.floor) {
    queued.unshift({
      domain: own, pageUrl: null, kind: "new_listicle", queueMonth: 1, priceUsd: 0, dr: p.clientDr, traffic: null, citedBy: 0, score: 0,
      opportunityId: null, clientVisible: false, ownSite: true,
      note: `Self-referencing listicle on the client's own site${p.keyword ? ` for "${p.keyword}"` : ""}: its DR ${p.clientDr} reaches the floor of ${p.floor}.`,
    });
  }
  return queued.sort((a, b) => a.queueMonth - b.queueMonth || b.score - a.score);
}
