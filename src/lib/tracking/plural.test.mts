import assert from "node:assert/strict";
import { test } from "node:test";

import { otherForm, pluralWord, singularWord } from "./plural.ts";

test("the head noun is pluralised (brief 2c's examples)", () => {
  assert.deepEqual(otherForm("b2b seo agency"), { keyword: "b2b seo agencies", form: "plural" });
  assert.deepEqual(otherForm("AI SEO agency"), { keyword: "AI SEO agencies", form: "plural" });
  assert.deepEqual(otherForm("accounting company"), { keyword: "accounting companies", form: "plural" });
  assert.deepEqual(otherForm("crm tool"), { keyword: "crm tools", form: "plural" });
  assert.deepEqual(otherForm("law firm"), { keyword: "law firms", form: "plural" });
  assert.deepEqual(otherForm("b2b search marketing agency"), { keyword: "b2b search marketing agencies", form: "plural" });
});

test("the head noun before a joining word is the one that changes", () => {
  assert.deepEqual(otherForm("seo agency for startups"), { keyword: "seo agencies for startups", form: "plural" });
  assert.deepEqual(otherForm("accountant in london"), { keyword: "accountants in london", form: "plural" });
});

test("an uncountable head noun offers nothing, so the option is hidden", () => {
  for (const k of ["accounting software", "business insurance", "asset finance", "payroll", "invoicing software for freelancers"]) assert.equal(otherForm(k), null, k);
});

test("a plural keyword offers its singular", () => {
  assert.deepEqual(otherForm("b2b seo agencies"), { keyword: "b2b seo agency", form: "singular" });
  assert.deepEqual(otherForm("law firms"), { keyword: "law firm", form: "singular" });
  assert.deepEqual(otherForm("crm tools for agencies"), { keyword: "crm tool for agencies", form: "singular" });
});

test("singular words ending in s are not read as plural", () => {
  for (const w of ["business", "glass", "status", "analysis", "logistics"]) assert.equal(singularWord(w), null, w);
  assert.equal(pluralWord("business"), "businesses");
  assert.equal(pluralWord("coach"), "coaches");
  assert.equal(pluralWord("day"), "days");
  assert.equal(pluralWord("person"), "people");
  assert.equal(singularWord("people"), "person");
  assert.equal(pluralWord("shelf"), "shelves");
});

test("blank input offers nothing", () => {
  assert.equal(otherForm("   "), null);
});
