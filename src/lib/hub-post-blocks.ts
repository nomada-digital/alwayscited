/**
 * A hub post's text to blocks (16 Oct 2026), for `components/HubPostBody.tsx`.
 *
 * Plain text from the agency hub: `## ` and `### ` headings, paragraphs split
 * by a blank line, `- ` and `1. ` lists, `> ` quotes, and the directive lines
 * `[[toc]]`, `[[faqs]]`, `[[figure]]`, `[[cta]]`. Inline marks stay in the
 * text for the component. Pure, so `hub-post-blocks.test.mts` runs it under bare node.
 */
export type Block =
  | { k: "h2" | "h3"; text: string; id: string }
  | { k: "p" | "quote"; text: string }
  | { k: "ul" | "ol"; items: string[] }
  | { k: "toc" | "faqs" | "figure" | "cta" };

const slugify = (s: string) =>
  s.toLowerCase().replace(/\*\*/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-") || "section";

/** Content to blocks, and the h2s as the post's contents list. */
export function blocks(content: string): { blocks: Block[]; sections: { id: string; label: string }[] } {
  const out: Block[] = [];
  const used = new Set<string>(["questions"]);   // the FAQ heading's id
  const id = (t: string) => {
    const base = slugify(t);
    let s = base, i = 2;
    while (used.has(s)) s = `${base}-${i++}`;
    used.add(s);
    return s;
  };
  for (const raw of content.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const lines = chunk.split("\n").map((l) => l.trim());
    const dir = /^\[\[(toc|faqs|figure|cta)\]\]$/.exec(chunk);
    if (dir) { out.push({ k: dir[1] as "toc" | "faqs" | "figure" | "cta" }); continue; }
    if (lines.length === 1 && /^#{2,3} /.test(chunk)) {
      const text = chunk.replace(/^#{2,3} /, "");
      out.push({ k: chunk.startsWith("### ") ? "h3" : "h2", text, id: id(text) });
      continue;
    }
    if (lines.every((l) => /^[-*] /.test(l))) { out.push({ k: "ul", items: lines.map((l) => l.slice(2)) }); continue; }
    if (lines.every((l) => /^\d+[.)] /.test(l))) { out.push({ k: "ol", items: lines.map((l) => l.replace(/^\d+[.)] /, "")) }); continue; }
    if (lines.every((l) => l.startsWith(">"))) { out.push({ k: "quote", text: lines.map((l) => l.replace(/^>\s?/, "")).join(" ") }); continue; }
    out.push({ k: "p", text: lines.join(" ") });
  }
  return { blocks: out, sections: out.flatMap((b) => (b.k === "h2" ? [{ id: b.id, label: b.text.replace(/\*\*/g, "") }] : [])) };
}

/** A ranked list ("Best AI SEO agencies", "Peec AI alternatives", "Top 10 ..."), from its title. */
export const isListicle = (title: string) => /\bbest\b|\balternatives\b|\btop \d+\b/i.test(title);

/**
 * Where the early free scan box goes (Danny, 1 Nov 2026), for a hub post and a hand-written one alike. On a listicle
 * (isListicle), just before its first ranked entry (the first heading that starts "1."). On any other post, just
 * before the second ## heading, once the reader has the intro and the first section - or before a numbered list that
 * starts sooner, so the box never splits one (a numbered guide's "1." deep in the post is a step, not an entry).
 * -1 when there is no such heading, or it is the tail of the post (the last two items): the end box is the only one.
 */
export function earlyCtaAt(heads: readonly { at: number; level: number; text: string }[], total: number, listicle = false): number {
  const ranked = heads.find((h) => /^1[.)]\s/.test(h.text.replace(/\*\*/g, "").trim()))?.at ?? -1;
  const second = heads.filter((h) => h.level === 2)[1]?.at ?? -1;
  const at = listicle && ranked >= 0 ? ranked : ranked >= 0 && (second < 0 || ranked < second) ? ranked : second;
  return at > 0 && at < total - 2 ? at : -1;
}

/**
 * The free scan boxes in a hub post (components/BlogScanCta.tsx): the early one (earlyCtaAt) and one at the end, never
 * more than two. A [[cta]] the writer put before the early spot is the early one, where it stands; a later one is the
 * end box (it renders at the end, not mid-post); any other [[cta]] is dropped.
 */
export function placeCtas(bs: readonly Block[], title = ""): { blocks: Block[]; end: boolean } {
  const heads = bs.flatMap((b, i) => (b.k === "h2" || b.k === "h3" ? [{ at: i, level: b.k === "h2" ? 2 : 3, text: b.text }] : []));
  const spot = earlyCtaAt(heads, bs.length, isListicle(title));
  const token = bs.findIndex((b) => b.k === "cta");
  const early = token >= 0 && (spot < 0 || token < spot) ? token : spot;
  const out: Block[] = [];
  bs.forEach((b, i) => {
    if (i === early) out.push({ k: "cta" });
    if (b.k !== "cta") out.push(b);
  });
  return { blocks: out, end: true };
}
