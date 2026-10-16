import { postBySlug } from "@/config/posts";
import { SITE_URL } from "@/config/schema";
import { publishedHubPosts } from "@/lib/hub-posts";

import { SECTIONS, descriptionOf, titleOf } from "./pages";

export const dynamic = "force-static";
// Re-read with the hub's blog feed, as the sitemap is (16 Oct 2026).
export const revalidate = 300;

/**
 * /llms.txt, in the plain-text convention: an h1, a one-line summary as a
 * blockquote, then h2 sections of linked pages. Every line is read from the
 * page's own metadata - see ./pages.ts.
 */
export async function GET() {
  // Posts published from the agency hub, listed under the writing with the sitemap's same set (sitemap.ts).
  const hub = (await publishedHubPosts()).filter((p) => !postBySlug(p.slug));
  const home = SECTIONS[0].pages[0].meta;
  const lines = ["# alwayscited", "", `> ${descriptionOf(home)}`, ""];
  for (const section of SECTIONS) {
    lines.push(`## ${section.heading}`, "");
    for (const { path, meta } of section.pages) {
      lines.push(`- [${titleOf(meta)}](${SITE_URL}${path || "/"}): ${descriptionOf(meta)}`);
    }
    if (section.heading === "Evidence and writing") {
      for (const p of hub) lines.push(`- [${p.metaTitle ?? p.title}](${SITE_URL}/blog/${p.slug}): ${p.metaDescription ?? p.excerpt}`);
    }
    lines.push("");
  }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
