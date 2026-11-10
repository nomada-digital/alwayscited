import assert from "node:assert/strict";
import { test } from "node:test";
import { visibilityCc } from "./visibility-cc.ts";

test("the setting is a comma list, trimmed, lower case, once each", () => {
  assert.deepEqual(visibilityCc("member@example.com", " Danny@NomadaDigital.co.uk , kev@nomadadigital.co.uk,danny@nomadadigital.co.uk"),
    ["danny@nomadadigital.co.uk", "kev@nomadadigital.co.uk"]);
});

test("unset or empty copies nobody; junk is ignored", () => {
  assert.deepEqual(visibilityCc("member@example.com", undefined), []);
  assert.deepEqual(visibilityCc("member@example.com", ""), []);
  assert.deepEqual(visibilityCc("member@example.com", "off, not-an-address"), []);
});

test("nobody is copied on their own email", () => {
  assert.deepEqual(visibilityCc("Danny@nomadadigital.co.uk", "danny@nomadadigital.co.uk"), []);
});
