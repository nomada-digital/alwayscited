/**
 * Raw rows to the Workspace every dashboards page draws (17 Oct 2026). Pure:
 * no I/O, no clock (Raw carries today), so the browser re-derives it after an
 * optimistic edit and `node --test` runs it on hand-made rows.
 *
 * Figures and their bases:
 *  - a prompt's rate is named / answered on the latest reading that has it,
 *    across engines. An engine that did not answer is not a miss.
 *  - a cluster's rate is the same over its live prompts, on the client's
 *    latest reading; its trend is that rate on each reading held.
 *  - a keyword's change is its position a week before minus its position now,
 *    so up the page is positive.
 *  - footprint keywords (the monthly ranking snapshot) and console queries are
 *    sorted into a cluster's groups by the groups' terms: a query containing
 *    any term falls into the first such group. They are shown, never counted
 *    against the plan.
 */

import { brandKey, subjectKeys } from "../scan/brand-name.ts";

import { allowances, type PlanShape } from "./allowance.ts";
import { sampleConsole } from "./sample.ts";
import type {
  ClusterView,
  ConsoleFig,
  Day,
  Engine,
  GroupView,
  KeywordView,
  PromptView,
  Raw,
  RawAnswer,
  RawConsoleRow,
  RawKeyword,
  RawPrompt,
  Workspace,
} from "./types.ts";

export const ENGINE_ORDER: readonly Engine[] = ["google_aio", "chatgpt", "gemini", "perplexity", "claude"];
/** Readings drawn in a strip or trend. */
export const STRIP_DAYS = 14;
/** Footprint keywords shown per group, by search volume. */
export const FOOTPRINT_PER_GROUP = 12;
/** Console queries surfaced per group that no keyword covers. */
export const DISCOVERED_PER_GROUP = 6;

const live = (r: { stopped_on: string | null }) => r.stopped_on === null;
const lc = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function addDaysIso(d: Day, n: number): Day {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Does this query fall into a group with these terms? */
export function matchesTerms(query: string, terms: readonly string[]): boolean {
  const q = lc(query);
  return terms.some((t) => t && q.includes(lc(t)));
}

type Verdict = "named" | "missed" | "none";
const verdictOf = (a: RawAnswer): Verdict => (!a.answered ? "none" : a.named ? "named" : "missed");

function rateOf(rows: readonly RawAnswer[]): number | null {
  const answered = rows.filter((a) => a.answered);
  return answered.length ? answered.filter((a) => a.named).length / answered.length : null;
}

export type BuildOpts = { plan: PlanShape; sample?: boolean };

export function buildWorkspace(raw: Raw, opts: BuildOpts): Workspace {
  const dates = [...new Set(raw.answers.map((a) => a.run_date))].sort();
  const strip = dates.slice(-STRIP_DAYS);
  const latest = dates[dates.length - 1] ?? null;
  const lastRun = [...raw.runs].sort((a, b) => a.run_date.localeCompare(b.run_date)).at(-1) ?? null;
  const seen = new Set(raw.answers.map((a) => a.engine));
  const engines = ENGINE_ORDER.filter((e) => seen.has(e) || (lastRun?.engines ?? []).includes(e));

  // Answers by prompt, and by prompt and day.
  const byPrompt = new Map<string, RawAnswer[]>();
  for (const a of raw.answers) {
    const l = byPrompt.get(a.question_id) ?? [];
    l.push(a);
    byPrompt.set(a.question_id, l);
  }

  const promptView = (p: RawPrompt): PromptView => {
    const rows = byPrompt.get(p.id) ?? [];
    const last = rows.reduce<Day | null>((m, a) => (m === null || a.run_date > m ? a.run_date : m), null);
    const onLast = last ? rows.filter((a) => a.run_date === last) : [];
    const cells: PromptView["cells"] = {};
    const days: PromptView["days"] = {};
    for (const e of engines) {
      const hit = onLast.find((a) => a.engine === e);
      cells[e] = hit ? verdictOf(hit) : null;
      days[e] = strip.map((d) => {
        const r = rows.find((a) => a.run_date === d && a.engine === e);
        return r ? verdictOf(r) : null;
      });
    }
    return { id: p.id, text: p.text, angle: p.angle, addedOn: p.added_on, measured: rows.length > 0, rate: rateOf(onLast), cells, days };
  };

  // Keywords: daily positions.
  const serpBy = new Map<string, [Day, number | null, string | null][]>();
  for (const s of [...raw.serp].sort((a, b) => a.run_date.localeCompare(b.run_date))) {
    const l = serpBy.get(s.keyword_id) ?? [];
    l.push([s.run_date, s.position, s.url]);
    serpBy.set(s.keyword_id, l);
  }

  // Console rows: the latest period per provider, by query.
  const consoleBy = { gsc: new Map<string, ConsoleFig>(), bing: new Map<string, ConsoleFig>() };
  const consoleRows: Record<"gsc" | "bing", RawConsoleRow[]> = { gsc: [], bing: [] };
  for (const prov of ["gsc", "bing"] as const) {
    const rows = raw.consoleRows.filter((r) => r.provider === prov);
    const end = rows.reduce<Day | null>((m, r) => (m === null || r.period_end > m ? r.period_end : m), null);
    for (const r of rows.filter((x) => x.period_end === end)) {
      const k = lc(r.query);
      const had = consoleBy[prov].get(k);
      const clicks = (had?.clicks ?? 0) + r.clicks;
      const impr = (had?.impr ?? 0) + r.impressions;
      consoleBy[prov].set(k, { clicks, impr, ctr: impr ? clicks / impr : 0, pos: r.position ?? had?.pos ?? null });
      consoleRows[prov].push(r);
    }
  }
  const consoleLive = { gsc: consoleBy.gsc.size > 0, bing: consoleBy.bing.size > 0 };
  const sample = !!opts.sample && !consoleLive.gsc && !consoleLive.bing;
  const consoleFor = (k: string, vol: number | null, pos: number | null): KeywordView["console"] => {
    if (sample) return { gsc: sampleConsole(k, vol, pos, "gsc"), bing: sampleConsole(k, vol, pos, "bing") };
    return { gsc: consoleBy.gsc.get(lc(k)) ?? null, bing: consoleBy.bing.get(lc(k)) ?? null };
  };

  const trackedView = (k: RawKeyword): KeywordView => {
    const hist = serpBy.get(k.id) ?? [];
    const cur = hist.at(-1) ?? null;
    const curPos = cur?.[1] ?? null;
    const weekAgo = cur ? [...hist].reverse().find(([d]) => d <= addDaysIso(cur[0], -7)) : undefined;
    const change = curPos !== null && weekAgo && weekAgo[1] !== null ? weekAgo[1] - curPos : null;
    return {
      id: k.id,
      keyword: k.keyword,
      volume: k.search_volume,
      src: "tracked",
      pos: curPos,
      change,
      url: cur?.[2] ?? null,
      hist: hist.slice(-30).map(([d, p]) => [d, p]),
      console: consoleFor(k.keyword, k.search_volume, curPos),
      addedOn: k.added_on,
    };
  };

  const liveKeywords = raw.keywords.filter(live);
  const livePrompts = raw.prompts.filter((p) => live(p) && p.allowance !== "placement");
  const trackedKeys = new Set(liveKeywords.map((k) => lc(k.keyword)));

  // Footprint keywords: the first group whose terms match, across clusters in order.
  const liveClusters = raw.clusters.filter(live).sort((a, b) => a.started_on.localeCompare(b.started_on) || a.name.localeCompare(b.name));
  const liveGroups = raw.groups.filter(live).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const groupsOf = (cid: string) => liveGroups.filter((g) => g.cluster_id === cid);
  const allGroups = liveClusters.flatMap((c) => groupsOf(c.id));
  const footBy = new Map<string, KeywordView[]>();
  const foot = [...(raw.footprint?.rows ?? [])].sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
  for (const r of foot) {
    if (trackedKeys.has(lc(r.k))) continue;
    const g = allGroups.find((x) => matchesTerms(r.k, x.terms));
    if (!g) continue;
    const l = footBy.get(g.id) ?? [];
    if (l.length >= FOOTPRINT_PER_GROUP) continue;
    l.push({ id: null, keyword: r.k, volume: r.v, src: "footprint", pos: r.p, change: null, url: r.u, hist: [], console: consoleFor(r.k, r.v, r.p), addedOn: null });
    footBy.set(g.id, l);
  }

  // Console queries no keyword covers, by group.
  const discoveredFor = (terms: string[], covered: Set<string>): GroupView["discovered"] => {
    const pick = (prov: "gsc" | "bing") =>
      [...consoleBy[prov]]
        .filter(([q]) => !covered.has(q) && matchesTerms(q, terms))
        .sort((a, b) => b[1].impr - a[1].impr)
        .slice(0, DISCOVERED_PER_GROUP)
        .map(([q, f]) => ({ q, ...f }));
    return { gsc: pick("gsc"), bing: pick("bing") };
  };

  const answersOn = (ids: Set<string>, d: Day) => raw.answers.filter((a) => a.run_date === d && ids.has(a.question_id));

  const clusters: ClusterView[] = liveClusters.map((c) => {
    const kws = liveKeywords.filter((k) => k.cluster_id === c.id || (k.cluster_id === null && c.keyword_id === k.id));
    const ps = livePrompts.filter((p) => p.cluster_id === c.id);
    const head = raw.keywords.find((k) => k.id === c.keyword_id) ?? null;
    const headView = head ? trackedView(head) : null;
    const groups: GroupView[] = groupsOf(c.id).map((g) => {
      const tracked = kws.filter((k) => k.group_id === g.id).map(trackedView);
      const footprint = footBy.get(g.id) ?? [];
      const keywords = [...tracked, ...footprint];
      return {
        id: g.id,
        name: g.name,
        note: g.note,
        terms: g.terms,
        keywords,
        prompts: ps.filter((p) => p.group_id === g.id).map(promptView),
        discovered: discoveredFor(g.terms, new Set(keywords.map((k) => lc(k.keyword)))),
      };
    });
    const groupIds = new Set(groupsOf(c.id).map((g) => g.id));
    const own: GroupView = {
      id: null,
      name: "Not in a group",
      note: null,
      terms: [],
      keywords: kws.filter((k) => !k.group_id || !groupIds.has(k.group_id)).map(trackedView),
      prompts: ps.filter((p) => !p.group_id || !groupIds.has(p.group_id)).map(promptView),
      discovered: { gsc: [], bing: [] },
    };
    const ids = new Set(ps.map((p) => p.id));
    return {
      id: c.id,
      name: c.name,
      tier: c.tier,
      startedOn: c.started_on,
      headKeyword: head?.keyword ?? null,
      headVolume: head?.search_volume ?? null,
      headPos: headView?.pos ?? null,
      headChange: headView?.change ?? null,
      rate: latest ? rateOf(answersOn(ids, latest)) : null,
      rateTrend: strip.map((d) => rateOf(answersOn(ids, d))),
      groups,
      own,
      trackedKeywords: kws.length,
      prompts: ps.length,
      placements: raw.placements.filter((p) => p.cluster_id === c.id),
    };
  });

  const looseP = livePrompts.filter((p) => p.cluster_id === null || !liveClusters.some((c) => c.id === p.cluster_id)).map(promptView);
  const clusterKw = new Set(clusters.flatMap((c) => [...c.groups.flatMap((g) => g.keywords), ...c.own.keywords]).map((k) => k.id));
  const looseK = liveKeywords.filter((k) => !clusterKw.has(k.id)).map(trackedView);

  const allIds = new Set(livePrompts.map((p) => p.id));

  // Brands and sources over the last 7 readings.
  const recent = new Set(dates.slice(-7));
  const window = raw.answers.filter((a) => recent.has(a.run_date) && allIds.has(a.question_id));
  const subject = subjectKeys(raw.client.brand ?? raw.client.domain, raw.client.domain);
  for (const a of raw.client.brand_aliases ?? []) subject.add(brandKey(a));
  const brandCount = new Map<string, { name: string; answers: number }>();
  for (const a of window) {
    for (const b of new Set((a.brands ?? []).map((x) => String(x)))) {
      const key = brandKey(b);
      if (!key) continue;
      const had = brandCount.get(key);
      brandCount.set(key, { name: had?.name ?? b, answers: (had?.answers ?? 0) + 1 });
    }
  }
  const brands = [...brandCount]
    .map(([key, v]) => ({ name: v.name, answers: v.answers, you: subject.has(key) }))
    .sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name))
    .slice(0, 15);
  const own = raw.client.domain.replace(/^www\./, "").toLowerCase();
  const srcCount = new Map<string, { answers: Set<string>; urls: Set<string>; engines: Set<Engine> }>();
  for (const a of window) {
    const key = `${a.run_date} ${a.question_id} ${a.engine}`;
    for (const c of a.citations ?? []) {
      const d = (c.source_domain ?? hostOf(c.url) ?? "").replace(/^www\./, "").toLowerCase();
      if (!d) continue;
      const s = srcCount.get(d) ?? { answers: new Set(), urls: new Set(), engines: new Set() };
      s.answers.add(key);
      s.urls.add(c.url);
      s.engines.add(a.engine);
      srcCount.set(d, s);
    }
  }
  const sources = [...srcCount]
    .map(([domain, s]) => ({ domain, answers: s.answers.size, urls: s.urls.size, you: domain === own || domain.endsWith(`.${own}`), engines: ENGINE_ORDER.filter((e) => s.engines.has(e)) }))
    .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain))
    .slice(0, 40);

  const connections: Workspace["connections"] = {};
  for (const c of raw.connections) connections[c.provider] = c;

  return {
    client: raw.client,
    role: raw.role,
    canWrite: (raw.role === "owner" || raw.role === "editor") && raw.client.status !== "ended",
    today: raw.today,
    engines,
    dates: strip,
    lastRun,
    allowances: allowances(raw, opts.plan),
    clusters,
    loose: { prompts: looseP, keywords: looseK },
    rate: latest ? rateOf(answersOn(allIds, latest)) : null,
    rateTrend: strip.map((d) => rateOf(answersOn(allIds, d))),
    brands,
    sources,
    opportunities: raw.opportunities,
    connections,
    consoleLive: sample ? { gsc: false, bing: false } : consoleLive,
    footprintOn: raw.footprint?.pulled_on ?? null,
    groupsReady: raw.groupsReady,
  };
}

/** Every keyword the client tracks or ranks for in one cluster, for the Google table. */
export function clusterKeywords(c: ClusterView): (KeywordView & { group: string })[] {
  return [...c.groups.flatMap((g) => g.keywords.map((k) => ({ ...k, group: g.name }))), ...c.own.keywords.map((k) => ({ ...k, group: "" }))];
}

/** Footprint rows sent to the browser, by volume: enough for any group's terms to find their matches. */
export const CLIENT_FOOTPRINT_ROWS = 1500;

/**
 * Raw as the browser editor receives it: no answer words, brands or citations,
 * readings only for the strip's days, and the footprint cut to its top rows
 * by volume. The editor re-derives the Workspace from it after every edit, so
 * it must hold everything the cluster view draws, and nothing more.
 */
export function trimRaw(raw: Raw): Raw {
  const dates = [...new Set(raw.answers.map((a) => a.run_date))].sort().slice(-STRIP_DAYS);
  const keep = new Set(dates);
  const serpFrom = dates[0] ?? raw.today;
  return {
    ...raw,
    answers: raw.answers.filter((a) => keep.has(a.run_date)).map((a) => ({ run_date: a.run_date, question_id: a.question_id, engine: a.engine, answered: a.answered, named: a.named })),
    serp: raw.serp.filter((s) => s.run_date >= addDaysIso(serpFrom, -16)),
    footprint: raw.footprint ? { pulled_on: raw.footprint.pulled_on, rows: [...raw.footprint.rows].sort((a, b) => (b.v ?? 0) - (a.v ?? 0)).slice(0, CLIENT_FOOTPRINT_ROWS) } : null,
    opportunities: [],
  };
}
