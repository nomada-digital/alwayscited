import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkspace } from "./model.ts";
import { sampleRaw } from "./sample-world.ts";

const PLAN = { promptsPerCluster: 5, keywordsPerCluster: 1 };
const TODAY = "2026-11-18";

/** Where the client sits (18 Nov 2026): first, top 3 and the average place on the latest reading, over the core prompts. */
test("the latest reading's place figures are the core answers', counted by hand", () => {
  const raw = sampleRaw(TODAY);
  const ws = buildWorkspace(raw, { plan: PLAN });
  const latest = ws.lastRun!.run_date;
  const core = new Set(raw.prompts.filter((p) => (p.prompt_tier ?? 1) === 1).map((p) => p.id));
  const on = raw.answers.filter((a) => a.run_date === latest && core.has(a.question_id) && a.answered);
  const ranked = on.filter((a) => a.named && a.list_pos);
  assert.equal(ws.place.answered, on.length);
  assert.equal(ws.place.first, ranked.filter((a) => a.list_pos === 1).length);
  assert.equal(ws.place.top3, ranked.filter((a) => a.list_pos! <= 3).length);
  assert.equal(ws.place.firstRate, ws.place.first / on.length);
  assert.ok(ws.place.first <= ws.place.top3 && ws.place.firstRate! <= ws.rate!, "first is never more than named");
});

test("a list prompt carries its best place; a comparison prompt its verdicts", () => {
  const ws = buildWorkspace(sampleRaw(TODAY), { plan: PLAN });
  const all = ws.clusters.flatMap((c) => [...c.groups, c.own].flatMap((g) => g.prompts));
  const listed = all.filter((p) => p.ptype === "list" && p.place);
  assert.ok(listed.length > 0 && listed.every((p) => p.place!.best >= 1 && p.place!.best <= p.place!.of));
  const comp = all.filter((p) => p.ptype === "comparison");
  assert.ok(comp.length > 0, "the sample has a comparison prompt");
  assert.ok(comp.some((p) => p.verdicts && p.verdicts.client + p.verdicts.neutral + p.verdicts.rival > 0));
  assert.ok(all.filter((p) => p.ptype !== "comparison").every((p) => p.verdicts === null), "only a comparison prompt has verdicts");
});
