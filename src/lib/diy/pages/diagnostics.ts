import type { Basics, TopStructure } from "./types.ts";

/**
 * Re-optimisation diagnostics (13 Oct 2026, DIY P8; spec 10 section 6.5): the
 * client's page against each of the top 3 for the cluster keyword, row by
 * row. Pure, free, and every row a fact we read ("Seen in your data"). No
 * content score is shown, and no row is weighted: each is a yes or no, or a
 * count, and the length row says something only when the client's page is
 * under 40% of the top 3's median.
 *
 * The top 3 are read as structure only (content_parsing: title, H1, the H2
 * and H3 headings, a date near "updated" or "published", a word count), so
 * two rows - a price in the text and a comparison table - are not read for
 * them and say so ("not read"), never "no".
 */

export const LENGTH_SHARE = 0.4;
export const HEADING_MATCH = 0.75;

export type Cell = boolean | number | null;

export type DiagRow = {
  key: "kw_title" | "kw_h1" | "price" | "table" | "date" | "headings" | "length" | "internal";
  label: string;
  you: Cell;
  top: Cell[];
  /** True when this row is worth a look: you lack what most of the read top 3 have. */
  flag: boolean;
};

const STOP = new Set(
  "a an the and or of for to in on at by with from is are be can do does how what which who why best top your you my our it its this that these those vs versus near me i we".split(" "),
);

/** Lower-case words, plural-insensitive (a trailing s off words over 3 letters). */
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Core words: tokens less the stop words. */
export const core = (s: string) => tokens(s).filter((w) => !STOP.has(w));

/** The exact keyword, or a close variant: every word of the keyword in the text, plural-insensitive. */
export function hasKeyword(text: string | null, keyword: string): boolean {
  if (!text) return false;
  if (text.toLowerCase().includes(keyword.toLowerCase())) return true;
  const have = new Set(tokens(text));
  const want = tokens(keyword);
  return want.length > 0 && want.every((w) => have.has(w));
}

/** Two texts share at least HEADING_MATCH of the smaller one's core words (at least 2 of them). */
export function coreMatch(a: string, b: string, share = HEADING_MATCH): boolean {
  const x = new Set(core(a));
  const y = new Set(core(b));
  const small = Math.min(x.size, y.size);
  if (small < 2) return false;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / small >= share;
}

/** Headings that share HEADING_MATCH of their core words with any of the cluster's prompts. */
export function promptHeadings(headings: readonly { text: string }[], prompts: readonly string[]): number {
  return headings.filter((h) => prompts.some((p) => coreMatch(h.text, p))).length;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export type DiagInput = {
  keyword: string;
  prompts: readonly string[];
  you: { basics: Basics; wordCount: number | null };
  /** The top 3, rank order; an unreadable one is kept and reads as not read. */
  top: readonly TopStructure[];
  /** Key pages that link to this one, from our own reads (their internal links). */
  internalLinks: number;
};

export function diagnostics(d: DiagInput): DiagRow[] {
  const top = [...d.top].sort((a, b) => a.rank - b.rank).slice(0, 3);
  const read = (t: TopStructure) => t.status === "ok";
  const b = d.you.basics;
  const youHeadings = promptHeadings(b.headings, d.prompts);
  const topWords = top.filter(read).map((t) => t.wordCount).filter((n): n is number => typeof n === "number" && n > 0);
  const med = median(topWords);
  const most = (cells: Cell[]) => cells.filter((c) => c === true).length >= 2;
  const rows: DiagRow[] = [
    { key: "kw_title", label: "Keyword in title", you: hasKeyword(b.title, d.keyword), top: top.map((t) => (read(t) ? hasKeyword(t.title, d.keyword) : null)), flag: false },
    { key: "kw_h1", label: "Keyword in H1", you: b.h1.some((h) => hasKeyword(h, d.keyword)), top: top.map((t) => (read(t) ? hasKeyword(t.h1, d.keyword) : null)), flag: false },
    { key: "price", label: "Price in visible text", you: b.facts.price, top: top.map(() => null), flag: false },
    { key: "table", label: "Comparison table", you: b.hasTable, top: top.map(() => null), flag: false },
    { key: "date", label: "Last-updated date shown", you: b.dateShown, top: top.map((t) => (read(t) ? (t.dateShown ?? null) : null)), flag: false },
    { key: "headings", label: "Headings that match your prompts", you: youHeadings, top: top.map((t) => (read(t) ? promptHeadings(t.headings, d.prompts) : null)), flag: false },
    { key: "length", label: "Length (words)", you: d.you.wordCount, top: top.map((t) => (read(t) ? t.wordCount : null)), flag: false },
    { key: "internal", label: "Internal links to this page from your key pages", you: d.internalLinks, top: top.map(() => null), flag: false },
  ];
  for (const r of rows) {
    if (r.key === "kw_title" || r.key === "kw_h1" || r.key === "date") r.flag = r.you === false && most(r.top);
    if (r.key === "headings") r.flag = youHeadings === 0 && r.top.filter((c) => typeof c === "number" && c > 0).length >= 2;
    if (r.key === "length") r.flag = typeof d.you.wordCount === "number" && med !== null && d.you.wordCount < LENGTH_SHARE * med;
  }
  return rows;
}

/** The headings the top 3 share and the client lacks: the drafted example's missing section is drawn from these. */
export function sharedMissing(top: readonly TopStructure[], yours: readonly { text: string }[]): string[] {
  const read = top.filter((t) => t.status === "ok");
  const out: string[] = [];
  for (const t of read) {
    for (const h of t.headings) {
      if (yours.some((y) => coreMatch(y.text, h.text))) continue;
      const shared = read.filter((o) => o !== t && o.headings.some((x) => coreMatch(x.text, h.text))).length;
      if (shared >= 1 && !out.some((o) => coreMatch(o, h.text))) out.push(h.text);
    }
  }
  return out.slice(0, 8);
}
