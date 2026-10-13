import type { SupabaseClient } from "@supabase/supabase-js";

import { ENGINE_SPECS, type Engine } from "../../scan/engines.ts";
import { selectAll } from "../../supabase/page.ts";
import { type Day, type SerpRow, addDays, formatDay } from "../../tracking/figures.ts";
import type { DiyClient } from "../core/client.ts";
import { type Candidate, type CandidateSource, clip } from "./types.ts";
import { listWords, positionWords } from "./words.ts";

/**
 * Slipping, from the tracking data we already hold (13 Oct 2026, DIY P3;
 * spec 10 section 6.1, the Slipping row's tracking half). Free: no read is
 * paid for, and nothing is read but this client's own tracking rows.
 *
 * Readings, not days (section 2.6 rules 1 and 10). A keyword's reading is a
 * day it has a tracking_serp row; a prompt's reading on an engine is a day
 * that engine answered it. A day something was not read is skipped, never
 * read as a change, so a partial check hides nothing and invents nothing.
 *
 * - **A cluster keyword left page 1**: its last 3 readings are all off page 1
 *   (below 10th, or not in the top 20), and it was on page 1 at a reading
 *   before them in the window. Held over 3 readings, so one bad day does not
 *   fire; and still true while it stays off, so the suggestion does not drop
 *   as stale the day after it appears.
 * - **A prompt lost**: every engine that answered it in the window answered
 *   it at least twice, its last 2 readings on each engine named the client
 *   on none, and before those, at least 2 engines named the client.
 *
 * The window is the last 28 days. Past that, a keyword off page 1 is a
 * Closest win (P8's), not a slip.
 */

export const WINDOW_DAYS = 28;
/** Readings that must agree before a keyword counts as off page 1. */
export const KEYWORD_HELD = 3;
/** Readings per engine that must agree before a prompt counts as lost. */
export const PROMPT_HELD = 2;
/** Engines that must have named the client before, for a prompt to count as lost. */
export const PROMPT_WAS_ON = 2;

const onPage1 = (p: number | null) => p !== null && p <= 10;

type ClusterRow = { id: string; name: string; keyword_id: string | null; stopped_on: Day | null };
type PromptRow = { id: string; text: string; cluster_id: string | null; stopped_on: Day | null };
type KeywordRow = { id: string; keyword: string; search_volume: number | null; stopped_on: Day | null };
type VerdictRow = { run_date: Day; question_id: string; engine: string; answered: boolean; named: boolean };

/** One client's structure and readings, in tracking's own column names (OverviewData's). */
export type TrackingInput = {
  today: Day;
  clusters: readonly ClusterRow[];
  questions: readonly PromptRow[];
  keywords: readonly KeywordRow[];
  answers: readonly VerdictRow[];
  serp: readonly SerpRow[];
};

const engineName = (e: string) => ENGINE_SPECS[e as Engine]?.label ?? e;

/** The cluster keywords that left page 1, held over their last 3 readings. */
export function keywordSlips(input: TrackingInput): Candidate[] {
  const from = addDays(input.today, -(WINDOW_DAYS - 1));
  const out: Candidate[] = [];
  for (const c of input.clusters) {
    if (c.stopped_on !== null || !c.keyword_id) continue;
    const kw = input.keywords.find((k) => k.id === c.keyword_id && k.stopped_on === null);
    if (!kw) continue;
    // One reading per day, newest first.
    const byDay = new Map<Day, number | null>();
    for (const r of input.serp) if (r.keyword_id === kw.id && r.run_date >= from && r.run_date <= input.today && !byDay.has(r.run_date)) byDay.set(r.run_date, r.position);
    const readings = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    if (readings.length <= KEYWORD_HELD) continue;
    const last = readings.slice(0, KEYWORD_HELD);
    if (last.some(([, p]) => onPage1(p))) continue;
    const was = readings.slice(KEYWORD_HELD).find(([, p]) => onPage1(p));
    if (!was) continue;
    const name = kw.keyword;
    const lastWords = listWords([...last].reverse().map(([, p]) => positionWords(p)));
    out.push({
      dedupeKey: `kw-left-p1:${kw.id}`,
      kind: "recover_keyword",
      severity: "slipping",
      clusterId: c.id,
      title: `Win back page 1 for '${clip(name, 46)}'`,
      why: [{ text: `'${name}' was ${positionWords(was[1])} on Google on ${formatDay(was[0])}; ${lastWords} at its last ${KEYWORD_HELD} readings, to ${formatDay(last[0]![0])}.`, href: `/clusters/${c.id}` }],
      grade: "your_data",
      effort: "days",
      href: `/clusters/${c.id}`,
      ref: { table: "tracked_keywords", id: kw.id },
      ...(kw.search_volume !== null ? { volume: kw.search_volume } : {}),
      evidenceOn: last[0]![0],
    });
  }
  return out;
}

/** The prompts no engine names the client for any more, held over 2 readings on each engine. */
export function promptSlips(input: TrackingInput): Candidate[] {
  const from = addDays(input.today, -(WINDOW_DAYS - 1));
  const live = new Set(input.clusters.filter((c) => c.stopped_on === null).map((c) => c.id));
  // prompt -> engine -> readings (day, named), newest first.
  const reads = new Map<string, Map<string, [Day, boolean][]>>();
  for (const a of input.answers) {
    if (!a.answered || a.run_date < from || a.run_date > input.today) continue;
    const byEngine = reads.get(a.question_id) ?? new Map<string, [Day, boolean][]>();
    reads.set(a.question_id, byEngine);
    const list = byEngine.get(a.engine) ?? [];
    byEngine.set(a.engine, list);
    if (!list.some(([d]) => d === a.run_date)) list.push([a.run_date, a.named]);
  }
  const out: Candidate[] = [];
  for (const q of input.questions) {
    if (q.stopped_on !== null || (q.cluster_id !== null && !live.has(q.cluster_id))) continue;
    const byEngine = reads.get(q.id);
    if (!byEngine || byEngine.size === 0) continue;
    let held = true;
    const wasOn: string[] = [];
    let latest: Day = "";
    for (const [engine, list] of byEngine) {
      list.sort((a, b) => b[0].localeCompare(a[0]));
      if (list.length < PROMPT_HELD || list.slice(0, PROMPT_HELD).some(([, named]) => named)) {
        held = false;
        break;
      }
      if (list[0]![0] > latest) latest = list[0]![0];
      if (list.slice(PROMPT_HELD).some(([, named]) => named)) wasOn.push(engine);
    }
    if (!held || wasOn.length < PROMPT_WAS_ON) continue;
    const engines = byEngine.size;
    const names = listWords(wasOn.map(engineName));
    out.push({
      dedupeKey: `prompt-lost:${q.id}`,
      kind: "recover_prompt",
      severity: "slipping",
      clusterId: q.cluster_id,
      title: `Get named again for '${clip(q.text, 44)}'`,
      why: [
        {
          text: `Named by ${names} earlier in the last ${WINDOW_DAYS} days; named by none of the ${engines} engines that answered, at their last ${PROMPT_HELD} readings each, to ${formatDay(latest)}.`,
          ...(q.cluster_id ? { href: `/clusters/${q.cluster_id}` } : {}),
        },
      ],
      grade: "your_data",
      effort: "days",
      href: q.cluster_id ? `/clusters/${q.cluster_id}` : "/clusters",
      ref: { table: "tracked_questions", id: q.id },
      evidenceOn: latest,
    });
  }
  return out;
}

/** Both rules over one client's last 28 days. */
export function trackingCandidatesFrom(input: TrackingInput): Candidate[] {
  return [...keywordSlips(input), ...promptSlips(input)];
}

/**
 * This client's structure and last 28 days, read with the db the job hands
 * in: paged, one client's rows only, verdict columns only. A failed read
 * throws, so the job says so rather than finding nothing.
 */
export async function readTrackingInput(db: SupabaseClient, clientId: string, today: Day): Promise<TrackingInput> {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const [clusters, prompts, keywords, answers, serp] = await Promise.all([
    selectAll<ClusterRow>((lo, hi) => db.from("tracked_clusters").select("id, name, keyword_id, stopped_on").eq("client_domain_id", clientId).order("id").range(lo, hi)),
    selectAll<PromptRow>((lo, hi) => db.from("tracked_questions").select("id, text, cluster_id, stopped_on").eq("client_domain_id", clientId).order("id").range(lo, hi)),
    selectAll<KeywordRow>((lo, hi) => db.from("tracked_keywords").select("id, keyword, search_volume, stopped_on").eq("client_domain_id", clientId).order("id").range(lo, hi)),
    selectAll<VerdictRow>((lo, hi) =>
      db.from("tracking_answers").select("run_date, question_id, engine, answered, named").eq("client_domain_id", clientId).gte("run_date", from).lte("run_date", today).order("id").range(lo, hi),
    ),
    selectAll<SerpRow>((lo, hi) => db.from("tracking_serp").select("run_date, keyword_id, position").eq("client_domain_id", clientId).gte("run_date", from).lte("run_date", today).order("id").range(lo, hi)),
  ]);
  return { today, clusters, questions: prompts, keywords, answers, serp };
}

/** The tracking source, as wiring.ts registers it: planRefreshHandler([trackingCandidates]). */
export const trackingCandidates: CandidateSource = {
  name: "tracking",
  async gather(db: SupabaseClient, client: DiyClient, today: Day): Promise<Candidate[]> {
    return trackingCandidatesFrom(await readTrackingInput(db, client.id, today));
  },
};
