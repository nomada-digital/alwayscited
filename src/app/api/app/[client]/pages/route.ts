import { NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type DiyClient, fixtureDiyClient, loadDiyClient } from "@/lib/diy/core/client";
import { isFixtureCtx } from "@/lib/diy/core/ctx";
import { readContentParsing, readPageDeep } from "@/lib/diy/core/doors";
import { writeReoptExample } from "@/lib/diy/core/model";
import { type ReadCtx } from "@/lib/diy/core/jobs";
import { runOnDemand } from "@/lib/diy/core/runondemand";
import { engineSentence } from "@/lib/diy/pages/answers";
import { deepRow, insertCheck, ownCheck } from "@/lib/diy/pages/check";
import { pagesFixture, readPagesPart, readPagesSerp } from "@/lib/diy/pages/data";
import { type CallResult, EXAMPLE_SCHEMA, EXAMPLE_SYSTEM, draftExample, exampleMessage, exampleState, openingOf } from "@/lib/diy/pages/example";
import { ADD_ANCHOR, pagePath, pagesPath, readBack, readTarget } from "@/lib/diy/pages/paths";
import { PAGES_WHY, type PagesDone, type PagesWhy, isPagesDo } from "@/lib/diy/pages/toast";
import { addChecksFixture, addPage, addPageFixture, examplePending, finishExample, finishExampleFixture, insertExample, insertExampleFixture, removePageFixture } from "@/lib/diy/pages/write";
import { removeKeyPage } from "@/lib/diy/pages/key-pages";
import { actCandidate } from "@/lib/diy/pages/act";
import { type PagesInput, fitTab, pageState, servedClusters } from "@/lib/diy/pages/view";
import type { ExampleBody, KeyPage } from "@/lib/diy/pages/types";
import { planFixture } from "@/lib/diy/plan/data";
import { insertRow } from "@/lib/diy/plan/refresh";
import { updatePlanItem, upsertPlanItemFor } from "@/lib/diy/plan/write";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { writeRole } from "@/lib/tracking/member";
import { dayPlan } from "@/lib/tracking/read-shape";
import { trackingRepo } from "@/lib/tracking/repo";
import { PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { refuseRole } from "@/lib/tracking/stop";
import { isUsageEvent } from "@/lib/tracking/usage";
import { recordUsage } from "@/lib/tracking/usage-record";
import { enginesFor } from "@/config/pricing";
import type { TierKey } from "@/components/TierName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 180 (spec 10 section 3.6): "Check this page now" is an own fetch and one
 * instant_pages read inline (25 s at most, runondemand.ts INLINE_MS); a
 * drafted example is a content_parsing read and an Opus call of about 11k in
 * and up to 16k out, written once more on a reject, in after() (170 s,
 * DEFERRED_MS), which runs inside the route's own duration.
 */
export const maxDuration = 180;

/**
 * Your pages' writes (13 Oct 2026, DIY P8; spec 10 sections 3.6 and 4.9):
 *
 * - `add`: a page on the client's own domain becomes a key page (a foreign
 *   domain is refused). At 10 the oldest automatic page gives way. Read at
 *   once with our own fetch, which is free.
 * - `remove`: a key page goes; an automatic one is never added back.
 * - `check`: "Check this page now" - our own fetch, then one instant_pages
 *   read with the validator, through `runOnDemand` (30 a month, 10 in the
 *   trial; refused while a tracking run is running, while DIY is off, or at a
 *   cap, with its words).
 * - `example`: "Show me an example" - a pending row now, then the drafted
 *   example written in `after()` through `runOnDemand` (10 a month, 3 in the
 *   trial). Only a ready one counts.
 * - `act`: "Add to Actions" - the fix or the example as an Actions item, in
 *   To do, through P3's upsertPlanItemFor (the same dedupe key the nightly
 *   candidates use, so it is never added twice).
 *
 * Plain HTML forms post here, so every write works with JS off; the answer is
 * a 303 back with `done=` and `why=` codes (toast.ts), never anything typed.
 * The session decides the member; owners and editors write, and a viewer -
 * or anyone on an ended client (writeRole) - is refused.
 *
 * On the fixture the same rules run on pages.json's rows in memory
 * (TRACKING_FIXTURE_WRITE=1): no fetch, no vendor, no model. A check stores
 * the page's canned reads newly dated, and an example turns ready a moment
 * after it is asked for, from the fixture's canned body.
 */

const field = (form: FormData | null, k: string): string | null => {
  const v = form?.get(k);
  return typeof v === "string" ? v : null;
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Usage = "key_page_add" | "page_check" | "example_request";

/** One usage row per change, once the shell registers these events (usage.ts is a registry file). Never fatal. */
async function recordPagesUsage(db: SupabaseClient, p: { clientId: string; email: string; today: string; event: Usage }) {
  if (!isUsageEvent(p.event)) return;
  await recordUsage(db, { clientId: p.clientId, email: p.email, event: p.event, path: "/pages", today: p.today });
}

export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const backTo = readBack(sp);
  const form = await req.formData().catch(() => null);
  const d = field(form, "do");
  if (!isPagesDo(d)) return NextResponse.json({ error: "Not a change this page can make." }, { status: 400 });
  // What the form acts on rides in its action's query (paths.ts readTarget), each to its own shape; `do` is the button pressed.
  const { id, of: clusterField, item } = readTarget(sp);

  const back = (done: PagesDone, why: PagesWhy | null = null, landOn: string | null = null) => {
    const codes = { done, ...(why ? { why } : {}) };
    if ("page" in backTo) {
      const page = landOn ?? backTo.page;
      return NextResponse.redirect(dashUrl(req, pagePath(slug, page, { tab: backTo.tab, ...(backTo.cluster ? { cluster: backTo.cluster } : {}), ...codes }, d === "example" || d === "act" ? "#fit-result" : "#page-result")), 303);
    }
    const hash = d === "add" ? (done === "refused" ? `#${ADD_ANCHOR}` : landOn ? `#row-${landOn}` : "") : landOn ? `#row-${landOn}` : "";
    return NextResponse.redirect(dashUrl(req, pagesPath(slug, { ...backTo, ...codes }, hash)), 303);
  };

  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await repo.clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (refuseRole(writeRole(client))) return back("refused", "role");

  const today = repo.today();
  const nowMs = repo.now();
  const fixture = fixtureMode();
  const db = fixture ? null : supabaseAdmin();
  const dbGet = () => supabaseAdmin();

  const livePages = async (): Promise<KeyPage[]> => (await readPagesPart("keyPages", fixture ? null : dbGet, client.id, today)).filter((k) => k.removedOn === null);

  try {
    // ---- add ----
    if (d === "add") {
      const url = (field(form, "url") ?? "").trim();
      if (fixture) {
        const r = addPageFixture(client, url, { by: email, today });
        return r.ok ? back(r.done, null, r.id) : back("refused", r.why);
      }
      const r = await addPage(db!, client, url, { by: email, today });
      if (!r.ok) return back("refused", r.why);
      // Our own read of it now, which is free; a failure is an unreadable row, never the add's failure.
      try {
        const { guardedRead } = await import("@/lib/scan/crawl");
        const page = (await livePages()).find((k) => k.id === r.id);
        if (page) await insertCheck(db!, (await ownCheck({ clientId: client.id, page, homepage: false, trigger: "on_demand", now: Date.now(), get: guardedRead })).row);
      } catch (err) {
        console.warn(`[diy] pages add, first read: ${msg(err)}`);
      }
      await recordPagesUsage(db!, { clientId: client.id, email, today, event: "key_page_add" });
      return back(r.done, null, r.id);
    }

    const pages = await livePages();
    const page = id ? (pages.find((k) => k.id === id) ?? null) : null;
    if (!page) return back("refused", "gone");

    // ---- remove ----
    if (d === "remove") {
      if (fixture) {
        const r = removePageFixture(client.id, page.id, { by: email, today });
        return r === "removed" ? back("removed") : back("refused", r);
      }
      return (await removeKeyPage(db!, client.id, page.id, { by: email, today })) ? back("removed") : back("refused", "gone");
    }

    // The DIY client the paid buttons are counted against.
    const diy: DiyClient | null = fixture
      ? fixtureDiyClient(
          { id: client.id, slug: client.slug, brand: client.brand ?? client.domain, domain: client.domain, market: client.market, tier: client.tier, started_on: client.started_on ?? today, question_limit: client.question_limit, keyword_limit: client.keyword_limit, cluster_limit: client.cluster_limit ?? 10, status: client.status, trial_ends_at: client.trial_ends_at ?? null },
          { setupConfirmed: true, upsellMode: (await repo.upgradeContext(client.id, email, today)).mode },
          nowMs,
        )
      : await loadDiyClient(db!, client.id, nowMs);
    if (!diy) return back("refused", "gone", page.id);

    // ---- check ----
    if (d === "check") {
      const ans = await runOnDemand({ db, client: diy, member: email, action: "page_check", now: () => nowMs }, async (rctx: ReadCtx) => {
        if (isFixtureCtx(rctx)) {
          // The fixture's canned reads of this page, newly dated: nothing reaches a page or a vendor.
          const f = pagesFixture().get();
          const at = new Date(nowMs).toISOString();
          const latest = (via: string) => f.checks.filter((c) => c.key_page_id === page.id && c.via === via).sort((a, b) => (String(a.checked_at) < String(b.checked_at) ? 1 : -1))[0];
          const rows = ["own", "instant_pages"].map((v) => latest(v)).filter((r): r is Record<string, unknown> => Boolean(r)).map((r, n) => ({ ...r, id: `pc-fx-${Date.now().toString(36)}-${n}`, checked_at: at, trigger: "on_demand" }));
          return addChecksFixture(rows) ? "checked" : "readonly";
        }
        const { guardedRead } = await import("@/lib/scan/crawl");
        const own = await ownCheck({ clientId: client.id, page, homepage: page.origin === "homepage", trigger: "on_demand", now: Date.now(), get: guardedRead });
        await insertCheck(db!, own.row);
        const deep = await readPageDeep(rctx, page.url);
        if (deep.kind === "read") await insertCheck(db!, deepRow({ clientId: client.id, page, trigger: "on_demand", now: Date.now(), page_: deep.value.page, microdata: deep.value.microdata, readId: deep.readId }));
        else if (deep.kind === "failed") await insertCheck(db!, deepRow({ clientId: client.id, page, trigger: "on_demand", now: Date.now(), page_: null, microdata: null, readId: deep.readId }));
        // Our own read is stored either way; a refused JavaScript read is said as its refusal, never as "up to date".
        return deep.kind === "refused" ? deep.refusal.code : "checked";
      });
      if (!ans.ok) return back("refused", ans.code === "allowance" ? "checks_out" : ans.code, page.id);
      if (ans.deferred) return back("refused", "failed", page.id);
      if (ans.value !== "checked") {
        const code = ans.value;
        return back("refused", code === "allowance" ? "checks_out" : (PAGES_WHY as readonly string[]).includes(code) ? (code as PagesWhy) : "failed", page.id);
      }
      if (db) await recordPagesUsage(db, { clientId: client.id, email, today, event: "page_check" });
      return back("checked", null, page.id);
    }

    // What the example and Add to Actions read: the page's state over the client's clusters.
    const structure = await repo.structure(client.id);
    const clusters = structure.clusters.map((c) => ({ id: c.id, name: c.name, keywordId: c.keyword_id ?? null, stoppedOn: c.stopped_on }));
    const keywords = structure.keywords.map((k) => ({ id: k.id, keyword: k.keyword, volume: typeof k.search_volume === "number" ? k.search_volume : null }));
    const prompts = structure.questions.map((q) => ({ id: q.id, text: q.text, clusterId: q.cluster_id ?? null, stoppedOn: q.stopped_on }));
    const [checks, bots, examples, top] = await Promise.all([
      readPagesPart("checks", fixture ? null : dbGet, client.id, today),
      readPagesPart("bots", fixture ? null : dbGet, client.id, today),
      readPagesPart("examples", fixture ? null : dbGet, client.id, today),
      readPagesPart("top", fixture ? null : dbGet, client.id, today),
    ]);
    const keywordIds = clusters.filter((c) => c.stoppedOn === null && c.keywordId).map((c) => c.keywordId!);
    const serp = await readPagesSerp(fixture ? null : dbGet, client.id, keywordIds, today);
    const input: PagesInput = { domain: client.domain, keyPages: pages, checks, bots, examples, top, serp, clusters, keywords, prompts, cited: new Map(), items: [], today };
    const state = pageState(page, input);

    // ---- act ----
    if (d === "act") {
      const candidate = actCandidate({ page, state, item, served: servedClusters(page, input), keywords, domain: client.domain });
      if (!candidate) return back("refused", "item", page.id);
      if (fixture) {
        const fx = planFixture();
        const rows = fx.rows();
        const at = rows.findIndex((r) => r.dedupe_key === candidate.dedupeKey && r.client_domain_id === client.id);
        const now = new Date(nowMs).toISOString();
        const next =
          at >= 0
            ? rows.map((r, i) => (i === at && r.status === "suggested" ? { ...r, status: "todo", status_at: now, status_by: email } : r))
            : [...rows, { id: `fx-pages-${rows.length + 1}`, created_at: now, ...insertRow(client.id, candidate, { today, weekOf: null, newSinceMonday: false }), status: "todo", status_at: now, status_by: email, created_by: email }];
        return fx.write(next) ? back("acted", null, page.id) : back("refused", "readonly", page.id);
      }
      const up = await upsertPlanItemFor(db!, client.id, candidate, { today });
      if (!up) return back("refused", "item", page.id);
      await updatePlanItem(db!, client.id, up.id, { status: "todo", status_at: new Date().toISOString(), status_by: email }, "suggested");
      return back("acted", null, page.id);
    }

    // ---- example ----
    const fits = fitTab(state, input);
    const fit = fits.find((f) => f.cluster.id === clusterField) ?? null;
    if (!fit || !fit.keyword) return back("refused", "cluster", page.id);
    if (state.own?.status !== "ok") return back("refused", "unreadable", page.id);
    if (examples.some((e) => e.urlKey === page.urlKey && e.clusterId === fit.cluster.id && exampleState(e, nowMs) === "pending")) return back("refused", "pending", page.id);

    const exampleId = fixture ? `ex-fx-${Date.now().toString(36)}` : crypto.randomUUID();
    const tier = (client.tier as TierKey) ?? "tracked";
    const engines = enginesFor(tier);
    const otherPages = pages.filter((k) => k.id !== page.id).map((k) => k.url);
    const ans = await runOnDemand({ db, client: diy, member: email, action: "example", defer: true, after, now: () => nowMs }, async (rctx: ReadCtx) => {
      const at = () => new Date().toISOString();
      if (isFixtureCtx(rctx)) {
        // The fixture's canned example, a moment later, so the page shows it pending first.
        await new Promise((r) => setTimeout(r, 1500));
        const canned = (pagesFixture().get() as unknown as { canned?: ExampleBody }).canned;
        // The canned body's `{keyword}` blanks take this cluster's keyword.
        const filled = canned ? (JSON.parse(JSON.stringify(canned).replaceAll("{keyword}", fit.keyword!.keyword.replace(/["\\]/g, ""))) as ExampleBody) : null;
        if (filled) finishExampleFixture(exampleId, { status: "ready", example: filled, hits: [], inputs: { keyword: fit.keyword!.keyword, now: { title: state.own?.basics?.title ?? null, h1: state.own?.basics?.h1[0] ?? null, opening: null } }, readId: null, at: at() });
        else finishExampleFixture(exampleId, { status: "failed", error: "no canned example", inputs: null, readId: null, at: at() });
        return;
      }
      if (!(await examplePending(db!, client.id, exampleId))) return;
      const inputs: Record<string, unknown> = { keyword: fit.keyword!.keyword, prompts: fit.prompts.slice(0, PROMPTS_PER_CLUSTER), top: fit.top.map((t) => ({ rank: t.rank, url: t.url })), diagnostics: fit.diagnostics };
      try {
        const md = await readContentParsing(rctx, page.url, { markdown: true });
        const text = md.kind === "read" ? (md.value?.markdown ?? null) : null;
        if (!text) {
          await finishExample(db!, client.id, exampleId, { status: "failed", error: md.kind === "refused" ? `refused: ${md.refusal.reason}` : "we couldn't read your page's text", inputs, readId: md.kind === "refused" ? null : md.readId, at: at() });
          return;
        }
        let answer: { sentence: string; cites: string | null } | null = null;
        for (const q of structure.questions.filter((x) => x.cluster_id === fit.cluster.id && x.stopped_on === null).slice(0, PROMPTS_PER_CLUSTER)) {
          const day = await repo.answerDay(client.id, dayPlan(q.id, today, null));
          const s = engineSentence(day.rows, client.brand ?? client.domain, engines);
          if (s) {
            answer = { sentence: s.sentence, cites: s.cites };
            inputs.answer = { engine: s.engine, day: day.day };
            break;
          }
        }
        const user = exampleMessage({ brand: client.brand ?? client.domain, pageUrl: page.url, pageText: text, keyword: fit.keyword!.keyword, prompts: fit.prompts, top: fit.top, answer, diagnostics: fit.diagnostics ?? [], otherPages });
        inputs.now = { title: state.own?.basics?.title ?? null, h1: state.own?.basics?.h1[0] ?? null, opening: openingOf(text) };
        const call = async (): Promise<CallResult> => {
          const r = await writeReoptExample(rctx, { system: EXAMPLE_SYSTEM, user, schema: EXAMPLE_SCHEMA });
          if (r.kind === "read") return { kind: "read", value: r.value, readId: r.readId };
          if (r.kind === "refused") return { kind: "refused", reason: r.refusal.reason };
          return { kind: "failed", reason: r.reason, readId: r.readId };
        };
        const drafted = await draftExample(call, text);
        if (drafted.status === "ready") await finishExample(db!, client.id, exampleId, { status: "ready", example: drafted.example, hits: drafted.hits, inputs, readId: drafted.readId, at: at() });
        else await finishExample(db!, client.id, exampleId, { status: "failed", error: drafted.error, inputs, readId: drafted.readId, at: at() });
      } catch (err) {
        console.warn(`[diy] pages example for ${client.domain}: ${msg(err)}`);
        await finishExample(db!, client.id, exampleId, { status: "failed", error: msg(err), inputs, readId: null, at: at() }).catch((e) => console.warn(`[diy] pages example: ${msg(e)}`));
      }
    });
    if (!ans.ok) return back("refused", ans.code === "allowance" ? "examples_out" : ans.code, page.id);
    const row = { id: exampleId, clientId: client.id, clusterId: fit.cluster.id, url: page.url, urlKey: page.urlKey, by: email, now: new Date(nowMs).toISOString() };
    if (fixture) {
      if (!insertExampleFixture(row)) return back("refused", "readonly", page.id);
    } else {
      await insertExample(db!, row);
      await recordPagesUsage(db!, { clientId: client.id, email, today, event: "example_request" });
    }
    return back("requested", null, page.id);
  } catch (err) {
    console.warn(`[diy] pages ${d}: ${msg(err)}`);
    return back("refused", "failed", id);
  }
}
