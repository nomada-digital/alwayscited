import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_FILL_MS, botCheck } from "./walkthrough-guard.ts";

const NOW = 1_800_000_000_000;

test("a person: nothing in the honeypot, and they took their time", () => {
  assert.equal(botCheck({ honeypot: "", t: NOW - 20_000 }, { json: true }, NOW), "ok");
  assert.equal(botCheck({ t: NOW - MIN_FILL_MS }, { json: true }, NOW), "ok");
  assert.equal(botCheck({ honeypot: "  ", t: String(NOW - 60_000) }, { json: true }, NOW), "ok");
  // Left open for days: still a person.
  assert.equal(botCheck({ t: NOW - 3 * 86_400_000 }, { json: true }, NOW), "ok");
});

test("a filled honeypot is a bot, whatever else it sent", () => {
  assert.equal(botCheck({ honeypot: "http://x.example", t: NOW - 60_000 }, { json: true }, NOW), "bot");
  assert.equal(botCheck({ honeypot: "x" }, { json: false }, NOW), "bot");
});

test("too fast, from the future, or not a number is a bot", () => {
  assert.equal(botCheck({ t: NOW - 400 }, { json: true }, NOW), "bot");
  assert.equal(botCheck({ t: NOW - MIN_FILL_MS + 1 }, { json: true }, NOW), "bot");
  assert.equal(botCheck({ t: NOW + 60_000 }, { json: true }, NOW), "bot");
  assert.equal(botCheck({ t: "soon" }, { json: true }, NOW), "bot");
});

test("no time at all: a JSON post is told to reload, a no-script form post passes on the honeypot alone", () => {
  assert.equal(botCheck({}, { json: true }, NOW), "reload");
  assert.equal(botCheck({ t: "" }, { json: true }, NOW), "reload");
  assert.equal(botCheck({}, { json: false }, NOW), "ok");
});
