import { suppress } from "@/lib/scan/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: unsubscribe the report's address (lib/scan/unsubscribe.ts). Two callers, one effect:
 * - the button on /scan/<token>/unsubscribe, a plain form post, answered with a redirect back to that page;
 * - a mail client's one-click unsubscribe (RFC 8058, the List-Unsubscribe-Post header on every report email),
 *   answered with a bare 200.
 * Never GET: a link checker that opens every URL in a message must not unsubscribe anybody.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const form = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded") ? await req.formData() : null;
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const out = await suppress(token, oneClick || !form ? "one_click" : "unsubscribe_link");
  if (form && !oneClick) {
    return Response.redirect(new URL(`/scan/${token}/unsubscribe?${out === "done" ? "done=1" : "failed=1"}`, req.url), 303);
  }
  return new Response(null, { status: out === "failed" ? 500 : 200 });
}
