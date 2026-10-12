/**
 * What a DIY read costs, for reserving before it goes out (13 Oct 2026, DIY
 * P1; spec 10 sections 5.1 and 5.6 item 2). Pure.
 *
 * **Every figure here is an estimate.** DataForSEO's are the account's own
 * price table read on 12 Oct 2026 (research note 04, section 2), after the
 * 1 Jul 2026 price rise; Anthropic's are the first-party list prices cached
 * on 6 Oct 2026. They size a reservation - the most a read can cost - and
 * nothing else: a read settles at what the vendor actually billed
 * (`task.cost`) or, for a model call, at the usage it reported times the
 * price below. After Danny switches `diy_enabled` on, the first call of each
 * door logs its actual into `diy_reads`; compare it with this table and
 * record the actuals here, with the date (P1 acceptance, section 7.2).
 *
 * Actuals recorded: none yet (diy_enabled is false at ship).
 *
 * How many clients fit a night is a throughput figure, not a dollar one
 * (section 5.6): P9 records reads completed per worker-second after the
 * first enabled night, and the client count that gives, here, with the date.
 */

/** The DIY endpoints that bill, by the name the ledger stores in `diy_reads.endpoint`. */
export const DIY_ENDPOINTS = [
  "ranked_keywords",
  "relevant_pages",
  "competitors_domain",
  "instant_pages",
  "content_parsing",
  "diy_classify",
  "diy_example",
] as const;
export type DiyEndpoint = (typeof DIY_ENDPOINTS)[number];

/** The five doors a paid read goes through, as `diy_reads.door` checks them. */
export const DOORS = ["labs", "backlinks", "onpage", "content", "model"] as const;
export type Door = (typeof DOORS)[number];

/** Which door each launch endpoint goes through. Backlinks and content are W3's (P10). */
export const DOOR_OF: Record<DiyEndpoint, Door> = {
  ranked_keywords: "labs",
  relevant_pages: "labs",
  competitors_domain: "labs",
  instant_pages: "onpage",
  content_parsing: "onpage",
  diy_classify: "model",
  diy_example: "model",
};

/** DataForSEO, per family: a request price and a row price (section 5.1). */
export const DFS_PRICES = {
  /** Labs Google standard endpoints. `status` is free. */
  labs: { request: 0.012, row: 0.00012 },
  /** Every Backlinks live endpoint, for P10. `available_filters` is free. */
  backlinks: { request: 0.024, row: 0.000036 },
  /** Content Analysis `search`, for P10. */
  content: { request: 0.024, row: 0.000036 },
  /** OnPage `instant_pages` with `enable_javascript`, per page. `microdata` is free for a paid task. */
  instantPagesJs: 0.0015,
  /** OnPage `content_parsing/live`, per page. */
  contentParsing: 0.00015,
} as const;

/** The most one DataForSEO read can cost: a Labs read bills its request and every row up to its `limit`. */
export function dfsEstimate(endpoint: DiyEndpoint, rows: number): number {
  switch (endpoint) {
    case "ranked_keywords":
    case "relevant_pages":
    case "competitors_domain":
      return round5(DFS_PRICES.labs.request + Math.max(0, rows) * DFS_PRICES.labs.row);
    case "instant_pages":
      return DFS_PRICES.instantPagesJs;
    case "content_parsing":
      return DFS_PRICES.contentParsing;
    case "diy_classify":
    case "diy_example":
      throw new Error(`${endpoint} is a model call: use modelEstimate`);
  }
}

/** The DIY model and its list prices per million tokens. Thinking tokens bill as output. */
export const DIY_MODEL_PRICES = { model: "claude-opus-5-5", inPerM: 4, outPerM: 20 } as const;

/**
 * Cache writes and reads, as multiples of the input price. Anthropic's
 * standard prompt-caching multipliers; an estimate like the rest until the
 * first classify call's usage is compared with the bill.
 */
export const CACHE_WRITE_X = 1.25;
export const CACHE_READ_X = 0.1;

/** Every DIY call's output ceiling (section 5.3): it bounds thinking plus output. */
export const DIY_MAX_TOKENS = 16_000;

/** Characters per token, for sizing a reservation from text. Generous on purpose: an over-estimate refuses early, never overspends. */
export const CHARS_PER_TOKEN = 3;

/** The most one model call can cost: its input, sized from its characters, and every output token it may use. */
export function modelEstimate(inputChars: number, maxTokens: number = DIY_MAX_TOKENS): number {
  const tokensIn = Math.ceil(Math.max(0, inputChars) / CHARS_PER_TOKEN);
  return round5((tokensIn * DIY_MODEL_PRICES.inPerM + maxTokens * DIY_MODEL_PRICES.outPerM) / 1_000_000);
}

export type ModelUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** What a model call cost, from the usage it reported. */
export function modelCost(usage: ModelUsage | null | undefined): number {
  if (!usage) return 0;
  const input = n(usage.input_tokens) + n(usage.cache_creation_input_tokens) * CACHE_WRITE_X + n(usage.cache_read_input_tokens) * CACHE_READ_X;
  return round5((input * DIY_MODEL_PRICES.inPerM + n(usage.output_tokens) * DIY_MODEL_PRICES.outPerM) / 1_000_000);
}

/** `diy_reads` holds numeric(10,5). */
export function round5(v: number): number {
  return Math.round(v * 100_000) / 100_000;
}
