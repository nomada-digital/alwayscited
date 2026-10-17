import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { refuseRole } from "@/lib/tracking/stop";
import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath, fixtureClient, fixtureRequest } from "@/lib/dash/fixture";
import { requestIntegration } from "@/lib/dash/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = ["ga4", "gsc", "bing"] as const;

/**
 * Ask for GA4, Search Console or Bing Webmaster to be connected (17 Oct 2026).
 * The OAuth flows are not live yet - they need the Google and Microsoft app
 * registrations, which are Danny's to create - so this records the request
 * on integration_connections and the card says it is waiting.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
  const provider = PROVIDERS.find((p) => p === body?.provider);
  if (!provider) return Response.json({ ok: false, message: "Pick an integration." }, { status: 400 });
  if (dashFixturePath()) {
    if (fixtureClient().slug !== slug) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
    fixtureRequest(provider);
    return Response.json({ ok: true });
  }
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const role = refuseRole(c.status === "ended" ? "viewer" : c.role);
  if (role) return Response.json({ ok: false, message: role }, { status: 403 });
  const e = await requestIntegration(supabaseAdmin(), c.id, provider, email);
  if (e) {
    console.warn(`[dash] could not record an integration request: ${e}`);
    return Response.json({ ok: false, message: "That did not save. Try again in a minute." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
