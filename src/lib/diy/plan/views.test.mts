import assert from "node:assert/strict";
import { test } from "node:test";

import { actLabel, clip, clientPath } from "./types.ts";

/**
 * 19 Oct 2026: the Plan's views. Every case but "copy helpers" is retired with its subject, deleted with the old /app
 * dashboard (commit 78b1023; the customer dashboard is the dashboards host only): board.ts (the page's query keys,
 * the board, Suggested's order, the default view, the list's sections, a link to one item, In progress's words),
 * card.ts (the owner line, the note lines), placements.ts (the Placements group and its owner), why-first.ts and
 * why-first.advice.ts ('Why this is first', a line or chip whose source stops being verified), worklog.ts (the work
 * log) and paths.ts (paths). The copy helpers live in types.ts, which the dashboards host still reads.
 */

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
