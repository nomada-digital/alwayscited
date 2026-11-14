import type { Range } from "./figures.ts";
import type { OverviewData } from "./overview-data.ts";
import { KIND_WORDS, type PlacementsView } from "./placement-figures.ts";

/**
 * T8 "Download report", v1 (R90, Danny, 29 Sep 2026, danny.md line 84): two
 * CSVs of the range, no PDF. Answers is one row per prompt, engine and day;
 * keywords is one row per keyword and day. Every figure is a stored reading.
 * Nothing here is computed from other figures. Pure, relative imports only, so
 * node --test can load it.
 */

// "placements" (R97 part 4, 30 Sep 2026; BRIEF-2 T13): the placements table as a file.
export type ReportKind = "answers" | "keywords" | "placements";
export const isReportKind = (v: string | null): v is ReportKind => v === "answers" || v === "keywords" || v === "placements";

/** One CSV field: quoted when it holds a comma, quote or line break; a leading = + - @ is defused so a spreadsheet does not run it. */
export function csvField(v: string | number | boolean | null): string {
  if (v === null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const line = (cells: (string | number | boolean | null)[]) => cells.map(csvField).join(",");
const within = (d: string, r: Range) => d >= r.from && d <= r.to;

// BRIEF-3 T8 (R106 step 10, 30 Sep 2026): the answers file carries the cluster's
// keyword beside its name and the prompt's angle, joined through keyword_id; the
// keywords file names the cluster each keyword heads. Rows are unchanged.
// 8 Oct 2026 (audit data-6): an answer whose other brands were not read says so
// in "brands named" rather than leaving it blank, which reads as "none".
export const BRANDS_NOT_READ = "(other brands not read)";

export function answersCsv(data: Pick<OverviewData, "answers" | "questions" | "clusters" | "keywords">, range: Range): string {
  const q = new Map(data.questions.map((x) => [x.id, x]));
  const k = new Map((data.keywords ?? []).map((x) => [x.id, x.keyword]));
  const cluster = new Map((data.clusters ?? []).map((c) => [c.id, c]));
  const rows = data.answers
    .filter((a) => within(a.run_date, range))
    .sort((a, b) => a.run_date.localeCompare(b.run_date) || a.question_id.localeCompare(b.question_id) || a.engine.localeCompare(b.engine))
    .map((a) => {
      const p = q.get(a.question_id);
      const c = p?.cluster_id ? cluster.get(p.cluster_id) : undefined;
      return line([a.run_date, c?.name || null, (c?.keyword_id && k.get(c.keyword_id)) || null, p?.angle ?? null, p?.text ?? null, a.engine, a.answered ? "yes" : "no", a.answered ? (a.named ? "yes" : "no") : null, [...a.brands, ...(a.answered && a.brands_ok === false ? [BRANDS_NOT_READ] : [])].join("; ") || null, a.citations.map((x) => x.url || x.source_domain).filter(Boolean).join(" ") || null]);
    });
  return [line(["date", "cluster", "cluster keyword", "angle", "prompt", "engine", "answered", "named you", "brands named", "pages cited"]), ...rows].join("\r\n") + "\r\n";
}

export function keywordsCsv(data: Pick<OverviewData, "serp" | "keywords" | "clusters">, range: Range): string {
  const k = new Map(data.keywords.map((x) => [x.id, x.keyword]));
  const cluster = new Map((data.clusters ?? []).filter((c) => c.keyword_id).map((c) => [c.keyword_id, c.name]));
  const rows = data.serp
    .filter((s) => within(s.run_date, range))
    .sort((a, b) => a.run_date.localeCompare(b.run_date) || a.keyword_id.localeCompare(b.keyword_id))
    .map((s) => line([s.run_date, cluster.get(s.keyword_id) ?? null, k.get(s.keyword_id) ?? null, s.position]));
  return [line(["date", "cluster", "keyword", "google position (blank: not in top 100)"]), ...rows].join("\r\n") + "\r\n";
}

/**
 * The placements screen's table, row for row: the Whole-cluster row, then one
 * per placement. Spans are the table's at-go-live and now readings, split in
 * two columns; a not-live row leaves them blank and says its status. The
 * footnote travels as the last line, since the file is read without the page.
 */
export function placementsCsv(view: PlacementsView, cluster: string, footnote: string): string {
  const w = view.whole;
  const rows = [
    line([cluster, "Whole cluster", null, `${view.live} live`, w.from, w.cited, null, w.named.from, w.named.to, w.google.from, w.google.to]),
    ...view.rows.map((r) => line([cluster, r.url, KIND_WORDS[r.kind], r.live ? "Live" : r.when, r.liveOn, r.live ? r.cited : null, r.citedBy.join(" ") || null, r.named.from, r.named.to, r.google.from, r.google.to])),
  ];
  const head = line(["cluster", "page", "type", "status", "live on", "answers citing it", "engines citing it", "named % at go-live", "named % now", "google at go-live", "google now"]);
  return [head, ...rows, "", line([footnote])].join("\r\n") + "\r\n";
}

/** The file's name: the client's slug, the kind and the range, e.g. tallyroo-answers-2026-09-02-to-2026-09-29.csv. */
export function reportFilename(slug: string, kind: ReportKind, range: Range): string {
  return `${slug.replace(/[^a-z0-9-]/gi, "")}-${kind}-${range.from}-to-${range.to}.csv`;
}
