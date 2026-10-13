import { withoutLinks } from "../../tracking/latest-answers.ts";

/**
 * "What the engines say" (13 Oct 2026, DIY P8; spec 10 sections 4.9 and
 * 6.5): one stored answer sentence to one of the cluster's prompts that names
 * a competitor, with the page the answer cites. Ours to show - it is an
 * answer to the client's own prompt, read by the daily check - and graded
 * "Seen in your data", with its link to the answer itself. Pure.
 */

export const SENTENCE_CHARS = 240;

export type AnswerRow = { engine: string; answered: boolean; text: string | null; brands: string[]; citations: { source_domain: string; url: string | null }[] };

export type EngineSentence = { engine: string; sentence: string; brand: string; cites: string | null };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first sentence in the engines' order that names a brand other than the client's, from an answer that cites a page. */
export function engineSentence(rows: readonly AnswerRow[], clientBrand: string, engines: readonly string[]): EngineSentence | null {
  const order = (e: string) => {
    const i = engines.indexOf(e);
    return i < 0 ? engines.length : i;
  };
  const you = clientBrand.trim().toLowerCase();
  for (const r of [...rows].sort((a, b) => order(a.engine) - order(b.engine))) {
    if (!r.answered || !r.text || !r.citations.length) continue;
    // Sentences and list lines apart, each without its list marker or markdown: a line is read as said.
    const sentences = withoutLinks(r.text)
      .split(/\n+/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/))
      .map((s) => s.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 25);
    for (const brand of r.brands) {
      if (!brand.trim() || brand.trim().toLowerCase() === you) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(brand.trim())}(?![\\p{L}\\p{N}])`, "iu");
      const sentence = sentences.find((s) => re.test(s));
      if (!sentence) continue;
      const cut = sentence.length > SENTENCE_CHARS ? `${sentence.slice(0, SENTENCE_CHARS - 1).replace(/\s+\S*$/, "")}…` : sentence;
      return { engine: r.engine, sentence: cut.trim(), brand: brand.trim(), cites: r.citations[0]?.url ?? r.citations[0]?.source_domain ?? null };
    }
  }
  return null;
}
