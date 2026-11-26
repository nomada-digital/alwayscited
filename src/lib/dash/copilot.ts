import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Copilot citations (26 Nov 2026): how often Microsoft Copilot cites the site, from Bing Webmaster Tools > AI Performance.
 * The numbers and their definitions are the hub's (generators/bing_ai_export.py): citations over the 28 days to the last reading,
 * the change against the 28 before (only when readings reach back that far), a daily line, and the pages cited in the latest export.
 * Bing = search + Copilot, so this is kept apart from the chat engines (we never ask Copilot our prompts).
 */
export type CopilotView = {
  asOf: string;
  firstDay: string | null;
  total: number;
  pct: number | null;
  days: { day: string; c: number }[];
  pages: { from: string; to: string; n: number; top: { page: string; c: number }[] } | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** The snapshot as stored, or null when it has nothing to show. Never throws on a malformed row. */
export function copilotView(snapshot: unknown): CopilotView | null {
  const s = snapshot as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return null;
  const asOf = day(s.asOf);
  if (!asOf) return null;
  const days = (Array.isArray(s.days) ? s.days : []).flatMap((r) => {
    const a = r as unknown[];
    return Array.isArray(a) && day(a[0]) && num(a[1]) !== null ? [{ day: day(a[0])!, c: num(a[1])! }] : [];
  });
  const p = s.pages as Record<string, unknown> | null | undefined;
  const top = p && Array.isArray(p.top) ? p.top.flatMap((r) => { const a = r as unknown[]; return Array.isArray(a) && typeof a[0] === "string" && num(a[1]) !== null ? [{ page: a[0] as string, c: num(a[1])! }] : []; }) : [];
  const pages = p && day(p.from) && day(p.to) && top.length ? { from: day(p.from)!, to: day(p.to)!, n: num(p.n) ?? top.length, top } : null;
  const total = num(s.total) ?? 0;
  if (total <= 0 && !pages) return null;
  return { asOf, firstDay: day(s.firstDay), total, pct: num(s.pct), days, pages };
}

/** One client's Copilot snapshot. A missing table or row is "no data yet"; any other failure throws, so it is never shown as empty. */
export async function readCopilot(db: SupabaseClient, clientId: string): Promise<CopilotView | null> {
  const { data, error } = await db.from("client_copilot").select("snapshot").eq("client_domain_id", clientId).maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return null;
    throw new Error(`could not read Copilot: ${error.message}`);
  }
  return copilotView(data?.snapshot);
}
