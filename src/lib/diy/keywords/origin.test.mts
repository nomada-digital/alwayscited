import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { draftPrompts } from "../../tracking/add-cluster.ts";
import type { Fixture } from "../../tracking/fixture-mode.ts";
import { MOMENTUM_SRC, addCluster, momentumOrigin, tagMomentumFixture } from "../../tracking/new-cluster.ts";
import { promptsDb } from "../prompts/fake-prompts-db.mts";
import { fixtureOriginMap } from "../prompts/origins.ts";

/**
 * The momentum origin (13 Oct 2026, DIY P6; spec 10 sections 3.5 and 6.6):
 * set only when the add came from a gaining-ground keyword (`src=gaining`),
 * and `src` surviving Check keyword's round trip (check/route.ts back()).
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const day = "2026-10-14";

test("the origin is momentum for src=gaining and for nothing else", () => {
  assert.equal(MOMENTUM_SRC, "gaining");
  assert.equal(momentumOrigin("gaining"), "momentum");
  for (const v of [null, undefined, "", "Gaining", "gaining ", "momentum", 1, ["gaining"]]) assert.equal(momentumOrigin(v), null, String(v));
});

function clientDb() {
  return promptsDb({ client_domains: [{ id: "cl", cluster_limit: 10, keyword_limit: 10, question_limit: 50 }], tracked_keywords: [], tracked_clusters: [], tracked_questions: [] });
}
const add = { clientId: "cl", tier: "tracked", keyword: "payroll software for sole traders", volume: 880, intent: "commercial", prompts: draftPrompts("payroll software for sole traders"), today: day, by: "owner@example.com", role: "owner" };

test("a gaining-ground add writes its five prompts as the client's own, origin momentum; a plain add sets no origin", async () => {
  const withOrigin = clientDb();
  const r = await addCluster(withOrigin.db, { ...add, origin: momentumOrigin("gaining") });
  assert.ok(r.ok, !r.ok ? r.message : "");
  const rows = withOrigin.tables.tracked_questions!;
  assert.equal(rows.length, 5);
  assert.ok(rows.every((q) => q.origin_kind === "momentum" && q.source === "client"));
  const plain = clientDb();
  const p = await addCluster(plain.db, { ...add, origin: momentumOrigin(null) });
  assert.ok(p.ok);
  assert.ok(plain.tables.tracked_questions!.every((q) => !("origin_kind" in q)), "written as it always was");
});

test("the writable fixture's twin: the new cluster's prompts carry the origin on their own rows, and P2's loader reads it as Momentum", () => {
  const f = { data: { questions: [{ id: "q1", cluster_id: "c1" }, { id: "fw1", cluster_id: "fc1" }, { id: "fw2", cluster_id: "fc1" }] } } as unknown as Fixture;
  const tagged = tagMomentumFixture(f, "fc1");
  const origins = fixtureOriginMap([], tagged.data.questions, []);
  assert.deepEqual([...origins].map(([id, o]) => [id, o.kind]), [["fw1", "momentum"], ["fw2", "momentum"]]);
});

test("src survives the check's round trip: back() carries it beside add, kw, the verdict and sig, for the Add panel only", () => {
  const route = src("src/app/api/app/[client]/check/route.ts");
  assert.match(route, /const src: Record<string, string> = !card && momentumOrigin\(form\?\.get\("src"\)\) \? \{ src: MOMENTUM_SRC \} : \{\};/);
  assert.match(route, /\.\.\.\(sig \? \{ sig \} : \{\}\), \.\.\.src \}\);/, "src rides in back()'s query");
  const cluster = src("src/app/api/app/[client]/cluster/route.ts");
  assert.match(cluster, /const origin = momentumOrigin\(field\("src"\)\);/);
  assert.match(cluster, /role: writeRole\(client\),\n\s+origin,/);
  // The panel posts it as a hidden field on both steps, and the page reads `src` (gaining only).
  const panel = src("src/components/app/Clusters.tsx");
  assert.match(panel, /<input id="kw-src" type="hidden" name="src" value=\{src\} \/>/);
  assert.match(panel, /<input id="nc-src" type="hidden" name="src" value=\{src\} \/>/);
  assert.match(src("src/app/app/[client]/clusters/page.tsx"), /src=\{one\("src"\) === "gaining" \? "gaining" : null\}/);
});
