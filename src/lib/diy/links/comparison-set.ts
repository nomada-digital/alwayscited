import { type Day, addDays, formatDay } from "../../tracking/figures.ts";

import { type Placed, bareHost, excludePlacedDomains } from "./nomada-placements.ts";
import { type Basis, type ComparisonSet, ESTIMATE } from "./types.ts";

/**
 * The comparison set (13 Oct 2026, DIY P10; spec 10 section 6.3): the three
 * vendor sites the client is compared with. Derived monthly, never declared
 * and never editable (a recorded rule). Pure.
 *
 * 1. From the last 28 days of `tracking_serp.top`, count each domain's page-1
 *    places (rank 10 or better) across every live cluster keyword: one place
 *    a keyword it held on page 1 on any day of the window, however many of
 *    its pages ranked and however many days (13 Oct 2026, review of DIY P10:
 *    it counted keyword-days, up to 28 a keyword, under words that read as a
 *    count of keywords). The client is not counted, nor its subdomains.
 * 2. Keep the domains `source_kinds` types `vendor`. Publishers, platforms,
 *    review sites, directories, communities and reference sites are left out.
 *    A domain with no type yet is held back, never used ("fail closed": the
 *    brand matcher and the source classifier are different code, the
 *    AGENTS.md Shopify gotcha) - the set is monthly, so a night's wait for a
 *    type costs nothing.
 * 3. The top 3, ties to the better average position, then by name.
 * 4. Fewer than 3: fill from Labs' competitors_domain (vendor-typed, most
 *    shared keywords first), then from backlinks/competitors (vendor-typed,
 *    most shared backlinks first). Each domain keeps its own basis.
 *
 * Domains where Nomada has placed another client are never in the set.
 */

export const SET_SIZE = 3;
export const WINDOW_DAYS = 28;

export type SerpRow = { keyword_id: string; run_date: Day; top: { rank: number; domain?: string | null; url?: string | null }[] };
export type Kinds = ReadonlyMap<string, string | null>;
export type Fallback = { domain: string; shares: number | null };

const typeOf = (kinds: Kinds, domain: string) => kinds.get(`d:${domain}`) ?? null;
const ownOf = (domain: string, client: string) => domain === client || domain.endsWith(`.${client}`);

/** Page-1 places per domain over the window - the live keywords it held on page 1 - with its average best position over the readings it was there. */
export function pageOnePlaces(rows: readonly SerpRow[], live: ReadonlySet<string>, today: Day): Map<string, { places: number; avg: number }> {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const acc = new Map<string, { keywords: Set<string>; readings: number; sum: number }>();
  for (const r of rows) {
    if (!live.has(r.keyword_id) || r.run_date < from || r.run_date > today) continue;
    const best = new Map<string, number>();
    for (const t of r.top ?? []) {
      if (!(typeof t.rank === "number" && t.rank >= 1 && t.rank <= 10)) continue;
      let host = typeof t.domain === "string" && t.domain ? t.domain : null;
      if (!host && typeof t.url === "string") {
        try {
          host = new URL(t.url).hostname;
        } catch {
          host = null;
        }
      }
      if (!host) continue;
      const d = bareHost(host);
      best.set(d, Math.min(best.get(d) ?? 99, t.rank));
    }
    for (const [d, rank] of best) {
      const a = acc.get(d) ?? { keywords: new Set<string>(), readings: 0, sum: 0 };
      a.keywords.add(r.keyword_id);
      a.readings += 1;
      a.sum += rank;
      acc.set(d, a);
    }
  }
  return new Map([...acc].map(([d, a]) => [d, { places: a.keywords.size, avg: Math.round((a.sum / a.readings) * 10) / 10 }]));
}

export type Derivation = ComparisonSet & {
  /** Page-1 holders with no type yet, held back until they have one (and sent to be typed). */
  waiting: string[];
  /** The fallback domains with no type yet, held back the same way. */
  waitingFallback: string[];
};

/** The set from the page-1 counts, filled from the two fallbacks in order. Pure. */
export function deriveSet(p: {
  client: string;
  month: Day;
  today: Day;
  places: ReadonlyMap<string, { places: number; avg: number }>;
  kinds: Kinds;
  placed: Placed;
  labs?: readonly Fallback[] | null;
  backlinks?: readonly Fallback[] | null;
}): Derivation {
  const client = bareHost(p.client);
  const usable = (d: string) => !ownOf(d, client) && excludePlacedDomains([{ domain: d }], p.placed).length === 1;
  const waiting: string[] = [];
  const page1 = [...p.places]
    .filter(([d]) => usable(d))
    .filter(([d]) => {
      const t = typeOf(p.kinds, d);
      if (t === null) waiting.push(d);
      return t === "vendor";
    })
    .sort((a, b) => b[1].places - a[1].places || a[1].avg - b[1].avg || a[0].localeCompare(b[0]))
    .slice(0, SET_SIZE);
  const domains = page1.map(([d]) => d);
  const basis: Record<string, Basis> = Object.fromEntries(page1.map(([d, v]) => [d, { from: "page1", places: v.places, avg: v.avg } as Basis]));
  const waitingFallback: string[] = [];
  const fill = (list: readonly Fallback[] | null | undefined, from: "labs" | "backlinks") => {
    const ordered = [...(list ?? [])].map((f) => ({ ...f, domain: bareHost(f.domain) })).sort((a, b) => (b.shares ?? -1) - (a.shares ?? -1) || a.domain.localeCompare(b.domain));
    for (const f of ordered) {
      if (domains.length >= SET_SIZE) return;
      if (!usable(f.domain) || domains.includes(f.domain)) continue;
      const t = typeOf(p.kinds, f.domain);
      if (t === null) {
        if (!waitingFallback.includes(f.domain)) waitingFallback.push(f.domain);
        continue;
      }
      if (t !== "vendor") continue;
      domains.push(f.domain);
      basis[f.domain] = { from, shares: f.shares };
    }
  };
  fill(p.labs, "labs");
  fill(p.backlinks, "backlinks");
  return { month: p.month, domains, basis, derivedOn: p.today, waiting: waiting.sort(), waitingFallback };
}

/** Whether the fallbacks are needed: fewer than 3 from page-1 places. */
export const needsFallback = (d: Pick<ComparisonSet, "domains" | "basis">) => d.domains.filter((x) => d.basis[x]?.from === "page1").length < SET_SIZE;

const join = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * One domain's basis in words. A fallback domain is never described as
 * holding page-1 places. backlinks/competitors' `intersections` is "the
 * number of backlink intersections with the target" in DataForSEO's
 * documentation, so that is what it is called (13 Oct 2026, review of DIY
 * P10: it was called linking domains).
 */
export function basisWords(b: Basis | undefined): string {
  if (!b) return "basis not recorded";
  if (b.from === "page1") return `page-1 places for your keywords: ${b.places}`;
  const n = b.shares === null ? "an unread number of" : b.shares.toLocaleString("en-GB");
  return b.from === "labs" ? `shares ${n} keywords with you, ${ESTIMATE}` : `shares ${n} backlink intersections with you, ${ESTIMATE}`;
}

/**
 * The line under "You and the sites you compete with" (spec 10 sections 4.8
 * row 2 and 6.3 step 5), from the stored basis. All three from page-1
 * places: one sentence about the set. Otherwise each domain carries its own.
 */
export function basisLine(set: Pick<ComparisonSet, "domains" | "basis" | "derivedOn">): string {
  if (!set.domains.length) return "";
  const all = set.domains.every((d) => set.basis[d]?.from === "page1");
  if (all && set.domains.length === SET_SIZE) return `Compared with ${join(set.domains)}: the vendor sites holding the most page-1 places for your keywords this month (derived ${formatDay(set.derivedOn)}).`;
  return `Compared with ${join(set.domains.map((d) => `${d} (${basisWords(set.basis[d])})`))}. Derived ${formatDay(set.derivedOn)}.`;
}

/** The first of the month `today` is in: a set's key. */
export const monthOf = (today: Day): Day => `${today.slice(0, 7)}-01`;
