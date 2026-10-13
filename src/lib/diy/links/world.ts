import "server-only";

import { fixtureDiyClient, loadDiyClient, type DiyClient } from "@/lib/diy/core/client";
import { diyFixtureState } from "@/lib/diy/core/fixture";
import { loadDiyEnabled } from "@/lib/diy/core/settings";
import { countActive } from "@/lib/diy/opportunities/status";
import { loadOppWorld } from "@/lib/diy/opportunities/world";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Fixture } from "@/lib/tracking/fixture-mode";
import type { MemberClient } from "@/lib/tracking/member";
import type { TrackingRepo } from "@/lib/tracking/repo";

import { readLinksAccess } from "./access";
import { firstReadOn, fixtureLinksWorld, linkChecksUsed, linksChecksUsedFixture, linksFixture, linksStore, readChecks, readLatest, readLinkJobs, readLinkRows, readSet } from "./data";
import { readPlacedDomains } from "./nomada-placements";
import type { LinksWorld } from "./view";

/**
 * The server's way in to Links (13 Oct 2026, DIY P10): the world the page
 * draws, from Supabase with the service role, or from the fixture
 * (`links.json` for the DIY state, its write twins held in memory, and the
 * pursued link rows from P7's fixture world, so a row pursued here shows on
 * Opportunities and back here). Server-only.
 */

export type Client = MemberClient & { role: string };

/** Everything Links draws. A failed read throws: the page says it could not read, never "none". */
export async function loadLinksWorld(repo: TrackingRepo, client: Client): Promise<LinksWorld> {
  const today = repo.today();
  if (diyFixtureState() !== null) {
    // The pursued link rows live in P7's fixture world, where this page's Pursue writes them.
    const opp = await loadOppWorld(repo, client);
    return fixtureLinksWorld(linksFixture(), linksStore().get(), { clientId: client.id, today, enabled: await loadDiyEnabled(null), oppRows: opp.rows });
  }
  const db = supabaseAdmin();
  const [enabled, access, summary, newLost, series, bulk, gap, pages, mentions, set, placed, linkRows, checks, jobs] = await Promise.all([
    loadDiyEnabled(db),
    readLinksAccess(db),
    readLatest(db, client.id, "summary"),
    readLatest(db, client.id, "new_lost"),
    readLatest(db, client.id, "timeseries"),
    readLatest(db, client.id, "bulk"),
    readLatest(db, client.id, "domain_gap"),
    readLatest(db, client.id, "page_gap"),
    readLatest(db, client.id, "mentions"),
    readSet(db, client.id),
    readPlacedDomains(db, client.id),
    readLinkRows(db, client.id),
    readChecks(db, client.id),
    readLinkJobs(db, client.id),
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
    checks,
    firstRead: firstReadOn(jobs.weekly, today),
    jobFailed: [jobs.weekly, jobs.monthly].some((j) => j?.outcome === "failed"),
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

/** "Check a link" uses this month: the fixture's count, or the table's (data.ts linkChecksUsed). Throws when it cannot be counted. */
export async function loadChecksUsed(client: Client, now: number): Promise<number> {
  if (diyFixtureState() !== null) return linksChecksUsedFixture(linksFixture(), linksStore().get());
  return linkChecksUsed(supabaseAdmin(), { id: client.id, market: client.market }, now);
}
