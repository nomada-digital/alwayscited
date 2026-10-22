import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dashUrl } from "./app-redirect.ts";

/**
 * Audit interactions-1 (8 Oct 2026): on the dashboard's own host every form
 * post 303'd to the marketing host, which the CSP's form-action 'self' refused.
 */

test("unset, a redirect is the request's own origin, as before", () => {
  assert.equal(dashUrl(new Request("https://alwayscited.com/api/app/x/stop"), "/app/x/clusters?done=stopped", {}).href, "https://alwayscited.com/app/x/clusters?done=stopped");
});

test("set, a redirect lands on the dashboard's host whatever host the server saw", () => {
  const env = { APP_HOST: "app.alwayscited.com" };
  assert.equal(dashUrl(new Request("https://alwayscited.com/api/app/x/stop"), "/x/clusters", env).href, "https://app.alwayscited.com/x/clusters");
  assert.equal(dashUrl(new Request("http://localhost:3100/api/app/login"), "/login?sent=1", { APP_HOST: "app.localhost:3100" }).href, "http://app.localhost:3100/login?sent=1");
});

const ROOT = new URL("../../app/api/app/", import.meta.url).pathname;
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === "route.ts") out.push(p);
  }
  return out;
}

test("every dashboard route redirects through dashUrl, never new URL(..., req.url)", () => {
  const files = walk(ROOT);
  assert.ok(files.length >= 15, `only ${files.length} dashboard routes walked`);
  let redirects = 0;
  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    redirects += (src.match(/NextResponse\.redirect\(/g) ?? []).length;
    // 22 Oct 2026, the cut-over: signInUrl, the dashboards host's /login, for the login route's plain form post.
    for (const m of src.matchAll(/NextResponse\.redirect\(\s*([a-zA-Z]+)/g)) if (m[1] !== "dashUrl" && m[1] !== "signInUrl") bad.push(`${f.slice(ROOT.length)}: redirect(${m[1]}...`);
    if (/new URL\([\s\S]{0,400}?,\s*req\.url\s*\)/.test(src.replace(/new URL\(req\.url\)/g, ""))) bad.push(`${f.slice(ROOT.length)}: new URL(..., req.url)`);
  }
  // The floor: 34 redirects on 8 Oct 2026. A matcher that stops matching reports a clean tree.
  assert.ok(redirects >= 34, `only ${redirects} redirects found`);
  assert.deepEqual(bad, []);
});
