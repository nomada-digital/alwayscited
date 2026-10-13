import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { type Fixture, expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";
import { addDays } from "../../tracking/figures.ts";
import { promptRows } from "../ai/prompt-table.ts";
import { overviewBasis, overviewStory } from "./story.ts";

/**
 * Every tracking fixture state P4 draws (13 Oct 2026, DIY P4; spec 10
 * section 7.5 "Fixture states"): default, new, young, partial, failed,
 * uncited, long and ended, plus a zero state made from uncited - no answer
 * names the client and no keyword is in the top 20.
 *
 * Review of P4 (13 Oct 2026): this test re-implemented the page's wiring and
 * passed every state "no first reading, no cluster changes", so it never ran
 * the change bullet or the first-reading branch. It now runs story.ts's
 * overviewBasis and overviewStory - the functions Overview.tsx calls - on the
 * page's default range, and holds each state's headline variant, bullet kinds
 * and change-list state. Two states are made here from the fixture's own
 * rows: `first` (a young client on its only day of checks) and `ended-quiet`
 * (an ended client whose last check was ten days ago).
 */

const fx = expandFixture(JSON.parse(readFileSync(new URL("../../tracking/fixture.json", import.meta.url), "utf8")));
const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];

const cut = (f: Fixture, keep: (day: string) => boolean): Fixture => ({
  ...f,
  data: { ...f.data, answers: f.data.answers.filter((a) => keep(a.run_date)), serp: f.data.serp.filter((s) => keep(s.run_date)), runs: (f.data.runs ?? []).filter((r) => keep(r.run_date)) },
});

function zero(f: Fixture): Fixture {
  return { ...f, data: { ...f.data, answers: f.data.answers.map((a) => ({ ...a, named: false, brands: a.brands.filter((b) => b !== f.client.brand), citations: [] })), serp: f.data.serp.map((s) => ({ ...s, position: null })) } };
}

const STATES = ["default", "new", "young", "partial", "failed", "uncited", "long", "ended", "zero", "first", "ended-quiet"] as const;
type State = (typeof STATES)[number];

function load(state: State): { f: Fixture; today: string } {
  if (state === "zero") {
    const f = zero(fixtureState(fx, { TRACKING_FIXTURE_STATE: "uncited" }));
    return { f, today: f.today };
  }
  if (state === "first") {
    const y = fixtureState(fx, { TRACKING_FIXTURE_STATE: "young" });
    const day = y.client.started_on!;
    return { f: cut(y, (d) => d === day), today: day };
  }
  if (state === "ended-quiet") {
    const e = fixtureState(fx, { TRACKING_FIXTURE_STATE: "ended" });
    return { f: cut(e, (d) => d <= addDays(e.today, -10)), today: e.today };
  }
  const f = fixtureState(fx, { TRACKING_FIXTURE_STATE: state });
  return { f, today: f.today };
}

/** The Overview's default view of a state: the last 28 days, the previous period, the page's own basis and story. */
function run(state: State) {
  const { f, today } = load(state);
  const d = f.data;
  const range = { from: addDays(today, -27), to: today };
  const basis = overviewBasis({ data: d, range, compare: "prev", startedOn: f.client.started_on, engines: ENGINES, today });
  const story = overviewStory(basis, { data: d, range, today, engines: ENGINES, brand: f.client.brand, domain: f.client.domain, startedOn: f.client.started_on, recent: { ok: true, data: d } });
  const rows = promptRows({
    prompts: d.questions,
    clusters: (basis.cards ?? []).map((c) => ({ id: c.id, label: c.keyword ?? c.name, prompts: c.prompts.map((p) => p.id) })),
    answers: d.answers,
    range,
    loadedFrom: addDays(range.from, -28),
    engines: ENGINES,
    origins: new Map(),
    brand: f.client.brand,
    domain: f.client.domain,
  });
  return { ...story, rows, hasData: basis.o.named.den > 0 };
}

/** What each state's Overview says: the headline variant, the bullets by kind, and the change list's state. */
const EXPECT: Record<State, { variant: string; bullets: string[]; diff: string }> = {
  default: { variant: "compared", bullets: ["engines", "google", "change"], diff: "ok" },
  // No reading at all: the page draws its pending card, not these (hasData false, held below).
  new: { variant: "plain", bullets: [], diff: "early" },
  // Against the first week: counts over periods of different lengths, so no change bullet.
  young: { variant: "compared", bullets: ["engines", "google"], diff: "ok" },
  partial: { variant: "compared", bullets: ["engines", "google", "change"], diff: "ok" },
  // Today's check failed: 27 check days against 28, so answer counts are not compared (meaning.ts clusterChanges).
  failed: { variant: "compared", bullets: ["engines", "google"], diff: "ok" },
  uncited: { variant: "compared", bullets: ["engines", "google", "change"], diff: "ok" },
  long: { variant: "compared", bullets: ["engines", "google", "change"], diff: "ok" },
  ended: { variant: "compared", bullets: ["engines", "google", "change"], diff: "ok" },
  // Nothing named and nothing moved: no change bullet, and a change list with no lines.
  zero: { variant: "compared", bullets: ["engines", "google"], diff: "ok" },
  first: { variant: "first", bullets: ["engines", "google"], diff: "early" },
  // Checks stopped ten days ago: a quiet week, never "changes start from your second check", and no count read as a change.
  "ended-quiet": { variant: "compared", bullets: ["engines", "google"], diff: "quiet" },
};

for (const state of STATES) {
  test(`${state}: the headline variant, the bullets and the change list, as the page wires them`, () => {
    const r = run(state);
    const e = EXPECT[state];
    assert.equal(r.said.variant, e.variant, `${state}: ${r.said.text}`);
    assert.deepEqual(
      r.bullets.map((b) => b.kind),
      e.bullets,
      `${state}: ${r.bullets.map((b) => b.text).join(" / ")}`,
    );
    assert.ok(r.diff && !("error" in r.diff));
    assert.equal(r.diff.state, e.diff, `${state}: ${JSON.stringify(r.diff).slice(0, 200)}`);
    // The count the page links sits inside the paragraph.
    assert.ok(r.said.text.includes(r.said.count), `${state}: "${r.said.count}" not in "${r.said.text}"`);
    const words = [r.said.text, ...r.bullets.map((b) => b.text), ...(r.diff.state === "ok" ? r.diff.lines.flatMap((l) => [l.text, ...(l.items ?? []).map((i) => i.text)]) : [])];
    for (const w of words) {
      assert.doesNotMatch(w, /NaN|undefined|null|\[object/, `${state}: "${w}"`);
      assert.doesNotMatch(w, /\b(caused|drove|because of|thanks to|resulted in|delivered|in your place)\b/i, `${state}: "${w}"`);
    }
    if (r.diff.state === "ok") {
      assert.ok(r.diff.lines.length <= 8);
      // Every prompt line opens an answer: on its own, or through the prompts a grouped line carries.
      for (const l of r.diff.lines.filter((x) => x.kind === "lost" || x.kind === "won")) {
        const links = l.items ? l.items.map((i) => i.link) : [l.link];
        assert.ok(links.length && links.every((k) => k?.to === "answer"), `${state}: "${l.text}" opens no answer`);
        if (l.items) assert.match(l.text, new RegExp(`for ${l.items.length} prompts\\.$`), l.text);
      }
    }
    for (const row of r.rows) assert.ok(!row.latest || row.latest.named <= row.latest.of, `${state} ${row.id}`);
  });
}

test("new: nothing read - the page's pending state, no change list yet, and no row has a reading", () => {
  const r = run("new");
  assert.equal(r.hasData, false);
  assert.deepEqual(r.diff, { state: "early", days: 0 });
  assert.ok(r.rows.every((x) => x.latest === null));
});

test("first: the first-reading headline on the one day read", () => {
  const r = run("first");
  assert.match(r.said.text, /^First reading on 20 Sep: named in [\d,]+ of [\d,]+ AI answers to your \d+ prompts \(\d+%\)\. \d+ of \d+ cluster keywords on Google's page 1\. Change figures start from the next check\.$/);
  assert.deepEqual(r.diff, { state: "early", days: 1 });
});

test("partial and failed: the change list opens on the latest check", () => {
  const p = run("partial");
  if (p.diff && "lines" in p.diff) assert.match(p.diff.lines[0]!.text, /^Your check on 29 Sep was partial: Google AI Overviews did not answer \d+ prompts\.$/);
  else assert.fail("partial: no change list");
  const f = run("failed");
  if (f.diff && "lines" in f.diff) assert.match(f.diff.lines[0]!.text, /^Your check on 29 Sep failed: none of its reads came back\.$/);
  else assert.fail("failed: no change list");
});

test("zero: stated as a reading, and Google says none is in the top 20", () => {
  const r = run("zero");
  assert.match(r.said.text, /^Named in 0 of [\d,]+ AI answers to your \d+ prompts in the last 28 days \(0%\)/);
  assert.ok(r.bullets.some((b) => b.text === "None of your cluster keywords is in Google's top 20 yet."));
  assert.ok(r.rows.every((x) => x.answers.num === 0));
});

test("ended-quiet: a week with no check reads as one", () => {
  assert.deepEqual(run("ended-quiet").diff, { state: "quiet", days: 0 });
});
