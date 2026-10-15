import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { mergeSettings, SETTINGS_FALLBACK } from "./settings-merge.ts";

// Danny, 15 Oct 2026: a domain on scan_cache_exempt_domains is re-run fresh
// rather than handed the last reading. The list is data, never a literal here.

test("scan_cache_exempt_domains defaults to empty", () => {
  assert.deepEqual(SETTINGS_FALLBACK.scan_cache_exempt_domains, []);
});

test("scan_cache_exempt_domains is trimmed, lowercased and de-duplicated", () => {
  const warnings: string[] = [];
  const s = mergeSettings(
    [{ key: "scan_cache_exempt_domains", value: [" Example.COM ", "example.com", 3, ""] }],
    (m) => warnings.push(m),
  );
  assert.deepEqual(s.scan_cache_exempt_domains, ["example.com"]);
  assert.equal(warnings.length, 1);
});

test("scan_cache_exempt_domains that is not an array falls back to empty", () => {
  const warnings: string[] = [];
  const s = mergeSettings([{ key: "scan_cache_exempt_domains", value: "example.com" }], (m) => warnings.push(m));
  assert.deepEqual(s.scan_cache_exempt_domains, []);
  assert.equal(warnings.length, 1);
});

test("the start route skips only the cache for an exempt domain, after the ceilings", () => {
  const route = readFileSync(new URL("../../app/api/scan/start/route.ts", import.meta.url), "utf8");
  const exempt = route.indexOf("settings.scan_cache_exempt_domains.includes(domain)");
  const ceilings = route.indexOf("await checkCeilings(");
  assert.ok(exempt > 0, "the start route reads the exempt list");
  assert.ok(ceilings > 0 && ceilings < exempt, "the ceilings run before the exemption is read");
});
