import { z } from "zod";

/**
 * The blog's categories (1 Nov 2026), as on nomadadigital.co.uk: the hub's fixed list (public.blog_categories on the
 * hub's Supabase, site alwayscited.com), served by the hub's blog feed beside the posts. Each has its own page at
 * /blog/category/<slug> with an intro and a link to the matching plan, edited on the hub (Blog tab, Categories).
 * Every hub post's category is one of these - the hub's database refuses any other once the site has a list.
 *
 * DEFAULTS stand in until the feed serves the list (and if it ever fails): the same three names and URLs, so the
 * pages and links never 404 for want of the feed; the hub's intro and link replace these as soon as it has them.
 * Pure, so the tests run it under node.
 */
export const BlogCategory = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  intro: z.string().optional(),
  servicePath: z.string().regex(/^\/[a-z0-9/-]*$/).optional(),
  serviceLabel: z.string().optional(),
});
export type BlogCategory = z.infer<typeof BlogCategory>;

export const DEFAULT_CATEGORIES: BlogCategory[] = [
  { slug: "findings", name: "Findings", servicePath: "/alwaystracked", serviceLabel: "Track your AI visibility with alwaystracked",
    intro: "What we found when we asked the AI engines the questions buyers ask: who gets named, which pages they cite, and what changed it. Every number says where it came from and when it was taken." },
  { slug: "method", name: "Method", servicePath: "/alwayscited", serviceLabel: "See the alwayscited plan",
    intro: "How we get brands named in AI answers: the pages the engines read, the placements that move them, and how we measure whether it worked." },
  { slug: "running-an-agency", name: "Running an agency", servicePath: "/white-label", serviceLabel: "alwayscited for agencies",
    intro: "For people who run agencies: selling AI visibility to clients, pricing it, and reporting it without inventing a number." },
];

/** The feed's list, each entry checked; a malformed one is dropped. Empty when the feed sent none. */
export function parseCategories(body: unknown): BlogCategory[] {
  const list = (body as { categories?: unknown } | null)?.categories;
  return Array.isArray(list) ? list.flatMap((x) => { const r = BlogCategory.safeParse(x); return r.success ? [r.data] : []; }) : [];
}

/** The hub's list when it has one, else the defaults; a hub entry missing its copy keeps the default's. */
export function withDefaults(fromFeed: BlogCategory[]): BlogCategory[] {
  if (!fromFeed.length) return DEFAULT_CATEGORIES;
  return fromFeed.map((c) => {
    const d = DEFAULT_CATEGORIES.find((x) => x.slug === c.slug);
    return { ...d, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== "")) } as BlogCategory;
  });
}

/** A post's category page, by the post's kind (its category name), or null. */
export const categoryOf = (kind: string, cats: BlogCategory[]) => cats.find((c) => c.name.toLowerCase() === kind.toLowerCase()) ?? null;
