import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, addDays } from "../../tracking/figures.ts";
import { pool } from "../core/ctx.ts";
import type { GuardedGet } from "../core/fetch.ts";
import { FETCH_TIMEOUT_MS, ROBOTS_CAP_BYTES } from "../core/fetch.ts";
import type { JobContext, JobHandler, JobResult } from "../core/jobs.ts";
import { loadPlanItems } from "../plan/data.ts";
import { markVerified } from "../plan/write.ts";
import { LINK_CHECK_UA } from "../../tracking/placements.ts";
import { urlKey } from "../../tracking/placements.ts";
import { insertCheck, ownCheck } from "./check.ts";
import { WEEKLY_KIND, readBots, readChecks, readExamples } from "./data.ts";
import { type Candidate as PageCandidate, citedOwnPages, homepageOf, insertKeyPage, pickKeyPages, readKeyPages, setKeyPageClusters } from "./key-pages.ts";
import { botPage, crawlerAccess, hostOf, onMainHost, robotsState } from "./robots.ts";
import type { BotCheck, KeyPage, PageCheck } from "./types.ts";
import { verifyClientItem, verifyItem } from "./verify.ts";

/**
 * `key_pages_weekly` (13 Oct 2026, DIY P8; spec 10 sections 5.7 and 6.4):
 * free, weekly on the client's start weekday, and on onboarding. Own fetches
 * only - it is handed no ReadCtx, so it cannot make a paid read.
 *
 * 1. Picks automatic key pages until 10 are live (key-pages.ts), from the
 *    homepage, each live cluster's latest ranking URL, and the client's own
 *    pages the engines cited in 28 days; brings each live page's clusters up
 *    to date.
 * 2. Reads each live key page with our own fetch, at most 4 at once, into
 *    page_checks (`via = 'own'`).
 * 3. Reads robots.txt and llms.txt, and writes bot_checks: each crawler's
 *    verdict over the key page paths, and each page's status, noindex and
 *    canonical. Each page is judged by its own host's robots.txt: the
 *    client's domain is read as before, and each subdomain a key page is on
 *    has its own file read and its own verdicts (at most HOSTS_MAX).
 * 4. Verifies the Actions items done on a key page, and the crawler items that
 *    cover several (verify.ts), through P3's markVerified.
 *
 * A candidate page whose address is longer than key_pages allows is left out
 * by the pick, and one the database refuses all the same (its check) is a
 * note in the result, never the job's failure (13 Oct 2026, DIY P8 review).
 *
 * A factory, so the shell registers it in wiring.ts without this file
 * importing the crawler: the live fetch (`guardedRead` in scan/crawl.ts,
 * server-only) is imported when the job first runs, and the tests hand in
 * their own. Every page read is its own: one that fails is an unreadable
 * row, never the job's failure. A failed database read or write fails the job
 * with its message, so the worker marks it failed and it retries.
 */

export type WeeklyDeps = { get?: GuardedGet; now?: () => number };

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function liveGet(): Promise<GuardedGet> {
  const { guardedRead } = await import("../../scan/crawl.ts");
  return guardedRead;
}

type Structure = { clusters: { id: string; keywordId: string | null; stoppedOn: string | null }[] };

async function readClusters(db: SupabaseClient, clientId: string): Promise<Structure["clusters"]> {
  const { data, error } = await db.from("tracked_clusters").select("id, keyword_id, stopped_on").eq("client_domain_id", clientId).limit(200);
  if (error) throw new Error(`could not read the clusters: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((c) => ({ id: String(c.id), keywordId: c.keyword_id == null ? null : String(c.keyword_id), stoppedOn: c.stopped_on ? String(c.stopped_on) : null }));
}

/** Each live cluster's latest ranking URL over the last two weeks. */
async function rankingUrls(db: SupabaseClient, clientId: string, clusters: Structure["clusters"], today: Day): Promise<PageCandidate[]> {
  const live = clusters.filter((c) => c.stoppedOn === null && c.keywordId);
  if (!live.length) return [];
  const { data, error } = await db
    .from("tracking_serp")
    .select("run_date, keyword_id, url")
    .eq("client_domain_id", clientId)
    .gte("run_date", addDays(today, -14))
    .not("url", "is", null)
    .order("run_date", { ascending: false })
    .limit(500);
  if (error) throw new Error(`could not read the ranking pages: ${error.message}`);
  const latest = new Map<string, string>();
  for (const r of (data ?? []) as { keyword_id: string; url: string | null }[]) if (r.url && !latest.has(r.keyword_id)) latest.set(r.keyword_id, r.url);
  return live.flatMap((c) => {
    const url = latest.get(c.keywordId!);
    return url ? [{ url, origin: "ranking" as const, clusterIds: [c.id] }] : [];
  });
}

type RobotsRead = { status: number | null; txt: string | null };

/** Other hosts' robots.txt read in one weekly run, at most: key pages are at most 10, so this is every subdomain they could be on. */
export const HOSTS_MAX = 5;

const ROBOTS_OPTS = { capBytes: ROBOTS_CAP_BYTES, ua: LINK_CHECK_UA, timeoutMs: FETCH_TIMEOUT_MS };

async function readRobotsAt(origin: string, get: GuardedGet): Promise<RobotsRead> {
  const r = await get(`${origin}/robots.txt`, ROBOTS_OPTS);
  return r.ok ? { status: r.status, txt: r.html } : { status: null, txt: null };
}

/** robots.txt and llms.txt on the client's own domain, read as our own fetch of the client's own site. */
async function readRobots(domain: string, get: GuardedGet): Promise<{ robots: RobotsRead; llms: number | null }> {
  const origin = homepageOf(domain).replace(/\/$/, "");
  const [robots, l] = await Promise.all([readRobotsAt(origin, get), get(`${origin}/llms.txt`, { ...ROBOTS_OPTS, capBytes: 4096 })]);
  return { robots, llms: l.ok ? l.status : null };
}

/** Each other host a key page is on (a subdomain), with the origin to read its robots.txt from, at most HOSTS_MAX. */
export function otherHosts(pages: readonly KeyPage[], domain: string): { host: string; origin: string }[] {
  const out = new Map<string, string>();
  for (const k of pages) {
    if (onMainHost(k.url, domain)) continue;
    const host = hostOf(k.url);
    if (!host || out.has(host)) continue;
    try {
      const u = new URL(k.url);
      out.set(host, `https://${u.hostname.toLowerCase()}`);
    } catch {
      continue;
    }
  }
  return [...out].slice(0, HOSTS_MAX).map(([host, origin]) => ({ host, origin }));
}

export function botRow(p: { clientId: string; now: number; domain: string; robots: RobotsRead; llms: number | null; hosts?: readonly { host: string; robots: RobotsRead }[]; pages: readonly KeyPage[]; reads: ReadonlyMap<string, Record<string, unknown>> }): Record<string, unknown> {
  // Each page against its own host's file: the domain's pages here, each subdomain's below.
  const crawlers = crawlerAccess(p.robots, p.pages.filter((k) => onMainHost(k.url, p.domain)).map((k) => pathFor(k.url)));
  const state = robotsState(p.robots);
  const hosts = (p.hosts ?? []).map((h) => ({
    host: h.host,
    robots_status: h.robots.status,
    state: robotsState(h.robots).kind,
    crawlers: crawlerAccess(h.robots, p.pages.filter((k) => hostOf(k.url) === h.host).map((k) => pathFor(k.url))) ?? [],
  }));
  return {
    client_domain_id: p.clientId,
    checked_at: new Date(p.now).toISOString(),
    robots_status: p.robots.status,
    robots: { state: state.kind, crawlers: crawlers ?? [], hosts },
    llms_txt_status: p.llms,
    pages: p.pages.map((k) => {
      const r = p.reads.get(k.id);
      // What a page we could not read cannot say is null, drawn "Not read": never "No" for a page unread.
      const read = r?.status === "ok";
      const basics = (read ? (r?.basics ?? null) : null) as { noindex?: boolean; canonical?: string | null } | null;
      return botPage({ urlKey: k.urlKey, httpStatus: (r?.http_status as number | null) ?? null, read, noindex: basics?.noindex === true, canonical: basics?.canonical ?? null, selfKey: k.urlKey, canonicalKey: basics?.canonical ? urlKey(basics.canonical) : null });
    }),
  };
}

function pathFor(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

/**
 * Write each verification the latest reads support, through P3's
 * markVerified. Answers how many items were verified. The client's items are
 * read once: an item on one key page (its ref) is verified against that page,
 * and a crawler item that covers several key pages, which has no ref, by its
 * dedupe key (13 Oct 2026, DIY P8 review: it was never looked at).
 */
export async function verifyDone(db: SupabaseClient, clientId: string, pages: readonly KeyPage[], read: { checks: readonly PageCheck[]; bots: readonly BotCheck[]; today: Day }): Promise<number> {
  const [examples, items] = await Promise.all([readExamples(db, clientId), loadPlanItems(db, clientId)]);
  let n = 0;
  for (const item of items) {
    if (item.status !== "done") continue;
    const page = item.refTable === "key_pages" ? (pages.find((p) => p.id === item.refId) ?? null) : null;
    const v = page ? verifyItem(item, page, { ...read, examples }) : item.refTable === null ? verifyClientItem(item, read) : null;
    if (!v) continue;
    if (await markVerified(db, item.id, { by: "system", at: v.at, text: v.text })) n++;
  }
  return n;
}

export function keyPagesWeeklyHandler(deps: WeeklyDeps = {}): JobHandler {
  return {
    kind: WEEKLY_KIND,
    paid: false,
    cadence: "weekly",
    priority: 3,
    onboarding: true,
    async run(ctx: JobContext): Promise<JobResult> {
      const now = deps.now ?? Date.now;
      const get = deps.get ?? (await liveGet());
      const { db, client, today } = ctx;
      const trigger = ctx.onboarding ? "onboarding" : "scheduled";

      // 1. Pick.
      const [rows, clusters] = await Promise.all([readKeyPages(db, client.id), readClusters(db, client.id)]);
      const candidates: PageCandidate[] = [{ url: homepageOf(client.domain), origin: "homepage", clusterIds: [] }, ...(await rankingUrls(db, client.id, clusters, today))];
      let citedNote = "";
      try {
        for (const c of (await citedOwnPages(db, client, today)).slice(0, 10)) candidates.push({ url: c.url, origin: "cited_own", clusterIds: [] });
      } catch (err) {
        // The cited pages are one source of four: without them the rest still pick, and the note says so.
        console.warn(`[diy] key_pages_weekly ${client.domain}: cited pages: ${msg(err)}`);
        citedNote = "; cited pages not read";
      }
      const pick = pickKeyPages({ rows, candidates, domain: client.domain });
      let added = 0;
      let refused = pick.tooLong;
      for (const a of pick.add) {
        const r = await insertKeyPage(db, client.id, { ...a, by: "system", today });
        if (r === "added") added++;
        else if (r === "refused") refused++;
      }
      for (const c of pick.clusters) await setKeyPageClusters(db, client.id, c.id, c.clusterIds);
      const live = (await readKeyPages(db, client.id)).filter((k) => k.removedOn === null);

      // 2. Read each page: at most 4 at once, each inside the job's deadline.
      const p4 = pool(4);
      const reads = new Map<string, Record<string, unknown>>();
      let unreadable = 0;
      let skipped = 0;
      await Promise.all(
        live.map((page) =>
          p4.run(async () => {
            if (now() > ctx.deadlineMs - 15_000) {
              skipped++;
              return;
            }
            const r = await ownCheck({ clientId: client.id, page, homepage: page.origin === "homepage", trigger, now: now(), get });
            reads.set(page.id, r.row);
            if (r.row.status !== "ok") unreadable++;
          }),
        ),
      );
      for (const page of live) {
        const row = reads.get(page.id);
        if (row) await insertCheck(db, row);
      }

      // 3. Crawlers: the domain's robots.txt, and each subdomain's a key page is on.
      const robots = await readRobots(client.domain, get);
      const hosts = await Promise.all(otherHosts(live, client.domain).map(async (h) => ({ host: h.host, robots: await readRobotsAt(h.origin, get) })));
      const bot = botRow({ clientId: client.id, now: now(), domain: client.domain, robots: robots.robots, llms: robots.llms, hosts, pages: live, reads });
      const { error } = await db.from("bot_checks").insert(bot);
      if (error) throw new Error(`could not store the crawler check: ${error.message}`);

      // 4. Verify what was done.
      const [checks, bots] = await Promise.all([readChecks(db, client.id, today), readBots(db, client.id)]);
      const verified = await verifyDone(db, client.id, live, { checks, bots, today });

      const read = reads.size;
      return {
        outcome: "ok",
        note: `${read} of ${live.length} key pages read${unreadable ? `, ${unreadable} unreadable` : ""}${skipped ? `, ${skipped} left for next week (out of time)` : ""}; ${added} added${refused ? `, ${refused} left out (address too long)` : ""}; robots.txt ${robotsState(robots.robots).kind}${hosts.length ? ` (and ${hosts.length} ${hosts.length === 1 ? "subdomain" : "subdomains"})` : ""}; ${verified} verified${citedNote}`,
      };
    },
  };
}

/** The handler the shell registers. */
export const keyPagesWeekly = keyPagesWeeklyHandler();
