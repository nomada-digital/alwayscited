import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * A client's logo, same-origin (Danny, 26 Nov 2026). The dashboards host's CSP allows images from 'self' only, so a
 * client's favicon (client_domains.logo_url, an https address staff set) is fetched here and passed on, cached for a
 * day in the browser and a week at the edge. No session: it is a public favicon, and the route says nothing but the
 * image. 404 when the client has none or the image cannot be read, so the page draws initials instead.
 */
const MAX_BYTES = 512 * 1024;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return new Response(null, { status: 404 });
  const { data, error } = await supabaseAdmin().from("client_domains").select("logo_url").eq("slug", slug).maybeSingle();
  // A read that failed is not "no logo": say so, briefly cached, so the page draws initials now and asks again soon.
  if (error) return new Response(null, { status: 503, headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
  const url = (data as { logo_url?: string | null } | null)?.logo_url;
  if (!url || !url.startsWith("https://")) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=300, s-maxage=300" } });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000), redirect: "follow", headers: { "user-agent": "alwayscited-logo/1.0" } });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!res.ok || !/^image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type)) throw new Error(`not an image (${res.status} ${type})`);
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) throw new Error("size");
    return new Response(body, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
        // An SVG opened on its own address may not run anything.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=300, s-maxage=300" } });
  }
}
