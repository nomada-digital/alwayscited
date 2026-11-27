import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const lib = readFileSync(new URL("./retry-partial.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/cron/track-retry/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };

test("the retry pass takes only today's partial and failed runs", () => {
  assert.match(lib, /\.eq\("run_date", day\)\.in\("status", \["partial", "failed"\]\)/);
  assert.match(lib, /selectAll</);
});

test("a run that has been re-run already today is left alone, and the ask goes through requestRerun", () => {
  assert.match(lib, /if \(rerunMarker\(r\.step_ms as never\)\) \{ out\.skipped\.push/);
  assert.ok(lib.indexOf("requestRerun(") > lib.indexOf("rerunMarker("));
  assert.ok(lib.indexOf("dispatchTrackingRun(id)") > lib.indexOf("requestRerun("));
});

test("the route needs CRON_SECRET and is scheduled after the 05:00 pass", () => {
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /status: 503/);
  assert.match(route, /constantTimeEqual/);
  assert.match(route, /status: 401/);
  const c = vercel.crons.find((x) => x.path === "/api/cron/track-retry");
  assert.ok(c, "declared in vercel.json");
  assert.equal(c.schedule, "30 10 * * *");
});

test("the preview QA sign-in is gated on a preview, on the admin Basic auth, and on a staff member", () => {
  const r = readFileSync(new URL("../../app/admin/qa-login/route.ts", import.meta.url), "utf8");
  assert.equal((r.match(/if \(!isPreviewDeploy\(\)\) return gone\(\)/g) ?? []).length, 2, "GET and POST both 404 off a preview");
  assert.equal((r.match(/refuseUnlessAdmin\(\)/g) ?? []).length, 2);
  assert.match(r, /isStaffEmail\(email\)/);
  assert.match(r, /\.is\("removed_at", null\)/);
});
