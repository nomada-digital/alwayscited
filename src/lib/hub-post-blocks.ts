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

/**
 * Where the free scan box goes (Danny, 1 Nov 2026, components/BlogScanCta.tsx): early, once the reader has the intro
 * and the first section - just before the second ## heading - and once more at the end. Never more than two.
 * A [[cta]] the writer put before the second heading is the early one, where it stands; one later in the post is the
 * end one (the box renders at the end, not mid-post); any other [[cta]] is dropped. A post with one section gets the
 * end box only, as does one whose second heading is its tail.
 */
export function placeCtas(bs: readonly Block[]): { blocks: Block[]; end: boolean } {
  const second = bs.flatMap((b, i) => (b.k === "h2" ? [i] : []))[1] ?? -1;
  const token = bs.findIndex((b) => b.k === "cta");
  const early = token >= 0 && (second < 0 || token < second) ? token : second > 0 && second < bs.length - 2 ? second : -1;
  const out: Block[] = [];
  bs.forEach((b, i) => {
    if (i === early) out.push({ k: "cta" });
    if (b.k !== "cta") out.push(b);
  });
  return { blocks: out, end: true };
}
