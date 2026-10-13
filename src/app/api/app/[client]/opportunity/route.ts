import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { allowanceMonth, room } from "@/lib/diy/core/allowances";
import type { RefusalCode } from "@/lib/diy/core/caps";
import type { DiyClient } from "@/lib/diy/core/client";
import { readDiyFixture } from "@/lib/diy/core/fixture";
import { runOnDemand } from "@/lib/diy/core/runondemand";
import { type CoreFixture, countLedger, countUsage } from "@/lib/diy/core/usage-meter";
import { isFixtureCtx } from "@/lib/diy/core/ctx";
import { diyFixtureWrites } from "@/lib/diy/core/fixture";
import type { ReadCtx } from "@/lib/diy/core/jobs";
import { factsOf, loggedSince, readKinds, readPageReads } from "@/lib/diy/opportunities/data";
import { PAGE_LENSES } from "@/lib/diy/opportunities/place";
import { domainKey, pageKey } from "@/lib/diy/opportunities/classify-rules";
import { readPlacedKeys } from "@/lib/diy/opportunities/derive";
import { liveIO } from "@/lib/diy/opportunities/io";
import { checkLogUrl, loggedRoute } from "@/lib/diy/opportunities/logsite";
import { type OppKeep, oppDetailPath, oppPath } from "@/lib/diy/opportunities/paths";
import { blockedFacts, factsFromHtml, factsFromParsed } from "@/lib/diy/opportunities/read-page";
import { recordVerification, writePageRead } from "@/lib/diy/opportunities/record";
import { dbPromptPort, runPromptStep } from "@/lib/diy/opportunities/prompt-step";
import { readGuardedPage } from "@/lib/diy/core/fetch";
import {
  type OppDecision,
  type OppDo,
  type OppDone,
  type OppWhy,
  applyDecision,
  countActive,
  decideOpp,
  ensureOpportunity,
  isOppDo,
  newRow,
  planMoveFor,
  readWhy,
  syncPlanItem,
  withEntry,
} from "@/lib/diy/opportunities/status";
import { ACTIVE, OPP_ID, type Opportunity, type PageFacts, TAB_LENSES, type Verification } from "@/lib/diy/opportunities/types";
import { verificationFromFacts, verifyPage } from "@/lib/diy/opportunities/verify";
import { addFixtureLogged, diyClientFor, fixturePromptPort, fixtureState, loadOppWorld, writeFixtureRow } from "@/lib/diy/opportunities/world";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { addDays } from "@/lib/tracking/figures";
import { readSubject } from "@/lib/tracking/limits";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { isUsageEvent } from "@/lib/tracking/usage";
import { recordUsage } from "@/lib/tracking/usage-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A session read, a row read and a write; `log` and `verify` add one own fetch and at most one content_parsing read (inline, 25 s at most). */
export const maxDuration = 60;

/**
 * Opportunities' writes (13 Oct 2026, DIY P7; spec 10 sections 3.6 and
 * 4.7): pursue, pitched, won, decline, dismiss (with a reason from the fixed
 * list, posted as `dismiss:<reason>`), reopen, note, log and verify. Posted
 * by plain HTML forms, so every one works with JS off; the answer is a 303
 * with `done=` and, refused, `why=` - fixed codes whose words are
 * status.ts oppToast's. Nothing typed is echoed in the URL.
 *
 * The session decides the member, and the slug must be one of their
 * clients. Owners and editors write; a viewer, and anyone on an ended client
 * (writeRole), is refused. The rule is status.ts `decideOpp`, on the row as
 * read; the update is held to this client's row and to the status it was
 * read with.
 *
 * Pursue moves the row to Pursuing (at most 10 at once, 3 in the trial),
 * puts its Plan item in Doing, and runs the prompt step (prompt-step.ts):
 * the answer goes to the opportunity's page, with `?swap=1` when the
 * cluster has no free slot. Won checks the page now when its last check is
 * more than a week old. `log` and `verify` are paid only in their fallback:
 * our own fetch first, then `content_parsing` through `runOnDemand`, which
 * refuses the paid read while DIY is dark, at a cap, or while a daily
 * tracking run is reading - while dark both are hidden and refused here.
 *
 * On the fixture the same rules run on the rows held in memory, with
 * TRACKING_FIXTURE_WRITE=1; without it the preview refuses to save. Log and
 * Verify read the fixture's canned page instead of the network.
 */

const ID = /^[0-9A-Za-z_-]{1,64}$/;

/** The list page's state the form's action carries, each key to its own list; the page checks cluster and engine against its own. */
function readKeep(sp: URLSearchParams): OppKeep {
  const out: OppKeep = {};
  const view = sp.get("view");
  if (view === "pursuing" || view === "methods") out.view = view;
  const lens = sp.get("lens");
  if (lens && (TAB_LENSES as readonly string[]).includes(lens)) out.lens = lens;
  const cluster = sp.get("cluster");
  if (cluster && ID.test(cluster)) out.cluster = cluster;
  const engine = sp.get("engine");
  if (engine && /^[a-z_]{2,20}$/.test(engine)) out.engine = engine;
  const q = sp.get("q");
  if (q) out.q = q.slice(0, APP_LIMITS.search);
  const page = Number(sp.get("page"));
  if (Number.isInteger(page) && page >= 2 && page <= 50) out.page = String(page);
  return out;
}

/** The button pressed: a move, `dismiss:<reason>`, log or verify. */
function readDo(raw: unknown): { do: OppDo | "log" | "verify"; reason: string | null } | null {
  if (typeof raw !== "string") return null;
  if (raw === "log" || raw === "verify") return { do: raw, reason: null };
  if (raw.startsWith("dismiss:")) return { do: "dismiss", reason: raw.slice(8) };
  return isOppDo(raw) ? { do: raw, reason: null } : null;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const keep = readKeep(sp);
  const rawId = sp.get("id");
  const id = rawId !== null && OPP_ID.test(rawId) ? rawId : null;
  const atDetail = sp.get("at") === "detail";
  const form = await req.formData().catch(() => null);
  const post = readDo(form?.get("do"));
  if (!post) return NextResponse.json({ error: "Not a change this page can make." }, { status: 400 });

  /** Back to the page the form was on: the opportunity's own page for a pursue, a log, or a form there; else the list. */
  const back = (done: OppDone, why: OppWhy | null = null, to: { id?: string | null; swap?: boolean } = {}) => {
    const q = { done, ...(why ? { why } : {}) };
    const target = to.id ?? (atDetail ? id : null);
    if (target) return NextResponse.redirect(dashUrl(req, oppDetailPath(slug, target, { ...(to.swap ? { swap: "1" } : {}), ...q }, to.swap ? "#prompt" : "")), 303);
    return NextResponse.redirect(dashUrl(req, `${oppPath(slug, { ...keep, ...q } as OppKeep)}${id ? `#opp-${id}` : post.do === "log" ? "#log" : ""}`), 303);
  };

  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await repo.clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const role = writeRole(client);
  const ended = client.status === "ended";
  const today = repo.today();
  const now = new Date(repo.now()).toISOString();
  const trial = Boolean(client.trial_ends_at && Date.parse(client.trial_ends_at) > repo.now());
  const usage = async (event: "opportunity_status" | "opportunity_log") => {
    if (!isUsageEvent(event) || (await fixtureState())) return;
    await recordUsage(supabaseAdmin(), { clientId: client.id, email, event, path: "/opportunities", today });
  };

  try {
    const entry = await fixtureState();
    const world = await loadOppWorld(repo, client);
    const opp = id ? (world.rows.find((o) => o.id === id) ?? null) : null;

    // Log a site and Verify now: hidden while dark, and refused here too.
    if (post.do === "log" || post.do === "verify") {
      const gate = decideOpp({ do: "note" }, { status: "new", pursuedOn: null, note: null }, { role, ended, trial, active: 0, today, now, by: email });
      if (gate.op === "refuse") return back("refused", gate.why);
      if (!world.enabled) return back("refused", "dark");
      if (post.do === "verify") {
        if (!opp || !(opp.status === "pursuing" || opp.status === "pitched" || opp.status === "won") || opp.lens === "link_domain" || opp.lens === "own") return back("refused", "move");
        const v = await verifyNow(opp);
        return v.ok ? back("verified") : back("refused", v.why);
      }
      return await logSite(world.rows);
    }

    if (id && !opp) return back("refused", "gone");
    const active = world.rows.filter((o) => ACTIVE.includes(o.status)).length;
    const decision = decideOpp({ do: post.do, reason: post.reason, note: form?.get("note") }, opp, { role, ended, trial, active, today, now, by: email });
    if (decision.op === "refuse") return back("refused", decision.why);

    if (entry) {
      if (!diyFixtureWrites()) return back("refused", "readonly");
      writeFixtureRow(entry, opp!, { ...decision.patch, history: withEntry(opp!.history, decision.entry) });
      if (post.do === "pursue") {
        const port = fixturePromptPort(entry, { client, today, role, rows: () => world.rows });
        const step = await runPromptStep(port, { opp: opp!, facts: world.reads.get(opp!.urlKey) ?? null, keyword: keywordFor(opp!), market: client.market, today, by: email });
        return back("pursued", null, { id: opp!.id, swap: step.kind === "full" });
      }
      if (post.do === "won" && stale(opp!.verified, today)) await verifyAfterWon(opp!);
      return back(decision.done);
    }

    const db = supabaseAdmin();
    if (post.do === "pursue") {
      // Counted again under the write, not from the page's read: two tabs pursuing at once cannot pass the cap together.
      const recount = await countActive(db, client.id);
      const again = decideOpp({ do: "pursue" }, opp, { role, ended, trial, active: recount, today, now, by: email });
      if (again.op === "refuse") return back("refused", again.why);
      if (!(await applyDecision(db, client.id, opp!.id, again, opp!.history))) return back("refused", "gone");
      await syncPlanItem(db, client.id, opp!, "doing", { today, now, by: email });
      await usage("opportunity_status");
      let swap = false;
      try {
        const step = await runPromptStep(dbPromptPort(db, { clientId: client.id, today, by: email, role }), { opp: opp!, facts: world.reads.get(opp!.urlKey) ?? null, keyword: keywordFor(opp!), market: client.market, today, by: email });
        swap = step.kind === "full";
        if (step.kind === "added" || step.kind === "duplicate") await appendPromptHistory(db, client.id, opp!.id, step.kind === "added" ? `Added the prompt '${step.text}'.` : `Already measured by '${step.text}'.`);
      } catch (err) {
        console.warn(`[diy] opportunity prompt step: ${msg(err)}`);
      }
      return back("pursued", null, { id: opp!.id, swap });
    }
    if (!(await applyDecision(db, client.id, opp!.id, decision as Extract<OppDecision, { op: "update" }>, opp!.history))) return back("refused", "gone");
    const move = planMoveFor(decision.to);
    if (move && post.do !== "note") await syncPlanItem(db, client.id, opp!, move, { today, now, by: email });
    if (post.do !== "note") await usage("opportunity_status");
    if (post.do === "won" && stale(opp!.verified, today)) await verifyAfterWon(opp!);
    return back(decision.done);
  } catch (err) {
    console.warn(`[diy] opportunity ${post.do}: ${msg(err)}`);
    return back("refused", "failed");
  }

  /** The cluster keyword an opportunity's prompt may use (a profile's "best <keyword>"). */
  function keywordFor(o: Opportunity): string | null {
    return o.evidence.keyword;
  }

  /**
   * Won checks the page now (section 4.7) - after the status, its Plan move
   * and its usage event are written, so a check that fails is logged and the
   * member still hears that the page is marked won (13 Oct 2026, review of
   * DIY P7: a throw here answered "That didn't save").
   */
  async function verifyAfterWon(o: Opportunity): Promise<void> {
    try {
      const v = await verifyNow({ ...o, status: "won" });
      if (!v.ok) console.log(`[diy] opportunity won: the check was not made: ${v.why}`);
    } catch (err) {
      console.warn(`[diy] opportunity won: the check failed: ${msg(err)}`);
    }
  }

  /**
   * "Verify now", inline: our own fetch, then the paid fallback through
   * runOnDemand. Ok when a check was recorded and nothing it needed was
   * refused; else the refusal's code, whose words are section 5.6's - a
   * fallback refused at a cap is not "Checked just now".
   */
  async function verifyNow(o: Opportunity): Promise<{ ok: true } | { ok: false; why: OppWhy }> {
    const entry = await fixtureState();
    const mode = (await repo.upgradeContext(client!.id, email!, today)).mode;
    const diy = await diyClientFor(client!, repo, mode);
    if (!diy) return { ok: false, why: "spend" };
    const db = entry ? null : supabaseAdmin();
    /** The paid fallback's refusal, when it was refused. */
    let refused: RefusalCode | null = null;
    const answer = await runOnDemand({ db, client: diy, member: email!, action: "verify" }, async (rctx: ReadCtx) => {
      if (isFixtureCtx(rctx)) {
        const facts = factsOf({ ...(entry?.canned?.verify ?? {}), url: o.url, url_key: o.urlKey, read_at: now }) ?? blockedFacts({ url: o.url, urlKey: o.urlKey, at: now, why: "network" });
        const v = verificationFromFacts(facts, today, o.verified, { brand: client!.brand ?? client!.domain, domain: client!.domain });
        if (!entry || !diyFixtureWrites()) return false;
        writeFixtureRow(entry, o, { verified: v, history: withEntry(o.history, { at: now, kind: "verify", by: email!, text: v.text }) });
        return true;
      }
      const io = await liveIO();
      const subject = await readSubject(db!, client!.id);
      if (typeof subject === "string") throw new Error(subject);
      const subj = { ...subject, brand: subject.brand ?? client!.domain };
      const r = await verifyPage({ url: o.url, urlKey: o.urlKey }, subj, o.verified, {
        get: io.get,
        fallback: async (url) => {
          const got = await io.parse(rctx, url);
          if (got.kind === "refused") refused = got.refusal.code;
          return got.kind === "read" ? { kind: "read", value: got.value } : got.kind === "refused" ? { kind: "refused" } : { kind: "failed", reason: got.reason };
        },
        today,
        now: repo.now(),
      }, o.evidence.competitors);
      await recordVerification(db!, client!.id, o, r.verification, { now, by: email!, today });
      const had = (await readPageReads(db!, client!.id)).get(o.urlKey) ?? null;
      await writePageRead(db!, client!.id, r.facts, had);
      return true;
    });
    if (!answer.ok) {
      console.log(`[diy] verify now refused: ${answer.code}`);
      return { ok: false, why: readWhy(answer.code) };
    }
    if (!answer.deferred && !answer.value) return { ok: false, why: "readonly" };
    const code = refused as RefusalCode | null;
    if (code) {
      console.log(`[diy] verify now: the paid read was refused: ${code}`);
      return { ok: false, why: readWhy(code) };
    }
    return { ok: true };
  }

  /**
   * "Log a site you found": checked, read, typed, routed, kept under the
   * logged lens, and its page opened. A page this client already has, in any
   * lens, opens that row instead of making a second (13 Oct 2026, review of
   * DIY P7). Each log uses one "check a link" (spec 10 section 4.7 row 6):
   * this month's logged pages count against the link_checks allowance beside
   * the link checks and verifications, and a log past it is refused with the
   * used-up line.
   */
  async function logSite(rows: readonly Opportunity[]) {
    const entry = await fixtureState();
    const db = entry ? null : supabaseAdmin();
    let placed: ReadonlySet<string>;
    try {
      placed = entry ? new Set(entry.placed ?? []) : await readPlacedKeys(db!, client!.id);
    } catch (err) {
      console.warn(`[diy] opportunity log: ${msg(err)}`);
      return back("refused", "failed");
    }
    const checked = checkLogUrl(form?.get("url"), { domain: client!.domain, placedKeys: placed });
    if (!checked.ok) return back("refused", checked.why);
    const had = heldRow(rows, checked.key);
    if (had) return back("already", null, { id: had.id });
    const mode = (await repo.upgradeContext(client!.id, email!, today)).mode;
    const diy = await diyClientFor(client!, repo, mode);
    if (!diy) return back("refused", "failed");
    try {
      const used = await logAllowanceUsed(db, diy, rows, repo.now());
      if (room("link_checks", used, diy).out) return back("refused", "allowance");
    } catch (err) {
      // An unreadable count is never read as room.
      console.warn(`[diy] opportunity log allowance: ${msg(err)}`);
      return back("refused", "spend");
    }
    /** The paid fallback's refusal, when it was refused: the page is logged, and read overnight. */
    let refused: RefusalCode | null = null;
    const answer = await runOnDemand({ db, client: diy, member: email!, action: "log" }, async (rctx: ReadCtx): Promise<PageFacts> => {
      if (isFixtureCtx(rctx)) {
        return factsOf({ ...(entry?.canned?.log ?? {}), url: checked.url, url_key: checked.key, read_at: now }) ?? blockedFacts({ url: checked.url, urlKey: checked.key, at: now, why: "network" });
      }
      const io = await liveIO();
      const subject = await readSubject(db!, client!.id);
      if (typeof subject === "string") throw new Error(subject);
      const subj = { ...subject, brand: subject.brand ?? client!.domain };
      const own = await readGuardedPage(checked.url, { get: io.get, thirdParty: true });
      if (own.ok) return factsFromHtml({ url: checked.url, urlKey: checked.key, at: now, today, read: { status: own.status, html: own.html, contentType: own.headers["content-type"] ?? null }, subject: subj, competitors: [] });
      if (own.why !== "robots") return blockedFacts({ url: checked.url, urlKey: checked.key, at: now, why: own.why });
      const got = await io.parse(rctx, checked.url);
      if (got.kind === "refused") refused = got.refusal.code;
      if (got.kind !== "read") return blockedFacts({ url: checked.url, urlKey: checked.key, at: now, why: "robots" });
      return factsFromParsed({ url: checked.url, urlKey: checked.key, at: now, today, parsed: got.value, subject: subj, competitors: [] });
    });
    if (!answer.ok) return back("refused", readWhy(answer.code));
    if (answer.deferred) return back("refused", "spend");
    const facts = answer.value;
    const code = refused as RefusalCode | null;
    const unread = code ? readWhy(code) : null;
    const kinds = entry ? new Map((entry.kinds ?? []).map((k) => [k.key, { domain_type: k.domain_type ?? null, page_type: k.page_type ?? null, set_by: k.set_by ?? "model" }] as const)) : await readKinds(db!, [domainKey(checked.host), pageKey(checked.key)]);
    const routed = loggedRoute({ ...checked, facts, kinds: kinds as never });
    if (!routed) return back("refused", "cannot_log");
    const input = { lens: "logged" as const, url: checked.url, urlKey: checked.key, domain: checked.host, title: facts.status === "ok" ? facts.title : null, route: routed.route, pageType: routed.pageType, domainType: routed.domainType, today, now };
    if (entry) {
      if (!diyFixtureWrites()) return back("refused", "readonly");
      const row = newRow(client!.id, input);
      if (!row) return back("refused", "url");
      const again = heldRow((await loadOppWorld(repo, client!)).rows, checked.key);
      if (again) return back("already", null, { id: again.id });
      const fid = `opp-log-${Date.now().toString(36)}`;
      addFixtureLogged(entry, { ...row, id: fid, history: [{ at: now, kind: "status", status: "new", by: email! }] });
      return back("logged", unread, { id: fid });
    }
    const made = await ensureOpportunity(db!, client!.id, input);
    if (!made) return back("refused", "url");
    const prior = (await readPageReads(db!, client!.id)).get(checked.key) ?? null;
    await writePageRead(db!, client!.id, facts, prior);
    await usage("opportunity_log");
    return back("logged", unread, { id: made.id });
  }
}

/** This client's row of a page in any page lens (never P10's link lenses), or null. */
function heldRow(rows: readonly Opportunity[], key: string): Opportunity | null {
  return rows.find((o) => o.urlKey === key && PAGE_LENSES.has(o.lens)) ?? null;
}

/**
 * This month's link checks, as a log counts them: the link checks and
 * verifications the ledger holds plus the pages logged since the client's
 * allowance month began. On Supabase that is usage-meter.ts's one count,
 * which holds the logged pages itself (13 Oct 2026, DIY P10's review, outside
 * P10's 7.11 edit list: this route added them to it, so Settings and Links
 * counted the same allowance differently). Throws when a count cannot be
 * read.
 */
async function logAllowanceUsed(db: ReturnType<typeof supabaseAdmin> | null, client: DiyClient, rows: readonly Opportunity[], now: number): Promise<number> {
  const since = allowanceMonth(client.market, now).start;
  if (!db) {
    const fx = readDiyFixture<CoreFixture>("core");
    return countLedger(fx.reads, "link_checks") + loggedSince(rows, since);
  }
  return countUsage(db, client, "link_checks", now);
}

/** A won page's last check is more than a week old, or it has none: Won checks it now (section 4.7). */
function stale(v: Verification | null, today: string): boolean {
  return !v || v.at < addDays(today, -7);
}

/** One line of the prompt step in the row's history; never fatal. */
async function appendPromptHistory(db: ReturnType<typeof supabaseAdmin>, clientId: string, id: string, text: string): Promise<void> {
  try {
    const { data, error } = await db.from("opportunities").select("history").eq("client_domain_id", clientId).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    const history = Array.isArray((data as { history?: unknown } | null)?.history) ? ((data as { history: unknown[] }).history as Record<string, unknown>[]) : [];
    const { error: wErr } = await db.from("opportunities").update({ history: [...history, { at: new Date().toISOString(), kind: "prompt", text }].slice(-50) }).eq("client_domain_id", clientId).eq("id", id);
    if (wErr) throw new Error(wErr.message);
  } catch (err) {
    console.warn(`[diy] opportunity history: ${err instanceof Error ? err.message : String(err)}`);
  }
}

