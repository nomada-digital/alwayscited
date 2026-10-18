import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LOGIN_SENT,
  LOGIN_TTL_MS,
  SESSION_TTL_MS,
  hashToken,
  isTokenShape,
  mayRecordStranger,
  mayRequestLink,
  newToken,
  sessionCookie,
  tokenUsable,
} from "./session.ts";

/** T3's login rules (BRIEF decision 2, 29 Sep 2026), run. */

test("a token is 32 random bytes and only its sha256 is stored", () => {
  const t = newToken();
  assert.ok(isTokenShape(t));
  assert.notEqual(newToken(), t);
  assert.equal(hashToken(t).length, 64);
  assert.notEqual(hashToken(t), t);
  assert.equal(hashToken(t), hashToken(t));
  assert.ok(!isTokenShape("abc"));
  assert.ok(!isTokenShape(undefined));
});

test("a link works once, for 15 minutes", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const fresh = { expires_at: new Date(now + LOGIN_TTL_MS).toISOString(), used_at: null };
  assert.ok(tokenUsable(fresh, now));
  assert.ok(!tokenUsable({ ...fresh, used_at: "2026-09-29T12:01:00Z" }, now), "a second use fails");
  assert.ok(!tokenUsable(fresh, now + LOGIN_TTL_MS + 1), "an expired link fails");
  assert.ok(!tokenUsable(null, now));
});

test("link requests are capped at 5 per email and 20 per IP an hour", () => {
  assert.ok(mayRequestLink(4, 19));
  assert.ok(!mayRequestLink(5, 0));
  assert.ok(!mayRequestLink(0, 20));
  // 18 Oct 2026: the burst cap - a third request from one IP inside a minute is not sent.
  assert.ok(mayRequestLink(0, 1, 1));
  assert.ok(!mayRequestLink(0, 2, 2));
  assert.ok(mayRecordStranger(9));
  assert.ok(!mayRecordStranger(10));
});

test("the session cookie is httpOnly, Secure, Lax and lasts 30 days", () => {
  const c = sessionCookie("x");
  assert.equal(c.httpOnly, true);
  assert.equal(c.secure, true);
  assert.equal(c.sameSite, "lax");
  assert.equal(c.maxAge, SESSION_TTL_MS / 1000);
  assert.equal(SESSION_TTL_MS, 30 * 86_400_000);
});

test("the login page never discloses membership", () => {
  assert.equal(LOGIN_SENT, "If that address has access, we've sent a link.");
});
