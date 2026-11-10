import "server-only";

import { SUGGEST_LIMITS } from "@/config/contact";
import { viewAs } from "@/lib/dash/access";
import { viewPath } from "@/lib/dash/host";

/**
 * "Suggest a change" on the customer view (Danny, 10 Nov 2026: "just for agency people viewing it as a customer so
 * Kev can suggest changes"). Only a view-as link reaches it: the hub mints those for agency staff alone (alwayscited-
 * admin view_as: is_agency and a @nomadadigital.co.uk login), and viewAs checks the token here, live and unrevoked,
 * for this client. A customer's own session, a demo link and a stranger are all refused. The suggestion is written
 * by the hub's edge function ac-suggest into the hub's dashboard_suggestions - the table every hub page's button
 * writes - under the staff email the token was minted for. alwayscited proves itself to ac-suggest with its own
 * service key, which the hub already holds (AC_SERVICE_KEY); no hub key is held here or reaches a browser.
 */
export const HUB_SUGGEST = "https://qpsrvmnmtozvailsyqqz.supabase.co/functions/v1/ac-suggest";

export type SuggestIn = { path: string; note: string; section: string | null; url: string | null };

/** The posted body, or null. `path` is the page's own pathname, which carries the view-as token. */
export function readSuggest(b: unknown): SuggestIn | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const note = s(o.note, SUGGEST_LIMITS.note);
  const path = s(o.path, 600);
  if (note.length < 3 || !path) return null;
  return { path, note, section: s(o.section, 60) || null, url: s(o.url, 600) || null };
}

export async function suggest(slug: string, p: SuggestIn, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const view = viewPath(p.path);
  if (!view || view.slug !== slug) return { ok: false, status: 403, message: "Suggestions are for agency staff viewing as the customer." };
  const v = await viewAs(view.token, slug);
  if (!v) return { ok: false, status: 403, message: "This view-as link has ended. Open the customer view from the hub again." };
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { ok: false, status: 503, message: "Not connected to the hub." };
  const res = await fetchImpl(HUB_SUGGEST, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ac-key": key },
    body: JSON.stringify({ by: v.by, slug, section: p.section, url: p.url?.replace(/\/view\/[0-9a-f]{64}\//, "/view/<token>/") ?? null, note: p.note }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
  if (typeof res === "string") return { ok: false, status: 502, message: `Not sent: ${res}` };
  if (!res.ok) {
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    console.error(`[suggest] ${slug}: the hub answered ${res.status} ${out.error ?? ""}`);
    return { ok: false, status: 502, message: "Not sent: the hub did not take it. Try again." };
  }
  return { ok: true };
}
