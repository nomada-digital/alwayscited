import { ROBOTS_AGENTS } from "../../../config/robots-agents.ts";
import { robotsVerdict } from "../core/fetch.ts";
import type { BotCheck, BotPage, CrawlerVerdict } from "./types.ts";
import { sourceRenders } from "./words.ts";

/**
 * Crawler access (13 Oct 2026, DIY P8; spec 10 sections 4.9 and 6.4): the
 * robots.txt read against each crawler, over the client's key pages. Pure;
 * the fetch is the weekly job's.
 *
 * - For each crawler, the most specific user-agent group, else `*`; for each
 *   key page path, the longest matching Allow or Disallow, Allow winning a
 *   tie (fetch.ts robotsVerdict, RFC 9309). The crawler is allowed (every key
 *   page), partial (some blocked) or blocked (all), with the line that decides
 *   it and `inherited` when that line came from `*`.
 * - A robots.txt answering 4xx is "no robots.txt (HTTP 404)": the status is
 *   stated and nothing is claimed about how crawlers read it; every crawler
 *   reads as allowed, because no rule blocks it. A 5xx, or no answer, is
 *   "could not read", and no verdict is drawn.
 * - What each crawler is for shows only with a verified register source:
 *   Googlebot's is S41 (crawling must be allowed for AI features). The rest
 *   show their name and state until their vendor's dated page is read.
 * - Google-Extended is always a choice, never an error, and never raises an
 *   item.
 * - A Blocking item fires only for a crawler whose source says it serves
 *   search or answers, and is verified.
 * - Each key page is judged by its own host's robots.txt (13 Oct 2026, DIY
 *   P8 review): the client's domain (apex or www) is the main read, and a key
 *   page on a subdomain (blog.<domain>) is judged by that subdomain's own
 *   file, read and stored beside it (BotCheck.hosts). A page whose host's
 *   file was not read has no verdict, never the apex's.
 */

/** The crawlers shown, from the one list robots.txt names (config/robots-agents.ts), less `*` and `anthropic-ai`. */
export const CRAWLERS: readonly string[] = ROBOTS_AGENTS.filter((a) => a !== "*" && a !== "anthropic-ai");

/** Each crawler's register source, and whether that source would say it serves search or answers once verified. */
export const CRAWLER_SOURCE: Record<string, { sourceId: string; serves: boolean }> = {
  Googlebot: { sourceId: "S41", serves: true },
  Bingbot: { sourceId: "V-BING", serves: true },
  GPTBot: { sourceId: "V-OPENAI", serves: false },
  ClaudeBot: { sourceId: "V-ANTHROPIC", serves: false },
  "Google-Extended": { sourceId: "V-GEXTENDED", serves: false },
  PerplexityBot: { sourceId: "V-PERPLEXITY", serves: true },
};

/** The one crawler that is always a choice. */
export const CHOICE_CRAWLER = "Google-Extended";

export type RobotsRead = { status: number | null; txt: string | null };

export type RobotsState = { kind: "read"; status: number } | { kind: "none"; status: number } | { kind: "unreadable"; status: number | null };

/** What the robots.txt answer was: rules to read, no file at all, or nothing readable. */
export function robotsState(r: RobotsRead): RobotsState {
  if (r.status !== null && r.status >= 200 && r.status < 300 && r.txt !== null) return { kind: "read", status: r.status };
  if (r.status !== null && r.status >= 400 && r.status < 500) return { kind: "none", status: r.status };
  return { kind: "unreadable", status: r.status };
}

/** Each crawler's verdict over these key page paths, or null when robots.txt could not be read. */
export function crawlerAccess(r: RobotsRead, paths: readonly string[]): CrawlerVerdict[] | null {
  const state = robotsState(r);
  if (state.kind === "unreadable") return null;
  const txt = state.kind === "read" ? (r.txt ?? "") : "";
  const list = paths.length ? paths : ["/"];
  return CRAWLERS.map((name) => {
    const verdicts = list.map((path) => ({ path, v: robotsVerdict(txt, path, name) }));
    const blocked = verdicts.filter((x) => !x.v.allowed);
    const deciding = blocked[0]?.v ?? null;
    return {
      name,
      state: blocked.length === 0 ? "allowed" : blocked.length === list.length ? "blocked" : "partial",
      inherited: deciding ? deciding.inherited : false,
      line: deciding?.line?.slice(0, 200) ?? null,
      blocked: blocked.map((x) => x.path),
    };
  });
}

/** Whether a block of this crawler raises a Blocking item: its source serves search or answers, and is verified. Never Google-Extended. */
export function raisesBlocking(name: string): boolean {
  if (name === CHOICE_CRAWLER) return false;
  const s = CRAWLER_SOURCE[name];
  return Boolean(s?.serves) && sourceRenders(s!.sourceId);
}

/** The "what it is for" line's advice id, or null while the crawler's source is unverified. */
export function purposeLine(name: string): "pages.bots.googlebot" | null {
  return name === "Googlebot" && sourceRenders("S41") ? "pages.bots.googlebot" : null;
}

/**
 * "Copy the lines to change" for one blocked crawler: the group it is read
 * under, the line to take out, and an Allow for each blocked key page. Our
 * own reading of the file, so it is "Seen in your data": a suggested edit,
 * never a claim about what a crawler then does.
 *
 * A rule inherited from `*` is shared (13 Oct 2026, DIY P8 review): taking
 * the line out, or adding an Allow beside it, opens those paths to every
 * crawler that reads the `*` group, not only this one, and the edit says so.
 * The narrower route - a group of the crawler's own - is offered with its
 * trade-off stated: a crawler with a group of its own reads only that group
 * (RFC 9309), so none of the `*` group's other lines apply to it any more.
 */
export function robotsEdit(v: CrawlerVerdict, host: string | null = null): string | null {
  if (v.state === "allowed" || !v.line) return null;
  const group = v.inherited ? "*" : v.name;
  const allows = v.blocked.slice(0, 10).map((p) => `Allow: ${p}`);
  const where = host ? ` of ${host}/robots.txt` : "";
  const lines = [`# In the User-agent: ${group} group${where}, remove this line:`, v.line, `# or keep it, and add these lines in the same group:`, ...allows];
  if (!v.inherited) return lines.join("\n");
  return [
    ...lines,
    `# Either change applies to every crawler that reads the User-agent: * group, not only ${v.name}.`,
    `# To change it for ${v.name} alone, add a group of its own instead:`,
    `User-agent: ${v.name}`,
    ...allows,
    `# A crawler with its own group reads only that group, so none of the * group's other lines apply to ${v.name} any more: copy across any you want it to keep.`,
  ].join("\n");
}

/** A key page's own state from its latest own read: its status, noindex and a canonical pointing elsewhere; null for what an unread page cannot say. */
export function botPage(p: { urlKey: string; httpStatus: number | null; read: boolean; noindex: boolean; canonical: string | null; selfKey: string | null; canonicalKey: string | null }): BotPage {
  return {
    urlKey: p.urlKey,
    status: p.httpStatus,
    noindex: p.read ? p.noindex : null,
    canonicalElsewhere: p.read ? p.canonical !== null && p.canonicalKey !== null && p.selfKey !== null && p.canonicalKey !== p.selfKey : null,
  };
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** A URL's host, bare of www; null for one that does not parse. */
export function hostOf(url: string): string | null {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/** Whether a URL is on the client's own domain itself (apex or www), not a subdomain: the main robots.txt read judges it. */
export function onMainHost(url: string, domain: string): boolean {
  return hostOf(url) === bareHost(domain);
}

/** The verdicts a key page is judged by: its own host's robots.txt read; null when that host's file was not read. */
export function verdictsFor(bot: Pick<BotCheck, "crawlers" | "hosts">, url: string, domain: string): CrawlerVerdict[] | null {
  const host = hostOf(url);
  if (host === null) return null;
  if (host === bareHost(domain)) return bot.crawlers;
  return (bot.hosts ?? []).find((h) => h.host === host)?.crawlers ?? null;
}

/** One crawler's verdict on one key page: blocked from it, by which line, and whether from `*`; null when not blocked or not read. */
export function blockOn(bot: Pick<BotCheck, "crawlers" | "hosts">, name: string, url: string, domain: string): CrawlerVerdict | null {
  let path = "/";
  try {
    path = new URL(url).pathname || "/";
  } catch {
    return null;
  }
  const v = verdictsFor(bot, url, domain)?.find((c) => c.name === name) ?? null;
  return v && v.state !== "allowed" && v.blocked.includes(path) ? v : null;
}

/** Every crawler's verdicts, the main host's and each other host's, with the host they were read on (null for the main one). */
export function everyVerdict(bot: Pick<BotCheck, "crawlers" | "hosts">): { host: string | null; v: CrawlerVerdict }[] {
  return [...bot.crawlers.map((v) => ({ host: null, v })), ...(bot.hosts ?? []).flatMap((h) => h.crawlers.map((v) => ({ host: h.host, v })))];
}
