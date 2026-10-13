import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays } from "../../tracking/figures.ts";
import { refuseHandlers } from "../core/jobs.ts";
import type { ReadCtx } from "../core/jobs.ts";

import { opportunityCandidatesFrom } from "./candidates.ts";
import { CHUNK, CHUNKS_PER_NIGHT, chunks, classifyAll, classifyHandler, kindsFromAnswer } from "./classify.job.ts";
import { classifyUser } from "./classify-prompt.ts";
import type { Unclassified } from "./derive.ts";
import type { OppIO } from "./io.ts";
import { pageReadsHandler, pickFallbacks, pickReads } from "./page-reads.job.ts";
import { opportunityRefreshHandler, planRefresh } from "./refresh.job.ts";
import { opportunityOf } from "./status.ts";
import type { Opportunity, PageFacts } from "./types.ts";
import { dueForWatch, watchHandler } from "./watch.job.ts";

/**
 * The night jobs' rules (13 Oct 2026, DIY P7; spec 10 sections 5.3, 5.7 and
 * 6.1): watch's cadence - pursuing and pitched weekly, won monthly for 6
 * months and only the 30 most recent, link_domain never; classification in
 * chunks never above 50, a max_tokens stop counted as failed items in the
 * note; page reads in list order, never more than 40 a night; the refresh
 * plan; and the Plan candidates. Illustrative: every site here is made up.
 */

const TODAY = "2026-11-14";
const opp = (over: Record<string, unknown>): Opportunity =>
  opportunityOf({ id: "o", client_domain_id: "c1", lens: "cited", url: "https://lists.example/best", url_key: "lists.example/best", domain: "lists.example", route: "ask_added", status: "new", evidence: { to: TODAY }, live: true, ...over })!;

test("the handlers: kinds, paid or free, cadence; a well-formed set for the shell's wiring", () => {
  const hs = [opportunityRefreshHandler(), pageReadsHandler(), classifyHandler(), watchHandler()];
  assert.deepEqual(hs.map((h) => [h.kind, h.paid, h.cadence]), [
    ["opportunity_refresh", false, "daily"],
    ["page_reads", true, "daily"],
    ["classify", true, "daily"],
    ["watch", false, "daily"],
  ]);
  assert.deepEqual(refuseHandlers(hs), []);
});

test("watch: pursuing and pitched weekly; won monthly for 6 months, the 30 most recent; never link_domain or own", () => {
  const rows = [
    opp({ id: "p-due", status: "pursuing", verified: { at: addDays(TODAY, -7), text: "x" } }),
    opp({ id: "p-fresh", status: "pursuing", verified: { at: addDays(TODAY, -3), text: "x" } }),
    opp({ id: "p-never", status: "pitched" }),
    opp({ id: "domain", status: "pursuing", lens: "link_domain", url: "https://linkhub.example/" }),
    opp({ id: "own", status: "pursuing", lens: "own", route: "refresh_own" }),
    opp({ id: "w-due", status: "won", status_at: `${addDays(TODAY, -40)}T09:00:00Z`, verified: { at: addDays(TODAY, -30), text: "x" } }),
    opp({ id: "w-fresh", status: "won", status_at: `${addDays(TODAY, -40)}T09:00:00Z`, verified: { at: addDays(TODAY, -10), text: "x" } }),
    opp({ id: "w-old", status: "won", status_at: `${addDays(TODAY, -200)}T09:00:00Z` }),
    opp({ id: "new", status: "new" }),
  ];
  assert.deepEqual(dueForWatch(rows, TODAY).map((o) => o.id).sort(), ["p-due", "p-never", "w-due"]);
  const won = Array.from({ length: 35 }, (_, i) => opp({ id: `w${i}`, status: "won", status_at: `${addDays(TODAY, -i - 1)}T09:00:00Z` }));
  const due = dueForWatch(won, TODAY);
  assert.equal(due.length, 30, "only the 30 most recently won");
  assert.ok(!due.some((o) => ["w30", "w31", "w32", "w33", "w34"].includes(o.id)));
});

const unclassified = (n: number): Unclassified[] => Array.from({ length: n }, (_, i) => ({ urlKey: `site${i}.example/best`, url: `https://site${i}.example/best`, domain: `site${i}.example`, title: `Best tools ${i}`, h1: null, headings: [], needs: ["domain", "page"] }));
const fakeCtx = {} as ReadCtx;

test("classification: chunks of at most 50, at most four calls a night", async () => {
  assert.deepEqual(chunks(unclassified(120)).map((c) => c.length), [50, 50, 20]);
  assert.throws(() => chunks([], 51), /1-50/);
  const sizes: number[] = [];
  const io: Pick<OppIO, "classify"> = {
    async classify(_ctx, input) {
      sizes.push(input.items);
      assert.ok(input.items <= CHUNK);
      return { kind: "read", value: { items: [] }, cost: 0.05, partial: false, readId: "r" };
    },
  };
  const r = await classifyAll(io, fakeCtx, unclassified(260), async () => 0);
  assert.deepEqual(sizes, [50, 50, 50, 50]);
  assert.equal(CHUNKS_PER_NIGHT, 4);
  assert.match(r.note!, /60 wait for tomorrow/);
});

test("classification: a max_tokens stop counts its whole chunk as failed in the note and writes nothing for it", async () => {
  let call = 0;
  const written: Record<string, unknown>[][] = [];
  const io: Pick<OppIO, "classify"> = {
    async classify(_ctx, input) {
      call++;
      if (call === 1) return { kind: "failed", reason: "max_tokens", cost: 0.35, readId: "r1" };
      const keys = input.user.split("\n").slice(1).map((l) => JSON.parse(l).key as string);
      return { kind: "read", value: { items: keys.map((key) => ({ key, domain_type: "publisher", page_type: "best_of" })) }, cost: 0.09, partial: false, readId: "r2" };
    },
  };
  const r = await classifyAll(io, fakeCtx, unclassified(70), async (rows) => (written.push(rows), rows.length));
  assert.equal(r.outcome, "ok");
  assert.match(r.note!, /typed 20 of 70 pages/);
  assert.match(r.note!, /50 failed \(max_tokens\)/);
  assert.equal(written.length, 1);
  const allFail = await classifyAll({ classify: async () => ({ kind: "failed", reason: "refusal", cost: 0, readId: "r" }) }, fakeCtx, unclassified(3), async () => 0);
  assert.equal(allFail.outcome, "failed");
  const capped = await classifyAll({ classify: async () => ({ kind: "refused", refusal: { code: "door_daily", reason: "x" } }) }, fakeCtx, unclassified(3), async () => 0);
  assert.equal(capped.outcome, "deferred");
});

test("classification: an answer types only its own chunk's keys, only what each needed, only enum values", () => {
  const chunk = unclassified(2);
  chunk[1]!.needs = ["page"];
  const got = kindsFromAnswer(chunk, { items: [{ key: "site0.example/best", domain_type: "publisher", page_type: "best_of" }, { key: "site1.example/best", domain_type: "vendor", page_type: "comparison" }, { key: "elsewhere.example/x", domain_type: "vendor", page_type: null }] }, "2026-11-14T03:30:00Z");
  assert.deepEqual(got.rows.map((r) => [r.key, r.domain_type, r.page_type, r.set_by]), [
    ["d:site0.example", "publisher", null, "model"],
    ["p:site0.example/best", null, "best_of", "model"],
    ["p:site1.example/best", null, "comparison", "model"],
  ]);
  const user = classifyUser(chunk);
  assert.ok(!/body|text of the page/i.test(user), "the message carries what we keep and no more");
  assert.equal(user.split("\n").length, 3);
});

const fact = (urlKey: string, readAt: string): PageFacts => ({ urlKey, url: `https://${urlKey}`, readAt, via: "own", status: "ok", http: 200, title: null, h1: null, updatedOn: null, headings: [], namesClient: false, snippet: null, brandsFound: [], linksToClient: null, linkRel: null, linkAnchor: null });

test("page reads: listed and new, never read first, then read 14 days ago, in list order, at most 40", () => {
  const rows = [
    opp({ id: "a", url_key: "a.example/x", url: "https://a.example/x", evidence: { to: TODAY, leaves_out: 9 } }),
    opp({ id: "b", url_key: "b.example/x", url: "https://b.example/x", evidence: { to: TODAY, leaves_out: 30 } }),
    opp({ id: "c", url_key: "c.example/x", url: "https://c.example/x", evidence: { to: TODAY, leaves_out: 50 } }),
    opp({ id: "d", url_key: "d.example/x", url: "https://d.example/x", evidence: { to: TODAY, leaves_out: 99 } }),
    opp({ id: "own", lens: "own", url_key: "own:c1:best_of", route: "publish_own" }),
    opp({ id: "won", status: "won", url_key: "e.example/x", url: "https://e.example/x" }),
    opp({ id: "gone", live: false, url_key: "f.example/x", url: "https://f.example/x" }),
  ];
  const reads = new Map([
    ["c.example/x", fact("c.example/x", `${addDays(TODAY, -20)}T03:40:00Z`)],
    ["d.example/x", fact("d.example/x", `${addDays(TODAY, -3)}T03:40:00Z`)],
  ]);
  assert.deepEqual(pickReads(rows, reads, TODAY).map((o) => o.id), ["b", "a", "c"]);
  const many = Array.from({ length: 60 }, (_, i) => opp({ id: `m${i}`, url_key: `m${i}.example/x`, url: `https://m${i}.example/x` }));
  assert.equal(pickReads(many, new Map(), TODAY).length, 40);
  assert.deepEqual(pickFallbacks([opp({ id: "w", status: "pursuing", verified: { at: TODAY, text: "x", fallback: true } }), opp({ id: "n", status: "new", verified: { at: TODAY, text: "x", fallback: true } }), opp({ id: "d", status: "won", lens: "link_domain", verified: { at: TODAY, text: "x", fallback: true } })]).map((o) => o.id), ["w"]);
});

test("the refresh plan: new rows inserted, rows still derived updated, new rows no longer derived set not live, moved rows keep their status", () => {
  const derived = { lens: "cited" as const, url: "https://a.example/x", urlKey: "a.example/x", domain: "a.example", clusterId: "k1", route: "ask_added" as const, pageType: "best_of" as const, domainType: "publisher" as const, title: "A", evidence: { to: TODAY, answers: 4, leaves_out: 4, others_named: 4, prompts: ["q1"], prompt_count: 1, engines: ["chatgpt"], competitors: [], days_14: 2, days_7: 2, last_cited: TODAY, rank: null, keyword: null, open: null }, orderKey: [4, 1, 1, 0, 1, "0000-00-00"] as [number, number, number, number, number, string] };
  const result = { rows: [derived, { ...derived, url: "https://b.example/x", urlKey: "b.example/x" }, { ...derived, url: "https://p.example/x", urlKey: "p.example/x" }], ruleKinds: [], unclassified: [], competitors: new Map() };
  const existing = [
    opp({ id: "b", url_key: "b.example/x", status: "new", first_seen: "2026-11-01" }),
    opp({ id: "p", url_key: "p.example/x", status: "pursuing", route: "offer_resource", cluster_id: "k9", pursued_on: addDays(TODAY, -5) }),
    opp({ id: "z", url_key: "z.example/x", status: "new" }),
    opp({ id: "zp", url_key: "zp.example/x", status: "won" }),
    opp({ id: "logged", lens: "logged", url_key: "l.example/x", status: "new" }),
  ];
  const answers = [{ run_date: addDays(TODAY, -2), question_id: "q1", engine: "perplexity", answered: true, named: false, brands: [], citations: [{ source_domain: "p.example", url: "https://p.example/x" }] }];
  const plan = planRefresh({ clientId: "c1", today: TODAY, now: `${TODAY}T03:30:00Z`, result, existing, answers, kinds: new Map() });
  assert.deepEqual(plan.inserts.map((r) => [r.url_key, r.status, r.first_seen]), [["a.example/x", "new", TODAY]]);
  const by = new Map(plan.updates.map((u) => [u.id, u.patch]));
  assert.equal(by.get("b")!.live, true);
  assert.deepEqual((by.get("b")!.order_key as unknown[])[5], "2026-11-01");
  assert.equal(by.get("p")!.route, undefined, "a moved row keeps its route and cluster");
  assert.deepEqual(by.get("p")!.first_cited, { perplexity: { day: addDays(TODAY, -2), prompt: "q1" } });
  assert.deepEqual(by.get("z"), { live: false, updated_at: `${TODAY}T03:30:00Z` });
  assert.equal(by.has("zp"), false, "a won row the night no longer derives is left as it is");
  assert.equal(by.has("logged"), false, "a logged row is never touched by the refresh");
});

test("Plan candidates: Biggest gap is the top cited row still new; Slipping when a link or mention is found removed this week", () => {
  const rows = [
    opp({ id: "low", evidence: { to: TODAY, leaves_out: 3, prompt_count: 1 } }),
    opp({ id: "top", url_key: "t.example/x", evidence: { to: TODAY, leaves_out: 30, prompt_count: 2, answers: 30, keyword: "invoicing software" } }),
    opp({ id: "thread", lens: "threads", route: "answer_thread", evidence: { to: TODAY, leaves_out: 99 } }),
    opp({ id: "pursued", status: "pursuing", evidence: { to: TODAY, leaves_out: 99 } }),
    opp({ id: "lost", status: "won", verified: { at: addDays(TODAY, -2), text: "Checked", ok: true, removed: "link" } }),
    opp({ id: "old-loss", status: "won", verified: { at: addDays(TODAY, -20), text: "Checked", ok: true, removed: "link" } }),
  ];
  const c = opportunityCandidatesFrom(rows, TODAY);
  assert.deepEqual(c.map((x) => [x.dedupeKey, x.severity, x.kind]), [
    ["opp:top", "gap", "get_onto_page"],
    [`opp-removed:lost:${addDays(TODAY, -2)}`, "slipping", "reclaim_link"],
  ]);
  assert.equal(c[1]!.title, "Ask lists.example to restore your link");
  assert.equal(opportunityCandidatesFrom([], TODAY).length, 0);
});
