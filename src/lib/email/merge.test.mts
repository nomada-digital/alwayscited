import assert from "node:assert/strict";
import { test } from "node:test";

import type { Raw, RawAnswer, RawPlacement } from "../dash/types.ts";
import {
  clientFacing,
  clusterPrompts,
  firstReadingFigures,
  focusCluster,
  type Forms,
  monthToDate,
  positionMove,
  setupStatus,
  trialFigures,
  upsellAllowed,
  weekDirection,
  weekFigures,
  workThisMonth,
} from "./merge.ts";

/**
 * The customer emails' merge (brief item 2e, 18 Oct 2026), on hand-made rows
 * in the dashboard's own shape (dash/types.ts Raw). Made-up client; nothing
 * is read from a database.
 */

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);

function raw(over: Partial<Raw> = {}): Raw {
  return {
    client: { id: "c1", slug: "tallyroo-com", domain: "tallyroo.com", brand: "Tallyroo", market: "UK", tier: "tracked", status: "active", started_on: day(0), cluster_limit: 10, trial_ends_at: null, payment_status: null, brand_aliases: [] },
    role: "owner",
    today: day(20),
    clusters: [
      { id: "k1", name: "invoicing", keyword_id: "w1", tier: "tracked", started_on: day(0), stopped_on: null },
      { id: "k2", name: "expenses", keyword_id: null, tier: "tracked", started_on: day(1), stopped_on: null },
    ],
    groups: [],
    keywords: [
      { id: "w1", keyword: "invoicing app", search_volume: 900, intent: null, added_on: day(0), stopped_on: null, cluster_id: "k1", group_id: null },
      { id: "w2", keyword: "invoicing apps", search_volume: 400, intent: null, added_on: day(0), stopped_on: null, cluster_id: "k1", group_id: null },
    ],
    prompts: [
      { id: "p1", text: "best invoicing app", cluster_id: "k1", group_id: null, angle: "Category", added_on: day(0), stopped_on: null },
      { id: "p2", text: "invoicing for freelancers", cluster_id: "k1", group_id: null, angle: "Sector", added_on: day(0), stopped_on: null },
      { id: "p9", text: "a placement prompt", cluster_id: "k1", group_id: null, angle: null, added_on: day(0), stopped_on: null, allowance: "placement" },
    ],
    runs: [],
    serp: [],
    answers: [],
    footprint: null,
    opportunities: [],
    placements: [],
    connections: [],
    consoleRows: [],
    groupsReady: true,
    keyPages: [],
    ...over,
  };
}

const ans = (d: string, q: string, engine: RawAnswer["engine"], named: boolean, extra: Partial<RawAnswer> = {}): RawAnswer => ({ run_date: d, question_id: q, engine, answered: true, named, ...extra });
const NO_FORMS: Forms = new Map();
const FORMS: Forms = new Map([
  ["w1", { form: "primary", pair_of: null }],
  ["w2", { form: "plural", pair_of: "w1" }],
]);

test("the focus cluster: keyword, its plural, the chosen target page, and the two Google positions apart", () => {
  const r = raw({
    serp: [
      { run_date: day(10), keyword_id: "w1", position: 7, url: null },
      { run_date: day(17), keyword_id: "w1", position: 6, url: null },
      { run_date: day(10), keyword_id: "w2", position: 11, url: null },
      { run_date: day(17), keyword_id: "w2", position: 9, url: null },
    ],
    keyPages: [
      { url: "https://www.tallyroo.com/old/", origin: "member", cluster_ids: ["k1"], added_on: day(1), removed_on: null },
      { url: "https://www.tallyroo.com/invoicing/", origin: "member", cluster_ids: ["k1"], added_on: day(5), removed_on: null },
      { url: "https://www.tallyroo.com/ranked", origin: "ranking", cluster_ids: ["k1"], added_on: day(9), removed_on: null },
    ],
  });
  const f = focusCluster(r, FORMS)!;
  assert.equal(f.keyword, "invoicing app");
  assert.equal(f.pair, "invoicing apps");
  assert.equal(f.target, "tallyroo.com/invoicing", "the newest live member page, shown without scheme, www or slash");
  assert.deepEqual(
    f.positions.map((p) => [p.label, p.now, p.before]),
    [
      ["singular", 6, 7],
      ["plural", 9, 11],
    ],
  );
  assert.deepEqual(positionMove(f.positions[0]!), { text: "up 1 from #7", tone: "good" });
  assert.deepEqual(positionMove({ now: 9, before: 6 }), { text: "down 3 from #6", tone: "bad" });
  assert.equal(positionMove({ now: 9, before: null }), null);
});

test("before the forms migration, or with no pair, there is one position and no singular/plural label; no target is null", () => {
  const r = raw({ serp: [{ run_date: day(17), keyword_id: "w1", position: 4, url: null }] });
  const f = focusCluster(r, NO_FORMS)!;
  assert.equal(f.pair, null);
  assert.equal(f.target, null);
  assert.deepEqual(f.positions.map((p) => [p.label, p.now]), [[null, 4]]);
  // A keyword with no position at all is not a tile.
  assert.deepEqual(focusCluster(raw(), FORMS)!.positions, []);
  assert.equal(focusCluster(raw({ clusters: [] }), FORMS), null);
});

test("the first reading: the latest day's named of answered, by engine, other brands (not the client), the site drawn on most (not the client's)", () => {
  const d = day(19);
  const cite = (url: string) => [{ url }];
  const r = raw({
    answers: [
      ans(day(18), "p1", "chatgpt", true),
      ans(d, "p1", "chatgpt", true, { brands: ["Tallyroo", "Ledgerbird"], citations: cite("https://solodesk.io/a") }),
      ans(d, "p2", "chatgpt", false, { brands: ["Ledgerbird", "Stackbill"], citations: cite("https://solodesk.io/b") }),
      ans(d, "p1", "gemini", false, { brands: ["ledgerbird"], citations: cite("https://www.tallyroo.com/x") }),
      { run_date: d, question_id: "p2", engine: "gemini", answered: false, named: false },
      ans(d, "p9", "gemini", true, { brands: ["Placed"] }),
    ],
    opportunities: [{ cluster_id: "k1", lens: "x", url: "https://a.com", domain: "a.com", title: null, route: null, status: "open", evidence: null }],
  });
  const f = firstReadingFigures(r)!;
  assert.equal(f.day, d);
  assert.equal(f.named, 1);
  assert.equal(f.answers, 3, "unanswered reads and placement prompts are not counted");
  assert.deepEqual(f.byEngine, [
    { engine: "ChatGPT", named: 1, answers: 2 },
    { engine: "Gemini", named: 0, answers: 1 },
  ]);
  assert.deepEqual(f.instead, [
    { name: "Ledgerbird", answers: 3 },
    { name: "Stackbill", answers: 1 },
  ]);
  assert.deepEqual(f.source, { domain: "solodesk.io", answers: 2 });
  assert.equal(f.opportunities, 1);
  assert.equal(firstReadingFigures(raw()), null, "no answers, no reading - the email hides every block that needs one");
});

test("the week: the last 7 readings against the 7 before; the direction, said plainly", () => {
  const answers: RawAnswer[] = [];
  for (let i = 0; i < 14; i++) {
    const before = i < 7;
    // Before: 1 of 2 named each day (50%). This week: 1 of 4 (25%).
    answers.push(ans(day(i), "p1", "chatgpt", true), ans(day(i), "p2", "chatgpt", false));
    if (!before) answers.push(ans(day(i), "p1", "gemini", false), ans(day(i), "p2", "gemini", false));
  }
  const w = weekFigures(raw({ answers }));
  assert.deepEqual(w, { readings: 7, pct: 25, before: 50 });
  assert.equal(weekDirection(w, null), "down");
  assert.equal(weekDirection({ pct: 30, before: 25 }, { now: 9, before: 3 }), "up", "the AI share leads; never blended with Google");
  assert.equal(weekDirection({ pct: 30, before: 30 }, { now: 9, before: 3 }), "down", "the same share and lower on Google is a harder week");
  assert.equal(weekDirection({ pct: 30, before: 30 }, { now: 3, before: 3 }), "flat");
  assert.equal(weekDirection({ pct: 30, before: null }, null), "flat");
  const short = weekFigures(raw({ answers: answers.slice(0, 6) }));
  assert.equal(short.readings, 3);
  assert.equal(short.before, null, "no week before: no change is claimed");
});

test("the trial: readings, answers, share now and on day 1, best and worst prompt this week, the source worth getting into, the best position", () => {
  const answers: RawAnswer[] = [];
  for (let i = 0; i < 8; i++) {
    answers.push(ans(day(i), "p1", "chatgpt", i > 0, { citations: [{ url: "https://solodesk.io/x" }] }), ans(day(i), "p2", "perplexity", false, { citations: [{ url: "https://solodesk.io/y" }] }));
  }
  const f = trialFigures(raw({ answers, serp: [{ run_date: day(3), keyword_id: "w1", position: 8, url: null }, { run_date: day(5), keyword_id: "w1", position: 6, url: null }] }))!;
  assert.equal(f.readings, 8);
  assert.equal(f.answers, 16);
  assert.equal(f.firstPct, 0);
  assert.equal(f.pct, 44);
  assert.deepEqual(f.best, { text: "best invoicing app", named: 7, answers: 7 });
  assert.deepEqual(f.worst, { text: "invoicing for freelancers", named: 0, answers: 7 });
  assert.deepEqual(f.source, { domain: "solodesk.io", answers: 14, engines: 2 });
  assert.equal(f.bestPosition, 6);
  // Two prompts that read the same are neither best nor worst.
  const same = trialFigures(raw({ answers: [ans(day(1), "p1", "chatgpt", true), ans(day(1), "p2", "chatgpt", true)] }))!;
  assert.equal(same.best, null);
  assert.equal(same.worst, null);
  assert.equal(trialFigures(raw()), null);
});

test("setup status: the first cluster missing a keyword, a target page or its prompts; null when every one is done", () => {
  const s = setupStatus(raw(), FORMS, 5)!;
  assert.deepEqual(s, { cluster: "invoicing", keyword: "invoicing app", pair: "invoicing apps", target: null, prompts: 2 }, "placement prompts are not the plan's");
  const prompts = ["a", "b", "c", "d", "e"].map((t, i) => ({ id: `q${i}`, text: t, cluster_id: "k1", group_id: null, angle: null, added_on: day(0), stopped_on: null }));
  const done = raw({ clusters: raw().clusters.slice(0, 1), prompts, keyPages: [{ url: "https://tallyroo.com/i", origin: "member", cluster_ids: ["k1"], added_on: day(1), removed_on: null }] });
  assert.equal(setupStatus(done, FORMS, 5), null);
  assert.deepEqual(clusterPrompts(raw(), "k1"), [
    { text: "best invoicing app", angle: "Category" },
    { text: "invoicing for freelancers", angle: "Sector" },
  ]);
});

test("the work this month: hidden on alwaystracked and with no rows; counted against the plan's deliverables", () => {
  const p = (id: string, kind: RawPlacement["kind"], status: RawPlacement["status"], live_on: string | null = null): RawPlacement => ({ id, cluster_id: "k1", kind, url: `https://${id}.com/a`, domain: `${id}.com`, status, scheduled_on: status === "scheduled" ? "2026-10-23" : null, live_on, anchor_text: "invoicing app" });
  const placements = [p("a", "guest_post", "live", "2026-10-05"), p("b", "guest_post", "live", "2026-10-12"), p("c", "link_insertion", "scheduled"), p("old", "guest_post", "live", "2026-09-20"), p("s", "on_site", "live", "2026-10-02"), { ...p("demo", "guest_post", "live", "2026-10-03"), sample: true }];
  assert.equal(workThisMonth(raw({ placements })), null, "alwaystracked: nothing is worked, the table is hidden");
  const cited = raw({ placements, client: { ...raw().client, tier: "cited" } });
  const w = workThisMonth(cited)!;
  assert.deepEqual(w.rows.map((r) => `${r.domain} ${r.what} ${r.status}`), ["a.com placement Live", "b.com placement Live", "s.com on-site work Live", "c.com link insertion Scheduled 23 Oct"], "last month's and a demo's are not this month's");
  assert.equal(monthToDate(w), "Month to date: 2 of 3 placements live, 0 of 2+ insertions, 1 on-site change live.");
  const mentioned = workThisMonth(raw({ placements: placements.slice(0, 1), client: { ...raw().client, tier: "mentioned" } }))!;
  assert.equal(monthToDate(mentioned), "Month to date: 1 of 3 placements live.");
  assert.equal(workThisMonth(raw({ client: { ...raw().client, tier: "cited" } })), null, "no rows, no table");
});

test("upsell gating: alwaystracked only, never with upsell_mode off, never client-facing", () => {
  assert.equal(upsellAllowed({ tier: "tracked", mode: "nomada", clientFacing: false }), true);
  assert.equal(upsellAllowed({ tier: "tracked", mode: "agency", clientFacing: false }), true);
  assert.equal(upsellAllowed({ tier: "tracked", mode: "off", clientFacing: false }), false);
  assert.equal(upsellAllowed({ tier: "tracked", mode: "nomada", clientFacing: true }), false);
  for (const tier of ["mentioned", "cited", "everywhere"] as const) assert.equal(upsellAllowed({ tier, mode: "nomada", clientFacing: false }), false, tier);
});

test("client-facing: the invite always; any other email only to a non-owner member of an agency-mode account", () => {
  assert.equal(clientFacing({ email: "invite", role: "owner", mode: "nomada" }), true);
  assert.equal(clientFacing({ email: "other", role: "editor", mode: "agency" }), true);
  assert.equal(clientFacing({ email: "other", role: "viewer", mode: "agency" }), true);
  assert.equal(clientFacing({ email: "other", role: "owner", mode: "agency" }), false);
  assert.equal(clientFacing({ email: "other", role: "editor", mode: "nomada" }), false);
});
