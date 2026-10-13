import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDiyDb } from "../core/fake-diy.mts";

import { TOPS_PER_KEYWORD, newestTops, readSerp } from "./data.ts";

/**
 * Your pages' keyword readings (13 Oct 2026, dashboard speed work): each
 * keyword's newest stored page of results in one read, where every keyword
 * had a read of its own, one after another. The answer must be the one those
 * reads gave - the newest row with a top, whenever it was read - including
 * the keyword the shared read leaves out when it comes back full.
 */

const top = (d: string) => [{ rank: 1, domain: `${d}.example`, url: `https://${d}.example/` }];

/** What the old per-keyword read answered: the newest row with a top, any date. */
function oneByOne(rows: { client_domain_id: string; keyword_id: string; run_date: string; top: unknown }[], client: string, k: string) {
  return rows.filter((r) => r.client_domain_id === client && r.keyword_id === k && r.top !== null).sort((a, b) => (a.run_date < b.run_date ? 1 : -1))[0];
}

test("one read: each keyword's newest stored page, as a read per keyword had it", async () => {
  const serp = [
    { id: 1, client_domain_id: "c1", keyword_id: "k1", run_date: "2026-10-13", top: top("k1-13"), position: 3, url: "https://c1.example/a" },
    { id: 2, client_domain_id: "c1", keyword_id: "k1", run_date: "2026-10-12", top: top("k1-12"), position: 4, url: "https://c1.example/a" },
    { id: 3, client_domain_id: "c1", keyword_id: "k2", run_date: "2026-10-13", top: null, position: null, url: null },
    { id: 4, client_domain_id: "c1", keyword_id: "k2", run_date: "2026-08-01", top: top("k2-aug"), position: 9, url: null },
    { id: 5, client_domain_id: "c2", keyword_id: "k1", run_date: "2026-10-14", top: top("other-client"), position: 1, url: null },
  ];
  const f = fakeDiyDb({ tracking_serp: serp.map((r) => ({ ...r })) });
  const got = await newestTops(f.db, "c1", ["k1", "k2", "k3"]);
  assert.equal(got.get("k1")?.run_date, "2026-10-13");
  assert.equal(got.get("k2")?.run_date, "2026-08-01", "a page stored long ago is still the newest one");
  assert.equal(got.has("k3"), false, "never stored: none");
  assert.equal(f.calls.filter((c) => c.table === "tracking_serp").length, 1, "the read came back short, so it holds every stored page: one read");
  const out = await readSerp(f.db, "c1", ["k1", "k2"], "2026-10-14");
  assert.deepEqual(out.map((k) => [k.keywordId, k.topOn, k.top[0]?.domain]), [["k1", "2026-10-13", "k1-13.example"], ["k2", "2026-08-01", "k2-aug.example"]]);
  assert.deepEqual(out[0]!.readings.map((r) => r.day), ["2026-10-12", "2026-10-13"], "the readings come from their own read beside it");
});

test("a full read: a keyword it left out is read on its own, and gets the same row a read per keyword gave", async () => {
  // k1 read every day; k2 last stored a page a month ago, so a month of k1's rows crowds it out of the shared read.
  const serp: { id: number; client_domain_id: string; keyword_id: string; run_date: string; top: unknown }[] = [];
  for (let d = 1; d <= 13; d++) serp.push({ id: d, client_domain_id: "c1", keyword_id: "k1", run_date: `2026-10-${String(d).padStart(2, "0")}`, top: top(`k1-${d}`) });
  serp.push({ id: 99, client_domain_id: "c1", keyword_id: "k2", run_date: "2026-09-10", top: top("k2-sep") });
  const f = fakeDiyDb({ tracking_serp: serp.map((r) => ({ ...r })) });
  const got = await newestTops(f.db, "c1", ["k1", "k2"]);
  for (const k of ["k1", "k2"]) assert.equal(got.get(k)?.run_date, oneByOne(serp, "c1", k)?.run_date, k);
  const reads = f.calls.filter((c) => c.table === "tracking_serp");
  assert.equal(reads[0]!.rows, 2 * TOPS_PER_KEYWORD, "the shared read came back full");
  assert.equal(reads.length, 2, "and only the keyword it left out was read again");
});

test("a failed read throws, so the section says it could not read the results", async () => {
  const f = fakeDiyDb({ tracking_serp: [] }, { failSelect: (t) => t === "tracking_serp" });
  await assert.rejects(newestTops(f.db, "c1", ["k1"]), /could not read the results for a keyword/);
  await assert.rejects(readSerp(f.db, "c1", ["k1"], "2026-10-14"));
});
