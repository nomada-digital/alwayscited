import type { SupabaseClient } from "@supabase/supabase-js";

import { chosenTargetRow } from "@/lib/dash/target";

import { missingColumn } from "./limits";
import type { CountedPlacement, FormKeyword } from "./placement-target";

/**
 * A cluster's aim, read for the placement editor and its writers (18 Oct 2026
 * brief, 2b / 2c): its target page (the chosen key page, dash/target.ts), its
 * keyword forms (the cluster keyword and its plural or singular), and the
 * placements already counted against those forms.
 *
 * Every read tolerates 20261018030000 not being applied yet: no `form` column
 * means the cluster keyword alone, no `target_keyword_id` means no split yet.
 */
export type ClusterAim = { target: { id: string; url: string } | null; forms: FormKeyword[]; placements: CountedPlacement[] };

export async function readClusterAim(db: SupabaseClient, clientId: string, clusterId: string): Promise<ClusterAim | string> {
  const [{ data: cluster, error: cErr }, { data: pages, error: pErr }] = await Promise.all([
    db.from("tracked_clusters").select("keyword_id").eq("id", clusterId).eq("client_domain_id", clientId).maybeSingle(),
    db.from("key_pages").select("id, url, origin, cluster_ids, added_on, removed_on").eq("client_domain_id", clientId).is("removed_on", null),
  ]);
  if (cErr) return `Could not read the cluster: ${cErr.message}`;
  if (pErr) return `Could not read the key pages: ${pErr.message}`;
  const row = chosenTargetRow((pages ?? []) as { id: string; url: string; origin: string; cluster_ids: string[] | null; added_on: string; removed_on: string | null }[], clusterId);
  const target = row ? { id: row.id, url: row.url } : null;

  const forms: FormKeyword[] = [];
  const primaryId = (cluster?.keyword_id as string | null) ?? null;
  if (primaryId) {
    const { data: withForms, error: fErr } = await db.from("tracked_keywords").select("id, keyword, form, stopped_on").eq("client_domain_id", clientId).or(`id.eq.${primaryId},pair_of.eq.${primaryId}`).is("stopped_on", null);
    if (fErr && !missingColumn(fErr)) return `Could not read the cluster keyword: ${fErr.message}`;
    let rows: { id: string; keyword: string; form?: string }[] = withForms ?? [];
    if (fErr) {
      const { data: head, error: hErr } = await db.from("tracked_keywords").select("id, keyword, stopped_on").eq("client_domain_id", clientId).eq("id", primaryId).is("stopped_on", null);
      if (hErr) return `Could not read the cluster keyword: ${hErr.message}`;
      rows = head ?? [];
    }
    for (const k of rows as { id: string; keyword: string; form?: string }[]) forms.push({ id: k.id, keyword: k.keyword, form: (k.form as FormKeyword["form"]) ?? "primary" });
    forms.sort((a, b) => (a.form === "primary" ? -1 : b.form === "primary" ? 1 : 0));
  }

  const { data: placed, error: plErr } = await db.from("placements").select("target_keyword_id, status").eq("client_domain_id", clientId).eq("cluster_id", clusterId);
  if (plErr && !missingColumn(plErr)) return `Could not read the cluster's placements: ${plErr.message}`;
  return { target, forms, placements: plErr ? [] : ((placed ?? []) as CountedPlacement[]) };
}
