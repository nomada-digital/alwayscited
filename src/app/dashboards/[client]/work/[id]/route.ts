import { NextResponse } from "next/server";

import { workClient, workFileUrl } from "@/lib/dash/work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A Work completed file (sg-35, 2 Nov 2026): `/<slug>/work/<id>` on the dashboards host, and the same under the hub's
 * view-as link (`/view/<token>/<slug>/work/<id>`, which the proxy rewrites here with its header). The client is
 * authorised as its pages are (work.ts workClient: the view-as token, else the session's own clients); the item must
 * be that client's; then a five-minute signed link on the private bucket work-files is made with the service role and
 * the browser is sent to it. Anything else is a plain 404, which says nothing about whether the item exists.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ client: string; id: string }> }) {
  const { client: slug, id } = await params;
  const none = () => new NextResponse(null, { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
  const client = await workClient(slug).catch((err: unknown) => {
    console.warn(`[dash] work file access check failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (!client) return none();
  const url = await workFileUrl(client.id, id);
  if (!url) return none();
  const res = NextResponse.redirect(url, 302);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  res.headers.set("x-robots-tag", "noindex, nofollow");
  return res;
}
