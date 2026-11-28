import assert from "node:assert/strict";
import test from "node:test";

import { GENERIC_PLACEHOLDER, brandTermsOf, derivePlaceholders, isHead, missingAudiences, pickHead, placeholderFor, readPlaceholders } from "./placeholder.ts";

const common = [
  { keyword: "craft cms agency york", volume: null },
  { keyword: "craft cms agency", volume: 90 },
  { keyword: "craft cms partners", volume: 40 },
  { keyword: "common agency craft cms", volume: 500 },
  { keyword: "craft cms developers uk", volume: 20 },
  { keyword: "best craft cms agencies in the uk right now", volume: 300 },
];
const brand = brandTermsOf("COMMON", "common.agency", []);

test("a head term is 2 to 4 words", () => {
  assert.equal(isHead("craft cms agency"), true);
  assert.equal(isHead("agency"), false);
  assert.equal(isHead("best craft cms agencies in the uk right now"), false);
  assert.equal(isHead("craft cms agency 2026"), false);
});

test("Common: the head term has real volume, no brand and no place", () => {
  const p = pickHead(common, { audience: "all", brandTerms: brand });
  assert.equal(p?.term, "craft cms agency", "not 'common agency craft cms' (the brand), not the york one (a place, no volume)");
  assert.equal(p?.volume, 90);
});

test("B2B takes a term with business intent; B2C takes a consumer one, and says nothing when there is none", () => {
  const d = derivePlaceholders(common, { brandTerms: brand });
  assert.equal(d.b2b?.term, "craft cms agency", "agency is a business-buyer word");
  assert.equal(d.b2c, undefined, "no consumer-phrased term among Common's keywords: generated once, later");
  assert.deepEqual(missingAudiences(d), ["b2c"]);
  const laver = derivePlaceholders([{ keyword: "caravans for sale ingoldmells", volume: 900 }, { keyword: "static caravans for sale", volume: 5400 }, { keyword: "holiday park homes", volume: 1000 }, { keyword: "laver leisure parks", volume: 70 }], { brandTerms: brandTermsOf("Laver Leisure", "laverleisure.co.uk", []) });
  assert.equal(laver.all?.term, "static caravans for sale");
  assert.equal(laver.b2c?.term, "static caravans for sale", "'for sale' reads as a consumer phrase");
  assert.equal(laver.b2b, undefined);
});

test("brand terms: the brand, its aliases and the domain's label, never a short word", () => {
  assert.deepEqual(brandTermsOf("MOR Talent Boutique", "mortalentboutique.com", ["MOR"]).sort(), ["mor", "mor talent boutique", "mortalentboutique"].sort());
  assert.equal(pickHead([{ keyword: "mor talent recruitment", volume: 900 }, { keyword: "talent recruitment", volume: 200 }], { audience: "all", brandTerms: brandTermsOf("MOR Talent Boutique", "mortalentboutique.com", ["MOR"]) })?.term, "talent recruitment");
});

test("the text follows the toggle, and the generic example is the last resort only", () => {
  const ph = readPlaceholders({ all: { term: "craft cms agency", source: "keywords", volume: 90 }, b2c: { term: "hire a craft cms developer", source: "generated", volume: 10 } });
  assert.equal(placeholderFor(ph, "b2c"), "hire a craft cms developer");
  assert.equal(placeholderFor(ph, "b2b"), "craft cms agency", "no B2B term of its own: the All term");
  assert.equal(placeholderFor({}, "all"), GENERIC_PLACEHOLDER);
  assert.deepEqual(readPlaceholders("junk"), {});
  assert.deepEqual(readPlaceholders({ all: { term: "x".repeat(70) } }), {});
});
