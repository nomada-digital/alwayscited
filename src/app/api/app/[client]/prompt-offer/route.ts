import { NextResponse } from "next/server";

import { diyFixtureWrites } from "@/lib/diy/core/fixture";
import { WATCH_TEXT } from "@/lib/diy/opportunities/detail";
import { oppDetailPath } from "@/lib/diy/opportunities/paths";
import { type PromptPort, type StepResult, dbPromptPort, readPromptForUndo, runPromptStep, swapPromptStep, undoPromptStep } from "@/lib/diy/opportunities/prompt-step";
import { type OppDone, type OppWhy, withEntry } from "@/lib/diy/opportunities/status";
import { OPP_ID, type HistoryEntry, type Opportunity } from "@/lib/diy/opportunities/types";
import { fixturePrompt, fixturePromptPort, fixtureState, loadOppWorld, writeFixtureRow } from "@/lib/diy/opportunities/world";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";
import { isUsageEvent } from "@/lib/tracking/usage";
import { recordUsage } from "@/lib/tracking/usage-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A session read, a few row reads and at most two writes through limits.ts and stop.ts. Nothing is paid for. */
export const maxDuration = 60;

/**
 * The prompt step's writes (13 Oct 2026, DIY P7; spec 10 sections 3.6 and
 * 6.7): `add` (the opportunity's prompt into a free slot), `undo` (stop the
 * prompt it added, while pending), `swap:<prompt id>` (stop that live prompt
 * of the same cluster and put the new one in its angle) and `watch` (add
 * nothing; the page is watched whatever happens). Placement prompts are
 * never offered or stopped here. Every insert is limits.ts `insertPrompts`
 * and every stop stop.ts's, as they are; on the fixture, their twins.
 *
 * Owners and editors only, and only on a page in Pursuing, Pitched or Won.
 * The answer is a 303 to the opportunity's page with `done=` or `why=`.
 */

const PROMPT_ID = /^[0-9A-Za-z_-]{1,64}$/;

function readDo(raw: unknown): { do: "add" | "undo" | "watch" } | { do: "swap"; stop: string } | null {
  if (raw === "add" || raw === "undo" || raw === "watch") return { do: raw };
  if (typeof raw === "string" && raw.startsWith("swap:") && PROMPT_ID.test(raw.slice(5))) return { do: "swap", stop: raw.slice(5) };
  return null;
}

export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const rawId = new URL(req.url).searchParams.get("id");
  const id = rawId !== null && OPP_ID.test(rawId) ? rawId : null;
  const form = await req.formData().catch(() => null);
  const post = readDo(form?.get("do"));
  if (!post || !id) return NextResponse.json({ error: "Not a change this page can make." }, { status: 400 });
  const back = (done: OppDone, why: OppWhy | null = null) => NextResponse.redirect(dashUrl(req, oppDetailPath(slug, id, { done, ...(why ? { why } : {}) }, "#prompt")), 303);

  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await repo.clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (client.status === "ended") return back("refused", "ended");
  const role = writeRole(client);
  if (refuseRole(role)) return back("refused", "viewer");
  const today = repo.today();
  const now = new Date(repo.now()).toISOString();

  try {
    const entry = await fixtureState();
    const world = await loadOppWorld(repo, client);
    const opp = world.rows.find((o) => o.id === id) ?? null;
    if (!opp) return back("refused", "gone");
    if (!(opp.status === "pursuing" || opp.status === "pitched" || opp.status === "won")) return back("refused", "move");
    if (entry && !diyFixtureWrites()) return back("refused", "readonly");
    const db = entry ? null : supabaseAdmin();
    const port: PromptPort = entry ? fixturePromptPort(entry, { client, today, role, rows: () => world.rows }) : dbPromptPort(db!, { clientId: client.id, today, by: email, role });
    const structure = await repo.structure(client.id);
    const keyword = opp.clusterId ? (structure.keywords.find((k) => k.id === structure.clusters.find((c) => c.id === opp.clusterId)?.keyword_id)?.keyword ?? null) : null;
    const step = { opp, facts: world.reads.get(opp.urlKey) ?? null, keyword, market: client.market, today, by: email };
    const history = async (text: string) => {
      const e: HistoryEntry = { at: now, kind: "prompt", by: email, text };
      if (entry) {
        const fresh = (await loadOppWorld(repo, client)).rows.find((o) => o.id === opp.id) ?? opp;
        writeFixtureRow(entry, fresh, { history: withEntry(fresh.history, e) });
        return;
      }
      await appendHistory(db!, client.id, opp, e);
    };
    // prompt_offer is in USAGE_EVENTS since 13 Oct 2026 (DIY P9, the wave 2 shell); nothing is recorded on the fixture.
    const usage = async (event: "prompt_offer" = "prompt_offer") => {
      if (!entry && isUsageEvent(event)) await recordUsage(db!, { clientId: client.id, email, event, path: "/opportunities", today });
    };
    const answer = async (r: StepResult, done: OppDone): Promise<NextResponse> => {
      if (r.kind === "added") {
        await history(post.do === "swap" ? `Swapped in the prompt '${r.text}'.` : `Added the prompt '${r.text}'.`);
        await usage();
        return back(done);
      }
      if (r.kind === "duplicate") {
        await history(`Already measured by '${r.text}'.`);
        return back("prompt_duplicate");
      }
      if (r.kind === "full") return NextResponse.redirect(dashUrl(req, oppDetailPath(slug, id, { swap: "1" }, "#prompt")), 303);
      if (r.kind === "none") return back("refused", "prompt_none");
      console.warn(`[diy] prompt offer ${post.do} refused: ${r.message}`);
      return back("refused", "prompt");
    };

    if (post.do === "watch") {
      await history(WATCH_TEXT);
      return back("watching");
    }
    if (post.do === "add") return await answer(await runPromptStep(port, step), "prompt_added");
    if (post.do === "swap") return await answer(await swapPromptStep(port, { ...step, stopId: post.stop }), "prompt_swapped");

    // Undo: only the prompt this page added, only while pending, through the stop path.
    if (!opp.promptId) return back("refused", "prompt");
    const prompt = entry ? fixturePrompt(opp.promptId) : await readPromptForUndo(db!, client.id, opp.promptId);
    const undone = await undoPromptStep(port, { opportunityId: opp.id, prompt, today });
    if (!undone.ok) {
      console.warn(`[diy] prompt offer undo refused: ${undone.message}`);
      return back("refused", prompt && prompt.added_on <= today ? "pending" : "prompt");
    }
    await history("Took the prompt back before its first reading.");
    await usage();
    return back("prompt_undone");
  } catch (err) {
    console.warn(`[diy] prompt offer ${post.do}: ${err instanceof Error ? err.message : String(err)}`);
    return back("refused", "failed");
  }
}

/** One history line on the row, read fresh so a line written since the page loaded is kept. Never fatal. */
async function appendHistory(db: ReturnType<typeof supabaseAdmin>, clientId: string, opp: Opportunity, e: HistoryEntry): Promise<void> {
  try {
    const { data, error } = await db.from("opportunities").select("history").eq("client_domain_id", clientId).eq("id", opp.id).maybeSingle();
    if (error) throw new Error(error.message);
    const had = Array.isArray((data as { history?: unknown } | null)?.history) ? ((data as { history: HistoryEntry[] }).history) : opp.history;
    const { error: wErr } = await db.from("opportunities").update({ history: withEntry(had, e) }).eq("client_domain_id", clientId).eq("id", opp.id);
    if (wErr) throw new Error(wErr.message);
  } catch (err) {
    console.warn(`[diy] opportunity history: ${err instanceof Error ? err.message : String(err)}`);
  }
}
