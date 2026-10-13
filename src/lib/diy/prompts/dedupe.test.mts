/**
 * isDuplicatePrompt (13 Oct 2026, DIY P2; spec 10 section 6.7, Nomada's
 * opportunities.py 566-574: a new prompt duplicates a live one when 75% of its
 * core words occur in it). The examples are the fixture's own prompts and the
 * ones the designs use. Illustrative: every brand shown is made up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DUPLICATE_SHARE, coreShare, coreWords, duplicateOf, isDuplicatePrompt } from "./dedupe.ts";

/** The fixture's first cluster, "accounting app for freelancers" (src/lib/tracking/fixture.json). */
const C1 = [
  "What's the best accounting app for freelancers?",
  "Which accounting app for freelancers do accountants recommend?",
  "Which accounting app do freelance designers and developers recommend?",
  "Which accounting app helps freelancers get paid faster?",
  "What's a good alternative to Ledgerline for freelancers?",
];

test("core words: the stop list, years and one-letter tokens out; a plural s off; once each", () => {
  assert.deepEqual(coreWords("What's the best accounting app for freelancers?"), ["accounting", "app", "freelancer"]);
  assert.deepEqual(coreWords("Top 10 CRM tools in the UK 2026"), ["10", "crm", "tool"]);
  assert.deepEqual(coreWords("best business software for business owners"), ["business", "software", "owner"], "business keeps its ss");
  assert.deepEqual(coreWords("best in the uk"), []);
});

test("the placement examples: a title the cluster already asks is a duplicate; a new angle is not", () => {
  assert.equal(isDuplicatePrompt("best accounting apps for freelancers", C1), true, "the cluster's own category prompt");
  assert.equal(duplicateOf("best accounting apps for freelancers", C1.map((text, i) => ({ id: `q1-${i + 1}`, text })))?.id, "q1-1", "the row is handed back, to link");
  assert.equal(isDuplicatePrompt("best accounting apps for small businesses", C1), false, "2 of 4 core words");
  assert.equal(isDuplicatePrompt("best bookkeeping tools for freelancers", C1), false);
  assert.equal(isDuplicatePrompt("best accounting software to switch to", C1), false);
});

test("the designs' examples", () => {
  assert.equal(isDuplicatePrompt("best bookkeeping software for sole traders", ["Which bookkeeping software is best for sole traders?"]), true);
  assert.equal(isDuplicatePrompt("best invoicing apps for freelancers in the UK", ["best invoicing apps for freelancers"]), true, "the market is a stop word");
  assert.equal(isDuplicatePrompt("brightly vs ledgerly", ["Is Brightly or Ledgerly better for freelancers?"]), true, "vs is a connective, so brightly and ledgerly are the core words");
  assert.equal(isDuplicatePrompt("best crm", ["Which CRM do agencies recommend?"]), true, "the share is of the new prompt's words");
  assert.equal(isDuplicatePrompt("best payroll and accounting software for restaurants", C1), false);
});

test("the line is 75%: 3 of 4 is a duplicate, 2 of 3 is not", () => {
  assert.equal(DUPLICATE_SHARE, 0.75);
  assert.equal(coreShare("alpha beta gamma delta", "alpha beta gamma"), 0.75);
  assert.equal(isDuplicatePrompt("alpha beta gamma delta", ["alpha beta gamma"]), true);
  assert.equal(isDuplicatePrompt("alpha beta gamma", ["alpha beta zeta"]), false);
});

test("nothing to compare is no duplicate, and an empty cluster has none", () => {
  assert.equal(isDuplicatePrompt("best in the uk", C1), false);
  assert.equal(isDuplicatePrompt("best accounting apps for freelancers", []), false);
  assert.equal(coreShare("", "anything"), 0);
});

test("case, marks and punctuation do not matter", () => {
  assert.equal(isDuplicatePrompt("BEST CAFÉ POS SYSTEMS", ["best cafe pos systems?"]), true);
});
