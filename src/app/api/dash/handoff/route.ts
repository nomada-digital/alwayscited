import { verifyHandoff } from "@/lib/dash/handoff";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The hub's signed handoff (26 Nov 2026, lib/dash/handoff.ts): agency staff arrive here from the hub's customer page,
 * signed with HMAC under HUB_HANDOFF_SECRET, and are sent on to that customer's dashboard in the agency view - the
 * read-only view-as, with its banner and every write path off - with no sign-in. It mints the view-as token the way the
 * hub's own "What the customer sees" does (hub_view_as, 30 minutes, written to dashboard_view_tokens under the staff
 * member's email). Without the secret set it answers 503 and makes nothing. Never cached, never indexed.
 */
const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
const refuse = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function GET(req: Request) {
  const u = new URL(req.url);
  const v = verifyHandoff(process.env.HUB_HANDOFF_SECRET, { slug: u.searchParams.get("slug"), by: u.searchParams.get("by"), exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") });
  if (!v.ok) return refuse(v.reason === "not_configured" ? 503 : v.reason === "not_staff" ? 403 : 400, v.reason === "not_configured" ? "not_configured" : "refused");
  const { data, error } = await supabaseAdmin().rpc("hub_view_as", { p_slug: v.slug, p_by: v.by });
  const out = data as { token?: string; slug?: string; error?: string } | null;
  if (error) {
    console.warn(`[handoff] could not mint a view for ${v.slug}: ${error.message}`);
    return refuse(502, "unavailable");
  }
  if (!out?.token || !/^[0-9a-f]{64}$/.test(out.token)) return refuse(404, out?.error === "no_owner" ? "no_owner" : "not_found");
  return new Response(null, { status: 302, headers: { ...headers, location: `/view/${out.token}/${v.slug}` } });
}
