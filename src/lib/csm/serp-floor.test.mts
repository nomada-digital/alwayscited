import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_DR_FLOOR } from "../../config/csm.ts";
import { drFloor, latestUsableTop, topThree } from "./serp-floor.ts";

const hit = (rank: number, domain: string) => ({ rank, domain, url: `https://${domain}/page` });
const clean = (day: string, domains: string[]) => ({ run_date: day, top: [...domains, ...Array.from({ length: 12 }, (_, i) => `filler${i}.example`)].map((d, i) => hit(i + 1, d)) });
const wrapped = (day: string) => ({ run_date: day, top: Array.from({ length: 19 }, (_, i) => (i % 3 ? { rank: i + 1, domain: "google.com", url: `https://google.com/goto?url=x${i}` } : hit(i + 1, `site${i}.example`))) });

test("the floor is the top three's average DR on the latest clean reading, the client's own domain left out", () => {
  const rows = [clean("2026-10-28", ["old.example", "b.example", "c.example"]), clean("2026-10-29", ["common.agency", "a.example", "b.example", "c.example"]), wrapped("2026-11-04")];
  const dr = new Map<string, number | null>([["a.example", 70], ["b.example", 61], ["c.example", 52], ["old.example", 90]]);
  const f = drFloor(rows, "common.agency", dr);
  assert.deepEqual(f, { floor: 61, source: "serp", readOn: "2026-10-29", used: [{ domain: "a.example", dr: 70 }, { domain: "b.example", dr: 61 }, { domain: "c.example", dr: 52 }] });
  assert.equal(latestUsableTop([wrapped("2026-11-04")]), null, "a degraded page is never the SERP");
});

test("too few known DRs, or no clean reading, leaves the default floor and says so", () => {
  const rows = [clean("2026-10-29", ["a.example", "b.example", "c.example"])];
  assert.deepEqual(drFloor(rows, "x.example", new Map([["a.example", 70]])), { floor: DEFAULT_DR_FLOOR, source: "default", readOn: "2026-10-29", used: [{ domain: "a.example", dr: 70 }, { domain: "b.example", dr: null }, { domain: "c.example", dr: null }] });
  assert.equal(drFloor([], "x.example", new Map()).source, "default");
  assert.deepEqual(topThree(clean("d", ["www.google.co.uk", "a.example", "A.example", "b.example", "c.example"]), "x.example"), ["a.example", "b.example", "c.example"]);
});
