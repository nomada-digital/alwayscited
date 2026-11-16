import "server-only";

import { dashEmail, viewAs } from "@/lib/dash/access";
import { viewPath } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { refuseRole } from "@/lib/tracking/stop";

/**
 * Who may connect Search Console for a client (15-16 Nov 2026): an owner or editor in their own session, or Nomada
 * staff on a live view-as link for that client (`path`, the page's own pathname, checked as suggest.ts checks it) -
 * which is how staff connect it on a client's behalf from the agency view. A demo link, a viewer and a stranger are refused.
 */
export type Who = { id: string; domain: string; by: string; staff: boolean };

export async function googleWho(slug: string, path: string): Promise<Who | { status: number; message: string }> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return { status: 404, message: "Not found." };
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
