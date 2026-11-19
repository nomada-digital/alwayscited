import { z } from "zod";

import { longDate } from "./long-date.ts";

/**
 * Case studies published from the Nomada agency hub.
 *
 * The figures are not typed anywhere in this repo. Each one is a reading from
 * the dashboards' daily Google and AI tracking, frozen when the study was
 * requested, written up, signed off by the client and published by Danny on
 * the hub - the database refuses anyone else, refuses without the client's
 * sign-off recorded, and leak-checks the public text at the moment of
 * publishing (no prices, vendors, tools or placement wording; no client name
 * in an anonymised study). Every study carries its window (`from`, `to`), the
 * keyword set it was measured on and a method line, which is the dated source
 * AGENTS.md asks a client figure to stand on.
 *
 * Read through a public edge function on the nomada-dashboards Supabase
 * project: no key here, and the table itself is closed to anon. The workflow
 * lives in nomada-dashboards `ops/case-studies/README.md`.
 *
 * Never fatal: a feed that fails to load renders the static page without its
 * studies, and ISR keeps serving the last good render until it answers again.
 */
export const CASE_STUDY_FEED = "https://qpsrvmnmtozvailsyqqz.supabase.co/functions/v1/case-studies?site=alwayscited.com";

/** Seconds between re-reads of the feed. A study goes live within this of being published. */
export const CASE_STUDY_REVALIDATE = 300;

const Kpi = z.object({ n: z.string(), l: z.string() });
const Point = z.object({
  d: z.string(), p1: z.number(), vol: z.number().optional(),
  b3: z.number().optional(), b10: z.number().optional(), b20: z.number().optional(),
});
const AiRun = z.object({ d: z.string(), pc: z.number(), named: z.number(), cells: z.number() });
const PromptCard = z.object({
  q: z.string(),
  engines: z.array(z.object({ e: z.string(), then: z.boolean().nullish(), now: z.boolean(), pos: z.number().nullish(), of: z.number().nullish() })),
});
const Pair = z.object({ l: z.string(), then: z.number(), now: z.number() });
const Engine = z.object({ e: z.string(), then: z.number(), now: z.number(), of: z.number() });
const Keyword = z.object({ k: z.string(), vol: z.number().nullish(), then: z.number().nullish(), now: z.number().nullish() });

// the hero image (19 Nov 2026): the results image drawn on the hub, served from its public storage bucket
const heroUrl = z.string().regex(/^https:\/\/qpsrvmnmtozvailsyqqz\.supabase\.co\/storage\/v1\/object\/public\/case-study-heroes\/[a-z0-9-]+\.(webp|png)$/);
const Hero = z.object({
  src: z.union([heroUrl, z.string().regex(/^data:image\/webp;base64,/)]),  // alwayscited's CSP allows img-src data:, not the storage host alt: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive(),
  og: z.object({ wide: heroUrl, square: heroUrl.optional(), fourThree: heroUrl.optional() }).optional(),
});

const CaseStudy = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  site: z.literal("alwayscited.com"),
  published: z.string(),
  client: z.string(),
  named: z.boolean().optional(),
  domain: z.string().optional(),
  market: z.string().optional(),
  period: z.string().optional(),
  periodLabel: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  headline: z.string(),
  intro: z.string().optional(),
  challenge: z.string().optional(),
  approach: z.string().optional(),
  results: z.string().optional(),
  kpis: z.array(Kpi).optional(),
  series: z.array(Point).optional(),
  keywords: z.array(Keyword).optional(),
  compare: z.object({ kw: z.number(), rows: z.array(Pair) }).optional(),
  movers: z.array(Keyword).optional(),
  engines: z.object({ from: z.string(), to: z.string(), rows: z.array(Engine) }).optional(),
  ai: z.object({ from: z.string(), to: z.string(), pc: z.array(z.number()), cells: z.number(), prompts: z.number() }).optional(),
  aiRuns: z.array(AiRun).optional(),
  prompts: z.array(PromptCard).optional(),
  tracked: z.object({ kw: z.number().nullish(), prompts: z.number().nullish() }).optional(),
  // dashboard screenshots, embedded (img-src allows data:), checked for wording at capture
  shots: z.array(z.object({
    section: z.enum(["google", "ai", "prompts"]), alt: z.string(), w: z.number(), h: z.number(),
    src: z.string().regex(/^data:image\/(webp|png|jpeg);base64,/),
  })).optional(),
  hero: Hero.optional(),
  method: z.string().optional(),
});
export type CaseStudy = z.infer<typeof CaseStudy>;

export async function publishedCaseStudies(): Promise<CaseStudy[]> {
  try {
    const res = await fetch(CASE_STUDY_FEED, { next: { revalidate: CASE_STUDY_REVALIDATE } });
    if (!res.ok) return [];
    const body = (await res.json()) as { case_studies?: unknown[] };
    // One malformed study is dropped rather than taking the others down with it.
    return (body.case_studies ?? []).flatMap((x) => {
      const r = CaseStudy.safeParse(x);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

export async function caseStudy(id: string): Promise<CaseStudy | null> {
  return (await publishedCaseStudies()).find((s) => s.id === id) ?? null;
}

// "1 October 2026" from an ISO date - moved to a pure module for the shared charts (M3, 8 Oct 2026).
export { longDate };

/** The window a study was measured over, in words: "24 June 2026 to 1 October 2026". */
export function windowOf(s: CaseStudy): string | null {
  return s.from && s.to ? `${longDate(s.from)} to ${longDate(s.to)}` : null;
}
