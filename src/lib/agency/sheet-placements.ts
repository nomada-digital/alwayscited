import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";
import { chosenTargetRow } from "@/lib/dash/target";
import { urlKey } from "@/lib/tracking/placements";

/**
 * Live placements from Kev's master sheet onto the customer's own Placements (sg-89, 11 Nov 2026: COMMON's three
 * November pieces were live on the sheet and the hub's tracker, and "none yet" here). The hub's morning sheet job
 * (nomada-dashboards pull_sheets.py) sends every live row it matches to this customer; only Find placements' Mark live
 * used to write here, so a placement recorded only on the sheet never arrived, for any customer.
 *
 * One row a page: an item whose address is already a placement here (url_key) is left as it is, so a re-send, or one
 * Find placements already wrote, never doubles. Each goes on the live cluster whose name or keyword is the sheet's
 * target keyword (else the first live cluster), anchored on that keyword, linking to the cluster's target page. The
 * sheet's id (NOM-0130) rides in internal_note. Cost, vendor and DR are never sent here, so nothing to keep out of the
 * customer's view.
 */
export type SheetItem = { pid: string; url: string; live_on: string; keyword: string | null; kind: string | null; outlet: string | null };

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function readItems(raw: unknown): SheetItem[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return raw.slice(0, 500).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const pid = str(o.pid, 20), url = str(o.url, 500);
    if (!/^NOM-\d{4,}$/.test(pid) || !/^https?:\/\//i.test(url) || !isDay(o.live_on)) return [];
    return [{ pid, url, live_on: o.live_on, keyword: str(o.keyword, 200) || null, kind: str(o.kind, 40) || null, outlet: str(o.outlet, 200) || null }];
  });
}

export async function placementsSync(db: SupabaseClient, client: Client, items: SheetItem[], today: string): Promise<Done> {
  if (!items.length) return { ok: true, message: "Nothing to add.", data: { added: [], kept: [], skipped: [] } };
  const [{ data: cl, error: e1 }, { data: kw, error: e2 }, { data: pages, error: e3 }, { data: have, error: e4 }] = await Promise.all([
    db.from("tracked_clusters").select("id, name, keyword_id").eq("client_domain_id", client.id).is("stopped_on", null).is("superseded_by", null).order("created_at", { ascending: true }),
    db.from("tracked_keywords").select("id, keyword, cluster_id").eq("client_domain_id", client.id).is("stopped_on", null),
    db.from("key_pages").select("id, url, origin, cluster_ids, added_on, removed_on").eq("client_domain_id", client.id).is("removed_on", null),
    db.from("placements").select("url_key").eq("client_domain_id", client.id),
  ]);
  const err = e1 ?? e2 ?? e3 ?? e4;
  if (err) return { ok: false, message: `Could not read the customer's placements: ${err.message}` };
  const clusters = (cl ?? []) as { id: string; name: string; keyword_id: string | null }[];
  if (!clusters.length) return { ok: false, message: "The customer has no live cluster to put placements on." };
  const words = (kw ?? []) as { id: string; keyword: string; cluster_id: string | null }[];
  const known = new Set((have ?? []).map((h) => h.url_key as string));
  const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const clusterFor = (k: string | null) =>
    clusters.find((c) => lc(c.name) === lc(k)) ?? clusters.find((c) => words.some((w) => w.cluster_id === c.id && lc(w.keyword) === lc(k))) ?? clusters[0]!;
  const added: string[] = [], kept: string[] = [], skipped: string[] = [];
  for (const it of items) {
    const key = urlKey(it.url);
    if (!key) { skipped.push(`${it.pid}: not a page address`); continue; }
    if (known.has(key)) { kept.push(it.pid); continue; }
    if (it.live_on > today) { skipped.push(`${it.pid}: live date ${it.live_on} is in the future`); continue; }
    const c = clusterFor(it.keyword);
    const target = chosenTargetRow((pages ?? []) as { id: string; url: string; origin: string; cluster_ids: string[] | null; added_on: string; removed_on: string | null }[], c.id);
    const own = c.keyword_id ? words.find((w) => w.id === c.keyword_id) : null;
    const { error } = await db.from("placements").insert({
      client_domain_id: client.id, cluster_id: c.id, kind: /insertion/i.test(it.kind ?? "") ? "link_insertion" : "guest_post",
      url: it.url, url_key: key, domain: key.split("/")[0]!, status: "live", live_on: it.live_on,
      anchor_text: it.keyword ?? own?.keyword ?? null, internal_note: `Kev's master sheet ${it.pid}${it.outlet ? ` (${it.outlet})` : ""}`,
      target_page_id: target?.id ?? null, target_keyword_id: c.keyword_id, created_by: `hub sheet sync (${it.pid})`,
    });
    if (error) { skipped.push(`${it.pid}: ${error.message}`); continue; }
    known.add(key);
    added.push(it.pid);
  }
  if (added.length) await audit(db, client.id, "hub sheet sync", "placements_sync", null, null, { added, kept: kept.length });
  return { ok: true, message: `${added.length} added, ${kept.length} already here${skipped.length ? `, ${skipped.length} skipped` : ""}.`, data: { added, kept, skipped } };
}
