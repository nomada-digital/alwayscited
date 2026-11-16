import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { REDIRECT_URI, SCOPES, authUrl, grantedSearchConsole, idTokenEmail, open, readState, safeBack, seal, signState, tokenKey } from "./gsc-oauth.ts";

const key = randomBytes(32);

test("only openid, email and read-only Search Console; the registered redirect", () => {
  assert.deepEqual(SCOPES, ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"]);
  assert.equal(REDIRECT_URI, "https://dashboards.alwayscited.com/api/google/callback");
  const u = new URL(authUrl("cid", "st"));
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(u.searchParams.get("scope"), SCOPES.join(" "));
});

test("the key must be 32 bytes", () => {
  assert.equal(tokenKey(undefined), null);
  assert.equal(tokenKey(Buffer.alloc(16).toString("base64")), null);
  assert.ok(tokenKey(key.toString("base64")));
});

test("a sealed token opens with its key and no other; tampering fails", () => {
  const s = seal("1//refresh-token", key);
  assert.equal(open(s, key), "1//refresh-token");
  assert.equal(open(s, randomBytes(32)), null);
  assert.equal(open(s.slice(0, -2) + "AA", key), null);
});

test("the state holds only with its signature, in date, from the same browser", () => {
  const st = { slug: "volunteero-org", by: "x@y.com", staff: false, back: "/volunteero-org/integrations", nonce: "n1", exp: 2000 };
  const raw = signState(st, key);
  assert.deepEqual(readState(raw, key, "n1", 1000), st);
  assert.equal(readState(raw, key, "n2", 1000), null, "another browser's nonce");
  assert.equal(readState(raw, key, "n1", 3000), null, "expired");
  assert.equal(readState(raw, randomBytes(32), "n1", 1000), null, "another key");
  assert.equal(readState(raw.replace(/^./, "x"), key, "n1", 1000), null, "tampered");
});

test("back is a page of this client on the dashboards host, never another site", () => {
  assert.equal(safeBack("/volunteero-org/integrations", "volunteero-org"), "/volunteero-org/integrations");
  assert.equal(safeBack(`/view/${"a".repeat(64)}/volunteero-org/settings`, "volunteero-org"), `/view/${"a".repeat(64)}/volunteero-org/settings`);
  assert.equal(safeBack("https://evil.example/volunteero-org", "volunteero-org"), "/volunteero-org/integrations");
  assert.equal(safeBack("//evil.example/x", "volunteero-org"), "/volunteero-org/integrations");
});

test("the granted scope must include Search Console; the id token's email is read", () => {
  assert.equal(grantedSearchConsole("openid email https://www.googleapis.com/auth/webmasters.readonly"), true);
  assert.equal(grantedSearchConsole("openid email"), false);
  const t = ["x", Buffer.from(JSON.stringify({ email: "Danny@Nomadadigital.co.uk", email_verified: true })).toString("base64url"), "y"].join(".");
  assert.equal(idTokenEmail(t), "danny@nomadadigital.co.uk");
  assert.equal(idTokenEmail("junk"), null);
});
