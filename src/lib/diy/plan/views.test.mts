import assert from "node:assert/strict";
import { test } from "node:test";

import type { Source } from "../core/evidence.ts";
import { SOURCES } from "../core/core.sources.ts";
import { DONE_RECENT, arrange, drawnView, filterItems, listSections, pickCluster, pickGroup, pickStatus, pickView } from "./board.ts";
import { noteLines, ownerName, stateLine } from "./card.ts";
import { planAction, planPath } from "./paths.ts";
import { AGENCY_OWNER, NOMADA_OWNER, ownerLabel, placementsGroup } from "./placements.ts";
import { type PlanItem, actLabel, clip, clientPath } from "./types.ts";
import { ADVICE } from "./why-first.advice.ts";
import { itemChip, whyFirst } from "./why-first.ts";
import { workLog } from "./worklog.ts";

const item = (id: string, o: Partial<PlanItem> = {}): PlanItem => ({
  id,
  clusterId: null,
  kind: "own_task",
  severity: "own",
  status: "todo",
  title: id,
  why: [],
  grade: null,
  sourceId: null,
  effort: null,
  href: null,
  refTable: null,
  refId: null,
  dedupeKey: `task:${id}`,
  weekOf: null,
  newSinceMonday: false,
  ownerEmail: null,
  note: null,
  hiddenUntil: null,
  createdBy: "owner@example.com",
  createdAt: "2026-10-01T00:00:00Z",
  statusAt: "2026-10-01T00:00:00Z",
  statusBy: null,
  startedOn: null,
  doneOn: null,
  verified: null,
  readoutBase: null,
  volume: null,
  evidenceOn: null,
  seenOn: null,
  missed: 0,
  missedOn: null,
  ...o,
});

test("the page's query keys are whitelists", () => {
  assert.equal(pickView("board"), "board");
  assert.equal(pickView("list"), "list");
  assert.equal(pickView("timeline"), null, "the timeline is deferred");
  assert.equal(pickView(null), null);
  assert.equal(pickStatus("dropped"), "dropped");
  assert.equal(pickStatus("archived"), null);
  assert.equal(pickGroup("pages"), "pages");
  assert.equal(pickGroup("links"), null);
  assert.equal(pickCluster("c1", ["c1", "c2"]), "c1");
  assert.equal(pickCluster("c9", ["c1", "c2"]), null);
});

test("the board: four columns in order, Suggested without the hidden ones, Dropped apart, and the empty states' facts", () => {
  const today = "2026-10-13";
  const all = [
    item("s1", { status: "suggested", severity: "gap", kind: "get_onto_page" }),
    item("s2", { status: "suggested", severity: "blocking", kind: "unblock_crawler" }),
    item("s3", { status: "suggested", severity: "slipping", kind: "recover_prompt", hiddenUntil: "2026-10-20" }),
    item("t1", { status: "todo", statusAt: "2026-10-02T00:00:00Z" }),
    item("t2", { status: "todo", statusAt: "2026-10-05T00:00:00Z", clusterId: "c1" }),
    item("d1", { status: "done", doneOn: "2026-09-01" }),
    item("d2", { status: "done", doneOn: "2026-09-20" }),
    item("x1", { status: "dropped" }),
  ];
  const a = arrange(all, { kind: null, cluster: null, status: null }, today);
  assert.deepEqual(
    a.columns.map((c) => [c.status, c.items.map((i) => i.id)]),
    [
      ["suggested", ["s2", "s1"]],
      ["todo", ["t2", "t1"]],
      ["doing", []],
      ["done", ["d2", "d1"]],
    ],
  );
  assert.equal(a.hidden, 1);
  assert.deepEqual(a.dropped.map((i) => i.id), ["x1"]);
  assert.equal(a.nothingOpen, false);
  assert.deepEqual(arrange(all, { kind: "tasks", cluster: "c1", status: null }, today).columns.flatMap((c) => c.items.map((i) => i.id)), ["t2"]);
  assert.deepEqual(arrange(all, { kind: null, cluster: null, status: "dropped" }, today).columns, [], "Dropped is listed, not a column");
  assert.deepEqual(arrange(all, { kind: null, cluster: null, status: "done" }, today).columns.map((c) => c.status), ["done"]);
  assert.equal(arrange([item("d", { status: "done" }), item("h", { status: "suggested", hiddenUntil: "2026-10-20" })], { kind: null, cluster: null, status: null }, today).nothingOpen, true);
  assert.equal(arrange([], { kind: null, cluster: null, status: null }, today).none, true);
  assert.deepEqual(filterItems(all, { kind: "opportunities", cluster: null, status: null }).map((i) => i.id), ["s1"]);
});

test("the Placements group's owner: nomada digital, or Your account contact in agency mode - never Nomada's name there", () => {
  assert.equal(ownerLabel("nomada"), NOMADA_OWNER);
  assert.equal(NOMADA_OWNER, "nomada digital");
  assert.equal(ownerLabel("agency"), AGENCY_OWNER);
  assert.equal(AGENCY_OWNER, "Your account contact");
  assert.doesNotMatch(ownerLabel("agency"), /nomada/i);
  assert.equal(ownerLabel("off"), NOMADA_OWNER, "off is Nomada's own account with no prompts");
});

test("the Placements group: live newest first, then scheduled soonest first; nothing pitched, written or removed", () => {
  const names = new Map([["c1", "accounting app for freelancers"]]);
  const rows = placementsGroup(
    [
      { id: "a", cluster_id: "c1", url_key: "thesmallbizstack.com/best-accounting-apps", url: "https://thesmallbizstack.com/best-accounting-apps", status: "live", scheduled_on: null, live_on: "2026-08-12" },
      { id: "b", cluster_id: "c1", url_key: "freelancefieldnotes.com/bookkeeping-tools", url: "", status: "live", scheduled_on: null, live_on: "2026-09-02" },
      { id: "c", cluster_id: "c1", url_key: "x.example/s", url: "", status: "scheduled", scheduled_on: "2026-10-02", live_on: null },
      { id: "d", cluster_id: "c1", url_key: "x.example/w", url: "", status: "writing", scheduled_on: null, live_on: null },
      { id: "e", cluster_id: "c1", url_key: "x.example/r", url: "", status: "removed", scheduled_on: null, live_on: "2026-08-01" },
    ],
    names,
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.when]),
    [
      ["b", "Live since 2 Sep"],
      ["a", "Live since 12 Aug"],
      ["c", "Scheduled for 2 Oct"],
    ],
  );
  assert.equal(rows[0]!.cluster, "accounting app for freelancers");
});

test("'Why this is first': one fixed line per severity; Blocking's is Google's own, graded and sourced; a task has none", () => {
  assert.equal(ADVICE.length, 5);
  const b = whyFirst("blocking")!;
  assert.equal(b.chip.label, "Google documents this");
  assert.equal(b.chip.note, "Google, Search Central, AI features and your website, updated 10 Dec 2025");
  assert.match(b.text, /^Blocking comes first: Google says a page must be crawlable to appear in its AI features/);
  assert.equal(whyFirst("slipping")!.chip.label, "Seen in your data");
  assert.equal(whyFirst("tidy")!.chip.label, "Common practice");
  assert.equal(whyFirst("own"), null);
});

test("a line or chip whose source stops being verified does not render", () => {
  const unverified: Source[] = SOURCES.map((s) => (s.id === "S41" ? { ...s, verified: false } : s));
  assert.equal(whyFirst("blocking", unverified), null);
  assert.equal(itemChip({ grade: "documented", sourceId: "S41" }, unverified), null);
  assert.equal(itemChip({ grade: "documented", sourceId: "S43" }), null, "an internal source is never cited");
  assert.equal(itemChip({ grade: null, sourceId: null }), null);
  assert.equal(itemChip({ grade: "your_data", sourceId: null })!.label, "Seen in your data");
});

test("the work log: the last 30 days, newest first, each under 21 days too early to read", () => {
  const log = workLog({
    today: "2026-10-13",
    items: [
      item("a", { status: "done", doneOn: "2026-10-10", title: "Add schema", verified: { by: "j", at: "2026-10-12", text: "Verified: Organization found with name, url, logo, 12 Oct" } }),
      item("b", { status: "done", doneOn: "2026-09-15", title: "Old one" }),
      item("c", { status: "done", doneOn: "2026-09-01", title: "Too old" }),
      item("d", { status: "doing", doneOn: null }),
    ],
    placements: [{ url_key: "x.example/list", status: "live", live_on: "2026-09-20" }, { url_key: "x.example/y", status: "removed", live_on: "2026-10-01" }],
    prompts: [{ day: "2026-10-11", text: "Which invoicing app is best?", origin: "Opportunity" }],
  });
  assert.deepEqual(
    log.map((e) => [e.day, e.kind, e.early]),
    [
      ["2026-10-12", "verified", true],
      ["2026-10-11", "prompt", true],
      ["2026-10-10", "done", true],
      ["2026-09-20", "placement", false],
      ["2026-09-15", "done", false],
    ],
  );
  assert.equal(log[2]!.text, "Done: Add schema");
});

test("paths: built through appPath, the action names the plan route and carries the item and the way back", () => {
  assert.equal(planPath("tallyroo", { view: "list", status: "done" }), "/app/tallyroo/plan?view=list&status=done");
  assert.equal(planPath("tallyroo", {}, "#new-task"), "/app/tallyroo/plan#new-task");
  assert.equal(planAction("tallyroo", { id: "pi-1", back: "overview" }), "/api/app/tallyroo/plan?id=pi-1&back=overview");
  assert.equal(planAction("tallyroo", {}), "/api/app/tallyroo/plan");
});

test("copy helpers: a title cut at a word under 70; the primary button per kind; dashboard paths only", () => {
  const t = clip("Get named again for 'Which bookkeeping software makes tax season easiest for freelancers?'", 70);
  assert.ok(t.length <= 70);
  assert.match(t, /…$/);
  assert.equal(actLabel("add_schema"), "Open fix");
  assert.equal(actLabel("get_onto_page"), "Open brief");
  assert.equal(actLabel("track_keyword"), "Track");
  assert.equal(actLabel("rework_page"), "See the example");
  assert.equal(actLabel("own_task"), "Open in Actions");
  assert.equal(actLabel("recover_prompt"), "Open the cluster");
  assert.equal(clientPath("/clusters/c1?prompt=2"), "/clusters/c1?prompt=2");
  for (const bad of ["//x.example", "https://x.example", "javascript:alert(1)", "/\\x.example", "clusters", "/a:b", 42]) assert.equal(clientPath(bad), null, String(bad));
});

test("Suggested takes section 6.1's order, the weekly pick's: severity, then volume, then effort, then the newest evidence (review, 13 Oct 2026)", () => {
  const s = (id: string, o: Partial<PlanItem>) => item(id, { status: "suggested", severity: "slipping", kind: "recover_keyword", dedupeKey: `kw:${id}`, ...o });
  const all = [
    s("old-low", { volume: 90, effort: "hour", evidenceOn: "2026-10-10", createdAt: "2026-09-01T00:00:00Z" }),
    s("big", { volume: 1900, effort: "days", evidenceOn: "2026-10-01" }),
    s("quick", { volume: 90, effort: "minutes", evidenceOn: "2026-10-01" }),
    s("newer", { volume: 90, effort: "hour", evidenceOn: "2026-10-12", createdAt: "2026-10-12T00:00:00Z" }),
    s("block", { severity: "blocking", kind: "unblock_crawler", volume: null, effort: null }),
    s("tidy", { severity: "tidy", kind: "add_schema", volume: 5000, effort: "minutes" }),
  ];
  const col = arrange(all, { kind: null, cluster: null, status: null }, "2026-10-13").columns[0]!;
  assert.deepEqual(col.items.map((i) => i.id), ["block", "big", "quick", "newer", "old-low", "tidy"]);
});

test("the owner line: You only for the viewer, a member's name otherwise, nothing when nobody is assigned (review, 13 Oct 2026)", () => {
  const team = [{ email: "Editor@example.com", name: "Sam" }, { email: "owner@example.com", name: null }];
  assert.equal(ownerName(null, "owner@example.com", team), null, "unassigned is nobody's, not every viewer's");
  assert.equal(ownerName("OWNER@example.com", "owner@example.com", team), "You");
  assert.equal(ownerName("editor@example.com", "owner@example.com", team), "Sam");
  assert.equal(ownerName("owner@example.com", "viewer@example.com", team), "owner@example.com");
  assert.equal(ownerName("gone@example.com", "owner@example.com", null), "gone@example.com");
});

test("the note lines: the system's 'No longer applies' only on an item it dropped, never as a member's note (review, 13 Oct 2026)", () => {
  const at = "2026-09-27T03:31:00Z";
  assert.deepEqual(noteLines({ status: "dropped", statusBy: "system", statusAt: at, note: "No longer applies (checked 27 Sep)" }), { note: null, stale: "No longer applies (checked 27 Sep)" });
  assert.deepEqual(noteLines({ status: "dropped", statusBy: "system", statusAt: at, note: "Ask Sam" }), { note: "Ask Sam", stale: "No longer applies (checked 27 Sep)" });
  assert.deepEqual(noteLines({ status: "todo", statusBy: "owner@example.com", statusAt: at, note: "No longer applies (checked 27 Sep)" }), { note: null, stale: null }, "a live card never says it no longer applies");
  assert.deepEqual(noteLines({ status: "dropped", statusBy: "owner@example.com", statusAt: at, note: "Not for us right now" }), { note: "Not for us right now", stale: null });
});

// 13 Oct 2026 (Danny): Actions is simple by default - the list at every width, the board an option.
test("the default view is the list; the board only when asked for, and never for Dropped", () => {
  assert.equal(drawnView(null, null), "list");
  assert.equal(drawnView("list", null), "list");
  assert.equal(drawnView("board", null), "board");
  assert.equal(drawnView("board", "todo"), "board");
  assert.equal(drawnView("board", "dropped"), "list", "Dropped is a list");
});

test("the list's sections: Suggested best first, In progress Doing then To do, Done the newest few, each filtered out by a status", () => {
  const today = "2026-10-13";
  const all = [
    item("s1", { status: "suggested", severity: "gap", kind: "get_onto_page" }),
    item("s2", { status: "suggested", severity: "blocking", kind: "unblock_crawler" }),
    item("t1", { status: "todo", statusAt: "2026-10-02T00:00:00Z" }),
    item("t2", { status: "todo", statusAt: "2026-10-05T00:00:00Z" }),
    item("g1", { status: "doing", statusAt: "2026-10-01T00:00:00Z", startedOn: "2026-10-01" }),
    ...Array.from({ length: DONE_RECENT + 2 }, (_, i) => item(`d${i}`, { status: "done", doneOn: `2026-09-${String(10 + i).padStart(2, "0")}` })),
    item("x1", { status: "dropped" }),
  ];
  const none = { kind: null, cluster: null, status: null };
  const s = listSections(arrange(all, none, today), null);
  assert.deepEqual(s.suggested!.map((i) => i.id), ["s2", "s1"]);
  assert.deepEqual(s.progress!.map((i) => i.id), ["g1", "t2", "t1"], "Doing first, then To do, each newest change first");
  assert.equal(s.done!.of, DONE_RECENT + 2);
  assert.deepEqual(s.done!.items.map((i) => i.id), ["d6", "d5", "d4", "d3", "d2"], "the most recent few");
  const done = listSections(arrange(all, { ...none, status: "done" }, today), "done");
  assert.equal(done.done!.items.length, DONE_RECENT + 2, "status=done lists every one");
  assert.equal(done.suggested, null);
  assert.equal(done.progress, null);
  const todo = listSections(arrange(all, { ...none, status: "todo" }, today), "todo");
  assert.deepEqual(todo.progress!.map((i) => i.id), ["t2", "t1"]);
  assert.equal(todo.done, null);
  const dropped = listSections(arrange(all, { ...none, status: "dropped" }, today), "dropped");
  assert.deepEqual([dropped.suggested, dropped.progress, dropped.done], [null, null, null], "Dropped is drawn apart");
  const empty = listSections(arrange([], none, today), null);
  assert.deepEqual([empty.suggested, empty.progress, empty.done?.items], [[], [], []], "every section drawn, each with its empty line");
});

test("In progress says each card's state in words", () => {
  assert.equal(stateLine({ status: "todo", startedOn: null }), "To do");
  assert.equal(stateLine({ status: "doing", startedOn: "2026-10-03" }), "Doing since 3 Oct");
  assert.equal(stateLine({ status: "doing", startedOn: null }), "Doing");
});
