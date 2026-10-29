import { namesBrand } from "./brand-name.ts";

/**
 * How many answers name a competitor - what the "Who is being named instead"
 * board counts since 29 Oct 2026.
 *
 * It counted mentions: the extractor's tally of every time a name appeared,
 * summed. On the gracefoods.com scan Walkerswood read 3 and all three were one
 * Perplexity answer, while the subject beside it is counted in answers ("named
 * in 2 of 8"). Two units on one board, and the one the competitors were
 * counted in flatters them. Luke raised it before an agency call.
 *
 * So a row is the answers whose prose names the brand under any spelling the
 * extractor saw for it, by the same matcher that decides the subject's own
 * figure. Where the extractor found it and the matcher finds no answer - a
 * spelling the pattern cannot reach - it counts once, never zero, because the
 * extractor read it in this engine's answers; and never more than the answers
 * there are.
 */
export function answersNaming(prose: readonly string[], spellings: Iterable<string>, extracted: number): number {
  const names = [...spellings];
  const matched = prose.filter((p) => names.some((n) => namesBrand(p, n))).length;
  if (matched) return matched;
  return extracted > 0 && prose.length ? 1 : 0;
}
