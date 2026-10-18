import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isPrefetch } from "./prefetch.ts";

/**
 * R162 (1 Oct 2026, danny.md line 171): Chrome's Basic-auth box opened over a
 * client's dashboard. The ungrouped Overview card held a <Link> to
 * /admin/tracking; Next prefetched it, proxy.ts answered 401 with
 * WWW-Authenticate, and the browser asked the client for the admin password.
 * Two guards: nothing a client sees links to /admin, and a prefetch of /admin
 * is a bare 404 rather than a challenge.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const headers = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()] ?? null;

test("a router prefetch, an RSC fetch or a prefetch hint is a prefetch", () => {
  assert.equal(isPrefetch(headers({ "next-router-prefetch": "1" })), true);
  assert.equal(isPrefetch(headers({ rsc: "1" })), true);
  assert.equal(isPrefetch(headers({ purpose: "prefetch" })), true);
  assert.equal(isPrefetch(headers({ "sec-purpose": "prefetch;prerender" })), true);
  // What reaches proxy in practice: Next strips RSC and Next-Router-Prefetch first.
  assert.equal(isPrefetch(headers({ "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })), true);
  assert.equal(isPrefetch(headers({ "sec-fetch-mode": "same-origin" })), true);
});

test("a page someone opened is not a prefetch, so it is still challenged", () => {
  assert.equal(isPrefetch(headers({})), false);
  assert.equal(isPrefetch(headers({ accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" })), false);
  assert.equal(isPrefetch(headers({ purpose: "preview" })), false);
});

test("proxy.ts never challenges a prefetch: both refusals go through it", () => {
  const src = readFileSync(join(ROOT, "src/proxy.ts"), "utf8");
  assert.match(src, /isPrefetch\(\(n\) => request\.headers\.get\(n\)\) \? new NextResponse\(null, \{ status: 404 \}\) : challenge\(\)/);
  // challenge() is called from shut alone: once in its definition, once in shut.
  assert.equal(src.match(/challenge\(\)/g)?.length, 2, "a bare challenge() outside shut would challenge a prefetch again");
  assert.match(src, /if \(!creds\) return shut\(\);/);
  assert.match(src, /return ok \? NextResponse\.next\(\) : shut\(\);/);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test("census: nothing under src/app/dashboards or src/components/dash points at /admin", () => {
  // 18 Oct 2026, brief 2d: /app retired, every address 308s to the dashboards host, so what a client sees is the
  // dashboards host's tree; src/app/app and src/components/app are gone.
  const files = [...walk(join(ROOT, "src/app/dashboards")), ...walk(join(ROOT, "src/components/dash"))];
  // Floor: 33 files on 1 Oct 2026; a walk that stops matching reads clean.
  // 18 Oct 2026 (brief 2d): the walk is the dashboards host's tree, 45 files that day; the floor stays 33.
  assert.ok(files.length >= 33, `walked only ${files.length} files`);
  const hits = files.filter((f) => /["'`]\/admin\b/.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
  assert.deepEqual(hits, [], "a client-facing /admin link is prefetched into a Basic-auth prompt");
});
