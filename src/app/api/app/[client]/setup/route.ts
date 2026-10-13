import { NextResponse } from "next/server";

import { enqueueOnboarding } from "@/lib/diy/core/dispatch";
import { JOB_HANDLERS } from "@/lib/diy/wiring";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCheck } from "@/lib/tracking/add-cluster";
import { ADMIN_LIMITS, trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureWrites } from "@/lib/tracking/fixture-writes";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { confirmFixtureSetup, trackingRepo } from "@/lib/tracking/repo";
import { loadSetupConfirmed } from "@/lib/tracking/setup-data";
import { SETUP_CONFIRMED_EVENT, setupPath } from "@/lib/tracking/setup-landing";
import { mailSetupConfirmed, sendSetupConfirmed } from "@/lib/tracking/setup-mail";
import { refuseRole } from "@/lib/tracking/stop";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 3 of /app/[client]/setup, "Confirm" (R166 part 3b, Danny, danny.md
 * line 175). Writes the one dashboard_events row named setup_confirmed and
 * answers with a 303 to the client's Overview. Once only: a client already
 * confirmed writes nothing more. Session and membership as the stop route;
 * viewers are refused; the fixture writes nothing unless
 * TRACKING_FIXTURE_WRITE=1 (R168) holds the confirm in memory. Step 4: the
 * internal mail to us (setup-mail.ts) goes once, after the row is written;
 * the fixture never sends.
 *
 * R166 part 5 (2 Oct 2026): a setup card whose Check keyword passed carries
 * that pass into Confirm as hidden fields. It reaches the mail only when its
 * signature verifies for this client and today, and only if the card is one
 * of this client's clusters; nothing is written to the cluster.
 *
 * 13 Oct 2026, DIY P6 (spec 10 sections 4.12 and 5.7): once the row is
 * written, the confirm also queues the client's onboarding jobs for the next
 * night pass (P1's enqueueOnboarding, over the registered JOB_HANDLERS): the
 * free kinds always, the paid ones - the Google footprint among them - only
 * while diy_enabled is on. In its own try: a queue that cannot be written is
 * logged and the confirm stands, and the night's dispatch queues onboarding
 * anyway on its first pass after the confirm (jobs.ts dueFor).
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const field = (k: string) => (typeof form?.get(k) === "string" ? (form.get(k) as string).slice(0, ADMIN_LIMITS.question) : "");
  const done = NextResponse.redirect(dashUrl(req, appPath(`/${encodeURIComponent(slug)}?setup=confirmed`)), 303);
  // R151 (3 Oct 2026): #confirm lands the page at step 3, where the refusal is said - from the top it sat a screen or more below the fold.
  const failed = NextResponse.redirect(dashUrl(req, `${setupPath(encodeURIComponent(slug))}?confirm=failed#confirm`), 303);
  if (fixtureMode()) {
    // R168: with TRACKING_FIXTURE_WRITE=1 the confirm is held in memory, and a viewer is refused as below.
    if (fixtureWrites()) {
      const repo = trackingRepo();
      const me = await repo.sessionEmail();
      const role = me ? (await repo.clientsFor(me)).find((c) => c.slug === slug)?.role : undefined;
      if (refuseRole(role ?? "")) return NextResponse.json({ error: "Viewers cannot confirm setup." }, { status: 403 });
      confirmFixtureSetup();
    }
    return done;
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (refuseRole(writeRole(client))) return NextResponse.json({ error: "Viewers cannot confirm setup." }, { status: 403 });

  const already = await loadSetupConfirmed(client.id);
  if (already === null) return failed;
  if (already) return done;
  const { error } = await supabaseAdmin()
    .from("dashboard_events")
    .insert({ client_domain_id: client.id, member_email: email, event: SETUP_CONFIRMED_EVENT, path: "/setup" });
  if (error) {
    console.warn(`[app] could not confirm setup: ${error.message}`);
    return failed;
  }
  // Part 5: a checked keyword is named only when its pass verifies and its card is this client's cluster.
  const pass = { clientId: client.id, keyword: field("keyword"), volume: Number(field("vol")), intent: field("intent"), day: trackingDay() };
  const card = field("card");
  const checked =
    card && verifyCheck(pass, field("sig") || null, process.env.CRON_SECRET ?? "") ? await clusterName(client.id, card) : null;
  // Step 4: once a client - only after the one row is written, never on a repeat.
  await sendSetupConfirmed({
    domain: client.domain,
    slug: client.slug,
    tier: client.tier,
    member: email,
    checked: checked ? { cluster: checked, keyword: pass.keyword, volume: pass.volume, intent: pass.intent } : null,
  });
  // R159: the client's own setup_confirmed lifecycle mail, to the member who confirmed, once, behind its flag.
  await mailSetupConfirmed(client.id, email);
  try {
    await enqueueOnboarding(supabaseAdmin(), client.id, { handlers: JOB_HANDLERS });
  } catch (err) {
    console.warn(`[diy] onboarding not queued at confirm (the night pass queues it): ${err instanceof Error ? err.message : String(err)}`);
  }
  return done;
}

/** The cluster's name when the card is one of this client's clusters; null otherwise or on a failed read. */
async function clusterName(clientId: string, id: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from("tracked_clusters").select("name").eq("client_domain_id", clientId).eq("id", id).maybeSingle();
  return error || !data ? null : (data.name as string);
}
