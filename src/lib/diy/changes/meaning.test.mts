import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";
import { addDays, rate } from "../../tracking/figures.ts";
import { engineRates } from "../ai/engine-rates.ts";
import { type HeadlineInput, type MeaningInput, beforeWords, clusterChanges, direction, headline, periodWords, whatItMeans } from "./meaning.ts";

/**
 * The Overview's headline variants and "What it means" (13 Oct 2026, DIY P4;
 * spec 10 section 4.1 rows 3 and 3b): every branch, then the fixture.
 */

const TODAY = "2026-10-14";
const L28 = { from: addDays(TODAY, -27), to: TODAY };

const h = (over: Partial<HeadlineInput> = {}): HeadlineInput => ({
  named: rate(412, 5600),
  prompts: 50,
  range: L28,
  today: TODAY,
  firstReading: null,
  lfl: { now: rate(412, 5600), before: rate(280, 5600), basis: "prompts", count: 50 },
  compareKind: "prev",
  keywords: { onPage1: 4, of: 10, before: 3, cluster: true },
  ...over,
});

test("headline: the spec's three variants", () => {
  assert.deepEqual(headline(h({ firstReading: "2026-10-14", named: rate(31, 200), lfl: null, compareKind: null, keywords: { onPage1: 3, of: 10, before: null, cluster: true } })), {
    variant: "first",
    text: "First reading on 14 Oct: named in 31 of 200 AI answers to your 50 prompts (16%). 3 of 10 cluster keywords on Google's page 1. Change figures start from the next check.",
  });
  assert.deepEqual(headline(h()), {
    variant: "compared",
    text: "Named in 412 of 5,600 AI answers to your 50 prompts in the last 28 days (7%), up from 5% in the 28 days before, same prompts. 4 of 10 cluster keywords are on Google's page 1, was 3.",
  });
  assert.deepEqual(headline(h({ lfl: null, compareKind: null })), {
    variant: "plain",
    text: "Named in 412 of 5,600 AI answers to your 50 prompts in the last 28 days (7%). 4 of 10 cluster keywords are on Google's page 1, was 3.",
  });
});

test("headline: direction is the sign of the like-for-like change in rounded points", () => {
  assert.equal(direction(rate(7, 100), rate(5, 100)), "up from");
  assert.equal(direction(rate(5, 100), rate(7, 100)), "down from");
  // 7.4% and 6.6% both round to 7: the same as.
  assert.equal(direction(rate(74, 1000), rate(66, 1000)), "the same as");
  assert.match(headline(h({ lfl: { now: rate(412, 5600), before: rate(392, 5600), basis: "prompts", count: 50 } })).text, /\(7%\), the same as 7% in the 28 days before, same prompts\./);
  assert.match(headline(h({ lfl: { now: rate(412, 5600), before: rate(560, 5600), basis: "prompts", count: 50 } })).text, /\(7%\), down from 10% in the 28 days before/);
});

test("headline: a like-for-like rate that differs from the paragraph's is said on its own basis", () => {
  // Prompts added mid-range: the paragraph counts all 50, like-for-like only the 45 tracked all period.
  const t = headline(h({ lfl: { now: rate(380, 5040), before: rate(280, 5040), basis: "clusters", count: 9 } })).text;
  assert.equal(t, "Named in 412 of 5,600 AI answers to your 50 prompts in the last 28 days (7%). On the 9 clusters tracked all period it is 8%, up from 6% in the 28 days before. 4 of 10 cluster keywords are on Google's page 1, was 3.");
  // Against the first week, "all period" is since then.
  assert.match(headline(h({ compareKind: "start", lfl: { now: rate(380, 5040), before: rate(30, 500), basis: "prompts", count: 1 } })).text, /On the 1 prompt tracked since your first week it is 8%, up from 6% in your first week\./);
});

test("headline: period and comparison words, keywords with no 'was' on different keywords, none with no keyword", () => {
  assert.equal(periodWords(L28, TODAY), "in the last 28 days");
  assert.equal(periodWords({ from: TODAY, to: TODAY }, TODAY), "today");
  assert.equal(periodWords({ from: "2026-08-05", to: "2026-09-01" }, TODAY), "from 5 Aug to 1 Sep");
  assert.equal(periodWords({ from: "2026-08-05", to: "2026-08-05" }, TODAY), "on 5 Aug");
  assert.equal(beforeWords("month", L28), "in the month before");
  assert.equal(beforeWords("first", L28), "on your first reading");
  assert.equal(beforeWords("start", L28), "in your first week");
  assert.equal(beforeWords("prev", { from: "2026-10-08", to: TODAY }), "in the 7 days before");
  assert.match(headline(h({ keywords: { onPage1: 1, of: 10, before: null, cluster: false } })).text, /same prompts\. 1 of 10 keywords is on Google's page 1\.$/);
  assert.match(headline(h({ keywords: { onPage1: 0, of: 0, before: null, cluster: true } })).text, /same prompts\.$/);
  assert.match(headline(h({ keywords: null })).text, /same prompts\.$/);
});

test("headline: zero visibility is stated as a reading", () => {
  assert.equal(
    headline(h({ named: rate(0, 5600), lfl: { now: rate(0, 5600), before: rate(0, 5600), basis: "prompts", count: 50 }, keywords: { onPage1: 0, of: 10, before: 0, cluster: true } })).text,
    "Named in 0 of 5,600 AI answers to your 50 prompts in the last 28 days (0%), the same as 0% in the 28 days before, same prompts. 0 of 10 cluster keywords are on Google's page 1, was 0.",
  );
});

const engines = (named: Record<string, [number, number]>) => Object.entries(named).map(([engine, [num, den]]) => ({ engine, rate: rate(num, den) }));
const kw = (id: string, keyword: string, position: number | null, read = true) => ({ id, keyword, position, read });
const m = (over: Partial<MeaningInput> = {}): MeaningInput => ({
  first: false,
  engines: engines({ google_aio: [20, 1400], chatgpt: [30, 1400], gemini: [6, 1400], perplexity: [41, 1400] }),
  keywords: [kw("k1", "accounting app for freelancers", 4), kw("k3", "invoicing software", 11), kw("k4", "payroll for sole traders", 14)],
  cluster: true,
  clusters: [
    { id: "c1", label: "accounting app for freelancers", now: 30, before: 28 },
    { id: "c4", label: "payroll for sole traders", now: 14, before: 6 },
  ],
  ...over,
});

test("what it means: the spec's three bullets", () => {
  assert.deepEqual(whatItMeans(m()), [
    { kind: "engines", text: "Perplexity names you in the most answers (41 of 1,400); Gemini in the fewest (6 of 1,400).", link: { to: "engine", engine: "perplexity" }, linkText: "Perplexity" },
    { kind: "google", text: "Closest to page 1: 'invoicing software' at 11th.", link: { to: "keyword", keyword: "k3" }, linkText: "'invoicing software'" },
    { kind: "change", text: "'payroll for sole traders': named in 14 answers, was 6, same prompts.", link: { to: "cluster", cluster: "c4" }, linkText: "'payroll for sole traders'" },
  ]);
});

test("what it means: a first reading has bullets 1 and 2 only, and no comparison has no third", () => {
  assert.deepEqual(whatItMeans(m({ first: true })).map((b) => b.kind), ["engines", "google"]);
  assert.deepEqual(whatItMeans(m({ clusters: null })).map((b) => b.kind), ["engines", "google"]);
  // No cluster moved: nothing to say.
  assert.deepEqual(whatItMeans(m({ clusters: [{ id: "c1", label: "x", now: 5, before: 5 }] })).map((b) => b.kind), ["engines", "google"]);
});

test("what it means: fewer than two engines answering skips the engines bullet; unequal answers say share", () => {
  assert.deepEqual(whatItMeans(m({ engines: engines({ google_aio: [0, 0], chatgpt: [30, 1400], gemini: [0, 0], perplexity: [0, 0] }) })).map((b) => b.kind), ["google", "change"]);
  assert.equal(
    whatItMeans(m({ engines: engines({ chatgpt: [30, 1400], gemini: [6, 1200], perplexity: [41, 1400] }) }))[0]!.text,
    "Perplexity names you in the largest share of its answers (41 of 1,400); Gemini in the smallest (6 of 1,200).",
  );
  assert.equal(whatItMeans(m({ engines: engines({ chatgpt: [10, 100], gemini: [10, 100] }) }))[0]!.text, "All 2 engines that answered name you in 10% of their answers.");
});

test("what it means: Google - none in the top 20, all on page 1, one keyword, and page 1 with the rest out", () => {
  const google = (keywords: MeaningInput["keywords"], cluster = true) => whatItMeans(m({ keywords, cluster })).find((b) => b.kind === "google");
  assert.equal(google([kw("k1", "a", null), kw("k2", "b", null)])!.text, "None of your cluster keywords is in Google's top 20 yet.");
  assert.equal(google([kw("k1", "a", 2), kw("k2", "x", 9), kw("k3", "c", 5)])!.text, "All 3 cluster keywords are on page 1; the lowest is 'x' at 9th.");
  assert.equal(google([kw("k1", "invoicing software", 3)])!.text, "Your cluster keyword 'invoicing software' is on page 1, at 3rd.");
  assert.equal(google([kw("k1", "a", 3), kw("k2", "b", null), kw("k3", "c", null)], false)!.text, "1 of 3 keywords is on page 1; the other 2 are outside the top 20.");
  // A keyword not read at all is in no count; with none read, no bullet.
  assert.equal(google([kw("k1", "a", 3), kw("k2", "b", null, false)])!.text, "Your cluster keyword 'a' is on page 1, at 3rd.");
  assert.equal(google([kw("k1", "a", null, false)]), undefined);
});

test("what it means: the biggest change is the largest absolute like-for-like move, ties to the larger count", () => {
  const change = (clusters: MeaningInput["clusters"]) => whatItMeans(m({ clusters })).find((b) => b.kind === "change")?.text;
  assert.equal(change([{ id: "a", label: "up", now: 20, before: 12 }, { id: "b", label: "down", now: 4, before: 13 }]), "'down': named in 4 answers, was 13, same prompts.");
  assert.equal(change([{ id: "a", label: "low", now: 3, before: 8 }, { id: "b", label: "high", now: 13, before: 8 }]), "'high': named in 13 answers, was 8, same prompts.");
  assert.equal(change([{ id: "a", label: "one", now: 1, before: 0 }]), "'one': named in 1 answer, was 0, same prompts.");
});

test("no headline or bullet uses a causal word", () => {
  const all = [headline(h()).text, headline(h({ lfl: null })).text, ...whatItMeans(m()).map((b) => b.text)];
  for (const t of all) assert.doesNotMatch(t, /\b(caused|drove|because of|thanks to|resulted in|delivered|score|AI rank)\b/i, t);
});

test("on the fixture: per-cluster changes are like for like, and only over periods of one length", () => {
  const fx = expandFixture(JSON.parse(readFileSync(new URL("../../tracking/fixture.json", import.meta.url), "utf8")));
  const d = fixtureState(fx, {}).data;
  const range = { from: addDays(fx.today, -27), to: fx.today };
  const compare = { from: addDays(range.from, -28), to: addDays(range.from, -1) };
  const lfl = new Set(d.questions.filter((q) => q.added_on <= compare.from && (q.stopped_on === null || q.stopped_on > range.to)).map((q) => q.id));
  const clusters = d.clusters.filter((c) => c.stopped_on === null).map((c) => ({ id: c.id, label: c.name }));
  const changes = clusterChanges({ clusters, prompts: d.questions, answers: d.answers, range, compare, lfl });
  assert.ok(changes.length >= 5, `${changes.length} clusters compared`);
  for (const c of changes) {
    const ids = new Set(d.questions.filter((q) => q.cluster_id === c.id && lfl.has(q.id)).map((q) => q.id));
    const count = (r: { from: string; to: string }) => d.answers.filter((a) => a.answered && a.named && ids.has(a.question_id) && a.run_date >= r.from && a.run_date <= r.to).length;
    assert.deepEqual([c.now, c.before], [count(range), count(compare)], c.label);
  }
  assert.deepEqual(clusterChanges({ clusters, prompts: d.questions, answers: d.answers, range, compare: { from: compare.from, to: addDays(compare.to, -21) }, lfl }), []);
  // The engines bullet counts what engineRates counts on the fixture.
  const rates = engineRates(d.answers, range, ["google_aio", "chatgpt", "gemini", "perplexity"]);
  const b = whatItMeans({ first: false, engines: rates, keywords: [], cluster: true, clusters: changes });
  assert.equal(b[0]!.kind, "engines");
  assert.match(b[0]!.text, /^\w[\w ]+ names you in the most answers \([\d,]+ of [\d,]+\); [\w ]+ in the fewest \([\d,]+ of [\d,]+\)\.$/);
});
