import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { type DiyClient, diyClient } from "@/lib/diy/core/client";
import { loadDiyEnabled } from "@/lib/diy/core/settings";
import { type DiyUsage, loadDiyUsage } from "@/lib/diy/core/usage-meter";
import { readPlan, section, type Section } from "@/lib/diy/plan/data";
import type { PlanItem } from "@/lib/diy/plan/types";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { type Day, addDays, citedPageRows } from "@/lib/tracking/figures";
import type { MemberClient } from "@/lib/tracking/member";
import type { TrackingRepo } from "@/lib/tracking/repo";
import type { UpgradeContext } from "@/lib/tracking/upgrade-context";

import { CITED_DAYS } from "./key-pages";
import { lastNightFailed, readPagesPart, readPagesSerp } from "./data";
import type { Cluster, Keyword, PagesInput, Prompt } from "./view";

/**
 * Everything Your pages' two pages read (13 Oct 2026, DIY P8), each read as
 * its own section: a failed read says so on the page and never reads as
 * empty or zero (spec 10 section 3.4). Server only: the tracking repo and the
 * admin client are behind it.
 *
 * The dark rule (spec 10 section 4): while DIY is off, anything that exists
 * only because of a paid read - the JavaScript and validator reads, the top
 * results' structure, the drafted examples - is left out, so the page shows
 * what our own free reads found and never promises a read that will not
 * happen.
 */

export type PagesLoad = {
  /** The page's whole input, or null when one of its core reads failed. */
  input: PagesInput | null;
  enabled: boolean;
  usage: DiyUsage | null;
  upgrade: UpgradeContext;
  diy: DiyClient;
  failedNight: boolean;
  /** Each own page's citations in 28 days could not be read: the column says so. */
  citedRead: boolean;
  items: Section<PlanItem[]>;
};

export async function loadPages(p: { repo: TrackingRepo; client: MemberClient; email: string; today: Day; now: number }): Promise<PagesLoad> {
  const { repo, client, today } = p;
  const fixture = fixtureMode();
  const db = fixture ? null : () => supabaseAdmin();
  const upgrade = await repo.upgradeContext(client.id, p.email, today);
  const diy = diyClient(
    { id: client.id, slug: client.slug, domain: client.domain, brand_name: client.brand, market: client.market, tier: client.tier, started_on: client.started_on, status: client.status ?? "active", trial_ends_at: client.trial_ends_at ?? null },
    { setupConfirmedAt: null, upsellMode: upgrade.mode },
    p.now,
  );
  const [enabled, structure, keyPages, checks, bots, examples, top, jobs, items] = await Promise.all([
    loadDiyEnabled(fixture ? null : supabaseAdmin()),
    section("pages structure", () => repo.structure(client.id)),
    section("pages key pages", () => readPagesPart("keyPages", db, client.id, today)),
    section("pages checks", () => readPagesPart("checks", db, client.id, today)),
    section("pages bots", () => readPagesPart("bots", db, client.id, today)),
    section("pages examples", () => readPagesPart("examples", db, client.id, today)),
    section("pages top", () => readPagesPart("top", db, client.id, today)),
    section("pages jobs", () => readPagesPart("jobs", db, client.id, today)),
    section("pages plan", () => readPlan(() => supabaseAdmin(), client.id)),
  ]);
  const usage = await section("pages usage", () => loadDiyUsage(fixture ? null : supabaseAdmin(), diy, p.now));

  const clusters: Cluster[] = structure.ok ? structure.value.clusters.map((c) => ({ id: c.id, name: c.name, keywordId: c.keyword_id ?? null, stoppedOn: c.stopped_on })) : [];
  const keywords: Keyword[] = structure.ok ? structure.value.keywords.map((k) => ({ id: k.id, keyword: k.keyword, volume: typeof k.search_volume === "number" ? k.search_volume : null })) : [];
  const prompts: Prompt[] = structure.ok ? structure.value.questions.map((q) => ({ id: q.id, text: q.text, clusterId: q.cluster_id ?? null, stoppedOn: q.stopped_on })) : [];
  const keywordIds = clusters.filter((c) => c.stoppedOn === null && c.keywordId).map((c) => c.keywordId!);
  const serp = await section("pages serp", () => readPagesSerp(db, client.id, keywordIds, today));

  // Citations of the client's own pages in 28 days: Cited pages' own count (figures.ts citedPageRows), by url_key.
  const range = { from: addDays(today, -(CITED_DAYS - 1)), to: today };
  const cited = await section("pages cited", async () => {
    const data = await repo.loadOverview(client.id, range, "none", { answers: "cites", ...(structure.ok ? { structure: structure.value } : {}) });
    return new Map(citedPageRows(data.answers, range, client.domain).filter((r) => r.yours).map((r) => [r.page, r.count] as const));
  });

  const core = structure.ok && keyPages.ok && checks.ok && bots.ok && serp.ok;
  // Dark: what only a paid read made is left out.
  const paid = <T,>(s: Section<T[]>): T[] => (enabled && s.ok ? s.value : []);
  const input: PagesInput | null = core
    ? {
        domain: client.domain,
        keyPages: keyPages.value,
        checks: enabled ? checks.value : checks.value.filter((c) => c.via === "own"),
        bots: bots.value,
        examples: paid(examples),
        top: paid(top),
        serp: serp.value,
        clusters,
        keywords,
        prompts,
        cited: cited.ok ? cited.value : new Map(),
        items: items.ok ? items.value : [],
        today,
      }
    : null;
  return { input, enabled, usage: usage.ok ? usage.value : null, upgrade, diy, failedNight: jobs.ok && lastNightFailed(jobs.value), citedRead: cited.ok, items };
}
