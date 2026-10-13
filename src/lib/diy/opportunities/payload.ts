import { ENGINE_SPECS } from "../../scan/engines.ts";
import { type Day, addDays, formatDay } from "../../tracking/figures.ts";

import { NOT_CLASSIFIED, PAGE_TYPE_LABEL, DOMAIN_TYPE_LABEL, ROUTE_LABEL, STATUS_LABEL, LENS_LABEL, type OppStatus, type Opportunity, type PageFacts, type PageType, type Route, type TabLens, AI_CITED_LENSES, LIST_TYPES } from "./types.ts";
import { unreadableLine } from "./brief.ts";
import { domainTypeByRule, pageTypeByRule } from "./classify-rules.ts";
import { CLASSIFIED_LABEL } from "../core/evidence.ts";
import { compareOrder, orderKey } from "./order.ts";
import { pursuingLine } from "./verify.ts";
import type { CitedSummary } from "./derive.ts";

/**
 * What the Opportunities pages are handed (13 Oct 2026, DIY P7; spec 10
 * sections 2.1 item 8 and 6.10 item 2): allow-listed views, each built from
 * named fields of our own rows and nothing else. No free text is copied from
 * an agency source, no vendor figure, and no field a client may not see.
 * gating.test.mts sweeps this file for a price beside a link word, and
 * payload.test.mts holds every view to its key list.
 *
 * Every sentence here is our counts and dates; the page facts are what we
 * read, with the day we read them; nothing says why an engine did anything.
 */

export type ViewCtx = {
  today: Day;
  brand: string;
  /** Cluster names by id. */
  clusters: ReadonlyMap<string, string>;
  /** Page reads by url_key. */
  reads: ReadonlyMap<string, PageFacts>;
  /** DIY is dark: page facts are not read, and nothing is said about them but "Not read yet". */
  dark: boolean;
  /** The link that opens one answer (the one-cluster page, its day and engine), or null when the prompt has no cluster page. */
  answerLink: (prompt: string, day: Day, engine: string) => string | null;
  /** A path under the client's dashboard, as a link. */
  path: (p: string) => string;
};

export const LIST_ROW_KEYS = ["id", "href", "title", "domain", "types", "route", "routeKey", "why", "whyHref", "names", "fresh", "cluster", "status", "statusLabel", "lens"] as const;
export type ListRow = {
  id: string;
  href: string;
  title: string;
  domain: string;
  types: string;
  route: string;
  routeKey: Route;
  why: string;
  whyHref: string | null;
  names: string | null;
  fresh: string[];
  cluster: { id: string; name: string } | null;
  status: OppStatus;
  statusLabel: string;
  lens: Opportunity["lens"];
};

const and = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const engineName = (e: string) => (ENGINE_SPECS as Record<string, { label: string }>)[e]?.label ?? e;

/** A page as text when it has no title: its host and path. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "")}${p}`;
  } catch {
    return url;
  }
}

/**
 * "Publisher · Best-of list", or "not classified yet" for a blank; an `own`
 * row is on the client's own site. A type the rules did not settle was
 * written by a model, and the half it wrote says so (spec 10 section 2.6:
 * "classified automatically"), as Cited pages labels each column: "Publisher
 * (classified automatically) · Best-of list". A blank half is never labelled:
 * nothing wrote it (13 Oct 2026, review of DIY P7).
 */
export function typesLine(o: Pick<Opportunity, "domainType" | "pageType"> & { lens?: Opportunity["lens"]; url?: string; domain?: string; title?: string | null }): string {
  const auto = o.lens === "own" ? { domain: false, page: false } : modelHalves(o);
  const mark = (label: string, byModel: boolean) => (byModel ? `${label} (${CLASSIFIED_LABEL})` : label);
  const d = o.lens === "own" ? "Your site" : o.domainType ? mark(DOMAIN_TYPE_LABEL[o.domainType], auto.domain) : null;
  const p = o.pageType ? mark(PAGE_TYPE_LABEL[o.pageType], auto.page) : null;
  if (!d && !p) return NOT_CLASSIFIED;
  return [d ?? NOT_CLASSIFIED, p ?? NOT_CLASSIFIED].join(" · ");
}

/** Which of a row's types came from the classify call rather than the rules: a type set and not the rule's. */
export function modelHalves(o: Pick<Opportunity, "domainType" | "pageType"> & { url?: string; domain?: string; title?: string | null }): { domain: boolean; page: boolean } {
  if (!o.url || !o.domain) return { domain: false, page: false };
  const ruleD = domainTypeByRule(o.domain);
  const ruleP = pageTypeByRule(o.url, o.title ?? null, ruleD ?? o.domainType);
  return { domain: o.domainType !== null && o.domainType !== ruleD, page: o.pageType !== null && o.pageType !== ruleP };
}

/** Whether either of a row's types came from the classify call. */
export function byModel(o: Parameters<typeof modelHalves>[0]): boolean {
  const h = modelHalves(o);
  return h.domain || h.page;
}

const typeWords = (t: PageType | null | undefined, n: number) => {
  const label = t ? PAGE_TYPE_LABEL[t].toLowerCase() : "page";
  if (n === 1) return label;
  return label === "alternatives" ? "alternatives pages" : `${label}s`;
};

/** The row's "why": our counts and dates (section 4.7 row 4). */
export function whyLine(o: Opportunity): string {
  const e = o.evidence;
  if (o.lens === "own") {
    const kw = e.keyword ? `'${e.keyword}'` : "this cluster";
    // Our data only (spec 10 section 6.10): derive looks at the client's pages that rank, are cited, or are key pages, typed by their address.
    if (o.route === "publish_own") return `The answers and Google's top 10 for ${kw} show ${plural(e.own_seen ?? 0, typeWords(e.own_type, 1), typeWords(e.own_type, 2))}; none of yours ranks or is cited for it.`;
    return `Your ${typeWords(e.own_type, 1)} for ${kw} isn't cited for its prompts and isn't in Google's top 5${e.rank ? ` (it is #${e.rank})` : ""}.`;
  }
  if (o.lens === "lists") return e.rank && e.keyword ? `Ranks #${e.rank} on Google for '${e.keyword}'.` : "In Google's top 10 for one of your keywords.";
  if (o.lens === "logged") return `You logged it${o.firstSeen ? ` on ${formatDay(o.firstSeen)}` : ""}.`;
  if (!e.answers) return e.rank && e.keyword ? `Ranks #${e.rank} on Google for '${e.keyword}'.` : "Pursued from a list of yours.";
  const engines = and(e.engines.map(engineName));
  return `Cited by ${engines} for ${e.prompt_count} of your prompts in the last 28 days (${plural(e.answers, "answer")}).`;
}

/** Whether the page names the client, said only as far as we know it (section 4.7: never "doesn't name you" for a page we could not read). */
export function namesLine(o: Opportunity, facts: PageFacts | null, ctx: Pick<ViewCtx, "brand" | "dark">): string | null {
  if (o.lens === "own") return null;
  const others = (xs: readonly string[]) => (xs.length > 2 ? `${xs.slice(0, 2).join(", ")} and ${plural(xs.length - 2, "other")}` : and(xs));
  if (facts && !ctx.dark) {
    if (facts.status !== "ok") return unreadableLine(facts);
    const read = formatDay(facts.readAt.slice(0, 10));
    if (facts.namesClient === false) return facts.brandsFound.length ? `Names ${others(facts.brandsFound)}, not you (read ${read}).` : `Doesn't name ${ctx.brand} (read ${read}).`;
    if (facts.namesClient === true) return o.route === "send_correction" ? `Names ${ctx.brand}, but the answers citing it don't (read ${read}).` : `Names ${ctx.brand} (read ${read}).`;
  }
  const c = o.evidence.competitors;
  if (o.evidence.answers && c.length) return `Cited in answers that name ${others(c)}, not you.`;
  return null;
}

/** The freshness line (section 4.7 row 4): the page's own updated date as we read it, and when it was last cited. */
export function freshLines(o: Opportunity, facts: PageFacts | null, ctx: Pick<ViewCtx, "today" | "dark">): string[] {
  const out: string[] = [];
  if (facts?.status === "ok" && facts.updatedOn && !ctx.dark) {
    const [y, m] = facts.updatedOn.split("-");
    out.push(`updated on the page: ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`);
  }
  if (o.evidence.days_7 > 0) out.push("still cited this week");
  else if (o.evidence.last_cited) out.push(`last cited ${formatDay(o.evidence.last_cited)}`);
  return out;
}

export function listRow(o: Opportunity, ctx: ViewCtx): ListRow {
  const facts = ctx.reads.get(o.urlKey) ?? null;
  const title = (!ctx.dark && facts?.status === "ok" && facts.title) || o.title || pathOf(o.url);
  const open = o.evidence.open;
  return {
    id: o.id,
    href: ctx.path(`/opportunities/${encodeURIComponent(o.id)}`),
    title: o.lens === "own" && o.route === "publish_own" ? `Publish your own ${typeWords(o.pageType, 1)}` : title,
    domain: o.domain,
    types: typesLine({ ...o, title: (!ctx.dark && facts?.status === "ok" && facts.title) || o.title }),
    route: ROUTE_LABEL[o.route],
    routeKey: o.route,
    why: whyLine(o),
    whyHref: open ? ctx.answerLink(open.prompt, open.day, open.engine) : null,
    names: namesLine(o, facts, ctx),
    fresh: freshLines(o, facts, ctx),
    cluster: o.clusterId && ctx.clusters.has(o.clusterId) ? { id: o.clusterId, name: ctx.clusters.get(o.clusterId)! } : null,
    status: o.status,
    statusLabel: STATUS_LABEL[o.status],
    lens: o.lens,
  };
}

/** The rows listed under a tab: new and still derived, or logged, in the stated order. */
export function listed(rows: readonly Opportunity[], lens: TabLens | null): Opportunity[] {
  return rows
    .filter((o) => o.status === "new" && (o.live || o.lens === "logged") && (lens === null || o.lens === lens))
    .sort((a, b) => compareOrder({ key: orderKey(a.evidence, a.pageType, a.firstSeen), urlKey: a.urlKey }, { key: orderKey(b.evidence, b.pageType, b.firstSeen), urlKey: b.urlKey }));
}

/** The header counts (section 4.7 row 1): new AI-cited pages, of them best-of lists or comparisons, and threads. */
export function headerCounts(rows: readonly Opportunity[]): { total: number; lists: number; threads: number } {
  const ai = listed(rows, null).filter((o) => AI_CITED_LENSES.includes(o.lens));
  return { total: ai.length, lists: ai.filter((o) => o.pageType !== null && LIST_TYPES.includes(o.pageType)).length, threads: ai.filter((o) => o.lens === "threads").length };
}

export function headerLine(c: { total: number; lists: number; threads: number }, refreshedTo: Day | null): string {
  if (!c.total) return refreshedTo ? `Updated overnight from your checks to ${formatDay(refreshedTo)}.` : "";
  const parts = [`${plural(c.total, "page")} the engines cite ${c.total === 1 ? "leaves" : "leave"} you out.`];
  if (c.lists) parts.push(`${c.lists} ${c.lists === 1 ? "is a best-of list or comparison" : "are best-of lists or comparisons"}.`);
  if (c.threads) parts.push(`${c.threads} ${c.threads === 1 ? "is a thread" : "are threads"}.`);
  if (refreshedTo) parts.push(`Updated overnight from your checks to ${formatDay(refreshedTo)}.`);
  return parts.join(" ");
}

/** The cited tab's empty states' words (spec 10 section 4.7, States). */
export const EMPTY_NO_CITATIONS = "Opportunities come from the pages the engines cite for your prompts. No page on another site has been cited yet; they fill in overnight once one is.";
export const EMPTY_ALL_NAME_YOU = "Every page the engines cite for these prompts names you. The next gains are on Google: see Your pages.";
export const EMPTY_NONE_NEW = "Nothing new to list right now. A page is listed once the engines cite it on 2 of the last 14 days and it leaves you out.";

/**
 * The cited tab's empty state, said only as far as we know it (13 Oct 2026,
 * review of DIY P7: "Every page ... names you" showed whenever any one read
 * named the client, including after the member had set every page aside).
 *
 * - No page on another site cited in the window: "no citations yet".
 * - Every one of them read, and every read found the client named: "every
 *   page names you". A page never read is not known to name the client, and
 *   an answer naming the client says nothing about the page it cites.
 * - Otherwise nothing new qualifies, and the line says where the rest went:
 *   to Pursuing, or to the other tabs. It names no page and no count, so a
 *   page left out (another client's placement, a competitor's) is not hinted at.
 *
 * `cited` is null when the summary could not be read: the plain line, never
 * a claim. Pure.
 */
export function citedEmpty(cited: CitedSummary | null, rows: readonly Opportunity[]): string {
  if (cited && cited.pages === 0) return EMPTY_NO_CITATIONS;
  if (cited && cited.readNamingYou === cited.pages) return EMPTY_ALL_NAME_YOU;
  const worked = rows.some((o) => AI_CITED_LENSES.includes(o.lens) && o.status !== "new");
  return `${EMPTY_NONE_NEW} ${worked ? "Pages you're working on are under Pursuing; pages you marked not for us stay out of this list." : "Best-of lists on Google and your own pages are in the other tabs."}`;
}

/**
 * U3's facts on one opportunity (spec 10 section 2.7: the page names at least
 * two competitors and not you), from the page as we read it and nothing else
 * (13 Oct 2026, review of DIY P7: the answers' brands were used for an unread
 * page, so "Shown because this page names X and Y, not you" was a claim about
 * a page nobody had read). Only a read that could see the page, found the
 * client not named and found two or more of the competitors fills it; any
 * other page gives none, so U3 does not fire. Pure.
 */
export function u3LeavesOut(o: Pick<Opportunity, "route" | "status" | "evidence">, facts: PageFacts | null, p: { dark: boolean; clusterOpen: number; routes: readonly Route[] }): { names: string[]; answers: number; days: number; status: string; clusterOpen: number } | undefined {
  if (p.dark || !p.routes.includes(o.route) || o.status === "won") return undefined;
  if (!facts || facts.status !== "ok" || facts.namesClient !== false || facts.brandsFound.length < 2) return undefined;
  return { names: facts.brandsFound, answers: o.evidence.answers, days: 28, status: o.status, clusterOpen: p.clusterOpen };
}

/** The tab counts. */
export function tabCounts(rows: readonly Opportunity[]): Record<TabLens, number> {
  const n = (l: TabLens) => listed(rows, l).length;
  return { cited: n("cited"), lists: n("lists"), threads: n("threads"), profiles: n("profiles"), own: n("own"), logged: n("logged") };
}

export const TAB_LABELS = LENS_LABEL;

// ---- The Pursuing view ----

export const PURSUING_ROW_KEYS = ["id", "href", "title", "domain", "route", "cluster", "status", "statusLabel", "since", "prompt", "verification", "firstCited", "note"] as const;
/** A pursued page's prompt: one it added, or one already tracked that measures it. */
export type PursuedPrompt = { text: string; href: string | null; added: boolean };
export type PursuingRow = {
  id: string;
  href: string;
  title: string;
  domain: string;
  route: string;
  cluster: { id: string; name: string } | null;
  status: OppStatus;
  statusLabel: string;
  since: string | null;
  prompt: PursuedPrompt | null;
  verification: string;
  firstCited: string | null;
  note: string | null;
};

/** "First cited by Perplexity for 'best invoicing apps for freelancers' on 9 Nov", the earliest engine first. */
export function firstCitedLine(o: Opportunity, prompts: ReadonlyMap<string, string>): string | null {
  const firsts = Object.entries(o.firstCited ?? {}).sort((a, b) => a[1].day.localeCompare(b[1].day));
  if (!firsts.length) return o.pursuedOn ? `Not cited since you started on ${formatDay(o.pursuedOn)}.` : null;
  const [engine, at] = firsts[0]!;
  const text = prompts.get(at.prompt);
  const more = firsts.length > 1 ? ` Then ${and(firsts.slice(1).map(([e]) => engineName(e)))}.` : "";
  return `First cited by ${engineName(engine)}${text ? ` for '${text}'` : ""} on ${formatDay(at.day)}.${more}`;
}

/**
 * The History block's first-cited readout (spec 10 section 4.7: "first-cited
 * by engine"): one line per engine, the earliest first - "First cited by
 * Perplexity for 'best invoicing apps' on 9 Nov." - or, pursued and not cited
 * since, the one line saying so. Empty for a page never pursued.
 */
export function firstCitedLines(o: Pick<Opportunity, "firstCited" | "pursuedOn">, prompts: ReadonlyMap<string, string>): string[] {
  const firsts = Object.entries(o.firstCited ?? {}).sort((a, b) => a[1].day.localeCompare(b[1].day) || a[0].localeCompare(b[0]));
  if (!firsts.length) return o.pursuedOn ? [`Not cited since you started on ${formatDay(o.pursuedOn)}.`] : [];
  return firsts.map(([engine, at]) => {
    const text = prompts.get(at.prompt);
    return `First cited by ${engineName(engine)}${text ? ` for '${text}'` : ""} on ${formatDay(at.day)}.`;
  });
}

export function pursuingRow(o: Opportunity, ctx: ViewCtx & { prompts: ReadonlyMap<string, string>; promptHref: (id: string) => string | null; domain: string; addedBy: (promptId: string) => string | null }): PursuingRow {
  const facts = ctx.reads.get(o.urlKey) ?? null;
  return {
    id: o.id,
    href: ctx.path(`/opportunities/${encodeURIComponent(o.id)}`),
    title: (!ctx.dark && facts?.status === "ok" && facts.title) || o.title || pathOf(o.url),
    domain: o.domain,
    route: ROUTE_LABEL[o.route],
    cluster: o.clusterId && ctx.clusters.has(o.clusterId) ? { id: o.clusterId, name: ctx.clusters.get(o.clusterId)! } : null,
    status: o.status,
    statusLabel: STATUS_LABEL[o.status],
    since: o.statusAt ? formatDay(o.statusAt.slice(0, 10)) : null,
    prompt: o.promptId && ctx.prompts.has(o.promptId) ? { text: ctx.prompts.get(o.promptId)!, href: ctx.promptHref(o.promptId), added: ctx.addedBy(o.promptId) === o.id } : null,
    verification: o.lens === "link_domain" ? "A domain, not a page: pursued, not checked." : pursuingLine(o.verified, ctx.domain),
    firstCited: firstCitedLine(o, ctx.prompts),
    note: o.note,
  };
}

/** The Pursuing view's rows: every status in pursuing, pitched or won, across all lenses, the most recent change first. */
export function pursuing(rows: readonly Opportunity[]): Opportunity[] {
  return rows.filter((o) => o.status === "pursuing" || o.status === "pitched" || o.status === "won").sort((a, b) => (b.statusAt ?? "").localeCompare(a.statusAt ?? "") || a.id.localeCompare(b.id));
}

// ---- One opportunity's "Why this page" ----

export type WhyFact = { text: string; href: string | null };

/** The detail page's "Why this page" lines (section 4.7): counts and dates from the evidence, each opening its answers. */
export function whyFacts(o: Opportunity, ctx: ViewCtx): WhyFact[] {
  const e = o.evidence;
  const facts = ctx.reads.get(o.urlKey) ?? null;
  const open = e.open ? ctx.answerLink(e.open.prompt, e.open.day, e.open.engine) : null;
  const out: WhyFact[] = [];
  if (o.lens === "own" || o.lens === "logged" || o.lens === "lists") out.push({ text: whyLine(o), href: null });
  if (e.answers) {
    out.push({ text: `Cited by ${and(e.engines.map(engineName))} for ${e.prompt_count} of your prompts in ${plural(e.answers, "answer")} over the 28 days to ${formatDay(e.to)}, on ${e.days_14} of the last 14 days.`, href: open });
    if (e.leaves_out) {
      const left = e.leaves_out === e.answers ? `All ${e.answers} left you out.` : `${e.leaves_out} of them left you out.`;
      out.push({ text: `${left}${e.competitors.length ? ` The answers that left you out named ${and(e.competitors)}.` : ""}`, href: open });
    }
  }
  const names = namesLine(o, facts, ctx);
  if (names && !names.startsWith("Cited in answers")) out.push({ text: names, href: null });
  if (e.rank && e.keyword && o.lens !== "lists") out.push({ text: `Ranks #${e.rank} on Google for '${e.keyword}'.`, href: null });
  if (!ctx.dark && facts?.status === "ok" && facts.updatedOn) out.push({ text: `Updated on the page: ${formatDay(facts.updatedOn, true)}.`, href: null });
  if (o.lens !== "own" && e.last_cited && e.days_7 === 0) out.push({ text: `Last cited ${formatDay(e.last_cited)}, more than a week ago.`, href: open });
  return out;
}

/** "Still cited this week" for a thread's step 1: the last day cited, as text. */
export function lastCitedText(o: Opportunity, today: Day): string | null {
  const d = o.evidence.last_cited;
  if (!d) return null;
  return d >= addDays(today, -6) ? `Still cited this week (last on ${formatDay(d)}).` : `Last cited ${formatDay(d)}.`;
}
