import { LINK_CHECK_UA } from "../../tracking/placements.ts";

/**
 * Our own fetches, which cost nothing (13 Oct 2026, DIY P1; spec 10 section
 * 5.4): robots.txt, llms.txt, key pages, placement titles, and the first-pass
 * verification of pursued pages and "Check a link".
 *
 * The UA is `LINK_CHECK_UA`, which names us and our contact URL. We respect
 * robots.txt for third-party pages: when our UA is disallowed - or the
 * robots.txt could not be read, which RFC 9309 says to treat as a full
 * disallow - the page is not fetched, and the caller falls back to a
 * `content_parsing` read when DIY is on, or calls the page not readable. A
 * robots.txt answering 4xx is no robots.txt, which allows everything. The
 * client's own pages are read without the check: the client asked us to.
 *
 * The network is handed in (`get`), as `readPlacement` takes its fetcher:
 * the live one is `guardedRead` in `src/lib/scan/crawl.ts`, which checks every
 * hostname and every redirect hop and caps the bytes. That keeps this file
 * loadable by node --test, where fetch.test.mts runs it.
 */

/** What `guardedRead` answers. Structural, so this file does not import the server-only crawler. */
export type Guarded =
  | { ok: true; status: number; html: string; headers: Record<string, string>; url: string }
  | { ok: false; why: "network" | "private" | "timeout" };
export type GuardedGet = (url: string, opts: { capBytes: number; ua: string; timeoutMs: number }) => Promise<Guarded>;

/** A robots.txt is read up to this; RFC 9309 asks a parser to read at least 500 KiB. */
export const ROBOTS_CAP_BYTES = 512 * 1024;
/** A page is read up to this by default: crawl.ts reads 200 KB of a homepage. */
export const PAGE_CAP_BYTES = 512 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;

/** The product token robots.txt groups are matched against: the UA up to its first slash, lower case. */
export function productToken(ua: string): string {
  return ua.split("/")[0]!.trim().toLowerCase();
}

type Rule = { allow: boolean; pattern: string; line: string };
type Group = { agents: string[]; rules: Rule[] };

/** robots.txt as groups of user-agents and their rules. Comments and unknown lines are skipped. */
export function robotsGroups(txt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (field !== "allow" && field !== "disallow")) continue;
    current.rules.push({ allow: field === "allow", pattern: value, line: line.slice(0, 200) });
  }
  return groups;
}

/** Whether a rule's path pattern matches a path: `*` matches any run, a trailing `$` anchors the end (RFC 9309). */
function matches(pattern: string, path: string): boolean {
  if (pattern === "") return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

export type RobotsVerdict = { allowed: boolean; line: string | null; inherited: boolean };

/**
 * Whether `ua` may read `path` under this robots.txt (RFC 9309): the group
 * naming the UA's product token, else `*`; then the longest matching rule,
 * with Allow winning a tie; no matching rule allows. `/robots.txt` itself is
 * always allowed.
 */
export function robotsVerdict(txt: string, path: string, ua: string): RobotsVerdict {
  if (path === "/robots.txt") return { allowed: true, line: null, inherited: false };
  const token = productToken(ua);
  const groups = robotsGroups(txt);
  const own = groups.filter((g) => g.agents.includes(token));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (!matches(rule.pattern, path)) continue;
    const len = rule.pattern.replace(/\$$/, "").length;
    const bestLen = best ? best.pattern.replace(/\$$/, "").length : -1;
    if (len > bestLen || (len === bestLen && rule.allow && !best!.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, line: best?.line ?? null, inherited: !own.length && best !== null };
}

/**
 * Whether our UA may read `url`, reading its origin's robots.txt. 2xx: the
 * rules decide. 4xx: no robots.txt, allowed. 5xx, a network failure or a
 * private address: not allowed - "could not read" is never read as "yes".
 */
export async function robotsAllows(url: string, ua: string, get: GuardedGet): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const got = await get(`${u.origin}/robots.txt`, { capBytes: ROBOTS_CAP_BYTES, ua, timeoutMs: FETCH_TIMEOUT_MS });
  if (!got.ok) return false;
  if (got.status >= 400 && got.status < 500) return true;
  if (got.status < 200 || got.status >= 300) return false;
  return robotsVerdict(got.html, u.pathname + u.search, ua).allowed;
}

export type PageRead =
  | { ok: true; status: number; finalUrl: string; headers: Record<string, string>; html: string }
  | { ok: false; why: "robots" | "network" | "private" | "timeout" | "bad_url" };

/**
 * One own fetch of a page. `thirdParty` pages are read only when their
 * robots.txt lets our UA in; `why: "robots"` tells the caller to fall back to
 * `content_parsing` (when DIY is on) or to say the page is not readable.
 */
export async function readGuardedPage(
  url: string,
  opts: { get: GuardedGet; thirdParty: boolean; capBytes?: number; ua?: string; timeoutMs?: number },
): Promise<PageRead> {
  const ua = opts.ua ?? LINK_CHECK_UA;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, why: "bad_url" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, why: "bad_url" };
  if (opts.thirdParty && !(await robotsAllows(parsed.toString(), ua, opts.get))) return { ok: false, why: "robots" };
  const got = await opts.get(parsed.toString(), { capBytes: opts.capBytes ?? PAGE_CAP_BYTES, ua, timeoutMs: opts.timeoutMs ?? FETCH_TIMEOUT_MS });
  if (!got.ok) return { ok: false, why: got.why };
  return { ok: true, status: got.status, finalUrl: got.url, headers: got.headers, html: got.html };
}
