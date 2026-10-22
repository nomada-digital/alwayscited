import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { refuseDrafts } from "./add-cluster.ts";
import { marketDrafts, pickStarters, starterTopics } from "./starter-pick.ts";

/** Starter clusters (22 Oct 2026): no paying customer sits without a reading. starter.ts reads; this decides. */

const vols = (o: Record<string, number | null>) => new Map(Object.entries(o));
const ints = (o: Record<string, string | null>) => new Map(Object.entries(o)) as Map<string, never>;

test("the picks are the scan's rule over what is left: measured volume, a buying intent, highest first", () => {
  const c = ["seo agencies", "seo agency", "seo companies", "seo consultants", "what is seo"];
  const v = vols({ "seo agencies": 900, "seo agency": 1600, "seo companies": 700, "seo consultants": 0, "what is seo": 9000 });
  const i = ints({ "seo agencies": "commercial", "seo agency": "commercial", "seo companies": "transactional", "seo consultants": "commercial", "what is seo": "informational" });
  const picks = pickStarters(c, v, i, 3);
  assert.deepEqual(picks.map((p) => p.keyword), ["seo agency", "seo companies"], "one per search: seo agencies is seo agency's plural; no volume, no buying intent, never");
  assert.equal(picks[0]!.volume, 1600);
});

test("a keyword already tracked, or its other form, is never picked again", () => {
  const c = ["seo agency", "seo companies", "seo services"];
  const v = vols({ "seo agency": 1600, "seo companies": 700, "seo services": 500 });
  const i = ints({ "seo agency": "commercial", "seo companies": "commercial", "seo services": "commercial" });
  assert.deepEqual(pickStarters(c, v, i, 2, ["SEO agencies"]).map((p) => p.keyword), ["seo companies", "seo services"]);
  assert.deepEqual(pickStarters(c, v, i, 0), []);
  assert.deepEqual(pickStarters([], v, i, 2), []);
});

test("five prompts, one per angle, as setup drafts them, naming the market paid for", () => {
  for (const [market, where] of [["UK", "in the UK"], ["US", "in the US"]] as const) {
    const d = marketDrafts("seo agency", market);
    assert.equal(d.length, 5);
    assert.equal(refuseDrafts(d), null, "the drafts' own rule passes");
    assert.ok(d[0]!.endsWith(`${where}?`), d[0]);
    assert.ok(d[2]!.includes(`small businesses ${where}`), d[2]);
    assert.equal(d.filter((p) => p.includes(where)).length, 2, "the market is named where a buyer would say it, not in all five");
  }
  assert.deepEqual(marketDrafts("seo agency", "DE"), marketDrafts("seo agency", "XX"), "an unknown market falls back to setup's own drafts");
});

test("the candidates' topics: the category, then the site's other phrases, each once", () => {
  assert.deepEqual(starterTopics("SEO agency", ["seo agency", "technical seo"], ["Link building", "x"]), ["seo agency", "technical seo", "link building"]);
  assert.deepEqual(starterTopics(null), []);
});

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("signup fills every cluster left with no keyword or prompt after the webhook answers, and says what it did", () => {
  const signup = read("src/lib/checkout/signup.ts");
  assert.match(signup, /starter = \(await fillStarters\(db, r\.starter\)\)\.text;/, "the starter runs on the client the signup made");
  assert.match(signup, /if \(later\) later\(finish\);\s*else await finish\(\);/, "after the answer when the route gives a later");
  assert.match(signup, /orderEmailText\(o, `\$\{r\.outcome\}\$\{starter \? ` \$\{starter\}` : ""\} Order row/, "the order email says what the starter made or could not");
  assert.ok(!signup.includes(`" - pick keywords and prompts in /admin/tracking"}`), "the outcome no longer asks for a pick the starter makes");
  const route = read("src/app/api/stripe/webhook/route.ts");
  assert.match(route, /onCheckoutCompleted\(supabaseAdmin\(\), order, eventId, after\)/);
  assert.match(route, /export const maxDuration = 120;/);
  const starter = read("src/lib/tracking/starter.ts");
  assert.match(starter, /added_by: STARTER_BY/, "a picked keyword is marked, so the board can say it is a suggestion");
  assert.match(starter, /pick keywords and prompts in \/admin\/tracking/, "what could not be made is named, with the admin page, as before");
  const board = read("src/components/dash/ClustersBoard.tsx");
  assert.match(board, /c\.suggested \? <span className="pill"[^>]*>Suggested - yours to edit<\/span>/);
});
