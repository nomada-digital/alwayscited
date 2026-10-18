import { dashEmail, dashRaw } from "@/lib/dash/access";
import { dashFixturePath } from "@/lib/dash/fixture";
import { setupClusters, setupGaps } from "@/lib/dash/setup";
import { enqueueOnboarding } from "@/lib/diy/core/dispatch";
import { JOB_HANDLERS } from "@/lib/diy/wiring";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor, writeRole } from "@/lib/tracking/member";
import { loadSetupConfirmed } from "@/lib/tracking/setup-data";
import { SETUP_CONFIRMED_EVENT } from "@/lib/tracking/setup-landing";
import { mailSetupConfirmed, sendSetupConfirmed } from "@/lib/tracking/setup-mail";
import { refuseRole } from "@/lib/tracking/stop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup's Confirm on the dashboards host (18 Oct 2026 brief 2d): the same once-only
 * setup_confirmed row, internal mail, customer mail (behind its flag) and onboarding
 * queue as /app's confirm did, as JSON. Refused while setupGaps names anything -
 * a cluster with no keyword or prompts, or a worked cluster with no target page.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  if (dashFixturePath()) return Response.json({ ok: true, already: false });
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const clients = await clientsFor(email).catch(() => null);
  if (!clients) return Response.json({ ok: false, message: "Could not read your access. Try again." }, { status: 502 });
  const client = clients.find((c) => c.slug === slug);
  if (!client) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  if (refuseRole(writeRole(client))) return Response.json({ ok: false, message: "Viewers cannot confirm setup." }, { status: 403 });

  const already = await loadSetupConfirmed(client.id);
  if (already === null) return Response.json({ ok: false, message: "Could not read your setup. Try again." }, { status: 502 });
  if (already) return Response.json({ ok: true, already: true });

  const raw = await dashRaw(email, slug);
  if (!raw) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const gaps = setupGaps(setupClusters(raw));
  if (gaps.length) return Response.json({ ok: false, message: gaps.join(" ") }, { status: 422 });

  const { error } = await supabaseAdmin().from("dashboard_events").insert({ client_domain_id: client.id, member_email: email, event: SETUP_CONFIRMED_EVENT, path: "/setup" });
  if (error) {
    console.warn(`[dash] could not confirm setup: ${error.message}`);
    return Response.json({ ok: false, message: "That did not save. Try again." }, { status: 502 });
  }
  await sendSetupConfirmed({ domain: client.domain, slug: client.slug, tier: client.tier, member: email, checked: null });
  await mailSetupConfirmed(client.id, email);
  try {
    await enqueueOnboarding(supabaseAdmin(), client.id, { handlers: JOB_HANDLERS });
  } catch (err) {
    console.warn(`[diy] onboarding not queued at confirm (the night pass queues it): ${err instanceof Error ? err.message : String(err)}`);
  }
  return Response.json({ ok: true, already: false });
}
