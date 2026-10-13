import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { type NoteState, addNote, noteCodeOf, noteReturn, readNote } from "@/lib/tracking/note";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Add a note - BRIEF-3 T7 part 4b (30 Sep 2026). Posted by the plain HTML
 * form on the one-cluster page: the cluster, the picked prompt's id and the
 * page state in the action's query string, the note in the body. Rules and
 * the one insert are note.ts. Session and membership as the edit route; the
 * fixture writes nothing. Returns to the page with `note=` a NOTE_SAID code.
 * 13 Oct 2026 (DIY P5, the inventory's ended-client finding): the role is
 * writeRole's, as the edit route's is, so an ended client is read-only here
 * too; it passed the member's own role.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const back = noteReturn(slug, sp);
  if (!back) return NextResponse.json({ error: "Not a cluster this page can note." }, { status: 400 });
  const done = (r: NoteState) => NextResponse.redirect(dashUrl(req, `${back}&note=${r}`), 303);
  const form = await req.formData().catch(() => null);
  const note = readNote(form?.get("text"));
  if (fixtureMode()) return done(typeof note === "string" ? noteCodeOf(note) : "refused");

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (typeof note === "string") return done(noteCodeOf(note));
  const r = await addNote(supabaseAdmin(), { clientId: client.id, clusterId: sp.get("cluster")!, questionId: sp.get("q")!, text: note.text, email, role: writeRole(client), today: trackingDay() });
  if (!r.ok) {
    console.warn(`[app] note refused: ${r.message}`);
    return done("refused");
  }
  return done("saved");
}
