import "server-only";

import { fixtureDiyClient, loadDiyClient, type DiyClient } from "@/lib/diy/core/client";
import { allowanceMonth } from "@/lib/diy/core/allowances";
import { diyFixtureState, readDiyFixture } from "@/lib/diy/core/fixture";
import { loadDiyEnabled } from "@/lib/diy/core/settings";
import type { CoreFixture } from "@/lib/diy/core/usage-meter";
import { countActive } from "@/lib/diy/opportunities/status";
import { loadOppWorld } from "@/lib/diy/opportunities/world";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Fixture } from "@/lib/tracking/fixture-mode";
import type { MemberClient } from "@/lib/tracking/member";
import type { TrackingRepo } from "@/lib/tracking/repo";

import { type Access, readLinksAccess } from "./access";
import { firstReadOn, fixtureLinksWorld, linkChecksUsed, linksChecksUsedFixture, linksFixture, linksStore, readChecks, readLatest, readLinkJobs, readLinkRows, readSet, revealsUsed } from "./data";
import { NONE_PLACED, readPlacedDomains } from "./nomada-placements";
import type { Stored } from "./types";
import type { LinksWorld, WorldPart } from "./view";

/**
 * The server's way in to Links (13 Oct 2026, DIY P10): the world the page
 * draws, from Supabase with the service role, or from the fixture
 * (`links.json` for the DIY state, its write twins held in memory, and the
 * pursued link rows from P7's fixture world, so a row pursued here shows on
 * Opportunities and back here). Server-only.
 */

export type Client = MemberClient & { role: string };

/**
 * Everything Links draws, each read on its own (13 Oct 2026, review of DIY
 * P10: one failed read of fourteen took the whole page, Check a link and the
 * wins with it). A read that fails is logged, named in `unread` and stood in
 * for by an empty value, which the page never draws: each section needing it
 * says it could not be read (view.ts NEEDS), and a list is never drawn
 * without the placements to subtract.
 */
export async function loadLinksWorld(repo: TrackingRepo, client: Client): Promise<LinksWorld> {
  const today = repo.today();
  const unread = new Set<WorldPart>();
  const part = async <T>(name: WorldPart, read: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await read();
    } catch (err) {
      console.warn(`[diy] links ${name}: ${err instanceof Error ? err.message : String(err)}`);
      unread.add(name);
      return empty;
    }
  };
  const monthStart = allowanceMonth(client.market, repo.now()).start;
  if (diyFixtureState() !== null) {
    // The pursued link rows live in P7's fixture world, where this page's Pursue writes them.
    const opp = await part("link_rows", () => loadOppWorld(repo, client), null);
    const enabled = await part("enabled", () => loadDiyEnabled(null), false);
    return fixtureLinksWorld(linksFixture(), linksStore().get(), { clientId: client.id, today, enabled, oppRows: opp?.rows ?? [], monthStart, unread });
  }
  const db = supabaseAdmin();
  const NONE: Stored<never> | null = null;
  const [enabled, access, summary, newLost, series, bulk, gap, pages, mentions, set, placed, linkRows, revealsThisMonth, checks, jobs] = await Promise.all([
    part("enabled", () => loadDiyEnabled(db), false),
    part("access", () => readLinksAccess(db), { state: "not_read", at: null, code: null } as Access),
    part("summary", () => readLatest(db, client.id, "summary"), NONE),
    part("new_lost", () => readLatest(db, client.id, "new_lost"), NONE),
    part("timeseries", () => readLatest(db, client.id, "timeseries"), NONE),
    part("bulk", () => readLatest(db, client.id, "bulk"), NONE),
    part("domain_gap", () => readLatest(db, client.id, "domain_gap"), NONE),
    part("page_gap", () => readLatest(db, client.id, "page_gap"), NONE),
    part("mentions", () => readLatest(db, client.id, "mentions"), NONE),
    part("set", () => readSet(db, client.id), null),
    part("placed", () => readPlacedDomains(db, client.id), NONE_PLACED),
    part("link_rows", () => readLinkRows(db, client.id), []),
    part("reveals", () => revealsUsed(db, { id: client.id, market: client.market }, repo.now()), null),
    part("checks", () => readChecks(db, client.id), []),
    part("jobs", () => readLinkJobs(db, client.id), { weekly: null, monthly: null }),
  ]);
  return {
    enabled,
    access,
    summary: summary as LinksWorld["summary"],
    newLost: newLost as LinksWorld["newLost"],
    series: series as LinksWorld["series"],
    bulk: bulk as LinksWorld["bulk"],
    gap: gap as LinksWorld["gap"],
    pages: pages as LinksWorld["pages"],
    mentions: mentions as LinksWorld["mentions"],
    set,
    placed,
    linkRows,
    revealsThisMonth,
    checks,
    firstRead: firstReadOn(jobs.weekly, today),
    jobFailed: [jobs.weekly, jobs.monthly].some((j) => j?.outcome === "failed"),
    unread,
  };
}

/** The DiyClient runOnDemand takes: Supabase's, or the fixture client's. Null when it cannot be read. */
export async function diyClientFor(client: Client, repo: TrackingRepo, mode: string): Promise<DiyClient | null> {
  if (diyFixtureState() !== null) return fixtureDiyClient(client as unknown as Fixture["client"], { setupConfirmed: true, upsellMode: mode }, repo.now());
  return loadDiyClient(supabaseAdmin(), client.id, repo.now());
}

/** Pages in Pursuing or Pitched across every lens (P7's cap counts them all): the fixture world's, or the table's. Throws when it cannot be counted. */
export async function loadActivePursuits(repo: TrackingRepo, client: Client): Promise<number> {
  if (diyFixtureState() !== null) return (await loadOppWorld(repo, client)).rows.filter((o) => o.status === "pursuing" || o.status === "pitched").length;
  return countActive(supabaseAdmin(), client.id);
}

/** "Check a link" uses this month: the fixture's count, or the table's (data.ts linkChecksUsed, usage-meter.ts countUsage). Throws when it cannot be counted. */
export async function loadChecksUsed(repo: TrackingRepo, client: Client, now: number): Promise<number> {
  if (diyFixtureState() !== null) return linksChecksUsedFixture(readDiyFixture<CoreFixture>("core").reads, (await loadOppWorld(repo, client)).rows, allowanceMonth(client.market, now).start);
  return linkChecksUsed(supabaseAdmin(), { id: client.id, market: client.market }, now);
}
