/**
 * promptForOpportunity per page type (13 Oct 2026, DIY P2; spec 10 section
 * 6.7). Illustrative: every brand and site shown is made up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_KEYWORD, TITLE_RULE_TYPES, WATCH_ONLY, promptForOpportunity, threadRequest } from "./opportunity-rule.ts";
import { TITLE_TOO_SHORT } from "./title-rule.ts";

const opp = (page_type: string | null, lens = "cited", keyword: string | null = "invoicing software") => ({ lens, page_type, keyword });

test("best_of, comparison, alternatives, article and how_to take the title rule", () => {
  assert.deepEqual(TITLE_RULE_TYPES, ["best_of", "comparison", "alternatives", "article", "how_to"]);
  assert.deepEqual(promptForOpportunity(opp("best_of"), { title: "The 9 best invoicing apps for freelancers (2026) - SmallBizStack" }, "US"), { ok: true, text: "best invoicing apps for freelancers" });
  assert.deepEqual(promptForOpportunity(opp("comparison"), { title: "Brightly vs Ledgerly: which is better?" }, "US"), { ok: true, text: "brightly vs ledgerly" });
  assert.deepEqual(promptForOpportunity(opp("alternatives"), { title: "The 5 Best Alternatives to Ledgerly (Free & Paid)" }, "US"), { ok: true, text: "best alternatives to ledgerly" });
  assert.deepEqual(promptForOpportunity(opp("article"), { title: "Invoicing software for consultants: what to look for" }, "US"), { ok: true, text: "best invoicing software for consultants" });
  assert.deepEqual(promptForOpportunity(opp("how_to"), { title: "How to choose invoicing software - Brightly" }, "US"), { ok: true, text: "how to choose invoicing software" });
});

test("no <title>: the first <h1> is the title", () => {
  assert.deepEqual(promptForOpportunity(opp("best_of"), { title: null, h1: "Top 7 invoicing apps for designers" }, "US"), { ok: true, text: "best invoicing apps for designers" });
  assert.deepEqual(promptForOpportunity(opp("best_of"), { title: "  ", h1: "Best" }, "US"), { ok: false, reason: TITLE_TOO_SHORT });
});

test("a thread that reads as a request is its asker's words; one that does not takes the title rule", () => {
  assert.deepEqual(promptForOpportunity(opp("thread", "threads"), { title: "Which invoicing app do you use as a freelance designer? : r/freelance" }, "US"), { ok: true, text: "Which invoicing app do you use as a freelance designer?" });
  assert.deepEqual(promptForOpportunity(opp("thread", "threads"), { title: "Best invoicing app for a two-person agency - Brightly Forum" }, "US"), { ok: true, text: "Best invoicing app for a two-person agency" });
  assert.deepEqual(promptForOpportunity(opp("thread", "threads"), { title: "Recommend me an invoicing tool that handles VAT" }, "UK"), { ok: true, text: "Recommend me an invoicing tool that handles VAT" });
  assert.deepEqual(promptForOpportunity(opp("thread", "threads"), { title: "Invoicing apps for designers - a thread" }, "US"), { ok: true, text: "best invoicing apps for designers" });
  assert.equal(threadRequest("Anyone tried Ledgerly"), null);
  assert.equal(threadRequest("Anyone tried Ledgerly?"), "Anyone tried Ledgerly?");
});

test("a review profile or a directory asks 'best <cluster keyword>'", () => {
  assert.deepEqual(promptForOpportunity(opp("review_profile", "profiles"), { title: "Ledgerly Reviews 2026 | ReviewSite" }, "US"), { ok: true, text: "best invoicing software" });
  assert.deepEqual(promptForOpportunity(opp("directory", "profiles", "Best Invoicing Software"), { title: "x" }, "US"), { ok: true, text: "best invoicing software" });
  assert.deepEqual(promptForOpportunity(opp("review_profile", "profiles", null), { title: "x" }, "US"), { ok: false, reason: NO_KEYWORD });
});

test("the link lenses are watched, never asked", () => {
  for (const lens of ["link_domain", "link_page", "mention"]) {
    assert.deepEqual(promptForOpportunity(opp("best_of", lens), { title: "The 9 best invoicing apps" }, "US"), { ok: false, reason: WATCH_ONLY }, lens);
  }
});

test("a page type the table does not name reads as an article", () => {
  assert.deepEqual(promptForOpportunity(opp(null), { title: "Invoicing apps for photographers" }, "US"), { ok: true, text: "best invoicing apps for photographers" });
});
