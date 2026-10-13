import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fakeDiyDb, settingsRows } from "../core/fake-diy.mts";

import { FIXTURE_CLIENT, firstReadOn, fixtureTops, fixtureUrls, keywordsFixture, latestTops, loadFootprint, loadOthersPlaced, loadSerpDetail, loadWhoRanks, readJob, readPulls } from "./data.ts";
import { gainingLabel, momentum } from "./momentum.ts";
import { urlAt } from "./tracked.ts";

/**
 * The keyword pages' reads (13 Oct 2026, DIY P6; spec 10 sections 3.4, 4.3
 * and 7.7): the fixture's states as the package's section lists them, the
 * dark rule, and the Supabase reads on a fake database.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const env = (state?: string) => ({ TRACKING_FIXTURE: "1", VERCEL_ENV: "development", ...(state ? { DIY_FIXTURE_STATE: state } : {}) });
const fx = JSON.parse(readFileSync(join(ROOT, "src/lib/tracking/fixture.json"), "utf8")) as { data: { keywords: { keyword: string; stopped_on: string | null }[]; serp: { run_date: string; keyword_id: string; position: number | null }[] }; aliases: string[]; today: string };

test("full: two pulls of 300 rows, and the momentum rule finds 15 gaining ground on the fixture's tracked keywords", async () => {
  const fp = await loadFootprint(FIXTURE_CLIENT, { env: env(), root: ROOT });
  assert.equal(fp.enabled, true);
  assert.ok(fp.pulls?.ok);
  const { latest, previous } = fp.pulls.value;
  assert.equal(latest!.rows.length, 300);
  assert.equal(previous!.rows.length >= 290, true);
  assert.ok(fp.dismissals?.ok);
  const live = fp.dismissals.value.filter((d) => d.until >= fx.today).map((d) => d.key);
  const m = momentum({ latest: latest!, previous, tracked: fx.data.keywords, dismissed: new Set(live), subject: { brand: "Tallyroo", domain: "tallyroo.com", aliases: fx.aliases }, showAll: false, today: fx.today });
  assert.equal(m.total, 15);
  assert.equal(m.basis, "ours");
  const all = momentum({ latest: latest!, previous, tracked: fx.data.keywords, dismissed: new Set(live), subject: { brand: "Tallyroo", domain: "tallyroo.com", aliases: fx.aliases }, showAll: true, today: fx.today });
  assert.ok(all.total > 15 && all.rows.length === 15, "intent=all finds more, and shows the top 15");
  assert.ok(!m.rows.some((g) => g.keyword === "expense app for consultants"), "the live dismissal is left out");
  assert.ok(m.rows.some((g) => g.keyword === "estimate template for contractors"), "the lapsed one is back");
  // The previous pull holds 298 of 1,318: the 3 new keywords are missing from it, so DataForSEO's own reading says they are new.
  assert.equal(m.previousComplete, false);
  assert.deepEqual(m.rows.filter((g) => g.kind === "new").map((g) => g.basis), ["dataforseo", "dataforseo", "dataforseo"]);
  assert.ok(m.rows.filter((g) => g.kind === "climbing").every((g) => g.basis === "ours"));
  assert.equal(gainingLabel(m.rows.find((g) => g.keyword === "payroll software for sole traders")!), "Up from 18th to 7th");
});

test("dark: nothing read - hidden, not shown empty; day0: one pull, compared with DataForSEO's reading; nofootprint: an empty pull; zero: nothing gaining", async () => {
  const dark = await loadFootprint(FIXTURE_CLIENT, { env: env("dark"), root: ROOT });
  assert.deepEqual(dark, { enabled: false, pulls: null, dismissals: null, job: null, aliases: [] });
  const day0 = await loadFootprint(FIXTURE_CLIENT, { env: env("day0"), root: ROOT });
  assert.ok(day0.pulls?.ok && day0.pulls.value.latest && !day0.pulls.value.previous);
  const m = momentum({ latest: day0.pulls.value.latest!, previous: null, tracked: fx.data.keywords, dismissed: new Set(), subject: { brand: "Tallyroo", domain: "tallyroo.com", aliases: fx.aliases }, showAll: false, today: fx.today });
  assert.equal(m.basis, "dataforseo");
  assert.ok(m.climbing > 0 && m.new > 0, "climbs read rank_absolute against DataForSEO's previous one, so the fixture carries both");
  assert.ok(m.rows.every((g) => g.basis === "dataforseo" && /since DataForSEO's reading of \d+ \w+ 2026/.test(gainingLabel(g))));
  const none = await loadFootprint(FIXTURE_CLIENT, { env: env("nofootprint"), root: ROOT });
  assert.ok(none.pulls?.ok);
  assert.deepEqual(none.pulls.value.latest?.rows, []);
  const zero = await loadFootprint(FIXTURE_CLIENT, { env: env("zero"), root: ROOT });
  assert.ok(zero.pulls?.ok);
  assert.equal(momentum({ latest: zero.pulls.value.latest!, previous: zero.pulls.value.previous, tracked: fx.data.keywords, dismissed: new Set(), subject: { brand: "Tallyroo", domain: "tallyroo.com", aliases: fx.aliases }, showAll: true, today: fx.today }).total, 0);
  const other = await loadFootprint("someone-else", { env: env(), root: ROOT });
  assert.ok(other.pulls?.ok && other.pulls.value.latest === null, "the fixture describes its own client only");
});

test("the fixture's URLs lie over the tracking fixture's own readings: a URL only on a day it ranked; invoicing software's two pages take turns", () => {
  const f = keywordsFixture(env(), ROOT);
  const urls = fixtureUrls(f, fx.data.serp);
  const k3 = fx.data.serp.filter((s) => s.keyword_id === "k3" && s.position !== null).map((s) => urls.get(urlAt("k3", s.run_date)));
  assert.deepEqual([...new Set(k3)].sort(), ["https://tallyroo.com/features/invoices", "https://tallyroo.com/invoicing"]);
  const k9 = fx.data.serp.filter((s) => s.keyword_id === "k9").map((s) => urls.get(urlAt("k9", s.run_date)));
  assert.ok(k9.every((u) => u === undefined), "never ranked, no URL");
  const tops = fixtureTops(f, fx.data.serp, fx.today);
  assert.equal(tops.get("k1")!.top.length, 20);
  assert.equal(tops.get("k1")!.day, fx.today);
  assert.ok(f.othersPlaced.some((k) => tops.get("k4")!.top.some((h) => h.url?.includes(k.split("/").slice(1).join("/")))), "one other client's placed page sits in k4's top 10, to be left out");
});

test("Supabase: the newest two pulls, one client's; each top the newest stored for its keyword; other clients' placed pages by url key; a failed read is a section error", async () => {
  const f = fakeDiyDb({
    app_settings: settingsRows(),
    keyword_footprints: [
      { client_domain_id: "c1", pulled_on: "2026-10-01", labs_date: null, total_count: 1, etv: 1, rows: [{ k: "a", p: 3 }] },
      { client_domain_id: "c1", pulled_on: "2026-10-14", labs_date: "2026-10-12", total_count: 1, etv: 1, rows: [{ k: "a", p: 2 }] },
      { client_domain_id: "c1", pulled_on: "2026-10-07", labs_date: "2026-10-05", total_count: 1, etv: 1, rows: [{ k: "a", p: 4 }] },
      { client_domain_id: "c2", pulled_on: "2026-10-15", labs_date: "2026-10-12", total_count: 1, etv: 1, rows: [] },
    ],
    diy_dismissals: [],
    diy_jobs: [{ client_domain_id: "c1", kind: "footprint", due_on: "2026-10-14", outcome: "failed" }],
    client_domains: [{ id: "c1", brand_aliases: ["Tally Roo"] }],
    placements: [
      { id: "p1", client_domain_id: "c1", url_key: "mine.example/a", url: "https://mine.example/a" },
      { id: "p2", client_domain_id: "c2", url_key: "softwarecritic.com/best-bookkeeping-software", url: "https://softwarecritic.com/best-bookkeeping-software" },
    ],
  });
  const two = await readPulls(f.db, "c1");
  assert.deepEqual([two.latest?.pulledOn, two.previous?.pulledOn], ["2026-10-14", "2026-10-07"]);
  const fp = await loadFootprint("c1", { db: () => f.db, env: {} });
  assert.equal(fp.enabled, true);
  assert.deepEqual(fp.aliases, ["Tally Roo"]);
  assert.ok(fp.job?.ok && fp.job.value.failed && fp.job.value.dueOn === "2026-10-14");
  const others = await loadOthersPlaced("c1", { db: () => f.db, env: {} });
  assert.ok(others.ok);
  assert.deepEqual([...others.value], ["softwarecritic.com/best-bookkeeping-software"]);
  const tops = latestTops([
    { run_date: "2026-10-13", keyword_id: "k1", top: [{ rank: 1, domain: "a.example", url: "https://a.example/" }] },
    { run_date: "2026-10-14", keyword_id: "k1", top: null },
    { run_date: "2026-10-12", keyword_id: "k1", top: [{ rank: 1, domain: "b.example", url: "https://b.example/" }] },
  ]);
  assert.deepEqual(tops.get("k1"), { day: "2026-10-13", top: [{ rank: 1, domain: "a.example", url: "https://a.example/" }] }, "a row with no top is passed over");
  const warn = console.warn;
  console.warn = () => {};
  try {
    const broken = fakeDiyDb({ app_settings: settingsRows() }, { failSelect: (t) => t === "keyword_footprints" || t === "tracking_serp" });
    const fp2 = await loadFootprint("c1", { db: () => broken.db, env: {} });
    assert.deepEqual(fp2.pulls, { ok: false }, "a failed read is a section that says so, never an empty footprint");
    const serp = await loadSerpDetail("c1", { from: "2026-10-01", to: "2026-10-14" }, [], { db: () => broken.db, env: {} });
    assert.deepEqual(serp, { urls: { ok: false }, tops: { ok: false } });
  } finally {
    console.warn = warn;
  }
  const off = await loadFootprint("c1", { db: () => fakeDiyDb({ app_settings: settingsRows({ diy_enabled: false }) }).db, env: {} });
  assert.deepEqual(off, { enabled: false, pulls: null, dismissals: null, job: null, aliases: [] }, "dark: not read at all");
});

// 13 Oct 2026 (review of the P6 handoff): "First read <date>" only for a footprint job that is actually queued.
// P1's dispatcher queues no paid job for a client whose setup it does not count as confirmed, so a page that fell
// back to "tomorrow" promised a read every day that never came.
test("the first read is promised only from a queued footprint job: its due day, or the next night for one due today or carried", async () => {
  const today = "2026-10-14";
  assert.equal(firstReadOn(null, today), null, "no job row: nothing is promised");
  assert.equal(firstReadOn({ dueOn: "2026-10-14", queued: false, failed: false }, today), null, "done: nothing is promised");
  assert.equal(firstReadOn({ dueOn: "2026-10-20", queued: true, failed: false }, today), "2026-10-20");
  assert.equal(firstReadOn({ dueOn: "2026-10-14", queued: true, failed: false }, today), "2026-10-15");
  assert.equal(firstReadOn({ dueOn: "2026-10-11", queued: true, failed: true }, today), "2026-10-15", "a failed attempt still under its attempts retries");
  const f = fakeDiyDb({
    diy_jobs: [
      { client_domain_id: "c1", kind: "footprint", due_on: "2026-10-14", outcome: "failed", done_at: null, attempts: 1 },
      { client_domain_id: "c2", kind: "footprint", due_on: "2026-10-14", outcome: "failed", done_at: null, attempts: 3 },
      { client_domain_id: "c3", kind: "footprint", due_on: "2026-10-07", outcome: "ok", done_at: "2026-10-07T03:40:00Z", attempts: 1 },
      { client_domain_id: "c4", kind: "key_pages_weekly", due_on: "2026-10-14", outcome: null, done_at: null, attempts: 0 },
    ],
  });
  assert.deepEqual(await readJob(f.db, "c1"), { dueOn: "2026-10-14", queued: true, failed: true });
  assert.deepEqual(await readJob(f.db, "c2"), { dueOn: "2026-10-14", queued: false, failed: true }, "out of attempts: not queued");
  assert.deepEqual(await readJob(f.db, "c3"), { dueOn: "2026-10-07", queued: false, failed: false });
  assert.deepEqual(await readJob(f.db, "c4"), { dueOn: null, queued: false, failed: false }, "another kind's row is not the footprint's");
});

// 13 Oct 2026 (Danny): the cluster slots link "See who ranks" only for a keyword whose page 1 the Google page has
// stored to show - a top 20 on a reading within TOP_LOOKBACK_DAYS of the range's end, one client's rows only.
test("who ranks: the keywords with a stored top in the window, this client's only; a failed read links none", async () => {
  const f = fakeDiyDb({
    tracking_serp: [
      { id: 1, client_domain_id: "c1", keyword_id: "k1", run_date: "2026-10-12", top: [{ rank: 1, domain: "a.example", url: "https://a.example/" }] },
      { id: 2, client_domain_id: "c1", keyword_id: "k2", run_date: "2026-10-12", top: null },
      { id: 3, client_domain_id: "c1", keyword_id: "k3", run_date: "2026-09-01", top: [{ rank: 1, domain: "b.example", url: "https://b.example/" }] },
      { id: 4, client_domain_id: "c2", keyword_id: "k4", run_date: "2026-10-12", top: [{ rank: 1, domain: "c.example", url: "https://c.example/" }] },
    ],
  });
  assert.deepEqual([...(await loadWhoRanks("c1", "2026-10-13", [], { db: () => f.db, env: {} }))], ["k1"], "no top, too old, or another client's: none");
  const warn = console.warn;
  console.warn = () => {};
  try {
    const broken = fakeDiyDb({}, { failSelect: (t) => t === "tracking_serp" });
    assert.equal((await loadWhoRanks("c1", "2026-10-13", [], { db: () => broken.db, env: {} })).size, 0);
  } finally {
    console.warn = warn;
  }
  const fixture = await loadWhoRanks(FIXTURE_CLIENT, fx.today, fx.data.serp, { env: env(), root: ROOT });
  assert.ok(fixture.has("k1"), "the fixture's stored tops");
  assert.deepEqual([...fixture].sort(), [...fixtureTops(keywordsFixture(env(), ROOT), fx.data.serp, fx.today).keys()].sort());
  assert.equal((await loadWhoRanks("someone-else", fx.today, fx.data.serp, { env: env(), root: ROOT })).size, 0);
});

// 13 Oct 2026 (dashboard speed work): the top 20s are read for each keyword's newest day only - a narrow read of the
// days, then the tops on them - and the answer is the one the 14-day read of every top gave.
test("tops: each keyword's newest stored top 20, read on its newest day only, as the whole window's read had it", async () => {
  const top = (d: string) => [{ rank: 1, domain: `${d}.example`, url: `https://${d}.example/` }];
  const serp = [
    { id: 1, client_domain_id: "c1", keyword_id: "k1", run_date: "2026-10-12", top: top("k1-12") },
    { id: 2, client_domain_id: "c1", keyword_id: "k1", run_date: "2026-10-13", top: top("k1-13") },
    { id: 3, client_domain_id: "c1", keyword_id: "k2", run_date: "2026-10-11", top: top("k2-11") },
    { id: 4, client_domain_id: "c1", keyword_id: "k2", run_date: "2026-10-13", top: null },
    { id: 5, client_domain_id: "c1", keyword_id: "k3", run_date: "2026-09-01", top: top("k3-old") },
    { id: 6, client_domain_id: "c2", keyword_id: "k4", run_date: "2026-10-13", top: top("k4") },
  ];
  const f = fakeDiyDb({ tracking_serp: serp.map((r) => ({ ...r })) });
  const got = await loadSerpDetail("c1", { from: "2026-10-01", to: "2026-10-13" }, [], { db: () => f.db, env: {} });
  assert.ok(got.tops.ok);
  const whole = latestTops(serp.filter((r) => r.client_domain_id === "c1" && r.run_date >= "2026-09-29" && r.run_date <= "2026-10-13"));
  assert.deepEqual([...got.tops.value].sort(), [...whole].sort(), "the same newest top per keyword as reading every day's");
  assert.deepEqual(got.tops.value.get("k2")?.day, "2026-10-11", "a day with no top is passed over for the newest that has one");
  assert.equal(got.tops.value.has("k3"), false, "older than the lookback: none");
  // The second read carried the newest days' rows only, never the window's every top.
  const topReads = f.calls.filter((c) => c.table === "tracking_serp" && c.op === "select");
  assert.ok(topReads.at(-1)!.rows <= 2, `the tops read took ${topReads.at(-1)!.rows} rows`);
});

// 13 Oct 2026 (dashboard speed work): pages hand the overview's positions as a function, so production never waits on
// the overview for them; the fixture still reads them, and a function and a list answer alike.
test("positions handed as a function are read on the fixture only, and answer as the list does", async () => {
  let asked = 0;
  const later = () => {
    asked += 1;
    return Promise.resolve(fx.data.serp);
  };
  const f = fakeDiyDb({ tracking_serp: [] });
  await loadWhoRanks("c1", "2026-10-13", later, { db: () => f.db, env: {} });
  await loadSerpDetail("c1", { from: "2026-10-01", to: "2026-10-13" }, later, { db: () => f.db, env: {} });
  assert.equal(asked, 0, "Supabase reads its own: the overview is never waited on");
  const listed = await loadWhoRanks(FIXTURE_CLIENT, fx.today, fx.data.serp, { env: env(), root: ROOT });
  const handed = await loadWhoRanks(FIXTURE_CLIENT, fx.today, later, { env: env(), root: ROOT });
  assert.deepEqual([...handed].sort(), [...listed].sort());
  const detail = await loadSerpDetail(FIXTURE_CLIENT, { from: "2026-09-01", to: fx.today }, later, { env: env(), root: ROOT });
  const detailListed = await loadSerpDetail(FIXTURE_CLIENT, { from: "2026-09-01", to: fx.today }, fx.data.serp, { env: env(), root: ROOT });
  assert.deepEqual(detail, detailListed);
  assert.equal(asked, 2, "the fixture reads them, once a call");
});
