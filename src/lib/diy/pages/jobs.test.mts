import assert from "node:assert/strict";
import { test } from "node:test";

import type { Row } from "../../tracking/fake-db.mts";
import { fakeDiyDb, testClient, testCtx } from "../core/fake-diy.mts";
import type { Guarded, GuardedGet } from "../core/fetch.ts";
import type { JobContext } from "../core/jobs.ts";
import { refuseHandlers } from "../core/jobs.ts";
import { keyPagesMonthly, keyPagesMonthlyHandler } from "./monthly.job.ts";
import { keyPagesWeekly, keyPagesWeeklyHandler } from "./weekly.job.ts";

/**
 * The two night jobs (13 Oct 2026, DIY P8; spec 10 section 5.7), on the fake
 * database: the weekly own reads pick key pages, read each, read robots.txt
 * and verify what was done, with no ReadCtx and no paid read; the monthly
 * paid reads go through the doors handed in, stop where a cap refuses, and
 * store the top 3's structure only.
 */

const NOW = Date.parse("2026-10-14T03:31:00Z");
const DAY = "2026-10-14";
const client = testClient();

const html = (title: string, body: string, head = "") => `<html><head><title>${title}</title><link rel="canonical" href="CANON">${head}</head><body><h1>${title}</h1>${body}</body></html>`;

function fakeGet(pages: Record<string, { status: number; html: string }>): GuardedGet {
  return async (url: string): Promise<Guarded> => {
    const p = pages[url];
    if (!p) return { ok: true, status: 404, html: "Not found", headers: {}, url };
    return { ok: true, status: p.status, html: p.html.replace("CANON", url), headers: {}, url };
  };
}

const ctx = (db: JobContext["db"], over: Partial<JobContext> = {}): JobContext => ({ db, client, today: DAY, deadlineMs: NOW + 270_000, onboarding: false, ...over });

test("both handlers pass the dispatcher's rule, with the spec's kind, cadence and payment", () => {
  assert.deepEqual(refuseHandlers([keyPagesWeekly, keyPagesMonthly]), []);
  assert.deepEqual(
    [keyPagesWeekly, keyPagesMonthly].map((h) => [h.kind, h.paid, h.cadence, h.onboarding]),
    [
      ["key_pages_weekly", false, "weekly", true],
      ["key_pages_monthly", true, "monthly", true],
    ],
  );
});

test("weekly: picks the homepage and the ranking pages, reads each with our own fetch, reads robots.txt, and makes no paid read", async () => {
  const tables: Record<string, Row[]> = {
    key_pages: [],
    tracked_clusters: [{ id: "c8", client_domain_id: client.id, keyword_id: "k8", stopped_on: null }],
    tracking_serp: [{ id: "s1", client_domain_id: client.id, run_date: "2026-10-13", keyword_id: "k8", position: 14, url: "https://tallyroo.com/cloud" }],
    tracking_answers: [{ id: "a1", client_domain_id: client.id, run_date: "2026-10-12", question_id: "q1", engine: "chatgpt", answered: true, citations: [{ source_domain: "tallyroo.com", url: "https://tallyroo.com/freelancers" }] }],
    page_checks: [],
    bot_checks: [],
    plan_items: [],
    reopt_examples: [],
    diy_reads: [],
  };
  const { db } = fakeDiyDb(tables);
  const get = fakeGet({
    "https://tallyroo.com/": { status: 200, html: html("Tallyroo | Accounting", "<p>Hello there.</p>", `<script type="application/ld+json">{"@type":"Organization","name":"Tallyroo","url":"https://tallyroo.com/"}</script>`) },
    "https://tallyroo.com/cloud": { status: 200, html: html("Cloud accounting software", "<p>In the cloud.</p>") },
    "https://tallyroo.com/robots.txt": { status: 200, html: "User-agent: GPTBot\nDisallow: /\n" },
  });
  const r = await keyPagesWeeklyHandler({ get, now: () => NOW }).run(ctx(db));
  assert.equal(r.outcome, "ok");
  assert.match(r.note!, /^3 of 3 key pages read, 1 unreadable; 3 added; robots.txt read; 0 verified$/);
  assert.deepEqual(tables.key_pages!.map((k) => [k.url_key, k.origin, k.cluster_ids]), [
    ["tallyroo.com", "homepage", []],
    ["tallyroo.com/cloud", "ranking", ["c8"]],
    ["tallyroo.com/freelancers", "cited_own", []],
  ]);
  assert.equal(tables.page_checks!.length, 3);
  const home = tables.page_checks!.find((c) => c.url_key === "tallyroo.com")!;
  assert.equal(home.via, "own");
  assert.deepEqual((home.schema_found as { blocks: { types: string[] }[] }).blocks.map((b) => b.types), [["Organization"]]);
  assert.equal(tables.page_checks!.find((c) => c.url_key === "tallyroo.com/freelancers")!.status, "unreadable", "a 404 is an unreadable row, not a failed job");
  const bot = tables.bot_checks![0]!;
  assert.equal(bot.robots_status, 200);
  assert.equal(bot.llms_txt_status, 404);
  const crawlers = (bot.robots as { crawlers: { name: string; state: string }[] }).crawlers;
  assert.equal(crawlers.find((c) => c.name === "GPTBot")!.state, "blocked");
  assert.equal(crawlers.find((c) => c.name === "Googlebot")!.state, "allowed");
  assert.equal(tables.diy_reads!.length, 0, "no paid read, no ledger row");
});

test("weekly: a done item on a key page is verified by the read, through P3's markVerified", async () => {
  const tables: Record<string, Row[]> = {
    key_pages: [{ id: "kp-1", client_domain_id: client.id, url: "https://tallyroo.com/", url_key: "tallyroo.com", origin: "homepage", cluster_ids: [], added_by: "system", added_on: "2026-09-01", removed_on: null, removed_by: null }],
    tracked_clusters: [],
    tracking_serp: [],
    tracking_answers: [],
    page_checks: [],
    bot_checks: [],
    reopt_examples: [],
    plan_items: [{ id: "pi-1", client_domain_id: client.id, kind: "add_schema", severity: "tidy", status: "done", title: "Add Organization schema to your homepage", why: [], dedupe_key: "pages:schema:Organization:kp-1", ref_table: "key_pages", ref_id: "kp-1", created_by: "system", created_at: "2026-10-01T00:00:00Z", status_at: "2026-10-05T00:00:00Z", started_on: "2026-10-02", done_on: "2026-10-05", verified: null, missed: 0 }],
  };
  const { db } = fakeDiyDb(tables);
  const ld = `<script type="application/ld+json">{"@type":"Organization","name":"Tallyroo","url":"https://tallyroo.com/","logo":"https://tallyroo.com/l.svg","sameAs":["https://x.com/tallyroo"]}</script>`;
  const get = fakeGet({ "https://tallyroo.com/": { status: 200, html: html("Tallyroo", "<p>Hi</p>", ld) }, "https://tallyroo.com/robots.txt": { status: 404, html: "" } });
  const r = await keyPagesWeeklyHandler({ get, now: () => NOW }).run(ctx(db));
  assert.match(r.note!, /1 verified/);
  assert.deepEqual(tables.plan_items![0]!.verified, { by: "system", at: DAY, text: "Verified: Organization found with name, url, logo and sameAs, 14 Oct" });
  assert.equal((tables.bot_checks![0]!.robots as { state: string }).state, "none", "a 404 robots.txt is no robots.txt");
});

const readResult = <T,>(value: T, readId = "r") => ({ kind: "read" as const, value, cost: 0.0015, partial: false, readId });

test("monthly: relevant pages fill the key pages, each is read with JavaScript and the validator, and the top 3 others' structure is stored", async () => {
  const tables: Record<string, Row[]> = {
    key_pages: [{ id: "kp-1", client_domain_id: client.id, url: "https://tallyroo.com/", url_key: "tallyroo.com", origin: "homepage", cluster_ids: [], added_by: "system", added_on: "2026-09-01", removed_on: null, removed_by: null }],
    tracked_clusters: [{ id: "c8", client_domain_id: client.id, keyword_id: "k8", stopped_on: null }],
    tracking_serp: [{ id: "s1", client_domain_id: client.id, run_date: "2026-10-13", keyword_id: "k8", position: 2, url: "https://tallyroo.com/cloud", top: [{ rank: 1, domain: "ledgerline.com", url: "https://ledgerline.com/cloud" }, { rank: 2, domain: "tallyroo.com", url: "https://tallyroo.com/cloud" }, { rank: 3, domain: "rival-a.example", url: "https://rival-a.example/x" }, { rank: 4, domain: "rival-b.example", url: "https://rival-b.example/y" }, { rank: 5, domain: "rival-c.example", url: "https://rival-c.example/z" }] }],
    page_checks: [],
    top_structures: [],
    diy_reads: [],
  };
  const { db, clock } = fakeDiyDb(tables);
  const read = testCtx(db, clock);
  const parsed: string[] = [];
  const h = keyPagesMonthlyHandler({
    now: () => NOW,
    relevant: async () => readResult([{ url: "https://tallyroo.com/pricing", etv: 50, count: 3, pos1: 0, pos2_3: 1, pos4_10: 1, pos11_20: 1 }, { url: "https://ledgerline.com/x", etv: 900, count: 1, pos1: 0, pos2_3: 0, pos4_10: 0, pos11_20: 1 }]),
    deep: async (_c, url) => readResult({ page: { status: 200, url, title: "T", description: null, h1: ["T"], canonical: url, wordCount: 1200, checks: { no_title: false, no_h1_tag: false, is_https: true, has_micromarkup: true, has_micromarkup_errors: true, canonical: true } }, microdata: { summary: { fatal: 0, error: 1, warning: 0, info: 0 }, items: [{ types: ["Organization"], fields: [{ name: "name", value: "a value never stored" }], results: [{ level: "error", message: "logo is missing" }] }] }, microdataError: null }),
    parse: async (_c, url) => (parsed.push(url), readResult({ status: 200, title: `Title of ${url}`, h1: "H", headings: [{ level: 2, text: "Pricing" }], dates: ["1 Oct 2026"], links: [], wordCount: 1800 })),
  });
  const r = await h.run(ctx(db, { read }));
  assert.equal(r.outcome, "ok");
  assert.deepEqual(tables.key_pages!.map((k) => k.url_key), ["tallyroo.com", "tallyroo.com/pricing"], "a page on another domain is never a key page");
  const deep = tables.page_checks!.filter((c) => c.via === "instant_pages");
  assert.equal(deep.length, 2);
  assert.equal(deep[0]!.rendered_word_count, 1200);
  assert.ok(!JSON.stringify(deep[0]!.schema_results).includes("a value never stored"));
  assert.deepEqual(parsed, ["https://ledgerline.com/cloud", "https://rival-a.example/x", "https://rival-b.example/y"], "the top 3 others: the client's own result is skipped");
  assert.deepEqual(tables.top_structures!.map((t) => [t.rank, t.status, t.date_shown, t.word_count]), [
    [1, "ok", true, 1800],
    [3, "ok", true, 1800],
    [4, "ok", true, 1800],
  ]);
  assert.ok(!("text" in tables.top_structures![0]!) && !("markdown" in tables.top_structures![0]!), "no body text is stored");
});

test("monthly: a cap refusal stops the job - a daily cap defers it, the switch or a month budget skips it - and says what was read", async () => {
  const tables: Record<string, Row[]> = { key_pages: Array.from({ length: 10 }, (_, i) => ({ id: `kp-${i}`, client_domain_id: client.id, url: `https://tallyroo.com/p${i}`, url_key: `tallyroo.com/p${i}`, origin: "ranking", cluster_ids: [], added_by: "system", added_on: "2026-09-01", removed_on: null, removed_by: null })), tracked_clusters: [], tracking_serp: [], page_checks: [], top_structures: [] };
  const { db, clock } = fakeDiyDb(tables);
  const read = testCtx(db, clock);
  let n = 0;
  const refuse = (code: "door_daily" | "disabled") => keyPagesMonthlyHandler({
    now: () => NOW,
    relevant: async () => readResult([]),
    deep: async (_c, url) => (++n > 2 ? { kind: "refused" as const, refusal: { code, reason: code } } : readResult({ page: { status: 200, url, title: null, description: null, h1: [], canonical: null, wordCount: 10, checks: { no_title: true, no_h1_tag: true, is_https: true, has_micromarkup: false, has_micromarkup_errors: false, canonical: false } }, microdata: null, microdataError: null })),
    parse: async () => readResult(null),
  });
  const deferred = await refuse("door_daily").run(ctx(db, { read }));
  assert.equal(deferred.outcome, "deferred");
  assert.match(deferred.note!, /^2 key pages read with JavaScript, 0 top results read; stopped: door_daily$/);
  n = 0;
  assert.equal((await refuse("disabled").run(ctx(db, { read }))).outcome, "skipped");
  assert.equal((await keyPagesMonthly.run(ctx(db))).outcome, "failed", "a paid kind with no ReadCtx makes no read");
});
