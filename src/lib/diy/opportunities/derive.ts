import type { SupabaseClient } from "@supabase/supabase-js";

import { brandKey, domainStem } from "../../scan/brand-name.ts";
import { knownKind } from "../../scan/source-kinds.ts";
import { selectAll } from "../../supabase/page.ts";
import { addDays, brandsRead, citedPage, type Day } from "../../tracking/figures.ts";

import { bare, domainKey, domainTypeByRule, isEngineProperty, pageKey, pageTypeByRule } from "./classify-rules.ts";
import { type OrderKey, orderKey } from "./order.ts";
import { lensFor, routeFor } from "./routes.ts";
import { type DomainType, EMPTY_EVIDENCE, type KindRow, LIST_TYPES, type Lens, type OppEvidence, type PageFacts, type PageType, type Route, fitsRow } from "./types.ts";

/**
 * The AI-cited opportunity engine's derivation (13 Oct 2026, DIY P7; spec 10
 * section 6.2): from what we already hold - the last 28 days of answers and
 * their citations, the prompts' clusters, Google's top 10 for each cluster
 * keyword, the page reads and the cached types - to the rows the
 * `opportunity_refresh` job writes. Pure; nothing here reads a table except
 * `excludeNomadaPlacements`'s reader at the foot.
 *
 * Steps, as the spec numbers them:
 *
 * 1. **Collect** each cited page (figures.ts citedPage: host and path, the
 *    key Cited pages counts by) not on the client's domain.
 * 2. **Exclude**, silently: the engines' own properties; government,
 *    academic and the other sites the scan's tables settle as not a place
 *    for anyone (source-kinds.ts knownKind "other"), except community sites,
 *    which are threads; **every page where Nomada has placed any other
 *    client**, whatever that placement's status (`placedKeys`): no row, no
 *    label, in no count; and **competitor-owned pages**: a domain whose
 *    brand key matches a brand the engines named in at least 3 answers to
 *    this client's prompts in 28 days, and whose type is `vendor` or is not
 *    classified yet. The second half fails closed: an unclassified rival's
 *    own "X vs Y" page would otherwise be listed as "Ask to be added", so it
 *    is left out until its type lands. knownKind is consulted first, so a
 *    review or government site is never a competitor; a `platform` (the
 *    AGENTS.md Shopify case) is not one either.
 * 3. **Qualify** a cited page: cited on 2 or more days of the last 14, and
 *    not known to name the client - the page read's verdict when there is
 *    one, else every answer citing it in the 28 days left the client out and
 *    named at least one other brand. A comparison or alternatives page that
 *    names the client while every answer citing it leaves the client out
 *    qualifies too, as "Send a correction".
 * 4. **lists**: Google's top 10 for a cluster keyword at its latest reading,
 *    page type best_of, comparison or alternatives, not the client's, not a
 *    competitor's, not known to name the client, and not already an AI-cited
 *    row.
 * 5. **threads and profiles** by route (routes.ts).
 * 6. **own**: per cluster, when its cited and top-10 pages are best-of lists,
 *    comparisons or alternatives and the client has no page of that type, a
 *    `publish_own` row; when it has one that is neither cited nor in the
 *    top 5, `refresh_own` on that page.
 * 7. **Cluster**: the cluster whose prompts produced the most citing
 *    answers; ties to the higher keyword volume.
 * 8. **Evidence**: types.ts OppEvidence, our counts only.
 *
 * A page whose address or key is longer than a row holds (types.ts URL_MAX)
 * is skipped and counted (`tooLong`, in the night's note), never written cut
 * short (13 Oct 2026, review of DIY P7).
 */

export const WINDOW_DAYS = 28;
export const QUALIFY_DAYS = 14;
export const QUALIFY_MIN_DAYS = 2;
/** A brand named in this many answers in the window is a competitor (section 6.2 step 2). */
export const COMPETITOR_MIN = 3;
const PROMPTS_KEPT = 20;
const COMPETITORS_KEPT = 5;

export type DeriveAnswer = {
  run_date: Day;
  question_id: string;
  engine: string;
  answered: boolean;
  named: boolean;
  brands: string[];
  brands_ok?: boolean;
  citations: { source_domain: string; url: string | null }[];
};

export type SerpTop = { keyword_id: string; run_date: Day; top: { rank: number; url: string | null; domain?: string | null }[] };

export type DeriveInput = {
  domain: string;
  today: Day;
  /** The tier's engines, in order: evidence lists engines this way. */
  engines: readonly string[];
  answers: readonly DeriveAnswer[];
  questions: readonly { id: string; cluster_id: string | null; stopped_on?: Day | null }[];
  clusters: readonly { id: string; keyword_id: string | null; stopped_on?: Day | null }[];
  keywords: readonly { id: string; keyword: string; search_volume: number | null }[];
  serpTop: readonly SerpTop[];
  reads: ReadonlyMap<string, PageFacts>;
  kinds: ReadonlyMap<string, Pick<KindRow, "domain_type" | "page_type" | "set_by">>;
  /** Every placement url_key of every other client, any status (`readPlacedKeys`). */
  placedKeys: ReadonlySet<string>;
  /** The client's key pages (P8, read tolerant: empty while the table is absent), with the clusters each serves. */
  keyPages: readonly { url: string; clusterIds: readonly string[] }[];
};

export type Derived = {
  lens: Lens;
  url: string;
  urlKey: string;
  domain: string;
  clusterId: string | null;
  route: Route;
  pageType: PageType | null;
  domainType: DomainType | null;
  title: string | null;
  evidence: OppEvidence;
  orderKey: OrderKey;
};

/** A page the rules left untyped, for the classify job: what it is sent is ours to send (no body text, section 8.1). */
export type Unclassified = { urlKey: string; url: string; domain: string; title: string | null; h1: string | null; headings: string[]; needs: ("domain" | "page")[] };

export type DeriveResult = {
  rows: Derived[];
  /** Types the rules settled this run, for source_kinds (set_by 'rule'). */
  ruleKinds: KindRow[];
  unclassified: Unclassified[];
  /** Competitor brands this window, by key, with the spelling most named. */
  competitors: Map<string, { name: string; answers: number }>;
  /** Pages skipped because their address or key is longer than a row holds. */
  tooLong: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a host is the client's own domain or under it. */
export function isOwnHost(host: string, domain: string): boolean {
  const h = bare(host);
  const d = bare(domain);
  return h === d || h.endsWith(`.${d}`);
}

/** Brands named in at least COMPETITOR_MIN answers in the window, counted over answers whose brands were read. */
export function competitorBrands(answers: readonly DeriveAnswer[], from: Day, to: Day, min = COMPETITOR_MIN): Map<string, { name: string; answers: number }> {
  const tally = new Map<string, { names: Map<string, number>; answers: number }>();
  for (const a of answers) {
    if (!a.answered || a.run_date < from || a.run_date > to || !brandsRead(a)) continue;
    const seen = new Set<string>();
    for (const b of a.brands) {
      const k = brandKey(b);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const t = tally.get(k) ?? { names: new Map(), answers: 0 };
      t.answers++;
      t.names.set(b, (t.names.get(b) ?? 0) + 1);
      tally.set(k, t);
    }
  }
  const out = new Map<string, { name: string; answers: number }>();
  for (const [k, t] of tally) {
    if (t.answers < min) continue;
    const name = [...t.names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    out.set(k, { name, answers: t.answers });
  }
  return out;
}

/** A domain's type: the rule's, else the model's from source_kinds; null while it is not classified. */
export function domainTypeOf(host: string, kinds: DeriveInput["kinds"]): DomainType | null {
  return domainTypeByRule(host) ?? kinds.get(domainKey(host))?.domain_type ?? null;
}

/** A page's type: the rule's (from its URL and read title), else the model's; null while it is not classified. */
export function pageTypeOf(url: string, urlKey: string, title: string | null, domainType: DomainType | null, kinds: DeriveInput["kinds"]): PageType | null {
  return pageTypeByRule(url, title, domainType) ?? kinds.get(pageKey(urlKey))?.page_type ?? null;
}

/**
 * Whether a domain is a competitor's (section 6.2 step 2): its brand key is a
 * competitor brand's, it is not a site the scan's tables already settle, and
 * its type is `vendor` or not classified yet (fail closed).
 */
export function isCompetitorDomain(host: string, competitors: ReadonlyMap<string, unknown>, kinds: DeriveInput["kinds"]): boolean {
  const h = bare(host);
  if (knownKind(h)) return false;
  const stem = domainStem(h);
  if (!stem || !competitors.has(stem)) return false;
  if (domainTypeByRule(h)) return false;
  const t = kinds.get(domainKey(h))?.domain_type ?? null;
  return t === null || t === "vendor";
}

/** Whether a host is left out of every list before anything else is asked: the engines', and the sites settled as no place for anyone. */
export function isExcludedHost(host: string): boolean {
  const h = bare(host);
  if (isEngineProperty(h)) return true;
  const known = knownKind(h);
  if (known?.kind === "other") return domainTypeByRule(h) !== "community";
  return false;
}

type Agg = {
  url: string;
  host: string;
  answers: number;
  named: number;
  others: number;
  prompts: Set<string>;
  engines: Set<string>;
  days: Set<Day>;
  brands: Map<string, { name: string; n: number }>;
  clusters: Map<string, number>;
  last: Day;
  open: { prompt: string; day: Day; engine: string } | null;
};

/** One citation's page key and host, as Cited pages keys it; null when it has no host. */
export function citationKey(c: { source_domain: string; url: string | null }): { key: string; host: string; url: string } | null {
  let source = c.source_domain;
  if (!source && c.url) {
    // A key page or a SERP row may carry only its URL: its host is the URL's.
    try {
      source = new URL(c.url).hostname;
    } catch {
      return null;
    }
  }
  const p = citedPage({ source_domain: source, url: c.url });
  if (!p) return null;
  // Only a web address is ever kept as a page's URL: anything else (a javascript: or data: link in an answer) is its host's homepage.
  const web = typeof c.url === "string" && /^https?:\/\//i.test(c.url);
  return { key: p.page, host: p.host, url: web ? c.url! : `https://${p.host}/` };
}

const tierOrder = (engines: readonly string[]) => (e: string) => {
  const i = engines.indexOf(e);
  return i < 0 ? engines.length : i;
};

/** The aggregate of every page cited in the window, by page key. Answers on the client's own domain are kept apart. */
export function aggregateCitations(input: Pick<DeriveInput, "answers" | "questions" | "today" | "domain" | "engines">): { pages: Map<string, Agg>; own: Map<string, Set<string>> } {
  const from = addDays(input.today, -(WINDOW_DAYS - 1));
  const cluster = new Map(input.questions.map((q) => [q.id, q.cluster_id]));
  const rank = tierOrder(input.engines);
  const pages = new Map<string, Agg>();
  /** Own pages cited, by key, with the clusters whose prompts cited them. */
  const own = new Map<string, Set<string>>();
  for (const a of input.answers) {
    if (!a.answered || a.run_date < from || a.run_date > input.today) continue;
    const keys = new Map<string, { host: string; url: string }>();
    for (const c of a.citations) {
      const k = citationKey(c);
      if (k && !keys.has(k.key)) keys.set(k.key, { host: k.host, url: k.url });
    }
    for (const [key, { host, url }] of keys) {
      const cl = cluster.get(a.question_id) ?? null;
      if (isOwnHost(host, input.domain)) {
        const s = own.get(key) ?? new Set<string>();
        if (cl) s.add(cl);
        own.set(key, s);
        continue;
      }
      const g = pages.get(key) ?? { url, host, answers: 0, named: 0, others: 0, prompts: new Set(), engines: new Set(), days: new Set(), brands: new Map(), clusters: new Map(), last: a.run_date, open: null };
      g.answers++;
      if (a.named) g.named++;
      else {
        if (brandsRead(a) && a.brands.length > 0) g.others++;
        for (const b of brandsRead(a) ? a.brands : []) {
          const bk = brandKey(b);
          if (!bk) continue;
          const t = g.brands.get(bk) ?? { name: b, n: 0 };
          t.n++;
          g.brands.set(bk, t);
        }
        const at = { prompt: a.question_id, day: a.run_date, engine: a.engine };
        if (!g.open || a.run_date > g.open.day || (a.run_date === g.open.day && rank(a.engine) < rank(g.open.engine))) g.open = at;
      }
      g.prompts.add(a.question_id);
      g.engines.add(a.engine);
      g.days.add(a.run_date);
      if (a.run_date > g.last) g.last = a.run_date;
      if (cl) g.clusters.set(cl, (g.clusters.get(cl) ?? 0) + 1);
      pages.set(key, g);
    }
  }
  return { pages, own };
}

/** The latest top-10 reading per cluster keyword within the window. */
export function latestTops(serpTop: readonly SerpTop[], today: Day): Map<string, SerpTop> {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const out = new Map<string, SerpTop>();
  for (const s of serpTop) {
    if (!DAY_RE.test(s.run_date) || s.run_date < from || s.run_date > today || !Array.isArray(s.top)) continue;
    const had = out.get(s.keyword_id);
    if (!had || s.run_date > had.run_date) out.set(s.keyword_id, s);
  }
  return out;
}

/** The cluster with the most citing answers; ties to the higher keyword volume, then the lower id. */
function pickCluster(counts: ReadonlyMap<string, number>, volume: (clusterId: string) => number): string | null {
  let best: string | null = null;
  for (const [id, n] of counts) {
    if (best === null) {
      best = id;
      continue;
    }
    const bn = counts.get(best)!;
    if (n > bn || (n === bn && (volume(id) > volume(best) || (volume(id) === volume(best) && id < best)))) best = id;
  }
  return best;
}

export function derive(input: DeriveInput): DeriveResult {
  const from = addDays(input.today, -(WINDOW_DAYS - 1));
  const from14 = addDays(input.today, -(QUALIFY_DAYS - 1));
  const from7 = addDays(input.today, -6);
  const competitors = competitorBrands(input.answers, from, input.today);
  const liveClusters = input.clusters.filter((c) => (c.stopped_on ?? null) === null);
  const kw = new Map(input.keywords.map((k) => [k.id, k]));
  const clusterKeyword = new Map(liveClusters.map((c) => [c.id, c.keyword_id ? (kw.get(c.keyword_id) ?? null) : null]));
  const keywordCluster = new Map(liveClusters.filter((c) => c.keyword_id).map((c) => [c.keyword_id!, c.id]));
  const volume = (clusterId: string) => clusterKeyword.get(clusterId)?.search_volume ?? 0;
  const tops = latestTops(input.serpTop, input.today);

  // Google's top 10 at each cluster keyword's latest reading, by page: the best rank and its keyword.
  const ranked = new Map<string, { rank: number; keywordId: string; url: string; host: string }>();
  for (const [keywordId, s] of tops) {
    if (!keywordCluster.has(keywordId)) continue;
    for (const r of s.top) {
      if (!(r.rank >= 1 && r.rank <= 10)) continue;
      const k = citationKey({ source_domain: r.domain ?? "", url: r.url });
      if (!k) continue;
      const had = ranked.get(k.key);
      const better = !had || r.rank < had.rank || (r.rank === had.rank && (kw.get(keywordId)?.search_volume ?? 0) > (kw.get(had.keywordId)?.search_volume ?? 0));
      if (better) ranked.set(k.key, { rank: r.rank, keywordId, url: k.url, host: k.host });
    }
  }

  const { pages, own } = aggregateCitations(input);
  const rows: Derived[] = [];
  const ruleKinds = new Map<string, KindRow>();
  const unclassified = new Map<string, Unclassified>();
  const noteRule = (host: string, url: string, urlKey: string, title: string | null) => {
    const dt = domainTypeByRule(host);
    if (dt) ruleKinds.set(domainKey(host), { key: domainKey(host), level: "domain", domain_type: dt, page_type: null, set_by: "rule" });
    const pt = pageTypeByRule(url, title, dt);
    if (pt) ruleKinds.set(pageKey(urlKey), { key: pageKey(urlKey), level: "page", domain_type: null, page_type: pt, set_by: "rule" });
  };
  const askModel = (host: string, url: string, urlKey: string) => {
    const read = input.reads.get(urlKey) ?? null;
    const needs: ("domain" | "page")[] = [];
    if (!domainTypeOf(host, input.kinds)) needs.push("domain");
    if (!pageTypeOf(url, urlKey, read?.title ?? null, domainTypeOf(host, input.kinds), input.kinds)) needs.push("page");
    if (needs.length && !unclassified.has(urlKey)) unclassified.set(urlKey, { urlKey, url, domain: bare(host), title: read?.title ?? null, h1: read?.h1 ?? null, headings: (read?.headings ?? []).slice(0, 8), needs });
  };
  const rankOf = (key: string) => {
    const r = ranked.get(key);
    return r ? { rank: r.rank, keyword: kw.get(r.keywordId)?.keyword ?? null } : { rank: null, keyword: null };
  };
  const excluded = (host: string, key: string) => isExcludedHost(host) || input.placedKeys.has(key) || isCompetitorDomain(host, competitors, input.kinds);
  const aiCited = new Set<string>();

  // Steps 1-3, 5, 7, 8: the pages the engines cite.
  const long = new Set<string>();
  const fits = (url: string, key: string) => {
    if (fitsRow(url, key)) return true;
    long.add(key);
    return false;
  };
  for (const [key, g] of pages) {
    if (isExcludedHost(g.host) || input.placedKeys.has(key)) continue;
    const days14 = [...g.days].filter((d) => d >= from14).length;
    if (days14 < QUALIFY_MIN_DAYS) continue;
    if (!fits(g.url, key)) continue;
    // Typed before the competitor rule, so an unclassified rival-looking domain is sent to be classified and can come back.
    noteRule(g.host, g.url, key, input.reads.get(key)?.title ?? null);
    askModel(g.host, g.url, key);
    if (isCompetitorDomain(g.host, competitors, input.kinds)) continue;
    const read = input.reads.get(key) ?? null;
    const verdict = read && read.status === "ok" ? read.namesClient : null;
    const leavesAll = g.named === 0 && g.answers > 0;
    const domainType = domainTypeOf(g.host, input.kinds);
    const pageType = pageTypeOf(g.url, key, read?.title ?? null, domainType, input.kinds);
    const route = routeFor({ pageType, domainType, namesClient: verdict, leavesAll });
    const qualifies = verdict === false || (verdict === null && leavesAll && g.others === g.answers) || route === "send_correction";
    if (!qualifies) continue;
    const lens = lensFor(route);
    if (!lens) continue;
    const r = rankOf(key);
    const clusterId = pickCluster(g.clusters, volume);
    const evidence: OppEvidence = {
      to: input.today,
      answers: g.answers,
      leaves_out: g.answers - g.named,
      others_named: g.others,
      prompts: [...g.prompts].sort().slice(0, PROMPTS_KEPT),
      prompt_count: g.prompts.size,
      engines: [...g.engines].sort((a, b) => tierOrder(input.engines)(a) - tierOrder(input.engines)(b)),
      competitors: [...g.brands.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, COMPETITORS_KEPT).map((b) => b.name),
      days_14: days14,
      days_7: [...g.days].filter((d) => d >= from7).length,
      last_cited: g.last,
      rank: r.rank,
      keyword: r.keyword,
      open: g.open,
    };
    aiCited.add(key);
    rows.push({ lens, url: g.url, urlKey: key, domain: g.host, clusterId, route, pageType, domainType, title: read?.title ?? null, evidence, orderKey: orderKey(evidence, pageType, null) });
  }

  // Step 4: best-of lists, comparisons and alternatives in Google's top 10.
  for (const [key, r] of ranked) {
    if (aiCited.has(key) || isOwnHost(r.host, input.domain)) continue;
    if (isExcludedHost(r.host) || input.placedKeys.has(key)) continue;
    if (!fits(r.url, key)) continue;
    const read = input.reads.get(key) ?? null;
    noteRule(r.host, r.url, key, read?.title ?? null);
    askModel(r.host, r.url, key);
    if (excluded(r.host, key)) continue;
    if (read && read.status === "ok" && read.namesClient === true) continue;
    const domainType = domainTypeOf(r.host, input.kinds);
    const pageType = pageTypeOf(r.url, key, read?.title ?? null, domainType, input.kinds);
    if (!pageType || !LIST_TYPES.includes(pageType)) continue;
    const route = routeFor({ pageType, domainType, namesClient: read?.status === "ok" ? read.namesClient : null, leavesAll: false });
    if (route === "leave_it") continue;
    const evidence: OppEvidence = { ...EMPTY_EVIDENCE(input.today), rank: r.rank, keyword: kw.get(r.keywordId)?.keyword ?? null };
    rows.push({ lens: "lists", url: r.url, urlKey: key, domain: r.host, clusterId: keywordCluster.get(r.keywordId) ?? null, route, pageType, domainType, title: read?.title ?? null, evidence, orderKey: orderKey(evidence, pageType, null) });
  }

  // Step 6: the client's own pages, per cluster.
  for (const c of liveClusters) {
    const keyword = clusterKeyword.get(c.id) ?? null;
    if (!keyword) continue;
    const prompts = new Set(input.questions.filter((q) => q.cluster_id === c.id && (q.stopped_on ?? null) === null).map((q) => q.id));
    const seen = new Map<PageType, number>();
    const count = (pt: PageType | null) => {
      if (pt && LIST_TYPES.includes(pt)) seen.set(pt, (seen.get(pt) ?? 0) + 1);
    };
    for (const [key, g] of pages) {
      if (!(g.clusters.get(c.id) ?? 0) || excluded(g.host, key)) continue;
      if (![...g.prompts].some((p) => prompts.has(p))) continue;
      count(pageTypeOf(g.url, key, input.reads.get(key)?.title ?? null, domainTypeOf(g.host, input.kinds), input.kinds));
    }
    const top = c.keyword_id ? tops.get(c.keyword_id) : undefined;
    const mineRanked: { url: string; key: string; rank: number }[] = [];
    for (const r of top?.top ?? []) {
      const k = citationKey({ source_domain: r.domain ?? "", url: r.url });
      if (!k) continue;
      if (isOwnHost(k.host, input.domain)) {
        mineRanked.push({ url: k.url, key: k.key, rank: r.rank });
        continue;
      }
      if (r.rank > 10 || excluded(k.host, k.key)) continue;
      count(pageTypeOf(k.url, k.key, input.reads.get(k.key)?.title ?? null, domainTypeOf(k.host, input.kinds), input.kinds));
    }
    const wanted = [...seen].sort((a, b) => b[1] - a[1] || LIST_TYPES.indexOf(a[0]) - LIST_TYPES.indexOf(b[0]))[0];
    if (!wanted) continue;
    const [type, n] = wanted;
    // The client's pages for this cluster: cited for its prompts, ranking for its keyword, or a key page serving it.
    const mine = new Map<string, { url: string; cited: boolean; rank: number | null }>();
    for (const [key, clusters] of own) if (clusters.has(c.id)) mine.set(key, { url: `https://${key}`, cited: true, rank: null });
    for (const r of mineRanked) {
      const had = mine.get(r.key);
      mine.set(r.key, { url: had?.url ?? r.url, cited: had?.cited ?? false, rank: had?.rank !== null && had?.rank !== undefined ? Math.min(had.rank, r.rank) : r.rank });
    }
    for (const p of input.keyPages) {
      if (!p.clusterIds.includes(c.id)) continue;
      const k = citationKey({ source_domain: "", url: p.url });
      if (k && !mine.has(k.key)) mine.set(k.key, { url: p.url, cited: false, rank: null });
    }
    const ofType = [...mine].filter(([, m]) => pageTypeByRule(m.url) === type);
    const base: OppEvidence = { ...EMPTY_EVIDENCE(input.today), keyword: keyword.keyword, own_type: type, own_seen: n };
    if (!ofType.length) {
      const evidence = base;
      rows.push({ lens: "own", url: `https://${bare(input.domain)}/`, urlKey: `own:${c.id}:${type}`, domain: bare(input.domain), clusterId: c.id, route: "publish_own", pageType: type, domainType: null, title: null, evidence, orderKey: orderKey(evidence, type, null) });
      continue;
    }
    if (ofType.some(([, m]) => m.cited || (m.rank !== null && m.rank <= 5))) continue;
    const [key, m] = ofType[0]!;
    if (!fits(m.url, key)) continue;
    const evidence: OppEvidence = { ...base, rank: m.rank };
    rows.push({ lens: "own", url: m.url, urlKey: key, domain: bare(input.domain), clusterId: c.id, route: "refresh_own", pageType: type, domainType: null, title: null, evidence, orderKey: orderKey(evidence, type, null) });
  }

  return { rows, ruleKinds: [...ruleKinds.values()], unclassified: [...unclassified.values()], competitors, tooLong: long.size };
}

/** What the cited pages in the window say about naming the client: the Opportunities empty state's facts. */
export type CitedSummary = {
  /** Pages on other sites cited in the 28 days (the engines' own properties aside), whoever's they are. */
  pages: number;
  /** Of those, the pages whose latest read could see them and found the client named. */
  readNamingYou: number;
  /** The client's own pages cited. */
  own: number;
};

/**
 * Whether every page the engines cite names the client, as far as we know it
 * (13 Oct 2026, review of DIY P7). Only a read decides that a page names the
 * client: an answer that names the client says nothing about the page it
 * cites, and a page never read is not known to. Every other site's page
 * counts - a competitor's, an institution's, one where Nomada has placed
 * another client - since "every page names you" is false while any of them
 * does not; none of them is named or counted on the page. Pure.
 */
export function citedSummary(input: Pick<DeriveInput, "answers" | "questions" | "today" | "domain" | "engines">, reads: ReadonlyMap<string, PageFacts>): CitedSummary {
  const { pages, own } = aggregateCitations(input);
  let n = 0;
  let naming = 0;
  for (const [key, g] of pages) {
    if (isEngineProperty(bare(g.host))) continue;
    n++;
    const r = reads.get(key);
    if (r?.status === "ok" && r.namesClient === true) naming++;
  }
  return { pages: n, readNamingYou: naming, own: own.size };
}

/**
 * First cited after pursuing (section 6.2 step 9): per engine, the first day
 * after `pursuedOn` an answer cited the page, and the prompt it answered.
 * Engines already recorded keep their day: a first is first once.
 */
export function firstCitedAfter(answers: readonly DeriveAnswer[], urlKey: string, pursuedOn: Day, had: Record<string, { day: Day; prompt: string }> | null = null): Record<string, { day: Day; prompt: string }> {
  const out: Record<string, { day: Day; prompt: string }> = { ...(had ?? {}) };
  for (const a of [...answers].sort((x, y) => x.run_date.localeCompare(y.run_date) || x.question_id.localeCompare(y.question_id))) {
    if (!a.answered || a.run_date <= pursuedOn || out[a.engine]) continue;
    if (a.citations.some((c) => citationKey(c)?.key === urlKey)) out[a.engine] = { day: a.run_date, prompt: a.question_id };
  }
  return out;
}

// ---- Nomada's placements for other clients (section 6.2 step 2). ----

/** The rows to keep: every row whose page is not another client's placement. Never the matches. */
export function withoutPlaced<T extends { urlKey: string }>(rows: readonly T[], placedKeys: ReadonlySet<string>): T[] {
  return rows.filter((r) => !placedKeys.has(r.urlKey));
}

/**
 * Every placement url_key of every client but this one, whatever its status
 * (pitched, writing, scheduled, live or removed). Only the key is read, and
 * only to subtract. Paged; a failed read throws, and the caller fails closed
 * (a list it cannot subtract from is not shown).
 */
export async function readPlacedKeys(db: SupabaseClient, clientId: string): Promise<Set<string>> {
  const rows = await selectAll<{ url_key: string | null }>((lo, hi) => db.from("placements").select("url_key").neq("client_domain_id", clientId).order("id", { ascending: true }).range(lo, hi));
  return new Set(rows.map((r) => r.url_key).filter((k): k is string => typeof k === "string" && k.length > 0));
}

/**
 * The rows to keep after subtracting every page where Nomada has placed any
 * other client (spec 7.8: `excludeNomadaPlacements(rows, clientId)`). The
 * keys are read through `read` - Supabase's, or the fixture's - and a read
 * that fails throws: a list that could not be checked is not a list to show.
 */
export async function excludeNomadaPlacements<T extends { urlKey: string }>(rows: readonly T[], clientId: string, read: (clientId: string) => Promise<ReadonlySet<string>>): Promise<T[]> {
  return withoutPlaced(rows, await read(clientId));
}
