import { type Audience } from "../../config/keyword-audience.ts";
import { audienceFit } from "./audience.ts";

/**
 * The example in Find keywords' box (27 Nov 2026, Danny): "e.g. life sciences recruitment" was typed in for every client. It now comes from
 * the client's own space - a short head term (2 to 4 words) from its tracked keywords or cluster names, with real search volume and no brand
 * name in it - and follows the B2B / B2C / All toggle. Pure: no database, no model. placeholder-io.ts caches the result per client and
 * generates a term once, from the site, when the client's own keywords hold none of that kind.
 */
export type PH = { term: string; source: "keywords" | "generated"; volume: number | null };
export type Placeholders = Partial<Record<Audience, PH>>;
export type Candidate = { keyword: string; volume: number | null };

export const GENERIC_PLACEHOLDER = "life sciences recruitment";

/** A keyword that names a place is a local one, not the client's head term (the full place list is scan/locations.ts, which reads them for that place). */
const PLACE = /(?<![\p{L}\p{N}])(york|yorkshire|leeds|sheffield|harrogate|bradford|wakefield|hull|manchester|liverpool|london|birmingham|bristol|brighton|cambridge|oxford|norwich|nottingham|leicester|newcastle|edinburgh|glasgow|cardiff|belfast|uk|usa|england|scotland|wales)(?![\p{L}\p{N}])/iu;

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

/** 2 to 4 words, letters and numbers only: a head term, not a sentence or a year. */
export function isHead(keyword: string): boolean {
  const w = words(keyword);
  return w.length >= 2 && w.length <= 4 && !w.some((x) => /^\d+$/.test(x) && x.length === 4) && keyword.trim().length <= 60;
}

/** The words that name the client: its brand, its aliases and the first label of its domain. Short words are not brand terms. */
export function brandTermsOf(brand: string | null | undefined, domain: string, aliases: readonly string[] = []): string[] {
  const label = domain.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  return [...new Set([brand ?? "", label, ...aliases].map((b) => words(b).join(" ")).filter((b) => b.length >= 3))];
}

const namesBrand = (keyword: string, brandTerms: readonly string[]) => {
  const k = ` ${words(keyword).join(" ")} `;
  return brandTerms.some((b) => k.includes(` ${b} `) || (words(b).length === 1 && words(k).some((w) => w === b)));
};

/** The best head term of the audience's kind among the candidates, or null when there is none worth showing. */
export function pickHead(candidates: readonly Candidate[], o: { audience: Audience; brandTerms: readonly string[]; market?: "UK" | "US" | "JM" }): PH | null {
  const seen = new Set<string>();
  const ok = candidates.filter((c) => {
    const k = words(c.keyword).join(" ");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return isHead(k) && (c.volume ?? 0) > 0 && !namesBrand(k, o.brandTerms) && !PLACE.test(k);
  });
  const fit = (c: Candidate) => (o.audience === "all" ? 0 : audienceFit({ keyword: c.keyword, volume: c.volume, intent: null }, o.audience));
  const ranked = ok.filter((c) => o.audience === "all" || fit(c) > 0).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || words(a.keyword).length - words(b.keyword).length);
  const top = ranked[0];
  return top ? { term: words(top.keyword).join(" "), source: "keywords", volume: top.volume } : null;
}

/** What each toggle state can show from the client's own keywords. A state with nothing is absent (generated once, later). */
export function derivePlaceholders(candidates: readonly Candidate[], o: { brandTerms: readonly string[]; market?: "UK" | "US" | "JM" }): Placeholders {
  const out: Placeholders = {};
  for (const a of ["all", "b2b", "b2c"] as const) {
    const p = pickHead(candidates, { audience: a, brandTerms: o.brandTerms, market: o.market });
    if (p) out[a] = p;
  }
  return out;
}

/** The cached terms, read defensively. */
export function readPlaceholders(v: unknown): Placeholders {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Placeholders = {};
  for (const a of ["all", "b2b", "b2c"] as const) {
    const x = o[a] as { term?: unknown; source?: unknown; volume?: unknown } | undefined;
    if (x && typeof x.term === "string" && x.term.trim() && x.term.length <= 60) out[a] = { term: x.term.trim(), source: x.source === "generated" ? "generated" : "keywords", volume: typeof x.volume === "number" ? x.volume : null };
  }
  return out;
}

/** The text for a toggle state: its own term; else the All term; else the generic example (last resort only). */
export function placeholderFor(ph: Placeholders | null | undefined, audience: Audience): string {
  return (ph?.[audience] ?? ph?.all)?.term ?? GENERIC_PLACEHOLDER;
}

/** The audiences with no term of their own yet. */
export function missingAudiences(ph: Placeholders): Audience[] {
  return (["all", "b2b", "b2c"] as const).filter((a) => !ph[a]);
}
