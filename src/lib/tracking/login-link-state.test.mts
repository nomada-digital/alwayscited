import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FIXTURE_LINKS, fixtureLinkState, linkState } from "./login-link-state.ts";

/** R163 (1 Oct 2026, danny.md line 172): what /app/auth reads off a link before anything spends it. */

const now = new Date("2026-10-01T12:00:00Z");
const email = "owner@example.com";

test("an unused, unexpired link is fresh; used or expired is spent; no row is unknown", () => {
  assert.deepEqual(linkState({ email, used_at: null, expires_at: "2026-10-01T12:10:00Z" }, now), { state: "fresh", email });
  assert.deepEqual(linkState({ email, used_at: "2026-10-01T11:59:00Z", expires_at: "2026-10-01T12:10:00Z" }, now), { state: "spent", email });
  assert.deepEqual(linkState({ email, used_at: null, expires_at: "2026-10-01T12:00:00Z" }, now), { state: "spent", email }, "the boundary is expired");
  assert.deepEqual(linkState(null, now), { state: "unknown" });
});

test("the fixture's links cover fresh, spent and expired", () => {
  assert.equal(fixtureLinkState("a".repeat(64), email).state, "fresh");
  assert.equal(fixtureLinkState(FIXTURE_LINKS.spent, email).state, "spent");
  assert.equal(fixtureLinkState(FIXTURE_LINKS.expired, email).state, "spent");
});

test("the GET only reads the token; the POST alone claims it", () => {
  const read = readFileSync(join(import.meta.dirname, "login-link.ts"), "utf8");
  assert.ok(!/\.update\(|\.insert\(|\.delete\(|\.upsert\(/.test(read), "the link's GET read writes");
  // 18 Oct 2026, brief 2d: /app/auth (its form, AutoSubmit and the failed guard) retired with /app; every /app address
  // 308s to the dashboards host. The rule holds there: the page a link opens writes nothing and submits nothing by
  // itself - a button posts the token - and the route spends it with a compare-and-swap, failing back with failed=1.
  const page = readFileSync(join(import.meta.dirname, "../../app/dashboards/auth/page.tsx"), "utf8");
  assert.match(page, /<form action="\/api\/dash\/auth" method="post">/, "the token is still spent by a POST");
  assert.match(page, /<button type="submit"/, "a person presses it");
  assert.ok(!/AutoSubmit|requestSubmit|\.submit\(|\.from\(/.test(page), "the page submits itself or reads the database on GET");
  const route = readFileSync(join(import.meta.dirname, "../../app/api/dash/auth/route.ts"), "utf8");
  assert.match(route, /\.is\("used_at", null\)/, "the claim is still a compare-and-swap");
  assert.match(route, /failed=1/);
});
