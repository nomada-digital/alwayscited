import { brandKey } from "../scan/brand-name.ts";
import { ENGINES, type Engine } from "../scan/engines.ts";

/**
 * Share of voice and share of page 1 (Danny, 15 Nov 2026, approved views). Pure.
 *
 * Share of voice: of the answers given in a window, the share naming each brand - the customer by the answer's own
 * `named` (the runner's matcher), everyone else by the brands the runner already extracted (tracking_answers.brands).
 * No new model call. The window is the 7 days to the latest reading; the changes compare it with the 7 days to a week
 * earlier and to 30 days earlier.
 *
 * Share of page 1: each keyword's top 10 organic results weighted by a standard click-through curve, plus the AI
 * Overview as one more slot of its own, its weight split between the sites it cites.
 */

export type SovAnswer = { run_date: string; question_id: string; engine: string; answered: boolean; named: boolean; brands?: string[] | null };
export type SovRow = { key: string; name: string; you: boolean; share: number; engines: Partial<Record<Engine, number | null>>; d7: number | null; d30: number | null };
export type SovScope = { id: string; name: string; answers: number; rows: SovRow[]; rank: number | null; of: number };

export const SOV_COMPETITORS = 8;

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

type Tally = { answered: number; byKey: Map<string, number>; names: Map<string, Map<string, number>> };

function tally(answers: SovAnswer[], subject: Set<string>): Tally {
  const t: Tally = { answered: 0, byKey: new Map(), names: new Map() };
  for (const a of answers) {
    if (!a.answered) continue;
    t.answered++;
    const keys = new Set<string>();
    if (a.named) keys.add("@you");
    for (const b of a.brands ?? []) {
      const key = brandKey(String(b));
      if (!key || subject.has(key)) continue;
      keys.add(key);
      const n = t.names.get(key) ?? new Map<string, number>();
      n.set(String(b), (n.get(String(b)) ?? 0) + 1);
      t.names.set(key, n);
    }
    for (const k of keys) t.byKey.set(k, (t.byKey.get(k) ?? 0) + 1);
  }
  return t;
}

const shareIn = (t: Tally, key: string): number | null => (t.answered ? (t.byKey.get(key) ?? 0) / t.answered : null);
const commonest = (m: Map<string, number> | undefined, fallback: string) => (m ? [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0] : fallback);

/** One scope's table: the customer and its top competitors over the latest 7 days, with the changes and per engine. */
export function sovScope(id: string, name: string, answers: SovAnswer[], o: { subject: Set<string>; you: string; latest: string; engines: readonly Engine[] }): SovScope {
  const inWin = (from: string, to: string) => answers.filter((a) => a.run_date >= from && a.run_date <= to);
  const cur = inWin(addDays(o.latest, -6), o.latest);
  const t = tally(cur, o.subject);
  const w7 = tally(inWin(addDays(o.latest, -13), addDays(o.latest, -7)), o.subject);
  const w30 = tally(inWin(addDays(o.latest, -36), addDays(o.latest, -30)), o.subject);
  const perEngine = new Map(o.engines.map((e) => [e, tally(cur.filter((a) => a.engine === e), o.subject)]));
  const ranked = [...t.byKey].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const youCount = t.byKey.get("@you") ?? 0;
  const row = (key: string): SovRow => {
    const share = shareIn(t, key) ?? 0;
    const delta = (w: Tally) => {
      const before = shareIn(w, key);
      return before === null || !t.answered ? null : share - before;
    };
    return {
      key,
      name: key === "@you" ? o.you : commonest(t.names.get(key), key),
      you: key === "@you",
      share,
      engines: Object.fromEntries([...perEngine].map(([e, et]) => [e, shareIn(et, key)])),
      d7: delta(w7),
      d30: delta(w30),
    };
  };
  const competitors = ranked.filter(([k]) => k !== "@you").slice(0, SOV_COMPETITORS).map(([k]) => row(k));
  const rows = [row("@you"), ...competitors].sort((a, b) => b.share - a.share || (a.you ? -1 : b.you ? 1 : a.name.localeCompare(b.name)));
  const of = ranked.length + (t.byKey.has("@you") ? 0 : 1);
  return { id, name, answers: t.answered, rows, rank: t.answered ? ranked.filter(([k, n]) => k !== "@you" && n > youCount).length + 1 : null, of };
}

/** Overall, then each cluster with answers, by its prompts. */
export function shareOfVoice(answers: SovAnswer[], o: { clusters: { id: string; name: string; questionIds: string[] }[]; subject: Set<string>; you: string; engines?: readonly Engine[] }): SovScope[] {
  const latest = answers.reduce((m, a) => (a.run_date > m ? a.run_date : m), "");
  if (!latest) return [];
  const opts = { subject: o.subject, you: o.you, latest, engines: o.engines ?? ENGINES };
  const scopes = [sovScope("all", "All clusters", answers, opts)];
  for (const c of o.clusters) {
    const ids = new Set(c.questionIds);
    const s = sovScope(c.id, c.name, answers.filter((a) => ids.has(a.question_id)), opts);
    if (s.answers) scopes.push(s);
  }
  return scopes;
}

/** Click-through by organic position 1 to 10: a standard desktop curve (Advanced Web Ranking's, 2024), rounded. */
export const CTR = [0.28, 0.16, 0.11, 0.08, 0.065, 0.05, 0.04, 0.033, 0.028, 0.024];
/** The AI Overview counted as a slot of its own, weighted as a second position, split between the sites it cites. */
export const AIO_WEIGHT = 0.16;

const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");
export const sameSite = (host: string, domain: string) => {
  const h = bare(host);
  const d = bare(domain);
  return h === d || h.endsWith(`.${d}`);
};

export type PageOne = { total: number; you: number; sites: Map<string, number> };

/** One keyword's page 1: the weight each site holds, the customer's included. `aio` is the Overview's cited sites, null when none showed. */
export function pageOne(top: { rank: number; domain: string }[], aio: string[] | null, domain: string): PageOne {
  const sites = new Map<string, number>();
  let total = 0;
  for (const r of top) {
    const w = CTR[r.rank - 1];
    if (!w || !r.domain) continue;
    total += w;
    const d = sameSite(r.domain, domain) ? bare(domain) : bare(r.domain);
    sites.set(d, (sites.get(d) ?? 0) + w);
  }
  const cited = [...new Set((aio ?? []).map((d) => (sameSite(d, domain) ? bare(domain) : bare(d))).filter((d) => d && !/^google\./.test(d)))];
  if (aio) {
    total += AIO_WEIGHT;
    for (const d of cited) sites.set(d, (sites.get(d) ?? 0) + AIO_WEIGHT / cited.length);
  }
  return { total, you: sites.get(bare(domain)) ?? 0, sites };
}

/** Every keyword's page 1 together: each site's share of all the weight, the customer first, then the leaders. */
export function pageOneOverall(pages: PageOne[], domain: string, n = 6): { site: string; share: number; you: boolean }[] {
  const total = pages.reduce((s, p) => s + p.total, 0);
  if (!total) return [];
  const sum = new Map<string, number>();
  for (const p of pages) for (const [d, w] of p.sites) sum.set(d, (sum.get(d) ?? 0) + w);
  const you = bare(domain);
  const rows = [...sum].map(([site, w]) => ({ site, share: w / total, you: site === you }));
  const lead = rows.filter((r) => !r.you).sort((a, b) => b.share - a.share).slice(0, n);
  return [rows.find((r) => r.you) ?? { site: you, share: 0, you: true }, ...lead].sort((a, b) => b.share - a.share);
}
