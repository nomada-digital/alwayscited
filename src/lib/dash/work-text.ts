/**
 * Work completed (sg-35, 2 Nov 2026): the census every work_items title and note passes before a customer sees it.
 *
 * Rows are written only by the Nomada hub, and some begin life as GitHub commits that the hub tidies into one line of
 * plain English. This is the second line of defence: anything that still reads like code or our internals - a file
 * path, a commit sha, an identifier, a URL, a word like "supabase" or "migration" - never reaches the page. A title
 * that fails becomes "Technical improvements"; a note that fails is dropped.
 *
 * Two plain SEO phrases are let through before the word check (2 Nov 2026), because they are deliverables a customer
 * pays for and the bare words are on the list: "internal link(s/ing)" and "branch page(s)/location(s)". Nothing else
 * is carved out.
 *
 * Pure, no imports, so `node --test` loads it directly.
 */

export const TECHNICAL_TITLE = "Technical improvements";

export const WORK_KINDS = ["schema", "on_page", "content", "technical", "placement", "pr", "report", "other"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

const KIND_LABEL: Record<WorkKind, string> = {
  schema: "Schema markup",
  on_page: "On-page",
  content: "Content",
  technical: "Technical",
  placement: "Placement",
  pr: "Digital PR",
  report: "Report",
  other: "Other",
};

/** The kind in plain words; an unknown kind reads as "Other", never as its raw value. */
export function workKindLabel(kind: string | null | undefined): string {
  return (WORK_KINDS as readonly string[]).includes(kind ?? "") ? KIND_LABEL[kind as WorkKind] : KIND_LABEL.other;
}

const CODE_EXT = "ts|tsx|js|jsx|mjs|cjs|mts|py|sql|json|css|scss|md|mdx|ya?ml|sh|env|toml|lock";

/** Each rule, named so a failing test says which one fired. */
export const INTERNAL_RULES: readonly (readonly [string, RegExp])[] = [
  ["backtick", /`/],
  ["brace", /[{}]/],
  ["arrow", /=>/],
  ["angle bracket", /[<>]/],
  ["semicolon", /;/],
  ["code file", new RegExp(`[\\w-]\\.(?:${CODE_EXT})\\b`, "i")],
  // a token with two or more slashes and a letter in it: src/lib/x, /api/dash/x - not 02/11/2026, not and/or
  ["file path", /(?:^|[\s("'])(?=[^\s/]*[A-Za-z]|\/[A-Za-z])[^\s/]*\/[^\s/]+\/\S*/],
  ["dotfile or home path", /(?:^|\s)(?:~\/|\.\.?\/|\.(?:env|git)\b)/i],
  ["url", /\b(?:https?|ftp|file):\/\/|\bwww\.[a-z0-9-]+\./i],
  // 7 to 40 hex characters with at least one digit and one letter: a commit sha, short or long
  ["hex string", /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i],
  ["snake_case", /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/],
  // two or more lower-case letters then a capital: getUser, useState - not iPhone, eBay, HubSpot, WordPress
  ["camelCase", /\b[a-z]{2,}[A-Z][A-Za-z0-9]*\b/],
  [
    "internal word",
    /\b(?:todo|fixme|wip|internal|secrets?|tokens?|passwords?|api[\s_-]?keys?|env|supabase|vercel|github|commits?|branch(?:es)?|migrations?)\b/i,
  ],
];

/** Plain SEO phrases that contain a listed word, taken out before the word check only. */
const PLAIN_PHRASES = /\binternal(?:ly)?[\s-]+link(?:s|ing|ed)?\b|\bbranch[\s-]+(?:pages?|locations?|offices?)\b/gi;

/** The rule a text breaks, or null when it reads as plain English. */
export function internalRule(text: string): string | null {
  for (const [name, re] of INTERNAL_RULES) {
    const subject = name === "internal word" ? text.replace(PLAIN_PHRASES, " ") : text;
    if (re.test(subject)) return name;
  }
  return null;
}

export function looksInternal(text: string): boolean {
  return internalRule(text) !== null;
}

const tidy = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** A work item's title as the customer sees it: its own words, or "Technical improvements" when they fail. */
export function plainTitle(title: string | null | undefined): string {
  const t = tidy(title);
  return t && !looksInternal(t) ? t : TECHNICAL_TITLE;
}

/** A work item's note as the customer sees it, or null: an empty note, or one that fails, is not shown. */
export function plainNote(note: string | null | undefined): string | null {
  const n = (note ?? "").trim();
  return n && !looksInternal(n) ? n : null;
}

/** A file's name as the link shows it, or null when the name itself fails (the link then reads "Open the file"). */
export function plainFileName(name: string | null | undefined): string | null {
  const n = tidy(name);
  return n && !looksInternal(n) ? n : null;
}
