import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { NEXT_MAX, loginHref, safeNext } from "./next-path.ts";

/** R164 (1 Oct 2026, danny.md line 173): logged-out bookmarks return to the page, and nowhere else. */

test("a path inside the dashboard is kept", () => {
  for (const ok of ["/app/tallyroo", "/app/tallyroo/clusters", "/app/tallyroo/clusters/c1?range=90d", "/app/x/settings?tab=team"]) {
    assert.equal(safeNext(ok), ok);
  }
});

test("hostile next values are ignored", () => {
  for (const bad of [
    "//example.com",
    "//example.com/app/",
    "/app//example.com",
    "/\\example.com",
    "/app/\\example.com",
    "\\\\example.com",
    "https://example.com/app/x",
    "/app/x?u=https://example.com",
    "javascript:alert(1)",
    "/app",
    "/apple",
    "/admin/tracking",
    "app/x",
    "/app/x\nLocation: //example.com",
    "/app/login",
    "/app/login?next=/app/x",
    "/app/auth?token=x",
    "/app/" + "a".repeat(NEXT_MAX),
    "",
    null,
    undefined,
    ["/app/x"],
  ]) {
    assert.equal(safeNext(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("loginHref carries the page and its query, encoded, and drops an unsafe one", () => {
  assert.equal(loginHref("/app/tallyroo/clusters"), "/app/login?next=%2Fapp%2Ftallyroo%2Fclusters");
  assert.equal(loginHref("/app/t/named", { range: "90d", e: ["a", "b"] }), `/app/login?next=${encodeURIComponent("/app/t/named?range=90d&e=a&e=b")}`);
  assert.equal(loginHref("//example.com"), "/app/login");
});

// 18 Oct 2026, brief 2d: "every /app/[client] page redirects signed-out visitors through loginHref" retired with /app.
// It walked src/app/app/[client] (floor 8 pages), which is gone; every /app address 308s to the dashboards host, whose
// pages refuse a signed-out visitor through pageData (client-pages.test.mts holds that). loginHref's own tests above
// still hold, for the /api/app routes that build it.
test("next is re-validated on every hop", () => {
  const read = (p: string) => readFileSync(join(import.meta.dirname, "../../app", p), "utf8");
  // 18 Oct 2026, brief 2d: the two page hops, /app/login and /app/auth, retired with /app (every /app address 308s to
  // the dashboards host); the two route hops remain and still re-validate.
  // 22 Oct 2026, the cut-over: the login route's next is the dashboards host's (dashNext, an old /app next mapped).
  assert.match(read("api/app/login/route.ts"), /const next = dashNext\(body\.next\)/);
  assert.match(read("api/app/auth/route.ts"), /const next = safeNext\(form\?\.get\("next"\)\)/);
});
