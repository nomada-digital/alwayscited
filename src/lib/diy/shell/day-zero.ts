import { zoneDay } from "../../tracking/check-time.ts";
import { type Day, formatDay } from "../../tracking/figures.ts";
import type { Pull } from "../keywords/footprint.ts";
import { everyVerdict } from "../pages/robots.ts";
import type { BotCheck, KeyPage, PageCheck } from "../pages/types.ts";
import type { PlanItem } from "../plan/types.ts";

/**
 * "Where you stand today" (13 Oct 2026, DIY P9; spec 10 section 4.1, the
 * state "Confirmed, no check yet"): what the Overview can say before a
 * client's first daily check, from the reads that land before it - the Google
 * footprint (P6, a vendor estimate), and our own weekly read of the key pages
 * and robots.txt (P8). Each line is written by a rule from those rows; a part
 * with no read behind it is left out, never shown empty, and nothing here
 * promises a read (the dark rule, spec 10 section 4).
 *
 * The labels follow section 2.6's three kinds: the footprint is "DataForSEO
 * estimate, read <date>" (an unchanged date means it did not re-run), our own
 * reads "Checked <date>". No clock times, no causal words, no claim about
 * what an engine does: robots.txt is described as what it allows.
 *
 * Plain module, relative imports: node --test runs it.
 */

export type StandLine = {
  id: "google" | "pages" | "crawlers" | "schema";
  text: string;
  /** "DataForSEO estimate, read 10 Oct" or "Checked 12 Oct". */
  basis: string;
  /** Where the line's detail is, under the client: "/google?view=all", "/pages?view=bots", "/pages/<id>". */
  to: string;
};

/** The top pages by estimated traffic: three, as the spec lists them. */
export const TOP_PAGES = 3;

const n = (v: number) => v.toLocaleString("en-GB");

/** The day a stored timestamp falls on in the client's zone. */
const dayOf = (at: string, market: string): Day => zoneDay(Date.parse(at), market);

/** Ranking keywords and page 1, from the latest pull. Positions are organic (`p`, rank_group), as the Google page reads them. */
export function googleLine(pull: Pull | null, domain: string): StandLine | null {
  if (!pull) return null;
  const basis = `DataForSEO estimate, read ${formatDay(pull.pulledOn)}`;
  const ranked = pull.rows.filter((r) => r.p !== null);
  const total = Math.max(pull.total ?? 0, ranked.length);
  if (total === 0) return { id: "google", text: `DataForSEO's index has no Google rankings for ${domain} yet.`, basis, to: "/google" };
  const page1 = ranked.filter((r) => r.p! <= 10).length;
  const text =
    ranked.length < total
      ? `${n(total)} keywords rank for ${domain} on Google. Of the ${n(ranked.length)} with the most estimated traffic, ${n(page1)} ${page1 === 1 ? "is" : "are"} on page 1.`
      : `${n(total)} ${total === 1 ? "keyword ranks" : "keywords rank"} for ${domain} on Google, ${n(page1)} of ${total === 1 ? "it" : "them"} on page 1.`;
  return { id: "google", text, basis, to: "/google?view=all" };
}

/** The pages with the most estimated traffic in the latest pull, summed over each page's keywords. */
export function topPagesLine(pull: Pull | null): StandLine | null {
  if (!pull) return null;
  const by = new Map<string, number>();
  for (const r of pull.rows) if (r.u && r.e !== null && r.e > 0) by.set(r.u, (by.get(r.u) ?? 0) + r.e);
  const top = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_PAGES);
  if (!top.length) return null;
  const list = top.map(([u, e]) => `${u} (about ${n(Math.round(e))} a month)`).join(", ");
  return { id: "pages", text: `Your ${top.length === 1 ? "page" : `${top.length} pages`} with the most estimated traffic from Google: ${list}.`, basis: `DataForSEO estimate, read ${formatDay(pull.pulledOn)}`, to: "/google?view=all" };
}

/** AI and search crawler access to the key pages, from our latest robots.txt read. */
export function crawlersLine(bot: BotCheck | null, market: string): StandLine | null {
  if (!bot) return null;
  const basis = `Checked ${formatDay(dayOf(bot.checkedAt, market))}`;
  if (bot.robotsStatus === null) return { id: "crawlers", text: "We couldn't read your robots.txt.", basis, to: "/pages?view=bots" };
  const verdicts = everyVerdict(bot).map((x) => x.v);
  if (!verdicts.length) return null;
  const blocked = [...new Set(verdicts.filter((v) => v.state !== "allowed").map((v) => v.name))];
  if (!blocked.length) return { id: "crawlers", text: "Your robots.txt lets every crawler we check read your key pages.", basis, to: "/pages?view=bots" };
  const names = blocked.length === 1 ? blocked[0]! : `${blocked.slice(0, -1).join(", ")} and ${blocked[blocked.length - 1]}`;
  return { id: "crawlers", text: `Your robots.txt keeps ${names} from some or all of your key pages. Every other crawler we check can read them.`, basis, to: "/pages?view=bots" };
}

/** The schema types on the homepage, from our latest own read of it. */
export function schemaLine(page: KeyPage | null, checks: readonly PageCheck[], market: string): StandLine | null {
  if (!page) return null;
  const own = checks.filter((c) => c.via === "own" && (c.keyPageId === page.id || c.urlKey === page.urlKey)).sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1))[0];
  if (!own) return null;
  const basis = `Checked ${formatDay(dayOf(own.checkedAt, market))}`;
  const to = `/pages/${encodeURIComponent(page.id)}`;
  if (own.status !== "ok") return { id: "schema", text: `We couldn't read your homepage${own.httpStatus ? ` (HTTP ${own.httpStatus})` : ""}.`, basis, to };
  const found = own.schemaFound;
  const types = [...new Set([...(found?.blocks ?? []).flatMap((b) => b.types), ...(found?.microdataTypes ?? [])])];
  return { id: "schema", text: types.length ? `Schema on your homepage: ${types.join(", ")}.` : "No schema found on your homepage.", basis, to };
}

export type DayZeroInput = {
  domain: string;
  market: string;
  /** The latest footprint pull, or null while there is none (or DIY is dark: it is never read then). */
  pull: Pull | null;
  /** The latest robots.txt read, or null. */
  bot: BotCheck | null;
  /** The live homepage key page, or null. */
  homepage: KeyPage | null;
  checks: readonly PageCheck[];
};

/** Every line there is something behind, in the spec's order: rankings, top pages, crawler access, homepage schema. */
export function whereYouStand(p: DayZeroInput): StandLine[] {
  return [googleLine(p.pull, p.domain), topPagesLine(p.pull), crawlersLine(p.bot, p.market), schemaLine(p.homepage, p.checks, p.market)].filter((l): l is StandLine => l !== null);
}

/** "3 things you can do before your first check": open Blocking items first, then Tidy-up, never one hidden. */
export const BEFORE_FIRST = 3;

export function beforeFirstCheck<T extends Pick<PlanItem, "severity" | "status" | "hiddenUntil" | "createdAt" | "dedupeKey">>(items: readonly T[], today: Day): T[] {
  const rank = (i: T) => (i.severity === "blocking" ? 0 : 1);
  return items
    .filter((i) => (i.severity === "blocking" || i.severity === "tidy") && (i.status === "suggested" || i.status === "todo" || i.status === "doing") && (i.hiddenUntil === null || i.hiddenUntil <= today))
    .sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt) || a.dedupeKey.localeCompare(b.dedupeKey))
    .slice(0, BEFORE_FIRST);
}
