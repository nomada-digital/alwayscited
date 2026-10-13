import type { Day } from "../../tracking/figures.ts";
import type { OwnParse, SchemaFound, SchemaResults } from "./own-parse.ts";

/**
 * Your pages' rows, as the pages, the jobs and the route read them (13 Oct
 * 2026, DIY P8; spec 10 sections 4.9 and 5.8). Plain module, relative
 * imports only, so node --test loads it.
 */

export const KEY_PAGE_ORIGINS = ["homepage", "ranking", "cited_own", "relevant", "member"] as const;
export type KeyPageOrigin = (typeof KEY_PAGE_ORIGINS)[number];

export type KeyPage = {
  id: string;
  url: string;
  urlKey: string;
  origin: KeyPageOrigin;
  clusterIds: string[];
  addedBy: string;
  addedOn: Day;
  removedOn: Day | null;
  removedBy: string | null;
};

/** What page_checks.basics holds: the own read's summary, less the schema (schema_found) and the hash and word count (their own columns). */
export type Basics = Omit<OwnParse, "jsonLd" | "jsonLdErrors" | "conflicts" | "microdata" | "microdataTypes" | "contentHash" | "wordCount" | "opening"> & {
  /** The page's first paragraph of prose, at most 300 characters (own-parse.ts openingIn); absent on a read stored before 13 Oct 2026's review. */
  opening?: string | null;
};

export type CheckVia = "own" | "instant_pages";
export type CheckTrigger = "scheduled" | "on_demand" | "onboarding";

export type PageCheck = {
  id: string;
  keyPageId: string | null;
  url: string;
  urlKey: string;
  checkedAt: string;
  via: CheckVia;
  trigger: CheckTrigger;
  status: "ok" | "unreadable";
  httpStatus: number | null;
  finalUrl: string | null;
  basics: Basics | null;
  /** The fix as summarised when the check was written: the types it drafts and how many [ADD] fields each has. */
  fix: { type: string; status: "new" | "update"; placeholders: number }[] | null;
  schemaFound: SchemaFound | null;
  schemaResults: SchemaResults | null;
  contentHash: string | null;
  wordCount: number | null;
  renderedWordCount: number | null;
};

/** One crawler's verdict over the key pages. */
export type CrawlerVerdict = {
  name: string;
  state: "allowed" | "partial" | "blocked";
  /** The rule came from the `*` group, not one naming this crawler. */
  inherited: boolean;
  /** The robots.txt line that decides it (the first blocked page's), at most 200 characters. */
  line: string | null;
  /** The key page paths it may not read. */
  blocked: string[];
};

/** A key page's state from its latest own read; noindex and canonical are null when that read could not read the page (13 Oct 2026, DIY P8 review: an unread page is "Not read", never "No"). */
export type BotPage = { urlKey: string; status: number | null; noindex: boolean | null; canonicalElsewhere: boolean | null };

/** Another host's robots.txt, for key pages on a subdomain of the client's domain: each page is judged by its own host's file. */
export type HostRobots = { host: string; robotsStatus: number | null; crawlers: CrawlerVerdict[] };

export type BotCheck = {
  id: string;
  checkedAt: string;
  /** robots.txt's HTTP status on the client's own domain, or null when it could not be read at all (a network failure). */
  robotsStatus: number | null;
  /** Each crawler's verdict over the key pages on the client's own domain (its apex or www). */
  crawlers: CrawlerVerdict[];
  /** The same for each other host a key page is on (a subdomain), read from that host's own robots.txt. */
  hosts: HostRobots[];
  llmsTxtStatus: number | null;
  pages: BotPage[];
};

export type ExampleBody = {
  title: string;
  h1: string;
  opening: string;
  missing_section: { heading: string; bullets: string[] };
  link_sentence: { from_url: string; sentence: string; anchor: string };
  facts_used: { text: string; where: string }[];
  placeholders: string[];
};

export type ReoptExample = {
  id: string;
  clusterId: string | null;
  url: string;
  urlKey: string;
  status: "pending" | "ready" | "failed";
  requestedBy: string;
  requestedAt: string;
  finishedAt: string | null;
  example: ExampleBody | null;
  /** The client's own page's title and H1 when the example was asked for. Never a third party's; the opening is read from the page's latest own read, not kept here. */
  now: { title: string | null; h1: string | null } | null;
  guardHits: { field: string; token: string }[];
  error: string | null;
};

/** One of the top 3 for a cluster keyword, structure only (top_structures). */
export type TopStructure = {
  clusterId: string | null;
  keywordId: string | null;
  readOn: Day;
  rank: number;
  url: string;
  urlKey: string;
  status: "ok" | "unreadable";
  title: string | null;
  h1: string | null;
  headings: { level: 2 | 3; text: string }[];
  dateShown: boolean | null;
  wordCount: number | null;
};

/** One reading of a cluster keyword (tracking_serp): the client's position and ranking URL, null when not in the top 20. */
export type SerpReading = { day: Day; position: number | null; url: string | null };

/** A Google result as tracking_serp.top holds it. */
export type TopResult = { rank: number; domain: string; url: string };

/** A cluster keyword's readings, oldest first, and its latest page of results. */
export type KeywordSerp = { keywordId: string; readings: SerpReading[]; top: TopResult[]; topOn: Day | null };

/** The night jobs' latest outcome per kind, for "Some checks didn't finish last night". */
export type JobState = { kind: string; outcome: string | null; dueOn: Day; doneAt: string | null };
