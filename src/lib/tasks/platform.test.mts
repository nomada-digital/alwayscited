import assert from "node:assert/strict";
import test from "node:test";

import { ACCESS, DATA_EMAIL, GOOGLE_ACCESS, PLATFORMS, detectPlatform, isPlatform } from "./platform.ts";

test("each builder is recognised from its own fingerprints", () => {
  assert.equal(detectPlatform('<script src="https://cdn.shopify.com/s/x.js">'), "shopify");
  assert.equal(detectPlatform('<link href="/wp-content/themes/a/style.css">'), "wordpress");
  assert.equal(detectPlatform('<html data-wf-site="abc" data-wf-page="d">'), "webflow");
  assert.equal(detectPlatform('<img src="https://images.squarespace-cdn.com/a.jpg">'), "squarespace");
  assert.equal(detectPlatform('<img src="https://static.wixstatic.com/a.jpg">'), "wix");
  assert.equal(detectPlatform('<img src="https://framerusercontent.com/a.png">'), "framer");
  assert.equal(detectPlatform("<html><body>hi</body></html>", { server: "Vercel" }), "custom");
  assert.equal(detectPlatform("<html></html>", { "x-wix-request-id": "1" }), "wix");
  assert.equal(detectPlatform("<html></html>", { "x-shopid": "1" }), "shopify");
});

test("every platform has a way to give access, and it names our address where an invitation is sent", () => {
  for (const p of PLATFORMS) {
    assert.ok(ACCESS[p].steps.length >= 2 && ACCESS[p].label.length > 5, p);
    assert.ok(!/password/i.test(ACCESS[p].steps.join(" ")) || /never/i.test(ACCESS[p].steps.join(" ")), `${p} must not ask for a password`);
  }
  for (const p of ["wordpress", "webflow", "squarespace", "wix", "framer", "custom"] as const) assert.ok(ACCESS[p].steps.join(" ").includes(DATA_EMAIL), p);
  assert.ok(GOOGLE_ACCESS.gsc.join(" ").includes(DATA_EMAIL) && GOOGLE_ACCESS.ga4.join(" ").includes(DATA_EMAIL));
  assert.equal(isPlatform("shopify"), true);
  assert.equal(isPlatform("drupal"), false);
});
