import assert from "node:assert/strict";
import { test } from "node:test";

import { HANDOFF_WINDOW_S, signHandoff, verifyHandoff } from "./handoff.ts";

const SECRET = "test-secret-test-secret-test-secret-0123456789"; // a throwaway for the tests, never a real one
const NOW = 1_800_000_000_000;
const exp = NOW / 1000 + 30;
const good = () => ({ slug: "mortalentboutique-com", by: "kev@nomadadigital.co.uk", exp: String(exp), sig: signHandoff(SECRET, "mortalentboutique-com", "kev@nomadadigital.co.uk", exp) });

test("a fresh, correctly signed handoff for a Nomada address is accepted", () => {
  assert.deepEqual(verifyHandoff(SECRET, good(), NOW), { ok: true, slug: "mortalentboutique-com", by: "kev@nomadadigital.co.uk" });
});

test("it is refused with no secret configured, whatever is sent", () => {
  assert.deepEqual(verifyHandoff(undefined, good(), NOW), { ok: false, reason: "not_configured" });
  assert.deepEqual(verifyHandoff("short", good(), NOW), { ok: false, reason: "not_configured" });
});

test("any field changed after signing breaks the signature", () => {
  assert.deepEqual(verifyHandoff(SECRET, { ...good(), slug: "common-agency" }, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifyHandoff(SECRET, { ...good(), by: "luke@nomadadigital.co.uk" }, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifyHandoff("another-secret-another-secret-another-0123456789", good(), NOW), { ok: false, reason: "bad_signature" });
});

test("it dies after its window, and cannot be signed for later", () => {
  assert.deepEqual(verifyHandoff(SECRET, good(), NOW + 31_000), { ok: false, reason: "expired" });
  const far = NOW / 1000 + HANDOFF_WINDOW_S + 5;
  assert.deepEqual(verifyHandoff(SECRET, { slug: "a-b", by: "kev@nomadadigital.co.uk", exp: String(far), sig: signHandoff(SECRET, "a-b", "kev@nomadadigital.co.uk", far) }, NOW), { ok: false, reason: "expired" });
});

test("a correctly signed address outside Nomada is still not staff", () => {
  const e = NOW / 1000 + 10;
  assert.deepEqual(verifyHandoff(SECRET, { slug: "a-b", by: "x@example.com", exp: String(e), sig: signHandoff(SECRET, "a-b", "x@example.com", e) }, NOW), { ok: false, reason: "not_staff" });
});

test("malformed input is a bad request", () => {
  assert.deepEqual(verifyHandoff(SECRET, { ...good(), sig: "zz" }, NOW), { ok: false, reason: "bad_request" });
  assert.deepEqual(verifyHandoff(SECRET, { ...good(), slug: "../x" }, NOW), { ok: false, reason: "bad_request" });
  assert.deepEqual(verifyHandoff(SECRET, { ...good(), exp: "soon" }, NOW), { ok: false, reason: "bad_request" });
});
