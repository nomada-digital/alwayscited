import { type AnswerRow, type CitationRow, type Day, type Range, type Rate, citedPage, namedRate, rate } from "../../tracking/figures.ts";

/**
 * Per-engine readings for the AI visibility page and the Overview's "What it
 * means" (13 Oct 2026, DIY P4; spec 10 sections 4.1 row 3b and 4.2 rows 2
 * and 4). Every figure here is figures.ts namedRate narrowed to one engine,
 * or a count with its denominator: no new figure definition (section 2.6).
 * An engine that returned no answer is out of its own denominator, as every
 * figure leaves it.
 */

export type EngineRate = { engine: string; rate: Rate };

/** Each engine's answers naming the client over the range, in the tier's order; `only` narrows to those prompts. */
export function engineRates(rows: readonly AnswerRow[], range: Range, engines: readonly string[], only?: ReadonlySet<string> | null): EngineRate[] {
  return engines.map((engine) => ({ engine, rate: namedRate(rows.filter((a) => a.engine === engine) as AnswerRow[], range, only ? new Set(only) : undefined) }));
}

/** The engines that answered at all. */
export const answering = (rates: readonly EngineRate[]) => rates.filter((r) => r.rate.den > 0);

/** The engine naming the client in the largest share of its answers; a tie goes to more answers named, then the tier's order. Null with none answering. */
export function strongestEngine(rates: readonly EngineRate[]): EngineRate | null {
  const live = answering(rates);
  return live.reduce<EngineRate | null>((best, r) => (!best || r.rate.pct! > best.rate.pct! || (r.rate.pct === best.rate.pct && r.rate.num > best.rate.num) ? r : best), null);
}

/** The engine naming the client in the smallest share of its answers; a tie goes to fewer answers named, then the tier's order. */
export function weakestEngine(rates: readonly EngineRate[]): EngineRate | null {
  const live = answering(rates);
  return live.reduce<EngineRate | null>((low, r) => (!low || r.rate.pct! < low.rate.pct! || (r.rate.pct === low.rate.pct && r.rate.num < low.rate.num) ? r : low), null);
}

/** The days in the range with at least one answered read, oldest first. */
export function checkDaysIn(rows: readonly AnswerRow[], range: Range): Day[] {
  return [...new Set(rows.filter((a) => a.answered && a.run_date >= range.from && a.run_date <= range.to).map((a) => a.run_date))].sort();
}

export type StartNow = { engine: string; then: number; now: number; of: number };

/**
 * Start against now, by engine (section 4.2 row 4): the first check in the
 * range against the latest, like for like - per engine, only the prompts it
 * answered on both days, so a prompt added since, or a read missing on either
 * day, is in neither count. Null with fewer than two checks in the range.
 */
export function startAgainstNow(rows: readonly AnswerRow[], range: Range, engines: readonly string[], only?: ReadonlySet<string> | null): { from: Day; to: Day; rows: StartNow[] } | null {
  const days = checkDaysIn(only ? rows.filter((a) => only.has(a.question_id)) : rows, range);
  if (days.length < 2) return null;
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const out: StartNow[] = [];
  for (const engine of engines) {
    const at = (day: Day) => new Map(rows.filter((a) => a.engine === engine && a.run_date === day && a.answered && (!only || only.has(a.question_id))).map((a) => [a.question_id, a.named]));
    const a = at(from);
    const b = at(to);
    const both = [...a.keys()].filter((q) => b.has(q));
    if (!both.length) continue;
    out.push({ engine, then: both.filter((q) => a.get(q)).length, now: both.filter((q) => b.get(q)).length, of: both.length });
  }
  return { from, to, rows: out };
}

/**
 * Answers citing the client's site, counted only among answers that returned
 * sources (section 4.2 row 2): an answer with no citation at all could not
 * have cited anyone, so it is in neither count.
 */
export function citingShare(rows: readonly (AnswerRow & CitationRow)[], range: Range, domain: string, only?: ReadonlySet<string> | null): Rate {
  const own = domain.toLowerCase().replace(/^www\./, "");
  let num = 0;
  let den = 0;
  for (const a of rows) {
    if (!a.answered || a.run_date < range.from || a.run_date > range.to || (only && !only.has(a.question_id)) || !a.citations.length) continue;
    den++;
    if (a.citations.some((c) => { const p = citedPage(c); return !!p && (p.host === own || p.host.endsWith(`.${own}`)); })) num++;
  }
  return rate(num, den);
}
