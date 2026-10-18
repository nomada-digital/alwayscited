/**
 * A cluster keyword's other form (18 Oct 2026 brief, 2c): "b2b seo agency" and
 * "b2b seo agencies" are one cluster, one target page, one allowance. Setup
 * offers the other form ticked; the customer can untick it or edit it.
 *
 * The head noun is the word that changes: the last word, or the last word
 * before a joining word ("agency for startups" -> "agencies for startups").
 * A head noun with no plural ("software", "insurance") offers nothing, and
 * the option is hidden. A keyword already plural offers its singular.
 *
 * Pure and dependency-free so `node --test` loads it as is.
 */

export type OtherForm = { keyword: string; form: "plural" | "singular" } | null;

const UNCOUNTABLE = new Set([
  "software", "insurance", "finance", "advice", "equipment", "research", "hardware", "marketing", "accounting",
  "consulting", "information", "data", "furniture", "luggage", "news", "feedback", "training",
  "legal", "payroll", "recruitment", "staffing", "management", "storage", "hosting", "seo", "ppc", "pr", "advertising",
  "bookkeeping", "logistics", "analytics", "fintech", "healthcare", "childcare", "aftercare", "security", "compliance",
]);

const IRREGULAR: Record<string, string> = { person: "people", child: "children", man: "men", woman: "women", foot: "feet", tooth: "teeth", mouse: "mice" };
const IRREGULAR_BACK = Object.fromEntries(Object.entries(IRREGULAR).map(([s, p]) => [p, s]));
const F_TO_VES: Record<string, string> = { knife: "knives", life: "lives", wife: "wives", shelf: "shelves", leaf: "leaves", half: "halves", wolf: "wolves", thief: "thieves" };
const VES_TO_F = Object.fromEntries(Object.entries(F_TO_VES).map(([s, p]) => [p, s]));
/** Words ending in s that are singular: "glass", "status", "analysis", "business". */
const SINGULAR_S = /(ss|us|is|ics|ous|ness|ess)$/;
const JOINERS = new Set(["for", "in", "near", "with", "to", "of", "on", "at", "from", "by", "vs", "versus", "and"]);

function headIndex(words: string[]): number {
  const j = words.findIndex((w, i) => i > 0 && JOINERS.has(w.toLowerCase()));
  return j > 0 ? j - 1 : words.length - 1;
}

function keepCase(model: string, word: string): string {
  return model === model.toUpperCase() && model !== model.toLowerCase() ? word.toUpperCase() : word;
}

/** The plural of one lower-case noun, or null when it has none. */
export function pluralWord(w: string): string | null {
  const s = w.toLowerCase();
  if (!/^[a-z][a-z'-]*$/.test(s) || UNCOUNTABLE.has(s)) return null;
  if (IRREGULAR[s]) return IRREGULAR[s];
  if (F_TO_VES[s]) return F_TO_VES[s];
  if (/[^aeiou]y$/.test(s)) return s.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/.test(s)) return s + "es";
  return s + "s";
}

/** The singular of one lower-case noun that reads as plural, or null when it does not. */
export function singularWord(w: string): string | null {
  const s = w.toLowerCase();
  if (!/^[a-z][a-z'-]*$/.test(s)) return null;
  if (IRREGULAR_BACK[s]) return IRREGULAR_BACK[s];
  if (VES_TO_F[s]) return VES_TO_F[s];
  if (UNCOUNTABLE.has(s) || SINGULAR_S.test(s) || !s.endsWith("s")) return null;
  if (/[^aeiou]ies$/.test(s)) return s.slice(0, -3) + "y";
  if (/(sses|xes|zes|ches|shes)$/.test(s)) return s.slice(0, -2);
  return s.slice(0, -1);
}

/** The other form of a keyword: its plural, or its singular when it is already plural. Null hides the option. */
export function otherForm(keyword: string): OtherForm {
  const words = keyword.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const i = headIndex(words);
  const head = words[i];
  const swap = (to: string) => [...words.slice(0, i), keepCase(head, to), ...words.slice(i + 1)].join(" ");
  const single = singularWord(head);
  if (single) return { keyword: swap(single), form: "singular" };
  const plural = pluralWord(head);
  return plural ? { keyword: swap(plural), form: "plural" } : null;
}
