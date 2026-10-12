/**
 * C2 of docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md (Danny, 29 Sep
 * 2026): alwaystracked's limits on the server. One test per refusal, then the
 * census that every insert into tracked_questions, tracked_keywords and
 * tracked_clusters goes through limits.ts.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { promptsDb } from "../diy/prompts/fake-prompts-db.mts";
import { ANGLES, PLACEMENT_FULL, PLACEMENT_PROMPTS_PER_CLIENT, angleFor, clusterLimitFor, groupPrompts, insertPrompts, livePromptCount, missingColumn, promptRoom, readPromptRoom, refuseCluster, refuseEdit, refuseGrouping, refuseKeyword, refusePlacementPrompts, refusePrompts } from "./limits.ts";

test("clusters: refused at cluster_limit live, allowed under it", () => {
  assert.equal(refuseCluster(9, 10), null);
  assert.match(refuseCluster(10, 10) ?? "", /limit of 10 clusters/);
  assert.match(refuseCluster(11, 10) ?? "", /limit/);
  assert.equal(refuseCluster(14, 15), null, "one pack: 15");
});

test("prompts: refused when the cluster already has 5 live", () => {
  assert.equal(refusePrompts({ clientLive: 4, clusterLive: 4, clusterLimit: 10 }), null);
  assert.match(refusePrompts({ clientLive: 5, clusterLive: 5, clusterLimit: 10 }) ?? "", /5 of 5/);
  assert.match(refusePrompts({ clientLive: 3, clusterLive: 3, clusterLimit: 10 }, 3) ?? "", /already has 3 of 5/, "a batch that overflows the cluster");
});

test("prompts: ungrouped ones count against the client's 5 per cluster (R111: 5 grouped + 9 ungrouped is fine)", () => {
  assert.equal(refusePrompts({ clientLive: 5, clusterLive: null, clusterLimit: 10 }, 9), null);
  assert.equal(refusePrompts({ clientLive: 49, clusterLive: null, clusterLimit: 10 }), null);
  assert.match(refusePrompts({ clientLive: 50, clusterLive: null, clusterLimit: 10 }) ?? "", /limit of 50 prompts/);
  assert.equal(promptRoom({ clientLive: 46, clusterLive: null, clusterLimit: 10 }), 4);
  assert.equal(promptRoom({ clientLive: 10, clusterLive: 3, clusterLimit: 10 }), 2);
  assert.equal(promptRoom({ clientLive: 60, clusterLive: null, clusterLimit: 10 }), 0, "never negative");
});

test("keywords: refused when the cluster already has one live, or at one per cluster", () => {
  assert.equal(refuseKeyword({ clientLive: 0, clusterHasLive: false, clusterLimit: 10 }), null);
  assert.match(refuseKeyword({ clientLive: 1, clusterHasLive: true, clusterLimit: 10 }) ?? "", /already has its keyword/);
  assert.equal(refuseKeyword({ clientLive: 9, clusterHasLive: null, clusterLimit: 10 }), null);
  assert.match(refuseKeyword({ clientLive: 10, clusterHasLive: null, clusterLimit: 10 }) ?? "", /limit of 10 keywords/);
});

test("editing: text is refused once any reading exists", () => {
  assert.equal(refuseEdit(0), null);
  assert.match(refuseEdit(1) ?? "", /Stop it and add a new one/);
});

// C3 grouping, and R111 (Danny, 29 Sep 2026): 14 prompts as 5+5+4, or 5 grouped + 9 ungrouped.
const fourteen = Array.from({ length: 14 }, (_, i) => `p${i}`);

/** Group in turn, as admin does: each batch is judged against what is still ungrouped. */
function groupInTurn(batches: string[][]): (string | null)[] {
  const ungrouped = new Set(fourteen);
  return batches.map((ids) => {
    const refused = refuseGrouping({ ids, ungrouped, clusterLive: 0 });
    if (!refused) ids.forEach((id) => ungrouped.delete(id));
    return refused;
  });
}

test("grouping (R111): 14 prompts as clusters of 5, 5 and 4 with none left over", () => {
  assert.deepEqual(groupInTurn([fourteen.slice(0, 5), fourteen.slice(5, 10), fourteen.slice(10)]), [null, null, null]);
});

test("grouping (R111): 5 grouped and 9 left ungrouped is allowed, and the 9 still fit the client's allowance", () => {
  assert.deepEqual(groupInTurn([fourteen.slice(0, 5)]), [null]);
  assert.equal(refusePrompts({ clientLive: 14, clusterLive: null, clusterLimit: 10 }), null, "the ungrouped 9 are live prompts, counted, not refused");
});

test("grouping: refused past 5 in a cluster, for a prompt already grouped, twice, or none", () => {
  const ungrouped = new Set(fourteen);
  assert.match(refuseGrouping({ ids: fourteen.slice(0, 6), ungrouped, clusterLive: 0 }) ?? "", /pass 5/);
  assert.match(refuseGrouping({ ids: ["p0", "p1"], ungrouped, clusterLive: 4 }) ?? "", /has 4 live/);
  assert.match(refuseGrouping({ ids: ["elsewhere"], ungrouped, clusterLive: 0 }) ?? "", /ungrouped/);
  assert.match(refuseGrouping({ ids: ["p0", "p0"], ungrouped, clusterLive: 0 }) ?? "", /twice/);
  assert.match(refuseGrouping({ ids: [], ungrouped, clusterLive: 0 }) ?? "", /at least one/);
  assert.match(groupInTurn([fourteen.slice(0, 5), fourteen.slice(3, 8)])[1] ?? "", /ungrouped/, "a prompt in one cluster is not grouped again");
});

test("grouping (R111): the daily runner reads prompts by client, never by cluster, so ungrouped ones still get readings", () => {
  // 9 Oct 2026 (audit reliability-2): the dispatch's live-prompt count moved
  // from runner.ts to run-health.ts readTrackable, paged, which the dispatch
  // and the run-health readings share. Same two reads, one file further.
  const src = ["./runner.ts", "./run-health.ts"].map((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8")).join("\n");
  const reads = [...src.matchAll(/\.from\("tracked_questions"\)[^;]*/g)].map((m) => m[0]);
  assert.ok(reads.length >= 2, `found ${reads.length} tracked_questions reads in runner.ts and run-health.ts, floor 2`);
  for (const r of reads) assert.doesNotMatch(r, /cluster_id/, r);
});

test("angles: a scan kind is its angle, anything else is none", () => {
  for (const a of ANGLES) assert.equal(angleFor(a), a);
  assert.equal(angleFor("informational"), null);
  assert.equal(angleFor(null), null);
});

test("the pack: cluster_limit = 10 + 5 per pack", () => {
  assert.equal(clusterLimitFor(0), 10);
  assert.equal(clusterLimitFor(1), 15);
  assert.equal(clusterLimitFor(3), 25);
  assert.equal(clusterLimitFor(-1), 10);
  assert.equal(clusterLimitFor(Number.NaN), 10);
});

// ---- The placement allowance. ----

/**
 * 13 Oct 2026, DIY P2: placement prompts counted in their own allowance, 10
 * live per client until a placed run is measured under 240 s; Danny's 12 Oct
 * call ("prompts come from placements"). They sit outside the 5 angle slots and
 * the client's cluster_limit x 5, so the angle-slot and client counts leave
 * them out, and only insertPrompts(..., { allowance: "placement" }) counts
 * them. The three writers, and the census below, are unchanged.
 */
test("the placement allowance: 10 live per client, refused at the 11th, in the spec's words", () => {
  assert.equal(PLACEMENT_PROMPTS_PER_CLIENT, 10);
  assert.equal(refusePlacementPrompts(9), null);
  assert.equal(refusePlacementPrompts(10), "Placement prompt allowance full (10)");
  assert.equal(PLACEMENT_FULL, "Placement prompt allowance full (10)");
  assert.equal(refusePlacementPrompts(8, 3), PLACEMENT_FULL, "a batch that overflows");
});

const day = "2026-09-30";
/** A placed client: c1 holds its 5 angle prompts and 3 placement prompts, c2 two angle prompts and 7 placement prompts. */
function placedClient() {
  const q = (id: string, cluster: string, allowance: string | null, text = id) => ({ id, client_domain_id: "cl", cluster_id: cluster, text, source: allowance ? "nomada" : "client", added_on: day, added_by: "nomada", stopped_on: null, allowance });
  return promptsDb({
    client_domains: [{ id: "cl", cluster_limit: 10 }],
    tracked_questions: [
      ...ANGLES.map((a) => q(`c1-${a}`, "c1", null)),
      ...[1, 2, 3].map((n) => q(`c1-pl${n}`, "c1", "placement")),
      q("c2-a", "c2", null),
      q("c2-b", "c2", null),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => q(`c2-pl${n}`, "c2", "placement")),
      { ...q("gone", "c2", "placement"), stopped_on: "2026-09-01" },
    ],
  });
}
const placementRow = (text: string) => ({ text, source: "nomada", added_on: day, added_by: "nomada", origin_kind: "placement" as const, origin_ref: "p-x" });

test("room counting: the angle slots and the client's total leave placement prompts out", async () => {
  const { db } = placedClient();
  const c1 = await readPromptRoom(db, "cl", "c1");
  assert.ok(typeof c1 !== "string");
  assert.deepEqual(c1.limits, { clientLive: 7, clusterLive: 5, clusterLimit: 10 }, "5 + 2 angle prompts; the 10 placement prompts are not counted");
  assert.equal(await livePromptCount(db, "client_domain_id", "cl", "placement"), 10, "a stopped one is not live");
  const c2 = await readPromptRoom(db, "cl", "c2");
  assert.ok(typeof c2 !== "string");
  assert.equal(c2.room, 3, "c2 has 7 placement prompts and still 3 free angle slots");
});

test("room counting: a placement prompt fits beside 5 full angle slots, until the client's 10th, across clusters", async () => {
  const { db, tables } = placedClient();
  // 10 live already (3 in c1, 7 in c2): the 11th is refused, wherever it goes.
  assert.deepEqual(await insertPrompts(db, "cl", "c1", [placementRow("best accounting apps for small businesses")], { allowance: "placement" }), { ok: false, message: PLACEMENT_FULL });
  tables.tracked_questions!.find((r) => r.id === "c2-pl1")!.stopped_on = day;
  const ok = await insertPrompts(db, "cl", "c1", [placementRow("best accounting apps for small businesses")], { allowance: "placement" });
  assert.equal(ok.ok, true, "c1's angle slots are full, and it does not matter");
  const row = tables.tracked_questions!.find((r) => ok.ok && r.id === ok.ids[0])!;
  assert.equal(row.allowance, "placement");
  assert.equal(row.origin_kind, "placement");
  assert.equal(row.cluster_id, "c1");
  // The angle slots are unaffected: c1 is still full for an angle prompt, c2 still has room.
  const angle = await insertPrompts(db, "cl", "c1", [{ text: "Another prompt about apps", source: "client", added_on: day, added_by: "x" }]);
  assert.deepEqual(angle, { ok: false, message: "That cluster already has 5 of 5 live prompts." });
  assert.equal((await insertPrompts(db, "cl", "c2", [{ text: "Another prompt about apps", source: "client", added_on: day, added_by: "x" }])).ok, true);
});

test("a row's own allowance is never written: the pool is insertPrompts' opts, so a row lands where it was counted", async () => {
  const { db, tables } = placedClient();
  const w = await insertPrompts(db, "cl", "c2", [{ ...placementRow("a prompt that claims the pool"), allowance: "placement" }]);
  assert.equal(w.ok, true);
  assert.equal(tables.tracked_questions!.find((r) => w.ok && r.id === w.ids[0])!.allowance ?? null, null, "counted as an angle prompt, written as one");
  assert.deepEqual(await insertPrompts(db, "cl", null, [placementRow("ungrouped placement prompt")], { allowance: "placement" }), { ok: false, message: "A placement prompt goes in its placement's cluster." });
});

test("grouping into a cluster counts its angle prompts only", async () => {
  const { db, tables } = placedClient();
  tables.tracked_questions!.push({ id: "loose", client_domain_id: "cl", cluster_id: null, text: "loose prompt here", source: "client", added_on: day, stopped_on: null, angle: null, allowance: null });
  const g = await groupPrompts(db, "cl", "c2", ["loose"]);
  assert.equal(g.ok, true, "c2 has 2 angle prompts and 7 placement ones: the move fits");
});

test("before the prompt_origins migration: no allowance column, so every live prompt is a slot prompt and none a placement one", async () => {
  const { db } = promptsDb(
    {
      client_domains: [{ id: "cl", cluster_limit: 10 }],
      tracked_questions: ANGLES.slice(0, 3).map((a) => ({ id: a, client_domain_id: "cl", cluster_id: "c1", text: a, source: "client", added_on: day, stopped_on: null })),
    },
    { columns: { tracked_questions: ["id", "client_domain_id", "cluster_id", "text", "source", "added_on", "added_by", "stopped_on", "stopped_by", "angle"] } },
  );
  assert.equal(await livePromptCount(db, "cluster_id", "c1", "slots"), 3);
  assert.equal(await livePromptCount(db, "client_domain_id", "cl", "placement"), 0);
  assert.equal((await insertPrompts(db, "cl", "c1", [{ text: "A plain new prompt", source: "client", added_on: day, added_by: "x" }])).ok, true, "a writer setting no origin still inserts");
  const p = await insertPrompts(db, "cl", "c1", [placementRow("best accounting apps for small businesses")], { allowance: "placement" });
  assert.equal(p.ok, false, "a placement prompt cannot be written before its columns exist");
  assert.equal(missingColumn({ code: "42703", message: "column tracked_questions.allowance does not exist" }), true);
  assert.equal(missingColumn({ code: "PGRST204", message: "Could not find the 'origin_kind' column of 'tracked_questions' in the schema cache" }), true);
  assert.equal(missingColumn({ code: "57014", message: "canceling statement due to statement timeout" }), false);
  assert.equal(missingColumn(null), false);
});

// ---- The census. ----

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const TABLES = ["tracked_questions", "tracked_keywords", "tracked_clusters"];
const HOME = "src/lib/tracking/limits.ts";
/** `.from(` chains walked across src. 29 Sep 2026: 165. */
const FLOOR = 150;

function walk(dir: string): string[] {
  const st = statSync(dir);
  if (!st.isDirectory()) return [dir];
  return readdirSync(dir).flatMap((f) => walk(join(dir, f)));
}

/**
 * Every write chain that could land in one of the three tables: a `.from()`
 * of one of them followed by insert/upsert before the statement ends, or a
 * `.from(variable)` insert in a file that names one of them at all - the
 * indirection the old admin action used.
 */
export function strayWrites(source: string): string[] {
  const out: string[] = [];
  const namesTable = TABLES.some((t) => source.includes(`"${t}"`));
  for (const m of source.matchAll(/\.from\(\s*([^)]*?)\s*\)([^;]*)/g)) {
    if (!/\.(insert|upsert)\(/.test(m[2])) continue;
    const arg = m[1];
    const literal = /^["'`]([a-z_]+)["'`]$/.exec(arg)?.[1];
    if (literal ? TABLES.includes(literal) : namesTable) out.push(arg);
  }
  return out;
}

function chains(): { file: string; source: string; count: number }[] {
  return walk(join(ROOT, "src"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.m?ts$/.test(f))
    .map((f) => {
      const source = readFileSync(f, "utf8");
      return { file: relative(ROOT, f), source, count: [...source.matchAll(/\.from\(/g)].length };
    });
}

test("census: every insert into the three tracked tables goes through limits.ts", () => {
  const files = chains();
  const walked = files.reduce((n, f) => n + f.count, 0);
  assert.ok(walked >= FLOOR, `walked ${walked} .from( chains, floor ${FLOOR} - the walk has stopped matching`);
  const stray = files.filter((f) => f.file !== HOME).flatMap((f) => strayWrites(f.source).map((a) => `${f.file}: .from(${a})`));
  assert.deepEqual(stray, [], "write to a tracked table outside limits.ts");
  assert.equal(strayWrites(readFileSync(join(ROOT, HOME), "utf8")).length, 3, "limits.ts holds the three writers");
});

test("census probe: a direct insert and a variable-table insert both fire", () => {
  assert.deepEqual(strayWrites(`await db.from("tracked_questions").insert(rows);`), ['"tracked_questions"']);
  assert.deepEqual(strayWrites(`const t = "tracked_keywords";\nawait db.from(t).insert({ keyword });`), ["t"]);
  assert.deepEqual(strayWrites(`await db.from("tracked_clusters")\n  .upsert(row, { onConflict: "id" })\n  .select("id");`), ['"tracked_clusters"']);
  assert.deepEqual(strayWrites(`await db.from("tracked_questions").select("id").eq("x", 1);`), [], "a read is not a write");
  assert.deepEqual(strayWrites(`await db.from("scan_questions").insert(rows);`), [], "another table");
});
