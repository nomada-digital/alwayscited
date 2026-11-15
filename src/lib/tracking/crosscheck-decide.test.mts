import assert from "node:assert/strict";
import { test } from "node:test";

import { ahrefsRank, decideCheck, needsCheck } from "./crosscheck-decide.ts";
import { updateRolling } from "./google-updates.ts";

// A page as Ahrefs returns it (after "volunteer management software", UK, 15 Nov 2026), made-up hosts: the Overview is its position 1.
const page = [
  { position: 1, url: null, type: ["ai_overview"] },
  { position: 1, url: "https://tallyroo.com/", type: ["ai_overview_sitelink"] },
  { position: 2, url: "https://tallyroo.com/", type: ["organic"] },
  { position: 3, url: "https://ledgerline.com/", type: ["organic"] },
  { position: 4, url: "https://plinth.example/a", type: ["organic"] },
  { position: 4, url: "https://plinth.example/b", type: ["sitelink"] },
  { position: 5, url: "https://access.example/x", type: ["organic"] },
];

test("only an absent read or a drop of 10 places goes to Ahrefs", () => {
  assert.equal(needsCheck(null, 3), true);
  assert.equal(needsCheck(null, undefined), true);
  assert.equal(needsCheck(15, 4), true);
  assert.equal(needsCheck(13, 4), false);
  assert.equal(needsCheck(40, undefined), false);
});

test("Ahrefs' rank is counted on organic results only, as DataForSEO's is", () => {
  assert.deepEqual(ahrefsRank(page, "tallyroo.com"), { rank: 1, url: "https://tallyroo.com/" });
  assert.equal(ahrefsRank(page, "access.example")?.rank, 4);
  assert.equal(ahrefsRank(page, "example.com"), null);
});

test("never 'not ranking' while Ahrefs has the site on page 1", () => {
  assert.deepEqual(decideCheck({ position: null, url: null }, 2, { rank: 1, url: "u" }), { position: 1, url: "u", varies: true });
  assert.deepEqual(decideCheck({ position: null, url: null }, 2, null), { position: null, url: null, varies: false });
});

test("a drop Ahrefs does not bear out takes the reading nearer the last one", () => {
  assert.deepEqual(decideCheck({ position: 40, url: "d" }, 3, { rank: 4, url: "a" }), { position: 4, url: "a", varies: true });
  assert.deepEqual(decideCheck({ position: 14, url: "d" }, 3, { rank: 8, url: "a" }), { position: 14, url: "d", varies: false });
  assert.deepEqual(decideCheck({ position: 40, url: "d" }, 3, null), { position: 40, url: "d", varies: false });
});

test("the November 2026 core update is noted from 10 to 24 Nov only", () => {
  assert.equal(updateRolling("2026-11-09"), null);
  assert.match(updateRolling("2026-11-15")?.note ?? "", /core update rolling out/);
  assert.equal(updateRolling("2026-11-25"), null);
});
