/**
 * swapCandidates (13 Oct 2026, DIY P2; spec 10 section 6.7, opportunity
 * prompts step 4). Illustrative: every prompt shown is made up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SWAP_DAYS, namedLine, swapCandidates, type SwapAnswer, type SwapPrompt } from "./swap.ts";

const today = "2026-09-29";
const P = (id: string, angle: string, added_on = "2026-06-10", extra: Partial<SwapPrompt> = {}): SwapPrompt => ({ id, text: `prompt ${id}`, angle, added_on, ...extra });
/** One answer a day for `days` days ending today, named on the days `named` says. */
function daily(id: string, days: number, named: (i: number) => boolean, answered = true): SwapAnswer[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    return { question_id: id, run_date: d, answered, named: answered && named(i) };
  });
}

test("each angle prompt has its 'named in n of m answers (28 days)'; silences are left out of m", () => {
  const prompts = [P("a", "category"), P("b", "positioning")];
  const answers = [...daily("a", 40, (i) => i % 4 === 0), ...daily("b", 28, () => false), ...daily("b", 5, () => false, false)];
  const out = swapCandidates(prompts, answers, { today });
  assert.equal(out[0]!.of, SWAP_DAYS, "only the 28 days ending today");
  assert.equal(out[0]!.named, 7);
  assert.equal(out[0]!.line, "named in 7 of 28 answers (28 days)");
  assert.equal(out[1]!.of, 28, "an unanswered read is not a miss");
  assert.equal(namedLine(0, 0), "no answers in 28 days");
  assert.equal(namedLine(1, 1), "named in 1 of 1 answer (28 days)");
});

test("the suggested one: named in no answer for 28 days and not added in them, oldest first", () => {
  const prompts = [P("named", "category", "2026-06-10"), P("newer", "positioning", "2026-08-01"), P("older", "sector", "2026-07-01"), P("fresh", "outcome", "2026-09-20")];
  const answers = [...daily("named", 28, (i) => i === 3), ...daily("newer", 28, () => false), ...daily("older", 28, () => false), ...daily("fresh", 9, () => false)];
  const out = swapCandidates(prompts, answers, { today });
  assert.deepEqual(out.filter((c) => c.suggested).map((c) => c.id), ["older"]);
  assert.deepEqual(out.map((c) => c.id), ["named", "newer", "older", "fresh"], "the cluster's own order is kept");
});

test("placement prompts and stopped prompts are never offered", () => {
  const prompts = [P("a", "category"), P("pl", "placement", "2026-06-10", { placement: true, angle: null } as Partial<SwapPrompt>), P("gone", "sector", "2026-06-10", { stopped_on: "2026-09-01" })];
  const out = swapCandidates(prompts, [], { today });
  assert.deepEqual(out.map((c) => c.id), ["a"]);
});

test("none is suggested when every prompt named the client or is too new", () => {
  const prompts = [P("a", "category"), P("b", "positioning", "2026-09-15")];
  const answers = [...daily("a", 28, (i) => i === 0), ...daily("b", 15, () => false)];
  assert.equal(swapCandidates(prompts, answers, { today }).some((c) => c.suggested), false);
});

test("ties on added_on go to the angle order", () => {
  const prompts = [P("x", "category"), P("y", "positioning")];
  assert.deepEqual(swapCandidates(prompts, [], { today }).filter((c) => c.suggested).map((c) => c.id), ["x"]);
});
