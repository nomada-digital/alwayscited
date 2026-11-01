import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import BlogScanCta from "@/components/BlogScanCta";
import { OG_IMAGE } from "@/config/og";
import { formatPostDate, postBySlug, POSTS } from "@/config/posts";
import { ORG_REF, ld } from "@/config/schema";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { categoryOf } from "@/lib/blog-categories";
import { blogCategories, listed, publishedHubPosts } from "@/lib/hub-posts";
import { blogRef } from "@/lib/scan/handoff";

/**
 * A blog category's page (1 Nov 2026), as nomadadigital.co.uk's: the category's intro and its plan link, edited on the
 * agency hub (Blog tab, Categories; lib/blog-categories.ts), the free scan box, and every post in it, newest first.
 * Names and URLs are fixed on the hub. A category with no post yet is noindex and stays out of the sitemap.
 * ISR like the posts: an intro edited on the hub is here within HUB_BLOG_REVALIDATE seconds.
 */
export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await blogCategories()).map((c) => ({ slug: c.slug }));
}

async function read(slug: string) {
  const cats = await blogCategories();
  const category = cats.find((c) => c.slug === slug);
  if (!category) return null;
  const hub = (await publishedHubPosts()).filter((p) => !postBySlug(p.slug)).map(listed);
  const all = [...POSTS, ...hub];
  const posts = all.filter((p) => categoryOf(p.kind, cats)?.slug === category.slug).sort((a, b) => b.date.localeCompare(a.date));
  // the category links: those with a post, and this one
  const nav = cats.filter((c) => c.slug === category.slug || all.some((p) => categoryOf(p.kind, cats)?.slug === c.slug));
  return { category, posts, nav };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = await read((await params).slug);
  if (!d) return { title: "Category not found" };
  const intro = (d.category.intro ?? "").replace(/\s+/g, " ").trim();
  const description = intro.length > 155 ? `${intro.slice(0, 152).replace(/\s+\S*$/, "")}...` : intro || `${d.category.name}, from alwayscited.`;
  const url = `https://alwayscited.com/blog/category/${d.category.slug}`;
  return {
    title: `${d.category.name} - writing`,
    description,
    alternates: { canonical: url },
    robots: d.posts.length ? undefined : { index: false, follow: true },
    openGraph: { images: OG_IMAGE, title: `${d.category.name} | alwayscited`, description, url },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const d = await read((await params).slug);
  if (!d) notFound();
  const { category, posts, nav } = d;
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: category.name,
    url: `https://alwayscited.com/blog/category/${category.slug}`,
    isPartOf: { "@type": "Blog", name: "alwayscited", url: "https://alwayscited.com/blog", publisher: ORG_REF },
    hasPart: posts.slice(0, 20).map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `https://alwayscited.com/blog/${p.slug}`, datePublished: p.date })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(schema) }} />
      <section style={{ ...SHELL, paddingTop: "44px", display: "flex", flexDirection: "column", gap: "22px" }}>
        <div>
          <Link className="ac-row" href="/blog" style={{ fontSize: "13px", fontWeight: 600, textDecoration: "none", color: T.accent }}>
            Back to writing
          </Link>
          <div className="ac-row" style={{ ...MICRO, marginTop: "18px" }}>Writing</div>
          <h1 className="ac-row" style={{ margin: "8px 0 0", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>
            {category.name}
          </h1>
          {category.intro ? (
            <p className="ac-row" style={{ margin: "10px 0 0", fontSize: "15.5px", lineHeight: 1.6, color: T.soft, maxWidth: "70ch" }}>
              {category.intro}
            </p>
          ) : null}
          {category.servicePath ? (
            <Link className="ac-row" href={category.servicePath} style={{ display: "inline-block", marginTop: "12px", fontSize: "14px", fontWeight: 600, color: T.accent }}>
              {category.serviceLabel || "See the plans"}
            </Link>
          ) : null}
        </div>

        <nav aria-label="Blog categories" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <Link className="blog-pill" href="/blog" style={pill(false)}>All</Link>
          {nav.map((c) => (
            <Link key={c.slug} className="blog-pill" href={`/blog/category/${c.slug}`} aria-current={c.slug === category.slug ? "page" : undefined} style={pill(c.slug === category.slug)}>
              {c.name}
            </Link>
          ))}
        </nav>

        {posts.length ? (
          <div style={{ ...CARD, overflow: "hidden" }}>
            {posts.map((post) => (
              <Link key={post.slug} href={"/blog/" + post.slug} className="post-row ac-row" style={{ borderTop: "1px solid " + T.hair, textDecoration: "none" }}>
                <div style={MICRO}>{post.kind}</div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.022em", color: T.ink, lineHeight: 1.35 }}>{post.title}</div>
                  <div style={{ fontSize: "13.5px", lineHeight: 1.55, color: T.soft, marginTop: "4px" }}>{post.blurb}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: "13px", color: T.soft }}>{formatPostDate(post.date) + " - " + post.readMinutes + " min"}</div>
              </Link>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>
            Nothing here yet. <Link href="/blog" style={{ color: T.accent }}>Read everything else</Link>.
          </p>
        )}

        <div style={{ maxWidth: "68ch" }}>
          <BlogScanCta scanRef={blogRef(category.slug, "blog-c")} slug={`category/${category.slug}`} />
        </div>
      </section>
    </>
  );
}

function pill(active: boolean): React.CSSProperties {
  return {
    background: active ? T.surface : "transparent",
    border: "1px solid " + (active ? T.line : "transparent"),
    color: active ? T.ink : T.soft,
    fontSize: "14px",
    fontWeight: 600,
    padding: "8px 15px",
    borderRadius: "999px",
    textDecoration: "none",
    display: "inline-block",
  };
}
