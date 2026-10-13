import assert from "node:assert/strict";
import { test } from "node:test";

import { MARK_BOX, MARK_READOUT_W, READOUT_W, W, X0, X1, boardDayAt, boardX, dayStrip, markLeftCss, markLeftPx, placeMarks, readoutAt } from "./chart-board.ts";

/**
 * The Overview board's readout and slide (8 Oct 2026, audit mobile-2 and its
 * review). Before mobile-2 the readout was placed by percentage and flipped
 * only past x=780, so on a narrow plot it ran off the card and widened the
 * page; the review then found nothing held the fix. These hold it: on every
 * plot width the board is drawn at, for every day of every range length, the
 * readout stays inside the plot and off the day's own line, and a point along
 * the plot picks the day whose button covers it.
 */

// The board is drawn only on a plot of 880px or more (globals.css, .app-ovc),
// up to its own 1056. Every whole pixel between, and the lengths a range can be.
const PLOTS = Array.from({ length: W - 880 + 1 }, (_, i) => 880 + i);
const LENGTHS = [1, 2, 3, 7, 14, 28, 31, 60, 90];

const px = (s: string) => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(s);
  assert.ok(m, `readoutAt gave "${s}", not a pixel left`);
  return Number(m[1]);
};

test("the readout is 220px wide, as since T4", () => {
  assert.equal(READOUT_W, 220);
});

test("the readout never passes either edge of the plot, nor covers the day it reads", () => {
  let placed = 0;
  for (const plotW of PLOTS) {
    for (const n of LENGTHS) {
      for (let i = 0; i < n; i++) {
        const x = boardX(i, n);
        const at = readoutAt(x, plotW);
        assert.equal(at.transform, undefined, "a measured plot is placed in pixels, with no transform");
        const left = px(at.left);
        const line = (x / W) * plotW;
        assert.ok(left >= 0, `plot ${plotW}, day ${i + 1} of ${n}: left ${left} < 0`);
        assert.ok(left + READOUT_W <= plotW, `plot ${plotW}, day ${i + 1} of ${n}: right ${left + READOUT_W} > ${plotW}`);
        assert.ok(left >= line + 11.5 || left + READOUT_W <= line - 11.5, `plot ${plotW}, day ${i + 1} of ${n}: the readout covers the day's line at ${line}`);
        placed++;
      }
    }
  }
  // Floor: a loop that stopped running would pass. 177 plot widths by 236 days.
  assert.equal(placed, 177 * 236, `${placed} placements checked`);
});

test("before the plot is measured, the readout is the T4 guess in percent", () => {
  assert.deepEqual(readoutAt(X0, null), { left: `${(X0 / W) * 100}%`, transform: "translateX(12px)" });
  assert.deepEqual(readoutAt(X1, null), { left: `${(X1 / W) * 100}%`, transform: "translateX(calc(-100% - 12px))" });
});

test("each day's button is centred on the day's line, one step wide", () => {
  for (const n of LENGTHS.filter((n) => n > 1)) {
    const { left, right } = dayStrip(n);
    const width = (right - left) / n;
    const step = (X1 - X0) / (n - 1);
    assert.ok(Math.abs(width - step) < 1e-9, `${n} days: buttons ${width} wide, a step is ${step}`);
    for (let i = 0; i < n; i++) {
      const centre = left + (i + 0.5) * width;
      assert.ok(Math.abs(centre - boardX(i, n)) < 1e-9, `${n} days: day ${i + 1}'s button is centred at ${centre}, its line at ${boardX(i, n)}`);
    }
  }
  // One day: the one button is the whole plot.
  assert.deepEqual(dayStrip(1), { left: X0, right: X1 });
});

test("a point along the plot picks the day whose button covers it", () => {
  for (const n of LENGTHS) {
    const { left, right } = dayStrip(n);
    const width = (right - left) / n;
    for (let i = 0; i < n; i++) {
      // Just inside each edge of day i's button, and on its middle.
      for (const at of [left + i * width + 0.01, left + (i + 0.5) * width, left + (i + 1) * width - 0.01]) {
        assert.equal(boardDayAt(at / W, n), i, `${n} days: x ${at.toFixed(2)} is on day ${i + 1}'s button`);
      }
    }
    // Past either end of the plot, the nearest end day.
    assert.equal(boardDayAt(-0.5, n), 0);
    assert.equal(boardDayAt(0, n), 0);
    assert.equal(boardDayAt(1, n), n - 1);
    assert.equal(boardDayAt(1.5, n), n - 1);
  }
});

/**
 * 13 Oct 2026, DIY P4 (spec 10 section 4.1 row 8): work markers and their
 * readouts stay inside the plot at every width each chart is drawn at - the
 * Overview board from 880px to its 1056, the cluster chart from the phone's
 * 560px break to its 1056 (its own geometry, X0 44 and X1 1040) - for every
 * day of every range length, and the CSS the charts draw resolves to the
 * pixels checked.
 */
test("work markers and their readouts stay inside the plot at every width", () => {
  const boards = [
    { name: "overview", x0: X0, x1: X1, widths: PLOTS },
    { name: "cluster", x0: 44, x1: 1040, widths: Array.from({ length: W - 560 + 1 }, (_, i) => 560 + i) },
  ];
  let placed = 0;
  for (const b of boards) {
    for (const plotW of b.widths) {
      for (const n of LENGTHS) {
        for (let i = 0; i < n; i++) {
          const x = b.x0 + i * (n > 1 ? (b.x1 - b.x0) / (n - 1) : 0);
          for (const box of [MARK_BOX, MARK_READOUT_W]) {
            const left = markLeftPx(x, W, box, plotW);
            assert.ok(left >= 0 && left + box <= plotW, `${b.name} plot ${plotW}, day ${i + 1} of ${n}: a ${box}px box at ${left}`);
            placed++;
          }
          // The marker's own box covers the day's line wherever it is not held in at an edge.
          const hit = markLeftPx(x, W, MARK_BOX, plotW);
          const line = (x / W) * plotW;
          assert.ok(hit <= line && line <= hit + MARK_BOX, `${b.name} plot ${plotW}, day ${i + 1} of ${n}: the marker does not cover its day`);
        }
      }
    }
  }
  assert.equal(placed, 2 * 236 * (PLOTS.length + (W - 560 + 1)), `${placed} placements checked`);
  assert.equal(markLeftCss(528, W, MARK_BOX), "clamp(0px, calc(50.000% - 12px), calc(100% - 24px))");
});

test("marks are placed on the chart's days, by date; a mark on a day not drawn is left off", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
  const marks = [
    { date: "2026-10-03", kind: "done" as const, label: "Add Organization schema to your homepage" },
    { date: "2026-09-30", kind: "started" as const, label: "Before the range" },
    { date: "2026-10-01", kind: "placement" as const, label: "smallbizstack.example" },
    { date: "2026-10-03", kind: "started" as const, label: "Pitch the round-up" },
  ];
  assert.deepEqual(
    placeMarks(days, marks).map((m) => [m.i, m.kind]),
    [
      [0, "placement"],
      [2, "done"],
      [2, "started"],
    ],
  );
});