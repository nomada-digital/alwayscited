import assert from "node:assert/strict";
import { test } from "node:test";

import { gridDue, gridPoints, lastFullDay, parseMapsResult, rankBand, rankOfCid, summariseGrid } from "./grid.ts";

test("a 5x5 grid is 25 points, centre in the middle, north on row 0 and west on col 0", () => {
  const pts = gridPoints({ center_lat: 53.8, center_lng: -1.55, size: 5, spacing_km: 3 });
  assert.equal(pts.length, 25);
  const centre = pts.find((p) => p.row === 2 && p.col === 2)!;
  assert.deepEqual([centre.lat, centre.lng], [53.8, -1.55]);
  const nw = pts.find((p) => p.row === 0 && p.col === 0)!;
  assert.ok(nw.lat > centre.lat && nw.lng < centre.lng);
  const se = pts.find((p) => p.row === 4 && p.col === 4)!;
  assert.ok(se.lat < centre.lat && se.lng > centre.lng);
});

test("the spacing is kilometres on the ground: the east-west step widens with latitude", () => {
  const pts = gridPoints({ center_lat: 54, center_lng: -1.7, size: 3, spacing_km: 5 });
  const c = pts[4]!;
  const north = pts.find((p) => p.row === 0 && p.col === 1)!;
  const east = pts.find((p) => p.row === 1 && p.col === 2)!;
  const kmNorth = (north.lat - c.lat) * 111.32;
  const kmEast = (east.lng - c.lng) * 111.32 * Math.cos((54 * Math.PI) / 180);
  assert.ok(Math.abs(kmNorth - 5) < 0.01, `north step ${kmNorth}`);
  assert.ok(Math.abs(kmEast - 5) < 0.01, `east step ${kmEast}`);
});

test("an even grid has no centre and is refused", () => {
  assert.throws(() => gridPoints({ center_lat: 0, center_lng: 0, size: 4, spacing_km: 1 }), /odd/);
});

test("a Maps result: listings in order, ads and unranked items dropped, the CID kept as a string", () => {
  const hits = parseMapsResult({
    items: [
      { type: "maps_search", rank_group: 2, title: "Second Studio", cid: "222", rating: { votes_count: 40 } },
      { type: "maps_paid_item", rank_group: 1, title: "An Advert", cid: "999" },
      { type: "maps_search", rank_group: 1, title: "First Studio", cid: "111", rating: { votes_count: 12 } },
      { type: "maps_search", title: "No Rank", cid: "333" },
      { type: "maps_search", rank_group: 3, title: "No Reviews", cid: "" },
    ],
  });
  assert.deepEqual(hits, [
    { rank: 1, title: "First Studio", cid: "111", reviews: 12 },
    { rank: 2, title: "Second Studio", cid: "222", reviews: 40 },
    { rank: 3, title: "No Reviews", cid: null, reviews: null },
  ]);
  assert.deepEqual(parseMapsResult(null), []);
  assert.deepEqual(parseMapsResult({ items: "nope" }), []);
});

test("the client is matched by CID, never by name", () => {
  const hits = [
    { rank: 1, title: "Example Photography", cid: "111", reviews: 1 },
    { rank: 4, title: "Someone Else", cid: "999", reviews: 1 },
  ];
  assert.equal(rankOfCid(hits, "999"), 4);
  assert.equal(rankOfCid(hits, "123"), null);
});

test("weekly grids are due 7 days after their last full read, monthly 28, and a grid never fully read is due", () => {
  assert.equal(gridDue("weekly", null, "2026-10-22"), true);
  assert.equal(gridDue("weekly", "2026-10-22", "2026-10-28"), false);
  assert.equal(gridDue("weekly", "2026-10-22", "2026-10-29"), true);
  assert.equal(gridDue("monthly", "2026-10-01", "2026-10-28"), false);
  assert.equal(gridDue("monthly", "2026-10-01", "2026-10-29"), true);
});

test("a day counts as a full read only when every point came back", () => {
  assert.equal(lastFullDay([{ run_date: "2026-10-22", points: 25 }, { run_date: "2026-10-29", points: 19 }], 5), "2026-10-22");
  assert.equal(lastFullDay([{ run_date: "2026-10-29", points: 9 }], 5), null);
  assert.equal(lastFullDay([], 3), null);
});

test("the summary counts a point outside depth as depth + 1, and tallies who holds the pack", () => {
  const a = { rank: 1, title: "A", cid: "1", reviews: 10 };
  const b = { rank: 2, title: "B", cid: "2", reviews: 20 };
  const c = { rank: 3, title: "C", cid: "3", reviews: null };
  const s = summariseGrid(
    [
      { rank: 2, top: [a, b, c] },
      { rank: 8, top: [b, a, c] },
      { rank: null, top: [b, c, a] },
    ],
    20,
  );
  assert.equal(s.points, 3);
  assert.equal(s.found, 2);
  assert.equal(s.inPack, 1);
  assert.equal(s.avgRank, Math.round(((2 + 8 + 21) / 3) * 10) / 10);
  assert.deepEqual(s.owners.map((o) => [o.title, o.points]), [["A", 3], ["B", 3], ["C", 3]]);
  assert.equal(summariseGrid([], 20).avgRank, null);
});

test("rank bands: the pack, page one, further out, and not found", () => {
  assert.equal(rankBand(1), "pack");
  assert.equal(rankBand(3), "pack");
  assert.equal(rankBand(4), "near");
  assert.equal(rankBand(10), "near");
  assert.equal(rankBand(11), "far");
  assert.equal(rankBand(null), "none");
});
