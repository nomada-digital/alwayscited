import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BETA_CODE, BETA_COOKIE, betaAsk, betaCookieOn } from "./beta-flag.ts";
import { accessEmail } from "./connect.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the beta is on only for the exact code, and off for anything else", () => {
  assert.equal(betaAsk(BETA_CODE), "on");
  assert.equal(betaAsk("off"), "off");
  for (const v of [null, undefined, "", "AC28", "ac28 ", "1", "true"]) assert.equal(betaAsk(v as string | null), null, String(v));
  assert.equal(betaCookieOn(BETA_CODE), true);
  for (const v of [null, undefined, "", "off", "true", "ac27"]) assert.equal(betaCookieOn(v as string | null), false, String(v));
});

test("the cookie counts only for staff, a demo link or a view-as link, and any failure reads as off", () => {
  const b = src("./beta.ts");
  assert.match(b, /betaCookieOn\(\(await cookies\(\)\)\.get\(BETA_COOKIE\)\?\.value\)\) return false/);
  assert.match(b, /h\.get\(DEMO_HEADER\) \|\| h\.get\(VIEW_HEADER\)/);
  assert.match(b, /isStaffEmail\(await dashEmail\(\)\)/);
  assert.match(b, /catch \{\s*return false;/);
});

test("the proxy sets and clears the cookie only on the dashboards host or a preview, and drops the parameter", () => {
  const p = src("../../proxy.ts");
  assert.match(p, /if \(ask && \(isDashHost\(host\) \|\| isPreviewDeploy\(\)\)\)/);
  assert.match(p, /to\.searchParams\.delete\(BETA_PARAM\)/);
  assert.match(p, /httpOnly: true, secure: true, sameSite: "lax", path: "\/"/);
  assert.ok(!/domain:/.test(p.slice(p.indexOf("BETA_COOKIE, value"), p.indexOf("BETA_COOKIE, value") + 300)), "host-only");
  assert.equal(BETA_COOKIE, "ac_beta");
});

test("the access address is team@ until the beta is on, then data@", () => {
  assert.equal(accessEmail(false), "team@nomadadigital.co.uk");
  assert.equal(accessEmail(true), "data@nomadadigital.co.uk");
});

test("every merged-but-not-live change is behind betaOn: pages, model, labels", () => {
  assert.match(src("../../app/dashboards/[client]/integrations/page.tsx"), /if \(!beta\) \{/);
  assert.match(src("../../app/dashboards/[client]/google/page.tsx"), /beta \? await findKeywordsSetup/);
  assert.match(src("./page-data.ts"), /const beta = await betaOn\(\)/);
  const m = src("./model.ts");
  assert.match(m, /stale: !!opts\.beta &&/);
  assert.match(m, /place: !opts\.beta \? null/);
  assert.match(m, /listed: !opts\.beta \? \[\]/);
  assert.match(src("../../app/dashboards/dash.css"), /\.dash-grid\.beta-ac28 > \.connect-wrap/);
  assert.ok(!/^\.dash-grid > \.dash-card, \.dash-grid > \.dash-card \+ \.dash-card \{ margin-top: 0; \}/m.test(src("../../app/dashboards/dash.css")), "the global grid rule is gone");
});
