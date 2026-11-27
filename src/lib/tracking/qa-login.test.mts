import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the preview QA sign-in is gated on a preview, on the admin Basic auth, and on a staff member", () => {
  const r = readFileSync(new URL("../../app/admin/qa-login/route.ts", import.meta.url), "utf8");
  assert.equal((r.match(/if \(!isPreviewDeploy\(\)\) return gone\(\)/g) ?? []).length, 2, "GET and POST both 404 off a preview");
  assert.equal((r.match(/refuseUnlessAdmin\(\)/g) ?? []).length, 2);
  assert.match(r, /isStaffEmail\(email\)/);
  assert.match(r, /\.is\("removed_at", null\)/);
});
