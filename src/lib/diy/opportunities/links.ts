import { answerHref } from "../../tracking/evidence.ts";
import type { Day, Range } from "../../tracking/figures.ts";

/**
 * Evidence links (13 Oct 2026, DIY P7; spec 10 section 3.4, DB-2): every
 * count on Opportunities opens the answers behind it, on the one-cluster
 * page with `?day=&engine=` and that engine's anchor (tracking/evidence.ts
 * answerHref). The page shows one prompt at a time, picked by its index in
 * the cluster's prompts as clusterCards lists them for the range, so the
 * index here is taken the same way, for the range the link states.
 */

export type Place = { cluster: string; index: number };

/** Each prompt's cluster and index, as cluster-figures.ts clusterCards lists a cluster's prompts for `range`. */
export function promptPlaces(input: { clusters: readonly { id: string; started_on: Day; stopped_on: Day | null }[]; questions: readonly { id: string; cluster_id: string | null; added_on: Day; stopped_on: Day | null }[] }, range: Range, today: Day): Map<string, Place> {
  const current = range.to >= today;
  const out = new Map<string, Place>();
  for (const c of input.clusters) {
    if (!((c.stopped_on === null || c.stopped_on > range.from) && (current || c.started_on <= range.to))) continue;
    const prompts = input.questions.filter((q) => q.cluster_id === c.id && (q.stopped_on === null || q.stopped_on > range.from) && (current || q.added_on <= range.to));
    prompts.forEach((q, i) => out.set(q.id, { cluster: c.id, index: i }));
  }
  return out;
}

/** A link opening one answer: the prompt's cluster page, the range, the prompt's index, the day and the engine. Null for a prompt with no cluster page. */
export function answerLinker(places: ReadonlyMap<string, Place>, clusterPath: (id: string) => string, range: Range): (prompt: string, day: Day, engine: string) => string | null {
  return (prompt, day, engine) => {
    const at = places.get(prompt);
    if (!at) return null;
    return answerHref(clusterPath(at.cluster), { from: range.from, to: range.to, prompt: String(at.index) }, { day, engine });
  };
}
