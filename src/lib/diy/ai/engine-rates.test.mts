import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";
import { type AnswerRow, type CitationRow, addDays, namedRate, rate } from "../../tracking/figures.ts";
import { checkDaysIn, citingShare, engineRates, startAgainstNow, strongestEngine, weakestEngine } from "./engine-rates.ts";

/**
 * Per-engine readings (13 Oct 2026, DIY P4; spec 10 sections 4.1 row 3b and
 * 4.2 rows 2 and 4). Each is namedRate on one engine, or a count with its
 * denominator.
 */

const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const a = (d: number, q: string, engine: string, named: boolean, over: Partial<AnswerRow & CitationRow> = {}): AnswerRow & CitationRow => ({ run_date: day(d), question_id: q, engine, answered: true, named, brands: [], citations: [], ...over });
const R = { from: day(1), to: day(14) };

test("engine rates: namedRate per engine in the tier's order; a silent engine is out of its denominator", () => {
  const rows = [a(10, "q1", "chatgpt", true), a(10, "q2", "chatgpt", false), a(10, "q1", "gemini", false, { answered: false }), a(10, "q1", "perplexity", true), a(20, "q1", "perplexity", true)];
  assert.deepEqual(engineRates(rows, R, ENGINES), [
    { engine: "google_aio", rate: rate(0, 0) },
    { engine: "chatgpt", rate: rate(1, 2) },
    { engine: "gemini", rate: rate(0, 0) },
    { engine: "perplexity", rate: rate(1, 1) },
  ]);
  assert.deepEqual(engineRates(rows, R, ["chatgpt"], new Set(["q2"])), [{ engine: "chatgpt", rate: rate(0, 1) }]);
});

test("strongest and weakest: by share, ties to more (or fewer) named, then the tier's order; silent engines never", () => {
  const rates = [
    { engine: "google_aio", rate: rate(0, 0) },
    { engine: "chatgpt", rate: rate(10, 100) },
    { engine: "gemini", rate: rate(20, 200) },
    { engine: "perplexity", rate: rate(5, 100) },
  ];
  assert.equal(strongestEngine(rates)!.engine, "gemini");
  assert.equal(weakestEngine(rates)!.engine, "perplexity");
  assert.equal(strongestEngine([{ engine: "x", rate: rate(0, 0) }]), null);
});

test("start against now: like for like per engine, over the prompts it answered both days", () => {
  const rows = [
    a(3, "q1", "chatgpt", false),
    a(3, "q2", "chatgpt", false),
    a(3, "q3", "chatgpt", true),
    a(14, "q1", "chatgpt", true),
    a(14, "q2", "chatgpt", false, { answered: false }),
    a(14, "q3", "chatgpt", true),
    a(14, "q4", "chatgpt", true),
    a(3, "q1", "gemini", true),
    a(9, "q1", "gemini", true),
  ];
  // ChatGPT: q2 silent today and q4 not asked on the 3rd, so neither counts: then 1 (q3), now 2 (q1, q3), of 2.
  // Gemini did not answer on the 14th at all, so it has no row.
  assert.deepEqual(startAgainstNow(rows, R, ENGINES), { from: day(3), to: day(14), rows: [{ engine: "chatgpt", then: 1, now: 2, of: 2 }] });
  assert.equal(startAgainstNow([a(14, "q1", "chatgpt", true)], R, ENGINES), null, "one check: nothing to set against");
  assert.deepEqual(checkDaysIn(rows, R), [day(3), day(9), day(14)]);
});

test("answers citing your site: only among answers that returned sources", () => {
  const cite = (...urls: string[]) => urls.map((u) => ({ source_domain: new URL(u).hostname, url: u }));
  const rows = [
    a(10, "q1", "chatgpt", false, { citations: cite("https://www.tallyroo.example/pricing") }),
    a(10, "q2", "chatgpt", false, { citations: cite("https://ledgerline.example/x") }),
    a(10, "q3", "chatgpt", true, { citations: [] }),
    // A subdomain of the client's site is the client's site.
    a(10, "q4", "chatgpt", true, { citations: cite("https://help.tallyroo.example/a", "https://ledgerline.example/y") }),
    a(10, "q5", "chatgpt", false, { answered: false, citations: cite("https://tallyroo.example/") }),
  ];
  assert.deepEqual(citingShare(rows, R, "tallyroo.example"), rate(2, 3));
  assert.deepEqual(citingShare(rows, R, "tallyroo.example", new Set(["q2"])), rate(0, 1));
});

test("on the fixture: the engine rates add up to the named rate", () => {
  const fx = expandFixture(JSON.parse(readFileSync(new URL("../../tracking/fixture.json", import.meta.url), "utf8")));
  for (const state of ["default", "partial", "failed"]) {
    const d = fixtureState(fx, { TRACKING_FIXTURE_STATE: state }).data;
    const range = { from: addDays(fx.today, -27), to: fx.today };
    const rates = engineRates(d.answers, range, ENGINES);
    const all = namedRate(d.answers, range);
    assert.equal(rates.reduce((s, r) => s + r.rate.num, 0), all.num, state);
    assert.equal(rates.reduce((s, r) => s + r.rate.den, 0), all.den, state);
  }
});
