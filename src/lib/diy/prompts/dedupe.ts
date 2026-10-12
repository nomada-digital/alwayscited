/**
 * Is a new prompt already measured (13 Oct 2026, DIY P2; spec 10 section 6.7,
 * Nomada's opportunities.py 566-574). Pure.
 *
 * Core words are the lowercase words of a prompt minus the stop list below
 * (the spec's, with the years 2024-2029, plus "vs" and "versus": a
 * comparison's connective, as "and" is a list's) and minus one-letter tokens, which are
 * what an apostrophe leaves ("what's" is "what" and "s"). A plural "s" is taken
 * off a word of four or more letters, so "apps" and "app" are one word; a word
 * ending "ss" keeps it. The spec's rule is on words, and "best accounting apps
 * for freelancers" is the prompt "What's the best accounting app for
 * freelancers?" already, which the bare words would miss.
 *
 * The new prompt duplicates a live one when 75% or more of its core words occur
 * in that one. A duplicate adds nothing: a pursued opportunity links the
 * existing prompt (`opportunities.prompt_id`), and a placement reports it to
 * the admin.
 */

export const DUPLICATE_SHARE = 0.75;

const STOP = new Set(["the", "a", "an", "best", "top", "in", "for", "of", "and", "to", "what", "which", "who", "is", "are", "uk", "us", "usa", "2024", "2025", "2026", "2027", "2028", "2029", "vs", "versus"]);

const stem = (w: string): string => (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** A prompt's core words, once each. */
export function coreWords(text: string): string[] {
  const words = (text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(words.map(stem))];
}

/** The share of `text`'s core words found in `other`'s; 0 when `text` has none. */
export function coreShare(text: string, other: string): number {
  const mine = coreWords(text);
  if (!mine.length) return 0;
  const theirs = new Set(coreWords(other));
  return mine.filter((w) => theirs.has(w)).length / mine.length;
}

/** The first live prompt `text` duplicates, or null. Generic over the row, so a caller gets its own row back (an id to link). */
export function duplicateOf<T extends { text: string }>(text: string, live: readonly T[]): T | null {
  return live.find((p) => coreShare(text, p.text) >= DUPLICATE_SHARE) ?? null;
}

/** Whether `text` duplicates any of the cluster's live prompts. */
export function isDuplicatePrompt(text: string, live: readonly (string | { text: string })[]): boolean {
  return duplicateOf(text, live.map((p) => (typeof p === "string" ? { text: p } : p))) !== null;
}
