import type { SupabaseClient } from "@supabase/supabase-js";

import type { InstantPage, Microdata } from "../../scan/dataforseo-request.ts";
import { urlKey } from "../../tracking/placements.ts";
import type { GuardedGet } from "../core/fetch.ts";
import { readGuardedPage } from "../core/fetch.ts";
import { buildFix, fixSummary } from "./fix.ts";
import { type OwnParse, capSchemaPayload, parseOwnPage, schemaFoundOf } from "./own-parse.ts";
import { schemaFindings } from "./schema.ts";
import type { Basics, CheckTrigger, KeyPage } from "./types.ts";

/**
 * One key page read, as a page_checks row (13 Oct 2026, DIY P8; spec 10
 * sections 4.9, 6.4 and 5.4). Two kinds:
 *
 * - **our own read** (`via = 'own'`, free): the weekly job's and the first
 *   step of "Check this page now". The client's own page, so robots.txt is
 *   not asked (fetch.ts: the client asked us to).
 * - **the JavaScript read** (`via = 'instant_pages'`, paid): the monthly job
 *   and "Check this page now", with DataForSEO's validator, through P1's
 *   `readPageDeep` - one reservation, one ledger row, tagged with the
 *   on-demand action, so one page check counts once (usage-meter.ts).
 *
 * An unreadable page (an error status we cannot read past, a network
 * failure) is a row with status `unreadable` and its HTTP status: "We
 * couldn't read this page on 3 Nov (HTTP 403)", never "no schema".
 */

export type CheckRow = Record<string, unknown>;

/** The basics an own read keeps (page_checks.basics): the summary without the schema, the hash or the word count, which have their own columns. */
export function basicsOf(p: OwnParse): Basics {
  const { jsonLd: _j, jsonLdErrors: _e, conflicts: _c, microdata: _m, contentHash: _h, wordCount: _w, ...rest } = p;
  return { ...rest, internal: rest.internal.slice(0, 150) };
}

/** A status an own read can read a page past: 2xx. Anything else is stated, and the page is not parsed. */
const readable = (status: number) => status >= 200 && status < 300;

export type OwnRead = { row: CheckRow; parse: OwnParse | null; headers: Record<string, string> };

/** Our own read of one key page, as a row ready to insert. Never throws for the page's sake: a failure is an unreadable row. */
export async function ownCheck(p: { clientId: string; page: Pick<KeyPage, "id" | "url" | "urlKey">; homepage: boolean; trigger: CheckTrigger; now: number; get: GuardedGet }): Promise<OwnRead> {
  const base = { client_domain_id: p.clientId, key_page_id: p.page.id, url: p.page.url, url_key: p.page.urlKey, checked_at: new Date(p.now).toISOString(), via: "own", trigger: p.trigger };
  const got = await readGuardedPage(p.page.url, { get: p.get, thirdParty: false });
  if (!got.ok) return { row: { ...base, status: "unreadable", http_status: null, final_url: null }, parse: null, headers: {} };
  if (!readable(got.status)) return { row: { ...base, status: "unreadable", http_status: got.status, final_url: got.finalUrl.slice(0, 500) }, parse: null, headers: got.headers };
  const parse = parseOwnPage(got.html, got.finalUrl, got.headers);
  const basics = basicsOf(parse);
  const found = schemaFoundOf(parse, "static");
  const capped = capSchemaPayload(found, null);
  const fix = buildFix({ url: p.page.url, homepage: p.homepage, basics, found: capped.found }, schemaFindings({ url: p.page.url, homepage: p.homepage, basics, found: capped.found, results: null }));
  return {
    row: {
      ...base,
      status: "ok",
      http_status: got.status,
      final_url: got.finalUrl.slice(0, 500),
      basics,
      fix: fixSummary(fix),
      schema_found: capped.found,
      schema_results: null,
      content_hash: parse.contentHash,
      word_count: parse.wordCount,
      rendered_word_count: null,
    },
    parse,
    headers: got.headers,
  };
}

/**
 * The JavaScript read as a row: the status and the rendered word count from
 * instant_pages, and the validator's findings, capped (no values). The basics
 * are not re-derived from it: our own read keeps those, and the page reads the
 * two side by side.
 */
export function deepRow(p: { clientId: string; page: Pick<KeyPage, "id" | "url" | "urlKey">; trigger: CheckTrigger; now: number; page_: InstantPage | null; microdata: Microdata | null; readId: string | null }): CheckRow {
  const status = p.page_?.status ?? null;
  const ok = p.page_ !== null && status !== null && readable(status);
  const capped = capSchemaPayload(null, p.microdata ? { summary: p.microdata.summary, items: p.microdata.items.map((it) => ({ types: it.types, fields: it.fields.map((f) => ({ name: f.name })), results: it.results })) } : null);
  return {
    client_domain_id: p.clientId,
    key_page_id: p.page.id,
    url: p.page.url,
    url_key: p.page.urlKey,
    checked_at: new Date(p.now).toISOString(),
    via: "instant_pages",
    trigger: p.trigger,
    status: ok ? "ok" : "unreadable",
    http_status: status,
    final_url: p.page_?.url?.slice(0, 500) ?? null,
    basics: null,
    fix: null,
    schema_found: null,
    schema_results: ok ? capped.results : null,
    content_hash: null,
    word_count: null,
    rendered_word_count: ok ? (p.page_?.wordCount ?? null) : null,
    read_id: p.readId,
  };
}

export async function insertCheck(db: SupabaseClient, row: CheckRow): Promise<void> {
  const { error } = await db.from("page_checks").insert(row);
  if (error) throw new Error(`could not store the page check: ${error.message}`);
}

/** The url_key a check is filed under: the key page's, so a redirect does not file it as another page. */
export const keyOf = (url: string) => urlKey(url) ?? url;
