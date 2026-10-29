import assert from "node:assert/strict";
import { test } from "node:test";

import { answersNaming } from "./answers-naming.ts";

// The gracefoods.com scan, 8 Oct 2026: Walkerswood was tallied at 3, all three in one Perplexity answer.
test("a brand named three times in one answer counts once", () => {
  const prose = [
    "Walkerswood jerk seasoning is the bestseller. Stock Walkerswood sauces too; Walkerswood is trusted.",
    "Try Grace and LASCO.",
  ];
  assert.equal(answersNaming(prose, ["Walkerswood"], 3), 1);
});

test("every spelling the extractor saw is matched", () => {
  const prose = ["D&G sodas sell well.", "D & G is a staple.", "Nothing here."];
  assert.equal(answersNaming(prose, ["D&G", "D & G"], 2), 2);
});

test("found by the extractor but not by the matcher counts once, never zero and never without answers", () => {
  assert.equal(answersNaming(["Tingg is spelled oddly here."], ["Ting"], 2), 1);
  assert.equal(answersNaming([], ["Ting"], 2), 0);
  assert.equal(answersNaming(["Nothing."], ["Ting"], 0), 0);
});

test("a name inside another word is not an answer naming it", () => {
  assert.equal(answersNaming(["Everything is starting to sell.", "Ting is a grapefruit soda."], ["Ting"], 1), 1);
});
