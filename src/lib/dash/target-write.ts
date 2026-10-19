import type { SupabaseClient } from "@supabase/supabase-js";

import { insertKeyPage, readKeyPages, removeKeyPage, setKeyPageClusters } from "../diy/pages/key-pages.ts";
import { CONTACT_EMAIL } from "../../config/contact.ts";
import { urlKey } from "../tracking/placements.ts";

import { TARGET_BAD, refuseTargetUrl } from "./target.ts";

/**
 * Choose a cluster's target page (18 Oct 2026 brief 2b): the one page the
 * cluster is meant to rank and be cited with, and the page every placement
 * for it links to. It is held as target.ts reads it - a live key_pages row
 * with origin `member` whose cluster_ids list the cluster - so one choice is
 * one row:
 *
 * - the cluster leaves every other member page's cluster_ids (one target each);
 * - a page already live as a key page becomes the member's (origin `member`)
 *   and gains the cluster, keeping any clusters it had;
 * - a new page is added as a member page, giving way to the oldest automatic
 *   page at the 10-page limit, as Your pages does (key-pages.ts memberAdd).
 *
 * Refusals are words for the page; a failed write throws. 19 Oct 2026: the
 * full-list refusal sent the customer to "Your pages", a /app screen the
 * dashboards host does not draw; it now says what they can do instead.
 */
export type TargetResult = { ok: true; id: string; url: string } | { ok: false; message: string };

export async function setClusterTarget(db: SupabaseClient, client: { id: string; domain: string }, clusterId: string, rawUrl: string, p: { by: string; today: string }): Promise<TargetResult> {
  const url = rawUrl.trim();
  const refused = refuseTargetUrl(url, client.domain) ?? (urlKey(url) ? null : TARGET_BAD);
  if (refused) return { ok: false, message: refused };
  const key = urlKey(url)!;
  const rows = (await readKeyPages(db, client.id)).filter((r) => r.removedOn === null);

  for (const r of rows) {
    if (r.origin === "member" && r.urlKey !== key && r.clusterIds.includes(clusterId)) {
      await setKeyPageClusters(db, client.id, r.id, r.clusterIds.filter((c) => c !== clusterId));
    }
  }

  const here = rows.find((r) => r.urlKey === key);
  if (here) {
    const clusterIds = [...new Set([...here.clusterIds, clusterId])].sort();
    const { error } = await db.from("key_pages").update({ origin: "member", cluster_ids: clusterIds }).eq("client_domain_id", client.id).eq("id", here.id);
    if (error) throw new Error(`could not set the target page: ${error.message}`);
    return { ok: true, id: here.id, url: here.url };
  }

  const auto = rows.filter((r) => r.origin !== "member" && r.origin !== "homepage").sort((a, b) => (a.addedOn < b.addedOn ? -1 : a.addedOn > b.addedOn ? 1 : 0));
  if (rows.length >= 10) {
    if (!auto.length) return { ok: false, message: `Your 10 key pages are all ones you chose. Use one of them as this cluster's target page, or email ${CONTACT_EMAIL} and we free one.` };
    await removeKeyPage(db, client.id, auto[0]!.id, p);
  }
  const put = await insertKeyPage(db, client.id, { url, urlKey: key, origin: "member", clusterIds: [clusterId], by: p.by, today: p.today });
  if (put === "refused") return { ok: false, message: TARGET_BAD };
  const added = (await readKeyPages(db, client.id)).find((r) => r.removedOn === null && r.urlKey === key);
  if (!added) throw new Error("the target page was added and not found");
  if (put === "duplicate" && !added.clusterIds.includes(clusterId)) await setKeyPageClusters(db, client.id, added.id, [...added.clusterIds, clusterId].sort());
  return { ok: true, id: added.id, url: added.url };
}
