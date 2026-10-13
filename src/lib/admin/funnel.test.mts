// R152 part 1 (1 Oct 2026): /admin/funnel's pure counts. The page is part 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FUNNEL_SELECTS, FUNNEL_STEPS, funnelDays, funnelTotals, marketOf, walkthroughMarket } from "./funnel.ts";

const rows = {
  scans: [
    { created_at: "2026-09-30T10:00:00Z", queued_at: "2026-09-30T10:01:00Z", status: "complete", market: "UK" },
    { created_at: "2026-09-30T11:00:00Z", queued_at: null, status: "pending_topic", market: "US" },
    { created_at: "2026-10-01T01:00:00Z", queued_at: "2026-10-01T01:02:00Z", status: "running", market: "US" },
    { created_at: "2026-09-20T01:00:00Z", queued_at: null, status: "complete", market: "UK" },
    { created_at: "2026-10-01T02:00:00Z", queued_at: null, status: "pending_topic", market: null },
  ],
  walkthroughs: [{ created_at: "2026-09-30T12:00:00Z", market: "UK" }],
  orders: [{ created_at: "2026-10-01T03:00:00Z", market: "us" }],
};

test("counts each step by the row's own day and market, newest day first, from `from` on", () => {
  const days = funnelDays(rows, "2026-09-25");
  assert.deepEqual(days.map((d) => d.day), ["2026-10-01", "2026-09-30"]);
  const [oct1, sep30] = days;
  assert.deepEqual(sep30.counts.started, { US: 1, UK: 1 });
  assert.deepEqual(sep30.counts.confirmed, { US: 0, UK: 1 });
  assert.deepEqual(sep30.counts.completed, { US: 0, UK: 1 });
  assert.deepEqual(sep30.counts.walkthrough, { US: 0, UK: 1 });
  assert.deepEqual(oct1.counts.confirmed, { US: 1, UK: 0 });
  assert.deepEqual(oct1.counts.paid, { US: 1, UK: 0 });
  // A scan with no market counts under neither, rather than inflating one.
  assert.deepEqual(oct1.counts.started, { US: 1, UK: 0 });
});

test("a step no table records is null, never a zero", () => {
  const unlogged = FUNNEL_STEPS.filter((s) => s.source === null).map((s) => s.key);
  assert.deepEqual(unlogged, ["opened", "checkout"]);
  const days = funnelDays(rows, "2026-09-01");
  for (const d of days) for (const k of unlogged) assert.equal(d.counts[k], null);
  const t = funnelTotals(days);
  for (const k of unlogged) assert.equal(t[k], null);
  assert.deepEqual(t.started, { US: 2, UK: 2 });
});

test("no personal data comes out: only days and numbers, whatever extra fields the rows carry", () => {
  const leaky = {
    scans: rows.scans.map((s) => ({ ...s, email: "a@example.com", domain: "example.com", brand: "Example" })),
    walkthroughs: rows.walkthroughs.map((w) => ({ ...w, email: "a@example.com" })),
    orders: rows.orders.map((o) => ({ ...o, email: "a@example.com", keyword: "secret" })),
  };
  const out = JSON.stringify([funnelDays(leaky, "2026-09-01"), funnelTotals(funnelDays(leaky, "2026-09-01"))]);
  assert.doesNotMatch(out, /@|example|Example|secret/);
  // Every string value in the output is a day; everything else is a number or null.
  const walk = (v: unknown): void => {
    if (typeof v === "string") assert.match(v, /^\d{4}-\d{2}-\d{2}$/);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
    else assert.ok(v === null || typeof v === "number", `unexpected ${typeof v}`);
  };
  walk(JSON.parse(out));
});

test("the page's reads ask for no personal column, and the page reads only through them", async () => {
  for (const sel of Object.values(FUNNEL_SELECTS)) {
    assert.doesNotMatch(sel, /email|domain|brand|name|ip_hash|keyword|topic|stripe|customer/i, sel);
  }
  const page = await readFile(new URL("../../app/admin/funnel/page.tsx", import.meta.url), "utf8");
  const selects = [...page.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
  // Four since 13 Oct 2026, three tables: walkthrough_requests is read again
  // through walkthroughsBefore only when its market column is missing (a
  // deploy before 20261014000000_walkthrough_fields.sql). Was three.
  assert.equal(selects.length, 4, "the page makes exactly four reads, one of them the pre-migration walkthrough fallback");
  for (const s of selects) assert.match(s, /^FUNNEL_SELECTS\.\w+$/, `a read not through FUNNEL_SELECTS: ${s}`);
  assert.equal(new Set(selects).size, 4, "each read is a different select");
});

// 13 Oct 2026: an ask carries its own market (Danny made it required), so a
// tier page's ask - no scan - counts under it; an older ask falls back to its scan's.
test("a walkthrough ask counts under its own market, else its scan's, else neither", () => {
  assert.equal(walkthroughMarket({ market: "US", scans: null }), "US", "a tier page's ask");
  assert.equal(walkthroughMarket({ market: "UK", scans: { market: "US" } }), "UK", "its own market is what the person picked");
  assert.equal(walkthroughMarket({ market: null, scans: { market: "US" } }), "US", "an older ask, by its scan");
  assert.equal(walkthroughMarket({ scans: [{ market: "UK" }] }), "UK", "the pre-migration read has no market key, and an embed may be an array");
  assert.equal(walkthroughMarket({ market: null, scans: null }), null, "an older tier page ask counts under neither");
  const days = funnelDays({ scans: [], walkthroughs: [{ created_at: "2026-10-14T09:00:00Z", market: walkthroughMarket({ market: "US", scans: null }) }], orders: [] }, "2026-10-01");
  assert.deepEqual(days[0].counts.walkthrough, { US: 1, UK: 0 });
});

test("market spellings: orders store lower case, scans upper", () => {
  assert.equal(marketOf("uk"), "UK");
  assert.equal(marketOf("US"), "US");
  assert.equal(marketOf("EU"), null);
  assert.equal(marketOf(null), null);
});
