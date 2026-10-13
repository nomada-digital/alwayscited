import assert from "node:assert/strict";
import { test } from "node:test";

import { keyPage } from "./fake-pages.mts";
import { KEY_PAGES_MAX, isOwnUrl, memberAdd, ownCited, pickKeyPages } from "./key-pages.ts";

/**
 * Key-page selection and a member's overrides (13 Oct 2026, DIY P8; spec 10
 * sections 4.9 and 6.4): the order (homepage, ranking URLs, cited pages,
 * relevant pages) up to 10; a member's page never removed by the job; a page
 * a member removed never added back; an 11th page replacing the oldest
 * automatic one; a foreign domain refused.
 */

const D = "tallyroo.com";

test("the automatic order: the homepage, each cluster's ranking URL once, the cited pages, then the relevant ones, up to 10", () => {
  const candidates = [
    { url: "https://tallyroo.com/", origin: "homepage" as const, clusterIds: [] },
    { url: "https://tallyroo.com/cloud", origin: "ranking" as const, clusterIds: ["c8"] },
    { url: "https://www.tallyroo.com/cloud/", origin: "ranking" as const, clusterIds: ["c9"] },
    { url: "https://tallyroo.com/freelancers", origin: "cited_own" as const, clusterIds: [] },
    ...Array.from({ length: 12 }, (_, i) => ({ url: `https://tallyroo.com/p${i}`, origin: "relevant" as const, clusterIds: [] })),
  ];
  const pick = pickKeyPages({ rows: [], candidates, domain: D });
  assert.equal(pick.add.length, KEY_PAGES_MAX);
  assert.deepEqual(pick.add.slice(0, 3).map((a) => [a.urlKey, a.origin, a.clusterIds]), [
    ["tallyroo.com", "homepage", []],
    ["tallyroo.com/cloud", "ranking", ["c8", "c9"]],
    ["tallyroo.com/freelancers", "cited_own", []],
  ]);
  assert.equal(pick.add[9]!.urlKey, "tallyroo.com/p6");
});

test("a page on another domain is never picked, and a page a member removed is never picked again", () => {
  const rows = [keyPage({ id: "kp-1", url: "https://tallyroo.com/", origin: "homepage" }), keyPage({ id: "kp-2", url: "https://tallyroo.com/old", origin: "cited_own", removedOn: "2026-09-15", removedBy: "owner@example.com" })];
  const pick = pickKeyPages({ rows, candidates: [{ url: "https://ledgerline.com/cloud", origin: "ranking", clusterIds: ["c8"] }, { url: "https://tallyroo.com/old", origin: "cited_own", clusterIds: [] }, { url: "https://tallyroo.com/new", origin: "cited_own", clusterIds: [] }], domain: D });
  assert.deepEqual(pick.add.map((a) => a.urlKey), ["tallyroo.com/new"]);
});

test("a live page's clusters follow the ranking URLs, and a member's page is kept and never removed", () => {
  const rows = [keyPage({ id: "kp-1", url: "https://tallyroo.com/mine", origin: "member", clusterIds: [] }), keyPage({ id: "kp-2", url: "https://tallyroo.com/cloud", clusterIds: ["c1"] })];
  const pick = pickKeyPages({ rows, candidates: [{ url: "https://tallyroo.com/mine", origin: "ranking", clusterIds: ["c3"] }, { url: "https://tallyroo.com/cloud", origin: "ranking", clusterIds: ["c8"] }], domain: D });
  assert.deepEqual(pick.add, []);
  assert.deepEqual(pick.clusters, [
    { id: "kp-1", clusterIds: ["c3"] },
    { id: "kp-2", clusterIds: ["c8"] },
  ]);
});

test("a member's page: own domain only, not twice, and at 10 it replaces the oldest automatic page - never the homepage or a member's", () => {
  assert.deepEqual(memberAdd([], "https://ledgerline.com/x", D), { ok: false, why: "not_own" });
  assert.deepEqual(memberAdd([], "not a url", D), { ok: false, why: "bad_url" });
  assert.deepEqual(memberAdd([keyPage({ id: "kp-1", url: "https://tallyroo.com/x" })], "https://tallyroo.com/x/", D), { ok: false, why: "already" });
  const ten = [
    keyPage({ id: "kp-0", url: "https://tallyroo.com/", origin: "homepage", addedOn: "2026-01-01" }),
    keyPage({ id: "kp-m", url: "https://tallyroo.com/m", origin: "member", addedOn: "2026-02-01" }),
    ...Array.from({ length: 8 }, (_, i) => keyPage({ id: `kp-${i + 1}`, url: `https://tallyroo.com/a${i}`, origin: "ranking", addedOn: `2026-03-0${i + 1}` })),
  ];
  const r = memberAdd(ten, "https://www.tallyroo.com/post", D);
  assert.ok(r.ok);
  assert.equal(r.ok && r.replace?.id, "kp-1", "the oldest automatic page");
  const full = Array.from({ length: 10 }, (_, i) => keyPage({ id: `m${i}`, url: `https://tallyroo.com/m${i}`, origin: "member" }));
  assert.deepEqual(memberAdd(full, "https://tallyroo.com/n", D), { ok: false, why: "full" });
  assert.equal(isOwnUrl("https://tallyroo.com.evil.example/", D), false);
  assert.equal(isOwnUrl("https://user:pw@tallyroo.com/", D), false);
});

test("the cited own pages: Cited pages' count, the client's host only, most cited first", () => {
  const rows = [
    { run_date: "2026-09-20", engine: "chatgpt", question_id: "q1", answered: true, citations: [{ source_domain: "tallyroo.com", url: "https://tallyroo.com/freelancers" }, { source_domain: "ledgerline.com", url: "https://ledgerline.com/x" }] },
    { run_date: "2026-09-21", engine: "gemini", question_id: "q1", answered: true, citations: [{ source_domain: "tallyroo.com", url: "https://tallyroo.com/freelancers/" }, { source_domain: "tallyroo.com", url: "https://tallyroo.com/cloud" }] },
  ];
  assert.deepEqual(ownCited(rows, { from: "2026-09-01", to: "2026-09-29" }, D).map((r) => [r.url, r.count]), [
    ["https://tallyroo.com/freelancers", 2],
    ["https://tallyroo.com/cloud", 1],
  ]);
});

test("a candidate longer than key_pages allows is left out and counted, never handed to the insert", () => {
  // 13 Oct 2026, DIY P8 review: one long ranking URL (faceted or tracking query strings) failed the whole weekly job every week.
  const long = `https://tallyroo.com/cloud?${"utm_source=x&".repeat(60)}`;
  const pick = pickKeyPages({ rows: [], candidates: [{ url: long, origin: "ranking", clusterIds: ["c8"] }, { url: "https://tallyroo.com/", origin: "homepage", clusterIds: [] }], domain: D });
  assert.deepEqual(pick.add.map((a) => a.urlKey), ["tallyroo.com"]);
  assert.equal(pick.tooLong, 1);
  assert.ok(long.length > 500);
});
