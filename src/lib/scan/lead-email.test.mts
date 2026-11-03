import assert from "node:assert/strict";
import { test } from "node:test";

import { checkLeadEmail, cleanLeadName, isInternalDomain } from "./lead-email.ts";
import { isTeamCookie, teamCookieValue, TEAM_COOKIE_DAYS } from "../team-cookie.ts";

test("3 Nov 2026: the report gate takes a work address, flags free mail and refuses a disposable inbox", () => {
  assert.deepEqual(checkLeadEmail(" Jo@Example.co.uk "), { ok: true, email: "jo@example.co.uk", domain: "example.co.uk", free: false, internal: false });
  const free = checkLeadEmail("someone@gmail.com");
  assert.ok(free.ok && free.free && !free.internal, "free mail is accepted and flagged");
  assert.equal(checkLeadEmail("x@mailinator.com").ok, false);
  assert.equal(checkLeadEmail("x@eu.yopmail.com").ok, false, "a subdomain of a disposable service is the service");
  for (const bad of ["", "not-an-email", "a@b", "a@@b.com", null, 42, "a".repeat(250) + "@x.com"]) assert.equal(checkLeadEmail(bad).ok, false, String(bad));
});

test("the team's own domains are internal, as an address or as the domain scanned", () => {
  const n = checkLeadEmail("luke@nomadadigital.co.uk");
  assert.ok(n.ok && n.internal);
  assert.ok(isInternalDomain("www.alwayscited.com"));
  assert.ok(!isInternalDomain("notalwayscited.com"), "a lookalike is not ours");
});

test("the first name is optional, trimmed and bounded", () => {
  assert.equal(cleanLeadName("  "), null);
  assert.equal(cleanLeadName("  Jo   Bloggs "), "Jo Bloggs");
  assert.equal(cleanLeadName("x".repeat(200))?.length, 80);
});

test("the team cookie verifies only when signed with this salt and inside its lifetime", () => {
  const before = process.env.IP_HASH_SALT;
  process.env.IP_HASH_SALT = "test-salt";
  try {
    const now = Date.UTC(2026, 10, 3);
    const v = teamCookieValue(now)!;
    assert.ok(isTeamCookie(v, now));
    assert.ok(!isTeamCookie(v.slice(0, -1) + (v.endsWith("0") ? "1" : "0"), now), "a changed signature fails");
    assert.ok(!isTeamCookie(v, now + (TEAM_COOKIE_DAYS + 1) * 86_400_000), "an expired cookie fails");
    assert.ok(!isTeamCookie("v1.1793664000000.deadbeef", now));
    process.env.IP_HASH_SALT = "another-salt";
    assert.ok(!isTeamCookie(v, now), "a cookie signed under another salt fails");
    delete process.env.IP_HASH_SALT;
    assert.equal(teamCookieValue(now), null, "no salt, no cookie: the gate stays on");
  } finally {
    if (before === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = before;
  }
});
