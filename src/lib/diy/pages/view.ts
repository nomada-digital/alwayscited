import { type Day, formatDay } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import type { PlanItem } from "../plan/types.ts";
import { type DiagRow, diagnostics, sharedMissing } from "./diagnostics.ts";
import { type FitVerdict, fitChip, fitVerdict } from "./fit.ts";
import { type FixBlock, buildFix } from "./fix.ts";
import { type Finding, type SchemaChip, foundTypes, schemaChip, schemaFindings, validatorErrors } from "./schema.ts";
import type { BotCheck, KeyPage, KeywordSerp, PageCheck, ReoptExample, TopStructure } from "./types.ts";

/**
 * What Your pages draws, worked out from the rows (13 Oct 2026, DIY P8; spec
 * 10 section 4.9). Pure, so the list, the detail tabs, the candidates and the
 * tests all read one rule: the chips, the site strip, the filters, each
 * page's fit per cluster, its diagnostics, its fix and its history.
 */

export type Cluster = { id: string; name: string; keywordId: string | null; stoppedOn: Day | null };
export type Keyword = { id: string; keyword: string; volume: number | null };
export type Prompt = { id: string; text: string; clusterId: string | null; stoppedOn: Day | null };

export type Tone = "good" | "warn" | "bad" | "none";
export type Chip = { label: string; tone: Tone };

export const ISSUES = ["schema", "fit", "access", "status"] as const;
export type Issue = (typeof ISSUES)[number];
export const ISSUE_LABEL: Record<Issue, string> = { schema: "Schema", fit: "Fit", access: "Access", status: "Page status" };

export const ORIGIN_LABEL = (p: KeyPage, clusterNames: (id: string) => string | null): string => {
  switch (p.origin) {
    case "homepage":
      return "Homepage";
    case "ranking": {
      const first = p.clusterIds.map(clusterNames).find((n): n is string => n !== null);
      return first ? `Ranks for '${first}'` : "Ranks for a cluster keyword";
    }
    case "cited_own":
      return "Cited by engines";
    case "relevant":
      return "Most visited (DataForSEO estimate)";
    case "member":
      return "Added by you";
  }
};

export type PagesInput = {
  domain: string;
  keyPages: readonly KeyPage[];
  checks: readonly PageCheck[];
  bots: readonly BotCheck[];
  examples: readonly ReoptExample[];
  top: readonly TopStructure[];
  serp: readonly KeywordSerp[];
  clusters: readonly Cluster[];
  keywords: readonly Keyword[];
  prompts: readonly Prompt[];
  /** Times each own page was cited in the last 28 days, by url_key. */
  cited: ReadonlyMap<string, number>;
  items: readonly PlanItem[];
  today: Day;
};

const byNewest = (a: PageCheck, b: PageCheck) => (a.checkedAt < b.checkedAt ? 1 : a.checkedAt > b.checkedAt ? -1 : 0);

/** A page's checks, newest first, of one kind or both. */
export function checksOf(checks: readonly PageCheck[], page: KeyPage, via?: PageCheck["via"]): PageCheck[] {
  return checks.filter((c) => (c.keyPageId === page.id || (c.keyPageId === null && c.urlKey === page.urlKey)) && (!via || c.via === via)).sort(byNewest);
}

export const homeKeyOf = (domain: string) => domain.toLowerCase().replace(/^www\./, "");

export function isHomepage(page: KeyPage, domain: string): boolean {
  return page.origin === "homepage" || page.urlKey === homeKeyOf(domain);
}

/** The basics pass: read, 200, indexable, its canonical its own, a title and an H1. */
export function basicsPass(c: PageCheck | null, page: KeyPage): boolean {
  if (!c || c.status !== "ok" || c.httpStatus !== 200 || !c.basics) return false;
  const b = c.basics;
  const canon = b.canonical ? urlKey(b.canonical) : null;
  return !b.noindex && (canon === null || canon === page.urlKey) && Boolean(b.title) && b.h1.length > 0;
}

export type PageState = {
  page: KeyPage;
  own: PageCheck | null;
  previousOwn: PageCheck | null;
  deep: PageCheck | null;
  homepage: boolean;
  findings: Finding[];
  schema: SchemaChip;
  schemaOk: boolean;
  basicsOk: boolean;
};

export function pageState(page: KeyPage, input: Pick<PagesInput, "checks" | "domain">): PageState {
  const own = checksOf(input.checks, page, "own");
  const deep = checksOf(input.checks, page, "instant_pages").find((c) => c.status === "ok") ?? null;
  const latest = own[0] ?? null;
  const homepage = isHomepage(page, input.domain);
  const readable = latest?.status === "ok";
  const sIn = { url: page.url, homepage, basics: readable ? latest!.basics : null, found: readable ? latest!.schemaFound : null, results: deep?.schemaResults ?? null };
  const findings = readable ? schemaFindings(sIn) : [];
  return {
    page,
    own: latest,
    previousOwn: own[1] ?? null,
    deep,
    homepage,
    findings,
    schema: schemaChip({ ...sIn, checked: latest !== null, readable }),
    schemaOk: readable && !findings.some((f) => f.level !== "info"),
    basicsOk: basicsPass(latest, page),
  };
}

/** Access (section 4.9): Allowed · Blocked for Googlebot · noindex · HTTP 404 · Canonical elsewhere · Not checked. The worst first. */
export function accessChip(s: PageState, bots: readonly BotCheck[]): Chip {
  const c = s.own;
  if (!c) return { label: "Not checked", tone: "none" };
  if (c.httpStatus !== null && (c.httpStatus < 200 || c.httpStatus >= 300)) return { label: `HTTP ${c.httpStatus}`, tone: "bad" };
  if (c.status !== "ok") return { label: "Could not read", tone: "none" };
  const bot = bots[0];
  const path = pathOf(s.page.url);
  if (bot?.crawlers.some((v) => v.name === "Googlebot" && v.blocked.includes(path))) return { label: "Blocked for Googlebot", tone: "bad" };
  if (c.basics?.noindex) return { label: "noindex", tone: "bad" };
  const canon = c.basics?.canonical ? urlKey(c.basics.canonical) : null;
  if (canon && canon !== s.page.urlKey) return { label: "Canonical elsewhere", tone: "warn" };
  return { label: "Allowed", tone: "good" };
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return "/";
  }
}

/** The clusters a page serves: its own, and for the homepage every live cluster whose keyword no other key page holds. */
export function servedClusters(page: KeyPage, input: Pick<PagesInput, "keyPages" | "clusters" | "domain">): Cluster[] {
  const live = input.clusters.filter((c) => c.stoppedOn === null);
  const mine = live.filter((c) => page.clusterIds.includes(c.id));
  if (!isHomepage(page, input.domain)) return mine;
  const held = new Set(input.keyPages.filter((k) => k.removedOn === null && k.id !== page.id).flatMap((k) => k.clusterIds));
  return live.filter((c) => mine.includes(c) || !held.has(c.id));
}

export type ClusterFit = { cluster: Cluster; keyword: Keyword | null; serp: KeywordSerp | null; verdict: FitVerdict };

const FIT_ORDER: FitVerdict["kind"][] = ["no_page", "split", "different", "out", "fix_first", "fits", "none_read"];

export function clusterFits(s: PageState, input: PagesInput): ClusterFit[] {
  const home = homeKeyOf(input.domain);
  return servedClusters(s.page, input).map((cluster) => {
    const keyword = input.keywords.find((k) => k.id === cluster.keywordId) ?? null;
    const serp = input.serp.find((x) => x.keywordId === cluster.keywordId) ?? null;
    const titles = new Map(input.top.filter((t) => t.keywordId === cluster.keywordId || t.clusterId === cluster.id).map((t) => [t.urlKey, t.title] as const));
    const verdict: FitVerdict = serp
      ? fitVerdict({ pageKey: s.page.urlKey, pageUrl: s.page.url, pageTitle: s.own?.basics?.title ?? null, homeKey: home, serp, titles, basicsPass: s.basicsOk, schemaOk: s.schemaOk })
      : { kind: "none_read" };
    return { cluster, keyword, serp, verdict };
  });
}

/** The list's one Fit chip for a page serving several clusters: the most pressing verdict among them. */
export function pageFitChip(fits: readonly ClusterFit[]): Chip {
  if (!fits.length) return { label: "Serves no cluster", tone: "none" };
  const worst = [...fits].sort((a, b) => FIT_ORDER.indexOf(a.verdict.kind) - FIT_ORDER.indexOf(b.verdict.kind))[0]!;
  return fitChip(worst.verdict);
}

/** The latest Google position among the keywords this page serves, when it is this page that holds it. */
export function pagePosition(page: KeyPage, fits: readonly ClusterFit[]): { position: number; keyword: string } | null {
  let best: { position: number; keyword: string } | null = null;
  for (const f of fits) {
    const last = f.serp?.readings[f.serp.readings.length - 1];
    if (!last || last.position === null || !last.url || urlKey(last.url) !== page.urlKey) continue;
    if (!best || last.position < best.position) best = { position: last.position, keyword: f.keyword?.keyword ?? f.cluster.name };
  }
  return best;
}

export const OPEN = ["suggested", "todo", "doing"];

/** The Actions items on one page: by reference, or by the page's own address in their link. */
export function itemsOn(page: KeyPage, items: readonly PlanItem[]): PlanItem[] {
  return items.filter((i) => (i.refTable === "key_pages" && i.refId === page.id) || (i.href ?? "").startsWith(`/pages/${page.id}`));
}

export type ListRow = {
  page: KeyPage;
  title: string | null;
  path: string;
  origin: string;
  clusters: Cluster[];
  position: { position: number; keyword: string } | null;
  /** No position for this page, while another of the client's pages holds one of its keywords at its latest reading. */
  heldElsewhere: boolean;
  cited: number;
  schema: SchemaChip;
  fit: Chip;
  access: Chip;
  checkedOn: Day | null;
  open: number;
  issues: Issue[];
};

export function listRows(input: PagesInput): ListRow[] {
  const names = (id: string) => input.clusters.find((c) => c.id === id)?.name ?? null;
  return input.keyPages
    .filter((p) => p.removedOn === null)
    .map((page) => {
      const s = pageState(page, input);
      const fits = clusterFits(s, input);
      const fit = pageFitChip(fits);
      const access = accessChip(s, input.bots);
      const issues: Issue[] = [];
      if (s.schema.tone === "warn" || s.schema.tone === "bad") issues.push("schema");
      if (fit.tone === "warn" || fit.tone === "bad") issues.push("fit");
      if (access.tone === "warn" || access.tone === "bad") issues.push("access");
      if (s.own && (s.own.status !== "ok" || s.own.httpStatus !== 200)) issues.push("status");
      return {
        page,
        title: s.own?.basics?.title ?? null,
        path: pathOf(page.url),
        origin: ORIGIN_LABEL(page, names),
        clusters: servedClusters(page, input),
        position: pagePosition(page, fits),
        heldElsewhere: fits.some((f) => {
          const last = f.serp?.readings[f.serp.readings.length - 1];
          return Boolean(last && last.position !== null && last.url && urlKey(last.url) !== page.urlKey);
        }),
        cited: input.cited.get(page.urlKey) ?? 0,
        schema: s.schema,
        fit,
        access,
        checkedOn: s.own ? s.own.checkedAt.slice(0, 10) : null,
        open: itemsOn(page, input.items).filter((i) => OPEN.includes(i.status)).length,
        issues,
      };
    })
    .sort((a, b) => (a.page.origin === "homepage" ? -1 : b.page.origin === "homepage" ? 1 : b.cited - a.cited || a.path.localeCompare(b.path)));
}

export function filterRows(rows: readonly ListRow[], f: { issue: Issue | null; cluster: string | null }): ListRow[] {
  return rows.filter((r) => (!f.issue || r.issues.includes(f.issue)) && (!f.cluster || r.clusters.some((c) => c.id === f.cluster)));
}

export type SiteStrip = {
  access: { line: string; tone: Tone } | null;
  organization: { line: string; tone: Tone } | null;
  checked: { n: number; of: number; last: Day | null };
};

/** The site strip: crawler access for the domain, Organization on the homepage, and how many key pages were read. */
export function siteStrip(input: PagesInput, rows: readonly ListRow[], searchCrawlers: (name: string) => boolean): SiteStrip {
  const bot = input.bots[0];
  let access: SiteStrip["access"] = null;
  if (bot) {
    if (bot.robotsStatus === null || bot.robotsStatus >= 500) access = { line: "robots.txt could not be read", tone: "none" };
    else {
      const blocked = bot.crawlers.filter((c) => c.state !== "allowed" && c.name !== "Google-Extended");
      const search = blocked.filter((c) => searchCrawlers(c.name));
      access = !blocked.length
        ? { line: "Allowed", tone: "good" }
        : search.length
          ? { line: `${search.length} search ${search.length === 1 ? "crawler" : "crawlers"} blocked`, tone: "bad" }
          : { line: `${blocked.length} AI ${blocked.length === 1 ? "crawler" : "crawlers"} blocked`, tone: "warn" };
    }
  }
  const home = input.keyPages.find((p) => p.removedOn === null && isHomepage(p, input.domain));
  let organization: SiteStrip["organization"] = null;
  if (home) {
    const s = pageState(home, input);
    if (s.own?.status === "ok") {
      const v = validatorErrors(s.deep?.schemaResults ?? null).byType.get("Organization") ?? 0;
      const missing = s.findings.some((f) => f.id === "pages.schema.organization");
      const partial = s.findings.some((f) => f.id === "pages.schema.organization_props");
      organization = missing ? { line: "missing", tone: "warn" } : v > 0 ? { line: `${v} ${v === 1 ? "error" : "errors"}`, tone: "bad" } : partial ? { line: "found, incomplete", tone: "warn" } : { line: "found", tone: "good" };
    }
  }
  const checked = rows.filter((r) => r.checkedOn !== null && r.access.label !== "Could not read" && r.schema.label !== "Not checked");
  const last = rows.map((r) => r.checkedOn).filter((d): d is Day => d !== null).sort().pop() ?? null;
  return { access, organization, checked: { n: checked.length, of: rows.length, last } };
}

// ---- One page's detail. ----

export type SchemaTab = {
  found: { type: string; where: "static" | "rendered" }[];
  validator: { errors: number; warnings: number; notes: string[] } | null;
  findings: Finding[];
  fix: FixBlock[];
};

export function schemaTab(s: PageState): SchemaTab {
  const b = s.own?.status === "ok" ? s.own.basics : null;
  const v = s.deep?.schemaResults ?? null;
  const errs = validatorErrors(v);
  return {
    found: foundTypes(s.own?.status === "ok" ? s.own.schemaFound : null, v),
    validator: v ? { errors: errs.total, warnings: v.summary.warning, notes: errs.messages } : null,
    findings: s.findings,
    fix: b ? buildFix({ url: s.page.url, homepage: s.homepage, basics: b, found: s.own!.schemaFound }, s.findings) : [],
  };
}

export type FitTab = ClusterFit & { prompts: string[]; diagnostics: DiagRow[] | null; missing: string[]; top: TopStructure[] };

/** Internal links to a page from the other key pages, from their own latest reads. */
export function internalLinksTo(page: KeyPage, input: Pick<PagesInput, "keyPages" | "checks">): number {
  return input.keyPages
    .filter((k) => k.removedOn === null && k.id !== page.id)
    .filter((k) => {
      const c = checksOf(input.checks, k, "own")[0];
      return c?.status === "ok" && (c.basics?.internal ?? []).includes(page.urlKey);
    }).length;
}

export function fitTab(s: PageState, input: PagesInput): FitTab[] {
  return clusterFits(s, input).map((f) => {
    const prompts = input.prompts.filter((p) => p.clusterId === f.cluster.id && p.stoppedOn === null).map((p) => p.text);
    const top = input.top.filter((t) => t.keywordId === f.cluster.keywordId || t.clusterId === f.cluster.id).sort((a, b) => a.rank - b.rank).slice(0, 3);
    const b = s.own?.status === "ok" ? s.own.basics : null;
    return {
      ...f,
      prompts,
      top,
      diagnostics: b && f.keyword ? diagnostics({ keyword: f.keyword.keyword, prompts, you: { basics: b, wordCount: s.own!.wordCount }, top, internalLinks: internalLinksTo(s.page, input) }) : null,
      missing: b ? sharedMissing(top, b.headings) : [],
    };
  });
}

export type BasicsTab = {
  status: number | null;
  finalUrl: string | null;
  canonical: string | null;
  canonicalOwn: boolean;
  indexable: { ok: boolean; why: string | null };
  title: { text: string | null; length: number };
  description: { text: string | null; length: number };
  h1: string[];
  words: { static: number | null; rendered: number | null; jsOnly: boolean };
  alt: { with: number; of: number };
  facts: { price: boolean; address: boolean; phone: boolean; hours: boolean };
  checkedOn: Day | null;
};

/** Under this share of the rendered words, the page "shows little without JavaScript" (section 4.9). */
export const JS_SHARE = 0.3;

export function basicsTab(s: PageState): BasicsTab | null {
  const c = s.own;
  if (!c) return null;
  const b = c.basics;
  const canon = b?.canonical ? urlKey(b.canonical) : null;
  const rendered = s.deep?.renderedWordCount ?? null;
  const why = b?.noindex ? [b.metaRobots && /noindex/i.test(b.metaRobots) ? "meta robots" : null, b.xRobots && /noindex/i.test(b.xRobots) ? "X-Robots-Tag header" : null].filter(Boolean).join(" and ") : null;
  return {
    status: c.httpStatus,
    finalUrl: c.finalUrl,
    canonical: b?.canonical ?? null,
    canonicalOwn: canon === null || canon === s.page.urlKey,
    indexable: { ok: !b?.noindex, why: why || null },
    title: { text: b?.title ?? null, length: b?.title?.length ?? 0 },
    description: { text: b?.description ?? null, length: b?.description?.length ?? 0 },
    h1: b?.h1 ?? [],
    words: { static: c.wordCount, rendered, jsOnly: c.wordCount !== null && rendered !== null && rendered > 0 && c.wordCount < JS_SHARE * rendered },
    alt: { with: b?.imagesWithAlt ?? 0, of: b?.images ?? 0 },
    facts: { price: b?.facts.price ?? false, address: b?.facts.address ?? false, phone: b?.facts.phone ?? false, hours: b?.facts.hours ?? false },
    checkedOn: c.checkedAt.slice(0, 10),
  };
}

export type HistoryRow = { day: Day; via: PageCheck["via"]; trigger: PageCheck["trigger"]; line: string };

/** Checks over time, content changes (the hash moved between two readable own reads), newest first. */
export function historyRows(page: KeyPage, checks: readonly PageCheck[]): { checks: HistoryRow[]; changes: Day[] } {
  const all = checksOf(checks, page);
  const own = all.filter((c) => c.via === "own" && c.status === "ok" && c.contentHash).reverse();
  const changes: Day[] = [];
  for (let i = 1; i < own.length; i++) if (own[i]!.contentHash !== own[i - 1]!.contentHash) changes.push(own[i]!.checkedAt.slice(0, 10));
  return {
    checks: all.slice(0, 30).map((c) => ({
      day: c.checkedAt.slice(0, 10),
      via: c.via,
      trigger: c.trigger,
      line:
        c.status !== "ok"
          ? `We couldn't read this page${c.httpStatus ? ` (HTTP ${c.httpStatus})` : ""}.`
          : c.via === "own"
            ? `Read by us: HTTP ${c.httpStatus ?? "-"}, ${c.wordCount ?? 0} words${c.fix?.length ? `; the fix drafts ${c.fix.map((f) => f.type).join(", ")}` : "; nothing to fix in the structured data we found"}.`
            : `Read with JavaScript: ${c.renderedWordCount ?? 0} words${c.schemaResults ? `; the validator found ${validatorErrors(c.schemaResults).total} errors` : ""}.`,
    })),
    changes: changes.reverse(),
  };
}

/** "We couldn't read this page on 3 Nov (HTTP 403)." Never "no schema". */
export function unreadableLine(c: PageCheck): string {
  return `We couldn't read this page on ${formatDay(c.checkedAt.slice(0, 10))}${c.httpStatus ? ` (HTTP ${c.httpStatus})` : ""}.`;
}
