import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PromptOrigin } from "../prompts/origins.ts";
import { WEEK_READ_MAX, badgeWords, marksFor, promptsAdded, readWeekItems, workMarks } from "./work.ts";

/** The wave 1 shell's wiring between the packages (13 Oct 2026, DIY P5; spec 10 sections 3.1, 4.1 and 4.2). */

test("the badge says done of pinned this week, and nothing when nothing is pinned", () => {
  assert.equal(badgeWords({ done: 2, of: 3 }), "2 of 3 this week");
  assert.equal(badgeWords({ done: 0, of: 1 }), "0 of 1 this week");
  assert.equal(badgeWords({ done: 0, of: 0 }), null, "0 of 0 is not a badge");
});

/** A PostgREST stand-in that records the chain and answers with `rows` or `error`. */
function fake(rows: Record<string, unknown>[] | null, error: { message: string } | null = null) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit"]) {
    chain[m] = (...a: unknown[]) => {
      calls.push(`${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
      return m === "limit" ? Promise.resolve({ data: rows, error }) : chain;
    };
  }
  const db = { from: (t: string) => (calls.push(`from(${t})`), chain) } as unknown as SupabaseClient;
  return { db, calls };
}

const row = (o: Record<string, unknown>) => ({ id: "p1", kind: "own_task", severity: "own", status: "todo", title: "Write the page", dedupe_key: "own:1", created_by: "a@example.com", ...o });

test("the badge's read is this client's rows pinned to this Monday, bounded, and a failure throws", async () => {
  const f = fake([row({ week_of: "2026-10-12" }), row({ id: "p2", kind: "nope" })]);
  const items = await readWeekItems(f.db, "client-1", "2026-10-14");
  assert.deepEqual(items.map((i) => i.id), ["p1"], "a row the table would not allow is dropped, as itemOf drops it");
  assert.ok(f.calls.includes('from(plan_items)'));
  assert.ok(f.calls.includes('eq("client_domain_id","client-1")'), "one client's rows");
  assert.ok(f.calls.includes('eq("week_of","2026-10-12")'), "Wednesday 14 Oct reads Monday 12 Oct's week");
  assert.ok(f.calls.includes(`limit(${WEEK_READ_MAX})`));
  await assert.rejects(readWeekItems(fake(null, { message: 'relation "plan_items" does not exist' }).db, "client-1", "2026-10-14"), /could not read this week's actions/);
});

const items = [
  { title: "Rework the pricing page", status: "done" as const, clusterId: "c1", startedOn: "2026-09-10", doneOn: "2026-09-20" },
  { title: "Add Organization schema", status: "doing" as const, clusterId: "c2", startedOn: "2026-09-22", doneOn: null },
  { title: "Was dropped", status: "dropped" as const, clusterId: "c1", startedOn: "2026-09-12", doneOn: null },
  { title: "Own task", status: "done" as const, clusterId: null, startedOn: null, doneOn: "2026-09-25" },
];
const placements = [
  { url_key: "smallbizstack.example/best-invoicing", status: "live", live_on: "2026-09-18", cluster_id: "c1" },
  { url_key: "other.example/list", status: "scheduled", live_on: null, cluster_id: "c1" },
];

test("work marks: started and done items, placements live, each on its cluster; a dropped item marks nothing", () => {
  const marks = workMarks({ slug: "tallyroo", items, placements });
  assert.deepEqual(
    marks.map((m) => [m.date, m.kind, m.label, m.cluster]),
    [
      ["2026-09-10", "started", "Rework the pricing page", "c1"],
      ["2026-09-18", "placement", "smallbizstack.example/best-invoicing", "c1"],
      ["2026-09-20", "done", "Rework the pricing page", "c1"],
      ["2026-09-22", "started", "Add Organization schema", "c2"],
      ["2026-09-25", "done", "Own task", null],
    ],
  );
  const pricing = marks.find((m) => m.kind === "done" && m.cluster === "c1")!;
  assert.match(pricing.href!, /\/tallyroo\/plan\?view=list&cluster=c1$/, "a work marker opens Actions on its cluster (section 4.1 row 8)");
  assert.match(marks.find((m) => m.kind === "placement")!.href!, /\/tallyroo\/placements$/);
  assert.match(marks.find((m) => m.cluster === null)!.href!, /\/tallyroo\/plan\?view=list$/);
});

test("AI visibility's marks are done items and placements only; its prompt markers are its own", () => {
  const marks = workMarks({ slug: "tallyroo", items, placements, kinds: ["done", "placement"] });
  assert.deepEqual([...new Set(marks.map((m) => m.kind))].sort(), ["done", "placement"]);
});

test("a cluster's chart draws its own work; the whole client's draws all of it, and no chart is handed the cluster field", () => {
  const marks = workMarks({ slug: "tallyroo", items, placements });
  assert.deepEqual(marksFor(marks, "c1").map((m) => m.label), ["Rework the pricing page", "smallbizstack.example/best-invoicing", "Rework the pricing page"]);
  assert.equal(marksFor(marks, null).length, marks.length);
  assert.ok(marksFor(marks, null).every((m) => !("cluster" in m)));
});

const origin = (kind: PromptOrigin["kind"], domain: string | null = null): PromptOrigin => ({ kind, ref: null, placement: kind === "placement", domain });

test("the work log lists prompts added after the first day with their origin; setup and unread origins are left out", () => {
  const questions = [
    { id: "q1", text: "best invoicing app", added_on: "2026-09-01" },
    { id: "q2", text: "invoicing for freelancers", added_on: "2026-09-20" },
    { id: "q3", text: "best payroll tools", added_on: "2026-09-21" },
    { id: "q4", text: "no origin read", added_on: "2026-09-22" },
    { id: "q5", text: "a setup prompt added late", added_on: "2026-09-23" },
  ];
  const origins = new Map([
    ["q1", origin("client")],
    ["q2", origin("client")],
    ["q3", origin("nomada")],
    ["q5", origin("setup")],
  ]);
  assert.deepEqual(promptsAdded({ questions, origins, mode: "nomada", startedOn: "2026-09-01" }), [
    { day: "2026-09-20", text: "invoicing for freelancers", origin: "You" },
    { day: "2026-09-21", text: "best payroll tools", origin: "nomada digital" },
  ]);
  const agency = promptsAdded({ questions, origins, mode: "agency", startedOn: "2026-09-01" });
  assert.ok(agency.every((p) => !/nomada/i.test(p.origin)), "agency mode never names Nomada");
  assert.equal(agency.find((p) => p.text === "best payroll tools")!.origin, "Your account contact");
});
