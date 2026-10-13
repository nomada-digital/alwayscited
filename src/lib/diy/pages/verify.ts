import { type Day, formatDay } from "../../tracking/figures.ts";
import type { PlanItem } from "../plan/types.ts";
import { coreMatch } from "./diagnostics.ts";
import { ARTICLE_TYPES, LOCAL_TYPES, ORG_TYPES, REQUIRED, validatorErrors } from "./schema.ts";
import type { BotCheck, KeyPage, PageCheck, ReoptExample } from "./types.ts";

/**
 * Verification of page work (13 Oct 2026, DIY P8; spec 10 section 6.9): the
 * weekly own read looks at the Actions items done on a key page and says what
 * it found, in a dated line P3's card draws. Pure; the job writes each line
 * through P3's `markVerified`, which takes only a done item.
 *
 * | Kind | Verified by |
 * |---|---|
 * | add_schema, fix_schema | the next weekly own read shows the type with its required properties, and the monthly validator, when it has read since, shows 0 errors for that type |
 * | fix_schema, "Fix the schema errors" (`pages:schema:errors:<page>`) | the validator has read the page since, and found 0 errors |
 * | rework_page | the content hash changed since the item was started, and the example's title or H1 (or a 75% core-word match) is there: "We saw the page change on 4 Nov." After 14 days with no change: "This page looks unchanged since you started this." |
 * | unblock_crawler, fix_page_status | the next bot or page read shows allowed and 200 |
 * | unblock_crawler over several key pages (no page ref) | by its key, `pages:crawler:<name>`: the next bot read shows it allowed on the domain and every subdomain read |
 *
 * Anything else is "Marked done by you", which P3 draws when there is no
 * verified line. Nothing here is written as "Verified" unless a re-read
 * found it.
 */

export const UNCHANGED_DAYS = 14;
export const UNCHANGED_TEXT = "This page looks unchanged since you started this.";

/** The schema type an item is about: from this package's dedupe key, else its title. */
export function itemType(item: Pick<PlanItem, "dedupeKey" | "title">): string | null {
  const m = /^pages:schema:([A-Za-z]+):/.exec(item.dedupeKey);
  if (m) return m[1]!;
  const t = /\b(Organization|WebSite|BreadcrumbList|Product|LocalBusiness|Article|FAQPage)\b/.exec(item.title);
  return t ? t[1]! : null;
}

const FAMILY: Record<string, readonly string[]> = { Organization: ORG_TYPES, LocalBusiness: LOCAL_TYPES, Article: ARTICLE_TYPES };
const and = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

/** The checks of one page read after a day, newest first. */
const after = (checks: readonly PageCheck[], keyPageId: string, since: Day, via?: PageCheck["via"]) =>
  checks.filter((c) => c.keyPageId === keyPageId && c.checkedAt.slice(0, 10) > since && (!via || c.via === via)).sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1));

export type Verdict = { text: string; at: Day } | null;

/** The validator's errors item, `pages:schema:errors:<page>` (candidates.ts): no one type, every error. */
const ERRORS_KEY = /^pages:schema:errors:/;

export function verifySchema(item: Pick<PlanItem, "dedupeKey" | "title" | "doneOn" | "startedOn">, page: KeyPage, checks: readonly PageCheck[]): Verdict {
  const since = item.doneOn ?? item.startedOn;
  if (since && ERRORS_KEY.test(item.dedupeKey)) {
    // Only the validator can say its errors are gone: our own read does not run it.
    const deep = after(checks, page.id, since, "instant_pages").find((c) => c.status === "ok" && c.schemaResults);
    if (!deep || validatorErrors(deep.schemaResults).total > 0) return null;
    const day = deep.checkedAt.slice(0, 10);
    return { text: `Verified: the validator found 0 errors, ${formatDay(day)}`, at: day };
  }
  const type = itemType(item);
  if (!type || !since || !REQUIRED[type]) return null;
  const own = after(checks, page.id, since, "own").find((c) => c.status === "ok");
  if (!own) return null;
  const block = (own.schemaFound?.blocks ?? []).find((b) => b.types.some((t) => (FAMILY[type] ?? [type]).includes(t)));
  const required = REQUIRED[type]!;
  if (!block || !required.every((k) => block.props.includes(k))) return null;
  const deep = after(checks, page.id, since, "instant_pages").find((c) => c.status === "ok" && c.schemaResults);
  if (deep && (validatorErrors(deep.schemaResults).byType.get(type) ?? 0) > 0) return null;
  const day = own.checkedAt.slice(0, 10);
  return { text: `Verified: ${type} found with ${and(required)}${deep ? ", 0 errors" : ""}, ${formatDay(day)}`, at: day };
}

export function verifyRework(item: Pick<PlanItem, "startedOn" | "doneOn" | "clusterId">, page: KeyPage, checks: readonly PageCheck[], examples: readonly ReoptExample[], today: Day): Verdict {
  const since = item.startedOn ?? item.doneOn;
  if (!since) return null;
  const own = checks.filter((c) => c.keyPageId === page.id && c.via === "own" && c.status === "ok").sort((a, b) => (a.checkedAt < b.checkedAt ? -1 : 1));
  const before = [...own].reverse().find((c) => c.checkedAt.slice(0, 10) <= since);
  const later = own.filter((c) => c.checkedAt.slice(0, 10) > since);
  const changed = later.find((c) => before && c.contentHash && before.contentHash && c.contentHash !== before.contentHash);
  if (changed) {
    const ex = examples.find((e) => e.status === "ready" && e.urlKey === page.urlKey && (item.clusterId === null || e.clusterId === item.clusterId) && e.example);
    const b = changed.basics;
    const suggested = ex?.example ? [ex.example.title, ex.example.h1] : [];
    const present = !suggested.length || suggested.some((s) => [b?.title ?? "", ...(b?.h1 ?? [])].some((t) => t.toLowerCase().includes(s.toLowerCase()) || coreMatch(t, s)));
    if (present) {
      const day = changed.checkedAt.slice(0, 10);
      return { text: `We saw the page change on ${formatDay(day)}.`, at: day };
    }
    return null;
  }
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000);
  if (before && later.length && days >= UNCHANGED_DAYS) return { text: UNCHANGED_TEXT, at: later[later.length - 1]!.checkedAt.slice(0, 10) };
  return null;
}

export function verifyCrawler(item: Pick<PlanItem, "dedupeKey" | "title" | "doneOn" | "startedOn">, bots: readonly BotCheck[]): Verdict {
  const since = item.doneOn ?? item.startedOn;
  if (!since) return null;
  const name = /^pages:crawler:(.+)$/.exec(item.dedupeKey)?.[1] ?? /\b(Googlebot|Bingbot|GPTBot|ClaudeBot|PerplexityBot)\b/.exec(item.title)?.[1] ?? null;
  if (!name) return null;
  const read = bots.filter((b) => b.checkedAt.slice(0, 10) > since).sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1))[0];
  const v = read?.crawlers.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!read || !v || v.state !== "allowed") return null;
  // Allowed on every subdomain read too: a page there is judged by its own host's file.
  for (const h of read.hosts ?? []) if (h.crawlers.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.state !== "allowed")) return null;
  const day = read.checkedAt.slice(0, 10);
  return { text: `Verified: ${v.name} allowed, ${formatDay(day)}`, at: day };
}

export function verifyStatus(item: Pick<PlanItem, "doneOn" | "startedOn">, page: KeyPage, checks: readonly PageCheck[]): Verdict {
  const since = item.doneOn ?? item.startedOn;
  if (!since) return null;
  const own = after(checks, page.id, since, "own")[0];
  if (!own || own.status !== "ok" || own.httpStatus !== 200 || own.basics?.noindex) return null;
  const day = own.checkedAt.slice(0, 10);
  return { text: `Verified: the page answers 200 and can be indexed, ${formatDay(day)}`, at: day };
}

/**
 * The line for one done item that names no key page: a crawler item covering
 * several key pages (candidates.ts gives it no ref), found by its dedupe key.
 * Anything else with no page is P3's or another package's to verify.
 */
export function verifyClientItem(item: PlanItem, read: { bots: readonly BotCheck[] }): Verdict {
  if (item.status !== "done" || item.verified) return null;
  if (item.kind !== "unblock_crawler" || !/^pages:crawler:/.test(item.dedupeKey)) return null;
  return verifyCrawler(item, read.bots);
}

/** The line for one done item on one key page, or null when nothing was read that verifies it. */
export function verifyItem(item: PlanItem, page: KeyPage, read: { checks: readonly PageCheck[]; bots: readonly BotCheck[]; examples: readonly ReoptExample[]; today: Day }): Verdict {
  if (item.status !== "done") return null;
  // An "unchanged" line on a rework is read again: a later change replaces it. Any other line stands.
  const unchanged = item.kind === "rework_page" && item.verified?.text === UNCHANGED_TEXT;
  if (item.verified && !unchanged) return null;
  switch (item.kind) {
    case "add_schema":
    case "fix_schema":
      return verifySchema(item, page, read.checks);
    case "rework_page": {
      const v = verifyRework(item, page, read.checks, read.examples, read.today);
      return unchanged && v?.text === UNCHANGED_TEXT ? null : v;
    }
    case "unblock_crawler":
      return verifyCrawler(item, read.bots);
    case "fix_page_status":
      return verifyStatus(item, page, read.checks);
    default:
      return null;
  }
}
