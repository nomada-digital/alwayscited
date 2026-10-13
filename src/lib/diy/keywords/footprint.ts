import { INTENTS, type Intent, type RankedKeywords } from "../../scan/dataforseo-request.ts";
import type { Day } from "../../tracking/figures.ts";

/**
 * The Google footprint (13 Oct 2026, DIY P6; spec 10 sections 4.3, 5.2, 5.8
 * and 6.6): every keyword DataForSEO's Labs index has the client's domain
 * ranking for in Google's top 100, pulled weekly at most and only when Labs'
 * own Google date has moved, kept as one `keyword_footprints` row a pull.
 *
 * Pure, with relative imports, so node --test loads it. Three things live
 * here: the compaction of a parsed `ranked_keywords` read into the stored
 * row, the strict reading of a stored row back (an allow-list on the way out
 * as well as the way in), and the Labs date gate that decides whether a pull
 * is worth paying for at all.
 *
 * What a footprint is, and is not. It is a vendor estimate, labelled
 * "DataForSEO estimate, read <date>" wherever it is drawn (evidence.ts
 * vendorLabel). It is never counted in the daily figures, which are our own
 * reads of the tracked keywords (tracking_serp). And it holds no difficulty
 * figure: DataForSEO's `keyword_difficulty` is never parsed (spec 2.3), so it
 * cannot reach a row here.
 */

/** One stored footprint row: keyword, position, url path, volume, intent, estimated traffic, DataForSEO's previous rank and its is_new flag. */
export type FootprintRow = {
  k: string;
  p: number | null;
  u: string | null;
  v: number | null;
  i: Intent | null;
  e: number | null;
  /** `rank_changes.previous_rank_absolute`: DataForSEO's own previous reading. The window it covers is [VERIFY] (spec 6.10). */
  pr?: number | null;
  n?: boolean | null;
};

/** One pull as the pages read it. */
export type Pull = {
  pulledOn: Day;
  /** Labs' Google date when it was pulled; null when it was not known. */
  labsDate: Day | null;
  /** `total_count`: every keyword Labs holds for the domain, which can be more than the rows read. */
  total: number | null;
  /** The domain's estimated monthly traffic, as Labs totals it. */
  etv: number | null;
  rows: FootprintRow[];
};

/** The columns every read of keyword_footprints takes, named. */
export const FOOTPRINT_COLUMNS = "pulled_on, labs_date, total_count, etv, rows";

/** A pull is not taken again within this many days of the last (spec 6.6: "at most once a week"). */
export const FOOTPRINT_MIN_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is Day => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const intentOf = (v: unknown): Intent | null => ((INTENTS as readonly string[]).includes(String(v)) ? (v as Intent) : null);
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A parsed `ranked_keywords` read as it is stored: named fields only, empty
 * keywords dropped, etv to two places, and the null fields of DataForSEO's
 * own previous reading left off the row to keep it small (a missing `pr` reads
 * as null).
 */
export function compactFootprint(read: RankedKeywords): { total: number | null; etv: number | null; rows: FootprintRow[] } {
  const rows: FootprintRow[] = [];
  for (const r of read.rows) {
    if (!r.keyword) continue;
    const row: FootprintRow = { k: r.keyword, p: r.position, u: r.url, v: r.volume, i: r.intent, e: r.etv === null ? null : round2(r.etv) };
    if (r.previous !== null) row.pr = r.previous;
    if (r.isNew !== null) row.n = r.isNew;
    rows.push(row);
  }
  return { total: read.total, etv: read.etv === null ? null : round2(read.etv), rows };
}

/** One stored row's `rows` read back strictly: anything that is not a named field of the right type is dropped, never coerced into a figure. */
export function readFootprintRows(v: unknown): FootprintRow[] {
  if (!Array.isArray(v)) return [];
  const out: FootprintRow[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.k !== "string" || !r.k.trim()) continue;
    const row: FootprintRow = {
      k: r.k.trim().slice(0, 120),
      p: num(r.p),
      u: typeof r.u === "string" && r.u ? r.u.slice(0, 500) : null,
      v: num(r.v),
      i: intentOf(r.i),
      e: num(r.e),
    };
    const pr = num(r.pr);
    if (pr !== null) row.pr = pr;
    if (typeof r.n === "boolean") row.n = r.n;
    out.push(row);
  }
  return out;
}

/** A `keyword_footprints` row (FOOTPRINT_COLUMNS) as a Pull; null for a row with no pull day. */
export function readPull(row: Record<string, unknown> | null | undefined): Pull | null {
  if (!row || !isDay(row.pulled_on)) return null;
  return {
    pulledOn: row.pulled_on,
    labsDate: isDay(row.labs_date) ? row.labs_date : null,
    total: num(row.total_count),
    etv: num(row.etv),
    rows: readFootprintRows(row.rows),
  };
}

/** The newest two pulls, newest first, from rows in any order. */
export function latestTwo(pulls: readonly Pull[]): { latest: Pull | null; previous: Pull | null } {
  const sorted = [...pulls].sort((a, b) => b.pulledOn.localeCompare(a.pulledOn));
  return { latest: sorted[0] ?? null, previous: sorted[1] ?? null };
}

const daysBetween = (from: Day, to: Day) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type PullDecision = { pull: true; why: string } | { pull: false; why: string };

/**
 * Whether tonight's footprint job should pay for a pull (spec 5.6 item 6 and
 * 6.6): only when the latest `labs_status` row's Google date is newer than the
 * last pull's, and never within FOOTPRINT_MIN_DAYS of the last pull. A client
 * with no pull yet is pulled whatever the date says - there is nothing to
 * compare with, and it is the onboarding read. With no Labs date read yet,
 * nothing is paid for: an unread date is not a moved one.
 */
export function pullDecision(p: { labsDate: Day | null; last: { pulledOn: Day; labsDate: Day | null } | null; today: Day }): PullDecision {
  if (!p.last) return { pull: true, why: "no footprint yet" };
  const since = daysBetween(p.last.pulledOn, p.today);
  if (since < FOOTPRINT_MIN_DAYS) return { pull: false, why: `pulled ${p.last.pulledOn}, ${since} days ago; at most once a week` };
  if (p.labsDate === null) return { pull: false, why: "Labs' Google date not read yet; nothing pulled" };
  if (p.last.labsDate !== null && p.labsDate <= p.last.labsDate) return { pull: false, why: `Labs data unchanged since ${p.last.labsDate}; nothing pulled` };
  return { pull: true, why: `Labs' Google date moved to ${p.labsDate}` };
}
