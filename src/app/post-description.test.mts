import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { code } from "../lib/source-read.mts";
import { decodeEntities, PRERENDER_DIR as PRERENDER } from "./dynamic-render.mts";

/**
 * The description an answer engine reads, joined to one the site publishes.
 *
 * `config/posts.ts` exists so that the index, the post header and the
 * structured data cannot drift apart, and it says so in its own first line. It
 * got there for `headline`, for `url` and for `datePublished` - each of which
 * had been retyped, and each of which is now derived from the registry. It
 * stopped one field short. `blogPostingSchema` took `description: string`, a
 * loose argument joined to nothing, so every post typed a description a second
 * time by hand beside its SERP one and its share one.
 *
 * **What the second typing had already cost, read off the shipped prerenders
 * on 20 Sep 2026 rather than reasoned about:** two of the three posts had
 * copied their *share* line into the node and the third had copied its *SERP*
 * line. Three posts, one field, two different answers to what that field is a
 * copy of - and nothing anywhere could say so, because a hand copy references
 * nothing. Rewrite either line on any post and the node keeps the old sentence
 * in silence, on the one surface this product is about.
 *
 * The finding came in through `docs/prose-claims.mjs`, and it is that census's
 * own shape: `posts.ts` carried the sentence "nothing else on the site holds a
 * second copy of either", offered as the reason the descriptions did not
 * belong in the registry. It was false for all three posts. **The false
 * universal was not inert prose - it was the premise that kept the third
 * surface out of the file whose whole job is to hold the other two.**
 *
 * Which of the two it now reads is a judgement and is recorded in
 * `blogPostingSchema`: the SERP line, because schema `description` and a meta
 * description answer the same question and the share line is a hook.
 *
 * ---
 *
 * **Why this is scoped to `BlogPosting` and not to every writing node.** The
 * three `Article` nodes on this site deliberately carry their own authored
 * sentence - checked, not assumed, and the check is rule 2 below. Widening the
 * rule to `WRITING` would fail on a clean tree, and a rule that fails on a
 * clean tree is one that gets an exemption written for it.
 */

const NEEDS_BUILD = "no build to read - run `npm run build` then `npm run capture`";

/**
 * Every JSON-LD block on a page.
 *
 * The fourth local copy of this four-line reader, and deliberately local for
 * the reason `organization-entity.test.mts` records beside its own: importing
 * one `.test.mts` from another registers that file's tests a second time, and
 * the subtest count is the only column that tells a real pass from a
 * duplicated one. Consolidating the four is a change to make on its own, not
 * beside a finding. The flight payload holds these scripts as
 * `["$","script",null,{...}]` tuples, so the literal opening tag cannot match
 * inside it and no block is counted twice.
 */
function ldBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => m[1]!,
  );
}

type Node = Record<string, unknown>;

/** Every node in every graph on the page, flattened. */
function nodesOf(html: string): Node[] {
  const out: Node[] = [];
  for (const raw of ldBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // `structured-data.test.mts` owns the parse failure
    }
    const graph = (parsed as Node)?.["@graph"];
    const nodes = Array.isArray(parsed) ? parsed : Array.isArray(graph) ? graph : [parsed];
    for (const n of nodes) if (n && typeof n === "object") out.push(n as Node);
  }
  return out;
}

/**
 * The `<meta name="description">` a page serves, as a reader gets it.
 *
 * `decodeEntities` is the whole reason this is a function rather than a
 * regex at the call site, and it is not a detail. **A head attribute is
 * entity-escaped and a JSON-LD string is not.** React writes `you'll` into the
 * attribute as `you&#x27;ll` and leaves it alone inside the script, so the raw
 * comparison reports a difference on the two posts whose source types one
 * literal - the flattering direction, since it would have reported this
 * defect as already fixed. Measured while writing this file.
 */
function metaDescription(html: string): string | undefined {
  const end = html.indexOf("</head>");
  const head = end === -1 ? html : html.slice(0, end);
  const m = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(head);
  return m ? decodeEntities(m[1]!).replace(/\s+/g, " ").trim() : undefined;
}

function schemaText(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : undefined;
}

/**
 * The posts, off the filesystem rather than off a list typed here.
 *
 * A typed list cannot report a post that stopped prerendering: it would name
 * three slugs, find three files, and pass. This walks `src/app/blog` for the
 * directories that are posts - the index's own `page.tsx` is a file, not a
 * directory - so a post added, renamed or dropped moves the denominator
 * without an edit here, and a post whose prerender is missing fails rather
 * than falling out of the count.
 */
function postSlugs(): string[] {
  return readdirSync(join("src", "app", "blog"), { withFileTypes: true })
    // 16 Oct 2026: `[slug]` is the route for posts published from the agency
    // hub (lib/hub-posts.ts), not a post. Its posts have no directory of their
    // own; they are read off the prerender instead, by hubPrerenders below.
    .filter((e) => e.isDirectory() && !e.name.startsWith("["))
    .map((e) => e.name)
    .sort();
}

/**
 * Hub posts that prerendered: every blog/<slug>.html the build wrote that no
 * post directory accounts for. None while none is published, and each one
 * then joins the first test below, so a hub post's node is held to the page's
 * description by the same check as the four written in TSX. The second test
 * reads source per directory and has nothing to read for these: both of a hub
 * post's surfaces come from `description()` in `blog/[slug]/post.tsx`.
 */
function hubPrerenders(): string[] {
  const dir = join(PRERENDER, "blog");
  if (!existsSync(dir)) return [];
  const written = new Set(postSlugs());
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html") && !written.has(f.slice(0, -5)))
    .map((f) => f.slice(0, -5))
    .sort();
}

test("every BlogPosting node describes the post with the description the page publishes", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const slugs = postSlugs();
  assert.ok(slugs.length >= 3, "no post directories found - the walk has stopped matching");
  const hub = hubPrerenders();
  t.diagnostic(`${slugs.length} written posts, ${hub.length} from the hub`);

  for (const slug of [...slugs, ...hub]) {
    const file = join(PRERENDER, "blog", slug + ".html");
    assert.ok(existsSync(file), slug + " has no prerender at blog/" + slug + ".html");
    const html = readFileSync(file, "utf8");

    const posts = nodesOf(html).filter((n) => n["@type"] === "BlogPosting");
    assert.equal(posts.length, 1, slug + " should carry exactly one BlogPosting node");

    const meta = metaDescription(html);
    assert.ok(meta, slug + " serves no meta description");
    assert.equal(
      schemaText(posts[0]!.description),
      meta,
      slug +
        ": the BlogPosting description is not the description this page publishes. Both come" +
        " from one `PostCopy` now - a difference here means one of them was typed again.",
    );
  }
});

/**
 * The reason rule 1 is scoped to `BlogPosting`, re-earned rather than asserted.
 *
 * The device is `structured-data.test.mts`'s `UNDATED` and
 * `organization-entity.test.mts`'s `sameAs`: an absence stated in prose is a
 * claim about the tree that nothing checks, so it costs a `holds`. Each of
 * these three pages writes its `Article` description as its own sentence,
 * longer or differently scoped than the head, and that is an editorial choice
 * rather than an oversight. If one is ever derived from its head the entry
 * below stops being true and this fails, which is the point: the next run
 * widening rule 1 should be told by a test that the exclusion has expired, not
 * left to re-read three pages.
 *
 * It says nothing about a *new* `Article` page. A rule requiring every future
 * one to differ would fire on a clean tree, which is how an exemption gets
 * written.
 */
const AUTHORED: Record<string, string> = {
  "case-studies/vibe-retail.html":
    "the node names the client's three figures and their windows; the head leads on the placement that produced them",
  "how-it-works.html": "the node describes the mechanism, the head describes what we measure",
  "what-is-aeo.html": "the node defines the term, the head contrasts it with SEO",
};

test("the three Article nodes still carry their own authored description", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  for (const [page, why] of Object.entries(AUTHORED)) {
    const file = join(PRERENDER, page);
    assert.ok(existsSync(file), page + " is recorded here and has no prerender");
    const html = readFileSync(file, "utf8");

    const articles = nodesOf(html).filter((n) => n["@type"] === "Article");
    assert.equal(articles.length, 1, page + " should carry exactly one Article node");

    const schema = schemaText(articles[0]!.description);
    assert.ok(schema, page + " has an Article node with no description");
    assert.notEqual(
      schema,
      metaDescription(html),
      page +
        " now matches its head, so it is no longer authored separately (" +
        why +
        "). Drop it from AUTHORED and widen rule 1 to cover it.",
    );
  }
});

/**
 * Rule 3, and it is this file's own refill.
 *
 * Asked of rule 1 while its denominator was still in mind: **rule 1 checks
 * that the two copies AGREE, not that there is one source.** A page can hand
 * `postMetadata` one object literal and `blogPostingSchema` another, and as
 * long as somebody types the same sentence into both, rule 1 passes.
 *
 * That is not a hypothetical costume. It is the exact state two of the three
 * posts were in before this push: the share line typed twice, byte for byte,
 * *agreeing* - and agreeing is what made it invisible for as long as it was.
 * A value rule fires the day a copy drifts; this one refuses the copy, which
 * is a push earlier.
 *
 * So: both calls on a post page must be passed the same identifier. An object
 * literal at either call site is a second place to type a description, and the
 * type on `blogPostingSchema` cannot tell the difference - `PostCopy` is
 * structural, and `{ description: "...", ogDescription: "..." }` satisfies it
 * perfectly.
 *
 * Comments are stripped first. `code()` carries the roll of the times that cut
 * has paid, and it applies to the file being written as much as to any other -
 * a doc comment here quoting `blogPostingSchema(post, COPY)` would otherwise
 * answer this rule on behalf of a page that had stopped doing it.
 */
const CALL = /(postMetadata|blogPostingSchema)\s*\(\s*post\s*,\s*([^)]*?)\s*\)/g;

test("both surfaces on a post page are handed the same copy object", () => {
  const dir = join("src", "app", "blog");
  const slugs = postSlugs();
  assert.ok(slugs.length >= 3, "no post directories found - the walk has stopped matching");

  for (const slug of slugs) {
    const src = code(readFileSync(join(dir, slug, "page.tsx"), "utf8"));

    CALL.lastIndex = 0;
    const args = new Map<string, string>();
    for (const m of src.matchAll(CALL)) args.set(m[1]!, m[2]!.trim());

    assert.equal(args.size, 2, slug + ": expected one call to each of the two builders");
    const [meta, schema] = [args.get("postMetadata")!, args.get("blogPostingSchema")!];

    assert.match(
      meta,
      /^[A-Z_][A-Za-z0-9_]*$/,
      slug + ": postMetadata is passed " + meta + " rather than a named copy object",
    );
    assert.equal(
      meta,
      schema,
      slug +
        ": the head and the structured data are built from different arguments (" +
        meta +
        " and " +
        schema +
        "), so a description can be typed twice again.",
    );
  }
});
