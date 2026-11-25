"use server";

import { revalidatePath } from "next/cache";

import { refuseUnlessAdmin } from "@/app/admin/admin-auth";
import { deliverableAction } from "@/lib/deliverables/agency";
import { DELIVERABLE_LIMITS } from "@/config/contact";
import { isStaff } from "@/lib/deliverables/store";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * /admin/deliverables' writes (25 Nov 2026): the same deliverableAction the hub route runs, so the form and the API
 * cannot disagree. Like every admin action it checks the Basic auth itself (a server action answers on any path), and
 * the "Acting as" address must be a staff one: it is what the trail records.
 */
export type AdminResult = { ok: boolean; message: string };

/** What a form fixes before anyone types: which action, who is acting, and the customer and deliverable it is about. */
export type Fixed = { action: string; by: string; slug?: string; id?: string; expect?: number };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** The files of a form: the uploaded ones, as {filename, body}; or an error. Pasted Markdown goes through deliverableAction's `markdown`. */
async function uploads(form: FormData): Promise<{ filename: string; body: string }[] | string> {
  const out: { filename: string; body: string }[] = [];
  for (const f of form.getAll("files")) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > DELIVERABLE_LIMITS.fileBody) return `${f.name} is over ${Math.round(DELIVERABLE_LIMITS.fileBody / 1000)}KB.`;
    out.push({ filename: f.name, body: await f.text() });
  }
  return out;
}

export async function deliverableForm(fixed: Fixed, _prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  const refused = await refuseUnlessAdmin();
  if (refused) return refused;
  const action = fixed.action;
  const by = String(fixed.by ?? "").trim().toLowerCase();
  if (by.length > DELIVERABLE_LIMITS.by || !isStaff(by)) return { ok: false, message: "Acting as: a Nomada email address, so the trail says who did it." };
  const slug = (text(form, "slug") || fixed.slug || "").toLowerCase();
  if (slug.length > DELIVERABLE_LIMITS.slug || !/^[a-z0-9-]+$/.test(slug)) return { ok: false, message: "Name the customer by its slug, for example mortalentboutique-com." };
  const db = supabaseAdmin();
  const { data: client, error } = await db.from("client_domains").select("id, slug, domain").eq("slug", slug).maybeSingle();
  if (error) return { ok: false, message: `Could not read the customer: ${error.message}` };
  if (!client) return { ok: false, message: `No customer has the slug ${slug}.` };
  const files = await uploads(form);
  if (typeof files === "string") return { ok: false, message: files };
  const body: Record<string, unknown> = {
    id: fixed.id,
    delivered_by: text(form, "delivered_by"),
    title: text(form, "title") || undefined,
    findings: String(form.get("findings") ?? "") || undefined,
    evidence_url: text(form, "evidence_url") || undefined,
    note: text(form, "note") || undefined,
    reason: text(form, "reason") || undefined,
    expect: fixed.expect,
    ...(files.length ? { files } : { markdown: String(form.get("markdown") ?? "").trim() ? String(form.get("markdown")) : undefined, filename: text(form, "filename").slice(0, DELIVERABLE_LIMITS.filename) || undefined }),
  };
  const r = await deliverableAction(db, client as { id: string; slug: string; domain: string }, by, action, body);
  revalidatePath("/admin/deliverables");
  return { ok: r.ok, message: r.message };
}
