import type { MentionCandidate, ParsedPage } from "../../scan/dataforseo-request.ts";
import type { Day } from "../../tracking/figures.ts";
import type { Subject } from "../../tracking/limits.ts";
import { urlKey } from "../../tracking/placements.ts";
import { type GuardedGet, readGuardedPage } from "../core/fetch.ts";
import { blockedFacts, factsFromHtml, factsFromParsed } from "../opportunities/read-page.ts";
import type { PageFacts } from "../opportunities/types.ts";

import type { FallbackRead } from "./check-link.ts";
import { type Placed, bareHost, isPlacedUrl, onPlacedDomain } from "./nomada-placements.ts";
import type { Mention, Mentions } from "./types.ts";

/**
 * Mentions without a link (13 Oct 2026, DIY P10; spec 10 sections 4.8 row 5
 * and 6.3). The content search gives candidates - pages DataForSEO's index
 * says mention the brand - and **none is shown until our own read confirms
 * it**: up to 30 a month are read (our own fetch, then a `content_parsing`
 * fallback when robots.txt keeps us out), and a row is kept only when the
 * page names the client (`namesBrandIn`, over everything a reader sees) and
 * has no link to the client's site. A page we could not read is dropped,
 * never shown as "doesn't link". The fallback returns links without `rel`,
 * which is enough here: the question is whether any link to the client
 * exists. It returns no body text either, so it confirms a mention only when
 * the title, a heading or a link's words name the client.
 *
 * Candidates on the client's own site, on a compared site, on a domain where
 * Nomada has placed another client, or on a placed page, are dropped before
 * anything is read.
 */

export const MENTION_READS = 30;

/** The candidates worth reading, in the search's order, at most MENTION_READS. */
export function mentionCandidates(rows: readonly MentionCandidate[], p: { client: string; compared: readonly string[]; placed: Placed }): MentionCandidate[] {
  const own = bareHost(p.client);
  const compared = new Set(p.compared.map(bareHost));
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const r of rows) {
    const d = bareHost(r.domain);
    if (d === own || d.endsWith(`.${own}`) || compared.has(d)) continue;
    if (onPlacedDomain(d, p.placed) || isPlacedUrl(r.url, p.placed)) continue;
    const key = urlKey(r.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, domain: d });
    if (out.length >= MENTION_READS) break;
  }
  return out;
}

export type Verdict = { keep: Mention } | { drop: "unreadable" | "linked" | "unnamed" };

/** What one read says about one candidate. Pure. */
export function verdictOf(c: MentionCandidate, facts: PageFacts, today: Day): Verdict {
  if (facts.status !== "ok") return { drop: "unreadable" };
  if (facts.linksToClient === true) return { drop: "linked" };
  if (facts.namesClient !== true) return { drop: "unnamed" };
  // The fallback read sees links; one with none at all cannot say there is no link to the client.
  if (facts.linksToClient === null) return { drop: "unreadable" };
  return {
    keep: {
      url: c.url.slice(0, 500),
      urlKey: urlKey(c.url) ?? c.url,
      domain: c.domain,
      title: facts.title ?? c.title,
      published: c.published,
      snippet: (facts.snippet ?? c.snippet)?.slice(0, 200) ?? null,
      readOn: today,
      via: facts.via,
    },
  };
}

export type ConfirmDeps = { get: GuardedGet; fallback: ((url: string) => Promise<FallbackRead>) | null; today: Day; now: () => number; deadlineMs: number };

/** One candidate read: our fetch, then the fallback when robots.txt keeps us out. */
export async function readCandidate(c: MentionCandidate, subject: Subject, deps: ConfirmDeps): Promise<PageFacts> {
  const key = urlKey(c.url) ?? c.url;
  const at = new Date(deps.now()).toISOString();
  const own = await readGuardedPage(c.url, { get: deps.get, thirdParty: true });
  if (own.ok) return factsFromHtml({ url: c.url, urlKey: key, at, today: deps.today, read: { status: own.status, html: own.html, contentType: own.headers["content-type"] ?? null }, subject, competitors: [] });
  if (own.why !== "robots" || !deps.fallback) return blockedFacts({ url: c.url, urlKey: key, at, why: own.why });
  const got = await deps.fallback(c.url);
  if (got.kind !== "read") return blockedFacts({ url: c.url, urlKey: key, at, why: "robots" });
  return factsFromParsed({ url: c.url, urlKey: key, at, today: deps.today, parsed: got.value as ParsedPage | null, subject, competitors: [] });
}

/** Read the candidates, four at a time, until the deadline; keep the confirmed ones. A candidate not read in time is not counted either way. */
export async function confirmMentions(candidates: readonly MentionCandidate[], subject: Subject, deps: ConfirmDeps): Promise<Mentions & { read: number; facts: PageFacts[] }> {
  const confirmed: Mention[] = [];
  const dropped = { unreadable: 0, linked: 0, unnamed: 0 };
  const facts: PageFacts[] = [];
  let read = 0;
  const queue = [...candidates];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (deps.deadlineMs - deps.now() < 15_000) return;
      let f: PageFacts;
      try {
        f = await readCandidate(c, subject, deps);
      } catch (err) {
        console.warn(`[diy] links mentions: ${err instanceof Error ? err.message : String(err)}`);
        dropped.unreadable++;
        continue;
      }
      read++;
      facts.push(f);
      const v = verdictOf(c, f, deps.today);
      if ("keep" in v) confirmed.push(v.keep);
      else dropped[v.drop]++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const order = new Map(candidates.map((c, i) => [c.url, i]));
  confirmed.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0));
  return { candidates: candidates.length, confirmed, dropped, read, facts };
}
