import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays } from "../../tracking/figures.ts";
import { refuseHandlers } from "../core/jobs.ts";
import type { ReadCtx } from "../core/jobs.ts";

import { opportunityCandidatesFrom } from "./candidates.ts";
import { CHUNK, CHUNKS_PER_NIGHT, chunks, classifyAll, classifyHandler, kindsFromAnswer } from "./classify.job.ts";
import { classifyUser } from "./classify-prompt.ts";
import { derive, type Unclassified } from "./derive.ts";
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
  const result = { rows: [derived, { ...derived, url: "https://b.example/x", urlKey: "b.example/x" }, { ...derived, url: "https://p.example/x", urlKey: "p.example/x" }], ruleKinds: [], unclassified: [], competitors: new Map(), tooLong: 0 };
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

test("the refresh plan across lenses: a page whose lens changes is never doubled (review of DIY P7, 13 Oct 2026)", () => {
  const base = { url: "https://pub.example/best-x", urlKey: "pub.example/best-x", domain: "pub.example", clusterId: "k1", route: "ask_added" as const, pageType: "best_of" as const, domainType: "publisher" as const, title: "Best X", evidence: { to: TODAY, answers: 6, leaves_out: 6, others_named: 6, prompts: ["q1"], prompt_count: 1, engines: ["chatgpt"], competitors: ["Rival"], days_14: 3, days_7: 1, last_cited: TODAY, rank: 4, keyword: "x", open: null }, orderKey: [6, 1, 1, 1, 1, "0000-00-00"] as [number, number, number, number, number, string] };
  const run = (derived: Record<string, unknown>[], existing: Opportunity[]) => {
    const plan = planRefresh({ clientId: "c1", today: TODAY, now: `${TODAY}T03:30:00Z`, result: { rows: derived as never, ruleKinds: [], unclassified: [], competitors: new Map(), tooLong: 0 }, existing, answers: [], kinds: new Map() });
    return { plan, by: new Map(plan.updates.map((u) => [u.id, u.patch])) };
  };
  const cited = { ...base, lens: "cited" as const };
  const page = { url: base.url, url_key: base.urlKey, domain: base.domain };

  // A Google list the member set aside starts being cited: no new cited row; the set-aside row takes the evidence and keeps its lens and status.
  for (const status of ["dismissed", "declined", "pursuing", "pitched", "won"]) {
    const { plan, by } = run([cited], [opp({ id: "kept", lens: "lists", status, ...page })]);
    assert.deepEqual(plan.inserts, [], `${status}: no second row`);
    const patch = by.get("kept")!;
    assert.deepEqual(patch.evidence, base.evidence, status);
    assert.equal(patch.lens, undefined, `${status}: it keeps its lens`);
    assert.equal(patch.status, undefined, `${status}: and its status`);
  }
  // A new cited row whose domain the model typed a night later (cited to threads) moves to its new lens and route.
  {
    const thread = { ...base, lens: "threads" as const, route: "answer_thread" as const, pageType: "thread" as const, domainType: "community" as const };
    const { plan, by } = run([thread], [opp({ id: "moved", lens: "cited", status: "new", ...page })]);
    assert.deepEqual(plan.inserts, []);
    assert.equal(by.get("moved")!.lens, "threads");
    assert.equal(by.get("moved")!.route, "answer_thread");
    assert.equal(by.get("moved")!.live, true);
  }
  // A page the member logged that the engines now cite stays the logged row, with the evidence; its route and types are the ones it was logged with.
  {
    const { plan, by } = run([cited], [opp({ id: "log", lens: "logged", status: "new", route: "offer_resource", ...page })]);
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(by.get("log")!.evidence, base.evidence);
    assert.equal(by.get("log")!.route, undefined);
    assert.equal(by.get("log")!.page_type, undefined);
  }
  // A member's decision wins over a new row of the same page in the derived lens, which goes not live.
  {
    const { plan, by } = run([cited], [opp({ id: "dup", lens: "cited", status: "new", ...page }), opp({ id: "no", lens: "lists", status: "dismissed", ...page })]);
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(by.get("dup"), { live: false, updated_at: `${TODAY}T03:30:00Z` });
    assert.deepEqual(by.get("no")!.evidence, base.evidence);
  }
  // P10's link lenses are about a domain or a link: a link row of the same page is not this page's row.
  {
    const { plan } = run([cited], [opp({ id: "link", lens: "link_page", status: "pursuing", route: "ask_for_link", ...page })]);
    assert.equal(plan.inserts.length, 1);
  }
});

test("the night skips a page whose address is longer than a row holds, and counts it in the note", () => {
  const long = `https://long.example/${"%E3%81%82".repeat(60)}`;
  const answers = [0, 1, 2].map((d) => ({ run_date: addDays(TODAY, -d), question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: ["Rival"], citations: [{ source_domain: "long.example", url: long }, { source_domain: "short.example", url: "https://short.example/best-tools" }] }));
  const r = derive({ domain: "client.example", today: TODAY, engines: ["chatgpt"], answers, questions: [{ id: "q1", cluster_id: "k1" }], clusters: [{ id: "k1", keyword_id: null }], keywords: [], serpTop: [], reads: new Map(), kinds: new Map([["d:short.example", { domain_type: "publisher", page_type: null, set_by: "model" }], ["d:long.example", { domain_type: "publisher", page_type: null, set_by: "model" }]]), placedKeys: new Set(), keyPages: [] });
  assert.ok(long.length > 500);
  assert.deepEqual(r.rows.map((x) => x.urlKey), ["short.example/best-tools"]);
  assert.equal(r.tooLong, 1);
  assert.ok(!r.unclassified.some((u) => u.urlKey.startsWith("long.example")), "nor is it sent to be typed");
  assert.ok(r.ruleKinds.every((k) => k.key.length <= 520));
});

test("page reads: a page whose reads started failing waits from its last try, not its last good read", () => {
  const read = (over: Partial<PageFacts>): PageFacts => ({ urlKey: "lists.example/best", url: "https://lists.example/best", readAt: `${addDays(TODAY, -30)}T03:00:00Z`, via: "own", status: "ok", http: 200, title: "Best", h1: null, updatedOn: null, headings: [], namesClient: false, snippet: null, brandsFound: [], linksToClient: null, linkRel: null, linkAnchor: null, ...over });
  const rows = [opp({ id: "a" })];
  assert.deepEqual(pickReads(rows, new Map([["lists.example/best", read({})]]), TODAY).map((o) => o.id), ["a"], "a good read 30 days old is due");
  assert.deepEqual(pickReads(rows, new Map([["lists.example/best", read({ attemptedAt: `${addDays(TODAY, -2)}T03:00:00Z` })]]), TODAY), [], "tried two nights ago: not again for 14 days");
  assert.deepEqual(pickReads(rows, new Map([["lists.example/best", read({ attemptedAt: `${addDays(TODAY, -15)}T03:00:00Z` })]]), TODAY).map((o) => o.id), ["a"]);
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
