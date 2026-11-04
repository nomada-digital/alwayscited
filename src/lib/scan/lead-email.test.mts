import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";

import { checkLeadEmail, cleanLeadName, gateApplies, isInternalDomain } from "./lead-email.ts";
import { EXTERNAL_PARTNERS } from "./handoff.ts";
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

test("4 Nov 2026: an outside partner's scan confirms with no email; any other ref is still gated", () => {
  const scan = (ref: string | null, extra: Partial<{ team: boolean; domain: string }> = {}) => ({ team: false, domain: "prospect.example", ref, ...extra });
  assert.equal(gateApplies(scan("thelab")), false, "The LAB's page: no gate");
  for (const ref of [null, "x", "thelab-x", "THELAB", "nomada", "nomada-blog-post", "blog-some-post"]) {
    assert.equal(gateApplies(scan(ref)), true, `ref ${ref} is not an outside partner, so the gate stands`);
  }
  assert.equal(gateApplies(scan(null, { team: true })), false, "a team browser");
  assert.equal(gateApplies(scan(null, { domain: "nomadadigital.co.uk" })), false, "our own domain");
  assert.deepEqual([...EXTERNAL_PARTNERS], ["thelab"]);
  // The route enforces with the same rule the screen shows, and the confirm route refuses only when it applies.
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const route = read("../../app/api/scan/[token]/confirm/route.ts");
  assert.match(route, /const gated = gateApplies\(\{ team, domain: String\(scan\.domain \?\? ""\), ref: scan\.ref as string \| null \}\);/);
  assert.match(route, /\} else if \(gated\) \{\s*return Response\.json\(\{ error: "email_required"/);
  assert.match(read("../../components/scan/ScanFlow.tsx"), /gate=\{gateApplies\(\{ team: Boolean\(p\.team\), domain: p\.domain, ref: p\.partner \?\? null \}\)\}/);
});
