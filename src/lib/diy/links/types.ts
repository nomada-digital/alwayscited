import type { BacklinksSummary, GapDomain, GapPage, LinkRow, SeriesWeek } from "../../scan/dataforseo-request.ts";
import type { Day } from "../../tracking/figures.ts";

/**
 * The Links page's model (13 Oct 2026, DIY P10; spec 10 sections 4.8, 5.8
 * and 6.3): what the Backlinks jobs store in `backlink_reads`, the comparison
 * set in `comparison_sets`, the link checks in `link_checks`, and the words
 * the page draws. Plain module, relative imports only, so node --test loads
 * it.
 *
 * Every stored payload is allow-listed: the named fields of the parsers in
 * `dataforseo-request.ts` and nothing else. No attribute list, no sponsored
 * count, no spam score, no price.
 */

export const LINK_KINDS = ["summary", "new_lost", "timeseries", "bulk", "domain_gap", "page_gap", "mentions"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** One `backlink_reads` row as the page reads it: when it was read, and its payload. */
export type Stored<T> = { readOn: Day; value: T };

export type NewLost = { since: Day; added: LinkRow[]; lost: LinkRow[]; addedTotal: number | null; lostTotal: number | null };
export type Series = { weeks: SeriesWeek[] };
export type BulkRow = { domain: string; rank: number | null; referringDomains: number | null; newDomains: number | null; lostDomains: number | null };
export type Bulk = { from: Day; rows: BulkRow[] };
/**
 * How much of a capped list was read (13 Oct 2026, review of DIY P10: the
 * "N more" counts were counted from the 100 rows read and shown as exact):
 * `read`, the rows the read returned that met the list's rule, before
 * Nomada's placements and the client's and compared sites' own were taken
 * out; `total`, DataForSEO's `total_count` for the same rule (the filtered
 * read's, or the largest pair's), null when it sent none; `capped`, whether
 * rows were left unread. A count is exact only when nothing was left unread
 * (gap.ts gapCount, targets.ts targetCount).
 */
export type ListCount = { read: number; total: number | null; capped: boolean };
/** The gap as stored: the compared sites, how the n >= 2 set was read, its rows sorted (gap.ts) with Nomada's placements gone, and how much was read. */
export type DomainGap = { targets: string[]; via: "filter" | "pairwise"; rows: GapDomain[]; count: ListCount };
export type PageGap = { targets: string[]; rows: GapPage[]; count: ListCount };
/** How a count is worded: exact, DataForSEO's estimate ("about"), or a floor ("at least"). */
export type Hedge = "exact" | "about" | "at_least";
/** A mention we read ourselves and found naming the client with no link to it. */
export type Mention = { url: string; urlKey: string; domain: string; title: string | null; published: Day | null; snippet: string | null; readOn: Day; via: "own" | "content_parsing" };
export type Mentions = { candidates: number; confirmed: Mention[]; dropped: { unreadable: number; linked: number; unnamed: number } };

export type { BacklinksSummary, GapDomain, GapPage, LinkRow, SeriesWeek };

/** Where each comparison domain came from (spec 10 section 6.3 steps 4-5), stored per domain and never edited. */
export type Basis =
  | { from: "page1"; places: number; avg: number | null }
  | { from: "labs"; shares: number | null }
  | { from: "backlinks"; shares: number | null };

export type ComparisonSet = { month: Day; domains: string[]; basis: Record<string, Basis>; derivedOn: Day };

/** One "Check a link" result, as `link_checks` holds it. */
export type LinkCheck = {
  id: string;
  url: string;
  checkedAt: string;
  via: "own" | "content_parsing";
  status: "ok" | "blocked" | "error" | "not_html";
  http: number | null;
  found: boolean | null;
  rel: "followed" | "not_followed" | null;
  anchor: string | null;
  target: string | null;
};

/** The page's views, as `?view=` holds them (spec 10 section 3.5). */
export const LINK_VIEWS = ["profile", "gap", "targets", "mentions", "check"] as const;
export type LinkView = (typeof LINK_VIEWS)[number];
export const pickView = (raw: string | null): LinkView => ((LINK_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as LinkView) : "profile");

export const VIEW_LABEL: Record<LinkView, string> = {
  profile: "Your links",
  gap: "Link gap",
  targets: "Link targets",
  mentions: "Mentions without a link",
  check: "Check a link",
};

/** The opportunities lenses Links makes rows in (P7's table): a gap domain, a revealed page, a mention. */
export const LINK_LENSES = ["link_domain", "link_page", "mention"] as const;
export type LinkLens = (typeof LINK_LENSES)[number];

/** The words "DataForSEO estimate" travel with: every vendor number is labelled with its read date (spec 10 section 2.6). */
export const ESTIMATE = "DataForSEO estimate";

/** A URL a member may type into Check a link: http(s), 500 characters at most (spec 10 section 3.6). */
export const LINK_URL_MAX = 500;
