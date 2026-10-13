import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readHideCta, recordHidden } from "@/lib/tracking/ask";
import { trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";
import { readKept } from "@/lib/tracking/stop";
import { readSurface, upgradeTrigger } from "@/lib/tracking/upgrade-prompts";
import { readAiKept } from "@/lib/diy/ai/prompt-table";
import { recordUsage } from "@/lib/tracking/usage-record";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An upgrade prompt's "Hide for 30 days" (BRIEF-2 T11 part 5, 30 Sep 2026;
 * boards-3/CTAs.dc.html, the x at the prompt's top right). Posted by a plain
 * HTML form with the prompt's `cta`; writes one cta_events `hidden` row for
 * this member, which upgrade-context reads back for 30 days. Any member may
 * hide (it changes only what they see). No mail, no spend. The fixture writes
 * nothing. Returns to the Clusters page it came from, with the range, filter
 * and search its action carries (DS16, 2 Oct 2026); "mentioned" still lands
 * on the never-named filter.
 *
 * 13 Oct 2026, DIY P4 (review of P4; spec 10 sections 2.7 and 3.6): the
 * action's `surface` says which page drew the prompt. `ai` returns to AI
 * visibility with its own view (prompt-table.ts readAiKept), so a hide from
 * /ai lands on /ai with its toast; anything else is Clusters, as before. The
 * surface is also the row's `trigger`, so a hide on /ai can be told from one
 * on Clusters in cta_events.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const cta = readHideCta(form?.get("cta"));
  const sp = new URL(req.url).searchParams;
  const surface = readSurface(sp.get("surface")) ?? "clusters";
  const onAi = surface === "ai";
  const view = onAi ? readAiKept((k) => sp.get(k), APP_LIMITS.search) : readKept((k) => sp.get(k), APP_LIMITS.search);
  // DS29: `hid=1` draws "Hidden for 30 days" on the way back - only once the row is recorded (the fixture records nothing and says so anyway).
  // R151 (3 Oct 2026): a write that failed comes back `hid=0`, so the page says it did not hide rather than nothing.
  const to = (hid: boolean | null) => {
    const q = new URLSearchParams({ ...view, ...(cta === "mentioned" && !onAi ? { filter: "never" } : {}), ...(hid === null ? {} : { hid: hid ? "1" : "0" }) }).toString();
    return NextResponse.redirect(dashUrl(req, appPath(`/${slug}/${onAi ? "ai" : "clusters"}${q ? `?${q}` : ""}`)), 303);
  };
  const back = to(null);
  if (!cta) return back;
  if (fixtureMode()) return to(true);

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const hid = await recordHidden(supabaseAdmin(), { clientId: client.id, email, cta, trigger: upgradeTrigger(surface) });
  if (!hid) console.warn("[app] hide not recorded");
  await recordUsage(supabaseAdmin(), { clientId: client.id, email, event: "cta_hide", path: null, props: { cta }, today: trackingDay() });
  return to(hid);
}
