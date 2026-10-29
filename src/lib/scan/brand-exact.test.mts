import assert from "node:assert/strict";
import { test } from "node:test";

import { namesExactly } from "./brand-name.ts";
import { namesBrandIn } from "../tracking/limits.ts";

// A brand that is also an ordinary word (29 Oct 2026): counted only as written once the client is set to exact case.
const prose = {
  named: "Agencies to consider: COMMON, a York studio and Official Craft Partner.",
  domain: "See common.agency for their Craft CMS work.",
};

test("an exact-case brand ignores the ordinary word, in any case, and counts the wordmark", () => {
  assert.equal(namesExactly("A common mistake. Common pitfalls.", "COMMON"), false);
  assert.equal(namesExactly(prose.named, "COMMON"), true);
  assert.equal(namesExactly("COMMONS are different", "COMMON"), false, "a longer word is not the brand");
  assert.equal(namesExactly("x", "C"), false, "a one-letter brand never counts");
});

test("the subject with exact case: wordmark and domain alias count, the ordinary word does not", () => {
  const s = { brand: "COMMON", domain: "common.agency", aliases: ["common.agency"], exactCase: true };
  assert.equal(namesBrandIn("A common mistake. Common pitfalls include plugins.", s), false);
  assert.equal(namesBrandIn(prose.named, s), true);
  assert.equal(namesBrandIn(prose.domain, s), true);
});

test("without exact case nothing changes: the default matcher still reads every case", () => {
  assert.equal(namesBrandIn("a common mistake", { brand: "COMMON", domain: "common.agency" }), true, "why the switch exists");
  assert.equal(namesBrandIn("We bought from Asos.", { brand: "ASOS", domain: "asos.com" }), true);
});
