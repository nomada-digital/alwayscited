import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath } from "@/lib/dash/fixture";
import { fillDifficulty, research } from "@/lib/dash/research";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { clientsFor } from "@/lib/tracking/member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Keyword research for one client (17 Oct 2026, lib/dash/research.ts):
 * `{ seed, kind }` for suggestions or related keywords, or `{ difficulty: true }`
 * to fill in KD for the keywords it tracks. Members of the client only; the
 * spend is capped per client per day and month by the DIY ledger.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  if (dashFixturePath()) return Response.json({ ok: false, message: "Keyword research is not available on a local snapshot." }, { status: 409 });
  const body = (await req.json().catch(() => null)) as { seed?: unknown; kind?: unknown; difficulty?: unknown } | null;
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  if (c.status === "ended") return Response.json({ ok: false, message: "This plan has ended." }, { status: 409 });
  const db = supabaseAdmin();
  const today = trackingDay();
  if (body?.difficulty === true) {
    const { data, error } = await db.from("tracked_keywords").select("keyword").eq("client_domain_id", c.id).is("stopped_on", null);
    if (error) return Response.json({ ok: false, message: "Could not read your keywords. Try again." }, { status: 502 });
    const r = await fillDifficulty(db, { clientId: c.id, market: c.market, member: email, keywords: (data ?? []).map((k) => String(k.keyword)), today });
    return Response.json(r, { status: r.ok ? 200 : 429 });
  }
  const seed = typeof body?.seed === "string" ? body.seed.slice(0, 200) : "";
  const kind = body?.kind === "related" ? "related" : "suggestions";
  const r = await research(db, { clientId: c.id, market: c.market, member: email, seed, kind, today });
  return Response.json(r, { status: r.ok ? 200 : 429 });
}
