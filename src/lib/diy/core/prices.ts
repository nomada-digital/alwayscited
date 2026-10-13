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
  // 13 Oct 2026, DIY P10 (spec 10 sections 5.1 and 5.2): wave 3's Backlinks and Content Analysis reads, named as
  // dataforseo-request.ts DIY_LINK_PATHS keys them.
  "backlinks_summary",
  "backlinks_links",
  "backlinks_series",
  "backlinks_bulk_ranks",
  "backlinks_bulk_domains",
  "backlinks_bulk_new_lost",
  "backlinks_domain_gap",
  "backlinks_page_gap",
  "backlinks_competitors",
  "content_search",
] as const;
export type DiyEndpoint = (typeof DIY_ENDPOINTS)[number];

/** The five doors a paid read goes through, as `diy_reads.door` checks them. */
export const DOORS = ["labs", "backlinks", "onpage", "content", "model"] as const;
export type Door = (typeof DOORS)[number];

/** Which door each endpoint goes through. Backlinks and content are W3's (P10), as dataforseo-request.ts DIY_LINK_DOOR records them. */
export const DOOR_OF: Record<DiyEndpoint, Door> = {
  ranked_keywords: "labs",
  relevant_pages: "labs",
  competitors_domain: "labs",
  instant_pages: "onpage",
  content_parsing: "onpage",
  diy_classify: "model",
  diy_example: "model",
  backlinks_summary: "backlinks",
  backlinks_links: "backlinks",
  backlinks_series: "backlinks",
  backlinks_bulk_ranks: "backlinks",
  backlinks_bulk_domains: "backlinks",
  backlinks_bulk_new_lost: "backlinks",
  backlinks_domain_gap: "backlinks",
  backlinks_page_gap: "backlinks",
  backlinks_competitors: "backlinks",
  content_search: "content",
};

/**
 * The two free DataForSEO paths `freeRead` takes, and what each costs: 0.
 * Recorded from the account's own price table read on 12 Oct 2026 (research
 * note 04, section 2: Labs `status` and Backlinks `available_filters` are
 * free), not from a sample response, which would only say what its writer
 * typed (13 Oct 2026, review of DIY P1). `request-shape.test.mts` pins both.
 */
export const DIY_FREE_COST = { labs_status: 0, backlinks_filters: 0 } as const;
export const DIY_FREE_COST_SOURCE = "research note 04 (docs/diy-platform-2026-10-12/04-dataforseo.md) section 2, the account's price table read 12 Oct 2026";

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
    // 13 Oct 2026, DIY P10: a Backlinks or Content Analysis read bills its request and every row up to its limit
    // (section 5.1: $0.024 + $0.000036 a row); a summary reserves one row ([VERIFY] on its first task.cost).
    case "backlinks_summary":
    case "backlinks_links":
    case "backlinks_series":
    case "backlinks_bulk_ranks":
    case "backlinks_bulk_domains":
    case "backlinks_bulk_new_lost":
    case "backlinks_domain_gap":
    case "backlinks_page_gap":
    case "backlinks_competitors":
      return round5(DFS_PRICES.backlinks.request + Math.max(0, rows) * DFS_PRICES.backlinks.row);
    case "content_search":
      return round5(DFS_PRICES.content.request + Math.max(0, rows) * DFS_PRICES.content.row);
    case "diy_classify":
    case "diy_example":
      throw new Error(`${endpoint} is a model call: use modelEstimate`);
  }
}

/** The DIY model and its list prices per million tokens. Thinking tokens bill as output. */
export const DIY_MODEL_PRICES = { model: "claude-opus-5-5", inPerM: 4, outPerM: 20 } as const;

/**
 * Every model a DIY call can be answered by, with its list prices per million
 * tokens (13 Oct 2026, review of DIY P1). Both DIY calls turn the refusal
 * fallback on (`fallbacks: "default"`), so a declined call is answered by
 * another model at that model's own rates; Claude Opus 5.5's permitted
 * fallback targets are Claude Opus 5 and Claude Opus 4.8. Anthropic's
 * first-party list prices, as cached on 6 Oct 2026, like the rest of this
 * file. A model not listed is priced at the dearest here: an over-count
 * refuses early, never overspends.
 */
export const MODEL_PRICES: Readonly<Record<string, { inPerM: number; outPerM: number }>> = {
  "claude-opus-5-5": { inPerM: DIY_MODEL_PRICES.inPerM, outPerM: DIY_MODEL_PRICES.outPerM },
  "claude-opus-5": { inPerM: 5, outPerM: 25 },
  "claude-opus-4-8": { inPerM: 5, outPerM: 25 },
};

const DEAREST = Object.values(MODEL_PRICES).reduce((a, b) => (b.inPerM + b.outPerM > a.inPerM + a.outPerM ? b : a));

/**
 * One model's prices: the DIY model when the answer names none (it is the
 * model asked), the longest listed id the name starts with (so a dated
 * `claude-opus-5-...` is Opus 5 and `claude-opus-5-5` is not), else the
 * dearest listed.
 */
export function pricesFor(model: string | null | undefined): { inPerM: number; outPerM: number } {
  if (!model) return MODEL_PRICES[DIY_MODEL_PRICES.model]!;
  const hit = Object.keys(MODEL_PRICES)
    .filter((id) => model === id || model.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? MODEL_PRICES[hit]! : DEAREST;
}

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

type Tokens = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** One attempt inside a call (a declined one, then the fallback that served it), each naming its model. */
export type IterationUsage = Tokens & { model?: string | null; type?: string | null };

export type ModelUsage = Tokens & {
  /** Per attempt, when the API itemises them: the source of truth for a call that fell back (top-level usage covers only the serving attempt). */
  iterations?: readonly IterationUsage[] | null;
};

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function tokensCost(t: Tokens, price: { inPerM: number; outPerM: number }): number {
  const input = n(t.input_tokens) + n(t.cache_creation_input_tokens) * CACHE_WRITE_X + n(t.cache_read_input_tokens) * CACHE_READ_X;
  return (input * price.inPerM + n(t.output_tokens) * price.outPerM) / 1_000_000;
}

/**
 * What a model call cost, from the usage it reported. With `iterations`, the
 * sum of every attempt at its own model's prices - a declined attempt that
 * may bill and the fallback that served it; otherwise the top-level usage at
 * the answering model's prices (`model`, the response's own field).
 */
export function modelCost(usage: ModelUsage | null | undefined, model?: string | null): number {
  if (!usage) return 0;
  const its = Array.isArray(usage.iterations) ? usage.iterations : [];
  if (its.length) return round5(its.reduce((t, it) => t + tokensCost(it, pricesFor(it.model ?? model)), 0));
  return round5(tokensCost(usage, pricesFor(model)));
}

/** `diy_reads` holds numeric(10,5). */
export function round5(v: number): number {
  return Math.round(v * 100_000) / 100_000;
}
