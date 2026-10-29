import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { requestFor } from "./dataforseo-request.ts";
import { MARKETS, isMarket, isScanMarket, marketPlace, marketShort } from "./domain.ts";
import { handoffMarket, partnerMayUse } from "./handoff.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

// Jamaica, 29 Oct 2026: a free-scan market for The LAB's page only.
test("JM is a scan market, never a site market", () => {
  assert.equal(isScanMarket("JM"), true);
  assert.equal(isMarket("JM"), false, "tracking, campaigns, walkthroughs and the DIY tools stay UK and US");
  assert.equal(MARKETS.JM.location_code, 2388);
  assert.equal(handoffMarket("jm"), "JM");
});

test("only a partner that offers Jamaica may run a scan in it", () => {
  assert.equal(partnerMayUse("thelab", "JM"), true);
  assert.equal(partnerMayUse("nomada", "JM"), false);
  assert.equal(partnerMayUse(null, "JM"), false);
  assert.equal(partnerMayUse(null, "US"), true);
  assert.equal(partnerMayUse("thelab", "UK"), true);
});

test("every engine is asked as a Jamaican searcher", () => {
  const google = (requestFor("google_aio", "q", "JM").body as { location_code: number }[])[0]!;
  const chatgpt = (requestFor("chatgpt", "q", "JM").body as { location_code: number }[])[0]!;
  const perplexity = (requestFor("perplexity", "q", "JM").body as { web_search_country_iso_code: string }[])[0]!;
  assert.equal(google.location_code, 2388);
  assert.equal(chatgpt.location_code, 2388);
  assert.equal(perplexity.web_search_country_iso_code, "JM");
});

test("the prompts name Jamaica, not the United States", () => {
  assert.equal(marketPlace("JM"), "Jamaica");
  assert.equal(marketPlace("US"), "the United States");
  assert.equal(marketShort("UK"), "the UK");
  const src = readFileSync(join(ROOT, "src/lib/scan/anthropic.ts"), "utf8");
  assert.doesNotMatch(src, /market === "UK" \? "the United Kingdom" : "the United States"/, "a two-way ternary would call Jamaica the US");
});

test("the three doors that take a market check the partner, and the start route reads the ref first", () => {
  const start = readFileSync(join(ROOT, "src/app/api/scan/start/route.ts"), "utf8");
  assert.ok(start.indexOf("const ref = scanRef(body.ref)") < start.indexOf("partnerMayUse(ref, handed)"));
  for (const door of ["confirm", "questions"]) {
    const src = readFileSync(join(ROOT, `src/app/api/scan/[token]/${door}/route.ts`), "utf8");
    assert.match(src, /partnerMayUse\(scan\.ref/, door);
  }
});
