import { NextResponse } from "next/server";

import { isFixtureCtx } from "@/lib/diy/core/ctx";
import { diyFixtureState, diyFixtureWrites } from "@/lib/diy/core/fixture";
import type { ReadCtx } from "@/lib/diy/core/jobs";
import { runOnDemand } from "@/lib/diy/core/runondemand";
import { decideOpp, newRow } from "@/lib/diy/opportunities/status";
import { ACTIVE } from "@/lib/diy/opportunities/types";
import { addFixtureLogged, fixtureState as oppFixtureState, loadOppWorld } from "@/lib/diy/opportunities/world";
import { type FallbackRead, checkLink, checkUrl } from "@/lib/diy/links/check-link";
import { linksFixture, linksStore } from "@/lib/diy/links/data";
import { gapEvidence, mentionEvidence, targetEvidence } from "@/lib/diy/links/evidence";
import { liveLinksIO } from "@/lib/diy/links/io";
import { linksPath } from "@/lib/diy/links/paths";
import { planReveal, targetRows } from "@/lib/diy/links/targets";
import { type LinksDone, type LinksWhy, whyOfRefusal } from "@/lib/diy/links/toast";
import { type LinkLens, type LinkView, LINK_LENSES, LINK_URL_MAX, pickView } from "@/lib/diy/links/types";
import { linksPage } from "@/lib/diy/links/view";
import { diyClientFor, loadLinksWorld } from "@/lib/diy/links/world";
import { type LinkRowInput, domainUrl, linkRowEvidence, pursueLink, revealPages, routeOf, writeCheck } from "@/lib/diy/links/write";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { writeRole } from "@/lib/tracking/member";
import { urlKey } from "@/lib/tracking/placements";
import { trackingRepo } from "@/lib/tracking/repo";
import { refuseRole } from "@/lib/tracking/stop";
import { isUsageEvent } from "@/lib/tracking/usage";
import { recordUsage } from "@/lib/tracking/usage-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A session read, the page's stored rows, and at most one own fetch and one content_parsing read for a check (inline, 25 s at most). */
export const maxDuration = 60;

/**
 * Links' writes (13 Oct 2026, DIY P10; spec 10 sections 3.6, 4.8 and 6.3),
 * posted by plain HTML forms, so every one works with JS off; the answer is a
 * 303 back to the view the form was on, with `done=` and, refused, `why=` -
 * fixed codes whose words are links/toast.ts's. Nothing typed is echoed.
 *
 * - `reveal`: "Show the next 5" link targets. Reads stored rows only, spends
 *   nothing: the next unrevealed pages of this month's read, as many as the
 *   month's allowance has left (5, or 2 in the trial), each an
 *   `opportunities` row with lens `link_page` and `revealed_at`. The form
 *   carries the month's count it was drawn with (`seen`); a post that does
 *   not match it - the same form sent twice - reveals nothing more.
 * - `pursue`: a gap domain, a revealed page or a mention, made in
 *   `opportunities` through P7's `ensureOpportunity` and pursued through
 *   P7's `pursueOpportunity` (the cap of 10 at once, 3 in the trial; the Plan
 *   item in Doing). Only a row the page lists can be pursued - with Nomada's
 *   placements for other clients subtracted - found by its lens and key.
 * - `check`: "Check a link" on one public address (500 characters at most,
 *   not the client's own site): our own fetch first, which is free, then the
 *   `content_parsing` fallback through `runOnDemand` when robots.txt keeps us
 *   out, which refuses the paid read while DIY is dark, at a cap, at the
 *   month's allowance, or while a tracking run is reading. The allowance - 30
 *   a month, 10 in the trial, shared with Verify now and Log a site - is
 *   runOnDemand's own count (usage-meter.ts countUsage "link_checks"): a page
 *   our fetch reads uses none, so a used-up month still checks the pages we
 *   can read (13 Oct 2026, review of DIY P10: this route counted its free
 *   checks too, a second count that Settings and Opportunities did not keep).
 *
 * The session decides the member; the slug must be one of their clients.
 * Owners and editors write; a viewer, and anyone on an ended client
 * (writeRole), is refused. On the fixture the same rules run on rows held
 * in memory with TRACKING_FIXTURE_WRITE=1, and a check reads a canned page.
 */

const KEY = /^[a-z0-9.-]{3,253}(\/[^\s]{0,500})?$/i;

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const view: LinkView = pickView(new URL(req.url).searchParams.get("view"));
  const form = await req.formData().catch(() => null);
  const action = form?.get("do");
  if (action !== "reveal" && action !== "pursue" && action !== "check") return NextResponse.json({ error: "Not a change this page can make." }, { status: 400 });

  const anchor: Record<LinkView, string> = { profile: "#wins", gap: "#gap", targets: "#targets", mentions: "#mentions", check: "#check" };
  const back = (done: LinksDone, why: LinksWhy | null = null, to: LinkView = view) => NextResponse.redirect(dashUrl(req, linksPath(slug, { view: to, done, ...(why ? { why } : {}) }, anchor[to])), 303);

  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await repo.clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const role = writeRole(client);
  if (client.status === "ended") return back("refused", "ended");
  if (refuseRole(role)) return back("refused", "viewer");
  const today = repo.today();
  const nowMs = repo.now();
  const now = new Date(nowMs).toISOString();
  const trial = Boolean(client.trial_ends_at && Date.parse(client.trial_ends_at) > nowMs);
  const fixture = diyFixtureState() !== null;
  const usage = async (event: "link_reveal" | "link_check" | "link_pursue") => {
    if (!isUsageEvent(event) || fixture) return;
    await recordUsage(supabaseAdmin(), { clientId: client.id, email, event, path: "/links", today });
  };

  try {
    if (action === "check") return await check();
    const world = await loadLinksWorld(repo, client);
    const page = linksPage(world, { client: { domain: client.domain, trial, market: client.market }, now: nowMs, today });
    if (page.state === "dark") return back("refused", "dark");
    if (page.state === "error") return back("refused", "failed");
    if (page.state !== "ready") return back("refused", "gone");

    if (action === "reveal") {
      if (page.errors.includes("targets")) return back("refused", "failed", "targets");
      if (!page.targets || !world.pages || page.few) return back("refused", "gone", "targets");
      const rows = targetRows(world.pages.value.rows, { client: client.domain, targets: world.set?.domains ?? [], placed: world.placed });
      const revealed = new Set(world.linkRows.filter((o) => o.lens === "link_page" && o.revealedAt).map((o) => o.urlKey));
      const seenRaw = Number(form?.get("seen"));
      const plan = planReveal({ rows, revealed, usedThisMonth: page.targets.used, seen: Number.isInteger(seenRaw) ? seenRaw : null, client: { trial } });
      if (!plan.ok) return plan.why === "stale" ? back("already", null, "targets") : back("refused", plan.why === "cap" ? "reveal_cap" : "none", "targets");
      if (fixture) {
        const store = linksStore();
        const held = store.get();
        const added = plan.pages.map((p, i) => ({ url: p.urlFrom, title: p.title, domain: p.domain, revealedAt: new Date(nowMs + i).toISOString() }));
        if (!store.write({ revealed: [...held.revealed, ...added], checks: held.checks })) return back("refused", "readonly", "targets");
        return back("revealed", null, "targets");
      }
      const readOn = world.pages.readOn;
      await revealPages(supabaseAdmin(), client.id, plan.pages.map((p) => ({ url: p.urlFrom, domain: p.domain, title: p.title, evidence: targetEvidence(p, readOn) })), { today, now: nowMs });
      await usage("link_reveal");
      return back("revealed", null, "targets");
    }

    // Pursue: a row this page lists, by its lens and key.
    const lens = String(form?.get("lens") ?? "") as LinkLens;
    const key = String(form?.get("key") ?? "").slice(0, 520);
    if (!(LINK_LENSES as readonly string[]).includes(lens) || !KEY.test(key)) return back("refused", "gone");
    const section = lens === "link_domain" ? "gap" : lens === "link_page" ? "targets" : "mentions";
    if (page.errors.includes(section)) return back("refused", "failed");
    const row = findRow(page, lens, key);
    if (!row) return back("refused", "gone");
    if (fixture) {
      const entry = await oppFixtureState();
      if (!entry || !diyFixtureWrites()) return back("refused", "readonly");
      const opp = await loadOppWorld(repo, client);
      const active = opp.rows.filter((o) => ACTIVE.includes(o.status)).length;
      const d = decideOpp({ do: "pursue" }, { status: "new", pursuedOn: null, note: null }, { role, ended: false, trial, active, today, now, by: email });
      if (d.op === "refuse") return back("refused", d.why === "cap" ? "cap" : "gone");
      const made = newRow(client.id, { lens: row.lens, url: row.url, urlKey: key, domain: row.domain, title: row.title, route: row.route, evidence: linkRowEvidence(row.evidence, today), today, now });
      if (!made) return back("refused", "gone");
      addFixtureLogged(entry, { ...made, ...d.patch, id: `opp-link-${Date.now().toString(36)}`, history: [d.entry] });
      return back("pursued");
    }
    const answer = await pursueLink(supabaseAdmin(), { id: client.id, trial, ended: false }, row, { role, by: email, today, now });
    if (!answer.ok) return back("refused", answer.why === "cap" ? "cap" : answer.why === "viewer" ? "viewer" : answer.why === "ended" ? "ended" : "gone");
    await usage("link_pursue");
    return back("pursued");
  } catch (err) {
    console.warn(`[diy] links ${String(action)}: ${msg(err)}`);
    return back("refused", "failed");
  }

  /** Check a link: the address, the month's allowance, our fetch, the paid fallback, the stored result. */
  async function check() {
    const checked = checkUrl(form?.get("url"), client!.domain);
    if (!checked.ok) return back("refused", checked.why, "check");
    const mode = (await repo.upgradeContext(client!.id, email!, today)).mode;
    const diy = await diyClientFor(client!, repo, mode);
    if (!diy) return back("refused", "failed", "check");
    // The allowance is runOnDemand's: it refuses the paid fallback, never our own free read (FREE_FIRST link_check).
    const db = fixture ? null : supabaseAdmin();
    // The real clock, not the request's frozen one: the ledger reads it for each read's deadline and retries (25 s).
    const answer = await runOnDemand({ db, client: diy, member: email!, action: "link_check" }, async (rctx: ReadCtx) => {
      if (isFixtureCtx(rctx)) {
        const fx = linksFixture();
        const canned = /nolink/i.test(checked.url) ? fx.canned.none : fx.canned.found;
        return { url: checked.url.slice(0, LINK_URL_MAX), checkedAt: now, ...canned } as Parameters<typeof writeCheck>[2];
      }
      const io = await liveLinksIO();
      return checkLink(checked.url, client!.domain, {
        get: io.get,
        fallback: async (url): Promise<FallbackRead> => {
          const got = await io.parse(rctx, url);
          return got.kind === "read" ? { kind: "read", value: got.value } : got.kind === "refused" ? { kind: "refused" } : { kind: "failed", reason: got.reason };
        },
        now: nowMs,
      });
    });
    if (!answer.ok) return back("refused", whyOfRefusal(answer.code), "check");
    if (answer.deferred) return back("refused", "spend", "check");
    const result = answer.value;
    if (fixture) {
      const store = linksStore();
      const held = store.get();
      const row = { id: `check-${Date.now().toString(36)}`, url: result.url, checked_at: result.checkedAt, via: result.via, status: result.status, http_status: result.http, found: result.found, rel: result.rel, anchor: result.anchor, target: result.target };
      if (!store.write({ revealed: held.revealed, checks: [row, ...held.checks] })) return back("refused", "readonly", "check");
      return back("checked", null, "check");
    }
    await writeCheck(db!, client!.id, result, email!);
    await usage("link_check");
    return back("checked", null, "check");
  }
}

/** The row a Pursue names, from what the page lists - after the subtraction - or null; with the facts it was listed on, which the opportunity keeps. */
function findRow(page: ReturnType<typeof linksPage>, lens: LinkLens, key: string): LinkRowInput | null {
  if (lens === "link_domain") {
    const r = page.gap?.rows.find((g) => g.key === key && !g.pursued);
    return r && page.gap ? { lens, url: domainUrl(r.domain), domain: r.domain, title: r.domain, route: routeOf(lens), evidence: gapEvidence(r, page.gap.readOn) } : null;
  }
  if (lens === "link_page") {
    const r = [...(page.targets?.thisMonth ?? []), ...(page.targets?.earlier ?? [])].find((t) => t.key === key && !t.pursued);
    return r && urlKey(r.url) === key ? { lens, url: r.url, domain: r.domain, title: r.title, route: routeOf(lens), evidence: targetEvidence(r, page.targets?.readOn ?? r.revealedOn ?? "") } : null;
  }
  const r = page.mentions?.rows.find((m) => m.key === key && !m.pursued);
  return r ? { lens, url: r.url, domain: r.domain, title: r.title, route: routeOf(lens), evidence: mentionEvidence(r.readOn) } : null;
}
