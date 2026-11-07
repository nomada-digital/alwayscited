import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { dashEmail } from "@/lib/dash/access";
import { dashFixturePath, fixtureRaw } from "@/lib/dash/fixture";
import { answerWords } from "@/lib/dash/history";
import { SAMPLE_CLIENT_ID, SAMPLE_SLUG } from "@/lib/dash/host";
import { sampleRaw } from "@/lib/dash/sample-world";
import { trackingDay } from "@/lib/tracking/decide";
import { ENGINE_ORDER } from "@/lib/dash/model";
import type { Engine } from "@/lib/dash/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One engine's latest answer to one prompt, for the side panel on the AI page (7 Nov 2026): the words, who it named
 * and what it cited, from the newest reading that has it. Signed-in members of this client only; the prompt must be
 * the client's. The words came from a third party, so the page renders them as text (AnswerText), never as HTML.
 */
const ID = /^[0-9A-Za-z_-]{1,64}$/;

export async function GET(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const sp = new URL(req.url).searchParams;
  const prompt = sp.get("prompt") ?? "";
  const engine = sp.get("engine") as Engine | null;
  if (!ID.test(prompt) || !engine || !ENGINE_ORDER.includes(engine)) return Response.json({ ok: false, message: "That answer could not be read." }, { status: 400 });
  // The public sample client (host.ts SAMPLE_SLUG): generated, nothing real behind it, so its shared demo link reads
  // its answers here with no session, as its pages do.
  if (slug === SAMPLE_SLUG) {
    const day = sampleRaw(trackingDay()).answers.filter((x) => x.question_id === prompt && x.engine === engine).map((x) => x.run_date).sort().at(-1);
    const a = day ? (await answerWords(SAMPLE_CLIENT_ID, prompt, day)).find((x) => x.engine === engine) ?? null : null;
    return Response.json({ ok: true, answer: a });
  }
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  if (dashFixturePath()) {
    // A local run: the snapshot's newest reading, with whatever words it carries.
    const a = fixtureRaw().answers.filter((x) => x.question_id === prompt && x.engine === engine).sort((x, y) => y.run_date.localeCompare(x.run_date))[0] ?? null;
    return Response.json({ ok: true, answer: a ? { ...a, brands: a.brands ?? null, citations: a.citations ?? null, response_text: (a as { response_text?: string }).response_text ?? null } : null });
  }
  const clients = await clientsFor(email).catch(() => null);
  if (!clients) return Response.json({ ok: false, message: "Could not read your access. Try again." }, { status: 502 });
  const c = clients.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  const { data, error } = await supabaseAdmin()
    .from("tracking_answers")
    .select("run_date, engine, answered, named, brands, citations, response_text")
    .eq("client_domain_id", c.id)
    .eq("question_id", prompt)
    .eq("engine", engine)
    .order("run_date", { ascending: false })
    .limit(1);
  if (error) return Response.json({ ok: false, message: `Could not read the answer: ${error.message}` }, { status: 502 });
  const row = (data ?? [])[0] ?? null;
  return Response.json({ ok: true, answer: row }, { headers: { "cache-control": "private, no-store" } });
}
