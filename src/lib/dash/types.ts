/**
 * The dashboards host's data, as stored (Raw) and as drawn (Workspace).
 *
 * Raw is one client's rows, read in one pass (load.ts) or from a snapshot in a
 * local run (fixture.ts). Workspace is everything a page draws, derived from
 * Raw by model.ts with no I/O, so the same derivation runs on the server, in
 * the browser after an optimistic edit, and under `node --test`.
 */

import type { KeyPageRow } from "./target.ts";

export type Day = string;

/** The plans whose clusters we work on each month (17 Oct 2026). A cluster is managed when its tier is one of these. */
export const MANAGED_TIERS = ["mentioned", "cited", "everywhere"] as const;
export type Engine = "google_aio" | "chatgpt" | "gemini" | "perplexity" | "claude";
export type TierKey = "tracked" | "mentioned" | "cited" | "everywhere";

export type RawClient = {
  id: string;
  slug: string;
  domain: string;
  brand: string | null;
  market: string;
  tier: TierKey;
  status: string;
  started_on: Day | null;
  cluster_limit: number;
  trial_ends_at: string | null;
  payment_status: string | null;
  brand_aliases: string[];
};

/** tracked_keywords.added_by for a keyword picked for the buyer at signup (tracking/starter.ts, 22 Oct 2026). */
export const STARTER_BY = "starter";

export type RawCluster = { id: string; name: string; keyword_id: string | null; tier: string; started_on: Day; stopped_on: Day | null };
export type RawGroup = { id: string; cluster_id: string; name: string; note: string | null; terms: string[]; position: number; stopped_on: Day | null };
export type RawKeyword = {
  id: string;
  keyword: string;
  search_volume: number | null;
  intent: string | null;
  added_on: Day;
  stopped_on: Day | null;
  /** 18 Oct 2026 (brief 2c): "primary", or a primary's free "plural" / "singular" (pair_of names it). Absent = primary. */
  form?: "primary" | "plural" | "singular";
  pair_of?: string | null;
  cluster_id: string | null;
  group_id: string | null;
  /** Who added it: "nomada", a member's email, or "starter" - picked for the buyer at signup (starter.ts, 22 Oct 2026). */
  added_by?: string | null;
};
export type RawPrompt = {
  id: string;
  text: string;
  cluster_id: string | null;
  group_id: string | null;
  angle: string | null;
  added_on: Day;
  stopped_on: Day | null;
  origin_kind?: string | null;
  /** 'placement' for a prompt in the placement allowance (limits.ts), counted apart from the plan's. */
  allowance?: string | null;
};
export type RawRun = { run_date: Day; status: string; engines: string[] };
export type RawSerp = { run_date: Day; keyword_id: string; position: number | null; url: string | null };
export type Citation = { url: string; title?: string | null; source_domain?: string | null; position?: number | null };
export type RawAnswer = {
  run_date: Day;
  question_id: string;
  engine: Engine;
  answered: boolean;
  named: boolean;
  brands?: string[] | null;
  citations?: Citation[] | null;
};
/** keyword_footprints.rows: k keyword, p position, u url, v volume, i intent. */
export type FootRow = { k: string; p: number | null; u: string | null; v: number | null; i?: string | null };
export type RawOpportunity = {
  id?: string;
  cluster_id: string | null;
  lens: string;
  url: string;
  domain: string;
  title: string | null;
  route: string | null;
  status: string;
  evidence: { engines?: string[]; answers?: number; competitors?: string[]; last_cited?: string; prompt_count?: number } | null;
};
export type RawPlacement = {
  id: string;
  /** Drawn on a demo link only, and labelled there: no such placement exists. */
  sample?: boolean;
  cluster_id: string;
  kind: "guest_post" | "link_insertion" | "on_site" | "coverage";
  url: string;
  domain: string;
  status: "pitched" | "writing" | "scheduled" | "live" | "removed";
  scheduled_on: Day | null;
  live_on: Day | null;
  anchor_text: string | null;
};
export type Provider = "ga4" | "gsc" | "bing";
export type RawConnection = { provider: Provider; status: string; property: string | null; requested_at: string | null; connected_at: string | null; last_synced_at: string | null };
export type RawConsoleRow = { provider: "gsc" | "bing"; query: string; clicks: number; impressions: number; ctr: number | null; position: number | null; period_end: Day };

export type Raw = {
  client: RawClient;
  role: string;
  today: Day;
  clusters: RawCluster[];
  groups: RawGroup[];
  keywords: RawKeyword[];
  prompts: RawPrompt[];
  runs: RawRun[];
  serp: RawSerp[];
  answers: RawAnswer[];
  footprint: { pulled_on: Day; rows: FootRow[] } | null;
  opportunities: RawOpportunity[];
  placements: RawPlacement[];
  connections: RawConnection[];
  consoleRows: RawConsoleRow[];
  /** False until 20261017000000 is applied: no groups table, no group_id columns. Groups are then read-only and empty. */
  groupsReady: boolean;
  /** Live key pages (DIY P8), for each cluster's target page (target.ts). Absent on a snapshot taken before 18 Oct 2026. */
  keyPages?: KeyPageRow[];
};

// ---------------------------------------------------------------- derived

export type Allowance = { used: number; limit: number };
export type Allowances = { clusters: Allowance; prompts: Allowance; keywords: Allowance };

export type ConsoleFig = { clicks: number; impr: number; ctr: number; pos: number | null };

export type KeywordView = {
  id: string | null;
  keyword: string;
  volume: number | null;
  /** tracked: checked daily, counts against the plan. footprint: from the monthly ranking snapshot, free. */
  src: "tracked" | "footprint";
  pos: number | null;
  change: number | null;
  url: string | null;
  hist: [Day, number | null][];
  console: { gsc: ConsoleFig | null; bing: ConsoleFig | null };
  addedOn: Day | null;
  /** Google ranked a different page of the site for it in the last 14 days (model.ts pageChangeOf). */
  pageChange: { from: string; to: string; on: Day } | null;
  /** The page ranking for it is the homepage. */
  homepage: boolean;
  /** 18 Oct 2026 (brief 2c): a tracked keyword's form, the primary a plural/singular pairs with, and a primary's suggested other form when it has none live. */
  form?: "primary" | "plural" | "singular";
  pairOf?: string | null;
  suggestPair?: string | null;
};

export type PromptView = {
  id: string;
  text: string;
  angle: string | null;
  addedOn: Day;
  measured: boolean;
  /** Named / answered across engines on the latest reading, 0..1, or null before the first. */
  rate: number | null;
  /** One cell per engine on the latest reading: named, not named, no answer, or not read. */
  cells: Partial<Record<Engine, "named" | "missed" | "none" | null>>;
  /** Engine x day verdicts, oldest first, for the strip. */
  days: Partial<Record<Engine, ("named" | "missed" | "none" | null)[]>>;
};

export type GroupView = {
  id: string | null;
  name: string;
  note: string | null;
  terms: string[];
  keywords: KeywordView[];
  prompts: PromptView[];
  discovered: { gsc: (ConsoleFig & { q: string })[]; bing: (ConsoleFig & { q: string })[] };
};

export type ClusterView = {
  id: string;
  name: string;
  tier: string;
  startedOn: Day;
  headKeyword: string | null;
  /** Picked for the buyer at signup (keyword "starter", starter.ts): the board says so and that it is theirs to change. */
  suggested: boolean;
  /** The page a person chose for this cluster (target.ts); null until one is set. */
  target: string | null;
  headVolume: number | null;
  headPos: number | null;
  headChange: number | null;
  rate: number | null;
  rateTrend: (number | null)[];
  groups: GroupView[];
  /** Keywords and prompts with no group: the cluster's own. */
  own: GroupView;
  trackedKeywords: number;
  prompts: number;
  placements: RawPlacement[];
  /** Worked by us on the client's plan (tracked_clusters.tier is a paid tier), not only tracked. */
  managed: boolean;
  /** The cluster keyword's first position held, and the cluster's first naming rate, for "since we started". */
  startPos: number | null;
  startRate: number | null;
  /** Answers in the last 7 readings citing a page one of this cluster's live placements is on. */
  placementCitations: number;
};

export type Workspace = {
  client: RawClient;
  role: string;
  canWrite: boolean;
  today: Day;
  engines: Engine[];
  dates: Day[];
  lastRun: RawRun | null;
  allowances: Allowances;
  clusters: ClusterView[];
  /** Prompts and keywords on no cluster (admin-made, still read daily). */
  loose: { prompts: PromptView[]; keywords: KeywordView[] };
  rate: number | null;
  rateTrend: (number | null)[];
  /** The last 7 readings, across live prompts: answers given, answers naming the client, answers citing its site. */
  window: { readings: number; answers: number; named: number; cited: number };
  brands: { name: string; answers: number; you: boolean }[];
  sources: { domain: string; answers: number; urls: number; you: boolean; engines: Engine[] }[];
  opportunities: RawOpportunity[];
  connections: Partial<Record<Provider, RawConnection>>;
  consoleLive: { gsc: boolean; bing: boolean };
  footprintOn: Day | null;
  groupsReady: boolean;
};
