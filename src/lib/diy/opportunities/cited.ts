import { brandsRead, type Day, formatDay } from "../../tracking/figures.ts";

import { domainKey, pageKey } from "./classify-rules.ts";
import { citationKey, domainTypeOf, pageTypeOf } from "./derive.ts";
import { AI_CITED_LENSES, DOMAIN_TYPE_LABEL, DOMAIN_TYPES, type DomainType, NOT_CLASSIFIED, PAGE_TYPE_LABEL, type KindRow, type Opportunity, type PageFacts } from "./types.ts";
import { domainTypeByRule, pageTypeByRule } from "./classify-rules.ts";
import { CLASSIFIED_LABEL } from "../core/evidence.ts";

/**
 * Cited pages' facts (13 Oct 2026, DIY P7; spec 10 section 4.5). Facts
 * only: the advice is on Opportunities. Pure.
 *
 * - **Kind and Page type**: from the rules and the cached types, by the
 *   page's host and its key; a blank reads "not classified yet".
 * - **Leaves you out** (`?leaves=1`): pages whose latest read found the
 *   client not named, and which were cited in answers that named another
 *   brand - minus every page where Nomada has placed another client, the
 *   same subtraction as Opportunities. Each links to its opportunity when it
 *   has one.
 * - **Could not read**: "Could not read this page on 3 Nov (HTTP 403)." The
 *   silent-failure path, made visible.
 */

export type CitedFacts = {
  /** Kind and page type per page key, as the two columns draw them. */
  kinds: Map<string, { kind: string; type: string; domainType: DomainType | null }>;
  /** The pages that leave the client out, placements subtracted. */
  leaves: Set<string>;
  /** Each page's opportunity id, for "Open in Opportunities". */
  opps: Map<string, string>;
  /** "Could not read this page on 3 Nov (HTTP 403).", per page. */
  unreadable: Map<string, string>;
};

/** `?type=`: a domain type, else none. */
export const pickCitedType = (raw: string | null): DomainType | null => (raw && (DOMAIN_TYPES as readonly string[]).includes(raw) ? (raw as DomainType) : null);

/** The per-row state for a page we could not read (section 4.5). */
export function couldNotRead(f: Pick<PageFacts, "readAt" | "http" | "status">): string {
  const day = formatDay(f.readAt.slice(0, 10));
  return f.status === "blocked" ? `Could not read this page on ${day}: it asks crawlers like ours not to.` : `Could not read this page on ${day}${f.http ? ` (HTTP ${f.http})` : ""}.`;
}

export function citedFacts(input: {
  pages: readonly { page: string; host: string }[];
  answers: readonly { run_date: Day; answered?: boolean; named: boolean; brands: string[]; brands_ok?: boolean; citations: { source_domain: string; url: string | null }[] }[];
  range: { from: Day; to: Day };
  reads: ReadonlyMap<string, PageFacts>;
  kinds: ReadonlyMap<string, Pick<KindRow, "domain_type" | "page_type" | "set_by">>;
  placedKeys: ReadonlySet<string>;
  rows: readonly Opportunity[];
}): CitedFacts {
  const kinds = new Map<string, { kind: string; type: string; domainType: DomainType | null }>();
  for (const p of input.pages) {
    const dt = domainTypeOf(p.host, input.kinds);
    const pt = pageTypeOf(`https://${p.page}`, p.page, input.reads.get(p.page)?.title ?? null, dt, input.kinds);
    // A type the rules did not settle was written by a model, and says so (spec 10 section 2.6).
    const auto = (label: string, mine: string | null, rule: string | null) => (mine !== null && mine !== rule ? `${label}, ${CLASSIFIED_LABEL}` : label);
    const ruleD = domainTypeByRule(p.host);
    const ruleP = pageTypeByRule(`https://${p.page}`, input.reads.get(p.page)?.title ?? null, dt);
    kinds.set(p.page, { kind: dt ? auto(DOMAIN_TYPE_LABEL[dt], dt, ruleD) : NOT_CLASSIFIED, type: pt ? auto(PAGE_TYPE_LABEL[pt], pt, ruleP) : NOT_CLASSIFIED, domainType: dt });
  }
  // Pages cited in an answer that named another brand, in the range.
  const othersNamed = new Set<string>();
  for (const a of input.answers) {
    if (a.answered === false || a.run_date < input.range.from || a.run_date > input.range.to) continue;
    if (!brandsRead(a) || a.brands.length === 0) continue;
    for (const c of a.citations) {
      const k = citationKey(c);
      if (k) othersNamed.add(k.key);
    }
  }
  const leaves = new Set<string>();
  const unreadable = new Map<string, string>();
  for (const p of input.pages) {
    const f = input.reads.get(p.page);
    if (f && f.status !== "ok") unreadable.set(p.page, couldNotRead(f));
    if (f?.status === "ok" && f.namesClient === false && othersNamed.has(p.page) && !input.placedKeys.has(p.page)) leaves.add(p.page);
  }
  const opps = new Map<string, string>();
  for (const o of input.rows) if (AI_CITED_LENSES.includes(o.lens) && !input.placedKeys.has(o.urlKey) && !opps.has(o.urlKey)) opps.set(o.urlKey, o.id);
  return { kinds, leaves, opps, unreadable };
}

/** The type keys Cited pages needs from source_kinds, for these pages. */
export function citedKindKeys(pages: readonly { page: string; host: string }[]): string[] {
  return [...new Set(pages.flatMap((p) => [domainKey(p.host), pageKey(p.page)]))];
}
