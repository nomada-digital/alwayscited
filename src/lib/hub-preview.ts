/**
 * Where the proxy sends a hub post's draft link (16 Oct 2026).
 *
 * The agency hub links a draft as `/blog/<slug>?preview=<key>`, the same shape
 * it uses for its own site. Reading the query on `/blog/[slug]` would make the
 * live route render on every request, so `proxy.ts` rewrites the preview to
 * `/blog-preview/<slug>/<key>` instead, a prefix robots.txt and the header close. Anything that is not exactly a slug and
 * a uuid key is left alone. Pure, so `hub-preview.test.mts` runs it under bare node.
 */
const SLUG = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function previewPath(pathname: string, preview: string | null): string | null {
  const m = SLUG.exec(pathname);
  if (!m || !preview || !KEY.test(preview)) return null;
  return `/blog-preview/${m[1]}/${preview.toLowerCase()}`;
}
