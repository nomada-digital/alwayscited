import { PROMPT_MAX, PROMPT_MIN } from "../../tracking/prompt-text.ts";

/**
 * The title rule (13 Oct 2026, DIY P2; spec 10 section 6.7): one prompt from
 * an article's title, Nomada's "the title is the prompt" (build_dashboard.py
 * 1102-1109) revived. Pure. Used for a live placement (placement-prompt.ts)
 * and for a pursued opportunity (opportunity-rule.ts).
 *
 * 1. The article's <title>, else its first <h1> (`titleOf`).
 * 2. Cut at the first of " | ", " - ", an en or em dash between spaces, " · ",
 *    ": ". The first
 *    part is kept when it still has 3 words once cleaned; otherwise the
 *    longest other part that does, never one that reads as a question to the
 *    reader ("is it worth it"), since "best is it worth it" is no prompt.
 * 3. Drop years, bracketed text, a leading list count ("The 9", "9",
 *    "Top 10" to "top") and a leading "who/what/which are the" (or "is the").
 * 4. Lowercase and collapse spaces.
 * 5. "best ..." or "top ..." becomes "best ..."; a " vs " title is kept as it
 *    is, and so is a "how to ..." one, which is already a thing people ask
 *    (an addition to the spec's rule: "best how to choose" is no prompt);
 *    anything else gets "best " in front.
 * 6. The market qualifier, "in the UK" or "in the US", only when the title
 *    named the client's market. A market named in the words is taken out of
 *    them first, so it is said once, at the end.
 * 7. Valid at PROMPT_MIN to PROMPT_MAX characters (prompt-text.ts) and 3 or
 *    more words; otherwise no prompt, with the reason.
 *
 * "The 9 best invoicing apps for freelancers (2026) - SmallBizStack" is
 * "best invoicing apps for freelancers"; "Brightly vs Ledgerly: which is
 * better?" is "brightly vs ledgerly". Illustrative: Brightly, Ledgerly and
 * every brand in these examples are made up.
 */

export const TITLE_TOO_SHORT = "title too short to make a prompt";
export const TITLE_TOO_LONG = "title too long to make a prompt";
export const NO_TITLE = "no title on the page";

export type TitlePrompt = { ok: true; text: string } | { ok: false; reason: string };

// The en dash and the em dash are written as escapes: the copy census holds the tree to hyphens.
const SEPARATORS = / \| | - | \u2013 | \u2014 | · |: /;
const YEAR = /\b(19|20)\d\d\b/g;
const BRACKETS = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
const ASKS_READER = /^(is|are|does|do|can|should|will|would|why|when|where|could|which|what|who)\b/;

/** Words a prompt is counted in: runs of letters or digits. "&" and "-" are not words. */
export const wordCount = (s: string): number => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "\u2013", mdash: "\u2014", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", middot: "·" };

/** HTML text to plain text: tags out, the common entities decoded, spaces collapsed. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** The article's title: its <title>, else its first <h1>; null when it has neither, or they are empty. */
export function titleOf(html: string): string | null {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const t = title ? plainText(title) : "";
  if (t) return t;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const h = h1 ? plainText(h1) : "";
  return h || null;
}

type Market = "UK" | "US";

const MARKET_WORDS: Record<Market, RegExp[]> = {
  // "UK" in any case. A lowercase "us" is the pronoun ("contact us"), so for the US only the capitals count.
  UK: [/\b(?:in|for|across) the (?:uk|u\.k\.|united kingdom)(?!\w)/gi, /\b(?:uk|u\.k\.|united kingdom|great britain|britain|british)(?!\w)/gi],
  US: [/\b(?:in|for|across) the (?:US|USA|U\.S\.A?\.?)(?!\w)/g, /\b(?:in|for|across) the united states(?!\w)/gi, /\b(?:US|USA|U\.S\.A?\.?)(?!\w)/g, /\b(?:united states|america|american)(?!\w)/gi],
};

const marketOf = (m: string | null | undefined): Market | null => (m === "UK" || m === "US" ? m : null);

/** Whether the title names this market. */
export function namesMarket(title: string, market: Market): boolean {
  return MARKET_WORDS[market].some((r) => new RegExp(r.source, r.flags.replace("g", "")).test(title));
}

/** Every market named in the words taken out, both markets, so a UK title for a US client says neither. */
function dropMarkets(s: string): string {
  let out = s;
  for (const m of ["UK", "US"] as const) for (const r of MARKET_WORDS[m]) out = out.replace(r, " ");
  return out;
}

/** Steps 3 and 4 on one part of a title: years, brackets, the list count, the leading question words; lowercased, spaces collapsed. */
export function cleanPart(part: string): string {
  let s = dropMarkets(part).replace(BRACKETS, " ").replace(YEAR, " ");
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  // Trailing punctuation and a preposition a dropped year or market left behind ("apps for freelancers in").
  s = s.replace(/[\s?!.,;:]+$/, "").replace(/\s+(in|for|of)$/, "").trim();
  // The list count: "the 9 best", "9 best", "top 10 crm tools" to "top crm tools".
  s = s.replace(/^the\s+\d+\s+/, "").replace(/^top\s+\d+\s+/, "top ").replace(/^\d+\s+/, "").replace(/^the\s+(best|top)\s+/, "$1 ");
  s = s.replace(/^(who|what|which)\s+(are|is)\s+the\s+/, "").replace(/^what'?s\s+the\s+/, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Step 2: the part of the title the prompt is made from, already cleaned. */
export function titleCore(title: string): string {
  const parts = title.split(SEPARATORS).map(cleanPart);
  const head = parts[0] ?? "";
  if (wordCount(head) >= 3) return head;
  const others = parts.slice(1).filter((p) => wordCount(p) >= 3 && !ASKS_READER.test(p));
  return others.sort((a, b) => wordCount(b) - wordCount(a) || b.length - a.length)[0] ?? head;
}

/** The prompt a title makes, or why it makes none. `market` is the client's ("UK" or "US"). */
export function promptFromTitle(title: string | null | undefined, market: string | null | undefined): TitlePrompt {
  const raw = (title ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { ok: false, reason: NO_TITLE };
  let core = titleCore(raw);
  if (core.startsWith("top ")) core = `best ${core.slice(4)}`;
  else if (!core.startsWith("best ") && !/ vs\.? /.test(` ${core} `) && !core.startsWith("how to ")) core = `best ${core}`;
  core = core.replace(/^best best /, "best ").replace(/\s+/g, " ").trim();
  const m = marketOf(market);
  const text = m && namesMarket(raw, m) ? `${core} in the ${m}` : core;
  if (wordCount(text) < 3 || text.length < PROMPT_MIN) return { ok: false, reason: TITLE_TOO_SHORT };
  if (text.length > PROMPT_MAX) return { ok: false, reason: TITLE_TOO_LONG };
  return { ok: true, text };
}
