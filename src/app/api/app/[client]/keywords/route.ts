import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { appPath } from "@/lib/app-host";
import { diyFixtureWrites } from "@/lib/diy/core/fixture";
import { dismissalStore, loadFootprint } from "@/lib/diy/keywords/data";
import { readGoogleKept } from "@/lib/diy/keywords/keys";
import { type KeywordsDone, type KeywordsWhy, applyToFixture, decideKeywords, isKeywordsDo, lapseDismissal, writeDismissal } from "@/lib/diy/keywords/write";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";
import { isUsageEvent } from "@/lib/tracking/usage";
import { recordUsage } from "@/lib/tracking/usage-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** No paid read and nothing waits on a vendor: a session read, the stored footprint, one small write (spec 10 section 3.6). */
export const maxDuration = 60;

/**
 * Gaining ground's Dismiss and Restore (13 Oct 2026, DIY P6; spec 10
 * sections 3.6 and 4.3): `do` = dismiss or restore, `keyword` at most 120
 * characters. Posted by plain HTML forms on the Google page, so both work with
 * JS off; the answer is a 303 back to the view the form was posted from
 * (keys.ts readGoogleKept) with `done=` and, on a refusal, `why=` - fixed
 * codes drawn as fixed words (write.ts keywordsToast). Nothing typed is
 * echoed in the URL.
 *
 * The session decides the member, and the slug must be one of their clients
 * or the answer is a 404. Owners and editors write; a viewer, and anyone on
 * an ended client (writeRole), is refused - `why=ended` for the second, so
 * the toast says which. Only a keyword the latest
 * footprint pull holds can be dismissed, and only a live dismissal restored
 * (write.ts decideKeywords), so the only text stored is DataForSEO's own.
 * While diy_enabled is off the page hides gaining ground, and a post that
 * arrives anyway is refused.
 *
 * On the fixture the same rule runs on dismissals held in memory, with
 * TRACKING_FIXTURE_WRITE=1; without it the preview refuses to save.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const keep = readGoogleKept((k) => sp.get(k), APP_LIMITS.search);
  const form = await req.formData().catch(() => null);
  const d = form?.get("do") ?? null;
  if (!isKeywordsDo(d)) return NextResponse.json({ error: "Not a change this page can make." }, { status: 400 });

  const back = (done: KeywordsDone, why: KeywordsWhy | null = null) =>
    NextResponse.redirect(dashUrl(req, appPath(`/${encodeURIComponent(slug)}/google?${new URLSearchParams({ ...keep, gaining: "1", done, ...(why ? { why } : {}) })}#gaining`)), 303);

  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await repo.clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const today = repo.today();
  const now = new Date(repo.now()).toISOString();
  const footprint = await loadFootprint(client.id);
  const latest = footprint.pulls?.ok ? (footprint.pulls.value.latest ? new Set(footprint.pulls.value.latest.rows.map((r) => r.k)) : new Set<string>()) : null;
  const decision = decideKeywords({
    do: d,
    keyword: form?.get("keyword"),
    refused: refuseRole(writeRole(client)),
    ended: client.status === "ended",
    enabled: footprint.enabled,
    latest,
    dismissals: footprint.dismissals?.ok ? footprint.dismissals.value : [],
    today,
  });
  if (decision.op === "refuse") {
    console.warn(`[diy] keywords ${d} refused: ${decision.why}`);
    return back("refused", decision.why);
  }
  const done: KeywordsDone = decision.op === "dismiss" ? "dismissed" : "restored";

  if (fixtureMode()) {
    if (!diyFixtureWrites()) return back("refused", "readonly");
    const store = dismissalStore();
    store.set(applyToFixture(store.get(), decision, { by: email, now }));
    return back(done);
  }

  const db = supabaseAdmin();
  try {
    if (decision.op === "dismiss") await writeDismissal(db, { clientId: client.id, key: decision.key, until: decision.until, by: email, now });
    else await lapseDismissal(db, { clientId: client.id, key: decision.key, until: decision.until });
  } catch (err) {
    console.warn(`[diy] keywords ${d}: ${err instanceof Error ? err.message : String(err)}`);
    return back("refused", "failed");
  }
  // Recorded once the wave 2 shell registers the event (usage.ts USAGE_EVENTS); until then the guard skips it.
  const event: string = "gaining_dismiss";
  if (decision.op === "dismiss" && isUsageEvent(event)) await recordUsage(db, { clientId: client.id, email, event, path: "/google", today });
  return back(done);
}
