import { brandKey, pickDisplayName, subjectKeys } from "../../scan/brand-name.ts";
import { ENGINE_SPECS, isEngine } from "../../scan/engines.ts";
import { type AnswerRow, type Day, type SerpRow, addDays, brandsRead, citedPage, formatDay } from "../../tracking/figures.ts";
import { runLostReads } from "../../tracking/run-note.ts";

/**
 * "Since last check" (13 Oct 2026, DIY P4; spec 10 section 6.8): what changed
 * over the last week of checks, as lines a rule writes, most important first.
 * Pure: the Overview hands it the last seven days of readings, whatever range
 * the page shows, and draws what comes back.
 *
 * Readings, not days (section 2.6 rules 1 and 10). A prompt on one engine is
 * read on the days that engine actually answered it; a keyword on the days
 * Google was read for it. The three latest readings of each are d0, d1 and
 * d2, and a status line is written only when d0 and d1 agree and differ from
 * d2 - "held, not glimpsed". A day a pair was not read is skipped, so a
 * partial check hides nothing and invents nothing. A pair with fewer than
 * three readings is skipped.
 *
 * The lines say what the readings show and nothing about why: a prompt
 * stopped naming you and another brand is named there now, never "in your
 * place" (the 12 Oct email review's L4), and no causal word.
 */

/** The window, in days ending today. */
export const RECENT_DAYS = 7;
/** Lines shown; the rest are a count. */
export const MAX_LINES = 8;
/** Lost and won prompt lines are grouped per engine above this many of a kind. */
export const GROUP_ABOVE = 3;
/** A new brand: named in at least this many answers on each of the latest two days of checks. */
export const NEW_BRAND_MIN = 3;

export type ChangeKind = "check" | "lost" | "left_page1" | "won" | "entered_page1" | "new_brand" | "own_page" | "watched";

/** The order the lines are written in (section 6.8). */
export const CHANGE_ORDER: readonly ChangeKind[] = ["check", "lost", "left_page1", "won", "entered_page1", "new_brand", "own_page", "watched"];

/**
 * Where a line's evidence is. The page turns each into a link: an answer on
 * the one-cluster page, an engine on /ai, a keyword (plain text until the
 * Google page exists), the client's own cited pages, a brand on Who is named,
 * or a link the caller already built (watched pages, from W2).
 */
export type ChangeLink =
  | { to: "answer"; question: string; day: Day; engine: string }
  | { to: "engine"; engine: string }
  | { to: "keyword"; keyword: string }
  | { to: "cited" }
  | { to: "named"; key: string }
  | { to: "href"; href: string };

export type ChangeLine = { kind: ChangeKind; text: string; link: ChangeLink | null };

/** A pursued page or a placement the client watches (W2): its first citation, when one is known. */
export type Watched = { urlKey: string; label: string; href: string | null; firstCited: { day: Day; engine: string } | null };

export type DiffAnswer = AnswerRow & { citations?: { source_domain: string; url: string | null }[] };

export type DiffInput = {
  today: Day;
  /** Answers with their brands and citations; anything outside the window is ignored. */
  answers: readonly DiffAnswer[];
  serp: readonly SerpRow[];
  runs?: readonly { run_date: Day; status: string; error?: string | null }[];
  /** The prompts lines may name, in the order the page lists them. */
  prompts: readonly { id: string; text: string }[];
  /** The keywords lines may name: cluster keywords, or every live keyword on a client with no clusters. */
  keywords: readonly { id: string; keyword: string }[];
  brand: string;
  domain: string;
  /** The tier's engines, in its order. */
  engines: readonly string[];
  watched?: readonly Watched[];
};

export type Diff = { state: "early"; days: number } | { state: "ok"; days: number; lines: ChangeLine[]; more: number };

const label = (e: string) => (isEngine(e) ? ENGINE_SPECS[e].label : e);
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** 1st, 2nd, 3rd, 11th, 21st. */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** The days of the window, oldest first. */
export const recentRange = (today: Day) => ({ from: addDays(today, -(RECENT_DAYS - 1)), to: today });

/**
 * The reads a run's error line counts as failed, per engine id (decide.ts
 * failureSummary: "4 of 21 reads failed - gemini: 4 x HTTP 429; keyword: 1 x
 * timeout"). Only ids and counts are read back, never the reasons.
 */
export function failedCounts(error: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of (error ?? "").matchAll(/(?:- |; )([a-z_]+): (\d+) x /g)) out.set(m[1]!, (out.get(m[1]!) ?? 0) + Number(m[2]));
  return out;
}

/** Line 1: the latest finished check, when it lost reads. */
function checkLine(input: DiffInput, from: Day): ChangeLine | null {
  const finished = (input.runs ?? []).filter((r) => r.run_date >= from && r.run_date <= input.today && (r.status === "complete" || r.status === "partial" || r.status === "failed"));
  const last = [...finished].sort((a, b) => b.run_date.localeCompare(a.run_date))[0];
  if (!last || !runLostReads(last)) return null;
  const on = `Your check on ${formatDay(last.run_date)}`;
  if (last.status === "failed") {
    const stored = input.answers.some((a) => a.run_date === last.run_date && a.answered);
    return { kind: "check", text: stored ? `${on} did not finish, so some of its reads may be missing.` : `${on} failed: none of its reads came back.`, link: null };
  }
  const parts: string[] = [];
  for (const [id, n] of failedCounts(last.error)) {
    if (id === "keyword") parts.push(`${plural(n, "Google keyword position was", "Google keyword positions were")} not read`);
    else if (isEngine(id)) parts.push(`${label(id)} did not answer ${plural(n, "prompt", "prompts")}`);
  }
  return { kind: "check", text: `${on} was partial: ${parts.length ? and(parts) : "some reads did not come back"}.`, link: null };
}

type Reading = { day: Day; row: DiffAnswer };

/** A pair's readings in the window, newest first: one per day it was actually answered. */
function readingsOf(rows: readonly DiffAnswer[]): Reading[] {
  const byDay = new Map<Day, DiffAnswer>();
  for (const a of rows) if (a.answered && !byDay.has(a.run_date)) byDay.set(a.run_date, a);
  return [...byDay].map(([day, row]) => ({ day, row })).sort((x, y) => y.day.localeCompare(x.day));
}

/** The first brand named at d0 that was not named at d2, the client left out; null when either answer's brands were not read. */
function newHere(d0: DiffAnswer, d2: DiffAnswer, you: Set<string>): string | null {
  if (!brandsRead(d0) || !brandsRead(d2)) return null;
  const before = new Set(d2.brands.map(brandKey));
  return d0.brands.find((b) => !you.has(brandKey(b)) && !before.has(brandKey(b)) && brandKey(b) !== "") ?? null;
}

/** Lines 2 and 4: prompts lost and won on an engine, held over two readings. */
function promptLines(input: DiffInput, inWindow: readonly DiffAnswer[]): { lost: ChangeLine[]; won: ChangeLine[] } {
  const you = subjectKeys(input.brand, input.domain);
  const byPair = new Map<string, DiffAnswer[]>();
  for (const a of inWindow) {
    const k = `${a.question_id} ${a.engine}`;
    const list = byPair.get(k);
    if (list) list.push(a);
    else byPair.set(k, [a]);
  }
  const lost: (ChangeLine & { engine: string })[] = [];
  const won: (ChangeLine & { engine: string })[] = [];
  for (const engine of input.engines) {
    for (const p of input.prompts) {
      const [d0, d1, d2] = readingsOf(byPair.get(`${p.id} ${engine}`) ?? []);
      if (!d0 || !d1 || !d2) continue;
      if (d0.row.named !== d1.row.named || d1.row.named === d2.row.named) continue;
      const link: ChangeLink = { to: "answer", question: p.id, day: d0.day, engine };
      if (d2.row.named) {
        const rival = newHere(d0.row, d2.row, you);
        const tail = rival ? ` ${rival} is named there now; it wasn't on ${formatDay(d2.day)}.` : "";
        lost.push({ kind: "lost", text: `${label(engine)} stopped naming you for '${p.text}'.${tail}`, link, engine });
      } else {
        won.push({ kind: "won", text: `${label(engine)} started naming you for '${p.text}'.`, link, engine });
      }
    }
  }
  const group = (lines: (ChangeLine & { engine: string })[], kind: "lost" | "won"): ChangeLine[] => {
    if (lines.length <= GROUP_ABOVE) return lines.map((l) => ({ kind: l.kind, text: l.text, link: l.link }));
    return input.engines.flatMap((engine) => {
      const mine = lines.filter((l) => l.engine === engine);
      if (!mine.length) return [];
      if (mine.length === 1) return [{ kind, text: mine[0]!.text, link: mine[0]!.link }];
      const verb = kind === "lost" ? "stopped naming you" : "started naming you";
      return [{ kind, text: `${label(engine)} ${verb} for ${mine.length} prompts.`, link: { to: "engine", engine } as ChangeLink }];
    });
  };
  return { lost: group(lost, "lost"), won: group(won, "won") };
}

/** Lines 3 and 5: keywords leaving and entering page 1, held over two readings. */
function keywordLines(input: DiffInput, from: Day): { left: ChangeLine[]; entered: ChangeLine[] } {
  const left: ChangeLine[] = [];
  const entered: ChangeLine[] = [];
  const at = (p: number | null) => (p === null ? "outside the top 20" : ordinal(p));
  for (const k of input.keywords) {
    const byDay = new Map<Day, number | null>();
    for (const s of input.serp) if (s.keyword_id === k.id && s.run_date >= from && s.run_date <= input.today && !byDay.has(s.run_date)) byDay.set(s.run_date, s.position);
    const [r0, r1, r2] = [...byDay].sort((x, y) => y[0].localeCompare(x[0]));
    if (!r0 || !r1 || !r2) continue;
    const on = (p: number | null) => p !== null && p <= 10;
    if (on(r0[1]) !== on(r1[1]) || on(r1[1]) === on(r2[1])) continue;
    const link: ChangeLink = { to: "keyword", keyword: k.id };
    if (on(r2[1])) left.push({ kind: "left_page1", text: `'${k.keyword}' left page 1: ${at(r2[1])} to ${at(r0[1])}.`, link });
    else entered.push({ kind: "entered_page1", text: `'${k.keyword}' entered page 1: ${at(r2[1])} to ${at(r0[1])}.`, link });
  }
  return { left, entered };
}

/** The latest days with a reading, newest first: the days of checks. */
function checkDays(inWindow: readonly DiffAnswer[]): Day[] {
  return [...new Set(inWindow.filter((a) => a.answered).map((a) => a.run_date))].sort().reverse();
}

/** Line 6: a brand named in at least 3 answers on each of the latest two days of checks and in none the day before. */
function brandLines(input: DiffInput, inWindow: readonly DiffAnswer[], days: Day[]): ChangeLine[] {
  const [c0, c1, c2] = days;
  if (!c0 || !c1 || !c2) return [];
  const you = subjectKeys(input.brand, input.domain);
  const counts = new Map<string, { n: number[]; spell: Map<string, number> }>();
  const read = [0, 0, 0];
  for (const a of inWindow) {
    const i = a.run_date === c0 ? 0 : a.run_date === c1 ? 1 : a.run_date === c2 ? 2 : -1;
    if (i < 0 || !a.answered || !brandsRead(a)) continue;
    read[i]!++;
    for (const b of new Set(a.brands)) {
      const key = brandKey(b);
      if (!key || you.has(key)) continue;
      const c = counts.get(key) ?? { n: [0, 0, 0], spell: new Map<string, number>() };
      c.n[i]!++;
      c.spell.set(b, (c.spell.get(b) ?? 0) + 1);
      counts.set(key, c);
    }
  }
  // Counted over the answers each day returned: a day whose brands were never read says nothing about "none".
  if (!read[2]) return [];
  return [...counts]
    .filter(([, c]) => c.n[0]! >= NEW_BRAND_MIN && c.n[1]! >= NEW_BRAND_MIN && c.n[2] === 0)
    .sort((x, y) => y[1].n[0]! + y[1].n[1]! - (x[1].n[0]! + x[1].n[1]!) || x[0].localeCompare(y[0]))
    .map(([key, c]) => ({
      kind: "new_brand" as const,
      text: `${pickDisplayName(c.spell)} was named in ${c.n[0]} answers on ${formatDay(c0)} and ${c.n[1]} on ${formatDay(c1)}, and in none on ${formatDay(c2)}.`,
      link: { to: "named", key } as ChangeLink,
    }));
}

/** Line 7: a page on the client's own domain started or stopped being cited, held over the latest three days of checks. */
function ownPageLines(input: DiffInput, inWindow: readonly DiffAnswer[], days: Day[]): ChangeLine[] {
  const [c0, c1, c2] = days;
  if (!c0 || !c1 || !c2) return [];
  const own = bare(input.domain);
  const cited = new Map<string, Set<Day>>();
  for (const a of inWindow) {
    if (!a.answered || (a.run_date !== c0 && a.run_date !== c1 && a.run_date !== c2)) continue;
    for (const c of a.citations ?? []) {
      const p = citedPage(c);
      if (!p || !(p.host === own || p.host.endsWith(`.${own}`))) continue;
      const d = cited.get(p.page) ?? new Set<Day>();
      d.add(a.run_date);
      cited.set(p.page, d);
    }
  }
  const out: ChangeLine[] = [];
  for (const [page, d] of [...cited].sort((x, y) => x[0].localeCompare(y[0]))) {
    const [s0, s1, s2] = [d.has(c0), d.has(c1), d.has(c2)];
    if (s0 !== s1 || s1 === s2) continue;
    out.push({
      kind: "own_page",
      text: s0 ? `Engines started citing ${page}: cited on ${formatDay(c1)} and ${formatDay(c0)}, not on ${formatDay(c2)}.` : `Engines stopped citing ${page}: cited on ${formatDay(c2)}, not on ${formatDay(c1)} or ${formatDay(c0)}.`,
      link: { to: "cited" },
    });
  }
  return out;
}

/** Line 8 (W2): a watched page or placement first cited inside the window. */
function watchedLines(input: DiffInput, from: Day): ChangeLine[] {
  return (input.watched ?? [])
    .filter((w) => w.firstCited && w.firstCited.day >= from && w.firstCited.day <= input.today)
    .sort((x, y) => y.firstCited!.day.localeCompare(x.firstCited!.day))
    .map((w) => ({
      kind: "watched" as const,
      text: `${w.label} was first cited by ${label(w.firstCited!.engine)} for one of your prompts on ${formatDay(w.firstCited!.day)}.`,
      link: w.href ? ({ to: "href", href: w.href } as ChangeLink) : null,
    }));
}

/**
 * The change list over the last RECENT_DAYS days. With fewer than three days
 * of checks in them there is nothing held to report, and the section says
 * changes start later ("early").
 */
export function diffChecks(input: DiffInput): Diff {
  const { from } = recentRange(input.today);
  const inWindow = input.answers.filter((a) => a.run_date >= from && a.run_date <= input.today);
  const days = checkDays(inWindow);
  if (days.length < 3) return { state: "early", days: days.length };
  const check = checkLine(input, from);
  const { lost, won } = promptLines(input, inWindow);
  const { left, entered } = keywordLines(input, from);
  const all = [...(check ? [check] : []), ...lost, ...left, ...won, ...entered, ...brandLines(input, inWindow, days), ...ownPageLines(input, inWindow, days), ...watchedLines(input, from)];
  return { state: "ok", days: days.length, lines: all.slice(0, MAX_LINES), more: Math.max(0, all.length - MAX_LINES) };
}
