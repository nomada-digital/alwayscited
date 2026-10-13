import { knownKind } from "../../scan/source-kinds.ts";
import { urlKey } from "../../tracking/placements.ts";

import { bare, domainTypeByRule, isEngineProperty } from "./classify-rules.ts";
import { domainTypeOf, isOwnHost, pageTypeOf } from "./derive.ts";
import { routeFor } from "./routes.ts";
import { type DomainType, type KindRow, OPP_LIMITS, type PageFacts, type PageType, type Route } from "./types.ts";

/**
 * "Log a site you found" (13 Oct 2026, DIY P7; spec 10 sections 3.6 and 4.7
 * row 6): any public http(s) address up to 500 characters, read now (our own
 * fetch first, a content_parsing fallback when robots.txt keeps us out and
 * DIY is on), typed by the rules and the cache, routed as any cited page,
 * and kept under the `logged` lens. Pure.
 *
 * Refused with one set of fixed words, "That page can't be logged here":
 * the client's own site, an engine's own property, an encyclopaedia or a
 * government site (which no route approaches), and any page where Nomada has
 * placed another client - the words are the same for every reason, so a
 * refusal says nothing about anyone's placements.
 */

export type LogCheck = { ok: true; url: string; key: string; host: string } | { ok: false; why: "url" | "cannot_log" };

export function checkLogUrl(raw: unknown, p: { domain: string; placedKeys: ReadonlySet<string> }): LogCheck {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > OPP_LIMITS.url) return { ok: false, why: "url" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, why: "url" };
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".") || u.username || u.password) return { ok: false, why: "url" };
  const key = urlKey(u.toString());
  if (!key) return { ok: false, why: "url" };
  const host = bare(u.hostname);
  if (isOwnHost(host, p.domain) || isEngineProperty(host) || p.placedKeys.has(key)) return { ok: false, why: "cannot_log" };
  const known = knownKind(host);
  if (known?.kind === "other" && domainTypeByRule(host) !== "community") return { ok: false, why: "cannot_log" };
  return { ok: true, url: u.toString().slice(0, OPP_LIMITS.url), key, host };
}

/** A logged page's types and route, from what we read and the cache. Null when the route is "Leave it": nothing to approach. */
export function loggedRoute(p: { url: string; key: string; host: string; facts: PageFacts | null; kinds: ReadonlyMap<string, Pick<KindRow, "domain_type" | "page_type" | "set_by">> }): { route: Route; pageType: PageType | null; domainType: DomainType | null } | null {
  const domainType = domainTypeOf(p.host, p.kinds);
  const read = p.facts?.status === "ok" ? p.facts : null;
  const pageType = pageTypeOf(p.url, p.key, read?.title ?? null, domainType, p.kinds);
  const route = routeFor({ pageType, domainType, namesClient: read?.namesClient ?? null, leavesAll: false });
  return route === "leave_it" ? null : { route, pageType, domainType };
}
