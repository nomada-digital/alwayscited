import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterSummary } from "./cluster-figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { type AnswerRow, addDays, brandBoard, brandGaps, brandsRead, comparisonRange, keywordsIn, overview, shareOfVoice, ungroupedRead } from "./figures.ts";
import { CITED_WITH_TOP, NAMED_TOP, citedWithBrand, namedPage, openKey, whoIsNamedCard } from "./named-figures.ts";
import { brandGapNote, sovGapNote } from "./run-note.ts";

/**
 * R143 (1 Oct 2026; BRIEF-4 P3): the Who is named page reads what the
 * Overview's "Who is named instead" panel reads for the same range - every
 * row's share and change are brandBoard's, the client's share is
 * shareOfVoice's - and adds only depth (engines, prompts, days).
 */

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
const range = { from: "2026-09-02", to: fx.today };
const before = comparisonRange(range, "prev");
const you = fx.client.brand ?? fx.client.domain;

test("unfiltered, every row equals the Overview panel's row for the same range", () => {
  const board = brandBoard(fx.data.answers, range, before, you);
  const page = namedPage({ answers: fx.data.answers, range, before, you });
  assert.ok(board.length >= 5, `the fixture names only ${board.length} brands`);
  assert.equal(page.brands, board.length);
  for (const b of board) {
    const row = page.rows.find((r) => r.key === b.key);
    assert.ok(row, `${b.name} missing from the page`);
    assert.deepEqual(row.share, b.share, b.name);
    assert.equal(row.delta, b.delta, b.name);
    assert.equal(row.name, b.name);
  }
  const sov = shareOfVoice(fx.data.answers, range);
  assert.equal(page.rows[0]!.you, true, "own row first");
  assert.equal(page.rows[0]!.share.pct, sov.pct, "the client's share is shareOfVoice's");
});

test("others follow by answers naming them; the headline counts answers in range", () => {
  const page = namedPage({ answers: fx.data.answers, range, before, you });
  const others = page.rows.slice(1);
  for (let i = 1; i < others.length; i++) assert.ok(others[i - 1]!.answers >= others[i]!.answers);
  assert.equal(page.answers, fx.data.answers.filter((a) => a.answered && a.run_date >= range.from && a.run_date <= range.to).length);
  assert.ok(NAMED_TOP === 50);
});

const row = (p: Partial<AnswerRow>): AnswerRow => ({ run_date: "2026-09-10", question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: [], ...p });

test("spellings fold by brandKey, engines and prompt days are counted per brand", () => {
  const answers = [
    row({ brands: ["Xero"], engine: "chatgpt" }),
    row({ brands: ["Xero."], engine: "gemini" }),
    row({ brands: ["Xero"], run_date: "2026-09-11", question_id: "q2" }),
    row({ named: true, question_id: "q2" }),
  ];
  const page = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-11" }, before: null, you: "Tallyroo" });
  const xero = page.rows.find((r) => r.key === "xero")!;
  assert.equal(xero.answers, 3);
  assert.equal(xero.name, "Xero");
  assert.deepEqual(xero.engines.sort(), ["chatgpt", "gemini"]);
  assert.deepEqual(xero.prompts, [
    { id: "q2", daysNamed: 1, daysAnswered: 2 },
    { id: "q1", daysNamed: 1, daysAnswered: 1 },
  ]);
  assert.equal(page.rows[0]!.name, "Tallyroo");
  assert.equal(page.rows[0]!.answers, 1);
});

test("filters narrow the answers first; a never-named client still has its own row", () => {
  const answers = [row({ brands: ["Xero"], engine: "chatgpt" }), row({ brands: ["Sage"], engine: "gemini" })];
  const page = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-10" }, before: null, you: "Tallyroo", engine: "gemini" });
  assert.deepEqual(page.rows.map((r) => r.name), ["Tallyroo", "Sage"]);
  assert.equal(page.rows[0]!.answers, 0);
  assert.equal(page.rows[0]!.share.pct, 0);
  const none = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-10" }, before: null, you: "Tallyroo", only: new Set(["other"]) });
  assert.equal(none.rows.length, 1);
  assert.equal(none.rows[0]!.share.pct, null, "no readings: no figure, not 0%");
});

test("'New' is a brand with no mention in the comparison range", () => {
  const answers = [row({ brands: ["Xero"], run_date: "2026-09-01" }), row({ brands: ["Xero", "Sage"] })];
  const page = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-10" }, before: { from: "2026-09-01", to: "2026-09-01" }, you: "T" });
  assert.equal(page.rows.find((r) => r.key === "sage")!.isNew, true);
  assert.equal(page.rows.find((r) => r.key === "xero")!.isNew, false);
});

test("R173: pages cited with a brand come only from answers naming it, under the same filters", () => {
  const cite = (url: string) => ({ source_domain: new URL(url).hostname, url });
  const answers = [
    { ...row({ brands: ["Ledgerline"] }), citations: [cite("https://www.ledgerline.com/pricing/"), cite("https://softwarecritic.com/x")] },
    { ...row({ brands: ["Ledgerline."], engine: "gemini" }), citations: [cite("https://ledgerline.com/pricing")] },
    { ...row({ brands: ["Sumly"] }), citations: [cite("https://ownerledger.co/")] },
    { ...row({ named: true }), citations: [cite("https://tallyroo.com/")] },
    { ...row({ brands: ["Ledgerline"], answered: false }), citations: [cite("https://thesmallbizstack.com/")] },
  ];
  const r = { from: "2026-09-10", to: "2026-09-10" };
  const ll = citedWithBrand({ answers, range: r, key: "ledgerline", you: "Tallyroo", domain: "tallyroo.com" });
  assert.deepEqual(ll.map((p) => [p.page, p.count]), [["ledgerline.com/pricing", 2], ["softwarecritic.com/x", 1]]);
  assert.deepEqual(citedWithBrand({ answers, range: r, key: "ledgerline", you: "Tallyroo", domain: "tallyroo.com", engine: "gemini" }).map((p) => p.page), ["ledgerline.com/pricing"]);
  const own = citedWithBrand({ answers, range: r, key: "tallyroo", you: "Tallyroo", domain: "tallyroo.com" });
  assert.deepEqual(own.map((p) => [p.page, p.yours]), [["tallyroo.com", true]]);
  assert.ok(fx.data.answers.length && CITED_WITH_TOP === 3);
});

test("?open= takes a folded key only", () => {
  assert.equal(openKey("xero"), "xero");
  assert.equal(openKey("Xero"), null);
  assert.equal(openKey("<x>"), null);
  assert.equal(openKey(["xero"]), null);
});

test("8 Oct 2026 (audit reliability-1 / data-6): Who is named reads the brands-unread fixture as if its unread answers were not there", () => {
  const u = fixtureState(fx, { TRACKING_FIXTURE_STATE: "brands-unread" });
  const unread = u.data.answers.filter((a) => a.brands_ok === false);
  assert.ok(unread.length >= 40, `the state marks ${unread.length} answers`);
  const without = u.data.answers.filter((a) => a.brands_ok !== false);
  assert.deepEqual(namedPage({ answers: u.data.answers, range, before, you }), namedPage({ answers: without, range, before, you }));
  assert.deepEqual(shareOfVoice(u.data.answers, range), shareOfVoice(without, range));
  const key = namedPage({ answers: without, range, before, you }).rows[1]!.key;
  for (const k of [key, "tallyroo"]) {
    assert.deepEqual(
      citedWithBrand({ answers: u.data.answers, range, key: k, you, domain: fx.client.domain }),
      citedWithBrand({ answers: without, range, key: k, you, domain: fx.client.domain }),
      k,
    );
  }
  // As the runner stored it before 8 Oct - brands [] with nothing to say so - today's share was the client's to gain.
  const today = { from: fx.today, to: fx.today };
  const asBefore = u.data.answers.map((a) => (a.brands_ok === false ? { ...a, brands_ok: true } : a));
  assert.ok(shareOfVoice(asBefore, today).pct! > shareOfVoice(u.data.answers, today).pct!, "the old storage inflates the share");
  assert.ok(brandBoard(asBefore, today, null, you).find((b) => b.you)!.share.pct! > brandBoard(u.data.answers, today, null, you).find((b) => b.you)!.share.pct!);
});

test("8 Oct 2026 (audit ia-3): the Overview's card reads answers naming each brand, of the headline's own answers", () => {
  const o = overview({ range, compare: "prev", startedOn: fx.client.started_on, engines: [], questions: fx.data.questions, answers: fx.data.answers, serp: fx.data.serp, keywordCount: 9 });
  const cs = clusterSummary(clusterCards({ ...fx.data, range, before: o.compare, today: fx.today, engines: [] }));
  const page = namedPage({ answers: fx.data.answers, range, before, you });
  // One denominator for the headline and the card: 4,760 answers.
  assert.equal(page.answers, o.named.den);
  assert.equal(page.answers, cs.now.den, "the headline by cluster");
  const row = (name: string) => page.rows.find((r) => r.name === name)!;
  assert.deepEqual(row(you).reach, cs.now, "the client's row is the headline's 27%, 1,272 of 4,760");
  // On the mention basis the card read Ledgerline 34% (22% on the long state) and Tallyroo 15% - under a headline of 27%.
  assert.deepEqual([row("Ledgerline").reach.num, row("Ledgerline").reach.den, row("Ledgerline").reach.pct], [2924, 4760, 61]);
  assert.equal(row("Brightbook").reach.pct, 50);
  assert.deepEqual([row("Ledgerline").share.num, row("Ledgerline").share.pct, row(you).share.pct], [2924, 34, 15], "/named's share of mentions is unchanged");
  // Each row's reach counts the same answers as its Answers column on /named.
  for (const r of page.rows) assert.equal(r.reach.num, r.answers, r.name);
  // Review of audit ia-3 (8 Oct 2026): the card is whoIsNamedCard - Who is named's rows on the headline's own
  // answers (the call this pinned counted every answer; see the pending-cluster test below).
  // 18 Oct 2026, brief 2d: the page half (the /app Overview building its card with whoIsNamedCard and no count of its
  // own) retired with /app; every /app address 308s to the dashboards host, which draws no such card. The figures
  // above and whoIsNamedCard's tests below still hold.
});

/** The Overview's headline inputs for one fixture variant: the summary when it reads by cluster, and the flat like-for-like prompts. */
function overviewBasis(data: typeof fx.data) {
  const r = { from: addDays(fx.today, -27), to: fx.today };
  const o = overview({ range: r, compare: "prev", startedOn: fx.client.started_on, engines: [], questions: data.questions, answers: data.answers, serp: data.serp, keywordCount: keywordsIn(data.keywords, r), keywords: data.keywords });
  const cs = clusterSummary(clusterCards({ ...data, range: r, before: o.compare, today: fx.today, engines: [] }));
  assert.equal(ungroupedRead(data.questions, data.answers, r), 0, "every prompt grouped: the headline reads by cluster");
  const card = whoIsNamedCard({ answers: data.answers, range: r, before: o.compare, you, only: cs.ids, lfl: cs.lflIds });
  return { r, o, cs, card, row: (name: string) => card.page.rows.find((x) => x.name === name)! };
}

test("8 Oct 2026 (review of audit ia-3): the card counts the headline's answers when a pending cluster holds moved prompts", () => {
  // c1 set to start tomorrow, its five prompts keeping their readings: the case pendingBasis exists for. The
  // headline counts the clusters with readings, 1,039 of 4,200; the card counted every answer, 4,760, so one
  // page put the client at 25% and 27%, and Ledgerline at 62% and 61%.
  const moved = { ...fx.data, clusters: fx.data.clusters.map((c) => (c.id === "c1" ? { ...c, started_on: addDays(fx.today, 1) } : c)) };
  const { r, cs, card, row } = overviewBasis(moved);
  assert.deepEqual([cs.now.num, cs.now.den, cs.now.pct], [1039, 4200, 25], "the headline");
  assert.equal(card.page.answers, cs.now.den, "the card's denominator is the headline's");
  assert.deepEqual(row(you).reach, cs.now, "the client's row is the headline");
  assert.deepEqual([row("Ledgerline").reach.num, row("Ledgerline").reach.den, row("Ledgerline").reach.pct], [2587, 4200, 62], "the leader line's 62%");
  assert.equal(namedPage({ answers: moved.answers, range: r, before: null, you }).answers, 4760, "every answer, as the card counted before");
  assert.equal(card.change!.get(row(you).key), cs.lflDelta, "the client's change is the headline's like-for-like change");
});

test("8 Oct 2026 (review of audit ia-3): the card's change is like-for-like, the client's row equal to the headline's chip", () => {
  const { o, cs, card, row } = overviewBasis(fx.data);
  // The card's change used to be brandBoard's share-of-mentions delta (Tallyroo +1, Ledgerline -1, Sumly 0).
  assert.equal(cs.lflDelta, 3);
  assert.deepEqual(Object.fromEntries(["Tallyroo", "Ledgerline", "Brightbook", "Countwise", "Sumly"].map((n) => [n, card.change!.get(row(n).key)])), { Tallyroo: 3, Ledgerline: -2, Brightbook: -2, Countwise: 0, Sumly: -1 });
  assert.equal(card.change!.get(row(you).key), cs.lflDelta, "Tallyroo +3, the headline chip");
  // Both periods on one footing: answers naming the brand, of the answers in that period.
  assert.deepEqual(row(you).reachBefore, { num: 1111, den: 4480, pct: 25 });
  assert.deepEqual(row("Ledgerline").reachBefore, { num: 2805, den: 4480, pct: 63 });
  assert.equal(o.namedBefore!.den, 4480, "the comparison's answers, as the headline counts them");
  // No comparison, no change.
  assert.equal(whoIsNamedCard({ answers: fx.data.answers, range: o.range, before: null, you, only: cs.ids, lfl: cs.lflIds }).change, null);
});

test("8 Oct 2026 (merge of audit packages A and B): the card counts the headline's answers whose brands were read", () => {
  // B put the card on the headline's answers; A leaves an answer whose other brands were not read out of every
  // brand figure, Who is named included. The card is a brand figure, so on the brands-unread state it counts the
  // headline's answers less today's unread ChatGPT ones - in its rows and in its like-for-like change - and the
  // Overview's brand gap note says why its client row is not the headline's that day.
  const u = fixtureState(fx, { TRACKING_FIXTURE_STATE: "brands-unread" }).data;
  const read = u.answers.filter(brandsRead);
  const { o, cs, card, row } = overviewBasis(u);
  const same = whoIsNamedCard({ answers: read, range: o.range, before: o.compare, you, only: cs.ids, lfl: cs.lflIds });
  assert.deepEqual(card.page, same.page, "the rows are the card on the read answers alone");
  assert.deepEqual(card.change, same.change, "and so is each row's like-for-like change");
  const unread = u.answers.filter((a) => !brandsRead(a) && a.answered && cs.ids.has(a.question_id) && a.run_date >= o.range.from && a.run_date <= o.range.to).length;
  assert.ok(unread >= 40, `${unread} unread answers in the range`);
  assert.equal(card.page.answers, cs.now.den - unread, "the headline's answers, less the unread ones");
  assert.notDeepEqual(row(you).reach, cs.now, "so the client's row is not the headline's on a range with a brand gap");
  // On the default state, with every brand read, the client's row is still the headline's.
  const d = overviewBasis(fx.data);
  assert.deepEqual(d.row(you).reach, d.cs.now);
});

test("8 Oct 2026 (review of the integration of audit packages A, B and C): with a pending cluster on brands-unread, the card's note and share of voice each count what they leave out", () => {
  // c1 set to start tomorrow on brands-unread: B's pending-cluster case with A's unread answers. The card and its
  // note count the headline's prompts, so they add up to the headline. Share of voice counts every prompt, so it
  // also leaves out the unread answers on c1's moved prompts, which the card's note does not name.
  const u = fixtureState(fx, { TRACKING_FIXTURE_STATE: "brands-unread" }).data;
  const moved = { ...u, clusters: u.clusters.map((c) => (c.id === "c1" ? { ...c, started_on: addDays(fx.today, 1) } : c)) };
  const { r, o, cs, card } = overviewBasis(moved);
  const total = (gaps: readonly { answers: number }[]) => gaps.reduce((s, g) => s + g.answers, 0);
  // As Overview.tsx counts them.
  const gaps = brandGaps(moved.answers.filter((a) => cs.ids.has(a.question_id)), r);
  const every = brandGaps(moved.answers, r);
  assert.deepEqual([card.page.answers, total(gaps), cs.now.den], [4160, 40, 4200], "the card's answers and its note's add up to the headline's");
  const unread = moved.answers.filter((a) => a.answered && !brandsRead(a) && a.run_date >= r.from && a.run_date <= r.to);
  assert.equal(total(every), unread.length, "share of voice's count is every unread answer in the range");
  assert.equal(unread.length, 45);
  assert.equal(unread.filter((a) => !cs.ids.has(a.question_id)).length, 5, "five on the pending cluster's prompts");
  assert.deepEqual(o.sov, shareOfVoice(moved.answers.filter(brandsRead), r), "and share of voice leaves all of them out");
  const note = [brandGapNote(gaps), sovGapNote(gaps, every)].filter(Boolean).join(" ");
  assert.equal(note, `${brandGapNote(gaps)} Share of voice, which counts every prompt, leaves out 45 answers whose other brands were not read.`);
  // Without the pending cluster the card counts every prompt with answers, and its note speaks for share of voice too.
  const plain = overviewBasis(u);
  const plainGaps = brandGaps(u.answers.filter((a) => plain.cs.ids.has(a.question_id)), plain.r);
  assert.deepEqual(plainGaps, brandGaps(u.answers, plain.r));
  assert.equal(sovGapNote(plainGaps, brandGaps(u.answers, plain.r)), null);
});
