import { APP_LIMITS } from "../../../config/contact.ts";
import type { Day } from "../../tracking/figures.ts";

/**
 * Opportunities' model (13 Oct 2026, DIY P7; spec 10 sections 4.7, 5.8 and
 * 6.2): the pages the engines cite that leave the client out, the best-of
 * lists on Google's page 1 for its keywords, threads, review and listing
 * profiles, its own pages to publish or refresh, and the sites it logs.
 *
 * Plain module, relative imports only, so node --test loads it. Words the
 * pages draw live here, so no component types its own.
 */

/** Every lens, as opportunities.lens's check lists them. The three link lenses are P10's (wave 3). */
export const LENSES = ["cited", "lists", "threads", "profiles", "own", "logged", "link_domain", "link_page", "mention"] as const;
export type Lens = (typeof LENSES)[number];

/** The tabs on the list view, in order (section 4.7 row 2). */
export const TAB_LENSES = ["cited", "lists", "threads", "profiles", "own", "logged"] as const;
export type TabLens = (typeof TAB_LENSES)[number];

/** The lenses that come from the pages the engines cite (the header counts' set). */
export const AI_CITED_LENSES: readonly Lens[] = ["cited", "threads", "profiles"];

/** P10's lenses: a domain or page from DataForSEO's Backlinks data, or a mention without a link. */
export const LINK_LENSES: readonly Lens[] = ["link_domain", "link_page", "mention"];

export const LENS_LABEL: Record<TabLens, string> = {
  cited: "Cited, leaves you out",
  lists: "Best-of lists on Google",
  threads: "Threads",
  profiles: "Review and listing profiles",
  own: "Pages to publish or refresh",
  logged: "Sites you logged",
};

export const ROUTES = ["ask_added", "send_correction", "get_listed", "answer_thread", "offer_resource", "publish_own", "refresh_own", "earn_link", "ask_for_link", "leave_it"] as const;
export type Route = (typeof ROUTES)[number];

/** The route pill's words (section 6.2, the route table). */
export const ROUTE_LABEL: Record<Route, string> = {
  ask_added: "Ask to be added",
  send_correction: "Send a correction",
  get_listed: "Get listed or reviewed",
  answer_thread: "Answer in the thread",
  offer_resource: "Offer a resource",
  publish_own: "Publish your own",
  refresh_own: "Refresh your own",
  earn_link: "Earn a link",
  ask_for_link: "Ask for a link",
  leave_it: "Leave it",
};

export const STATUSES = ["new", "pursuing", "pitched", "won", "declined", "dismissed"] as const;
export type OppStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<OppStatus, string> = {
  new: "New",
  pursuing: "Pursuing",
  pitched: "Pitched",
  won: "Won",
  declined: "Declined",
  dismissed: "Not for us",
};

/** The statuses a pursuit is in; Pursuing and Pitched count against the cap (allowances.ts `pursuits`). */
export const ACTIVE: readonly OppStatus[] = ["pursuing", "pitched"];
/** The Pursuing view's statuses (section 4.7). */
export const PURSUING_VIEW: readonly OppStatus[] = ["pursuing", "pitched", "won"];

/** "Not for us" reasons, as dismiss_reason's check lists them; the chips draw the first four. */
export const DISMISS_REASONS = ["competitor_site", "not_relevant", "cannot_approach", "already_listed", "other"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export const DISMISS_LABEL: Record<DismissReason, string> = {
  competitor_site: "A competitor's own site",
  not_relevant: "Not relevant",
  cannot_approach: "Can't approach",
  already_listed: "Already listed",
  other: "Other",
};
export const DISMISS_CHIPS: readonly DismissReason[] = ["competitor_site", "not_relevant", "cannot_approach", "already_listed"];

export const DOMAIN_TYPES = ["vendor", "platform", "publisher", "review_platform", "community", "video", "reference", "directory", "institutional", "other"] as const;
export type DomainType = (typeof DOMAIN_TYPES)[number];
export const PAGE_TYPES = ["best_of", "comparison", "alternatives", "review_profile", "how_to", "article", "thread", "category", "product", "homepage", "other"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const DOMAIN_TYPE_LABEL: Record<DomainType, string> = {
  vendor: "Vendor",
  platform: "Platform",
  publisher: "Publisher",
  review_platform: "Review site",
  community: "Community",
  video: "Video",
  reference: "Reference",
  directory: "Directory",
  institutional: "Institution",
  other: "Other",
};
export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  best_of: "Best-of list",
  comparison: "Comparison",
  alternatives: "Alternatives",
  review_profile: "Review profile",
  how_to: "How-to",
  article: "Article",
  thread: "Thread",
  category: "Category page",
  product: "Product page",
  homepage: "Homepage",
  other: "Other",
};
/** A blank type reads this (section 4.5). */
export const NOT_CLASSIFIED = "not classified yet";

/** Best-of lists, comparisons and alternatives: the page types the `lists` and `own` lenses are about. */
export const LIST_TYPES: readonly PageType[] = ["best_of", "comparison", "alternatives"];

/** The bounds of what a member types here, read by the inputs and by the route alike. */
export const OPP_LIMITS = { url: 500, note: APP_LIMITS.note } as const;

/**
 * The longest page address and page key a row holds (the table checks url at
 * 500 and url_key at 520). A cited page past it is skipped and counted in the
 * night's note rather than written cut short: a cut address is a broken link,
 * and a key past the check fails the insert every night.
 */
export const URL_MAX = OPP_LIMITS.url;
export const fitsRow = (url: string, urlKey: string): boolean => url.length <= URL_MAX && urlKey.length <= URL_MAX;

/** A row the lists keep while new: derived by the latest refresh. Older new rows are no longer cited and drop out. */
export const LIVE_DAYS = 14;

/**
 * The evidence snapshot (section 6.2 step 8), allow-listed: our own counts
 * over the 28 days to `to`. Nothing here is a vendor's or a model's.
 */
export type OppEvidence = {
  /** The last day the counts run to. */
  to: Day;
  /** Answers to the client's prompts citing the page in 28 days. */
  answers: number;
  /** Of those, the answers that did not name the client. */
  leaves_out: number;
  /** Of those, the ones that named at least one other brand. */
  others_named: number;
  /** The prompts citing it (ids, at most 20), and how many there were. */
  prompts: string[];
  prompt_count: number;
  /** The engines that cited it, in the tier's order. */
  engines: string[];
  /** Other brands named in the answers that cite it and leave the client out (at most 5, most named first). */
  competitors: string[];
  /** Distinct days cited in the last 14 and the last 7. */
  days_14: number;
  days_7: number;
  /** The last day cited. */
  last_cited: Day | null;
  /** Its best place in Google's top 10 for a cluster keyword at the latest reading, and that keyword. */
  rank: number | null;
  keyword: string | null;
  /** The latest answer citing it and leaving the client out: what each count opens. */
  open: { prompt: string; day: Day; engine: string } | null;
  /** `own` rows: the page type the cluster's cited and top-10 pages show, and how many of them. */
  own_type?: PageType | null;
  own_seen?: number;
};

export const EMPTY_EVIDENCE = (to: Day): OppEvidence => ({ to, answers: 0, leaves_out: 0, others_named: 0, prompts: [], prompt_count: 0, engines: [], competitors: [], days_14: 0, days_7: 0, last_cited: null, rank: null, keyword: null, open: null });

/** One entry of a row's history (the detail page's History block). */
export type HistoryEntry = { at: string; kind: "status" | "verify" | "prompt" | "note"; status?: OppStatus; by?: string; text?: string };
export const HISTORY_MAX = 50;

/** What a verification read (section 6.9). `rel` is null when the read could not see it (the content_parsing fallback). */
export type Verification = {
  at: Day;
  via: "own" | "content_parsing";
  /** The page could be read. */
  ok: boolean;
  http: number | null;
  names: boolean | null;
  link: boolean | null;
  rel: "followed" | "not_followed" | null;
  anchor: string | null;
  /** The card's whole line, worded by verify.ts. */
  text: string;
  /** A free read could not reach the page, so the paid fallback reads it on its next night. */
  fallback?: boolean;
  /** Since when the brand has appeared, carried from read to read. */
  names_since?: Day | null;
  /** A link or mention the read before found and this one did not: the Slipping candidate (section 6.1). */
  removed?: "link" | "mention";
};

/** First cited after pursuing, per engine: the day and the prompt. */
export type FirstCited = Record<string, { day: Day; prompt: string }>;

/** One opportunities row as the loaders, jobs and routes read it. */
export type Opportunity = {
  id: string;
  clientId: string;
  clusterId: string | null;
  lens: Lens;
  url: string;
  urlKey: string;
  domain: string;
  title: string | null;
  pageType: PageType | null;
  domainType: DomainType | null;
  route: Route;
  status: OppStatus;
  dismissReason: DismissReason | null;
  evidence: OppEvidence;
  firstSeen: Day | null;
  lastSeen: Day | null;
  live: boolean;
  revealedAt: string | null;
  statusAt: string | null;
  statusBy: string | null;
  pursuedOn: Day | null;
  note: string | null;
  promptId: string | null;
  verified: Verification | null;
  firstCited: FirstCited | null;
  history: HistoryEntry[];
  createdAt: string;
};

/** The columns every read of opportunities takes, named. */
export const OPP_COLUMNS =
  "id, client_domain_id, cluster_id, lens, url, url_key, domain, title, page_type, domain_type, route, status, dismiss_reason, evidence, first_seen, last_seen, live, revealed_at, status_at, status_by, pursued_on, note, prompt_id, verified, first_cited, history, created_at";

/** One page_reads row as the pages read it. No body text is stored. */
export type PageFacts = {
  urlKey: string;
  url: string;
  readAt: string;
  via: "own" | "content_parsing";
  status: "ok" | "blocked" | "error" | "not_html";
  http: number | null;
  title: string | null;
  h1: string | null;
  updatedOn: Day | null;
  headings: string[];
  /** Null when the read could not tell: a page we could not read, or a fallback read that returned no body. */
  namesClient: boolean | null;
  snippet: string | null;
  brandsFound: string[];
  linksToClient: boolean | null;
  linkRel: "followed" | "not_followed" | null;
  linkAnchor: string | null;
  /**
   * The last time a read was tried, when that try could not see the page and
   * the facts above are an earlier read's (record.ts writePageRead keeps a
   * good read over a failed one). The night's picker waits STALE_DAYS from
   * whichever is later, so a page that has started failing does not take a
   * read slot every night. Absent or null when the latest try is the read above.
   */
  attemptedAt?: string | null;
};

export const PAGE_READ_COLUMNS = "url_key, url, read_at, via, status, http_status, title, h1, updated_on, headings, names_client, client_snippet, brands_found, links_to_client, link_rel, link_anchor, attempted_at";

/** A source_kinds row. */
export type KindRow = { key: string; level: "domain" | "page"; domain_type: DomainType | null; page_type: PageType | null; set_by: "rule" | "model" };

const pick = <T extends string>(v: unknown, set: readonly T[]): T | null => (typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : null);
export const isLens = (v: unknown): v is Lens => pick(v, LENSES) !== null;
export const isTabLens = (v: unknown): v is TabLens => pick(v, TAB_LENSES) !== null;
export const isRoute = (v: unknown): v is Route => pick(v, ROUTES) !== null;
export const isStatus = (v: unknown): v is OppStatus => pick(v, STATUSES) !== null;
export const pickDomainType = (v: unknown): DomainType | null => pick(v, DOMAIN_TYPES);
export const pickPageType = (v: unknown): PageType | null => pick(v, PAGE_TYPES);
export const pickDismiss = (v: unknown): DismissReason | null => pick(v, DISMISS_REASONS);

/** A uuid, or the fixture's own ids ("opp-..."): the only ids a route or page takes. */
export const OPP_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|opp-[a-z0-9-]{1,40})$/i;
