import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// hub-auth.ts is server-only; its rule is read from the source and the route's use of it, as other door censuses are.
const ROOT = new URL("../../../", import.meta.url).pathname;
const auth = readFileSync(ROOT + "src/lib/agency/hub-auth.ts", "utf8");
const route = readFileSync(ROOT + "src/app/api/hub/agency/route.ts", "utf8");

test("the agency door checks its caller before it reads the body", () => {
  const check = route.indexOf("await hubAuthorised(req)");
  assert.ok(check > 0, "the route calls hubAuthorised");
  assert.ok(check < route.indexOf("await req.json()"), "before the body is read");
  assert.match(route, /if \(!\(await hubAuthorised\(req\)\)\) return Response\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\);/);
});

test("a key is accepted only as this project's own, or when Supabase's admin endpoint answers it 200", () => {
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /\/auth\/v1\/admin\/users/);
  assert.match(auth, /return res\.status === 200;/);
  assert.match(auth, /catch \{\s*return false;/, "an unreachable check refuses");
});
