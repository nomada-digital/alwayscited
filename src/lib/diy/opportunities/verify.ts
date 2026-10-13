import type { ParsedPage } from "../../scan/dataforseo-request.ts";
import { type Day, formatDay } from "../../tracking/figures.ts";
import type { Subject } from "../../tracking/limits.ts";

import type { GuardedGet } from "../core/fetch.ts";
import { readGuardedPage } from "../core/fetch.ts";
import { bare } from "./classify-rules.ts";
import { type OwnRead, blockedFacts, factsFromHtml, factsFromParsed } from "./read-page.ts";
import type { PageFacts, Verification } from "./types.ts";

/**
 * Verifying a pursued page (13 Oct 2026, DIY P7; spec 10 sections 4.7, 5.4
 * and 6.9): does it name the client now, and does it link to the client's
 * site? Our own fetch first, which is free and reads `rel`; when robots.txt
 * keeps us out, a paid `content_parsing` read when DIY is on, which returns
 * links and anchors but no `rel`, so a link found that way is "found; follow
 * status not read", never followed or not.
 *
 * The words, as the spec gives them (section 6.9):
 *
 * - a link, own fetch: "Verified: link to tallyroo.com found on the page, followed, 14 Nov";
 * - a link, the fallback: "Verified: link to tallyroo.com found on the page, 14 Nov. Follow status not read.";
 * - a mention: "Verified: the page names Tallyroo, 14 Nov";
 * - neither, read in full: "Checked 14 Nov: the page doesn't name Tallyroo or link to tallyroo.com yet.";
 * - neither, the fallback: "Checked 14 Nov: Tallyroo isn't in the page's title, headings or links." - the
 *   body was not read, so it never says the page doesn't name the client;
 * - not read: "We couldn't read this page on 14 Nov (HTTP 403)." Never "doesn't name you".
 *
 * Pure apart from the reads handed in, so node --test runs every path.
 */

export type FallbackRead = { kind: "read"; value: ParsedPage | null } | { kind: "refused" } | { kind: "failed"; reason: string };

export type VerifyDeps = {
  get: GuardedGet;
  /** The paid fallback through a ReadCtx; null while DIY is dark, or when nothing may be spent. */
  fallback: ((url: string) => Promise<FallbackRead>) | null;
  today: Day;
  now: number;
};

const shortDay = (d: Day) => formatDay(d);

/** The card's line for one verification (section 6.9). */
export function verificationText(v: Pick<Verification, "at" | "via" | "ok" | "http" | "names" | "link" | "rel">, brand: string, domain: string, opts: { blocked?: boolean } = {}): string {
  const site = bare(domain);
  const day = shortDay(v.at);
  if (!v.ok) {
    if (opts.blocked) return `We couldn't read this page on ${day}: it asks crawlers like ours not to.`;
    return `We couldn't read this page on ${day}${v.http ? ` (HTTP ${v.http})` : ""}.`;
  }
  if (v.link) {
    if (v.via === "content_parsing" || v.rel === null) return `Verified: link to ${site} found on the page, ${day}. Follow status not read.`;
    return `Verified: link to ${site} found on the page, ${v.rel === "followed" ? "followed" : "not followed"}, ${day}`;
  }
  if (v.names) return `Verified: the page names ${brand}, ${day}`;
  if (v.via === "content_parsing") return `Checked ${day}: ${brand} isn't in the page's title, headings or links.`;
  return `Checked ${day}: the page doesn't name ${brand} or link to ${site} yet.`;
}

/** The Pursuing view's verification line (section 4.7): "Your brand appears on the page: yes, since 3 Nov. Link to tallyroo.com: yes, followed." */
export function pursuingLine(v: Verification | null, domain: string): string {
  const site = bare(domain);
  if (!v) return "Not checked yet. Pursued pages are checked weekly.";
  if (!v.ok) return v.text;
  const names = v.names === true ? `yes${v.names_since ? `, since ${shortDay(v.names_since)}` : ""}` : v.names === false ? "no" : "not read";
  const link = v.link === true ? (v.rel === null ? "found; follow status not read" : `yes, ${v.rel === "followed" ? "followed" : "not followed"}`) : v.link === false ? "no" : "not read";
  return `Your brand appears on the page: ${names}. Link to ${site}: ${link}. Checked ${shortDay(v.at)}.`;
}

/** Whether a won link or a mention has gone since the read before (the Slipping candidate, section 6.1). */
export function removedSince(before: Verification | null, now: Verification): "link" | "mention" | null {
  if (!before || !now.ok || !before.ok) return null;
  if (before.link === true && now.link === false) return "link";
  if (before.names === true && now.names === false && now.via === "own") return "mention";
  return null;
}

/** A verification from a page's facts, as `verifyPage` makes it; the paid fallback's job calls it with a content_parsing read. */
export function verificationFromFacts(f: PageFacts, today: Day, before: Verification | null, subject: { brand: string; domain: string }): Verification {
  return fromFacts(f, today, before, subject.brand, subject.domain, f.status === "blocked");
}

function fromFacts(f: PageFacts, today: Day, before: Verification | null, brand: string, domain: string, blocked: boolean): Verification {
  const ok = f.status === "ok";
  const names = ok ? f.namesClient : null;
  const since = names === true ? (before?.names === true ? (before.names_since ?? before.at) : today) : null;
  const v: Verification = { at: today, via: f.via, ok, http: f.http, names, link: ok ? f.linksToClient : null, rel: ok ? f.linkRel : null, anchor: ok ? f.linkAnchor : null, text: "", names_since: since };
  v.text = verificationText(v, brand, domain, { blocked });
  return v;
}

/**
 * One verification. Own fetch first; on robots.txt or a failed fetch, the
 * paid fallback when one is handed in. A fallback refused (a cap, dark) or
 * not handed in leaves the read for the next night (`fallback: true`).
 */
export async function verifyPage(
  page: { url: string; urlKey: string },
  subject: Subject & { brand: string },
  before: Verification | null,
  deps: VerifyDeps,
  competitors: readonly string[] = [],
): Promise<{ verification: Verification; facts: PageFacts }> {
  const at = new Date(deps.now).toISOString();
  const own = await readGuardedPage(page.url, { get: deps.get, thirdParty: true });
  if (own.ok) {
    const read: OwnRead = { status: own.status, html: own.html, contentType: own.headers["content-type"] ?? null };
    const facts = factsFromHtml({ url: page.url, urlKey: page.urlKey, at, today: deps.today, read, subject, competitors });
    if (facts.status === "ok" || !deps.fallback) return { verification: fromFacts(facts, deps.today, before, subject.brand, subject.domain, false), facts };
  }
  const blocked = !own.ok && own.why === "robots";
  const failedOwn = own.ok ? factsFromHtml({ url: page.url, urlKey: page.urlKey, at, today: deps.today, read: { status: own.status, html: "", contentType: own.headers["content-type"] ?? null }, subject, competitors }) : blockedFacts({ url: page.url, urlKey: page.urlKey, at, why: own.why });
  if (deps.fallback && (blocked || !own.ok)) {
    const r = await deps.fallback(page.url);
    if (r.kind === "read") {
      const facts = factsFromParsed({ url: page.url, urlKey: page.urlKey, at, today: deps.today, parsed: r.value, subject, competitors });
      return { verification: fromFacts(facts, deps.today, before, subject.brand, subject.domain, false), facts };
    }
    const v = fromFacts(failedOwn, deps.today, before, subject.brand, subject.domain, blocked);
    return { verification: { ...v, fallback: r.kind === "refused" }, facts: failedOwn };
  }
  const v = fromFacts(failedOwn, deps.today, before, subject.brand, subject.domain, blocked);
  return { verification: { ...v, fallback: blocked || !own.ok }, facts: failedOwn };
}

/** A stored verification read back, or null: only the named fields, each checked. */
export function verificationOf(v: unknown): Verification | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const day = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const at = day(o.at);
  const tri = (x: unknown) => (x === true ? true : x === false ? false : null);
  if (!at || typeof o.text !== "string" || !o.text.trim()) return null;
  return {
    at,
    via: o.via === "content_parsing" ? "content_parsing" : "own",
    ok: o.ok === true,
    http: typeof o.http === "number" ? o.http : null,
    names: tri(o.names),
    link: tri(o.link),
    rel: o.rel === "followed" || o.rel === "not_followed" ? o.rel : null,
    anchor: typeof o.anchor === "string" ? o.anchor.slice(0, 200) : null,
    text: o.text.slice(0, 300),
    ...(o.fallback === true ? { fallback: true } : {}),
    ...(o.removed === "link" || o.removed === "mention" ? { removed: o.removed } : {}),
    names_since: day(o.names_since),
  };
}
