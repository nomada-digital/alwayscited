import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { keywordForm } from "@/lib/scan/dataforseo-request";
import { isMarket } from "@/lib/scan/domain";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { type KeywordCheck, signCheck, verdictQuery } from "@/lib/tracking/add-cluster";
import { checkClusterKeyword } from "@/lib/tracking/check-keyword";
import { MOMENTUM_SRC, momentumOrigin } from "@/lib/tracking/new-cluster";
import { ADMIN_LIMITS, trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureCheck } from "@/lib/tracking/fixture-writes";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { writableFixture } from "@/lib/tracking/repo";
import { readKept, refuseRole } from "@/lib/tracking/stop";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Check keyword" in Add a cluster - BRIEF-3 T6 part 3b (30 Sep 2026). Posted
 * by the plain HTML form in the Add panel; answers with a 303 back to the
 * Clusters page carrying `?add=1&kw=&ck=` (and `vol`, `intent` on a pass),
 * from which the page rebuilds the board's words. A spender: two DataForSEO
 * reads, only after the free prechecks and under CHECKS_PER_CLIENT_PER_DAY
 * (check-keyword.ts). Session and membership as the stop route; viewers are
 * refused; the fixture reads nothing (R168's writable fixture answers a
 * canned pass after the free prechecks).
 *
 * R166 part 5 (2 Oct 2026): a setup card's Check keyword posts here too, with
 * the card's cluster id as `card` and its current keyword as `own`. Its 303
 * goes back to /app/[client]/setup at that card instead, and `own` is left
 * out of the tracked list so a card can check the keyword it already has.
 *
 * 13 Oct 2026, DIY P6 (spec 10 sections 3.5 and 6.6): the Add panel posts a
 * hidden `src` of `gaining` when it was opened from a gaining-ground keyword,
 * and `back()` carries it into the 303 beside `add`, `kw`, the verdict and
 * `sig`, so the panel's second step posts it on and the cluster's prompts get
 * the momentum origin. It is rebuilt from a fixed value, never echoed, and
 * nothing else in the route changes.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const raw = typeof form?.get("keyword") === "string" ? (form.get("keyword") as string).trim().slice(0, ADMIN_LIMITS.question) : "";
  const card = typeof form?.get("card") === "string" ? (form.get("card") as string).slice(0, 64) : "";
  const own = card && typeof form?.get("own") === "string" ? keywordForm((form.get("own") as string).slice(0, ADMIN_LIMITS.question)) : "";
  const notOwn = (t: string) => !own || keywordForm(t) !== own;
  // R179 (2 Oct 2026): a pending cluster's Change keyword on Clusters posts `on=clusters`; its 303 opens that card with `rk`.
  const onClusters = !!card && form?.get("on") === "clusters";
  // Its action carries the page's range, filter and search as the stop forms' do, so the round trip keeps them.
  const sp = new URL(req.url).searchParams;
  // DS15: the Add panel's return keeps it too; only a setup card's does not.
  const view = !card || onClusters ? readKept((k) => sp.get(k), APP_LIMITS.search) : {};
  const src: Record<string, string> = !card && momentumOrigin(form?.get("src")) ? { src: MOMENTUM_SRC } : {};
  const back = (c: KeywordCheck | null, sig?: string) => {
    const q = new URLSearchParams({ ...(onClusters ? { ...view, open: card, rk: card } : card ? { card } : { ...view, add: "1" }), ...(raw ? { kw: raw } : {}), ...(c ? verdictQuery(c) : {}), ...(sig ? { sig } : {}), ...src });
    // R151 (3 Oct 2026): a refusal lands without the #card fragment - a fragment target stops the browser running autofocus, and the refused field scrolls itself into view when it takes focus.
    const at = c?.ok === false ? "" : `#card-${encodeURIComponent(card)}`;
    const to = card && !onClusters ? appPath(`/${encodeURIComponent(slug)}/setup?${q}${at}`) : appPath(`/${encodeURIComponent(slug)}/clusters?${q}`);
    return NextResponse.redirect(dashUrl(req, to), 303);
  };
  if (!raw) return back(null);
  if (fixtureMode()) {
    // R168: the writable fixture runs the free prechecks and answers a canned, fixture-signed pass - no paid read.
    const fx = writableFixture();
    if (!fx) return back({ ok: false, reason: "read_failed", ask: true, message: "" });
    if (refuseRole(fx.member.role)) return NextResponse.json({ error: "Viewers cannot add clusters." }, { status: 403 });
    const c = fixtureCheck(fx, raw, notOwn);
    return back(c.check, c.sig);
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (refuseRole(writeRole(client))) return NextResponse.json({ error: "Viewers cannot add clusters." }, { status: 403 });

  const db = supabaseAdmin();
  const { data: kws, error } = await db.from("tracked_keywords").select("keyword").eq("client_domain_id", client.id).is("stopped_on", null);
  if (error) {
    console.warn(`[app] keyword check could not read tracked keywords: ${error.message}`);
    return back({ ok: false, reason: "read_failed", ask: true, message: "" });
  }
  const r = await checkClusterKeyword(db, {
    clientId: client.id,
    email,
    keyword: raw,
    market: isMarket(client.market) ? client.market : "US",
    tracked: (kws ?? []).map((k) => k.keyword as string).filter(notOwn),
    brands: [client.brand ?? "", client.domain],
    today: trackingDay(),
  });
  // A pass is signed so the save can trust it without reading again (add-cluster.ts signCheck).
  const secret = process.env.CRON_SECRET ?? "";
  return back(r, r.ok && secret ? signCheck({ clientId: client.id, keyword: r.keyword, volume: r.volume, intent: r.intent, day: trackingDay() }, secret) : undefined);
}
