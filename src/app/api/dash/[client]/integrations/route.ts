import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { refuseRole } from "@/lib/tracking/stop";
import { dashEmail } from "@/lib/dash/access";
import { CONNECT_LIMITS } from "@/config/contact";
import { ACCESS_EMAIL, gaPropertyId } from "@/lib/dash/connect";
import { findProperty, pullConnection } from "@/lib/dash/connect-io";
import { dashFixturePath, fixtureClient } from "@/lib/dash/fixture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROVIDERS = ["ga4", "gsc", "bing"] as const;

const HINT = {
  gsc: `Check that ${ACCESS_EMAIL} is on your site's Users and permissions list with Restricted access, on the property for your domain.`,
  ga4: `Check that ${ACCESS_EMAIL} has the Viewer role under Property access management, and that the property ID you pasted is the number in Admin, Property details.`,
  bing: `Check that ${ACCESS_EMAIL} is under Settings, User management for your site, spelled exactly like that.`,
} as const;

/**
 * Check connection (2 Nov 2026, sg-37; in place of the 17 Oct request button).
 * The customer has added our access address on their side; this asks Windsor
 * whether it can now read the property (lib/dash/connect-io.ts). Found: the
 * connection is marked connected with the property, and the first pull runs
 * now; the 05:00 cron keeps it fresh. Not found: the row is kept as pending
 * with the time of the first try, so a customer still stuck a day later is in
 * Danny's run-health mail, and the answer says what to double check.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { provider?: unknown; property?: unknown } | null;
  const provider = PROVIDERS.find((p) => p === body?.provider);
  if (!provider) return Response.json({ ok: false, message: "Pick an integration." }, { status: 400 });
  const gaId = provider === "ga4" ? gaPropertyId(String(body?.property ?? "").slice(0, CONNECT_LIMITS.gaProperty)) : null;
  if (provider === "ga4" && !gaId) return Response.json({ ok: false, message: "Paste your GA4 property ID first. It is the number under Admin, Property details, not the code that starts with G." }, { status: 400 });
  if (dashFixturePath()) {
    if (fixtureClient().slug !== slug) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
    return Response.json({ ok: true, connected: false, message: "Not visible yet: it can take a few minutes.", hint: HINT[provider] });
  }
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const role = refuseRole(c.status === "ended" ? "viewer" : c.role);
  if (role) return Response.json({ ok: false, message: role }, { status: 403 });

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: was, error: wasErr } = await db.from("integration_connections").select("status, requested_at, requested_by").eq("client_domain_id", c.id).eq("provider", provider).maybeSingle();
  // Unread, the first try's time is taken as now: the 24 hour line starts late rather than the check failing.
  if (wasErr) console.warn(`[connect] could not read ${c.domain} ${provider}: ${wasErr.message}`);
  const { found, why } = await findProperty(provider, c.domain, gaId);
  if (why && !/not available/i.test(why)) console.warn(`[connect] ${c.domain} ${provider}: ${why}`);
  const first = { requested_by: (was?.requested_by as string | null) ?? email, requested_at: (was?.requested_at as string | null) ?? now };
  if (!found) {
    const { error } = await db.from("integration_connections").upsert(
      { client_domain_id: c.id, provider, status: was?.status === "connected" ? "connected" : "pending", property: gaId, account_email: ACCESS_EMAIL, ...first, updated_at: now },
      { onConflict: "client_domain_id,provider" },
    );
    if (error) console.warn(`[connect] could not record a check: ${error.message}`);
    return Response.json({ ok: true, connected: false, message: "Not visible yet: it can take a few minutes.", hint: HINT[provider] });
  }
  const { error } = await db.from("integration_connections").upsert(
    { client_domain_id: c.id, provider, status: "connected", property: found, account_email: ACCESS_EMAIL, ...first, connected_by: email, connected_at: now, error: null, updated_at: now },
    { onConflict: "client_domain_id,provider" },
  );
  if (error) {
    console.warn(`[connect] could not mark ${c.domain} ${provider} connected: ${error.message}`);
    return Response.json({ ok: false, message: "We found it, but that did not save. Try again in a minute." }, { status: 502 });
  }
  const pull = await pullConnection(db, { client_domain_id: c.id, provider, property: found });
  if (pull) console.warn(`[connect] first pull for ${c.domain}: ${pull}`);
  return Response.json({ ok: true, connected: true, property: found, synced: !pull });
}
