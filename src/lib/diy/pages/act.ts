import type { Candidate } from "../plan/types.ts";
import { ADVICE } from "./schema.advice.ts";
import type { KeyPage } from "./types.ts";
import { type Cluster, type Keyword, type PageState, pathOf } from "./view.ts";
import { fill } from "./words.ts";

/**
 * "Add to Actions" from Your pages (13 Oct 2026, DIY P8; spec 10 section
 * 4.9): the fix, or the drafted example, as an Actions item. The item is the
 * candidate the nightly gather would write for the same thing - one dedupe
 * key - so pressing the button and the night's pick never make two.
 *
 * - `schema:<Type>`: add_schema when the page has no block of that type,
 *   fix_schema when it has an incomplete one; graded as the check's own line.
 * - `rework:<clusterId>`: rework_page for one cluster the page serves, to its
 *   Fit tab, where the example is.
 */

export function actCandidate(p: { page: KeyPage; state: PageState; item: string | null; served: readonly Cluster[]; keywords: readonly Keyword[]; domain: string }): Candidate | null {
  const item = p.item ?? "";
  const where = `${p.domain.replace(/^www\./, "")}${pathOf(p.page.url) === "/" ? "" : pathOf(p.page.url)}`;
  const schema = /^schema:([A-Za-z]{2,40})$/.exec(item);
  if (schema) {
    const type = schema[1]!;
    const finding = p.state.findings.find((f) => f.type === type && f.level !== "info");
    if (!finding) return null;
    const line = ADVICE.find((l) => l.id === finding.id);
    if (!line) return null;
    const isNew = !finding.missing;
    return {
      dedupeKey: `pages:schema:${type}:${p.page.id}`,
      kind: isNew ? "add_schema" : "fix_schema",
      severity: "tidy",
      clusterId: null,
      title: isNew ? `Add ${type} schema to ${where}` : `Fix the ${type} schema on ${where}`,
      why: [{ text: fill(line.text, finding.vars), href: `/pages/${p.page.id}?tab=schema` }],
      grade: line.grade,
      ...(line.sourceId ? { sourceId: line.sourceId } : {}),
      effort: "minutes",
      href: `/pages/${p.page.id}?tab=schema`,
      ref: { table: "key_pages", id: p.page.id },
    };
  }
  const rework = /^rework:([0-9A-Za-z_-]{1,64})$/.exec(item);
  if (rework) {
    const cluster = p.served.find((c) => c.id === rework[1]);
    if (!cluster) return null;
    const kw = p.keywords.find((k) => k.id === cluster.keywordId)?.keyword ?? cluster.name;
    return {
      dedupeKey: `pages:rework:${p.page.id}:${cluster.id}`,
      kind: "rework_page",
      severity: "closest",
      clusterId: cluster.id,
      title: `Rework ${where} for '${kw}'`,
      why: [{ text: `An example to edit for '${kw}' is on this page's Fit tab.`, href: `/pages/${p.page.id}?tab=fit&cluster=${cluster.id}` }],
      grade: "your_data",
      effort: "days",
      href: `/pages/${p.page.id}?tab=fit&cluster=${cluster.id}`,
      ref: { table: "key_pages", id: p.page.id },
    };
  }
  return null;
}
