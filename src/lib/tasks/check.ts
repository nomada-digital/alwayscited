/**
 * The live page check behind "Update a page heading or title" (27 Nov 2026): read the heading or title out of a page's HTML and
 * compare it with the text we asked for. Pure; the fetch is in store.ts. Only whitespace, case, entities and typographic
 * quotes and dashes are ignored: the words must match.
 */
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-", hellip: "..." };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Comparable form of a piece of text. */
export function norm(s: string): string {
  return decodeEntities(s)
    .replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/** The first h1's text, or the title's, or null. */
export function extractTarget(html: string, target: "h1" | "title"): string | null {
  const re = target === "h1" ? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i : /<title\b[^>]*>([\s\S]*?)<\/title>/i;
  const m = re.exec(html);
  if (!m) return null;
  const text = decodeEntities(m[1]!.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return text || null;
}

export type Verdict = { ok: boolean; found: string | null; note: string };

export function verdict(html: string, target: "h1" | "title", after: string): Verdict {
  const found = extractTarget(html, target);
  const what = target === "title" ? "title" : "H1";
  if (found === null) return { ok: false, found, note: `No ${what} found on the live page.` };
  if (norm(found) === norm(after)) return { ok: true, found, note: `The live page's ${what} matches.` };
  return { ok: false, found, note: `The live ${what} still reads "${found.slice(0, 160)}".` };
}
