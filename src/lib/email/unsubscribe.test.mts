import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { signUnsubscribe, UNSUBSCRIBE_TOKEN_MAX, unsubscribeLink, verifyUnsubscribe } from "./unsubscribe.ts";

/**
 * #7's one-click unsubscribe token (brief item 2e, 18 Oct 2026). A made-up
 * secret and member; the real secret is read by the sender and the route,
 * never by this module and never printed.
 */

const SECRET = "test-secret-that-is-long-enough-0001";
const CLIENT = "6f1c2b9e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";

test("a token signed for a member and client verifies to exactly them, the address lower-cased", () => {
  const t = signUnsubscribe(SECRET, { email: " Owner@Example.com ", clientId: CLIENT })!;
  assert.ok(t.length < UNSUBSCRIBE_TOKEN_MAX);
  assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/, "url-safe");
  assert.deepEqual(verifyUnsubscribe(SECRET, t), { email: "owner@example.com", clientId: CLIENT });
});

test("a token is refused when anything about it is wrong", () => {
  const t = signUnsubscribe(SECRET, { email: "owner@example.com", clientId: CLIENT })!;
  const [payload, sig] = t.split(".") as [string, string];
  assert.equal(verifyUnsubscribe("another-secret-that-is-long-enough", t), null, "another secret");
  assert.equal(verifyUnsubscribe(SECRET, `${payload}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`), null, "a changed signature");
  const forged = Buffer.from(JSON.stringify({ e: "someone@else.com", c: CLIENT }), "utf8").toString("base64url");
  assert.equal(verifyUnsubscribe(SECRET, `${forged}.${sig}`), null, "another address under the same signature");
  for (const bad of [null, undefined, "", "abc", `${payload}.`, `.${sig}`, "x".repeat(UNSUBSCRIBE_TOKEN_MAX + 1)]) assert.equal(verifyUnsubscribe(SECRET, bad), null, String(bad));
  // A short or missing secret signs nothing and verifies nothing, so an unset variable cannot make every token good.
  assert.equal(signUnsubscribe("", { email: "owner@example.com", clientId: CLIENT }), null);
  assert.equal(verifyUnsubscribe("", t), null);
  assert.equal(verifyUnsubscribe("short", t), null);
});

test("a token naming something that is not a client id or an address is refused even when signed", () => {
  for (const claim of [
    { email: "owner@example.com", clientId: "not-a-uuid" },
    { email: "not an address", clientId: CLIENT },
  ]) {
    const t = signUnsubscribe(SECRET, claim)!;
    assert.equal(verifyUnsubscribe(SECRET, t), null, JSON.stringify(claim));
  }
});

test("the link goes to the route under /api, on the origin given, the token encoded", () => {
  assert.equal(unsubscribeLink("https://dashboards.alwayscited.com/", "a.b"), "https://dashboards.alwayscited.com/api/dash/unsubscribe?t=a.b");
  assert.ok(fs.existsSync(new URL("../../app/api/dash/unsubscribe/route.ts", import.meta.url)), "the route the link points at");
});

test("the module reads no environment and sends nothing; the route records only on POST", () => {
  const src = fs.readFileSync(new URL("./unsubscribe.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /process\.env|resend|fetch\(/i);
  const route = fs.readFileSync(new URL("../../app/api/dash/unsubscribe/route.ts", import.meta.url), "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(get, /\.update\(|\.insert\(|\.delete\(/, "a mail scanner opening the link changes nothing");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.match(post, /verifyUnsubscribe\(SECRET\(\), token\)[\s\S]*\.update\(\{ this_week_opt_out: true \}\)\s*\.eq\("account_id", client\.account_id as string\)\s*\.eq\("email", claim\.email\)/, "verified first, then only that member on that client's account");
  assert.doesNotMatch(route, /console\.[a-z]+\([^)]*SECRET/, "the secret is never logged");
});
