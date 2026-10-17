/**
 * Marking names in an AI answer (17 Oct 2026, the prompt detail view): the
 * client's own names and the competitors that answer named, so a reader sees
 * at a glance who was recommended and where. Pure, so the matching is tested.
 *
 * Matching is whole-word and case-insensitive, longest name first, so
 * "Michael Page Life Sciences" is one mark rather than "Michael Page" and a
 * stray word. A name shorter than 3 characters is never matched: too many
 * false hits for too little.
 */

export type Segment = { text: string; mark: "you" | "rival" | null };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function highlight(text: string, you: readonly string[], rivals: readonly string[]): Segment[] {
  const names = [
    ...you.map((n) => ({ n: n.trim(), mark: "you" as const })),
    ...rivals.map((n) => ({ n: n.trim(), mark: "rival" as const })),
  ]
    .filter((x) => x.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  if (!names.length || !text) return [{ text, mark: null }];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${names.map((x) => escape(x.n)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const kind = new Map(names.map((x) => [x.n.toLowerCase(), x.mark]));
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), mark: null });
    out.push({ text: m[0], mark: kind.get(m[0].toLowerCase()) ?? "rival" });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: null });
  return out;
}

/** The names the client is known by, as they would be written: brand, the domain's name part, aliases. */
export function ownNames(client: { brand: string | null; domain: string; brand_aliases?: readonly string[] | null }): string[] {
  const stem = client.domain.replace(/^www\./, "").split(".")[0] ?? "";
  const spaced = stem.replace(/[-_]+/g, " ");
  return [...new Set([client.brand ?? "", client.domain.replace(/^www\./, ""), stem, spaced, ...(client.brand_aliases ?? [])].map((s) => s.trim()).filter((s) => s.length >= 3))];
}

/** What changed for one engine between two readings of a prompt. */
export function answerDiff(
  before: { named: boolean; brands: readonly string[]; sources: readonly string[] } | null,
  after: { named: boolean; brands: readonly string[]; sources: readonly string[] } | null,
): { named: "gained" | "lost" | "same" | null; brandsIn: string[]; brandsOut: string[]; sourcesIn: string[]; sourcesOut: string[] } {
  if (!before || !after) return { named: null, brandsIn: [], brandsOut: [], sourcesIn: [], sourcesOut: [] };
  const lc = (a: readonly string[]) => new Map(a.map((x) => [x.toLowerCase(), x]));
  const [b1, b2, s1, s2] = [lc(before.brands), lc(after.brands), lc(before.sources), lc(after.sources)];
  return {
    named: before.named === after.named ? "same" : after.named ? "gained" : "lost",
    brandsIn: [...b2].filter(([k]) => !b1.has(k)).map(([, v]) => v),
    brandsOut: [...b1].filter(([k]) => !b2.has(k)).map(([, v]) => v),
    sourcesIn: [...s2].filter(([k]) => !s1.has(k)).map(([, v]) => v),
    sourcesOut: [...s1].filter(([k]) => !s2.has(k)).map(([, v]) => v),
  };
}
