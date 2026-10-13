import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureStop } from "@/lib/tracking/fixture-writes";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { writeFixture } from "@/lib/tracking/repo";
import { slotWhyOf } from "@/lib/tracking/slot";
import { BULK_ID, type BulkCount, type StopDone, readBulkIds, readStopForm, stop, stopReturn, undoStop } from "@/lib/tracking/stop";
import { recordUsage } from "@/lib/tracking/usage-record";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stop a prompt or a cluster, or undo a stop - BRIEF-3 T6 part 2b (30 Sep
 * 2026). Posted by the plain HTML forms on the Clusters page, so it works with
 * JS off; the answer is a 303 back to the page with the toast in the URL.
 *
 * The session decides the member and their role, and the slug must be one of
 * their clients - anyone else gets the same 404 the page gives. The rules and
 * the writes are stop.ts, which refuses a viewer again and scopes every read
 * and write to this client. 13 Oct 2026 (DIY P5, the inventory's ended-client
 * finding): the role handed to stop.ts is writeRole's, so an ended client is
 * read-only here as on every other write - it passed the member's own role,
 * and an owner of an ended client could still stop and undo. The fixture is read-only unless
 * TRACKING_FIXTURE_WRITE=1 (R168), which holds the write in memory.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  // The form carries everything in the action's query string; the body is empty.
  const sp = new URL(req.url).searchParams;
  const f = readStopForm((k) => sp.get(k), APP_LIMITS.search);
  if (!f) return NextResponse.json({ error: "Not a stop this page can make." }, { status: 400 });
  // R151 (3 Oct 2026): a one-row refusal carries its code (slot.ts SLOT_WHY), so the toast says why; a batch keeps its counts.
  const back = (done: StopDone, count?: BulkCount, message = "") => NextResponse.redirect(dashUrl(req, stopReturn(slug, f, done, count, slotWhyOf(message))), 303);
  if (f.id === BULK_ID) {
    // DS13: the Ungrouped bulk form. Each ticked prompt goes through the one-row stop, so each is judged on its own.
    if (f.kind !== "prompt" || f.undo) return NextResponse.json({ error: "Not a stop this page can make." }, { status: 400 });
    const ids = readBulkIds((await req.formData().catch(() => null))?.getAll("ids") ?? []);
    if (!ids.length) return back("unselected");
    let n = 0;
    if (fixtureMode()) {
      for (const id of ids) {
        const r = writeFixture((fx) => fixtureStop(fx, { kind: "prompt", id, today: fx.today, role: fx.member.role, undo: false }));
        if (r?.ok) n++;
        else if (r) console.warn(`[app] fixture bulk stop refused: ${r.message}`);
      }
      return back(n ? "stopped" : "refused", { n, of: ids.length });
    }
    const email = await sessionEmail();
    if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
    const client = (await clientsFor(email)).find((c) => c.slug === slug);
    if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const today = trackingDay();
    for (const id of ids) {
      const r = await stop(supabaseAdmin(), { kind: "prompt", clientId: client.id, id, today, role: writeRole(client), by: email });
      if (r.ok) n++;
      else console.warn(`[app] bulk stop refused: ${r.message}`);
    }
    if (n) await recordUsage(supabaseAdmin(), { clientId: client.id, email, event: "stop", path: "/clusters", today });
    return back(n ? "stopped" : "refused", { n, of: ids.length });
  }
  if (fixtureMode()) {
    // R168: with TRACKING_FIXTURE_WRITE=1 the stop is held in memory; otherwise the fixture refuses it.
    const r = writeFixture((fx) => fixtureStop(fx, { kind: f.kind, id: f.id, today: fx.today, role: fx.member.role, undo: f.undo }));
    if (r && !r.ok) console.warn(`[app] fixture ${f.undo ? "undo" : "stop"} ${f.kind} refused: ${r.message}`);
    return r?.ok ? back(f.undo ? "undone" : "stopped") : back("refused", undefined, r?.message);
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const p = { kind: f.kind, clientId: client.id, id: f.id, today: trackingDay(), role: writeRole(client) };
  const r = f.undo ? await undoStop(supabaseAdmin(), p) : await stop(supabaseAdmin(), { ...p, by: email });
  if (!r.ok) {
    console.warn(`[app] ${f.undo ? "undo" : "stop"} ${f.kind} refused: ${r.message}`);
    return back("refused", undefined, r.message);
  }
  await recordUsage(supabaseAdmin(), { clientId: client.id, email, event: f.undo ? "undo" : "stop", path: "/clusters", today: p.today });
  return back(f.undo ? "undone" : "stopped");
}
