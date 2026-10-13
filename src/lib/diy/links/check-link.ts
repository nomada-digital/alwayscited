import type { ParsedPage } from "../../scan/dataforseo-request.ts";
import { type Day, formatDay } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import { type GuardedGet, readGuardedPage } from "../core/fetch.ts";
import { decodeEntities, linkToClient } from "../opportunities/read-page.ts";

import { bareHost } from "./nomada-placements.ts";
import { LINK_URL_MAX, type LinkCheck } from "./types.ts";

/**
 * "Check a link" (13 Oct 2026, DIY P10; spec 10 sections 4.8 row 6, 5.4 and
 * 6.9): read one page now and say whether it links to the client - the
 * anchor, whether the link is followed, and the page of the client's it
 * points at. Our own fetch first, which is free and reads `rel`; when the
 * page's robots.txt keeps our crawler out, a paid `content_parsing` read
 * through the member's runOnDemand (skipped while DIY is dark, at a cap, or
 * while a daily tracking run is reading). That read returns links and
 * anchors but no `rel`, so a link it finds is "Link found; follow status not
 * read." - never followed or not followed.
 *
 * Pure apart from the reads handed in, so node --test runs every path.
 */

export type FallbackRead = { kind: "read"; value: ParsedPage | null } | { kind: "refused" } | { kind: "failed"; reason: string };

export type CheckDeps = {
  get: GuardedGet;
  /** The paid fallback through the member's ReadCtx; null when nothing may be spent. */
  fallback: ((url: string) => Promise<FallbackRead>) | null;
  now: number;
};

export type CheckUrl = { ok: true; url: string; key: string } | { ok: false; why: "url" | "own" };

/** A typed address: http(s), a public-looking host, no credentials, 500 characters at most, and not on the client's own site. */
export function checkUrl(raw: unknown, clientDomain: string): CheckUrl {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > LINK_URL_MAX) return { ok: false, why: "url" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, why: "url" };
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".") || u.username || u.password) return { ok: false, why: "url" };
  const key = urlKey(u.toString());
  if (!key || u.toString().length > LINK_URL_MAX) return { ok: false, why: "url" };
  const host = bareHost(u.hostname);
  const own = bareHost(clientDomain);
  if (host === own || host.endsWith(`.${own}`)) return { ok: false, why: "own" };
  return { ok: true, url: u.toString(), key };
}

const isClientHost = (href: string, domain: string): boolean => {
  try {
    const h = bareHost(new URL(href, "https://placeholder.invalid/").hostname);
    const own = bareHost(domain);
    return h === own || h.endsWith(`.${own}`);
  } catch {
    return false;
  }
};

/** The page's first link to the client: its address, and (opportunities/read-page.ts linkToClient, the one rule) its anchor and follow status. */
export function firstLinkTo(html: string, domain: string): { found: boolean; href: string | null; anchor: string | null; rel: "followed" | "not_followed" | null } {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]!);
    const raw = href ? decodeEntities(href[2] ?? href[3] ?? href[4] ?? "") : "";
    if (!raw || !isClientHost(raw, domain)) continue;
    const one = linkToClient(m[0], domain);
    let abs: string | null = null;
    try {
      abs = new URL(raw, "https://placeholder.invalid/").toString().slice(0, LINK_URL_MAX);
    } catch {
      abs = null;
    }
    return { found: true, href: abs, anchor: one.anchor, rel: one.rel };
  }
  return { found: false, href: null, anchor: null, rel: null };
}

/** One check. Never throws for a page that cannot be read: it says so. */
export async function checkLink(url: string, clientDomain: string, deps: CheckDeps): Promise<Omit<LinkCheck, "id">> {
  const at = new Date(deps.now).toISOString();
  const base = { url: url.slice(0, LINK_URL_MAX), checkedAt: at };
  const own = await readGuardedPage(url, { get: deps.get, thirdParty: true });
  if (own.ok) {
    const type = (own.headers["content-type"] ?? "text/html").toLowerCase();
    if (own.status < 200 || own.status >= 300) return { ...base, via: "own", status: "error", http: own.status, found: null, rel: null, anchor: null, target: null };
    if (!/html|xml/.test(type)) return { ...base, via: "own", status: "not_html", http: own.status, found: null, rel: null, anchor: null, target: null };
    const link = firstLinkTo(own.html, clientDomain);
    return { ...base, via: "own", status: "ok", http: own.status, found: link.found, rel: link.found ? link.rel : null, anchor: link.anchor, target: link.href };
  }
  if (own.why !== "robots") return { ...base, via: "own", status: "error", http: null, found: null, rel: null, anchor: null, target: null };
  const got = deps.fallback ? await deps.fallback(url) : ({ kind: "refused" } as const);
  if (got.kind !== "read" || !got.value) return { ...base, via: got.kind === "refused" ? "own" : "content_parsing", status: got.kind === "refused" ? "blocked" : "error", http: null, found: null, rel: null, anchor: null, target: null };
  const page = got.value;
  if (page.status !== null && (page.status < 200 || page.status >= 300)) return { ...base, via: "content_parsing", status: "error", http: page.status, found: null, rel: null, anchor: null, target: null };
  const hit = page.links.find((l) => isClientHost(l.url, clientDomain));
  return {
    ...base,
    via: "content_parsing",
    status: "ok",
    http: page.status,
    found: hit ? true : page.links.length ? false : null,
    rel: null,
    anchor: hit?.anchor?.slice(0, 200) ?? null,
    target: hit?.url.slice(0, LINK_URL_MAX) ?? null,
  };
}

const pathOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return null;
  }
};

/** The check's line (spec 10 sections 4.8 row 6 and 6.9). */
export function checkLine(c: Pick<LinkCheck, "checkedAt" | "via" | "status" | "http" | "found" | "rel" | "anchor" | "target">, clientDomain: string): string {
  const day = formatDay(c.checkedAt.slice(0, 10) as Day);
  const site = bareHost(clientDomain);
  if (c.status === "blocked") return `We couldn't read this page on ${day}: it asks crawlers like ours not to.`;
  if (c.status === "not_html") return `We couldn't read this page on ${day}: it isn't a web page.`;
  if (c.status !== "ok") return `We couldn't read this page on ${day}${c.http ? ` (HTTP ${c.http})` : ""}.`;
  if (c.found === null) return `We read this page on ${day} and it had no links we could read.`;
  if (!c.found) return `No link to ${site} on this page. Read ${day}.`;
  const path = pathOf(c.target);
  const to = `${site}${path && path !== "/" ? path : ""}`;
  const anchor = c.anchor ? `anchor '${c.anchor}'` : "no anchor text";
  if (c.via === "content_parsing" || c.rel === null) return `Link found; follow status not read. It points at ${to}, ${anchor}. Read ${day}.`;
  return `Links to ${to}: ${anchor}, ${c.rel === "followed" ? "followed" : "not followed"}. Read ${day}.`;
}
