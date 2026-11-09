import assert from "node:assert/strict";
import { test } from "node:test";

import type { ClusterChart } from "./cluster-figures.ts";
import { rate } from "./figures.ts";
import { axisAt, chartMarkers, chartSeries, type CiteRow, citeRows, kindFilters, pageParts, pickKind, pickCluster, placedTier, type PlacementRow, PLACEMENTS_FOOTNOTE, placementsView, shortDay, spanText, weeklyPoints } from "./placement-figures.ts";

// R97 part 1 / BRIEF-2 T13 (30 Sep 2026). Made-up rows only (privacy.test.mts).

const days = ["2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08"];
const chart: ClusterChart = {
  days,
  named: [rate(1, 10), null, rate(2, 10), rate(3, 10), rate(4, 10)],
  google: [18, 17, null, 9, 4],
  namedBefore: null,
  googleBefore: null,
};
const placements: PlacementRow[] = [
  { id: "b", kind: "link_insertion", url: "https://example.com/two", url_key: "example.com/two", status: "live", scheduled_on: null, live_on: "2026-07-07" },
  { id: "a", kind: "guest_post", url: "https://www.example.com/one/", url_key: "example.com/one", status: "live", scheduled_on: null, live_on: "2026-07-05" },
  { id: "c", kind: "guest_post", url: "https://example.com/three", url_key: "example.com/three", status: "scheduled", scheduled_on: "2026-10-02", live_on: null },
  { id: "d", kind: "on_site", url: "https://tallyroo.com/p", url_key: "tallyroo.com/p", status: "writing", scheduled_on: null, live_on: null },
  { id: "e", kind: "guest_post", url: "https://example.com/gone", url_key: "example.com/gone", status: "removed", scheduled_on: null, live_on: "2026-07-04" },
];
const cites: CiteRow[] = [
  { run_date: "2026-07-06", question_id: "q1", engine: "chatgpt", url: "https://example.com/one?utm=x" },
  // Same answer citing both pages: one answer for the whole cluster, one for each row.
  { run_date: "2026-07-08", question_id: "q2", engine: "claude", url: "https://example.com/one" },
  { run_date: "2026-07-08", question_id: "q2", engine: "claude", url: "https://example.com/two" },
  // Before its live day: not counted.
  { run_date: "2026-07-04", question_id: "q1", engine: "gemini", url: "https://example.com/one" },
  // Another cluster's prompt: not counted.
  { run_date: "2026-07-08", question_id: "qx", engine: "gemini", url: "https://example.com/one" },
];
const engines = ["google_aio", "chatgpt", "gemini", "perplexity", "claude"];
const view = placementsView({ chart, questionIds: ["q1", "q2"], placements, cites, engines });

test("strip: live and in-progress counts, removed rows left out of both", () => {
  assert.equal(view.live, 2, "a and b; e was removed");
  assert.equal(view.inProgress, 2);
  assert.equal(view.weekly, false);
});

test("whole cluster: first to latest reading, answers citing any placement counted once", () => {
  assert.deepEqual(view.whole, { from: "2026-07-04", named: { from: 10, to: 40 }, google: { from: 18, to: 4 }, cited: 2 });
});

test("rows: live by go-live day, at go-live is the first reading on or after it, then the rest", () => {
  assert.deepEqual(
    view.rows.map((r) => [r.id, r.when, r.cited, r.citedBy.join(","), spanText(r.named, "pct"), spanText(r.google, "rank")]),
    [
      ["a", "5 Jul", 2, "chatgpt,claude", "20% to 40%", "#17 to #4"],
      ["b", "7 Jul", 1, "claude", "30% to 40%", "#9 to #4"],
      ["c", "Scheduled 2 Oct", 0, "", "-", "-"],
      ["d", "Writing", 0, "", "-", "-"],
    ],
  );
});

test("weekly points sum a week's answers rather than averaging its days", () => {
  const long: ClusterChart = { ...chart, days: [...days, "2026-07-09", "2026-07-10", "2026-07-11"], named: [...chart.named, null, null, rate(1, 1)], google: [...chart.google, null, null, 3] };
  const w = weeklyPoints(long);
  assert.deepEqual(w.days, ["2026-07-04", "2026-07-11"]);
  assert.deepEqual(w.named, [rate(10, 40), rate(1, 1)]);
  assert.deepEqual(w.google, [4, 3]);
});

test("citeRows: one row per cited URL of an answered read, none from a URL-less citation", () => {
  assert.deepEqual(
    citeRows([
      { run_date: "2026-07-06", question_id: "q1", engine: "chatgpt", answered: true, citations: [{ url: "https://example.com/one" }, { url: null }] },
      { run_date: "2026-07-06", question_id: "q1", engine: "gemini", answered: false, citations: [{ url: "https://example.com/two" }] },
    ]),
    [{ run_date: "2026-07-06", question_id: "q1", engine: "chatgpt", url: "https://example.com/one" }],
  );
});

test("the footnote is the board's, word for word, and a day reads as the board writes it", () => {
  assert.match(PLACEMENTS_FOOTNOTE, /^"At go-live to now" is where the cluster stood the week a page went live, and where it stands today\. It includes everything else that happened in that time\./);
  assert.equal(shortDay("2026-09-05"), "5 Sep");
});

test("R97 part 3: the Page column splits host and path as the board does", () => {
  assert.deepEqual(pageParts("https://www.example.com/guides/one/?a=1"), { host: "example.com", path: "/guides/one" });
  assert.deepEqual(pageParts("https://example.com/"), { host: "example.com", path: "" });
  assert.deepEqual(pageParts("not a url"), { host: "not a url", path: "" });
});

test("R97 part 3: the screen opens ?cluster= if it is the client's, else the first placed cluster, else the first", () => {
  const clusters = [{ id: "c1" }, { id: "c2" }];
  const rows = [{ cluster_id: "c1", status: "removed" }, { cluster_id: "c2", status: "writing" }];
  assert.equal(pickCluster(clusters, rows, "c1"), "c1");
  assert.equal(pickCluster(clusters, rows, "someone-elses"), "c2");
  assert.equal(pickCluster(clusters, [], null), "c1");
  assert.equal(pickCluster([], rows, "c2"), null);
});

test("R97 part 3: Placements is in the nav for mentioned, cited and everywhere only", () => {
  assert.deepEqual(["tracked", "mentioned", "cited", "everywhere"].map(placedTier), [false, true, true, true]);
});

test("R97 part 4b: chartSeries is daily up to 35 days and weekly over it, as whole percentages", () => {
  const d = chartSeries(chart);
  assert.equal(d.weekly, false);
  assert.deepEqual(d.days, days);
  assert.deepEqual(d.named, [10, null, 20, 30, 40]);
  const n = 36;
  const long: ClusterChart = { days: Array.from({ length: n }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`), named: Array.from({ length: n }, () => rate(1, 4)), google: Array.from({ length: n }, () => 7), namedBefore: null, googleBefore: null };
  const w = chartSeries(long);
  assert.equal(w.weekly, true);
  assert.equal(w.days.length, 6);
  assert.deepEqual(w.named, [25, 25, 25, 25, 25, 25]);
  // Days before the first reading are not drawn.
  const late = chartSeries({ ...chart, named: [null, null, rate(2, 10), null, rate(4, 10)], google: [null, null, null, 9, 4] });
  assert.deepEqual(late.days, days.slice(2));
  assert.deepEqual(late.named, [20, null, 40]);
  assert.deepEqual(late.google, [null, 9, 4]);
});

test("R97 part 4b: pickKind, kindFilters and axisAt", () => {
  assert.equal(pickKind("guest_post"), "guest_post");
  assert.equal(pickKind("toString"), null);
  assert.equal(pickKind(undefined), null);
  assert.deepEqual(kindFilters(placements.filter((p) => p.status !== "removed")), [
    { kind: null, label: "All 4" },
    { kind: "guest_post", label: "Placements 2" },
    { kind: "link_insertion", label: "Link insertions 1" },
    { kind: "on_site", label: "On-site 1" },
  ]);
  assert.equal(axisAt("2026-07-04", "2026-07-04", "2026-07-08"), 0);
  assert.equal(axisAt("2026-07-06", "2026-07-04", "2026-07-08"), 0.5);
  assert.equal(axisAt("2026-08-01", "2026-07-04", "2026-07-08"), 1);
  assert.equal(axisAt("2026-07-06", "2026-07-06", "2026-07-06"), 0);
});

test("R97 part 5: chartMarkers draws live rows on the cluster, inside the chart's days, in day order", () => {
  const rows = [...placements.map((p) => ({ ...p, cluster_id: "c1" })), { ...placements[0]!, id: "other", cluster_id: "c2" }, { ...placements[1]!, id: "late", live_on: "2026-08-01", cluster_id: "c1" }];
  assert.deepEqual(chartMarkers(days, rows, "c1"), [
    { id: "a", i: 1, kind: "guest_post", label: "Placement on example.com, live 5 Jul" },
    { id: "b", i: 3, kind: "link_insertion", label: "Link insertion on example.com, live 7 Jul" },
  ]);
  assert.deepEqual(chartMarkers(days, rows, "c3"), []);
});
