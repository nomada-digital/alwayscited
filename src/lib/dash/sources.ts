/**
 * Sources over a chosen range (17 Oct 2026): which sites the answers cite,
 * counted from the readings in the range rather than the Workspace's fixed
 * last seven. Pure.
 */

import { ENGINE_ORDER, hostOf, pathKey } from "./model.ts";
import type { CitingAnswer } from "./history.ts";
import type { Engine } from "./types.ts";

export const SOURCE_RANGES = [7, 28, 90] as const;
export type SourceRange = (typeof SOURCE_RANGES)[number];

export const siteOf = (c: { url: string; source_domain?: string | null }) => (c.source_domain ?? hostOf(c.url) ?? "").replace(/^www\./, "").toLowerCase();

export function sourcesIn(rows: readonly CitingAnswer[], promptIds: ReadonlySet<string>, ownDomain: string) {
  const own = ownDomain.replace(/^www\./, "").toLowerCase();
  const by = new Map<string, { answers: Set<string>; urls: Set<string>; engines: Set<Engine>; prompts: Set<string> }>();
  for (const a of rows) {
    if (!promptIds.has(a.question_id)) continue;
    const key = `${a.run_date} ${a.question_id} ${a.engine}`;
    for (const c of a.citations ?? []) {
      const d = siteOf(c);
      if (!d) continue;
      const s = by.get(d) ?? { answers: new Set(), urls: new Set(), engines: new Set(), prompts: new Set() };
      s.answers.add(key);
      // A page, not a spelling of it: www. and a trailing slash are the same page.
      s.urls.add(pathKey(c.url) ?? c.url);
      s.engines.add(a.engine);
      s.prompts.add(a.question_id);
      by.set(d, s);
    }
  }
  return [...by]
    .map(([domain, s]) => ({ domain, answers: s.answers.size, urls: s.urls.size, prompts: s.prompts.size, you: domain === own || domain.endsWith(`.${own}`), engines: ENGINE_ORDER.filter((e) => s.engines.has(e)) }))
    .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain));
}
