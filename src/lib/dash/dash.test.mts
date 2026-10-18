import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { allowanceLimits, allowances, fullness } from "./allowance.ts";
import { dashBase, dashInternal, dashLinkOrigin, dashStrip, demoPath, demoSlug, isDashHost } from "./host.ts";
import { buildWorkspace, matchesTerms, trimRaw } from "./model.ts";
import { applyOp, cleanTerms, inverseOp, readOp, refuseOp, undoAdd, type Op } from "./ops.ts";
import { sampleConsole } from "./sample.ts";
import { demoAs } from "./demo-state.ts";
import { keywordSituation } from "./guidance.ts";
import { demoLink } from "./host.ts";
import { packNudge, stillDismissed, upgradeNudge } from "./nudges.ts";
import { MANAGED_SWAP, isManaged } from "./ops.ts";
import { NUDGES } from "../../config/nudges.ts";
import type { Raw } from "./types.ts";

/**
 * dashboards.alwayscited.com (17 Oct 2026): the pure half - host routing,
 * allowances, the edit operations and the workspace model.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
// pricing.ts's shape (50 / 10 and 10 / 10), held equal to the file below.
const PLAN = { promptsPerCluster: 5, keywordsPerCluster: 1 };

function raw(over: Partial<Raw> = {}): Raw {
  return {
    client: { id: "c1", slug: "acme-com", domain: "acme.com", brand: "Acme", market: "US", tier: "tracked", status: "active", started_on: "2026-10-01", cluster_limit: 2, trial_ends_at: null, payment_status: null, brand_aliases: [] },
    role: "owner",
    today: "2026-10-17",
    clusters: [{ id: "k1", name: "widgets", keyword_id: "w1", tier: "tracked", started_on: "2026-10-01", stopped_on: null }],
    groups: [{ id: "g1", cluster_id: "k1", name: "Blue widgets", note: null, terms: ["blue"], position: 0, stopped_on: null }],
    keywords: [{ id: "w1", keyword: "widgets", search_volume: 100, intent: null, added_on: "2026-10-01", stopped_on: null, cluster_id: "k1", group_id: null }],
    prompts: [{ id: "p1", text: "Who makes the best widgets?", cluster_id: "k1", group_id: "g1", angle: "category", added_on: "2026-10-01", stopped_on: null }],
    runs: [{ run_date: "2026-10-17", status: "complete", engines: ["chatgpt", "gemini"] }],
    serp: [
      { run_date: "2026-10-10", keyword_id: "w1", position: 12, url: null },
      { run_date: "2026-10-17", keyword_id: "w1", position: 8, url: "https://acme.com/" },
    ],
    answers: [
      { run_date: "2026-10-17", question_id: "p1", engine: "chatgpt", answered: true, named: true, brands: ["Acme", "Other Co"], citations: [{ url: "https://www.acme.com/a" }, { url: "https://list.com/x" }] },
      { run_date: "2026-10-17", question_id: "p1", engine: "gemini", answered: true, named: false, brands: ["Other Co"], citations: [{ url: "https://list.com/x" }] },
    ],
    footprint: { pulled_on: "2026-10-14", rows: [{ k: "blue widgets cheap", p: 14, u: "/", v: 300 }, { k: "red widgets", p: 30, u: "/", v: 900 }, { k: "widgets", p: 8, u: "/", v: 100 }] },
    opportunities: [],
    placements: [],
    connections: [],
    consoleRows: [],
    groupsReady: true,
    ...over,
  };
}

// ---------------------------------------------------------------- host

test("host: the production name and dashboards.localhost on any port are the dashboards host; nothing else is", () => {
  assert.equal(isDashHost("dashboards.alwayscited.com", {}), true);
  assert.equal(isDashHost("DASHBOARDS.alwayscited.com", {}), true);
  assert.equal(isDashHost("dashboards.localhost:3215", {}), true);
  assert.equal(isDashHost("alwayscited.com", {}), false);
  assert.equal(isDashHost("app.alwayscited.com", {}), false);
  assert.equal(isDashHost(null, {}), false);
  assert.equal(isDashHost("preview.example", { DASH_HOST: "preview.example" }), true);
});

test("host: bare paths map into /dashboards, the prefixed form is stripped, and a link never takes a forged Host", () => {
  assert.equal(dashInternal("/"), "/dashboards");
  assert.equal(dashInternal("/acme-com/clusters"), "/dashboards/acme-com/clusters");
  assert.equal(dashInternal("/favicon.ico"), "/favicon.ico");
  assert.equal(dashStrip("/dashboards/acme-com"), "/acme-com");
  assert.equal(dashStrip("/dashboards"), "/");
  assert.equal(dashStrip("/dashboardsx"), null);
  assert.equal(dashLinkOrigin("dashboards.localhost:3215", {}), "http://dashboards.localhost:3215");
  assert.equal(dashLinkOrigin("evil.example", {}), "https://dashboards.alwayscited.com");
  assert.equal(dashBase("dashboards.alwayscited.com", {}), "", "own host: bare paths");
  assert.equal(dashBase("alwayscited.com", {}), "/dashboards", "the marketing host's preview keeps the prefix");
});

test("demo links: only a configured token of 32+ safe characters opens one client, and the path splits cleanly", () => {
  const tok = "a".repeat(40);
  const env = { DASH_DEMO_LINKS: `${tok}:acme-com, ${"b".repeat(10)}:short-com` };
  assert.equal(demoSlug(tok, env), "acme-com");
  assert.equal(demoSlug("a".repeat(39), env), null, "a different token");
  assert.equal(demoSlug("b".repeat(10), env), null, "a short token never opens, even when configured");
  assert.equal(demoSlug(tok, {}), null, "nothing configured, nothing opens");
  assert.equal(demoSlug(`${tok}/..`, env), null);
  assert.equal(demoSlug(tok, { DASH_DEMO_LINKS: `${tok}:Bad Slug` }), null);
  assert.deepEqual(demoPath(`/demo/${tok}`), { token: tok, rest: "" });
  assert.deepEqual(demoPath(`/demo/${tok}/clusters/x`), { token: tok, rest: "/clusters/x" });
  assert.equal(demoPath("/demox/abc"), null);
});

test("demo links: the token is never committed - only the env var names the pairs", () => {
  const host = readFileSync(join(ROOT, "src", "lib", "dash", "host.ts"), "utf8");
  assert.match(host, /process\.env\.DASH_DEMO_LINKS/);
  const proxy = readFileSync(join(ROOT, "src", "proxy.ts"), "utf8");
  assert.match(proxy, /headers\.delete\(DEMO_HEADER\)/, "the proxy drops a client-sent demo header before deciding");
});

// ---------------------------------------------------------------- allowances

test("allowances: pricing.ts's per-cluster shape times cluster_limit, live rows only, placement prompts apart", () => {
  const pricing = readFileSync(join(ROOT, "src", "config", "pricing.ts"), "utf8");
  const n = (name: string) => Number(new RegExp(`export const ${name} = (\\d+);`).exec(pricing)?.[1]);
  assert.deepEqual(PLAN, { promptsPerCluster: n("TRACKED_PROMPTS") / n("TRACKED_CLUSTERS"), keywordsPerCluster: n("TRACKED_KEYWORDS") / n("TRACKED_CLUSTERS") }, "PLAN here is pricing.ts's shape");
  assert.deepEqual(allowanceLimits(10, PLAN), { clusters: 10, prompts: 50, keywords: 10 });
  assert.deepEqual(allowanceLimits(15, PLAN), { clusters: 15, prompts: 75, keywords: 15 }, "one pack");
  const r = raw();
  r.prompts.push({ id: "p2", text: "x".repeat(10), cluster_id: "k1", group_id: null, angle: null, added_on: "2026-10-01", stopped_on: "2026-10-18" });
  r.prompts.push({ id: "p3", text: "y".repeat(10), cluster_id: "k1", group_id: null, angle: null, added_on: "2026-10-01", stopped_on: null, allowance: "placement" });
  assert.deepEqual(allowances(r, PLAN), { clusters: { used: 1, limit: 2 }, prompts: { used: 1, limit: 10 }, keywords: { used: 1, limit: 2 } });
  assert.equal(fullness({ used: 7, limit: 10 }), "calm");
  assert.equal(fullness({ used: 8, limit: 10 }), "warn");
  assert.equal(fullness({ used: 10, limit: 10 }), "full");
});

// ---------------------------------------------------------------- ops

test("ops: a keyword joins any group of its cluster from the client-wide pool, and is refused at the plan's limit", () => {
  const r = raw();
  const add: Op = { op: "keyword.add", tempId: "t1", clusterId: "k1", groupId: "g1", keyword: "blue widgets" };
  assert.equal(refuseOp(r, add, PLAN), null, "a second keyword in one cluster is fine");
  const after = applyOp(r, add, { by: "x" });
  assert.equal(after.keywords.find((k) => k.id === "t1")?.group_id, "g1");
  assert.equal(after.keywords.find((k) => k.id === "t1")?.added_on, "2026-10-18", "first checked tomorrow");
  assert.match(refuseOp(after, { ...add, tempId: "t2", keyword: "green widgets" }, PLAN) ?? "", /Every keyword on your plan is in use \(2\)/);
  assert.match(refuseOp(r, { ...add, keyword: "Widgets " }, PLAN) ?? "", /already track/);
  assert.match(refuseOp(r, { ...add, keyword: "w" }, PLAN) ?? "", /2 to 120/);
});

test("ops: prompts are judged by length and twin, counted against the pool, and refused into another cluster's group", () => {
  const r = raw();
  assert.match(refuseOp(r, { op: "prompt.add", tempId: "t", clusterId: "k1", groupId: null, text: "short" }, PLAN) ?? "", /8 to 300/);
  assert.match(refuseOp(r, { op: "prompt.add", tempId: "t", clusterId: "k1", groupId: null, text: "who makes the BEST widgets?" }, PLAN) ?? "", /already tracked/);
  const r2 = raw({ clusters: [...raw().clusters, { id: "k2", name: "gadgets", keyword_id: null, tier: "tracked", started_on: "2026-10-01", stopped_on: null }] });
  assert.match(refuseOp(r2, { op: "prompt.add", tempId: "t", clusterId: "k2", groupId: "g1", text: "Which gadget brand is best?" }, PLAN) ?? "", /another cluster/);
  let full = r;
  for (let i = 0; i < 9; i++) full = applyOp(full, { op: "prompt.add", tempId: `t${i}`, clusterId: "k1", groupId: null, text: `Prompt number ${i} about widgets` }, { by: "x" });
  assert.match(refuseOp(full, { op: "prompt.add", tempId: "z", clusterId: "k1", groupId: null, text: "One more prompt please" }, PLAN) ?? "", /Every prompt on your plan is in use \(10\)/);
});

test("ops: viewers and ended clients may not edit; groups wait for their migration", () => {
  assert.match(refuseOp(raw({ role: "viewer" }), { op: "cluster.rename", id: "k1", name: "x" }, PLAN) ?? "", /owners and editors/);
  const ended = raw();
  ended.client.status = "ended";
  assert.match(refuseOp(ended, { op: "cluster.rename", id: "k1", name: "x" }, PLAN) ?? "", /owners and editors/);
  assert.match(refuseOp(raw({ groupsReady: false }), { op: "group.add", tempId: "g", clusterId: "k1", name: "New" }as Op, PLAN) ?? "", /not switched on/);
});

test("ops: removing stops from tomorrow, and the inverse puts back exactly what was there", () => {
  const r = raw();
  const removed = applyOp(r, { op: "cluster.remove", id: "k1" }, { by: "x" });
  assert.equal(removed.clusters[0]!.stopped_on, "2026-10-18");
  assert.equal(removed.prompts[0]!.stopped_on, "2026-10-18");
  assert.equal(removed.keywords[0]!.stopped_on, "2026-10-18");
  assert.equal(removed.groups[0]!.stopped_on, "2026-10-18");
  const inv = inverseOp(r, { op: "cluster.remove", id: "k1" })!;
  assert.equal(refuseOp(removed, inv, PLAN), null);
  assert.deepEqual(applyOp(removed, inv, { by: "x" }).clusters, r.clusters);
  const old = raw();
  old.prompts[0]!.stopped_on = "2026-10-17";
  assert.match(refuseOp(old, { op: "prompt.restore", id: "p1" }, PLAN) ?? "", /removed before today/);
});

test("ops: removing a group keeps its keywords and prompts tracked, and restoring it takes them back", () => {
  const r = raw();
  const op: Op = { op: "group.remove", id: "g1" };
  const inv = inverseOp(r, op)!;
  const gone = applyOp(r, op, { by: "x" });
  assert.equal(gone.prompts[0]!.group_id, null);
  assert.equal(gone.prompts[0]!.stopped_on, null);
  const back = applyOp(gone, inv, { by: "x" });
  assert.equal(back.prompts[0]!.group_id, "g1");
  assert.equal(back.groups[0]!.stopped_on, null);
});

test("ops: a measured prompt's edit replaces it; an unmeasured one is rewritten in place", () => {
  const r = raw();
  const edited = applyOp(r, { op: "prompt.edit", id: "p1", text: "Who makes the finest widgets?", tempId: "n1" }, { by: "x" });
  assert.equal(edited.prompts.find((p) => p.id === "p1")!.stopped_on, "2026-10-18");
  assert.equal(edited.prompts.find((p) => p.id === "n1")!.group_id, "g1");
  const fresh = raw({ answers: [] });
  const rewritten = applyOp(fresh, { op: "prompt.edit", id: "p1", text: "Who makes the finest widgets?", tempId: "n1" }, { by: "x" });
  assert.equal(rewritten.prompts.length, 1);
  assert.equal(rewritten.prompts[0]!.text, "Who makes the finest widgets?");
});

test("ops: an add's undo removes the row the server made; a move's undo moves it back", () => {
  assert.deepEqual(undoAdd({ op: "prompt.add", tempId: "t1", clusterId: "k1", groupId: null, text: "x" }, (t) => (t === "t1" ? "real" : t)), { op: "prompt.remove", id: "real" });
  assert.deepEqual(inverseOp(raw(), { op: "prompt.move", id: "p1", clusterId: "k1", groupId: null }), { op: "prompt.move", id: "p1", clusterId: "k1", groupId: "g1" });
});

test("ops: readOp takes only well-formed ops", () => {
  assert.deepEqual(readOp({ op: "keyword.remove", id: "abc-123" }), { op: "keyword.remove", id: "abc-123" });
  assert.equal(readOp({ op: "keyword.remove", id: "a b" }), null);
  assert.equal(readOp({ op: "drop.table", id: "x" }), null);
  assert.equal(readOp({ op: "prompt.add", tempId: "t", clusterId: "k", groupId: 3, text: "x" }), null);
  assert.deepEqual(readOp({ op: "group.edit", id: "g1", terms: ["a", 1] }), { op: "group.edit", id: "g1", terms: ["a"] });
  assert.deepEqual(cleanTerms(["  Blue ", "blue", "x", "Red  Ones"]), ["blue", "red ones"]);
});

// ---------------------------------------------------------------- model

test("model: rates, positions, footprint by group terms, brands and sources", () => {
  const ws = buildWorkspace(raw(), { plan: PLAN });
  const c = ws.clusters[0]!;
  assert.equal(c.rate, 0.5, "named 1 of 2 answers");
  assert.equal(c.headPos, 8);
  assert.equal(c.headChange, 4, "12 a week ago, 8 now: up 4");
  assert.deepEqual(c.groups[0]!.keywords.map((k) => k.keyword), ["blue widgets cheap"], "footprint matched by the term; tracked keyword not repeated");
  assert.deepEqual(c.own.keywords.map((k) => k.keyword), ["widgets"]);
  assert.equal(c.groups[0]!.prompts[0]!.cells.chatgpt, "named");
  assert.equal(ws.brands.find((b) => b.you)?.name, "Acme");
  assert.equal(ws.sources[0]!.domain, "list.com");
  assert.equal(ws.sources.find((s) => s.you)?.domain, "acme.com");
  assert.equal(matchesTerms("Blue  Widgets", ["blue widgets"]), true);
});

test("model: sample console figures only when asked, never beside real rows, and stable", () => {
  assert.equal(buildWorkspace(raw(), { plan: PLAN }).clusters[0]!.own.keywords[0]!.console.gsc, null);
  const s = buildWorkspace(raw(), { plan: PLAN, sample: true }).clusters[0]!.own.keywords[0]!.console.gsc;
  assert.ok(s && s.impr > 0);
  assert.deepEqual(sampleConsole("widgets", 100, 8, "gsc"), sampleConsole("widgets", 100, 8, "gsc"));
  const real = raw({ consoleRows: [{ provider: "gsc", query: "widgets", clicks: 3, impressions: 40, ctr: 0.075, position: 7.5, period_end: "2026-10-15" }] });
  const ws = buildWorkspace(real, { plan: PLAN, sample: true });
  assert.deepEqual(ws.clusters[0]!.own.keywords[0]!.console.gsc, { clicks: 3, impr: 40, ctr: 0.075, pos: 7.5 });
  assert.equal(ws.consoleLive.gsc, true);
});

test("model: the browser's copy carries no answer words, brands or citations", () => {
  const t = trimRaw(raw());
  assert.equal(t.answers.some((a) => "brands" in a || "citations" in a), false);
});

// ---------------------------------------------------------------- the route tree

test("every dashboards page is noindex and reads through pageData or redirects", () => {
  const pages = ["page.tsx", "[client]/page.tsx", "[client]/clusters/page.tsx", "[client]/clusters/[cluster]/page.tsx", "[client]/ai/page.tsx", "[client]/google/page.tsx", "[client]/sources/page.tsx", "[client]/opportunities/page.tsx", "[client]/integrations/page.tsx", "[client]/managed/page.tsx", "[client]/plan/page.tsx", "login/page.tsx", "auth/page.tsx"];
  for (const p of pages) {
    const src = readFileSync(join(ROOT, "src", "app", "dashboards", p), "utf8");
    assert.ok(/index: false/.test(src) || p === "page.tsx", `${p} says noindex`);
    assert.ok(/pageData\(|redirect\(|LoginForm|isTokenShape/.test(src), `${p} checks the session`);
  }
});

// ---------------------------------------------------------------- growth (preview, 17 Oct 2026)

/** A workspace with `days` readings of `per` answers a day, the client named in `named` of each day's. */
function readings(over: Partial<Raw>, days: number, per: number, named: number, cites = 0, rival = "Rival Co"): Raw {
  const r = raw(over);
  r.prompts = Array.from({ length: per }, (_, i) => ({ id: `p${i}`, text: `Prompt number ${i} about widgets`, cluster_id: "k1", group_id: null, angle: null, added_on: "2026-10-01", stopped_on: null }));
  r.answers = [];
  for (let d = 0; d < days; d++) {
    const day = `2026-10-${String(10 + d).padStart(2, "0")}`;
    for (let i = 0; i < per; i++) {
      const isNamed = i < named;
      r.answers.push({ run_date: day, question_id: `p${i}`, engine: "chatgpt", answered: true, named: isNamed, brands: isNamed ? ["Acme", rival] : [rival], citations: i < cites ? [{ url: "https://acme.com/x" }] : [{ url: "https://list.com/x" }] });
    }
  }
  r.client.cluster_limit = 10;
  return r;
}

test("nudges: alwaystracked is offered alwaysmentioned only when AI rarely names it, never before enough readings", () => {
  assert.equal(upgradeNudge(buildWorkspace(readings({}, 3, 10, 1), { plan: PLAN }), { markets: 1, daysOnPlan: 10 }), null, "3 readings is too few to judge");
  const low = upgradeNudge(buildWorkspace(readings({}, 7, 10, 1), { plan: PLAN }), { markets: 1, daysOnPlan: 10 });
  assert.equal(low?.to, "mentioned");
  assert.match(low!.evidence[0]!, /named you in 7 of 70 answers \(10%\)/);
  assert.equal(upgradeNudge(buildWorkspace(readings({}, 7, 10, 6), { plan: PLAN }), { markets: 1, daysOnPlan: 10 }), null, "named in 60% and not outnamed: nothing");
});

test("nudges: alwaysmentioned is offered alwayscited only when its site is rarely cited AND a managed cluster is off page 1", () => {
  const base = readings({}, 7, 10, 6, 0);
  base.client.tier = "mentioned";
  base.clusters[0]!.tier = "mentioned";
  assert.equal(upgradeNudge(buildWorkspace(base, { plan: PLAN }), { markets: 1, daysOnPlan: 30 }), null, "the cluster keyword is at #8: page 1, so no nudge");
  base.serp.push({ run_date: "2026-10-18", keyword_id: "w1", position: 14, url: "https://acme.com/" });
  const n = upgradeNudge(buildWorkspace(base, { plan: PLAN }), { markets: 1, daysOnPlan: 30 });
  assert.equal(n?.to, "cited");
  assert.match(n!.evidence.join(" "), /#14 on Google/);
  const cited = readings({}, 7, 10, 6, 5);
  cited.client.tier = "mentioned";
  cited.clusters[0]!.tier = "mentioned";
  cited.serp.push({ run_date: "2026-10-18", keyword_id: "w1", position: 14, url: "https://acme.com/" });
  assert.equal(upgradeNudge(buildWorkspace(cited, { plan: PLAN }), { markets: 1, daysOnPlan: 30 }), null, "cited in half the answers: no nudge");
});

test("nudges: alwayscited stays put unless there is real scope; alwayseverywhere is never nudged", () => {
  const c = readings({}, 7, 10, 1);
  c.client.tier = "cited";
  c.clusters[0]!.tier = "cited";
  assert.equal(upgradeNudge(buildWorkspace(c, { plan: PLAN }), { markets: 1, daysOnPlan: 200 }), null, "one managed cluster, one market: stay on alwayscited");
  assert.equal(upgradeNudge(buildWorkspace(c, { plan: PLAN }), { markets: NUDGES.everywhere.minMarkets, daysOnPlan: 5 })?.to, "everywhere", "a second market is scope");
  c.client.tier = "everywhere";
  assert.equal(upgradeNudge(buildWorkspace(c, { plan: PLAN }), { markets: 3, daysOnPlan: 200 }), null);
});

test("nudges: the pack is offered from 80% of an allowance, and a dismissal holds for 30 days", () => {
  const r = raw();
  r.client.cluster_limit = 1;
  assert.equal(packNudge(buildWorkspace(r, { plan: PLAN }))?.id, "pack");
  r.client.cluster_limit = 10;
  assert.equal(packNudge(buildWorkspace(r, { plan: PLAN })), null);
  assert.equal(stillDismissed(1000, 1000 + 29 * 86_400_000), true);
  assert.equal(stillDismissed(1000, 1000 + 31 * 86_400_000), false);
  assert.equal(stillDismissed(null, 5), false);
});

test("managed clusters: on a paid plan the cluster keyword changes on request; inside it stays editable", () => {
  const r = raw();
  r.client.tier = "cited";
  r.clusters[0]!.tier = "cited";
  assert.equal(isManaged(r, "k1"), true);
  assert.equal(refuseOp(r, { op: "cluster.remove", id: "k1" }, PLAN), MANAGED_SWAP);
  assert.equal(refuseOp(r, { op: "cluster.rename", id: "k1", name: "x" }, PLAN), MANAGED_SWAP);
  assert.equal(refuseOp(r, { op: "keyword.remove", id: "w1" }, PLAN), MANAGED_SWAP);
  assert.equal(refuseOp(r, { op: "prompt.add", tempId: "t", clusterId: "k1", groupId: "g1", text: "Which widget makers are best?" }, PLAN), null);
  assert.equal(refuseOp(r, { op: "group.edit", id: "g1", name: "Navy widgets" }, PLAN), null);
  r.client.tier = "tracked";
  assert.equal(isManaged(r, "k1"), false, "a tracking plan manages nothing");
  assert.equal(refuseOp(r, { op: "cluster.remove", id: "k1" }, PLAN), null);
});

test("demo states: a per-plan link shows the client as that plan, with every sample placement marked", () => {
  const tok = "c".repeat(40);
  assert.deepEqual(demoLink(tok, { DASH_DEMO_LINKS: `${tok}:acme-com:cited` }), { slug: "acme-com", state: "cited" });
  assert.equal(demoLink(tok, { DASH_DEMO_LINKS: `${tok}:acme-com:gold` }), null, "an unknown state opens nothing");
  const cited = demoAs(raw(), "cited");
  assert.equal(cited.client.tier, "cited");
  assert.equal(cited.clusters[0]!.tier, "cited");
  assert.ok(cited.placements.length > 0 && cited.placements.every((p) => p.sample === true));
  const trial = demoAs(raw(), "tracked-trial");
  assert.ok(trial.client.trial_ends_at && trial.placements.length === 0);
  const same = raw();
  assert.equal(demoAs(same, null), same, "no state: the rows as they are");
});

test("guidance: each keyword gets the one situation its figures show", () => {
  assert.equal(keywordSituation({ pos: 12, pageChange: { from: "/a", to: "/b", on: "2026-10-15" }, homepage: false }), "swap");
  assert.equal(keywordSituation({ pos: null, pageChange: null, homepage: false }), "absent");
  assert.equal(keywordSituation({ pos: 12, pageChange: null, homepage: true }), "homepage");
  assert.equal(keywordSituation({ pos: 2, pageChange: null, homepage: true }), "top");
  assert.equal(keywordSituation({ pos: 15, pageChange: null, homepage: false }), "near");
});
