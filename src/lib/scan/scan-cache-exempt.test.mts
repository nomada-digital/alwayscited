import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const ROOT = join(import.meta.dirname, "..", "..", "..");

// 20 Nov 2026 (Luke, servefirst.ai): the cache returned the report whose keyword was wrong and a different keyword could
// not start a scan. A keyword asked for narrows the cache to a report read for it; none asked is the cache as it was.
test("/start's cache is narrowed by a keyword asked for, and the re-run copies no keyword", () => {
  const start = readFileSync(join(ROOT, "src/app/api/scan/start/route.ts"), "utf8");
  assert.match(start, /if \(askedKeyword\) cacheQuery = cacheQuery\.eq\("cluster_keyword", askedKeyword\);/);
  assert.match(start, /\.is\("unlocked_at", null\)/, "the unlocked-scan exclusion stays");
  const rerun = readFileSync(join(ROOT, "src/app/api/scan/[token]/rerun/route.ts"), "utf8");
  assert.doesNotMatch(rerun.slice(rerun.indexOf(".insert({")), /cluster_keyword/, "the old report's keyword is not carried into the new check");
});

test("the confirm step can send a keyword and the questions route stores it as typed", () => {
  const screen = readFileSync(join(ROOT, "src/components/scan/ConfirmScreen.tsx"), "utf8");
  assert.match(screen, /\.\.\.\(forKeyword \? \{ keyword: forKeyword \} : \{\}\)/);
  const route = readFileSync(join(ROOT, "src/app/api/scan/[token]/questions/route.ts"), "utf8");
  assert.match(route, /chooseGivenKeyword\(\{ scanId: String\(scan\.id\), keyword: given, market \}\)/);
  assert.match(route, /if \(!given && clusterKeywordFits\(/, "a typed keyword is never swallowed by the stored one");
});
