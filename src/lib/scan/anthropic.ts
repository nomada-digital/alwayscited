import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { QUESTIONS } from "@/config/scan-shape";

import { brandedQuestions, withoutBrand } from "./brand-name";
import type { Market } from "./domain";
import { batchBlocks, runBatches } from "./prose-batches";
import { countingFetch, withRetry } from "./retry-policy";
import { sourceKindRequest, sourceKindSystem } from "./source-kind-prompt";
import { normaliseCandidate } from "./target-keyword";

const MODEL = "claude-opus-5";

/**
 * The DIY platform's model (13 Oct 2026, DIY P1; spec 10 section 5.3), for
 * `classifyPages` and `writeReoptExample` at the foot of this file only. The
 * scan's MODEL above is unchanged.
 */
export const DIY_MODEL = "claude-opus-5-5";

/**
 * These are short extraction and generation tasks with explicit rules, so low
 * effort is the right setting: it keeps the five model calls in this file
 * inside the scan's budget without trading away accuracy.
 *
 * Eight, not three - `readBrand`, `generateQuestions`, `readCoverage` (1 Oct
 * 2026, R140), `keywordCandidates` (27 Sep 2026, R39), `clusterKeywordCandidates` (30 Sep 2026, BRIEF-3 C1),
 * `extractBrands`, `classifyBrands` and `classifySourceDomains`. The count said three while the
 * file had carried five for some time, which is the drifted-count species: the
 * number is not the point, the point is that "every call here is low effort"
 * was a census carried in prose with nothing executing it.
 * `retry-policy.test.mts` walks the `messages.parse` calls and holds it.
 */
const EFFORT = "low" as const;

let client: Anthropic | null = null;
function baseClient(): Anthropic {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY must be set. The scan cannot read a site without it.");
  }
  client = new Anthropic();
  return client;
}

/**
 * The client every model call in this file goes through, billing onto `billed`.
 *
 * `withOptions` clones the client with a wrapped `fetch`, so the tally is taken
 * below the SDK rather than above it. The SDK retries 408, 409, 429, every 5xx
 * and a connection error twice of its own before an error surfaces to
 * `withRetry` - `maxRetries` defaults to 2 - so counting at the `withRetry`
 * layer counted one request where three had gone out. `retry-policy.ts` carries
 * why that matters to a spend ceiling rather than to a log line.
 *
 * The global `fetch` underneath, because that is what the base client is
 * already using: the SDK sets `this.fetch = options.fetch ?? getDefaultFetch()`
 * and `baseClient` passes no options, so the two are the same function. Its own
 * `fetch` cannot be read back - the property is private - so the equality is
 * held by rule 4 of `retry-policy.test.mts` instead, which fails if the
 * construction ever gains a `fetch` of its own and leaves this wrapping the
 * wrong one.
 */
function anthropic(billed?: { calls: number }): Anthropic {
  const base = baseClient();
  if (!billed) return base;
  return base.withOptions({ fetch: countingFetch(billed, fetch) });
}

/**
 * `withRetry` is the outer of TWO retry layers and is now in `retry-policy.ts`.
 *
 * It lived here and could not be loaded by `node --test`, so the policy under
 * every model call this product makes had no check on it and the sentence it
 * carried was wrong in both halves. Read that file: the SDK's own `maxRetries`
 * defaults to 2, so one `withRetry` call is up to nine requests rather than
 * three, and the SDK obeys a `retry-after` header with no ceiling of ours.
 *
 * What is worth keeping here is which of these five calls it protects and how
 * they differ. `generateQuestions` is the one a visitor is waiting on on the
 * first screen of the funnel, so a failure costs the scan outright. The three
 * batched calls that run after every engine read has already been paid for -
 * brand extraction, brand judgement and source classification - sit inside a
 * never-fatal catch, so a 529 in one of them does not fail the scan the way it
 * would there. It quietly shortens the leaderboard or the placement list,
 * which is the failure worth retrying hardest rather than the one worth
 * retrying least.
 *
 * The cost is bounded by the run, not by the arithmetic here: the batch count
 * scales with what the engines gave back (`CLASSIFY_BATCH` is 50 and the header
 * over it sizes a 400-source scan at eight batches), and each failed one costs
 * the SDK's backoff plus 5.5s. What holds it is `RUN_TIMEOUT` and the platform
 * cap above it, which is the ladder `run-steps.ts` records.
 */

/** Turns SDK errors into one readable message, keeping the retryable ones distinguishable. */
export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return "the language model is rate limited";
  if (err instanceof Anthropic.AuthenticationError) return "the ANTHROPIC_API_KEY is not valid";
  if (err instanceof Anthropic.BadRequestError) return `bad request to the language model: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `language model error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------- brand read

export const TOPIC_VARIANT_COUNT = 5;

const BrandRead = z.object({
  brand_name: z.string().describe("The company's own name, as it writes it"),
  positioning: z.string().describe("One paragraph on what it sells and who to"),
  suggested_topic: z.string().describe("The buyer's category phrase, two to four words"),
  topic_variants: z
    .array(z.string())
    .describe(
      `Up to ${TOPIC_VARIANT_COUNT} buyer phrases for the services it sells and the industries it serves`,
    ),
  services: z
    .array(z.string())
    .describe("Up to five services the site says it sells, as a buyer would name each one"),
  industries: z
    .array(z.string())
    .describe("Up to four industries or sectors the site shows it serves, strongest first - case studies and client lists count"),
  confidence: z.enum(["high", "low"]),
});
export type BrandRead = z.infer<typeof BrandRead>;

export async function readBrand(siteText: string, billed?: { calls: number }): Promise<BrandRead> {
  // Retried for the same reason the question set is: this is the first thing a
  // visitor does, and a 529 here reads to them as "your site cannot be read".
  //
  // The counter goes to the client rather than to withRetry now. A retry is a
  // second request and this was the one site with no sink for the count at all:
  // the scan row recorded a flat 1 however many attempts went out. It then had
  // the sink and still undercounted, because withRetry sees attempts and the
  // SDK retries twice inside each one - see `retry-policy.ts`. The run this
  // retry exists for is exactly the run whose cost went unrecorded, and
  // daily_cost_cap_usd is read off that column.
  const res = await withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: EFFORT, format: zodOutputFormat(BrandRead) },
    system: [
      "You read a company's own website and report what it sells.",
      "",
      "The topic is the hard part. It must be how a BUYER says it, not how the",
      "company pitches itself: a category noun phrase a buyer would type into a",
      "search box. Two to four words. No brand names. No adjectives the company",
      "invented for itself, no slogans, no words like bespoke, innovative,",
      "world-class, or award-winning.",
      "",
      'Good: "b2b seo agency", "commercial epoxy flooring", "invoice finance".',
      'Bad: "growth partner", "digital transformation experts", "the Acme method".',
      "",
      "Then read the site for two lists. The text may include several pages,",
      "each headed with its address: the homepage, and where they exist the",
      "services, industries, case studies or work pages.",
      "",
      "services: what they sell, as a buyer names each service. 'seo',",
      "'answer engine optimisation', 'digital pr', 'paid search'. Not a slogan.",
      "",
      "industries: the sectors they serve, strongest evidence first. Case",
      "studies and named clients are the best evidence - a firm with four retail",
      "case studies serves retail even if the homepage never says so.",
      "",
      `Then give up to ${TOPIC_VARIANT_COUNT} topic variants, built from those lists:`,
      "the category a buyer would search for, narrowed by a service or by an",
      "industry. For a b2b seo agency with retail and ecommerce case studies:",
      "'b2b seo agency', 'seo and aeo agency', 'seo agency for retail brands',",
      "'ecommerce seo agency'.",
      "",
      "Variants must stay BROAD enough that a real buyer searches them. Never",
      "narrow by how the company describes its own delivery or culture - no",
      "'founder-led', 'senior-only', 'no junior handoff', 'boutique', 'award-",
      "winning'. Those are the company's pitch, not a buyer's search, and no",
      "engine will ever be asked them.",
      "",
      "Every variant is lower case, two to six words, no brand names, and must",
      "stand on its own as a search someone would actually run.",
      "",
      "Set confidence to low when the site does not make the category clear.",
    ].join("\n"),
    messages: [{ role: "user", content: `Website text:\n\n${siteText}` }],
  }));

  const out = res.parsed_output;
  if (!out) throw new Error("could not read the brand from that site");
  return out;
}

// ------------------------------------------------------------ question build

/**
 * How many questions a scan asks.
 *
 * The number itself lives in config/scan-shape.ts and is re-exported under
 * this name so every server caller keeps working. It was declared in both
 * files, as 14 twice, with a comment in the other one asking whoever changed
 * it to remember this copy - which is the arrangement that already went wrong
 * once with the engine list, and cost the homepage a worked example naming an
 * engine the scan had stopped reading.
 *
 * This is the more expensive direction of the same mistake. The prompt asks
 * for exactly QUESTION_COUNT questions and the schema validates on it, while
 * the homepage, the FAQ and /about print QUESTIONS. Changing the pipeline
 * alone would leave every marketing page on the site quoting a number the
 * product no longer does, and nothing anywhere would fail.
 */
export const QUESTION_COUNT = QUESTIONS;

const QuestionKind = z.enum(["category", "positioning", "sector", "outcome", "comparison"]);
/** The kinds a stored question may carry. Anything else came from a visitor. */
export const QUESTION_KINDS: readonly string[] = QuestionKind.options;

const QuestionSet = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        kind: QuestionKind,
        /**
         * Which phrase this question belongs to. The confirm screen groups on
         * it so a buyer can drop a whole cluster before anything is paid for,
         * and it is normalised back onto the phrases we supplied: a cluster
         * that is not in the chips is a cluster nobody can turn off.
         */
        cluster: z.string().describe("The broad topic or variant phrase this question is for, copied exactly"),
      }),
    )
    .describe(`Exactly ${QUESTION_COUNT} questions`),
});
export type GeneratedQuestion = z.infer<typeof QuestionSet>["questions"][number];

/**
 * The year a buyer would actually type.
 *
 * Read at call time rather than baked in as a constant: a hardcoded year is
 * wrong from the first of January and nobody notices until a client does.
 */
function currentYear(): number {
  return new Date().getFullYear();
}

/**
 * Rewrites a year that has already passed to the current one.
 *
 * The question set is asked to carry the year, and the model left to itself
 * reaches for whatever year its training data ended in - which is how "best
 * electrolyte hydration sachets uk 2025" reached a real report in September
 * 2026. Naming the year in the prompt helps; this is the part that cannot
 * drift, because it does not depend on the model reading the instruction.
 *
 * Deliberately narrow. Only 2015 up to last year are touched, so capacities
 * and model numbers ("best 2000w inverter", "1200 series") are left alone, and
 * a forward-looking year is somebody's real search rather than a mistake.
 */
export function freshenYears(text: string, year = currentYear()): string {
  return text.replace(/\b20\d{2}\b/g, (match) => {
    const n = Number(match);
    return n >= 2015 && n < year ? String(year) : match;
  });
}

export async function generateQuestions(input: {
  topic: string;
  topicVariants?: string[];
  market: Market;
  brand: string;
  positioning: string | null;
  services?: string[];
  industries?: string[];
  /**
   * The cluster keyword that passed C1's check (BRIEF-3 step 5). When set,
   * the five kinds are five angles on it; when not (none qualified, or a read
   * failed) the questions are written on the category, as before.
   */
  keyword?: string | null;
  /** The subject's domain, so a question naming it by domain is caught too. */
  domain?: string | null;
}, billed: { calls: number } = { calls: 0 }): Promise<{ questions: GeneratedQuestion[]; calls: number }> {
  const marketName = input.market === "UK" ? "the United Kingdom" : "the United States";
  const year = currentYear();
  // Up to three requests behind one question set, and the count belongs to
  // the caller now. It was returned only on the way out, so the attempts a
  // set had already been billed for died with it whenever the last one threw -
  // the same defect a78a2b6 closed on the engine passes. A caller that hands
  // in an accumulator can bill through either exit.

  // The variants are what stop fourteen questions being fourteen rewordings of
  // one phrase. Without them the set collapses onto the broad category and the
  // result says nothing about how this brand is actually positioned.
  const variants = (input.topicVariants ?? []).filter((v) => v.trim()).slice(0, TOPIC_VARIANT_COUNT);

  const ask = () => withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: EFFORT, format: zodOutputFormat(QuestionSet) },
    system: [
      `You write the ${QUESTION_COUNT} questions a buyer in ${marketName} would ask`,
      "ChatGPT, Gemini, Perplexity or Google when they are choosing a supplier.",
      "",
      "EVERY QUESTION ASKS FOR A RECOMMENDATION. The buyer wants names back:",
      "'best ...', 'who are the best ...', 'top ... for ...', 'recommend a ...',",
      "'which ... should i use for ...'. A question that does not invite the",
      "engine to name suppliers cannot tell us whether this brand gets named,",
      "so it is wasted.",
      "",
      "Keep them BROAD. These are the questions a whole market asks, not a",
      "description of this one company. The broad topic is the anchor; a",
      "question narrows it by at most one thing - a service, an industry, or",
      "the market. Never by how the company describes its own delivery,",
      "seniority, culture or process. 'founder-led seo agency with senior-only",
      "delivery' is the company's pitch and nobody asks it. 'best b2b seo",
      "agency uk' is what gets asked.",
      "",
      "Exactly one of each kind:",
      "- category: the broad topic as a recommendation. 'best b2b seo agency uk'.",
      "- positioning: the topic plus a service the site sells, as a buyer",
      "  looking for that combination. 'agencies that offer seo and aeo as one",
      "  service'.",
      "- sector: the topic for the industry the site shows the strongest",
      "  evidence of serving, from its case studies if it has them. 'best seo",
      "  agency for retail brands'.",
      "- outcome: the topic plus the result the buyer wants. 'which seo agency",
      "  can get us recommended by chatgpt'.",
      "- comparison: a ranked or shortlist request. 'top 10 b2b seo agencies in",
      "  the uk' or 'who are the leading b2b seo agencies in the uk'.",
      "",
      "Never write a definition question. Nothing starting 'what is', 'what are',",
      "'how does ... work', or 'why is ... important'.",
      "",
      `The current year is ${year}. Only add a year where a buyer would, and if`,
      `you do it must be ${year}.`,
      "",
      "Every question carries the cluster it belongs to. Copy the broad topic,",
      "or the variant phrase, exactly as it was given to you - do not invent a",
      "new phrase and do not reword one.",
      "",
      "Write them lower case, plain, the way a person types into a chat box or",
      "a search bar. No question marks. Use the spelling and vocabulary of the",
      "market, not American English for a United Kingdom scan.",
      "Do not name the subject brand in any question.",
      ...(input.keyword
        ? [
            "",
            "A Google keyword is given. Every question is an angle on that keyword:",
            "the same buyer choosing the same kind of supplier, one question per kind,",
            "each still asking for a recommendation and narrowed by at most one thing.",
          ]
        : []),
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `Broad topic: ${input.topic}`,
          ...(input.keyword ? [`Google keyword the questions are angles on: ${input.keyword}`] : []),
          variants.length
            ? `Narrower variants to spread across: ${variants.join("; ")}`
            : "Narrower variants: none were read from the site, so work from the positioning below.",
          `Market: ${marketName}`,
          `Brand (do not name it in the questions): ${input.brand}`,
          `How the brand positions itself: ${input.positioning ?? "not stated"}`,
          `Services it sells: ${(input.services ?? []).join("; ") || "not read"}`,
          `Industries it serves, strongest first: ${(input.industries ?? []).join("; ") || "not read"}`,
        ].join("\n"),
      },
    ],
  }));

  const shape = (res: Awaited<ReturnType<typeof ask>>) => {
    const out = res.parsed_output;
    if (!out?.questions?.length) throw new Error("could not build the question set");
    return out.questions.slice(0, QUESTION_COUNT).map((q) => ({
      ...q,
      question: freshenYears(q.question, year),
      cluster: byKey.get((q.cluster ?? "").trim().toLowerCase()) ?? input.topic,
    }));
  };

  // Belt and braces: the instruction above is advisory, this is not. The
  // cluster is folded back onto a phrase we supplied, because the confirm
  // screen turns clusters into toggles - a cluster the model invented would
  // render as a chip that matches nothing the buyer recognises.
  const known = [input.topic, ...variants];
  const byKey = new Map(known.map((v) => [v.trim().toLowerCase(), v]));

  // "Do not name the subject brand" above is advisory too (30 Sep 2026). A
  // question naming the brand always names it: it measures nothing a buyer
  // does and becomes a tracked prompt that inflates the named rate. One more
  // set is asked for when any comes back branded; whatever is still branded
  // after that is dropped rather than asked.
  let questions = shape(await ask());
  if (brandedQuestions(questions, input.brand, input.domain).length) {
    const again = shape(await ask());
    if (brandedQuestions(again, input.brand, input.domain).length < brandedQuestions(questions, input.brand, input.domain).length) questions = again;
  }
  questions = withoutBrand(questions, input.brand, input.domain);
  if (!questions.length) throw new Error("could not build the question set: every question named the brand");
  return { questions, calls: billed.calls };
}

// ------------------------------------------------------------ coverage draft

const CoverageDraft = z.object({
  brand: z.string().describe("The brand the coverage is about, as the pieces write it. Empty when no piece makes it clear"),
  claim: z
    .string()
    .describe("What the brand should be referenced for: a capability or a claim, two to six words, never a headline"),
  segment: z.string().describe("Who it is for, two to five words. Empty when the pieces do not say"),
  prompts: z
    .array(z.object({ prompt: z.string(), kind: QuestionKind }))
    .describe(`Exactly ${QUESTION_COUNT} prompts, one of each kind`),
});
export type CoverageDraftRead = z.infer<typeof CoverageDraft>;

/**
 * The draft /coverage-check's step 2 opens on (R140, Danny, 30 Sep 2026,
 * danny.md lines 128-133): one call over the text of the placed pieces. Every
 * field it returns is editable before anything is run, and nothing here runs
 * against an engine. The prompts follow generateQuestions' rules - a
 * recommendation each, one per kind, broad, no brand, the current year only -
 * and freshenYears is applied here for the reason it is there.
 */
export async function readCoverage(input: { text: string; market: Market }, billed: { calls: number } = { calls: 0 }): Promise<CoverageDraftRead> {
  const marketName = input.market === "UK" ? "the United Kingdom" : "the United States";
  const year = currentYear();
  const res = await withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: EFFORT, format: zodOutputFormat(CoverageDraft) },
    system: [
      "You read press coverage a PR team placed for a client and draft the check",
      "that asks AI engines whether the coverage got the client recommended.",
      "",
      "brand: the company the pieces are about, as they write its name.",
      "claim: what the client should be named for - a capability or a claim a",
      "buyer would search for, two to six words. 'same-day settlement', not",
      "'Brand announces exciting news'. Never a headline.",
      "segment: who it is for, as a buyer would say it. Empty if not stated.",
      "",
      `Then write ${QUESTION_COUNT} prompts a buyer in ${marketName} would ask ChatGPT,`,
      "Gemini, Perplexity or Google when choosing a supplier for that claim.",
      "EVERY PROMPT ASKS FOR A RECOMMENDATION - 'best ...', 'who are the best",
      "...', 'top ... for ...', 'which ... should i use for ...'. Keep them broad:",
      "the claim narrowed by at most one thing. Exactly one of each kind:",
      "category, positioning, sector, outcome, comparison.",
      "Never a definition question ('what is', 'how does ... work').",
      `The current year is ${year}. Only add a year where a buyer would, and if`,
      `you do it must be ${year}.`,
      "Lower case, plain, no question marks, the spelling of the market.",
      "Do not name the brand in any prompt.",
    ].join("\n"),
    messages: [{ role: "user", content: `Market: ${marketName}\n\nThe coverage:\n\n${input.text}` }],
  }));

  const out = res.parsed_output;
  if (!out) throw new Error("could not read a draft from that coverage");
  const prompts = withoutBrand(
    out.prompts.slice(0, QUESTION_COUNT).map((p) => ({ question: freshenYears(p.prompt, year), kind: p.kind })),
    out.brand,
  ).map((p) => ({ prompt: p.question, kind: p.kind }));
  return { ...out, prompts };
}

// ---------------------------------------------------------- keyword candidates

/** How many candidates the model offers per question (R39: "3-5"). */
const CANDIDATES_MIN = 3;
const CANDIDATES_MAX = 5;

const KeywordCandidates = z.object({
  supplier_noun: z.string().describe("The one plural noun a buyer uses for suppliers in this category, e.g. 'providers', 'agencies', 'lenders'"),
  questions: z.array(
    z.object({
      idx: z.number().int(),
      candidates: z.array(z.string()).describe(`${CANDIDATES_MIN} to ${CANDIDATES_MAX} Google head keywords for this question, lower case`),
    }),
  ),
});

/**
 * Candidate Google head keywords for every question, in one call (R39, Danny,
 * 27 Sep 2026). The model proposes; `target-keyword.ts` decides which stand
 * and the volume read picks among them, so nothing here is trusted as the
 * keyword. Not called until the R41 columns are applied.
 *
 * One call for the whole set, the shape `generateQuestions` has, with a
 * ceiling that scales with the number of questions rather than a flat one -
 * the truncated-JSON defect AGENTS.md records.
 */
export async function keywordCandidates(
  input: { category: string; market: Market; questions: { idx: number; question: string }[] },
  billed: { calls: number } = { calls: 0 },
): Promise<{ supplierNoun: string; byIdx: Map<number, string[]> }> {
  const marketName = input.market === "UK" ? "the United Kingdom" : "the United States";
  const res = await withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    max_tokens: Math.min(8000, 400 + input.questions.length * 150),
    output_config: { effort: EFFORT, format: zodOutputFormat(KeywordCandidates) },
    system: [
      `Each question below is one a buyer in ${marketName} asks an AI engine when choosing a supplier.`,
      `For each, propose ${CANDIDATES_MIN} to ${CANDIDATES_MAX} Google head keywords: the short phrase the same buyer would type`,
      "into Google. Drop 'best', 'top', 'who offers', 'which', the year and the country word.",
      "Every keyword keeps a supplier noun - providers, companies, lenders, software, agencies.",
      "The bare category alone is never a keyword. Lower case, no punctuation.",
      "Also give the one plural supplier noun a buyer uses for this category.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `Category: ${input.category}`,
          ...input.questions.map((q) => `${q.idx}: ${q.question}`),
        ].join("\n"),
      },
    ],
  }));
  const out = res.parsed_output;
  if (!out) throw new Error("could not read keyword candidates");
  const asked = new Set(input.questions.map((q) => q.idx));
  const byIdx = new Map<number, string[]>();
  for (const q of out.questions) if (asked.has(q.idx)) byIdx.set(q.idx, q.candidates.slice(0, CANDIDATES_MAX));
  return { supplierNoun: out.supplier_noun.trim().toLowerCase(), byIdx };
}

// ------------------------------------------------- cluster keyword candidates

/** How many head keywords the model offers for the one cluster (BRIEF-3 C1: "5-8"). */
const CLUSTER_CANDIDATES_MIN = 5;
const CLUSTER_CANDIDATES_MAX = 8;

const ClusterKeywordCandidates = z.object({
  supplier_noun: z.string().describe("The one plural noun a buyer uses for suppliers in this category, e.g. 'providers', 'agencies', 'lenders'"),
  candidates: z.array(z.string()).describe(`${CLUSTER_CANDIDATES_MIN} to ${CLUSTER_CANDIDATES_MAX} Google head keywords, lower case, most likely first`),
});

/**
 * Candidate cluster keywords for a scan - C1 step 1 of
 * docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md (Danny, 29 Sep 2026;
 * this is the seventh model call's decision). The phrase a buyer types into
 * Google when choosing a supplier, from the site facts, topic and market.
 * Each is passed through `normaliseCandidate` (supplier noun kept, bare
 * category refused); `pickClusterKeyword` and the volume and intent reads
 * decide, so nothing here is trusted as the keyword. Order is the model's,
 * which the pick uses for ties.
 *
 * One call with a ceiling scaled to the count, the shape `keywordCandidates`
 * has. Not yet called: C1's route change wires it.
 */
export async function clusterKeywordCandidates(
  input: { topic: string; market: Market; positioning: string | null; services?: string[]; industries?: string[] },
  billed: { calls: number } = { calls: 0 },
): Promise<string[]> {
  const marketName = input.market === "UK" ? "the United Kingdom" : "the United States";
  const res = await withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    max_tokens: 400 + CLUSTER_CANDIDATES_MAX * 60,
    output_config: { effort: EFFORT, format: zodOutputFormat(ClusterKeywordCandidates) },
    system: [
      `Propose ${CLUSTER_CANDIDATES_MIN} to ${CLUSTER_CANDIDATES_MAX} Google head keywords a buyer in ${marketName} types when choosing a supplier in this category.`,
      "Commercial terms only: the buyer is comparing suppliers, not learning what the thing is.",
      "Drop 'best', 'top', 'who offers', 'which', the year and the country word.",
      "Every keyword keeps a supplier noun - providers, companies, lenders, software, agencies.",
      "The bare category alone is never a keyword. Never a brand name. Lower case, no punctuation.",
      "Most likely first. Also give the one plural supplier noun a buyer uses for this category.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `Category: ${input.topic}`,
          `Market: ${marketName}`,
          `How the brand positions itself: ${input.positioning ?? "not stated"}`,
          `Services it sells: ${(input.services ?? []).join("; ") || "not read"}`,
          `Industries it serves, strongest first: ${(input.industries ?? []).join("; ") || "not read"}`,
        ].join("\n"),
      },
    ],
  }));
  const out = res.parsed_output;
  if (!out) throw new Error("could not read cluster keyword candidates");
  const noun = out.supplier_noun.trim().toLowerCase();
  const standing = out.candidates.map((c) => normaliseCandidate(c, input.topic, noun)).filter((k): k is string => Boolean(k));
  return [...new Set(standing)].slice(0, CLUSTER_CANDIDATES_MAX);
}

// ----------------------------------------------------------- brand extraction

const BrandList = z.object({
  brands: z.array(
    z.object({
      brand: z.string(),
      mentions: z.number().int().min(1),
    }),
  ),
});

// Answers per request, and why a request is a batch of them rather than one
// joined string: prose-batches.ts PROSE_BATCH_CHARS, with the history.

/**
 * Pull the competitor set out of the Overview prose. Publications, directories
 * and generic nouns are excluded deliberately: the leaderboard is who the
 * engines recommend, which is a different list from who they cite.
 *
 * Takes the answers as separate blocks rather than one joined string so the
 * batching can fall between two answers instead of through the middle of one.
 * Duplicate names across batches are not merged here - the caller already
 * merges on brandKey, which folds case and punctuation, and two normalisers
 * that disagree is how a leaderboard grows a second row for one company.
 *
 * `failedBlocks` (8 Oct 2026, audit reliability-1 / data-6): the indices into
 * `blocks` whose batch failed, so a caller can retry those answers and mark
 * the ones still unread rather than store them as naming no one - the daily
 * tracking runner read only `brands` and `calls`, so a 529 on one engine's
 * batch shortened every rival's count and raised the client's share of voice
 * on a run marked complete. `error` is the first failure's reason, for the
 * caller's error line.
 *
 * `options.signal` aborts a request in flight and stops the next one from
 * going out, and an aborted batch fails like any other. It does NOT cut short
 * a wait between the SDK's own retries: `retryRequest` sleeps out a
 * `retry-after` with no signal (retry-policy.ts), and so does `withRetry`. So
 * the signal alone is no deadline; a caller that needs one stops waiting on
 * this call when the signal fires (decide.ts extractWithRetry does).
 * `options.billed` is the counter the requests are tallied on, live, so a
 * caller that stopped waiting still knows what went out; `calls` is what this
 * call added to it.
 */
export async function extractBrands(
  blocks: string[],
  context: { topic: string; brand: string } = { topic: "", brand: "" },
  options: { signal?: AbortSignal; billed?: { calls: number } } = {},
): Promise<{ brands: { brand: string; mentions: number }[]; calls: number; failedBatches: number; failedBlocks: number[]; error?: string }> {
  // The batching and which answers a failed batch leaves unread are
  // prose-batches.ts, where node --test runs them (8 Oct 2026, review).
  const batches = batchBlocks(blocks);
  if (!batches.length) return { brands: [], calls: 0, failedBatches: 0, failedBlocks: [] };

  // Attempts, not batches. A batch that 529s twice and lands on the third is
  // three requests on the bill and was one on this counter.
  const billed = options.billed ?? { calls: 0 };
  const before = billed.calls;
  // Counted and returned so the caller can say a leaderboard is partial
  // rather than assume it.
  const { items: brands, failedBatches, failedBlocks, error } = await runBatches(
    batches,
    (texts) => extractBrandBatch(texts, context, billed, options.signal),
    (err) => (options.signal?.aborted ? "out of time" : describeAnthropicError(err).slice(0, 80)),
  );
  return { brands, calls: billed.calls - before, failedBatches, failedBlocks, ...(error ? { error } : {}) };
}

async function extractBrandBatch(
  batch: string[],
  context: { topic: string; brand: string },
  billed: { calls: number },
  signal?: AbortSignal,
): Promise<{ brand: string; mentions: number }[]> {
  const res = await withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    /**
     * The same 8,000 as before, and it means something different now.
     *
     * The two calls below scale their ceiling with the batch because their
     * output is one row per input row, so the arithmetic is exact. Here the
     * output is however many companies happen to be named, which no input
     * measurement predicts - so the ceiling stays at the maximum for the task
     * and the INPUT is what got bounded. A fixed ceiling over a bounded batch
     * is a ceiling that no longer scales with the scan, which was the defect.
     */
    max_tokens: 8000,
    output_config: { effort: EFFORT, format: zodOutputFormat(BrandList) },
    system: [
      "You are given what an AI search engine answered to several buyers'",
      `questions about ${context.topic || "a product category"}.`,
      "List every company or brand named as a supplier, with how many times it",
      "appears.",
      "",
      "Exclude: publications, newspapers, magazines, blogs, directories, review",
      "sites, industry bodies, and generic nouns. Those are sources, not suppliers.",
      "Exclude Google, ChatGPT and other engines.",
      "",
      "Normalise each name to how the company writes it: one spelling per company,",
      "no Ltd, Limited, Inc or trailing punctuation. Merge obvious variants.",
      "Return an empty list if no companies are named.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [context.brand ? `Subject brand: ${context.brand}` : "", batch.join("\n\n---\n\n")]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  }, { signal }));

  return res.parsed_output?.brands ?? [];
}

// -------------------------------------------------------- brand judgement

const BrandJudgement = z.object({
  brands: z.array(
    z.object({
      name: z.string(),
      supplier: z
        .boolean()
        .describe(
          "True only when a buyer in this category could choose this company INSTEAD OF the subject brand.",
        ),
      note: z.string().describe("At most twelve words. Why it is, or is not, an alternative supplier."),
    }),
  ),
});

/**
 * Names per request. These are short strings with no page context, so the
 * batch can be larger than the source one and still sit well inside the
 * ceiling. The discipline is the same: the ceiling scales with the batch,
 * never with the scan.
 */
const BRAND_BATCH = 50;

/**
 * Decides which extracted names are actually alternative suppliers.
 *
 * extractBrands is deliberately broad - it reads prose and pulls out the
 * companies named in it. That is the right job for a reader, and the wrong
 * list for a leaderboard: on an analytics consultant's scan it returned
 * Shopify, Meta, Upwork, WordPress, LinkedIn, Screaming Frog and Tealium,
 * and the report then read "13th of 124 brands" - a count of proper nouns.
 *
 * This pass runs once over the deduplicated names for the whole scan rather
 * than per engine, so a name cannot be a competitor on ChatGPT and not on
 * Gemini, and so the same name is never paid for twice.
 */
export async function classifyBrands(input: {
  topic: string;
  brand: string;
  positioning: string | null;
  names: string[];
}): Promise<{ brands: z.infer<typeof BrandJudgement>["brands"]; calls: number; failedBatches: number }> {
  if (!input.names.length) return { brands: [], calls: 0, failedBatches: 0 };

  const batches: string[][] = [];
  for (let i = 0; i < input.names.length; i += BRAND_BATCH) {
    batches.push(input.names.slice(i, i + BRAND_BATCH));
  }

  const brands: z.infer<typeof BrandJudgement>["brands"] = [];
  const billed = { calls: 0 };
  let failedBatches = 0;
  for (const batch of batches) {
    try {
      brands.push(...(await judgeBrandBatch(input, batch, billed)));
    } catch (err) {
      // One bad batch must not cost the others their judgement. Counted and
      // returned, not just logged: the caller decides what an unjudged name
      // means, and a silent swallow here is how a half-built leaderboard
      // shipped last time.
      failedBatches += 1;
      console.warn("[scan] a brand batch failed to classify:", err instanceof Error ? err.message : err);
    }
  }
  return { brands, calls: billed.calls, failedBatches };
}

async function judgeBrandBatch(
  input: { topic: string; brand: string; positioning: string | null },
  names: string[],
  billed: { calls: number },
): Promise<z.infer<typeof BrandJudgement>["brands"]> {
  const res = await withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    // Headroom per row, so the ceiling is a function of the batch.
    max_tokens: Math.min(8000, 600 + names.length * 60),
    output_config: { effort: EFFORT, format: zodOutputFormat(BrandJudgement) },
    system: [
      "You are given company and brand names that AI search engines mentioned",
      `while answering buyers' questions about ${input.topic || "a product category"}.`,
      "",
      "For each name decide one thing: is it a plausible ALTERNATIVE SUPPLIER -",
      "a company a buyer could choose INSTEAD OF the subject brand, competing",
      "for the same budget?",
      "",
      "supplier true: it sells this category to these buyers. A rival much",
      "larger or much smaller than the subject still counts.",
      "",
      "supplier false: everything else, however often it is named. In particular",
      "these, which are the usual mistakes:",
      "- platforms and tools the work is done ON or WITH: a CMS, a store",
      "  builder, an ad platform, an analytics product, a crawler, a tag",
      "  manager. A consultant who reports on a platform does not compete",
      "  with it.",
      "- marketplaces, freelancer sites and job boards",
      "- social networks, search engines and the AI engines themselves",
      "- the buyer's own clients, customers or employers",
      "- publications, directories, review sites and industry bodies",
      "- generic nouns, product categories and job titles that are not companies",
      "",
      "The test is substitution, not adjacency. Being named in the same answer",
      "is not evidence. Being unsure is not a reason to say true.",
      "",
      "The note is one short line for a business reader: twelve words at most,",
      "no marketing language. Examples: 'Sells the same service to the same",
      "buyers', 'Ecommerce platform, not a consultancy', 'Freelancer",
      "marketplace, not a supplier in this category'.",
      "",
      "Return every name you were given, spelled exactly as given, once each.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `Subject brand: ${input.brand}`,
          input.positioning ? `What the subject sells: ${input.positioning}` : "",
          "",
          "Names:",
          ...names.map((n) => `- ${n}`),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  }));

  return res.parsed_output?.brands ?? [];
}

// ------------------------------------------------------------ source kinds

const SourceJudgement = z.object({
  sources: z.array(
    z.object({
      domain: z.string(),
      kind: z.enum(["competitor", "placement", "other"]),
      on_topic: z
        .boolean()
        .describe(
          "True when the cited pages are about this category. False when the site was cited for something unrelated.",
        ),
      note: z.string().describe("At most twelve words. Plain English for a business reader."),
    }),
  ),
});

/**
 * Sorts cited domains into competitors, places an article could be placed,
 * and everything else. The subject's own domain and the review sites never
 * reach here: sources.ts settles those without a call.
 */
/**
 * Domains per request.
 *
 * This used to be one call for every source on the scan, which held until a
 * scan arrived with 223 of them: roughly 8,900 tokens of output against a
 * 6,000 ceiling. The response truncated mid-JSON, the schema parse threw, and
 * because classification is deliberately never fatal the scan completed with
 * no source kinds at all - a silently half-built report rather than an error.
 *
 * Batching makes the ceiling a function of the batch rather than the scan, so
 * a 400-source scan costs more calls instead of losing its classification.
 */
const CLASSIFY_BATCH = 50;

export async function classifySourceDomains(input: {
  topic: string;
  brand: string;
  competitors: string[];
  /** One entry per domain, carrying the pages the engines actually cited. */
  domains: { domain: string; pages: { url: string | null; title: string | null }[] }[];
}, billed: { calls: number } = { calls: 0 }): Promise<{ sources: z.infer<typeof SourceJudgement>["sources"]; calls: number; unassessed: string[] }> {
  if (!input.domains.length) return { sources: [], calls: 0, unassessed: [] };

  const batches: (typeof input.domains)[] = [];
  for (let i = 0; i < input.domains.length; i += CLASSIFY_BATCH) {
    batches.push(input.domains.slice(i, i + CLASSIFY_BATCH));
  }

  /**
   * Domains whose batch failed outright, returned by name rather than counted.
   * The two facts sources.ts has to tell apart are: the model read this domain
   * and could not place it, and we never got an answer about this domain at
   * all. Only the first of those belongs in the database as a verdict.
   */
  const unassessed: string[] = [];

  const sources: z.infer<typeof SourceJudgement>["sources"] = [];
  // Billed onto the caller's accumulator as the requests go out, the way
  // generateQuestions is. classifySources can still throw after this returns -
  // storing the rows is the last thing it does - and a count that only exists
  // in the return value dies with the exception, leaving the calls paid for
  // and recorded nowhere.
  for (const batch of batches) {
    try {
      sources.push(...(await classifyBatch(input, batch, billed)));
    } catch (err) {
      // One bad batch must not cost the others their classification, and its
      // domains must not fall through to a default verdict downstream. Not "the
      // other four": the batch count is `domains.length / CLASSIFY_BATCH` and
      // the header above sizes a 400-source scan at eight.
      unassessed.push(...batch.map((d) => d.domain));
      console.warn("[scan] a source batch failed to classify:", err instanceof Error ? err.message : err);
    }
  }
  return { sources, calls: billed.calls, unassessed };
}

async function classifyBatch(
  input: { topic: string; brand: string; competitors: string[] },
  domains: { domain: string; pages: { url: string | null; title: string | null }[] }[],
  billed: { calls: number },
): Promise<z.infer<typeof SourceJudgement>["sources"]> {
  const res = await withRetry(() => anthropic(billed).messages.parse({
    model: MODEL,
    // Headroom per row, so the ceiling scales with the batch rather than
    // being a number somebody picked once.
    max_tokens: Math.min(8000, 600 + domains.length * 90),
    output_config: { effort: EFFORT, format: zodOutputFormat(SourceJudgement) },
    system: sourceKindSystem(input.topic),
    messages: [{ role: "user", content: sourceKindRequest(input, domains) }],
  }));

  return res.parsed_output?.sources ?? [];
}

/**
 * The services and industries stored on `scans.site_facts`, read defensively.
 * The column is jsonb and null on every row written before it existed, so
 * anything that is not a list of strings reads as nothing.
 */
export function siteFacts(raw: unknown): { services: string[]; industries: string[] } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 5) : [];
  return { services: list(o.services), industries: list(o.industries) };
}

// ------------------------------------------------------------- DIY calls

/**
 * The DIY platform's two model calls (13 Oct 2026, DIY P1; spec 10 section
 * 5.3, Danny's 12 Oct brief). Written here so the one-file, `parse`-only,
 * `anthropic(billed)` rules in `retry-policy.test.mts` hold them like the
 * other eight. They are reached only through `src/lib/diy/core/model.ts`,
 * which reserves each on the DIY ledger's model door (the scan keeps half of
 * `anthropic_calls_per_day`), settles it from `usage`, and debits
 * `model_call_debits` with `billed.calls`. P7 and P8 hand in the prompt and
 * the zod schema; nothing here writes either.
 *
 * Both: `DIY_MODEL`; structured output through `parse`; no `thinking`
 * parameter (Opus 5.5's thinking is adaptive and cannot be switched off;
 * depth is `output_config.effort`, always set); `max_tokens` 16000, which
 * bounds thinking and output together and bills only what is used. The
 * refusal fallback is on (`server-side-fallback-2026-07-01`, `fallbacks:
 * "default"`), which the installed SDK (0.125.0) takes on
 * `beta.messages.parse`. A `refusal` or `max_tokens` stop is read as a
 * failure by model.ts before anything is taken from the body; a truncated
 * body fails the SDK's own parse first, and model.ts keeps the reservation's
 * ceiling as that call's cost.
 */
export type DiyModelInput<T> = { system: string; user: string; schema: z.ZodType<T> };

/** Page and domain types for up to 50 items a call (P7's classify job). Low effort; the system prompt is cached. */
export async function classifyPages<T>(input: DiyModelInput<T>, billed: { calls: number }) {
  return withRetry(() => anthropic(billed).beta.messages.parse({
    model: DIY_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(input.schema) },
    system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: input.user }],
  }));
}

/** One drafted re-optimisation example from the client's own page (P8, on demand). Medium effort. */
export async function writeReoptExample<T>(input: DiyModelInput<T>, billed: { calls: number }) {
  return withRetry(() => anthropic(billed).beta.messages.parse({
    model: DIY_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(input.schema) },
    system: input.system,
    messages: [{ role: "user", content: input.user }],
  }));
}
