import assert from "node:assert/strict";
import { test } from "node:test";

import { emailCatalogue, isTestRecipient, NOT_WRITTEN, testSubject, TRIGGERS } from "./catalogue.ts";
import { LIFECYCLE_EMAILS, previewSets, TRANSACTIONAL_EMAILS, transactionalPreviews } from "./lifecycle.ts";

/** The agency hub's Emails tab (26 Oct 2026): one entry per switch, every case /admin/emails draws, nothing sent. */

const PRICE = { us: 101, uk: 77 };
const all = emailCatalogue(PRICE);

test("every switch is listed once: the lifecycle emails, the transactional ones, then the ones not written yet", () => {
  assert.deepEqual(all.map((e) => e.name), [...LIFECYCLE_EMAILS, ...TRANSACTIONAL_EMAILS, ...NOT_WRITTEN]);
  for (const e of all) assert.equal(e.flag, `email_${e.name}_enabled`);
  for (const e of all) assert.ok(TRIGGERS[e.name].length > 20, `${e.name} says what sends it`);
});

test("a missing row is off for a lifecycle email and on for a transactional one, as lifecycle-flag.ts reads them", () => {
  for (const e of all) assert.equal(e.missingIs, e.kind === "transactional", e.name);
});

test("every case its flag covers is drawn, the same ones /admin/emails draws", () => {
  const life = previewSets(PRICE);
  const money = transactionalPreviews();
  for (const e of all.filter((x) => x.written)) {
    const want = (e.kind === "lifecycle" ? life[e.name as keyof typeof life] : money[e.name as keyof typeof money]).map((p) => p.label);
    assert.deepEqual(e.cases.map((c) => c.label), want, e.name);
    for (const c of e.cases) assert.ok(c.subject && c.html.includes("<") && c.text, `${e.name} (${c.label}) has a subject, HTML and text`);
  }
});

test("payment_failed has a switch row but no email, so it is shown as not written", () => {
  const pf = all.find((e) => e.name === "payment_failed")!;
  assert.equal(pf.written, false);
  assert.deepEqual(pf.cases, []);
  assert.ok(pf.note);
});

test("a test goes only to a Nomada address, marked as a test", () => {
  assert.ok(isTestRecipient("danny@nomadadigital.co.uk"));
  for (const bad of ["danny@gmail.com", "x@nomadadigital.co.uk.evil.com", "a@b@nomadadigital.co.uk", "", null, ["danny@nomadadigital.co.uk"]]) {
    assert.equal(isTestRecipient(bad), false, String(bad));
  }
  assert.equal(testSubject("Welcome to alwayscited"), "[Test] Welcome to alwayscited");
});
