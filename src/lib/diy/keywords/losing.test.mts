import assert from "node:assert/strict";
import { test } from "node:test";

import { losingFrom, losingGround, readingsOf } from "./losing.ts";

/**
 * Losing ground (13 Oct 2026, DIY P6; spec 10 section 4.3 row 6): fell 5 or
 * more places and now outside the top 20, held over 2 of the keyword's last
 * 3 readings - readings, not days (spec 2.6 rules 1, 7 and 10).
 */

const r = (day: string, position: number | null, url: string | null = position === null ? null : "https://tallyroo.com/invoicing") => ({ day, position, url });

test("held over 2 of the last 3 readings, the latest among them, from 16th or better", () => {
  const hit = losingFrom([r("2026-10-01", 9), r("2026-10-02", 12), r("2026-10-03", null), r("2026-10-04", 14), r("2026-10-05", null), r("2026-10-06", null)]);
  assert.deepEqual(hit, { was: { position: 14, day: "2026-10-04", url: "https://tallyroo.com/invoicing" }, out: 2, latest: "2026-10-06" }, "from its last place inside the top 20");
});

test("the fall is counted to 21st, the shallowest it can now be: 16th is losing ground, 17th is not said", () => {
  const from = (p: number) => losingFrom([r("2026-10-01", p), r("2026-10-02", null), r("2026-10-03", null)]);
  assert.equal(from(16)?.was.position, 16);
  assert.equal(from(17), null);
  assert.equal(from(3)?.out, 2);
});

test("not losing ground: back in the top 20 at the latest reading; only one of three out; never in the top 20; too few readings", () => {
  assert.equal(losingFrom([r("a", 8), r("b", null), r("c", null), r("d", 19)]), null, "the latest reading is inside the top 20");
  assert.equal(losingFrom([r("a", 8), r("b", 9), r("c", 10), r("d", null)]), null, "one of the last three");
  assert.equal(losingFrom([r("a", null), r("b", null), r("c", null)]), null, "a keyword never in the top 20 lost no ground");
  assert.equal(losingFrom([r("a", 8), r("b", null)]), null);
});

test("a day the keyword was not read is not a reading: a partial day skips it, it does not count it out", () => {
  const serp = [
    { run_date: "2026-10-01", keyword_id: "k3", position: 9, url: "https://tallyroo.com/invoicing" },
    { run_date: "2026-10-02", keyword_id: "k3", position: null },
    // 3 Oct: no row for k3 (the partial day), and a row for another keyword.
    { run_date: "2026-10-03", keyword_id: "k1", position: 4 },
    { run_date: "2026-10-04", keyword_id: "k3", position: 11, url: "https://tallyroo.com/invoicing" },
  ];
  assert.deepEqual(
    readingsOf(serp, "k3", "2026-10-04").map((x) => x.day),
    ["2026-10-01", "2026-10-02", "2026-10-04"],
  );
  const losing = losingGround({
    keywords: [
      { id: "k3", keyword: "invoicing software", stopped_on: null },
      { id: "k9", keyword: "stopped one", stopped_on: "2026-09-01" },
    ],
    clusterOf: new Map([["k3", "c3"]]),
    serp: [...serp, { run_date: "2026-10-05", keyword_id: "k3", position: null }, { run_date: "2026-10-06", keyword_id: "k3", position: null }],
    to: "2026-10-06",
  });
  assert.deepEqual(losing, [{ keywordId: "k3", keyword: "invoicing software", clusterId: "c3", was: { position: 11, day: "2026-10-04", url: "https://tallyroo.com/invoicing" }, out: 2, latest: "2026-10-06", pageKey: "tallyroo.com/invoicing" }]);
});
