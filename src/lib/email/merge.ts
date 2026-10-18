import { brandKey, subjectKeys } from "../scan/brand-name.ts";
import { chosenTarget, targetLabel } from "../dash/target.ts";
import type { Day, Engine, Raw, RawAnswer, RawPlacement, TierKey } from "../dash/types.ts";

/**
 * The customer emails' merge data (brief item 2e, 18 Oct 2026): every figure
 * an email shows, worked out from the same rows the dashboard reads
 * (dash/load.ts loadRaw), so a mail and the dashboard cannot disagree. Pure,
 * no I/O, no clock (Raw carries today): node --test runs it on hand-made rows.
 *
 * The rules it keeps, pinned in merge.test.mts:
 *
 * - nothing is invented: a figure with no rows behind it is null, and the
 *   template hides its block rather than printing 0 or a placeholder;
 * - AI visibility and Google position are never combined. A cluster's two
 *   keyword forms (tracked_keywords.form, 'primary' | 'plural' | 'singular',
 *   pair_of the primary; 20261018030000) are reported apart, never averaged;
 * - the target page is the cluster's chosen page (dash/target.ts chosenTarget).
 */

export type KeywordForm = "primary" | "plural" | "singular";
/** tracked_keywords.form and pair_of by keyword id; empty before 20261018030000 is applied. */
export type Forms = ReadonlyMap<string, { form: KeywordForm | null; pair_of: string | null }>;

export type Position = { keyword: string; label: string | null; now: number | null; before: number | null };

/** A cluster as the emails show it: its keyword, the other form, the target page, and the two Google positions. */
export type Focus = {
  clusterId: string;
  name: string;
  keyword: string | null;
  pair: string | null;
  target: string | null;
  positions: Position[];
};

export const ENGINE_LABEL: Record<Engine, string> = {
  google_aio: "Google AI Overviews",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  claude: "Claude",
};
const ENGINE_ORDER: readonly Engine[] = ["google_aio", "chatgpt", "gemini", "perplexity", "claude"];

const live = (r: { stopped_on: string | null }) => r.stopped_on === null;
const addDays = (d: Day, n: number): Day => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) : null);

function liveClusters(raw: Raw) {
  return raw.clusters.filter(live).sort((a, b) => a.started_on.localeCompare(b.started_on) || a.name.localeCompare(b.name));
}

/** Position history by keyword, oldest first. */
function serpBy(raw: Raw): Map<string, [Day, number | null][]> {
  const out = new Map<string, [Day, number | null][]>();
  for (const s of [...raw.serp].sort((a, b) => a.run_date.localeCompare(b.run_date))) {
    const l = out.get(s.keyword_id) ?? [];
    l.push([s.run_date, s.position]);
    out.set(s.keyword_id, l);
  }
  return out;
}

/** The latest position and the one a week before it, as the dashboard's keyword change reads them (dash/model.ts). */
function positionOf(hist: readonly [Day, number | null][]): { now: number | null; before: number | null } {
  const cur = hist.at(-1);
  if (!cur) return { now: null, before: null };
  const weekAgo = [...hist].reverse().find(([d]) => d <= addDays(cur[0], -7));
  return { now: cur[1], before: weekAgo?.[1] ?? null };
}

/**
 * The cluster an email leads with: the first live cluster (the dashboard's
 * order) that has a keyword, else the first live cluster; null with none.
 * `clusterId` picks one.
 */
export function focusCluster(raw: Raw, forms: Forms, clusterId?: string): Focus | null {
  const all = liveClusters(raw);
  const c = (clusterId ? all.find((x) => x.id === clusterId) : null) ?? all.find((x) => x.keyword_id) ?? all[0];
  if (!c) return null;
  const head = c.keyword_id ? raw.keywords.find((k) => k.id === c.keyword_id) ?? null : null;
  const pairKw = head ? raw.keywords.find((k) => live(k) && forms.get(k.id)?.pair_of === head.id && (forms.get(k.id)?.form === "plural" || forms.get(k.id)?.form === "singular")) ?? null : null;
  const pairForm = pairKw ? forms.get(pairKw.id)!.form : null;
  const headLabel = pairForm === "plural" ? "singular" : pairForm === "singular" ? "plural" : null;
  const hist = serpBy(raw);
  const positions: Position[] = [];
  if (head) positions.push({ keyword: head.keyword, label: headLabel, ...positionOf(hist.get(head.id) ?? []) });
  if (pairKw) positions.push({ keyword: pairKw.keyword, label: pairForm, ...positionOf(hist.get(pairKw.id) ?? []) });
  const target = chosenTarget(raw.keyPages ?? [], c.id);
  return { clusterId: c.id, name: c.name, keyword: head?.keyword ?? null, pair: pairKw?.keyword ?? null, target: target ? targetLabel(target) : null, positions: positions.filter((p) => p.now !== null || p.before !== null) };
}

/** "Google, singular" / "on Google" - the tile label for a position. */
export const positionLabel = (p: Position, lead = "Google") => (p.label ? `${lead}, ${p.label}` : lead);

/** "up 1 from #7", "down 2 from #4", "no change" - or null without a week-old position. */
export function positionMove(p: Pick<Position, "now" | "before">): { text: string; tone: "good" | "bad" | "quiet" } | null {
  if (p.now === null || p.before === null) return null;
  if (p.now === p.before) return { text: "no change on last week", tone: "quiet" };
  const up = p.now < p.before;
  return { text: `${up ? "up" : "down"} ${Math.abs(p.before - p.now)} from #${p.before}`, tone: up ? "good" : "bad" };
}

// ------------------------------------------------------------------ readings

/** Answers on live, plan prompts only, as the dashboard counts them. */
function planAnswers(raw: Raw): RawAnswer[] {
  const ids = new Set(raw.prompts.filter((p) => live(p) && p.allowance !== "placement").map((p) => p.id));
  return raw.answers.filter((a) => ids.has(a.question_id));
}

const own = (raw: Raw) => raw.client.domain.replace(/^www\./, "").toLowerCase();
const isOwn = (raw: Raw, d: string) => d === own(raw) || d.endsWith(`.${own(raw)}`);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

/** Brands named in these answers, other than the client, most answers first. */
function otherBrands(raw: Raw, rows: readonly RawAnswer[], n: number): { name: string; answers: number }[] {
  const you = subjectKeys(raw.client.brand ?? raw.client.domain, raw.client.domain);
  for (const a of raw.client.brand_aliases ?? []) you.add(brandKey(a));
  const by = new Map<string, { name: string; answers: number }>();
  for (const a of rows) {
    for (const b of new Set((a.brands ?? []).map(String))) {
      const k = brandKey(b);
      if (!k || you.has(k)) continue;
      const had = by.get(k);
      by.set(k, { name: had?.name ?? b, answers: (had?.answers ?? 0) + 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name)).slice(0, n);
}

/** The cited domain, not the client's, in the most of these answers; with how many and on how many engines. */
function topSource(raw: Raw, rows: readonly RawAnswer[]): { domain: string; answers: number; engines: number } | null {
  const by = new Map<string, { answers: Set<string>; engines: Set<string> }>();
  for (const a of rows) {
    const key = `${a.run_date} ${a.question_id} ${a.engine}`;
    for (const c of a.citations ?? []) {
      const d = (c.source_domain ?? hostOf(c.url) ?? "").replace(/^www\./, "").toLowerCase();
      if (!d || isOwn(raw, d)) continue;
      const s = by.get(d) ?? { answers: new Set(), engines: new Set() };
      s.answers.add(key);
      s.engines.add(a.engine);
      by.set(d, s);
    }
  }
  const best = [...by].sort((a, b) => b[1].answers.size - a[1].answers.size || a[0].localeCompare(b[0]))[0];
  return best ? { domain: best[0], answers: best[1].answers.size, engines: best[1].engines.size } : null;
}

export type FirstReading = {
  day: Day;
  named: number;
  answers: number;
  byEngine: { engine: string; named: number; answers: number }[];
  instead: { name: string; answers: number }[];
  source: { domain: string; answers: number } | null;
  opportunities: number;
};

/** The first reading's figures: the latest reading held, as the dashboard's latest-day rate reads it. Null before any answer. */
export function firstReadingFigures(raw: Raw): FirstReading | null {
  const rows = planAnswers(raw);
  const day = [...new Set(rows.map((a) => a.run_date))].sort().at(-1);
  if (!day) return null;
  const today = rows.filter((a) => a.run_date === day);
  const answered = today.filter((a) => a.answered);
  const byEngine = ENGINE_ORDER.map((e) => {
    const on = answered.filter((a) => a.engine === e);
    return { engine: ENGINE_LABEL[e], named: on.filter((a) => a.named).length, answers: on.length };
  }).filter((r) => r.answers > 0);
  const src = topSource(raw, today);
  return {
    day,
    named: answered.filter((a) => a.named).length,
    answers: answered.length,
    byEngine,
    instead: otherBrands(raw, answered, 3),
    source: src ? { domain: src.domain, answers: src.answers } : null,
    opportunities: raw.opportunities.length,
  };
}

export type WeekFigures = {
  /** Readings in the last seven reading days held (at most 7). */
  readings: number;
  /** Share of answered answers naming the client over those readings, and over the seven before; null with no answers. */
  pct: number | null;
  before: number | null;
};

/** This week against the week before, on the last 7 readings and the 7 before them. */
export function weekFigures(raw: Raw): WeekFigures {
  const rows = planAnswers(raw);
  const days = [...new Set(rows.map((a) => a.run_date))].sort();
  const now = new Set(days.slice(-7));
  const prev = new Set(days.slice(-14, -7));
  const rate = (set: Set<Day>) => {
    const a = rows.filter((r) => set.has(r.run_date) && r.answered);
    return pct(a.filter((r) => r.named).length, a.length);
  };
  return { readings: now.size, pct: rate(now), before: prev.size ? rate(prev) : null };
}

/** The week's points change, or null when either week has no rate. */
export const pointsChange = (w: Pick<WeekFigures, "pct" | "before">): number | null => (w.pct !== null && w.before !== null ? w.pct - w.before : null);

/**
 * Whether the week went down: fewer points of answers naming the client, or
 * the same share with the lead keyword lower on Google. Said plainly in #7's
 * subject and headline (brief 2e: "Don't spin").
 */
export function weekDirection(w: Pick<WeekFigures, "pct" | "before">, lead: Pick<Position, "now" | "before"> | null): "up" | "down" | "flat" {
  const d = pointsChange(w);
  if (d !== null && d !== 0) return d > 0 ? "up" : "down";
  if (lead && lead.now !== null && lead.before !== null && lead.now !== lead.before) return lead.now < lead.before ? "up" : "down";
  return "flat";
}

export type TrialFigures = {
  readings: number;
  answers: number;
  pct: number | null;
  firstPct: number | null;
  best: { text: string; named: number; answers: number } | null;
  worst: { text: string; named: number; answers: number } | null;
  source: { domain: string; answers: number; engines: number } | null;
  bestPosition: number | null;
};

/** A trial so far: readings, answers, the share naming the client and on day one, the best and worst prompt this week, the source worth getting into, the best Google position. */
export function trialFigures(raw: Raw): TrialFigures | null {
  const rows = planAnswers(raw);
  const days = [...new Set(rows.map((a) => a.run_date))].sort();
  if (!days.length) return null;
  const answered = rows.filter((a) => a.answered);
  const first = answered.filter((a) => a.run_date === days[0]);
  const week = new Set(days.slice(-7));
  const inWeek = answered.filter((a) => week.has(a.run_date));
  const byPrompt = raw.prompts
    .filter((p) => live(p) && p.allowance !== "placement")
    .map((p) => {
      const a = inWeek.filter((r) => r.question_id === p.id);
      return { text: p.text, named: a.filter((r) => r.named).length, answers: a.length };
    })
    .filter((p) => p.answers > 0)
    .sort((a, b) => b.named / b.answers - a.named / a.answers || b.answers - a.answers || a.text.localeCompare(b.text));
  const best = byPrompt.length >= 2 ? byPrompt[0]! : null;
  const worst = byPrompt.length >= 2 ? byPrompt.at(-1)! : null;
  const positions = raw.serp.map((s) => s.position).filter((p): p is number => typeof p === "number");
  return {
    readings: days.length,
    answers: answered.length,
    pct: pct(answered.filter((a) => a.named).length, answered.length),
    firstPct: pct(first.filter((a) => a.named).length, first.length),
    best: best && worst && best.named / best.answers !== worst.named / worst.answers ? best : null,
    worst: best && worst && best.named / best.answers !== worst.named / worst.answers ? worst : null,
    source: topSource(raw, inWeek),
    bestPosition: positions.length ? Math.min(...positions) : null,
  };
}

// ---------------------------------------------------------------- setup

export type SetupStatus = { cluster: string; keyword: string | null; pair: string | null; target: string | null; prompts: number };

/** The first live cluster whose setup is not finished - no keyword, no target page, or fewer than `need` prompts - or null when every one is. */
export function setupStatus(raw: Raw, forms: Forms, need: number): SetupStatus | null {
  for (const c of liveClusters(raw)) {
    const f = focusCluster(raw, forms, c.id)!;
    const prompts = raw.prompts.filter((p) => live(p) && p.cluster_id === c.id && p.allowance !== "placement").length;
    if (!f.keyword || !f.target || prompts < need) return { cluster: c.name, keyword: f.keyword, pair: f.pair, target: f.target, prompts };
  }
  return null;
}

/** The prompts a cluster is checked on, with their angles. */
export function clusterPrompts(raw: Raw, clusterId: string): { text: string; angle: string | null }[] {
  return raw.prompts.filter((p) => live(p) && p.cluster_id === clusterId && p.allowance !== "placement").map((p) => ({ text: p.text, angle: p.angle }));
}

// ---------------------------------------------------------------- the work

/** What each worked plan delivers a month (brief 2e): 3 placements; on the alwayscited plan 2+ link insertions too. */
export const DELIVERABLES: Partial<Record<TierKey, { placements: number; insertions: number | null }>> = {
  mentioned: { placements: 3, insertions: null },
  cited: { placements: 3, insertions: 2 },
};

export type WorkRow = { domain: string; what: string; anchor: string | null; status: string; tone: "good" | "quiet" };

export type Work = { rows: WorkRow[]; placementsLive: number; insertionsLive: number; onSiteLive: number; target: { placements: number; insertions: number | null } | null };

const KIND: Record<RawPlacement["kind"], string> = { guest_post: "placement", link_insertion: "link insertion", on_site: "on-site work", coverage: "coverage" };
const STATUS: Record<RawPlacement["status"], string> = { pitched: "Pitched", writing: "Writing", scheduled: "Scheduled", live: "Live", removed: "Removed" };

/**
 * The month's work for #7's "The work this week" table: placements live this
 * month or still in hand, and the month to date against the plan's
 * deliverables. Null on alwaystracked (nothing is worked) and when there is
 * no row to show.
 */
export function workThisMonth(raw: Raw): Work | null {
  if (raw.client.tier === "tracked") return null;
  const month = raw.today.slice(0, 7);
  const inMonth = raw.placements.filter((p) => !p.sample && p.status !== "removed" && (p.status === "live" ? (p.live_on ?? "").startsWith(month) : true));
  if (!inMonth.length) return null;
  const order = { live: 0, scheduled: 1, writing: 2, pitched: 3, removed: 4 } as const;
  const rows = [...inMonth]
    .sort((a, b) => order[a.status] - order[b.status] || a.domain.localeCompare(b.domain))
    .map((p) => ({
      domain: p.domain,
      what: KIND[p.kind],
      anchor: p.anchor_text,
      status: p.status === "scheduled" && p.scheduled_on ? `Scheduled ${p.scheduled_on.slice(8, 10).replace(/^0/, "")} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(p.scheduled_on.slice(5, 7)) - 1]}` : STATUS[p.status],
      tone: p.status === "live" ? ("good" as const) : ("quiet" as const),
    }));
  const liveOf = (k: RawPlacement["kind"]) => inMonth.filter((p) => p.status === "live" && p.kind === k).length;
  return { rows, placementsLive: liveOf("guest_post") + liveOf("coverage"), insertionsLive: liveOf("link_insertion"), onSiteLive: liveOf("on_site"), target: DELIVERABLES[raw.client.tier] ?? null };
}

/** "Month to date: 2 of 3 placements live, 0 of 2+ insertions, 1 on-site change live." */
export function monthToDate(w: Work): string {
  const parts = [w.target ? `${w.placementsLive} of ${w.target.placements} placements live` : `${w.placementsLive} ${w.placementsLive === 1 ? "placement" : "placements"} live`];
  if (w.target?.insertions) parts.push(`${w.insertionsLive} of ${w.target.insertions}+ insertions`);
  else if (w.insertionsLive) parts.push(`${w.insertionsLive} ${w.insertionsLive === 1 ? "insertion" : "insertions"} live`);
  if (w.onSiteLive) parts.push(`${w.onSiteLive} on-site ${w.onSiteLive === 1 ? "change" : "changes"} live`);
  return `Month to date: ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------- who sees what

export type UpsellMode = "nomada" | "agency" | "off";

/** What a send site hands the templates' merge: the client's dashboard rows, its keyword forms and its account's mode (merge-source.ts reads it). */
export type MergeInput = { raw: Raw; forms: Forms; mode: UpsellMode; agency: string | null; engines: string[] };

/**
 * The one upsell line (#6 only): on alwaystracked, only when
 * accounts.upsell_mode is not 'off', and never in a client-facing email.
 */
export function upsellAllowed(p: { tier: TierKey; mode: UpsellMode; clientFacing: boolean }): boolean {
  return p.tier === "tracked" && p.mode !== "off" && !p.clientFacing;
}

/**
 * Whether an email to this member is client-facing: always for the invite
 * (#8); otherwise to a non-owner member of an account in agency mode - the
 * agency's own client, whom the site promises the agency we will not contact
 * for anything but the service itself.
 */
export function clientFacing(p: { email: "invite" | "other"; role: string | null; mode: UpsellMode }): boolean {
  return p.email === "invite" || (p.mode === "agency" && p.role !== "owner");
}
