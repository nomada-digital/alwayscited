import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { answerGap, standfirst } from "./result-figures.ts";

/**
 * R127 census (Danny, 30 Sep 2026, danny.md line 113): the free scan's own
 * surfaces say "prompts". The S2 copy flip (5e2f59d, 7453059) missed the
 * homepage hero, the waiting screen's counts and the result's standfirst; the
 * boards still say "questions", and Danny's newest word overrides them.
 *
 * Each entry is a surface: the file its copy lives in, the old wording that
 * must not come back, and the new wording that must be there, so a rewrite
 * that drops the line altogether fails rather than passing clean.
 */
const SURFACES: { file: string; old: RegExp; now: RegExp; where: string }[] = [
  { where: "homepage hero line", file: "src/components/home/HomeHero.tsx", old: /buyer questions/, now: /\} buyer prompts, /u },
  { where: "homepage closing FAQ line", file: "src/components/home/HomeFaq.tsx", old: /buyer questions/, now: /\} buyer prompts, / },
  { where: "waiting screen counts", file: "src/components/scan/ScanProgress.tsx", old: /\} questions, \$\{engines/, now: /\} prompts, \$\{engines\.length\} engines, / },
  { where: "result standfirst", file: "src/components/scan/result-figures.ts", old: /"buyer question"/, now: /"buyer prompt"/ },
];
const FLOOR = 4;

test("census: the scan surfaces say prompts, not the boards' questions (R127)", () => {
  assert.ok(SURFACES.length >= FLOOR, `${SURFACES.length} surfaces, floor ${FLOOR}`);
  for (const s of SURFACES) {
    const src = readFileSync(join(process.cwd(), s.file), "utf8");
    assert.ok(!s.old.test(src), `${s.where} (${s.file}) says questions again`);
    assert.ok(s.now.test(src), `${s.where} (${s.file}) no longer carries the prompts line`);
  }
});

test("the result standfirst reads in prompts", () => {
  assert.equal(standfirst(5, 4), "5 buyer prompts, each put to 4 engines. Everything below is free.");
  // ScanCluster.dc.html's line, in figures, on a scan with a chosen keyword.
  assert.equal(standfirst(5, 4, true), "5 buyer prompts about one Google keyword, each put to 4 engines. Everything below is free.");
});

test("3 Nov 2026: answers short of prompts times engines say why, Google's as no AI Overview", () => {
  const e = (engine: string, label: string, asked: number, answered: number) => ({ engine, label, asked, answered });
  assert.equal(answerGap([e("chatgpt", "ChatGPT", 4, 4), e("google_aio", "Google AI Overviews", 4, 4)]), "");
  const gap = answerGap([e("google_aio", "Google AI Overviews", 4, 3), e("chatgpt", "ChatGPT", 4, 4), e("gemini", "Gemini", 4, 4), e("perplexity", "Perplexity", 4, 4)]);
  assert.equal(gap, "15 answers came back: Google showed no AI Overview for 1 prompt.");
  assert.equal(standfirst(4, 4, false, gap), "4 buyer prompts, each put to 4 engines. 15 answers came back: Google showed no AI Overview for 1 prompt. Everything below is free.");
  assert.match(answerGap([e("google_aio", "Google AI Overviews", 4, 3), e("gemini", "Gemini", 4, 2)]), /: Google showed no AI Overview for 1 prompt and Gemini gave no answer to 2 prompts\.$/);
});
