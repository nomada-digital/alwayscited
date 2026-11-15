import { dashEmail, viewAs } from "@/lib/dash/access";
import { GOOGLE_ACCESS_EMAIL, type GoogleProvider, canSubmit, pickable, sitemapFor } from "@/lib/dash/google";
import { hubGoogle, listFor, pullGoogle } from "@/lib/dash/google-io";
import { viewPath } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { refuseRole } from "@/lib/tracking/stop";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Search Console and GA4, connected direct (15 Nov 2026, lib/dash/google.ts). POST {op, provider, ...}:
 *
 *   list                  the properties the hub's service account can see for this client's domain
 *   pick   {property}     connect one of them; the 16-month first pull runs after the answer
 *   sitemaps / submit / inspect {url}   staff only: Search Console's sitemaps, a sitemap submit (Full user only) and
 *                         URL Inspection for a key page
 *
 * Who may: an owner or editor of the client in their own session, for list and pick; agency staff on a live view-as
 * link (`path`, checked as suggest.ts checks it) for everything. A demo link, a viewer and a stranger are refused.
 */
type Who = { id: string; domain: string; by: string; staff: boolean };

async function who(slug: string, path: string): Promise<Who | { status: number; message: string }> {
  const view = viewPath(path);
  if (view) {
    if (view.slug !== slug) return { status: 403, message: "Not found." };
    const v = await viewAs(view.token, slug);
    if (!v) return { status: 403, message: "This view-as link has ended. Open the customer view from the hub again." };
    const { data, error } = await supabaseAdmin().from("client_domains").select("id, domain").eq("slug", slug).maybeSingle();
    if (error || !data) return { status: 404, message: "Not found." };
    return { id: data.id as string, domain: data.domain as string, by: v.by, staff: true };
  }
  const email = await dashEmail();
  if (!email) return { status: 401, message: "Your session has ended. Sign in again." };
  const c = (await clientsFor(email).catch(() => null))?.find((x) => x.slug === slug);
  if (!c) return { status: 404, message: "Not found." };
  const role = refuseRole(c.status === "ended" ? "viewer" : c.role);
  if (role) return { status: 403, message: "An owner or editor can connect this." };
  return { id: c.id, domain: c.domain, by: email, staff: false };
}

const NOT_YET: Record<GoogleProvider, string> = {
  gsc: `We can't see a Search Console property for your site yet. Check that ${GOOGLE_ACCESS_EMAIL} is under Settings, Users and permissions, on the property for your domain. It can take a few minutes to show.`,
  ga4: `We can't see a GA4 property for your site yet. Check that ${GOOGLE_ACCESS_EMAIL} has the Viewer role under Admin, Property access management. It can take a few minutes to show.`,
};

export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = typeof b?.op === "string" ? b.op : "";
  const provider = (["gsc", "ga4"] as const).find((p) => p === b?.provider);
  if (!provider) return Response.json({ ok: false, message: "Pick Search Console or GA4." }, { status: 400 });
  const w = await who(slug, typeof b?.path === "string" ? b.path.slice(0, 600) : "");
  if ("status" in w) return Response.json({ ok: false, message: w.message }, { status: w.status });
  const db = supabaseAdmin();

  if (op === "list") {
    const { listed, error } = await listFor(provider, w.domain);
    if (error) {
      console.warn(`[google] list ${w.domain} ${provider}: ${error}`);
      return Response.json({ ok: false, message: /PERMISSION_DENIED|not been used|disabled/i.test(error) ? "Google isn't answering us just yet. Try again in a few minutes." : "We couldn't check just now. Try again in a minute." }, { status: 502 });
    }
    if (!listed.length) return Response.json({ ok: true, listed: [], message: NOT_YET[provider] });
    return Response.json({ ok: true, listed });
  }

  if (op === "pick") {
    const property = typeof b?.property === "string" ? b.property.slice(0, 300) : "";
    // Listed again, never trusted from the browser: a property is only connected if the service account sees it for this domain.
    const { listed, error } = await listFor(provider, w.domain);
    if (error || !pickable(provider, property, listed)) return Response.json({ ok: false, message: "That property isn't one we can see for your site. Press Check connection again." }, { status: 400 });
    const hit = listed.find((p) => p.id === property)!;
    const now = new Date().toISOString();
    const { error: upErr } = await db.from("integration_connections").upsert(
      { client_domain_id: w.id, provider, status: "connected", property, property_name: hit.name, permission: hit.permission, via: "google", account_email: GOOGLE_ACCESS_EMAIL, connected_by: w.by, connected_at: now, requested_by: w.by, requested_at: now, error: null, backfilled_at: null, updated_at: now },
      { onConflict: "client_domain_id,provider" },
    );
    if (upErr) {
      console.warn(`[google] could not save ${w.domain} ${provider}: ${upErr.message}`);
      return Response.json({ ok: false, message: "We found it, but that did not save. Try again in a minute." }, { status: 502 });
    }
    // The 16-month first pull is long; it runs after the answer, and the morning run retries anything it missed.
    after(async () => {
      const e = await pullGoogle(db, { client_domain_id: w.id, provider, property, backfilled_at: null }).catch((err: unknown) => String(err));
      if (e) console.warn(`[google] first pull ${w.domain} ${provider}: ${e}`);
    });
    return Response.json({ ok: true, connected: true, property, name: hit.name, permission: hit.permission });
  }

  // The indexing helpers, staff only at first (Danny, 15 Nov 2026).
  if (!w.staff) return Response.json({ ok: false, message: "Not available yet." }, { status: 403 });
  if (provider !== "gsc") return Response.json({ ok: false, message: "Search Console only." }, { status: 400 });
  const { data: conn, error: connErr } = await db.from("integration_connections").select("property, via, permission").eq("client_domain_id", w.id).eq("provider", "gsc").maybeSingle();
  if (connErr) return Response.json({ ok: false, message: `Could not read the connection: ${connErr.message}` }, { status: 502 });
  const site = (conn as { property?: string; via?: string } | null)?.via === "google" ? ((conn as { property?: string }).property ?? "") : "";
  if (!site) return Response.json({ ok: false, message: "Connect Search Console first." }, { status: 400 });

  if (op === "sitemaps") {
    const a = await hubGoogle("gsc_sitemaps", { site });
    return a.error ? Response.json({ ok: false, message: a.error }) : Response.json({ ok: true, sitemaps: a.sitemaps, suggested: sitemapFor(site) });
  }
  if (op === "submit") {
    const permission = (conn as { permission?: string | null }).permission ?? null;
    if (!canSubmit(permission)) return Response.json({ ok: false, message: "Submitting a sitemap needs Full permission. Ask the customer to change our access to Full in Search Console, Users and permissions." });
    const feedpath = typeof b?.feedpath === "string" && /^https?:\/\//.test(b.feedpath) ? b.feedpath.slice(0, 500) : sitemapFor(site);
    const a = await hubGoogle("gsc_submit", { site, feedpath });
    return a.error ? Response.json({ ok: false, message: /403|PERMISSION/i.test(a.error) ? "Google refused: our access is below Full on this property." : a.error }) : Response.json({ ok: true, message: `Submitted ${feedpath}.` });
  }
  if (op === "inspect") {
    const url = typeof b?.url === "string" && /^https?:\/\//.test(b.url) ? b.url.slice(0, 600) : "";
    if (!url) return Response.json({ ok: false, message: "Which page?" }, { status: 400 });
    const a = await hubGoogle("gsc_inspect", { site, url });
    if (a.error) return Response.json({ ok: false, message: a.error });
    const row = { client_domain_id: w.id, url, verdict: a.verdict ?? null, coverage: a.coverage ?? null, last_crawl: a.lastCrawl ?? null, inspected_at: new Date().toISOString() };
    const { error } = await db.from("gsc_inspections").upsert(row, { onConflict: "client_domain_id,url" });
    if (error) console.warn(`[google] inspection not stored: ${error.message}`);
    return Response.json({ ok: true, ...row });
  }
  return Response.json({ ok: false, message: "Unknown request." }, { status: 400 });
}
