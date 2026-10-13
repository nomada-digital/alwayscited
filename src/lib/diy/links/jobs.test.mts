import assert from "node:assert/strict";
import { test } from "node:test";

import type { BacklinksSummary, GapDomain, GapPage, LinkRow, MentionCandidate } from "../../scan/dataforseo-request.ts";
import type { Row } from "../../tracking/fake-db.mts";
import { fakeDiyDb, testCtx } from "../core/fake-diy.mts";
import type { Guarded, GuardedGet } from "../core/fetch.ts";
import type { ReadResult } from "../core/ledger.ts";

import { reclaimCandidates } from "./candidates.ts";
import type { LinksIO } from "./io.ts";
import { backlinksMonthlyHandler, runMonthly } from "./monthly.job.ts";
import { NONE_PLACED } from "./nomada-placements.ts";
import { backlinksWeeklyHandler, runWeekly } from "./weekly.job.ts";
import { pursueLink, revealPages } from "./write.ts";

/**
 * The Backlinks jobs, the Reclaim card and Links' writes (13 Oct 2026, DIY
 * P10; spec 10 sections 5.7, 6.1 and 6.3), on the fake database and fake
 * reads - nothing reaches DataForSEO. Every list is stored with Nomada's
 * placements for other clients already subtracted.
 */

const TODAY = "2026-10-14";
const CLIENT = { id: "c-tallyroo", domain: "tallyroo.com", brand: "Tallyroo" };
const THREE = ["ledgerline.com", "brightbook.example", "countwise.example"];
let readId = 0;
const ok = <T,>(value: T): ReadResult<T> => ({ kind: "read", value, cost: 0.0276, partial: false, readId: `r-${++readId}` });
const failed = (reason: string): ReadResult<never> => ({ kind: "failed", reason, cost: 0, readId: `r-${++readId}` });
const refused = (code: "door_daily" | "month_budget"): ReadResult<never> => ({ kind: "refused", refusal: { code, reason: code } });
const link = (domain: string, urlTo = "https://tallyroo.com/"): LinkRow => ({ domain, urlFrom: `https://${domain}/p`, urlTo, followed: true, firstSeen: "2026-10-10", lastSeen: "2026-10-12" });
const noWeb: GuardedGet = async (): Promise<Guarded> => ({ ok: false, why: "network" });

/** A fake io: each read's answer by name, every call recorded. */
function fakeIO(over: Partial<Record<keyof LinksIO, unknown>> = {}, calls: string[] = []): LinksIO {
  const summary: BacklinksSummary = { rank: 212, backlinks: 1840, referringDomains: 312, referringMainDomains: 288, firstSeen: "2021-03-02", follow: { followed: 1538, notFollowed: 260, other: 42 } };
  const base: Record<string, unknown> = {
    get: noWeb,
    summary: async () => (calls.push("summary"), ok(summary)),
    newLost: async (_c: unknown, which: string) => (calls.push(`newLost:${which}`), ok({ total: 2, rows: which === "new" ? [link("booksandbills.example"), link("softwarecritic.com")] : [link("ledgerjournal.example", "https://tallyroo.com/invoicing")] })),
    series: async () => (calls.push("series"), ok([{ week: "2026-10-11", newDomains: 4, lostDomains: 1 }])),
    bulkRanks: async () => (calls.push("bulkRanks"), ok({ "tallyroo.com": 212, "ledgerline.com": 405 })),
    bulkDomains: async () => (calls.push("bulkDomains"), ok({ "tallyroo.com": 312 })),
    bulkNewLost: async () => (calls.push("bulkNewLost"), ok({ "tallyroo.com": { newDomains: 3, lostDomains: 1 } })),
    domainGap: async (_c: unknown, p: { targets: string[]; mode: string }) => {
      calls.push(`domainGap:${p.mode}:${p.targets.length}`);
      const rows: GapDomain[] = [
        { domain: "thesmallbizstack.com", linksTo: p.targets.slice(0, 2), rank: 300, firstSeen: "2025-01-01", platform: "blog" },
        { domain: "softwarecritic.com", linksTo: p.targets.slice(0, 2), rank: 900, firstSeen: "2025-01-01", platform: null },
        { domain: "single.example", linksTo: p.targets.slice(0, 1), rank: 100, firstSeen: "2025-01-01", platform: null },
      ];
      return ok({ total: rows.length, rows });
    },
    pageGap: async () => {
      calls.push("pageGap");
      const rows: GapPage[] = [
        { urlFrom: "https://guide.example/best", title: "Best tools", domain: "guide.example", links: [{ target: THREE[0]!, urlTo: "https://ledgerline.com/", anchor: "Ledgerline" }], pageRank: 300, firstSeen: "2026-01-01" },
        { urlFrom: "https://softwarecritic.com/accounting", title: "Rated", domain: "softwarecritic.com", links: [{ target: THREE[0]!, urlTo: "https://ledgerline.com/", anchor: "x" }], pageRank: 900, firstSeen: "2026-01-01" },
      ];
      return ok({ total: 2, rows });
    },
    labsCompetitors: async () => (calls.push("labs"), ok([])),
    backlinksCompetitors: async () => (calls.push("backlinksCompetitors"), ok([])),
    contentSearch: async () => (calls.push("contentSearch"), ok({ total: 1, rows: [{ url: "https://named.example/a", domain: "named.example", title: "A", published: null, snippet: "Tallyroo" } as MentionCandidate] })),
    parse: async () => (calls.push("parse"), ok(null)),
    classify: async () => (calls.push("classify"), failed("not expected")),
  };
  return { ...base, ...over } as unknown as LinksIO;
}

const placements: Row[] = [{ id: "pl-1", client_domain_id: "c-other", domain: "softwarecritic.com", url_key: "softwarecritic.com/accounting" }];

test("weekly: the summary, then the week's new and lost; stored by night, with another client's placement left out", async () => {
  const w = fakeDiyDb({ placements: [...placements], backlink_reads: [] });
  const calls: string[] = [];
  const out = await runWeekly(w.db, testCtx(w.db, w.clock), fakeIO({}, calls), CLIENT, TODAY);
  assert.equal(out.outcome, "ok", out.note);
  assert.deepEqual(calls, ["summary", "newLost:new", "newLost:lost"]);
  const rows = w.tables.backlink_reads!;
  assert.deepEqual(rows.map((r) => [r.kind, r.read_on]), [["summary", TODAY], ["new_lost", TODAY]]);
  const nl = rows[1]!.payload as { since: string; added: LinkRow[]; lost: LinkRow[] };
  assert.equal(nl.since, "2026-10-07");
  assert.deepEqual(nl.added.map((r) => r.domain), ["booksandbills.example"], "the placed domain is not stored");
  assert.doesNotMatch(JSON.stringify(rows), /softwarecritic|sponsored|attributes/);
  // A re-run the same night replaces its own rows.
  await runWeekly(w.db, testCtx(w.db, w.clock), fakeIO(), CLIENT, TODAY);
  assert.equal(w.tables.backlink_reads!.length, 2);
});

test("weekly: an access refusal on the summary stops the lists; a cap defers the job; a month budget skips it", async () => {
  const w = fakeDiyDb({ placements: [] });
  const calls: string[] = [];
  const inactive = await runWeekly(w.db, testCtx(w.db, w.clock), fakeIO({ summary: async () => (calls.push("summary"), failed("task 40204 access denied. visit plans and subscriptions")) }, calls), CLIENT, TODAY);
  assert.equal(inactive.outcome, "skipped", "closed, not retried the same night: the retry would be refused the same way");
  assert.match(inactive.note!, /Backlinks access isn't active/);
  assert.deepEqual(calls, ["summary"], "one refused call a week is all an inactive account costs");
  assert.equal((await runWeekly(w.db, testCtx(w.db, w.clock), fakeIO({ summary: async () => refused("door_daily") }), CLIENT, TODAY)).outcome, "deferred");
  assert.equal((await runWeekly(w.db, testCtx(w.db, w.clock), fakeIO({ summary: async () => refused("month_budget") }), CLIENT, TODAY)).outcome, "skipped");
  const timeout = await runWeekly(w.db, testCtx(w.db, w.clock), fakeIO({ summary: async () => failed("timeout") }), CLIENT, TODAY);
  assert.equal(timeout.outcome, "ok", "the lists still read when only the summary timed out");
  assert.match(timeout.note!, /summary failed: timeout/, "and the note says so");
});

/** The tables a monthly run reads: a live cluster, its SERPs, the domain types, a placement, the client and the filter names. */
function monthlyTables(over: { filters?: boolean; vendors?: string[] } = {}): Record<string, Row[]> {
  const vendors = over.vendors ?? THREE;
  return {
    placements: [...placements],
    tracked_clusters: [{ id: "c1", client_domain_id: CLIENT.id, keyword_id: "k1", stopped_on: null }],
    tracking_serp: ["2026-10-12", "2026-10-11"].map((d, i) => ({
      id: `s${i}`,
      client_domain_id: CLIENT.id,
      keyword_id: "k1",
      run_date: d,
      top: [...vendors, "pub.example", "softwarecritic.com", "tallyroo.com"].map((h, j) => ({ rank: j + 1, domain: h, url: `https://${h}/x` })),
    })),
    source_kinds: [
      ...THREE.map((d) => ({ key: `d:${d}`, level: "domain", domain_type: "vendor", set_by: "model" })),
      { key: "d:pub.example", level: "domain", domain_type: "publisher", set_by: "model" },
      { key: "d:softwarecritic.com", level: "domain", domain_type: "vendor", set_by: "model" },
    ],
    client_domains: [{ id: CLIENT.id, domain: "tallyroo.com", brand_name: "Tallyroo", brand_aliases: [] }],
    diy_vendor_status: over.filters ? [{ kind: "backlinks_filters", read_on: "2026-10-14", payload: { groups: { domain_intersection: ["$key.target", "intersections_count"] } } }] : [],
    comparison_sets: [],
    backlink_reads: [],
  };
}

test("monthly with the count filter: the set from page-1 places (vendor only, never the client or a placement), one gap read, every list stored after the subtraction", async () => {
  const w = fakeDiyDb(monthlyTables({ filters: true }));
  const calls: string[] = [];
  const out = await runMonthly(w.db, testCtx(w.db, w.clock), fakeIO({}, calls), CLIENT, TODAY);
  assert.equal(out.outcome, "ok", out.note);
  assert.deepEqual(w.tables.comparison_sets!.map((r) => r.domains), [THREE]);
  assert.deepEqual((w.tables.comparison_sets![0]!.basis as Record<string, { from: string; places: number }>)["ledgerline.com"], { from: "page1", places: 2, avg: 1 });
  assert.ok(!calls.includes("labs"), "no fallback with 3 page-1 vendors");
  assert.deepEqual(calls.filter((c) => c.startsWith("domainGap")), ["domainGap:partial:3"]);
  const stored = Object.fromEntries(w.tables.backlink_reads!.map((r) => [r.kind as string, r.payload as Record<string, unknown>]));
  assert.deepEqual(Object.keys(stored).sort(), ["bulk", "domain_gap", "mentions", "page_gap", "timeseries"]);
  assert.deepEqual((stored.domain_gap!.rows as GapDomain[]).map((r) => r.domain), ["thesmallbizstack.com"], "n >= 2, and the placed domain gone");
  assert.equal(stored.domain_gap!.via, "filter");
  assert.deepEqual((stored.page_gap!.rows as GapPage[]).map((r) => r.domain), ["guide.example"]);
  assert.doesNotMatch(JSON.stringify(w.tables.backlink_reads), /softwarecritic/);
  assert.equal((stored.mentions!.confirmed as unknown[]).length, 0, "a candidate we could not read is never shown");
});

test("monthly without the count filter: the three pairwise reads, their union stored", async () => {
  const w = fakeDiyDb(monthlyTables({ filters: false }));
  const calls: string[] = [];
  await runMonthly(w.db, testCtx(w.db, w.clock), fakeIO({}, calls), CLIENT, TODAY);
  assert.deepEqual(calls.filter((c) => c.startsWith("domainGap")), ["domainGap:all:2", "domainGap:all:2", "domainGap:all:2"]);
  const gap = w.tables.backlink_reads!.find((r) => r.kind === "domain_gap")!.payload as { via: string; rows: GapDomain[] };
  assert.equal(gap.via, "pairwise");
  assert.deepEqual(gap.rows.map((r) => r.domain), ["thesmallbizstack.com"]);
});

test("monthly with one page-1 vendor: Labs fills, a fallback domain with no type is typed first, and the set says each basis; under 3, no gap", async () => {
  const w = fakeDiyDb(monthlyTables({ vendors: ["ledgerline.com"] }));
  const calls: string[] = [];
  const io = fakeIO(
    {
      labsCompetitors: async () => (calls.push("labs"), ok([{ domain: "sumly.example", intersections: 212, avgPosition: 12 }, { domain: "newcomer.example", intersections: 90, avgPosition: 20 }])),
      classify: async (_c: unknown, input: { items: number; user: string }) => {
        calls.push(`classify:${input.items}`);
        return ok({ items: [{ key: "newcomer.example", domain_type: "vendor", page_type: null }] });
      },
    },
    calls,
  );
  w.tables.source_kinds!.push({ key: "d:sumly.example", level: "domain", domain_type: "vendor", set_by: "model" });
  const out = await runMonthly(w.db, testCtx(w.db, w.clock), io, CLIENT, TODAY);
  assert.equal(out.outcome, "ok", out.note);
  assert.ok(calls.includes("labs"));
  assert.ok(calls.includes("classify:1"), "the one untyped fallback domain, in one chunk");
  const set = w.tables.comparison_sets![0]!;
  assert.deepEqual(set.domains, ["ledgerline.com", "sumly.example", "newcomer.example"]);
  assert.deepEqual((set.basis as Record<string, unknown>)["sumly.example"], { from: "labs", shares: 212 });
  assert.ok(w.tables.source_kinds!.some((k) => k.key === "d:newcomer.example" && k.domain_type === "vendor"), "the type is cached for the next night too");

  const few = fakeDiyDb(monthlyTables({ vendors: ["ledgerline.com"] }));
  const fewCalls: string[] = [];
  const fewOut = await runMonthly(few.db, testCtx(few.db, few.clock), fakeIO({}, fewCalls), CLIENT, TODAY);
  assert.ok(fewCalls.includes("backlinksCompetitors"), "after Labs, backlinks competitors");
  assert.ok(!fewCalls.some((c) => c.startsWith("domainGap") || c === "pageGap"), "no gap or targets with fewer than 3");
  assert.match(fewOut.note!, /1 compared sites: no gap or targets until there are 3/);
});

test("monthly: a placements read that fails stores no list; a cap stops and defers", async () => {
  const w = fakeDiyDb(monthlyTables(), { failSelect: (t) => t === "placements" });
  const out = await runMonthly(w.db, testCtx(w.db, w.clock), fakeIO(), CLIENT, TODAY);
  assert.equal(out.outcome, "failed");
  assert.equal(w.tables.backlink_reads!.length, 0);
  const c = fakeDiyDb(monthlyTables({ filters: true }));
  const capped = await runMonthly(c.db, testCtx(c.db, c.clock), fakeIO({ series: async () => refused("door_daily") }), CLIENT, TODAY);
  assert.equal(capped.outcome, "deferred");
  const access = await runMonthly(c.db, testCtx(c.db, c.clock), fakeIO({ series: async () => failed("task 40204 access denied.") }), CLIENT, TODAY);
  assert.equal(access.outcome, "skipped");
  assert.match(access.note!, /nothing more was asked/);
});

test("the handlers: paid, the weekly on onboarding, and a paid kind with no ReadCtx skips", async () => {
  const weekly = backlinksWeeklyHandler(fakeIO());
  const monthly = backlinksMonthlyHandler(fakeIO());
  assert.deepEqual([weekly.kind, weekly.paid, weekly.cadence, weekly.onboarding], ["backlinks_weekly", true, "weekly", true]);
  assert.deepEqual([monthly.kind, monthly.paid, monthly.cadence, monthly.onboarding], ["backlinks_monthly", true, "monthly", false]);
  const w = fakeDiyDb({});
  const ctx = { db: w.db, client: { ...CLIENT } as never, today: TODAY, deadlineMs: Date.now() + 1000, onboarding: false };
  assert.equal((await weekly.run(ctx)).outcome, "skipped");
});

test("Reclaim: a lost link that pointed at a live key page, newest first, never on a placed domain; nothing without a read", () => {
  const read = {
    readOn: "2026-10-14",
    value: {
      since: "2026-10-07",
      added: [],
      lost: [
        { ...link("ledgerjournal.example", "https://tallyroo.com/invoicing"), lastSeen: "2026-10-12" },
        { ...link("other.example", "https://tallyroo.com/not-a-key-page"), lastSeen: "2026-10-13" },
        { ...link("softwarecritic.com", "https://tallyroo.com/invoicing"), lastSeen: "2026-10-13" },
      ],
      addedTotal: 0,
      lostTotal: 3,
    },
  };
  const cards = reclaimCandidates(read, [{ url: "https://tallyroo.com/invoicing/", clusterIds: ["c1"] }], { domains: new Set(["softwarecritic.com"]), keys: new Set() });
  assert.equal(cards.length, 1);
  const c = cards[0]!;
  assert.deepEqual([c.dedupeKey, c.kind, c.severity, c.clusterId, c.grade, c.href], ["reclaim:ledgerjournal.example", "reclaim_link", "slipping", "c1", "practice", "/links?view=profile#lost"]);
  assert.equal(c.title, "Reclaim the link from ledgerjournal.example");
  assert.equal(c.why[0]!.text, "ledgerjournal.example linked to /invoicing and the link is gone (DataForSEO estimate, read 14 Oct).");
  assert.ok(c.title.length <= 70);
  assert.deepEqual(reclaimCandidates(null, [], NONE_PLACED), []);
});

test("reveal and Pursue write P7's rows through P7's own functions: a revealed page keeps its first time, a pursuit is capped", async () => {
  const w = fakeDiyDb({ opportunities: [], plan_items: [] });
  const pages = [
    { url: "https://guide.example/best", domain: "guide.example", title: "Best tools" },
    { url: "https://guide2.example/top", domain: "guide2.example", title: "Top tools" },
  ];
  assert.equal(await revealPages(w.db, CLIENT.id, pages, { today: TODAY, now: Date.parse("2026-10-14T09:00:00Z") }), 2);
  assert.deepEqual(w.tables.opportunities!.map((r) => [r.lens, r.url_key, r.route, r.status, r.revealed_at]), [
    ["link_page", "guide.example/best", "earn_link", "new", "2026-10-14T09:00:00.000Z"],
    ["link_page", "guide2.example/top", "earn_link", "new", "2026-10-14T09:00:00.001Z"],
  ]);
  assert.equal(await revealPages(w.db, CLIENT.id, pages.slice(0, 1), { today: TODAY, now: Date.parse("2026-10-20T09:00:00Z") }), 0, "revealed once, kept at its first time");
  assert.equal(w.tables.opportunities![0]!.revealed_at, "2026-10-14T09:00:00.000Z");

  const p = { role: "owner", by: "owner@example.com", today: TODAY, now: "2026-10-14T09:05:00.000Z" };
  const got = await pursueLink(w.db, { id: CLIENT.id, trial: false, ended: false }, { lens: "link_domain", url: "https://thesmallbizstack.com/", domain: "thesmallbizstack.com", title: "thesmallbizstack.com", route: "earn_link" }, p);
  assert.equal(got.ok, true);
  const row = w.tables.opportunities!.find((r) => r.lens === "link_domain")!;
  assert.deepEqual([row.url_key, row.status, row.route], ["thesmallbizstack.com", "pursuing", "earn_link"]);
  // At the trial's cap of 3 the next is refused by P7's rule.
  for (const d of ["a.example", "b.example"]) await pursueLink(w.db, { id: CLIENT.id, trial: true, ended: false }, { lens: "link_domain", url: `https://${d}/`, domain: d, title: d, route: "earn_link" }, p);
  const over = await pursueLink(w.db, { id: CLIENT.id, trial: true, ended: false }, { lens: "mention", url: "https://named.example/a", domain: "named.example", title: "A", route: "ask_for_link" }, p);
  assert.deepEqual(over, { ok: false, why: "cap", id: over.id });
  const viewer = await pursueLink(w.db, { id: CLIENT.id, trial: false, ended: false }, { lens: "mention", url: "https://named.example/b", domain: "named.example", title: "B", route: "ask_for_link" }, { ...p, role: "viewer" });
  assert.equal(viewer.ok, false);
});
