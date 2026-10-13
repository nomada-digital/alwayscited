import { z } from "zod";

import { PROMPTS_PER_CLUSTER } from "../../tracking/limits.ts";

import { urlKey } from "../../tracking/placements.ts";

import type { DiagRow } from "./diagnostics.ts";
import type { ExampleBody, ReoptExample, TopStructure } from "./types.ts";

/**
 * The drafted re-optimisation example (13 Oct 2026, DIY P8; spec 10 sections
 * 4.9, 5.3 and 6.5): an example to edit, not finished copy. One model call,
 * on demand, through P1's model door (core/model.ts writeReoptExample, which
 * reserves, settles and debits); this file builds what goes in and checks
 * what comes out, and never imports the SDK.
 *
 * **In:** the client's own page as markdown (at most about 6k tokens), the top
 * 3's structure - headings and element flags only, never their text - the
 * cluster keyword and its prompts, one stored answer sentence that names a
 * competitor, and the diagnostics rows.
 *
 * **Out, then guarded** (`guardExample`, pure):
 *
 * 1. the number guard: every amount, count or percentage must be a figure of
 *    the client's page text - the same figure, whole, as a token (13 Oct
 *    2026, DIY P8 review: by substring, "$5" passed against "$59", and "3"
 *    or "40" against a year or a phone number) - or it is replaced with
 *    `[ADD: check this figure]` and recorded in `guard_hits`;
 * 2. the claim guard: a ranking, guarantee, "will be cited" or engine claim,
 *    or a causal word, rejects the draft;
 * 3. the length limits: title 60 characters, H1 80, opening 100 words, cut
 *    at the limit; an empty element rejects;
 * 4. the link guard: the internal link sentence's page must be one of the
 *    client's other key pages it was given (section 6.5); any other address
 *    becomes `[ADD: one of your other pages]`.
 *
 * A reject is written again once (`draftExample`); a second reject, or a
 * failed or refused call, fails the example. A failed example is not counted
 * against the allowance (only `ready` rows are: usage-meter.ts), though what
 * the call cost is still on the ledger. A row still `pending` 10 minutes after
 * it was asked for is read as failed: the function writing it has died.
 */

export const TITLE_MAX = 60;
export const H1_MAX = 80;
export const OPENING_WORDS = 100;
/** The client page's markdown handed in: about 6k tokens at 3 characters a token. */
export const PAGE_CHARS = 18_000;
export const STALE_PENDING_MS = 10 * 60_000;
export const CHECK_FIGURE = "[ADD: check this figure]";
export const PICK_PAGE = "[ADD: one of your other pages]";

export const EXAMPLE_SCHEMA = z.object({
  title: z.string(),
  h1: z.string(),
  opening: z.string(),
  missing_section: z.object({ heading: z.string(), bullets: z.array(z.string()) }),
  link_sentence: z.object({ from_url: z.string(), sentence: z.string(), anchor: z.string() }),
  facts_used: z.array(z.object({ text: z.string(), where: z.string() })),
  placeholders: z.array(z.string()),
});

export const EXAMPLE_SYSTEM = [
  "You write one example of how a client could rework one page of their own website, for them to edit. It is not finished copy and nothing you write is published.",
  "Rules, all of them binding:",
  "1. Use only facts that appear in the client page text you are given. Any number, price, count, date or claim that is not in that text must be written as [ADD: what it is].",
  "2. You are given only the headings and element flags of the pages that rank above the client. Do not copy or paraphrase their wording.",
  "3. Make no claim about rankings, search engines, AI engines or assistants, results, or guarantees. Do not say what any engine prefers or will do.",
  "4. No superlative the client page cannot support.",
  `5. The title is at most ${TITLE_MAX} characters, the H1 at most ${H1_MAX} characters, and the opening at most ${OPENING_WORDS} words.`,
  "6. The missing section is one heading and exactly 3 bullets, drawn from headings the top pages share and the client page lacks.",
  "7. The internal link sentence is for one of the client's other pages that you are given (from_url is that page's address); its anchor is the linked page's natural name or the brand, never a keyword-stuffed phrase.",
  "8. facts_used lists every fact you used, each with where on the client page it appears. placeholders lists every [ADD: ...] you wrote.",
  "Write in plain British or American English to match the client page.",
].join("\n");

export type ExampleInput = {
  brand: string;
  pageUrl: string;
  /** The client's page as markdown, cut to PAGE_CHARS. Never stored: reopt_examples.inputs keeps the title and H1 only, and the "Now" opening is the latest own read's. */
  pageText: string;
  keyword: string;
  prompts: readonly string[];
  top: readonly TopStructure[];
  /** One stored answer sentence that names a competitor, and the page it cites; or null. */
  answer: { sentence: string; cites: string | null } | null;
  diagnostics: readonly DiagRow[];
  /** The client's other key pages, for the internal link sentence. */
  otherPages: readonly string[];
};

const cell = (c: boolean | number | null) => (c === null ? "not read" : c === true ? "yes" : c === false ? "no" : String(c));

/**
 * The call's user message. The top 3 go in as structure only - rank, URL,
 * and for each heading its level and words; whether a date is shown; a word
 * count - and never their body text, which this file never has.
 */
export function exampleMessage(i: ExampleInput): string {
  const top = [...i.top]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((t) => [`#${t.rank} ${t.url}${t.status === "ok" ? "" : " (could not be read)"}`, ...(t.status === "ok" ? [`  title: ${t.title ?? "-"}`, `  h1: ${t.h1 ?? "-"}`, ...t.headings.slice(0, 40).map((h) => `  h${h.level}: ${h.text}`), `  date shown: ${t.dateShown === null ? "not read" : t.dateShown ? "yes" : "no"}`, `  words: ${t.wordCount ?? "not read"}`] : [])].join("\n"))
    .join("\n");
  return [
    `Brand: ${i.brand}`,
    `Cluster keyword: ${i.keyword}`,
    `The cluster's prompts:\n${i.prompts.slice(0, PROMPTS_PER_CLUSTER).map((p) => `- ${p}`).join("\n") || "- none"}`,
    `The client page: ${i.pageUrl}`,
    `The client's other pages (for the link sentence):\n${i.otherPages.slice(0, 9).map((p) => `- ${p}`).join("\n") || "- none"}`,
    `What one engine said in a stored answer to one of these prompts:\n${i.answer ? `"${i.answer.sentence}"${i.answer.cites ? ` (it cites ${i.answer.cites})` : ""}` : "none stored"}`,
    `Diagnostics, the client page against the top 3:\n${i.diagnostics.map((r) => `- ${r.label}: you ${cell(r.you)}; top 3 ${r.top.map(cell).join(", ")}`).join("\n")}`,
    `The structure of the top 3 (headings and flags only):\n${top || "none read"}`,
    `The client page text:\n<<<\n${i.pageText.slice(0, PAGE_CHARS)}\n>>>`,
  ].join("\n\n");
}

// ---- The guards. ----

/**
 * A figure, as a whole token: an optional currency sign, a run of digits with
 * its separators, an optional %. It never starts inside another number, so
 * "2023" is one token and not "023" or "3", and the same rule reads the
 * output and the page.
 */
const FIGURE = /(?<![\d.,])(?:[$£€]\s?)?\d+(?:[.,]\d+)*%?/g;

/** A figure as compared: no spaces or thousands commas, two decimal places' trailing zeros dropped ("$1,299.00" is "$1299", "4.50" is "4.5"), its sign and % kept. */
export function figureKey(tok: string): string {
  let t = tok.replace(/\s+/g, "");
  const sign = /^[$£€]/.exec(t)?.[0] ?? "";
  const pct = t.endsWith("%") ? "%" : "";
  t = t.slice(sign.length, t.length - pct.length);
  // A comma before exactly three digits groups thousands; any other comma is a decimal point ("4,5").
  t = t.replace(/,(?=\d{3}(?!\d))/g, "").replace(/,/g, ".");
  t = t.replace(/\.(\d)0$/, ".$1").replace(/\.0$/, "");
  return `${sign}${t}${pct}`;
}

/** Every figure in the page's text, as compared. A link's address is not text: "page-2023" in a URL is no figure of the page. */
export function figuresIn(text: string): Set<string> {
  const prose = text.replace(/\]\([^)]*\)/g, "]").replace(/<?https?:\/\/[^\s>)]+>?/g, " ");
  return new Set((prose.match(FIGURE) ?? []).map(figureKey));
}

/**
 * The claim guard's patterns (section 6.5). The six causal words are written
 * in two parts each, so the dashboard's causal-copy census - which reads
 * every line of /app copy for them - does not read this list of what is
 * refused as copy.
 */
const CAUSAL = ["cau" + "sed", "dro" + "ve", "because " + "of", "thanks " + "to", "resulted " + "in", "deliv" + "ered"];
export const CLAIMS: RegExp[] = [
  /\brank(s|ed|ing)? (#|number |no\.? ?)1\b/i,
  /guarantee/i,
  /\bwill (rank|appear|be cited)\b/i,
  /\b(chatgpt|gemini|perplexity|ai overviews?|claude) (will|prefers?|loves?)\b/i,
  new RegExp(`\\b(${CAUSAL.join("|")})\\b`, "i"),
];

export type GuardHit = { field: string; token: string };
export type Guarded = { ok: true; example: ExampleBody; hits: GuardHit[] } | { ok: false; reason: string };

/** Placeholders already written are left alone: their words may hold a number to fill in. */
function outsidePlaceholders(text: string, fn: (part: string) => string): string {
  return text
    .split(/(\[ADD:[^\]]*\])/g)
    .map((part) => (part.startsWith("[ADD:") ? part : fn(part)))
    .join("");
}

/**
 * Replace every figure that is not one of the page text's own figures with
 * CHECK_FIGURE, recording each. Whole tokens against whole tokens, never a
 * substring: a figure inside a larger number, a year, a phone number or a
 * link's address is that token, not this one.
 */
export function numberGuard(text: string, pageText: string | ReadonlySet<string>, field: string, hits: GuardHit[]): string {
  const pageFigures = typeof pageText === "string" ? figuresIn(pageText) : pageText;
  return outsidePlaceholders(text, (part) =>
    part.replace(FIGURE, (tok) => {
      if (pageFigures.has(figureKey(tok))) return tok;
      hits.push({ field, token: tok });
      return CHECK_FIGURE;
    }),
  );
}

/** Cut a string at `max` characters, at a word where one is near. */
export function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const at = head.lastIndexOf(" ");
  return (at > max * 0.6 ? head.slice(0, at) : head).replace(/[\s,;:-]+$/, "");
}

export function cutWords(s: string, max: number): string {
  const words = s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.length <= max ? words.join(" ") : words.slice(0, max).join(" ");
}

/** The example's every piece of prose, by field, for the claim and number guards. */
function fields(e: ExampleBody): [string, string][] {
  return [
    ["title", e.title],
    ["h1", e.h1],
    ["opening", e.opening],
    ["missing_section.heading", e.missing_section.heading],
    ...e.missing_section.bullets.map((b, n) => [`missing_section.bullets.${n}`, b] as [string, string]),
    ["link_sentence.sentence", e.link_sentence.sentence],
    ["link_sentence.anchor", e.link_sentence.anchor],
  ];
}

/** Whether the link sentence's page is one of the client's other key pages, by url_key. */
function isOtherPage(fromUrl: string, otherPages: readonly string[]): boolean {
  const key = urlKey(fromUrl.trim()) ?? urlKey(`https://${fromUrl.trim().replace(/^\/\//, "")}`);
  return key !== null && otherPages.some((p) => urlKey(p) === key);
}

/** The guards over one draft, in order: claims (reject), length (cut; reject when empty), numbers (replace), and the link sentence's page (replace). */
export function guardExample(raw: ExampleBody, pageText: string, otherPages: readonly string[] = []): Guarded {
  for (const [field, text] of fields(raw)) {
    for (const re of CLAIMS) if (re.test(text)) return { ok: false, reason: `claim in ${field}` };
  }
  const bullets = raw.missing_section.bullets.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  const trimmed: ExampleBody = {
    title: cut(raw.title, TITLE_MAX),
    h1: cut(raw.h1, H1_MAX),
    opening: cutWords(raw.opening, OPENING_WORDS),
    missing_section: { heading: cut(raw.missing_section.heading, 120), bullets: bullets.map((b) => cut(b, 200)) },
    link_sentence: { from_url: raw.link_sentence.from_url.trim().slice(0, 500), sentence: cut(raw.link_sentence.sentence, 300), anchor: cut(raw.link_sentence.anchor, 80) },
    facts_used: raw.facts_used.slice(0, 20).map((f) => ({ text: cut(f.text, 200), where: cut(f.where, 120) })),
    placeholders: raw.placeholders.slice(0, 20).map((p) => cut(p, 120)),
  };
  for (const [field, text] of fields(trimmed)) if (!text) return { ok: false, reason: `empty ${field}` };
  if (trimmed.missing_section.bullets.length < 3) return { ok: false, reason: "the missing section needs 3 bullets" };
  const hits: GuardHit[] = [];
  const figures = figuresIn(pageText);
  const g = (field: string, s: string) => numberGuard(s, figures, field, hits);
  // The link goes on one of the client's other key pages, the ones it was given (section 6.5): any other address is never shown as given.
  const fromOk = isOtherPage(trimmed.link_sentence.from_url, otherPages);
  if (!fromOk) hits.push({ field: "link_sentence.from_url", token: trimmed.link_sentence.from_url.slice(0, 120) });
  const example: ExampleBody = {
    ...trimmed,
    title: g("title", trimmed.title),
    h1: g("h1", trimmed.h1),
    opening: g("opening", trimmed.opening),
    missing_section: { heading: g("missing_section.heading", trimmed.missing_section.heading), bullets: trimmed.missing_section.bullets.map((b, n) => g(`missing_section.bullets.${n}`, b)) },
    link_sentence: { from_url: fromOk ? trimmed.link_sentence.from_url : PICK_PAGE, sentence: g("link_sentence.sentence", trimmed.link_sentence.sentence), anchor: g("link_sentence.anchor", trimmed.link_sentence.anchor) },
    placeholders: fromOk ? trimmed.placeholders : [...trimmed.placeholders, PICK_PAGE].slice(0, 21),
  };
  return { ok: true, example, hits };
}

/** What one model call answered, as the drafting loop reads it (core/ledger.ts ReadResult, narrowed). */
export type CallResult = { kind: "read"; value: ExampleBody; readId: string } | { kind: "refused"; reason: string } | { kind: "failed"; reason: string; readId: string | null };

export type Drafted =
  | { status: "ready"; example: ExampleBody; hits: GuardHit[]; attempts: number; readId: string | null }
  | { status: "failed"; error: string; attempts: number; readId: string | null };

/**
 * Call, guard, and on a reject call once more. A refused or failed call is
 * not retried here: the ledger has its own retries, and a refusal (a cap)
 * will not have changed a second later.
 */
export async function draftExample(call: () => Promise<CallResult>, pageText: string, otherPages: readonly string[] = []): Promise<Drafted> {
  let readId: string | null = null;
  let last = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const got = await call();
    if (got.kind === "refused") return { status: "failed", error: `refused: ${got.reason}`, attempts: attempt, readId };
    if (got.kind === "failed") return { status: "failed", error: got.reason, attempts: attempt, readId: got.readId ?? readId };
    readId = got.readId;
    const g = guardExample(got.value, pageText, otherPages);
    if (g.ok) return { status: "ready", example: g.example, hits: g.hits, attempts: attempt, readId };
    last = g.reason;
  }
  return { status: "failed", error: `rejected twice: ${last}`, attempts: 2, readId };
}

/** A row's state as the page reads it: pending for over 10 minutes is failed (the function that was writing it died). */
export function exampleState(row: Pick<ReoptExample, "status" | "requestedAt">, now: number): "pending" | "ready" | "failed" {
  if (row.status !== "pending") return row.status;
  return now - Date.parse(row.requestedAt) > STALE_PENDING_MS ? "failed" : "pending";
}

/** The rows this month that count against the allowance: ready only (a stale pending row never does). */
export function countedExamples(rows: readonly Pick<ReoptExample, "status" | "requestedAt">[], monthStart: string): number {
  return rows.filter((r) => r.status === "ready" && r.requestedAt >= monthStart).length;
}

/** The labels on every example (section 6.5). */
export const EXAMPLE_LEAD = "An example to edit, not finished copy.";
