import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanCandidate, isStaleNote, planRefresh, refreshNote, staleNote, STALE_RUNS } from "./refresh.ts";
import type { Candidate, PlanItem } from "./types.ts";

const c = (key: string, o: Partial<Candidate> = {}): Candidate => ({
  dedupeKey: key,
  kind: "recover_prompt",
  severity: "slipping",
  clusterId: null,
  title: `Do ${key}`,
  why: [{ text: `fact ${key}`, href: "/clusters/c1" }],
  grade: "your_data",
  effort: "hour",
  href: "/clusters/c1",
  ...o,
});

type Known = Pick<PlanItem, "id" | "dedupeKey" | "status" | "statusBy" | "createdBy" | "hiddenUntil" | "weekOf" | "note" | "missed" | "missedOn"> & { newSinceMonday?: boolean };
const item = (key: string, o: Partial<Known> = {}): Known => ({ id: `id-${key}`, dedupeKey: key, status: "suggested", statusBy: "system", createdBy: "system", hiddenUntil: null, weekOf: null, note: null, missed: 0, missedOn: null, ...o });

const MON = "2026-10-12";
const WED = "2026-10-14";
const NOW = "2026-10-14T03:31:00.000Z";
const run = (candidates: Candidate[], items: Known[], today = WED, complete = true) => planRefresh({ clientId: "cl", candidates, complete, items, today, now: NOW });

test("a new candidate becomes a suggestion; the week's three are pinned on the first run of the week", () => {
  const plan = run([c("b1", { severity: "blocking" }), c("s1"), c("g1", { severity: "gap" }), c("t1", { severity: "tidy" })], [], MON);
  assert.equal(plan.inserts.length, 4);
  assert.deepEqual(plan.picked, ["b1", "s1", "g1"]);
  const row = plan.inserts.find((r) => r.dedupe_key === "b1")!;
  assert.equal(row.status, "suggested");
  assert.equal(row.week_of, MON);
  assert.equal(row.new_since_monday, false);
  assert.equal(row.created_by, "system");
  assert.equal(plan.inserts.find((r) => r.dedupe_key === "t1")!.week_of, null, "other suggestions stay without week_of");
});

test("the week is pinned once: a later run that week pins nothing, and only a new Blocking item joins, flagged new since Monday", () => {
  const items = [item("s1", { weekOf: MON }), item("g1", { weekOf: MON })];
  const plan = run([c("s1"), c("g1", { severity: "gap" }), c("b2", { severity: "blocking" }), c("t2", { severity: "tidy" })], items, WED);
  assert.deepEqual(plan.picked, []);
  const b2 = plan.inserts.find((r) => r.dedupe_key === "b2")!;
  assert.equal(b2.week_of, MON);
  assert.equal(b2.new_since_monday, true);
  assert.equal(plan.inserts.find((r) => r.dedupe_key === "t2")!.week_of, null, "a new Tidy-up mid-week waits for Monday");
});

test("a week whose Monday run found nothing is pinned on its next run", () => {
  const plan = run([c("s1")], [], WED);
  assert.deepEqual(plan.picked, ["s1"]);
  assert.equal(plan.inserts[0]!.week_of, MON);
});

test("a suggestion follows its candidate's words; an item the client moved keeps its status and its words", () => {
  const plan = run([c("s1", { title: "New words" }), c("d1", { title: "Other words" })], [item("s1", { weekOf: MON }), item("d1", { status: "doing", statusBy: "owner@example.com", weekOf: MON })]);
  const s1 = plan.updates.find((u) => u.id === "id-s1")!.patch;
  assert.equal(s1.title, "New words");
  assert.equal(s1.seen_on, WED);
  const d1 = plan.updates.find((u) => u.id === "id-d1")!.patch;
  assert.equal(d1.title, undefined);
  assert.equal(d1.status, undefined);
  assert.equal(d1.seen_on, WED);
});

test("one the client dropped never comes back; one the system dropped does, when it applies again", () => {
  const plan = run([c("x1"), c("x2")], [item("x1", { status: "dropped", statusBy: "owner@example.com", weekOf: MON }), item("x2", { status: "dropped", statusBy: "system", weekOf: MON })]);
  assert.equal(plan.updates.find((u) => u.id === "id-x1")!.patch.status, undefined);
  assert.equal(plan.updates.find((u) => u.id === "id-x2")!.patch.status, "suggested");
  assert.equal(plan.inserts.length, 0, "never inserted twice");
});

test(`a suggestion not gathered on ${STALE_RUNS} runs is dropped by the system with the dated note; a re-run the same day counts once`, () => {
  const first = run([], [item("s1", { weekOf: MON })], "2026-10-14");
  assert.deepEqual(first.updates, [{ id: "id-s1", patch: { missed: 1, missed_on: "2026-10-14" } }]);
  const again = run([], [item("s1", { weekOf: MON, missed: 1, missedOn: "2026-10-14" })], "2026-10-14");
  assert.deepEqual(again.updates, [], "the 15-minute stale reclaim can run the job twice; it counts once");
  const second = run([], [item("s1", { weekOf: MON, missed: 1, missedOn: "2026-10-14" })], "2026-10-15");
  assert.deepEqual(second.updates[0]!.patch, { missed: 2, missed_on: "2026-10-15", status: "dropped", status_at: NOW, status_by: "system", note: "No longer applies (checked 15 Oct)" });
  assert.equal(second.dropped, 1);
  assert.equal(staleNote("2026-10-15"), "No longer applies (checked 15 Oct)");
  const noted = run([], [item("s1", { weekOf: MON, missed: 1, missedOn: "2026-10-14", note: "mine" })], "2026-10-15");
  assert.equal(noted.updates[0]!.patch.note, undefined, "a note someone wrote is never overwritten");
});

test("gathered again resets the count; only suggestions the system made go stale", () => {
  const back = run([c("s1")], [item("s1", { weekOf: MON, missed: 1, missedOn: "2026-10-14" })], "2026-10-15");
  assert.deepEqual(
    { missed: back.updates[0]!.patch.missed, missed_on: back.updates[0]!.patch.missed_on },
    { missed: 0, missed_on: null },
  );
  const moved = run([], [item("t1", { status: "todo", weekOf: MON }), item("own", { createdBy: "owner@example.com", weekOf: MON })], "2026-10-15");
  assert.deepEqual(moved.updates, []);
});

test("with any source failed, nothing is counted as gone", () => {
  const plan = run([], [item("s1", { weekOf: MON, missed: 1, missedOn: "2026-10-14" })], "2026-10-15", false);
  assert.deepEqual(plan.updates, []);
  assert.match(refreshNote(plan, ["tracking"]), /sources failed: tracking \(nothing counted as gone\)/);
});

test("the dedupe is idempotent: a run applied, then run again, asks for no insert", () => {
  const cands = [c("b1", { severity: "blocking" }), c("s1")];
  const first = run(cands, [], MON);
  const stored: Known[] = first.inserts.map((r, i) => item(String(r.dedupe_key), { id: `n${i}`, weekOf: (r.week_of as string | null) ?? null }));
  const second = run(cands, stored, MON);
  assert.equal(second.inserts.length, 0);
  assert.deepEqual(second.picked, [], "the week is already pinned");
  assert.ok(second.updates.every((u) => u.patch.status === undefined));
  const dupes = run([c("s1"), c("s1", { title: "second copy" })], [], WED);
  assert.equal(dupes.inserts.length, 1, "one key, one item, whichever source said it first");
});

test("a candidate that may not be stored is refused, and a href that leaves the dashboard is dropped", () => {
  assert.equal(cleanCandidate(c("x", { title: "  " })), null);
  assert.equal(cleanCandidate(c("x", { why: [] })), null);
  assert.equal(cleanCandidate(c("x", { kind: "own_task" })), null, "a task is a member's, never a source's");
  assert.equal(cleanCandidate(c("x", { kind: "nonsense" as Candidate["kind"] })), null);
  assert.equal(cleanCandidate(c("x", { grade: "proven" as Candidate["grade"] })), null);
  const odd = cleanCandidate(c("x", { href: "https://elsewhere.example/", why: [{ text: "a", href: "//elsewhere.example" }, { text: "b", href: "javascript:alert(1)" }, { text: "c", href: "/cited?open=a.example/b" }, { text: "d" }] }))!;
  assert.equal(odd.href, "");
  assert.deepEqual(odd.why, [{ text: "a" }, { text: "b" }, { text: "c", href: "/cited?open=a.example/b" }]);
  const plan = run([c("x", { title: "" })], [], WED);
  assert.equal(plan.skipped, 1);
});

test("a suggestion the system dropped comes back without its 'No longer applies' line; a member's note stays (review, 13 Oct 2026)", () => {
  // Gone on two runs: dropped with the dated line.
  let items: Known[] = [item("s1", { weekOf: MON })];
  for (const day of ["2026-10-14", "2026-10-15"]) {
    const plan = run([], items, day);
    const p = plan.updates[0]!.patch;
    items = items.map((i) => ({ ...i, missed: p.missed as number, missedOn: p.missed_on as string, ...(p.status ? { status: p.status as Known["status"], statusBy: "system", note: (p.note as string) ?? i.note } : {}) }));
  }
  assert.equal(items[0]!.status, "dropped");
  assert.equal(items[0]!.note, "No longer applies (checked 15 Oct)");
  // Gathered again: back as a suggestion, and the line is cleared.
  const back = run([c("s1")], items, "2026-10-16").updates[0]!.patch;
  assert.equal(back.status, "suggested");
  assert.equal(back.note, null);
  const mine = run([c("s1")], [{ ...items[0]!, note: "We asked about this" }], "2026-10-16").updates[0]!.patch;
  assert.equal(mine.status, "suggested");
  assert.equal("note" in mine, false, "a note someone wrote is never cleared");
  assert.equal(isStaleNote(staleNote("2026-10-15")), true);
  assert.equal(isStaleNote("No longer applies to us, see the call notes"), false, "only the system's exact line");
  assert.equal(isStaleNote(null), false);
});

test("'New since Monday' lasts its week: the next Monday's pick pins it as one of the three, and clears any left over (review, 13 Oct 2026)", () => {
  // A Blocking item joined on Wednesday 14 Oct, flagged; the Monday 19 Oct run pins the week again.
  const NEXT = "2026-10-19";
  const joined = item("b1", { weekOf: MON, newSinceMonday: true });
  const left = item("t1", { status: "todo", statusBy: "owner@example.com", weekOf: MON, newSinceMonday: true });
  const plan = run([c("b1", { severity: "blocking" }), c("s1")], [joined, left], NEXT);
  assert.deepEqual(plan.picked, ["b1", "s1"]);
  const b1 = plan.updates.find((u) => u.id === "id-b1")!.patch;
  assert.equal(b1.week_of, NEXT);
  assert.equal(b1.new_since_monday, false, "pinned on Monday is one of the three, not new");
  assert.equal(plan.updates.find((u) => u.id === "id-t1")!.patch.new_since_monday, false, "an item not picked again loses last week's flag too");
  assert.equal(plan.updates.filter((u) => u.id === "id-b1").length, 1, "one patch per item");
  // Mid-week, an item already flagged this week keeps it.
  const mid = run([c("b1", { severity: "blocking" })], [item("b1", { weekOf: NEXT, newSinceMonday: true })], "2026-10-21");
  assert.equal(mid.updates[0]!.patch.new_since_monday, undefined);
});

test("the candidate's tie-breaks are stored with it, so the board can take the weekly pick's order", () => {
  const plan = run([c("k1", { volume: 1900.4, evidenceOn: "2026-10-13" }), c("k2", { volume: -3, evidenceOn: "13 Oct" as never })], [], WED);
  const [k1, k2] = plan.inserts;
  assert.equal(k1!.volume, 1900);
  assert.equal(k1!.evidence_on, "2026-10-13");
  assert.equal(k2!.volume, null, "a volume that is not one is not stored");
  assert.equal(k2!.evidence_on, null);
});
