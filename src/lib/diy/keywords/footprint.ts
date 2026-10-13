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

/**
 * One stored footprint row: keyword, position, url path, volume, intent, estimated traffic, and DataForSEO's own
 * previous reading.
 *
 * Two positions, never mixed (13 Oct 2026, review of the P6 handoff). `p` is `rank_group`, the place among the
 * organic results: what our own daily read stores (engines.ts) and what every DIY page shows, bands and counts
 * as "Nth on Google", so a keyword reads the same in the Tracked and All views. `a` is `rank_absolute`, the
 * place among every element on the page (an AI overview, a snippet, a video row each take one); it is kept only
 * to compare with DataForSEO's `previous_rank_absolute` (`pr`), which is on that basis. `pd` is the day of that
 * previous reading (`previous_updated_time`), per keyword - DataForSEO v3 docs, ranked_keywords/live, read 13 Oct
 * 2026: rank_changes are "since the previous_updated_time".
 */
export type FootprintRow = {
  k: string;
  p: number | null;
  u: string | null;
  v: number | null;
  i: Intent | null;
  e: number | null;
  /** `rank_absolute`; left off when unknown. */
  a?: number | null;
  /** `rank_changes.previous_rank_absolute`: DataForSEO's own previous reading, a rank_absolute. */
  pr?: number | null;
  /** `rank_changes.is_new`: DataForSEO's previous reading of this keyword's results did not hold the site's page. */
  n?: boolean | null;
  /** The previous reading's day (`previous_updated_time`). */
  pd?: Day | null;
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
 * keywords dropped, etv to two places, `p` the organic position (rank_group)
 * and `a` the absolute one, and the null fields of DataForSEO's own previous
 * reading left off the row to keep it small (a missing `pr` reads as null).
 */
export function compactFootprint(read: RankedKeywords): { total: number | null; etv: number | null; rows: FootprintRow[] } {
  const rows: FootprintRow[] = [];
  for (const r of read.rows) {
    if (!r.keyword) continue;
    const row: FootprintRow = { k: r.keyword, p: r.group, u: r.url, v: r.volume, i: r.intent, e: r.etv === null ? null : round2(r.etv) };
    if (r.position !== null) row.a = r.position;
    if (r.previous !== null) row.pr = r.previous;
    if (r.isNew !== null) row.n = r.isNew;
    if (r.previousOn !== null && isDay(r.previousOn)) row.pd = r.previousOn;
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
    const a = num(r.a);
    if (a !== null) row.a = a;
    const pr = num(r.pr);
    if (pr !== null) row.pr = pr;
    if (typeof r.n === "boolean") row.n = r.n;
    if (isDay(r.pd)) row.pd = r.pd;
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

/**
 * Whether a pull holds every keyword Labs had for the domain. Each pull reads
 * the top 1000 rows by estimated traffic, so for a bigger site a keyword
 * missing from it may simply have been below the cut, not out of Google's top
 * 100. An unknown total is not a complete pull.
 */
export const completePull = (pull: Pick<Pull, "total" | "rows">): boolean => pull.total !== null && pull.total <= pull.rows.length;

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
