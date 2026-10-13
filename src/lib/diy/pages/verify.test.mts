import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlanItem } from "../plan/types.ts";
import { basics, found, keyPage, ownCheck } from "./fake-pages.mts";
import type { BotCheck, PageCheck, ReoptExample } from "./types.ts";
import { UNCHANGED_TEXT, itemType, verifyClientItem, verifyItem } from "./verify.ts";

/**
 * Verification of page work (13 Oct 2026, DIY P8; spec 10 section 6.9):
 * schema by the next own read and the validator; a page change by its hash
 * and the example's title; a crawler by the next robots read; and nothing
 * "Verified" that a re-read did not find.
 */

const page = keyPage({ id: "kp-1", url: "https://tallyroo.com/" });
const item = (over: Partial<PlanItem>): PlanItem =>
  ({
    id: "pi-1",
    clusterId: null,
    kind: "add_schema",
    severity: "tidy",
    status: "done",
    title: "Add Organization schema to your homepage",
    why: [],
    grade: "documented",
    sourceId: "G3",
    effort: "minutes",
    href: null,
    refTable: "key_pages",
    refId: "kp-1",
    dedupeKey: "pages:schema:Organization:kp-1",
    weekOf: null,
    newSinceMonday: false,
    ownerEmail: null,
    note: null,
    hiddenUntil: null,
    createdBy: "system",
    createdAt: "2026-10-01T00:00:00Z",
    statusAt: "2026-10-03T00:00:00Z",
    statusBy: "owner@example.com",
    startedOn: "2026-10-02",
    doneOn: "2026-10-03",
    verified: null,
    readoutBase: null,
    volume: null,
    evidenceOn: null,
    seenOn: null,
    missed: 0,
    missedOn: null,
    ...over,
  }) as PlanItem;
const read = (checks: PageCheck[], bots: BotCheck[] = [], examples: ReoptExample[] = []) => ({ checks, bots, examples, today: "2026-10-20" });

test("schema: the next own read shows the type with its required properties; the validator, when it read since, shows 0 errors for it", () => {
  const whole = found([["Organization"], ["name", "url", "logo", "sameAs"]]);
  assert.deepEqual(verifyItem(item({}), page, read([ownCheck(page, "2026-10-08", { schemaFound: whole })])), { text: "Verified: Organization found with name, url, logo and sameAs, 8 Oct", at: "2026-10-08" });
  assert.equal(verifyItem(item({}), page, read([ownCheck(page, "2026-10-08", { schemaFound: found([["Organization"], ["name"]]) })])), null, "incomplete is not verified");
  assert.equal(verifyItem(item({}), page, read([ownCheck(page, "2026-10-01", { schemaFound: whole })])), null, "a read before it was done says nothing");
  const deep: PageCheck = { ...ownCheck(page, "2026-10-10"), via: "instant_pages", schemaResults: { summary: { fatal: 0, error: 1, warning: 0, info: 0 }, items: [{ types: ["Organization"], props: [], results: [{ level: "error", message: "x" }] }] } };
  assert.equal(verifyItem(item({}), page, read([ownCheck(page, "2026-10-08", { schemaFound: whole }), deep])), null, "the validator still finds an error");
  assert.equal(itemType({ dedupeKey: "other", title: "Add Product schema to tallyroo.com/bookkeeping" }), "Product");
});

test("a page change: the hash moved since it was started and the example's title is there; 14 days with no change says so", () => {
  const rework = item({ kind: "rework_page", dedupeKey: "pages:rework:kp-1:c8", clusterId: "c8", title: "Rework tallyroo.com/ for 'x'", startedOn: "2026-10-02" });
  const ex: ReoptExample = { id: "e", clusterId: "c8", url: page.url, urlKey: page.urlKey, status: "ready", requestedBy: "o", requestedAt: "2026-10-02T00:00:00Z", finishedAt: null, example: { title: "Cloud accounting for small teams", h1: "Cloud accounting your team can use", opening: "", missing_section: { heading: "", bullets: [] }, link_sentence: { from_url: "", sentence: "", anchor: "" }, facts_used: [], placeholders: [] }, now: null, guardHits: [], error: null };
  const before = ownCheck(page, "2026-10-01", { contentHash: "a" });
  const changed = ownCheck(page, "2026-10-08", { contentHash: "b", basics: basics({ title: "Cloud accounting for small teams | Tallyroo" }) });
  assert.deepEqual(verifyItem(rework, page, read([before, changed], [], [ex])), { text: "We saw the page change on 8 Oct.", at: "2026-10-08" });
  const notTitle = ownCheck(page, "2026-10-08", { contentHash: "b", basics: basics({ title: "Something else entirely" }) });
  assert.equal(verifyItem(rework, page, read([before, notTitle], [], [ex])), null, "changed, but not with the example's title");
  const same = ownCheck(page, "2026-10-15", { contentHash: "a" });
  assert.equal(verifyItem(rework, page, read([before, same], [], [ex]))?.text, UNCHANGED_TEXT);
  assert.deepEqual(verifyItem({ ...rework, verified: { by: "system", at: "2026-10-15", text: UNCHANGED_TEXT } }, page, read([before, same, changed], [], [ex])), { text: "We saw the page change on 8 Oct.", at: "2026-10-08" }, "a later change replaces the unchanged line");
});

test("a crawler: the next robots read shows it allowed; a page status: the next read answers 200 and can be indexed", () => {
  const crawler = item({ kind: "unblock_crawler", dedupeKey: "pages:crawler:googlebot", title: "Let Googlebot crawl tallyroo.com/pricing" });
  const bot = (day: string, state: "allowed" | "partial"): BotCheck => ({ id: day, checkedAt: `${day}T03:41:00Z`, robotsStatus: 200, crawlers: [{ name: "Googlebot", state, inherited: false, line: null, blocked: [] }], hosts: [], llmsTxtStatus: 404, pages: [] });
  assert.deepEqual(verifyItem(crawler, page, read([], [bot("2026-10-08", "allowed")])), { text: "Verified: Googlebot allowed, 8 Oct", at: "2026-10-08" });
  assert.equal(verifyItem(crawler, page, read([], [bot("2026-10-08", "partial")])), null);
  const status = item({ kind: "fix_page_status", dedupeKey: "pages:status:kp-1" });
  assert.match(verifyItem(status, page, read([ownCheck(page, "2026-10-08")]))!.text, /^Verified: the page answers 200 and can be indexed, 8 Oct$/);
  assert.equal(verifyItem(status, page, read([ownCheck(page, "2026-10-08", { httpStatus: 404, status: "unreadable" })])), null);
});

test("nothing else is verified, and an item not done is never written", () => {
  assert.equal(verifyItem(item({ kind: "own_task" }), page, read([ownCheck(page, "2026-10-08")])), null);
  assert.equal(verifyItem(item({ status: "doing" }), page, read([ownCheck(page, "2026-10-08", { schemaFound: found([["Organization"], ["name", "url", "logo", "sameAs"]]) })])), null);
});

test("the schema-errors item is verified once the validator reads the page again and finds 0 errors; our own read alone never does it", () => {
  // 13 Oct 2026, DIY P8 review: its key read as type 'errors', which no table has, so it stayed "Marked done by you".
  const errors = item({ kind: "fix_schema", dedupeKey: "pages:schema:errors:kp-1", title: "Fix the schema errors on tallyroo.com", doneOn: "2026-10-03" });
  const deep = (day: string, n: number): PageCheck => ({ ...ownCheck(page, day), via: "instant_pages", basics: null, schemaResults: { summary: { fatal: 0, error: n, warning: 0, info: 0 }, items: [{ types: ["Organization"], props: [], results: Array.from({ length: n }, () => ({ level: "error" as const, message: "x" })) }] } });
  assert.deepEqual(verifyItem(errors, page, read([ownCheck(page, "2026-10-08"), deep("2026-10-09", 0)])), { text: "Verified: the validator found 0 errors, 9 Oct", at: "2026-10-09" });
  assert.equal(verifyItem(errors, page, read([deep("2026-10-09", 1)])), null, "errors still there");
  assert.equal(verifyItem(errors, page, read([ownCheck(page, "2026-10-08"), deep("2026-10-01", 0)])), null, "the validator has not read it since");
});

test("a crawler item over several key pages has no page: it is verified by its key, allowed on the domain and on every subdomain read", () => {
  const several = item({ kind: "unblock_crawler", refTable: null, refId: null, dedupeKey: "pages:crawler:googlebot", title: "Let Googlebot crawl 3 of your key pages", doneOn: "2026-10-03" });
  const bot = (day: string, apex: "allowed" | "partial", sub: "allowed" | "blocked"): BotCheck => ({
    id: day,
    checkedAt: `${day}T03:41:00Z`,
    robotsStatus: 200,
    crawlers: [{ name: "Googlebot", state: apex, inherited: false, line: null, blocked: [] }],
    hosts: [{ host: "blog.tallyroo.example", robotsStatus: 200, crawlers: [{ name: "Googlebot", state: sub, inherited: false, line: null, blocked: [] }] }],
    llmsTxtStatus: 404,
    pages: [],
  });
  assert.deepEqual(verifyClientItem(several, { bots: [bot("2026-10-08", "allowed", "allowed")] }), { text: "Verified: Googlebot allowed, 8 Oct", at: "2026-10-08" });
  assert.equal(verifyClientItem(several, { bots: [bot("2026-10-08", "allowed", "blocked")] }), null, "still blocked on the subdomain");
  assert.equal(verifyClientItem(several, { bots: [bot("2026-10-08", "partial", "allowed")] }), null);
  assert.equal(verifyClientItem({ ...several, kind: "own_task", dedupeKey: "task:x" }, { bots: [bot("2026-10-08", "allowed", "allowed")] }), null, "only this package's crawler items");
  assert.equal(verifyClientItem({ ...several, status: "doing" }, { bots: [bot("2026-10-08", "allowed", "allowed")] }), null);
});
