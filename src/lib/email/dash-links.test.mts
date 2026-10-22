import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DASH_HOST_DEFAULT, dashLink, dashNext, dashPathForApp } from "../dash/host.ts";
import { actionsUrl, billingUrl, dashboardUrl, LIFECYCLE_EMAILS, previewSets, setupUrl } from "./lifecycle.ts";

/**
 * The cut-over (22 Oct 2026): every link a customer email carries into the dashboard - sign-in, welcome, trial,
 * lifecycle, the weekly mail, invites, setup and first reading - opens dashboards.alwayscited.com, never /app,
 * which only 301s there now. Marketing links (contact, plans) stay on alwayscited.com but never under /app.
 */

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const DASH = `https://${DASH_HOST_DEFAULT}`;
const urlsIn = (s: string) => [...s.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, ""));

test("every lifecycle email's links into the dashboard resolve to the dashboards host", () => {
  const sets = previewSets({ us: 129, uk: 99 });
  let dashboardLinks = 0;
  for (const name of LIFECYCLE_EMAILS) {
    for (const p of sets[name] ?? []) {
      for (const raw of [...urlsIn(p.mail.text), ...urlsIn(p.mail.html)]) {
        const u = new URL(raw.replace(/&amp;/g, "&"));
        if (!/alwayscited\.com$/.test(u.hostname)) continue;
        assert.ok(!/^\/app(\/|$)/.test(u.pathname), `${name} / ${p.label}: no /app link (${raw})`);
        if (u.hostname === DASH_HOST_DEFAULT) dashboardLinks++;
        else assert.ok(u.hostname === "alwayscited.com" || u.hostname === "www.alwayscited.com", `${name}: an alwayscited host we know (${raw})`);
        // a link to the sign-in, the auth step or a client's pages is the dashboard's, so it must be on its host
        if (/^\/(login|auth)(\/|$)|^\/tallyroo-com(\/|$)/.test(u.pathname)) assert.equal(u.origin, DASH, `${name} / ${p.label}: ${raw}`);
      }
    }
  }
  assert.ok(dashboardLinks >= LIFECYCLE_EMAILS.length, `the emails do link into the dashboard (${dashboardLinks})`);
});

test("the link helpers every sender uses are on the dashboards host", () => {
  assert.equal(dashboardUrl("acme-com"), `${DASH}/acme-com`);
  assert.equal(setupUrl("acme-com"), `${DASH}/acme-com/setup`);
  assert.equal(billingUrl("acme-com"), `${DASH}/acme-com/plan#billing`);
  assert.equal(actionsUrl("acme-com"), `${DASH}/acme-com/plan`);
  assert.equal(dashLink("/login"), `${DASH}/login`);
});

/** The modules that build a link for a customer email, each read as source: none may build one through app-host. */
const SENDERS = [
  "src/lib/email/lifecycle.ts",
  "src/lib/email/lifecycle-sweep.ts",
  "src/lib/email/lifecycle-cron.ts",
  "src/lib/email/this-week-mail.ts",
  "src/lib/tracking/login-mail.ts",
  "src/lib/tracking/invite-mail.ts",
  "src/lib/tracking/setup-mail.ts",
  "src/lib/tracking/runner.ts",
  "src/lib/tracking/team.ts",
  "src/lib/checkout/signup.ts",
  "src/app/api/app/login/route.ts",
];
const ROOT = path.resolve(import.meta.dirname, "../../..");

test("no email sender builds a dashboard link with appUrl or /app", () => {
  for (const f of SENDERS) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/\bappUrl\(|\bappOrigin\(/.test(src), `${f} builds no link with appUrl / appOrigin`);
    assert.ok(!/["'`]\/app\/(auth|login)/.test(src), `${f} spells no /app sign-in path`);
  }
  const login = fs.readFileSync(path.join(ROOT, "src/app/api/app/login/route.ts"), "utf8");
  assert.match(login, /const link = `\$\{dashLinkOrigin\(req\.headers\.get\("host"\)\)\}\/auth\?token=\$\{token\}`/, "every sign-in link opens the dashboards host's /auth");
  const signup = fs.readFileSync(path.join(ROOT, "src/lib/checkout/signup.ts"), "utf8");
  assert.match(signup, /const link = `\$\{dashOrigin\(\)\}\/auth\?token=\$\{token\}`/, "the signup sign-in link opens the dashboards host's /auth");
});

test("the header's Log in and the help page's sign-in go to the dashboards host", () => {
  const layout = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /loginHref=\{`\$\{dashOrigin\(\)\}\/login`\}/);
  assert.match(fs.readFileSync(path.join(ROOT, "src/config/help.ts"), "utf8"), /const SIGN_IN = dashLink\("\/login"\);/);
});

test("an old /app address, and an old /app next, land on the matching dashboards page", () => {
  assert.equal(dashPathForApp("/login"), "/login");
  assert.equal(dashPathForApp("/auth"), "/auth");
  assert.equal(dashPathForApp("/acme-com/settings"), "/acme-com/settings");
  assert.equal(dashPathForApp("/acme-com/cited"), "/acme-com/ai");
  assert.equal(dashNext("/app/acme-com/clusters?prompt=x"), "/acme-com/clusters?prompt=x");
  assert.equal(dashNext("/acme-com/setup"), "/acme-com/setup");
  for (const bad of ["//evil.example", "https://evil.example/x", "/login", "/app/auth", "/acme\\x", "/", "", null, "/api/dash/x"]) {
    assert.equal(dashNext(bad), null, `refused: ${String(bad)}`);
  }
  const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
  assert.match(proxy, /new URL\(`\$\{dashPathForApp\(appBare\)\}\$\{search\}`, dashOrigin\(\)\), 301\)/, "/app/* answers a 301 with its query (next included)");
});

test("a sign-in keeps where it was going, through the link and the auth POST", () => {
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/dash/auth/route.ts"), "utf8");
  assert.match(route, /const next = dashNext\(form\?\.get\("next"\)\);/);
  assert.match(route, /back\(next \?\? "\/"\)/);
  const page = fs.readFileSync(path.join(ROOT, "src/app/dashboards/auth/page.tsx"), "utf8");
  assert.match(page, /name="next" value=\{next\}/);
});
