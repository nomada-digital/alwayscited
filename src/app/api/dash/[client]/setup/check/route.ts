import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath } from "@/lib/dash/fixture";
import { ONE_SEARCH, rankOfPage, topOverlap } from "@/lib/dash/setup";
import { readKeywordPosition, readKeywordVolumes } from "@/lib/scan/dataforseo";
import { isMarket } from "@/lib/scan/domain";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkClusterKeyword } from "@/lib/tracking/check-keyword";
import { trackingDay } from "@/lib/tracking/decide";
import { clientsFor, writeRole } from "@/lib/tracking/member";
import { otherForm } from "@/lib/tracking/plural";
import { refuseRole } from "@/lib/tracking/stop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup's keyword step on the dashboards host (18 Oct 2026 brief 2b / 2c).
 * JSON in `{ keyword, url? }`, JSON out:
 * - the keyword check /app's setup ran (check-keyword.ts: volume, intent,
 *   verdict, and its cap of CHECKS_PER_CLIENT_PER_DAY a day, counted before
 *   any paid read);
 * - the keyword's other form and its volume, for "Also target ..., no extra
 *   charge", with Google's top 10 for both compared (above 70% the same pages,
 *   one page may rank for both);
 * - where the client ranks for it now and with which page, and where the page
 *   it is choosing as target ranks, so the target step can say a better page
 *   of theirs ranks.
 * Owners and editors of this client only. The two position reads and the
 * pair's volume run only after a passing check, inside the same cap.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  if (dashFixturePath()) return Response.json({ ok: false, message: "Keyword checks are off on the local snapshot." }, { status: 503 });
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { keyword?: unknown; url?: unknown } | null;
  const keyword = typeof body?.keyword === "string" ? body.keyword.slice(0, 200) : "";
  const url = typeof body?.url === "string" ? body.url.slice(0, 500) : null;
  const clients = await clientsFor(email).catch(() => null);
  if (!clients) return Response.json({ ok: false, message: "Could not read your access. Try again." }, { status: 502 });
  const c = clients.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  if (refuseRole(writeRole(c))) return Response.json({ ok: false, message: "Viewers cannot change setup." }, { status: 403 });
  const market = isMarket(c.market) ? c.market : "US";
  const db = supabaseAdmin();

  const { data: tracked } = await db.from("tracked_keywords").select("keyword").eq("client_domain_id", c.id).is("stopped_on", null);
  // The keyword being set up is this cluster's own: re-checking it is not "already tracked".
  const others = (tracked ?? []).map((r) => r.keyword as string).filter((k) => k.trim().toLowerCase() !== keyword.trim().toLowerCase());
  const check = await checkClusterKeyword(db, { clientId: c.id, email, keyword, market, tracked: others, brands: [c.brand ?? "", c.domain].filter(Boolean), today: trackingDay() });
  if (!check.ok) return Response.json({ ok: true, check });

  const other = otherForm(check.keyword);
  try {
    const [main, pairVol, pairPos] = await Promise.all([
      readKeywordPosition(check.keyword, c.domain, market, 20_000),
      other ? readKeywordVolumes([other.keyword], market, 20_000) : Promise.resolve(null),
      other ? readKeywordPosition(other.keyword, c.domain, market, 20_000) : Promise.resolve(null),
    ]);
    const overlap = pairPos ? topOverlap(main.top, pairPos.top) : null;
    return Response.json({
      ok: true,
      check,
      pair: other ? { keyword: other.keyword, form: other.form, volume: pairVol?.volumes.get(other.keyword) ?? pairVol?.volumes.get(other.keyword.toLowerCase()) ?? null, rank: pairPos?.rank ?? null, oneSearch: overlap !== null && overlap > ONE_SEARCH } : null,
      rank: typeof main.rank === "number" ? main.rank : null,
      rankingUrl: main.url,
      urlRank: url ? rankOfPage(main.top, url) : null,
    });
  } catch (err) {
    console.warn(`[dash] setup position read failed: ${err instanceof Error ? err.message : String(err)}`);
    return Response.json({ ok: true, check, pair: other ? { keyword: other.keyword, form: other.form, volume: null, rank: null, oneSearch: false } : null, rank: null, rankingUrl: null, urlRank: null });
  }
}
