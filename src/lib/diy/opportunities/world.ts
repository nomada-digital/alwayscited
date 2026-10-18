import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { allowanceFor, allowanceMonth, usedUpLine } from "@/lib/diy/core/allowances";
import { loadDiyClient, fixtureDiyClient, type DiyClient } from "@/lib/diy/core/client";
import { diyFixtureState } from "@/lib/diy/core/fixture";
import { loadDiyEnabled } from "@/lib/diy/core/settings";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { type Day, addDays } from "@/lib/tracking/figures";
import type { Fixture } from "@/lib/tracking/fixture-mode";
import { placementAllowance } from "@/lib/tracking/fixture-mode";
import { fixtureFillSlot, fixtureStop } from "@/lib/tracking/fixture-writes";
import { CLUSTER_BASE, promptRoom } from "@/lib/tracking/limits";
import type { MemberClient } from "@/lib/tracking/member";
import type { Structure } from "@/lib/tracking/read-shape";
import { type TrackingRepo, writableFixture, writeFixture } from "@/lib/tracking/repo";

import { type OppFixtureState, type OppWorld, type Overlay, fixtureEntry, fixtureWorld, oppFixture, overlayKey, readFixtureFile, readKeyPages, readRankingUrl, readWorld } from "./data";
import { type CitedSummary, citationKey, citedSummary } from "./derive";
import type { PromptPort } from "./prompt-step";
import { ENGINE_ORDER } from "./refresh.job";
import type { Opportunity } from "./types";

/**
 * The server's way in to Opportunities (13 Oct 2026, DIY P7): the world a
 * page draws, the target page, and on the fixture the write twins the routes
 * use - the opportunity rows held in memory (data.ts oppFixture) and the
 * tracking fixture's own prompt twins (fixture-writes.ts) for the prompt step.
 * Server-only: it reads Supabase with the service role, or the tracking
 * fixture through its repo.
 */

export type Client = MemberClient & { role: string };

/** The fixture's entry for the current DIY state, or null off the fixture. */
export async function fixtureState(): Promise<OppFixtureState | null> {
  const state = diyFixtureState();
  if (state === null) return null;
  return fixtureEntry(await readFixtureFile(), state);
}

/**
 * The tracking fixture as the derivation reads it: 28 days of answers to its today, its structure, the client's domain.
 * `structure` (13 Oct 2026, dashboard speed work): the page's own structure read, when it has one in flight, so it is
 * not read a second time. `answers` (13 Oct 2026, review of the dashboard speed work): "cites" leaves out the brands
 * (read-shape.ts), for a reader that counts no brand - citedSummary's pages, reads and own pages; the derivation
 * names competitors from them, so it reads "full", the default.
 */
async function trackingWorld(repo: TrackingRepo, client: Client, opts: { structure?: PromiseLike<Structure>; answers?: "full" | "cites" } = {}) {
  const today = repo.today();
  const [s, data] = await Promise.all([opts.structure ?? repo.structure(client.id), repo.loadOverview(client.id, { from: addDays(today, -27), to: today }, "none", { answers: opts.answers ?? "full" })]);
  return { today, engines: ENGINE_ORDER, answers: data.answers, questions: s.questions, clusters: s.clusters, keywords: s.keywords, domain: client.domain };
}

export type TrackingWorld = Awaited<ReturnType<typeof trackingWorld>>;

/** The world the cited tab's empty state is summarised from: the answers' citations, no brands (loadCitedSummary). */
export function citedWorld(repo: TrackingRepo, client: Client, structure?: PromiseLike<Structure>): Promise<TrackingWorld> {
  return trackingWorld(repo, client, { structure, answers: "cites" });
}

/** Everything the pages draw, and whether DIY is switched on. A failed read throws: the caller's section says so. */
export async function loadOppWorld(repo: TrackingRepo, client: Client): Promise<OppWorld & { enabled: boolean; entry: OppFixtureState | null }> {
  const entry = await fixtureState();
  if (entry) {
    const held = oppFixture(entry).get();
    const world = fixtureWorld(entry, await trackingWorld(repo, client), client.id, held);
    return { ...world, enabled: await loadDiyEnabled(null), entry };
  }
  const db = supabaseAdmin();
  const [world, enabled] = await Promise.all([readWorld(db, client.id), loadDiyEnabled(db)]);
  return { ...world, enabled, entry: null };
}

/**
 * What the cited pages in the window say about naming the client, for the
 * cited tab's empty state: the fixture's from its world, Supabase's from the
 * last 28 days of answers, their citations without their brands (citedSummary
 * counts none). Used only when that tab is empty. A failed read throws: the
 * caller's section then shows the plain line, never a claim.
 *
 * `started` (13 Oct 2026, dashboard speed work): the answers read, when the
 * page began it with its first reads because it was on the cited tab - one
 * round trip beside the rest instead of one after them, and a read thrown
 * away whenever the tab has rows (opportunities/page.tsx says why it is
 * kept).
 */
export async function loadCitedSummary(repo: TrackingRepo, client: Client, world: OppWorld, started?: Promise<TrackingWorld>): Promise<CitedSummary> {
  if (world.cited) return world.cited;
  const t = await (started ?? citedWorld(repo, client));
  return citedSummary({ answers: t.answers, questions: t.questions, today: t.today, domain: t.domain, engines: t.engines }, world.reads);
}

/**
 * The words a refused read's toast needs from this client: the day its
 * allowance month turns, and the used-up line for its link checks (which Log
 * a site and Verify now share).
 */
export function linkCheckWords(client: Pick<Client, "market" | "trial_ends_at">, now: number): { resets: string; allowanceLine: string | null } {
  const trial = Boolean(client.trial_ends_at && Date.parse(client.trial_ends_at) > now);
  const limit = allowanceFor("link_checks", { trial });
  return { resets: allowanceMonth(client.market, now).resetsLabel, allowanceLine: usedUpLine("link_checks", limit, { trial, market: client.market }, now) };
}

/** The client's ranking page for a keyword and its key pages, for "What to point it at". */
export async function loadTargets(client: Client, keywordId: string | null, today: Day, entry: OppFixtureState | null): Promise<{ ranking: string | null; keyPages: { url: string; clusterIds: string[]; origin?: string; addedOn?: string }[] }> {
  if (entry) {
    const top = (entry.serpTop ?? []).find((s) => s.keyword_id === keywordId)?.top ?? [];
    const own = top.find((t) => {
      const k = citationKey({ source_domain: t.domain ?? "", url: t.url });
      return k && (k.host === client.domain || k.host.endsWith(`.${client.domain}`));
    });
    return { ranking: own?.url ?? null, keyPages: entry.keyPages ?? [] };
  }
  const db = supabaseAdmin();
  const [ranking, keyPages] = await Promise.all([keywordId ? readRankingUrl(db, client.id, keywordId, today) : Promise.resolve(null), readKeyPages(db, client.id)]);
  return { ranking, keyPages };
}

/** The DiyClient runOnDemand takes: Supabase's, or the fixture client's. Null when it cannot be read. */
export async function diyClientFor(client: Client, repo: TrackingRepo, mode: string): Promise<DiyClient | null> {
  if (diyFixtureState() !== null) return fixtureDiyClient(client as unknown as Fixture["client"], { setupConfirmed: true, upsellMode: mode }, repo.now());
  return loadDiyClient(supabaseAdmin(), client.id, repo.now());
}

// ---- The fixture's write twins ----

/** Apply a patch to one fixture row: its overlay for a derived row, the row itself for a logged one. False when read-only. */
export function writeFixtureRow(entry: OppFixtureState, o: Opportunity, patch: Record<string, unknown>): boolean {
  const store = oppFixture(entry);
  const held = store.get();
  const at = held.logged.findIndex((r) => String(r.id) === o.id);
  if (at >= 0) {
    held.logged[at] = { ...held.logged[at], ...patch };
    return store.write(held);
  }
  const key = overlayKey(o);
  const had: Overlay = held.state[key] ?? { id: o.id };
  held.state[key] = { ...had, ...(patch as Overlay), id: o.id };
  return store.write(held);
}

/** A new logged row on the fixture. False when read-only. */
export function addFixtureLogged(entry: OppFixtureState, row: Record<string, unknown>): boolean {
  const store = oppFixture(entry);
  const held = store.get();
  held.logged.push(row);
  return store.write(held);
}

/** The prompt step on the tracking fixture: its own slot and stop twins, the origin columns set as the database holds them. */
export function fixturePromptPort(entry: OppFixtureState, p: { client: Client; today: Day; role: string; rows: () => Opportunity[] }): PromptPort {
  const f = () => writableFixture();
  const questions = () => f()?.data.questions ?? [];
  return {
    async live(clusterId) {
      return questions()
        .filter((q) => q.cluster_id === clusterId && q.stopped_on === null)
        .map((q) => ({ id: q.id, text: q.text, angle: q.angle, added_on: q.added_on, placement: placementAllowance(q) }));
    },
    async room(clusterId) {
      const fx = f();
      if (!fx) return 0;
      const live = fx.data.questions.filter((q) => q.stopped_on === null && !placementAllowance(q));
      return promptRoom({ clientLive: live.length, clusterLive: live.filter((q) => q.cluster_id === clusterId).length, clusterLimit: fx.client.cluster_limit ?? CLUSTER_BASE });
    },
    async insert(clusterId, row) {
      let id: string | undefined;
      const r = writeFixture((fx) => {
        const made = fixtureFillSlot(fx, { clusterId, angle: row.angle, text: row.text, today: p.today, role: p.role });
        if (!made.ok) return made;
        id = made.id;
        const tagged = made.fixture.data.questions.map((q) => (q.id === made.id ? { ...q, source: "client", origin_kind: "opportunity", origin_ref: row.originRef } : q));
        return { ok: true, fixture: { ...made.fixture, data: { ...made.fixture.data, questions: tagged } } };
      });
      if (!r) return { ok: false, message: "This preview doesn't save changes." };
      return r.ok && id ? { ok: true, id } : { ok: false, message: r.ok ? "The prompt was not added." : r.message };
    },
    async stop(id) {
      const r = writeFixture((fx) => fixtureStop(fx, { kind: "prompt", id, today: p.today, role: p.role, undo: false }));
      return !r ? { ok: false, message: "This preview doesn't save changes." } : r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    async undoStop(id) {
      const r = writeFixture((fx) => fixtureStop(fx, { kind: "prompt", id, today: p.today, role: p.role, undo: true }));
      return !r ? { ok: false, message: "This preview doesn't save changes." } : r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    async readings(id) {
      return (f()?.data.answers ?? []).filter((a) => a.question_id === id).length;
    },
    async link(opportunityId, promptId) {
      const o = p.rows().find((r) => r.id === opportunityId);
      if (o) writeFixtureRow(entry, o, { prompt_id: promptId });
    },
  };
}

/** One prompt of the fixture client, for Undo. */
export function fixturePrompt(id: string): { id: string; origin_ref: string | null; added_on: Day; stopped_on: Day | null } | null {
  const q = writableFixture()?.data.questions.find((x) => x.id === id) as (Fixture["data"]["questions"][number] & { origin_ref?: string | null }) | undefined;
  return q ? { id: q.id, origin_ref: q.origin_ref ?? null, added_on: q.added_on, stopped_on: q.stopped_on } : null;
}

export type { SupabaseClient };
