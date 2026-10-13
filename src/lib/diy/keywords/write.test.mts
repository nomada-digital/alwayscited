import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { fakeDiyDb, settingsRows, testClient } from "../core/fake-diy.mts";
import { clientPath } from "../plan/types.ts";

import { keywordCandidates, keywordCandidatesFrom, MAX_KEYWORD_CANDIDATES } from "./candidates.ts";
import { DISMISS_DAYS, liveDismissal } from "./data.ts";
import { momentum } from "./momentum.ts";
import { applyToFixture, decideKeywords, keywordsToast, lapseDismissal, readDone, readOnlyReason, readWhy, writeDismissal } from "./write.ts";

/**
 * Gaining ground's Dismiss and Restore, and the Plan's keyword candidates
 * (13 Oct 2026, DIY P6; spec 10 sections 3.6, 4.3 and 6.1).
 */

const today = "2026-10-14";
const latest = new Set(["payroll software for sole traders", "invoice app for contractors"]);
const base = { do: "dismiss" as const, keyword: "Payroll Software For Sole Traders", refused: null, enabled: true, latest, dismissals: [], today };

test("dismiss: only a keyword the latest pull holds, stored as the pull has it, for 90 days", () => {
  assert.deepEqual(decideKeywords(base), { op: "dismiss", key: "payroll software for sole traders", until: "2027-01-12" });
  assert.equal(DISMISS_DAYS, 90);
  assert.deepEqual(decideKeywords({ ...base, keyword: "anything a member typed" }), { op: "refuse", why: "unknown" });
  assert.deepEqual(decideKeywords({ ...base, keyword: "x".repeat(121) }), { op: "refuse", why: "unknown" });
  assert.deepEqual(decideKeywords({ ...base, keyword: 42 }), { op: "refuse", why: "unknown" });
  assert.deepEqual(decideKeywords({ ...base, latest: null }), { op: "refuse", why: "failed" }, "an unread footprint is a failure, never a pass");
});

test("refused first: a viewer or an ended client, each with its own reason, then the switch off", () => {
  assert.deepEqual(decideKeywords({ ...base, refused: "Only owners and editors can change what is tracked." }), { op: "refuse", why: "viewer" });
  // 13 Oct 2026 (review of the P6 handoff): an owner on an ended client is refused by writeRole too, and told why.
  assert.deepEqual(decideKeywords({ ...base, refused: "Only owners and editors can change what is tracked.", ended: true }), { op: "refuse", why: "ended" });
  assert.equal(keywordsToast("refused", "ended", null), "Tracking has ended for this client, so its actions are read-only.");
  assert.equal(readWhy("ended"), "ended");
  assert.equal(readOnlyReason({ status: "ended" }), "Tracking has ended for this client, so its actions are read-only.");
  assert.equal(readOnlyReason({ status: "active" }), "Viewers can't change this. Ask an owner or editor.");
  assert.deepEqual(decideKeywords({ ...base, enabled: false }), { op: "refuse", why: "dark" });
});

test("restore: only a live dismissal; it lapses yesterday and the row stays", () => {
  const dismissals = [
    { key: "expense app for consultants", until: "2026-12-20", by: "owner@example.com", at: "2026-09-21T09:12:00Z" },
    { key: "estimate template for contractors", until: "2026-09-01", by: "owner@example.com", at: "2026-06-03T10:40:00Z" },
  ];
  assert.deepEqual(decideKeywords({ ...base, do: "restore", keyword: "Expense App For Consultants", dismissals }), { op: "restore", key: "expense app for consultants", until: "2026-10-13" });
  assert.deepEqual(decideKeywords({ ...base, do: "restore", keyword: "estimate template for contractors", dismissals }), { op: "refuse", why: "unknown" }, "a lapsed one has nothing to restore");
  assert.ok(liveDismissal(dismissals[0]!, today) && !liveDismissal(dismissals[1]!, today));
  const rows = applyToFixture(dismissals, { op: "restore", key: "expense app for consultants", until: "2026-10-13" }, { by: "x", now: "t" });
  assert.equal(rows.length, 2, "nothing is deleted");
  assert.equal(rows.find((r) => r.key === "expense app for consultants")!.until, "2026-10-13");
  const again = applyToFixture(rows, { op: "dismiss", key: "expense app for consultants", until: "2027-01-12" }, { by: "editor@example.com", now: "2026-10-14T12:00:00Z" });
  assert.deepEqual(again[0], { key: "expense app for consultants", until: "2027-01-12", by: "editor@example.com", at: "2026-10-14T12:00:00Z" }, "newest first: the one a toast's Undo restores");
});

test("the writes: an upsert on the primary key, and a restore that updates one client's row by its key", async () => {
  const f = fakeDiyDb({ diy_dismissals: [] });
  await writeDismissal(f.db, { clientId: "c1", key: "k", until: "2027-01-12", by: "o@example.com", now: "2026-10-14T12:00:00Z" });
  await writeDismissal(f.db, { clientId: "c1", key: "k", until: "2027-01-13", by: "o@example.com", now: "2026-10-15T12:00:00Z" });
  assert.equal(f.tables.diy_dismissals!.length, 1);
  assert.equal(f.tables.diy_dismissals![0]!.until, "2027-01-13");
  f.tables.diy_dismissals!.push({ client_domain_id: "c2", kind: "gaining_keyword", key: "k", until: "2027-01-12", by_email: "x", created_at: "t" });
  await lapseDismissal(f.db, { clientId: "c1", key: "k", until: "2026-10-13" });
  assert.deepEqual(f.tables.diy_dismissals!.map((r) => r.until), ["2026-10-13", "2027-01-12"], "the other client's row is untouched");
  const route = readFileSync(new URL("../../../app/api/app/[client]/keywords/route.ts", import.meta.url), "utf8");
  assert.match(route, /export const maxDuration = 60;/);
  assert.doesNotMatch(route, /\.delete\(/, "a restore never deletes");
});

test("the toast: fixed words from codes; the dismissed keyword and its end come from the stored row, never the URL", () => {
  assert.equal(readDone("dismissed"), "dismissed");
  assert.equal(readDone("<b>"), null);
  assert.equal(readWhy("viewer"), "viewer");
  assert.equal(readWhy("anything"), null);
  assert.equal(keywordsToast("dismissed", null, { key: "invoice app for contractors", until: "2027-01-12", by: "x", at: "t" }), "'invoice app for contractors' is dismissed. It stays out of gaining ground until 12 Jan 2027.");
  assert.equal(keywordsToast("refused", "viewer", null), "Viewers can't change this. Ask an owner or editor.");
  assert.equal(keywordsToast("refused", null, null), "That didn't save. Try again.");
  assert.equal(keywordsToast(null, "viewer", null), null);
});

// ---- the Plan's keyword candidates ----

const row = (k: string, p: number, v = 500) => ({ k, p, u: "/x", v, i: "commercial" as const, e: 1 });
const pull = (pulledOn: string, rows: ReturnType<typeof row>[]) => ({ pulledOn, labsDate: pulledOn, total: rows.length, etv: 1, rows });

test("candidates: Tidy-up, one per free cluster slot, at most 3, from the top of the momentum order; none with no free slot", () => {
  const m = momentum({ latest: pull("2026-10-14", [row("one", 5, 900), row("two", 6, 800), row("three", 7, 700), row("four", 8, 600)]), previous: pull("2026-10-07", []), tracked: [], dismissed: new Set(), subject: { brand: "Tallyroo", domain: "tallyroo.com" }, showAll: false, today });
  assert.equal(m.previousComplete, true, "an empty pull Labs totalled at 0 is complete: absence there is new");
  assert.deepEqual(keywordCandidatesFrom(m, 0), []);
  assert.deepEqual(keywordCandidatesFrom(m, 2).map((c) => c.title), ["Track 'one' as a cluster", "Track 'two' as a cluster"]);
  const all = keywordCandidatesFrom(m, 9);
  assert.equal(all.length, MAX_KEYWORD_CANDIDATES);
  const c = all[0]!;
  assert.deepEqual([c.kind, c.severity, c.grade, c.effort, c.clusterId, c.dedupeKey, c.volume, c.evidenceOn], ["track_keyword", "tidy", "practice", "minutes", null, "kw-gaining:one", 900, "2026-10-14"]);
  assert.equal(c.href, "/clusters?add=1&kw=one&src=gaining");
  assert.equal(clientPath(c.href), c.href, "a client path the Plan stores");
  assert.equal(c.why[0]!.text, "New at 5th on Google, 900 searches a month (DataForSEO estimate, read 14 Oct 2026).");
  assert.equal(c.why[1]!.text, "9 of your cluster slots are free.");
  for (const w of c.why) assert.equal(clientPath(w.href), w.href);
  assert.ok(c.title.length <= 200);
});

test("gather: the stored pulls, the client's slots, its tracked keywords and live dismissals, read one client at a time", async () => {
  const f = fakeDiyDb({
    app_settings: settingsRows(),
    client_domains: [{ id: "c-tallyroo", brand_aliases: ["Tally Roo"], cluster_limit: 3 }],
    tracked_clusters: [{ id: "cl1", client_domain_id: "c-tallyroo", stopped_on: null }, { id: "cl2", client_domain_id: "c-tallyroo", stopped_on: "2026-09-01" }, { id: "x", client_domain_id: "other", stopped_on: null }],
    tracked_keywords: [{ keyword: "two", client_domain_id: "c-tallyroo", stopped_on: null }],
    diy_dismissals: [{ client_domain_id: "c-tallyroo", kind: "gaining_keyword", key: "three", until: "2026-12-01", by_email: "o", created_at: "2026-10-01T00:00:00Z" }],
    keyword_footprints: [
      { client_domain_id: "c-tallyroo", pulled_on: "2026-10-14", labs_date: "2026-10-12", total_count: 4, etv: 1, rows: [row("one", 5), row("two", 6), row("three", 7), row("tally roo app", 3), row("four", 8, 100)] },
      { client_domain_id: "c-tallyroo", pulled_on: "2026-10-07", labs_date: "2026-10-05", total_count: 0, etv: 1, rows: [] },
      { client_domain_id: "other", pulled_on: "2026-10-15", labs_date: "2026-10-12", total_count: 1, etv: 1, rows: [row("not mine", 2)] },
    ],
  });
  const got = await keywordCandidates.gather(f.db, testClient(), today);
  assert.deepEqual(got.map((c) => c.dedupeKey), ["kw-gaining:one", "kw-gaining:four"], "2 slots free; tracked, dismissed and branded left out");
  assert.equal(keywordCandidates.name, "keywords");
  const none = await keywordCandidates.gather(fakeDiyDb({ app_settings: settingsRows(), client_domains: [{ id: "c-tallyroo", cluster_limit: 3 }], tracked_clusters: [], tracked_keywords: [], diy_dismissals: [], keyword_footprints: [] }).db, testClient(), today);
  assert.deepEqual(none, [], "no pull yet: nothing");
  // 13 Oct 2026 (review of the P6 handoff): dark, as the pages are. plan_refresh runs while the switch is off, and a
  // stored pull must not keep offering "Track 'x'" with a why-link to a gaining ground the Google page hides.
  f.tables.app_settings = settingsRows({ diy_enabled: false });
  assert.deepEqual(await keywordCandidates.gather(f.db, testClient(), today), [], "switched off: nothing, whatever is stored");
  f.tables.app_settings = [];
  assert.deepEqual(await keywordCandidates.gather(f.db, testClient(), today), [], "an unread switch fails closed");
});

// ---- ready for the wave 2 shell (P9 registers both; this package does not edit wiring.ts) ----

test("the footprint handler and the keyword candidates fit beside what wiring.ts registers today", async () => {
  const { CANDIDATE_SOURCES, JOB_HANDLERS } = await import("../wiring.ts");
  const { refuseHandlers } = await import("../core/jobs.ts");
  const { footprintHandler } = await import("./footprint.job.ts");
  assert.deepEqual(refuseHandlers([...JOB_HANDLERS, footprintHandler()]), []);
  assert.ok(!CANDIDATE_SOURCES.some((s) => s.name === keywordCandidates.name), "a candidate source name is unique");
});
