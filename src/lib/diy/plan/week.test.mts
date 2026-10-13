import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candidate, PlanItem } from "./types.ts";
import { byOrder, mondayOf, pickWeek, pickable, thisWeek, weekCounts } from "./week.ts";

const c = (key: string, o: Partial<Candidate> = {}): Candidate => ({
  dedupeKey: key,
  kind: "recover_prompt",
  severity: "slipping",
  clusterId: null,
  title: key,
  why: [{ text: "fact" }],
  grade: "your_data",
  effort: "hour",
  href: "/clusters/c1",
  ...o,
});

test("the Monday boundary is UTC's: Sunday is the week before, Monday its own", () => {
  assert.equal(mondayOf("2026-10-12"), "2026-10-12"); // a Monday
  assert.equal(mondayOf("2026-10-13"), "2026-10-12");
  assert.equal(mondayOf("2026-10-18"), "2026-10-12"); // Sunday
  assert.equal(mondayOf("2026-10-19"), "2026-10-19");
  assert.equal(mondayOf("2026-03-01"), "2026-02-23", "across a month");
  assert.equal(mondayOf("2027-01-01"), "2026-12-28", "across a year");
});

test("at most one per severity, in severity order", () => {
  const picked = pickWeek([c("g1", { severity: "gap" }), c("s1"), c("s2"), c("b1", { severity: "blocking" }), c("t1", { severity: "tidy" }), c("cl1", { severity: "closest" })], new Map(), "2026-10-12");
  assert.deepEqual(
    picked.map((x) => x.dedupeKey),
    ["b1", "s1", "cl1"],
  );
});

test("never two in one cluster; a candidate with no cluster is in none", () => {
  const picked = pickWeek(
    [c("b1", { severity: "blocking", clusterId: "c1" }), c("s1", { clusterId: "c1" }), c("s2", { clusterId: "c2" }), c("g1", { severity: "gap", clusterId: null }), c("t1", { severity: "tidy", clusterId: null })],
    new Map(),
    "2026-10-12",
  );
  assert.deepEqual(
    picked.map((x) => x.dedupeKey),
    ["b1", "s2", "g1"],
  );
});

test("hidden items are honoured until hidden_until; dropped and done ones never come back", () => {
  const items = new Map<string, Pick<PlanItem, "status" | "hiddenUntil">>([
    ["b1", { status: "suggested", hiddenUntil: "2026-10-20" }],
    ["s1", { status: "dropped", hiddenUntil: null }],
    ["g1", { status: "done", hiddenUntil: null }],
    ["t1", { status: "doing", hiddenUntil: null }],
  ]);
  const picked = pickWeek([c("b1", { severity: "blocking" }), c("s1"), c("g1", { severity: "gap" }), c("t1", { severity: "tidy" })], items, "2026-10-12");
  assert.deepEqual(
    picked.map((x) => x.dedupeKey),
    ["t1"],
    "only the item the client is already doing",
  );
  assert.equal(pickable({ status: "suggested", hiddenUntil: "2026-10-12" }, "2026-10-12"), true, "hidden until today is back today");
  assert.equal(pickable(undefined, "2026-10-12"), true);
});

test("within a severity: volume high first, then effort low first, then the newest evidence, then the key", () => {
  const sorted = [
    c("a", { volume: 100, effort: "days" }),
    c("b", { volume: 900, effort: "days" }),
    c("c", { volume: 100, effort: "minutes", evidenceOn: "2026-10-01" }),
    c("d", { volume: 100, effort: "minutes", evidenceOn: "2026-10-09" }),
    c("e", { volume: 100, effort: "minutes", evidenceOn: "2026-10-09" }),
  ].sort(byOrder);
  assert.deepEqual(
    sorted.map((x) => x.dedupeKey),
    ["b", "d", "e", "c", "a"],
  );
});

const it = (key: string, o: Partial<PlanItem>): Pick<PlanItem, "weekOf" | "newSinceMonday" | "hiddenUntil" | "status" | "severity" | "dedupeKey"> => ({ weekOf: "2026-10-12", newSinceMonday: false, hiddenUntil: null, status: "suggested", severity: "slipping", dedupeKey: key, ...o });

test("This week: this Monday's items, a Blocking item new since Monday first; hidden and dropped ones leave it", () => {
  const items = [
    it("s1", {}),
    it("g1", { severity: "gap", status: "done" }),
    it("b9", { severity: "blocking", newSinceMonday: true }),
    it("old", { weekOf: "2026-10-05" }),
    it("hid", { severity: "tidy", hiddenUntil: "2026-10-26" }),
    it("drop", { severity: "closest", status: "dropped" }),
  ];
  assert.deepEqual(
    thisWeek(items, "2026-10-14").map((i) => i.dedupeKey),
    ["b9", "s1", "g1"],
  );
  assert.deepEqual(weekCounts(items, "2026-10-14"), { done: 1, of: 3, open: 3 }, "open: s1, b9 and old - not the hidden one");
  assert.deepEqual(thisWeek(items, "2026-10-19"), [], "next Monday the week is empty until the job pins it");
});
