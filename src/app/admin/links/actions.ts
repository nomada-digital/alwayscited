"use server";

import { revalidatePath } from "next/cache";

import { refuseUnlessAdmin } from "@/app/admin/admin-auth";
import { LINK_LIMITS } from "@/config/contact";
import { linkAction } from "@/lib/links/agency";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * /admin/links' writes (25 Nov 2026): the same linkAction the hub route runs, so the form and the API cannot
 * disagree. Like every admin action it checks the Basic auth itself (a server action answers on any path), and the
 * "Acting as" address must be a staff one: it is what agency_edits records.
 */
export type AdminResult = { ok: boolean; message: string };
export type Fixed = { action: "links_set" | "links_check"; by: string; slug: string; source: string; kind: string; key: string; status?: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function linkForm(fixed: Fixed, _prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const by = String(fixed.by ?? "").trim().toLowerCase();
  if (by.length > LINK_LIMITS.by || !/^[^@\s]+@nomadadigital\.co\.uk$/.test(by)) return { ok: false, message: "Acting as: a Nomada email address, so the trail says who did it." };
  if (fixed.slug.length > LINK_LIMITS.slug || !/^[a-z0-9-]+$/.test(fixed.slug)) return { ok: false, message: "That is not a customer slug." };
  const db = supabaseAdmin();
  const { data: client, error } = await db.from("client_domains").select("id, slug, domain").eq("slug", fixed.slug).maybeSingle();
  if (error) return { ok: false, message: `Could not read the customer: ${error.message}` };
  if (!client) return { ok: false, message: `No customer has the slug ${fixed.slug}.` };
  const day = text(form, "live_on").slice(0, LINK_LIMITS.day);
  const r = await linkAction(db, client as { id: string; slug: string; domain: string }, by, fixed.action, {
    source: fixed.source,
    kind: fixed.kind,
    key: fixed.key,
    status: fixed.status ?? text(form, "status"),
    live_url: text(form, "live_url") || undefined,
    anchor_text: text(form, "anchor_text") || undefined,
    live_on: day || undefined,
    note: text(form, "note") || undefined,
    check: text(form, "check") === "no" ? false : undefined,
  });
  revalidatePath("/admin/links");
  return { ok: r.ok, message: r.message };
}
