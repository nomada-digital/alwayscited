import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, formatDay } from "../../tracking/figures.ts";
import type { DiyClient } from "../core/client.ts";
import type { Candidate, CandidateSource } from "../plan/types.ts";
import { readBots, readChecks, readSerp, readTop } from "./data.ts";
import { readKeyPages } from "./key-pages.ts";
import { raisesBlocking } from "./robots.ts";
import { type Cluster, type Keyword, type PagesInput, checksOf, clusterFits, pageState, pathOf } from "./view.ts";
import type { BotCheck, KeyPage, PageCheck } from "./types.ts";

/**
 * Your pages' candidates for Actions (13 Oct 2026, DIY P8; spec 10 section
 * 6.1): P8 is the sole owner of three severities' page rows.
 *
 * - **Blocking.** Googlebot - or another crawler once its vendor source says
 *   it serves search or answers and is verified - is blocked from a key page
 *   by robots.txt. Or a key page answers non-200, carries noindex, or has a
 *   canonical pointing elsewhere, held on its last two weekly reads.
 * - **Closest win.** A cluster keyword at 4-10, then 11-20, at its latest
 *   reading; the volume breaks a tie (Actions orders by it). The route follows
 *   the page's fit: Fits sends the client to the best-of lists ranking for the
 *   keyword (Opportunities' lists lens); a different page type reworks the
 *   page; no page picks one; two pages taking turns resolves the split.
 * - **Tidy-up.** A schema error, or Organization missing from the homepage.
 *
 * Each candidate's dedupe key is stable across runs (`pages:<what>:<id>`), so
 * the weekly pick and the route's "Add to Actions" write the same item.
 * Hrefs are client paths, resolved with appPath when drawn (plan/types.ts).
 */

export type GatherInput = Omit<PagesInput, "examples" | "items" | "cited" | "prompts"> & { prompts?: PagesInput["prompts"] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pathLabel = (domain: string, url: string) => `${domain.replace(/^www\./, "")}${pathOf(url) === "/" ? "" : pathOf(url)}`;

/** Two weekly reads in a row that agree a page is not fit to index (held, not glimpsed). */
function heldStatus(own: readonly PageCheck[], page: KeyPage): { line: string } | null {
  const [a, b] = own;
  if (!a || !b) return null;
  const bad = (c: PageCheck): string | null => {
    if (c.httpStatus !== null && (c.httpStatus < 200 || c.httpStatus >= 300)) return `answers HTTP ${c.httpStatus}`;
    if (c.status !== "ok") return null;
    if (c.basics?.noindex) return "carries noindex";
    const canon = c.basics?.canonical;
    if (canon) {
      try {
        const u = new URL(canon);
        const key = `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
        if (key !== page.urlKey) return "has a canonical pointing elsewhere";
      } catch {
        return null;
      }
    }
    return null;
  };
  const x = bad(a);
  return x && x === bad(b) ? { line: x } : null;
}

export function pageCandidates(input: GatherInput, today: Day): Candidate[] {
  const out: Candidate[] = [];
  const full: PagesInput = { ...input, prompts: input.prompts ?? [], examples: [], items: [], cited: new Map() };
  const live = input.keyPages.filter((p) => p.removedOn === null);
  const bot: BotCheck | undefined = input.bots[0];
  const domain = input.domain;

  // Blocking: crawlers whose block raises one (raisesBlocking), one item per crawler.
  for (const v of bot?.crawlers ?? []) {
    if (v.state === "allowed" || !raisesBlocking(v.name)) continue;
    const pages = live.filter((p) => v.blocked.includes(pathOf(p.url)));
    if (!pages.length) continue;
    out.push({
      dedupeKey: `pages:crawler:${v.name.toLowerCase()}`,
      kind: "unblock_crawler",
      severity: "blocking",
      clusterId: null,
      title: pages.length === 1 ? `Let ${v.name} crawl ${pathLabel(domain, pages[0]!.url)}` : `Let ${v.name} crawl ${pages.length} of your key pages`,
      why: [{ text: `robots.txt ${v.line ? `line '${v.line}' ` : ""}blocks ${v.name} from ${plural(pages.length, "key page", "key pages")} of ${live.length} (checked ${formatDay(bot!.checkedAt.slice(0, 10))}).`, href: "/pages?view=bots" }],
      grade: "documented",
      sourceId: "S41",
      effort: "minutes",
      href: "/pages?view=bots",
      ref: pages.length === 1 ? { table: "key_pages", id: pages[0]!.id } : undefined,
      evidenceOn: bot!.checkedAt.slice(0, 10),
    });
  }
  // Blocking: a key page not fit to index on its last two weekly reads.
  for (const page of live) {
    const held = heldStatus(checksOf(input.checks, page, "own"), page);
    if (!held) continue;
    out.push({
      dedupeKey: `pages:status:${page.id}`,
      kind: "fix_page_status",
      severity: "blocking",
      clusterId: page.clusterIds[0] ?? null,
      title: `Fix ${pathLabel(domain, page.url)}: it ${held.line}`,
      why: [{ text: `Your page ${held.line} on its last two weekly checks.`, href: `/pages/${page.id}?tab=basics` }],
      grade: "your_data",
      effort: "hour",
      href: `/pages/${page.id}?tab=basics`,
      ref: { table: "key_pages", id: page.id },
    });
  }
  // Closest win and Tidy-up, per page.
  for (const page of live) {
    const s = pageState(page, full);
    for (const f of clusterFits(s, full)) {
      const last = f.serp?.readings[f.serp.readings.length - 1];
      if (!last || last.position === null || last.position < 4 || last.position > 20 || !f.keyword) continue;
      const kw = f.keyword.keyword;
      const at = `'${kw}' read #${last.position} on ${formatDay(last.day)}.`;
      const base = { severity: "closest" as const, clusterId: f.cluster.id, grade: "your_data" as const, volume: f.keyword.volume ?? undefined, evidenceOn: last.day, ref: { table: "key_pages", id: page.id } };
      const v = f.verdict;
      if (v.kind === "fits") {
        out.push({ ...base, dedupeKey: `pages:closest:${f.cluster.id}`, kind: "get_onto_page", title: `Get onto the best-of lists ranking for '${kw}'`, why: [{ text: at, href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` }, { text: "Your page matches what ranks for it.", href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` }], effort: "days", href: `/opportunities?lens=lists&cluster=${f.cluster.id}` });
      } else if (v.kind === "no_page" || v.kind === "out") {
        out.push({ ...base, dedupeKey: `pages:closest:${f.cluster.id}`, kind: "pick_target_page", title: `Pick the page you want to rank for '${kw}'`, why: [{ text: at, href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` }], effort: "hour", href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` });
      } else if (v.kind === "split") {
        out.push({ ...base, dedupeKey: `pages:closest:${f.cluster.id}`, kind: "resolve_split", title: `Pick one page for '${kw}'`, why: [{ text: at }, { text: `${v.held.length} of your pages took turns at it in its last ${v.readings} readings.`, href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` }], effort: "hour", href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` });
      } else if (v.kind !== "none_read") {
        out.push({ ...base, dedupeKey: `pages:closest:${f.cluster.id}`, kind: "rework_page", title: `Rework ${pathLabel(domain, page.url)} for '${kw}'`, why: [{ text: at, href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` }], effort: "days", href: `/pages/${page.id}?tab=fit&cluster=${f.cluster.id}` });
      }
    }
    const tidy = s.findings.filter((x) => x.id === "pages.schema.validator" || (x.id === "pages.schema.organization" && s.homepage));
    for (const x of tidy) {
      const org = x.id === "pages.schema.organization";
      out.push({
        dedupeKey: org ? `pages:schema:Organization:${page.id}` : `pages:schema:errors:${page.id}`,
        kind: org ? "add_schema" : "fix_schema",
        severity: "tidy",
        clusterId: null,
        title: org ? "Add Organization schema to your homepage" : `Fix the schema errors on ${pathLabel(domain, page.url)}`,
        why: [{ text: org ? `No Organization markup in the structured data we found (checked ${formatDay(s.own!.checkedAt.slice(0, 10))}).` : `The validator found ${x.vars.n} (checked ${formatDay((s.deep ?? s.own)!.checkedAt.slice(0, 10))}).`, href: `/pages/${page.id}?tab=schema` }],
        grade: org ? "documented" : "your_data",
        ...(org ? { sourceId: "G3" } : {}),
        effort: "minutes",
        href: `/pages/${page.id}?tab=schema`,
        ref: { table: "key_pages", id: page.id },
        evidenceOn: s.own!.checkedAt.slice(0, 10),
      });
    }
  }
  return out;
}

type Structure = { clusters: Cluster[]; keywords: Keyword[] };

/** The live clusters and their keywords, read narrowly for the candidates. */
async function readStructure(db: SupabaseClient, clientId: string): Promise<Structure> {
  const [{ data: cs, error: cErr }, { data: ks, error: kErr }] = await Promise.all([
    db.from("tracked_clusters").select("id, name, keyword_id, stopped_on").eq("client_domain_id", clientId).limit(200),
    db.from("tracked_keywords").select("id, keyword, search_volume").eq("client_domain_id", clientId).limit(500),
  ]);
  if (cErr) throw new Error(`could not read the clusters: ${cErr.message}`);
  if (kErr) throw new Error(`could not read the keywords: ${kErr.message}`);
  return {
    clusters: ((cs ?? []) as Record<string, unknown>[]).map((c) => ({ id: String(c.id), name: String(c.name ?? ""), keywordId: c.keyword_id == null ? null : String(c.keyword_id), stoppedOn: c.stopped_on ? String(c.stopped_on) : null })),
    keywords: ((ks ?? []) as Record<string, unknown>[]).map((k) => ({ id: String(k.id), keyword: String(k.keyword ?? ""), volume: typeof k.search_volume === "number" ? k.search_volume : null })),
  };
}

/** Everything the candidates read, for one client. */
export async function gatherInput(db: SupabaseClient, client: Pick<DiyClient, "id" | "domain">, today: Day): Promise<GatherInput> {
  const [keyPages, checks, bots, top, structure] = await Promise.all([readKeyPages(db, client.id), readChecks(db, client.id, today), readBots(db, client.id), readTop(db, client.id), readStructure(db, client.id)]);
  const keywordIds = structure.clusters.filter((c) => c.stoppedOn === null && c.keywordId).map((c) => c.keywordId!);
  const serp = await readSerp(db, client.id, keywordIds, today);
  return { domain: client.domain, keyPages, checks, bots, top, serp, clusters: structure.clusters, keywords: structure.keywords, today };
}

/** The `pages` candidate source, for wiring.ts CANDIDATE_SOURCES (the shell registers it). */
export const pagesCandidates: CandidateSource = {
  name: "pages",
  async gather(db, client, today) {
    return pageCandidates(await gatherInput(db, client, today), today);
  },
};
