/**
 * The placement prompt hook (13 Oct 2026, DIY P2; spec 10 sections 6.7 and
 * 7.3): the switch, the trigger, the admin hook on a fake fetch (success, a
 * failed read, a duplicate), the allowance and its rotation, and the stop on
 * removed. Nothing reaches a database or the network. Illustrative: Tallyroo
 * and every brand and site shown are made up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PLACEMENT_FULL } from "../../tracking/limits.ts";
import { promptsDb, type Row } from "./fake-prompts-db.mts";
import { ROTATE_AFTER_DAYS, SAVED_SWITCHED_OFF, SWITCHED_OFF, addPlacementPrompt, pickRotation, placementPromptMessage, placementPromptsOn, placementSaved, stopPlacementPrompt, type PlacementPromptOutcome } from "./placement-prompt.ts";

const today = "2026-09-29";
const tomorrow = "2026-09-30";
const ARTICLE = "<html><head><title>The 12 Best Accounting Apps for Small Businesses in 2026 | The Small Biz Stack</title></head><body><a href='https://tallyroo.com'>Tallyroo</a></body></html>";

/** A fetch that answers `status` with `html`, and counts its calls. */
function fakeFetch(status = 200, html = ARTICLE, fail: string | null = null) {
  const seen: string[] = [];
  const fetcher = async (url: string) => {
    seen.push(url);
    if (fail) throw new Error(fail);
    return { status, text: async () => html };
  };
  return { fetcher, seen };
}

function world(opts: { switch?: unknown; tier?: string; kind?: string; status?: string; prompts?: Row[]; placements?: Row[]; answers?: Row[]; clusterStopped?: string | null } = {}) {
  const settings = opts.switch === undefined ? [] : [{ key: "placement_prompts_enabled", value: opts.switch }];
  return promptsDb({
    app_settings: settings,
    client_domains: [{ id: "cl", tier: opts.tier ?? "mentioned", market: "US", cluster_limit: 10 }],
    tracked_clusters: [{ id: "c1", client_domain_id: "cl", stopped_on: opts.clusterStopped ?? null }],
    placements: [
      { id: "p1", client_domain_id: "cl", cluster_id: "c1", kind: opts.kind ?? "guest_post", url: "https://thesmallbizstack.com/best-accounting-apps", url_key: "thesmallbizstack.com/best-accounting-apps", status: opts.status ?? "live", live_on: "2026-09-20" },
      ...(opts.placements ?? []),
    ],
    tracked_questions: [
      { id: "q1-1", client_domain_id: "cl", cluster_id: "c1", text: "What's the best accounting app for freelancers?", source: "scan", added_on: "2026-06-10", stopped_on: null, allowance: null },
      ...(opts.prompts ?? []),
    ],
    tracking_answers: opts.answers ?? [],
  });
}
const add = (db: Parameters<typeof addPlacementPrompt>[0], fetcher: ReturnType<typeof fakeFetch>["fetcher"], extra: { insertion?: boolean; placementId?: string } = {}) =>
  addPlacementPrompt(db, { clientId: "cl", placementId: extra.placementId ?? "p1", insertion: extra.insertion, today }, { fetcher });
const placementPrompts = (tables: Record<string, Row[]>) => tables.tracked_questions!.filter((q) => q.origin_kind === "placement");

test("the switch: false, missing or unreadable is off - nothing fetched, nothing added, and the admin line is exact", async () => {
  for (const [label, w] of [
    ["false", world({ switch: false })],
    ["missing", world({})],
    ["a string, not jsonb true", world({ switch: "true" })],
  ] as const) {
    const f = fakeFetch();
    const o = await add(w.db, f.fetcher);
    assert.deepEqual(o, { kind: "off" }, label);
    assert.equal(f.seen.length, 0, `${label}: nothing fetched`);
    assert.equal(placementPrompts(w.tables).length, 0, `${label}: nothing added`);
    assert.equal(placementPromptMessage("Saved: live.", o), "Placement saved. Placement prompts are switched off.");
  }
  const broken = world({ switch: true });
  broken.failNext("app_settings", "relation does not exist");
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await placementPromptsOn(broken.db), false, "unreadable is off");
  } finally {
    console.warn = warn;
  }
  assert.equal(SAVED_SWITCHED_OFF, "Placement saved. Placement prompts are switched off.");
});

test("on, a live guest post adds one prompt from its title: the placement allowance, source nomada, origin placement, first asked tomorrow", async () => {
  const w = world({ switch: true });
  const f = fakeFetch();
  const o = await add(w.db, f.fetcher);
  assert.equal(o.kind, "added");
  assert.deepEqual(f.seen, ["https://thesmallbizstack.com/best-accounting-apps"], "one own fetch");
  const [row] = placementPrompts(w.tables);
  assert.ok(row);
  assert.deepEqual(
    { text: row.text, source: row.source, origin_kind: row.origin_kind, origin_ref: row.origin_ref, allowance: row.allowance, added_on: row.added_on, added_by: row.added_by, cluster_id: row.cluster_id },
    { text: "best accounting apps for small businesses", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement", added_on: tomorrow, added_by: "nomada", cluster_id: "c1" },
  );
  assert.equal(placementPromptMessage("Saved: live.", o), "Saved: live. Prompt added: “best accounting apps for small businesses”, first asked 30 Sep.");
  // Saved again, or retried: it has its prompt, so nothing is fetched or added.
  const again = fakeFetch();
  assert.equal((await add(w.db, again.fetcher)).kind, "exists");
  assert.equal(again.seen.length, 0);
  assert.equal(placementPrompts(w.tables).length, 1);
});

test("a failed read gives the exact admin line, with the retry, and adds no prompt", async () => {
  const w = world({ switch: true });
  const o = await add(w.db, fakeFetch(403, "").fetcher);
  assert.deepEqual(o, { kind: "unread", why: "HTTP 403" });
  assert.equal(placementPromptMessage("Saved: live.", o), "Placement saved; no prompt added: couldn't read the article (HTTP 403). Retry from the placement row.");
  const timeout = await add(w.db, fakeFetch(200, "", "The operation was aborted due to timeout").fetcher);
  assert.equal(timeout.kind, "unread");
  assert.equal(placementPrompts(w.tables).length, 0);
});

test("a duplicate links instead of adding: the admin is told which prompt already measures it", async () => {
  const w = world({ switch: true });
  const html = "<title>The 9 Best Accounting Apps for Freelancers (2026) - The Small Biz Stack</title>";
  const o = await add(w.db, fakeFetch(200, html).fetcher);
  assert.deepEqual(o, { kind: "duplicate", text: "best accounting apps for freelancers", of: "What's the best accounting app for freelancers?" });
  assert.equal(placementPromptMessage("Saved: live.", o), "Placement saved; no prompt added: “best accounting apps for freelancers” is already measured by “What's the best accounting app for freelancers?”.");
  assert.equal(placementPrompts(w.tables).length, 0);
});

test("a title too short makes no prompt, with the spec's reason", async () => {
  const w = world({ switch: true });
  const o = await add(w.db, fakeFetch(200, "<title>Home</title>").fetcher);
  assert.deepEqual(o, { kind: "no_prompt", why: "title too short to make a prompt" });
  assert.equal(placementPromptMessage("Saved: live.", o), "Placement saved; no prompt added: title too short to make a prompt.");
});

test("the trigger: live, a guest post or coverage, a link insertion only when ticked, a placed tier, a live cluster", async () => {
  for (const [label, w, want] of [
    ["pitched", world({ switch: true, status: "pitched" }), "skipped"],
    ["on-site", world({ switch: true, kind: "on_site" }), "skipped"],
    ["insertion, not ticked", world({ switch: true, kind: "link_insertion" }), "skipped"],
    ["alwaystracked", world({ switch: true, tier: "tracked" }), "skipped"],
    ["stopped cluster", world({ switch: true, clusterStopped: "2026-09-01" }), "skipped"],
  ] as const) {
    const f = fakeFetch();
    const o = await add(w.db, f.fetcher);
    assert.equal(o.kind, want, label);
    assert.equal(f.seen.length, 0, `${label}: nothing fetched`);
    assert.equal(placementPromptMessage("Saved: live.", o), "Saved: live.", `${label}: the save's own line`);
  }
  const ticked = world({ switch: true, kind: "link_insertion" });
  assert.equal((await add(ticked.db, fakeFetch().fetcher, { insertion: true })).kind, "added", "an insertion the admin ticked");
  const coverage = world({ switch: true, kind: "coverage", tier: "everywhere" });
  assert.equal((await add(coverage.db, fakeFetch().fetcher)).kind, "added");
});

/** Ten live placement prompts on placements that went live `liveDaysAgo` ago, on cluster c1. */
function fullWorld(liveDaysAgo: number[], answers: Row[] = []) {
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const placements = liveDaysAgo.map((n, i) => ({ id: `pp${i}`, client_domain_id: "cl", cluster_id: "c1", kind: "guest_post", url: `https://site-${i}.example/best-apps`, url_key: `site-${i}.example/best-apps`, status: "live", live_on: day(n) }));
  const prompts = liveDaysAgo.map((n, i) => ({ id: `pq${i}`, client_domain_id: "cl", cluster_id: "c1", text: `placement prompt number ${i}`, source: "nomada", added_on: day(n - 1), stopped_on: null, origin_kind: "placement", origin_ref: `pp${i}`, allowance: "placement" }));
  return world({ switch: true, placements, prompts, answers });
}

test("full at 10: refused when no placement prompt can rotate out", async () => {
  const w = fullWorld([30, 40, 50, 60, 70, 20, 10, 5, 3, 1]);
  const o = await add(w.db, fakeFetch().fetcher);
  assert.deepEqual(o, { kind: "full" });
  assert.equal(placementPromptMessage("Saved: live.", o), `Placement saved; no prompt added: ${PLACEMENT_FULL}.`);
  assert.equal(placementPrompts(w.tables).filter((q) => q.stopped_on === null).length, 10);
});

test("full at 10: the oldest placement prompt live 12 weeks and never cited is stopped from tomorrow, never deleted, to make room", async () => {
  // pq0 and pq1 went live over 12 weeks ago; pq0's page was cited, so pq1 is the one.
  const cite = { id: "a1", client_domain_id: "cl", run_date: "2026-07-20", citations: [{ source_domain: "site-0.example", url: "https://www.site-0.example/best-apps/" }] };
  const other = { id: "a2", client_domain_id: "cl", run_date: "2026-07-20", citations: [{ source_domain: "site-1.example", url: "https://site-1.example/another-page" }] };
  const w = fullWorld([120, 100, 50, 60, 70, 20, 10, 5, 3, 1], [cite, other]);
  const o = await add(w.db, fakeFetch().fetcher);
  assert.equal(o.kind, "added");
  assert.ok(o.kind === "added" && o.rotated);
  assert.equal(o.kind === "added" ? o.rotated?.id : null, "pq1", "a citation of another page on its site is not a citation of it");
  const stopped = w.tables.tracked_questions!.find((q) => q.id === "pq1")!;
  assert.equal(stopped.stopped_on, tomorrow);
  assert.equal(stopped.stopped_by, "nomada");
  assert.equal(w.tables.tracked_questions!.find((q) => q.id === "pq0")!.stopped_on, null, "the cited one stays");
  assert.equal(placementPrompts(w.tables).length, 11, "nothing deleted");
  assert.equal(placementPrompts(w.tables).filter((q) => q.stopped_on === null).length, 10);
  assert.match(placementPromptMessage("Saved: live.", o), /To make room, “placement prompt number 1” stops from 30 Sep: its placement has been live 12 weeks or more and was never cited\.$/);
});

test("13 Oct 2026 review: an insert that fails after a rotation takes the rotation back, and the admin is told", async () => {
  for (const [label, code, kind] of [
    ["a database error", undefined, "failed"],
    ["a race on the live-text index", "23505", "duplicate"],
  ] as const) {
    const w = fullWorld([120, 100, 50, 60, 70, 20, 10, 5, 3, 1]);
    w.failNext("tracked_questions", code ? 'duplicate key value violates unique constraint "tracked_questions_cluster_live_text_uniq"' : "connection reset", code, "insert");
    const o = await add(w.db, fakeFetch().fetcher);
    assert.equal(o.kind, kind, label);
    assert.deepEqual("rotation" in o ? o.rotation : null, { text: "placement prompt number 0", restored: true }, `${label}: the rotation is named`);
    const pq0 = w.tables.tracked_questions!.find((q) => q.id === "pq0")!;
    assert.deepEqual([pq0.stopped_on, pq0.stopped_by], [null, null], `${label}: the rotated prompt is live again`);
    assert.equal(placementPrompts(w.tables).filter((q) => q.stopped_on === null).length, 10, `${label}: no measured prompt lost`);
    assert.match(placementPromptMessage("Saved: live.", o), /“placement prompt number 0” was stopped to make room and is live again\./, label);
  }
});

test("13 Oct 2026 review: a citation stored under another source_domain still counts as citing the page", async () => {
  // engines.ts keeps an engine's own `domain` as source_domain when it gives one; the URL is what citesPlacement reads.
  const cite = { id: "a1", client_domain_id: "cl", run_date: "2026-07-20", citations: [{ source_domain: "site-0-media.example", url: "https://www.site-0.example/best-apps" }] };
  const w = fullWorld([120, 100, 50, 60, 70, 20, 10, 5, 3, 1], [cite]);
  const o = await add(w.db, fakeFetch().fetcher);
  assert.equal(o.kind === "added" ? o.rotated?.id : o.kind, "pq1", "pq0's page was cited, under another source_domain");
});

test("pickRotation: oldest first, live 12 weeks or more, never cited", () => {
  const prompts = [
    { id: "a", text: "a", added_on: "2026-05-01", origin_ref: "pa" },
    { id: "b", text: "b", added_on: "2026-04-01", origin_ref: "pb" },
    { id: "c", text: "c", added_on: "2026-03-01", origin_ref: "pc" },
  ];
  const placements = new Map([
    ["pa", { live_on: "2026-04-30" }],
    ["pb", { live_on: "2026-03-31" }],
    ["pc", { live_on: "2026-08-01" }],
  ]);
  assert.equal(ROTATE_AFTER_DAYS, 84);
  assert.deepEqual(pickRotation(prompts, placements, new Map([["pa", false], ["pb", false]]), today), { id: "b", text: "b" }, "c is the oldest prompt, but its placement is too young");
  assert.deepEqual(pickRotation(prompts, placements, new Map([["pa", false], ["pb", true]]), today), { id: "a", text: "a" });
  assert.equal(pickRotation(prompts, placements, new Map([["pa", true], ["pb", true]]), today), null);
});

test("removed: the placement's prompt is stopped from tomorrow, never deleted; without the columns there is nothing to stop", async () => {
  const w = world({ prompts: [{ id: "pq", client_domain_id: "cl", cluster_id: "c1", text: "best accounting apps for small businesses", source: "nomada", added_on: "2026-09-01", stopped_on: null, origin_kind: "placement", origin_ref: "p1", allowance: "placement" }] });
  const before = w.tables.tracked_questions!.length;
  const s = await stopPlacementPrompt(w.db, { clientId: "cl", placementId: "p1", today });
  assert.deepEqual(s, { ok: true, stopped: [{ id: "pq", text: "best accounting apps for small businesses" }] });
  assert.equal(w.tables.tracked_questions!.find((q) => q.id === "pq")!.stopped_on, tomorrow);
  assert.equal(w.tables.tracked_questions!.length, before);
  assert.deepEqual(await stopPlacementPrompt(w.db, { clientId: "cl", placementId: "p1", today }), { ok: true, stopped: [] }, "already stopping");
  const legacy = promptsDb({ tracked_questions: [{ id: "x", client_domain_id: "cl", text: "t", stopped_on: null }] }, { columns: { tracked_questions: ["id", "client_domain_id", "text", "stopped_on"] } });
  assert.deepEqual(await stopPlacementPrompt(legacy.db, { clientId: "cl", placementId: "p1", today }), { ok: true, stopped: [] });
});

test("every outcome has an admin line, and none names a price", () => {
  const all: PlacementPromptOutcome[] = [
    { kind: "off" },
    { kind: "skipped", why: "not live" },
    { kind: "exists", promptId: "q", text: "t" },
    { kind: "added", promptId: "q", text: "t", addedOn: tomorrow, rotated: null },
    { kind: "duplicate", text: "t", of: "u" },
    { kind: "unread", why: "HTTP 500" },
    { kind: "no_prompt", why: "title too short to make a prompt" },
    { kind: "full" },
    { kind: "failed", message: "Could not read the client: timeout" },
  ];
  for (const o of all) {
    const line = placementPromptMessage("Saved: live.", o);
    assert.ok(line.length > 0, o.kind);
    assert.doesNotMatch(line, /[$£€]\s?\d|price|cost|fee/i, o.kind);
  }
});

// ---- The admin save's message paths (13 Oct 2026 review: logPlacement and updatePlacement call placementSaved) ----

const saved = (db: Parameters<typeof placementSaved>[0], fetcher: ReturnType<typeof fakeFetch>["fetcher"], p: { before: string | null; after: string; retry?: boolean; insertion?: boolean; saved?: string }) =>
  placementSaved(db, { clientId: "cl", placementId: "p1", before: p.before, after: p.after, retry: p.retry ?? false, insertion: p.insertion ?? false, today, saved: p.saved ?? "Saved: live." }, { fetcher });

test("the save: logged live, or moved to live, runs the hook; re-saved while live fetches nothing, so the switch backfills nothing in bulk", async () => {
  const w = world({ switch: true });
  const resave = fakeFetch();
  assert.equal(await saved(w.db, resave.fetcher, { before: "live", after: "live" }), "Saved: live.");
  assert.equal(resave.seen.length, 0);
  const logged = fakeFetch();
  assert.equal(await saved(w.db, logged.fetcher, { before: null, after: "live", saved: "Logged thesmallbizstack.com/best-accounting-apps (live)." }), "Logged thesmallbizstack.com/best-accounting-apps (live). Prompt added: “best accounting apps for small businesses”, first asked 30 Sep.");
  assert.equal(logged.seen.length, 1);
  const pitched = fakeFetch();
  assert.equal(await saved(world({ switch: true, status: "pitched" }).db, pitched.fetcher, { before: null, after: "pitched", saved: "Logged x (pitched)." }), "Logged x (pitched).", "a placement not live is only logged");
  assert.equal(pitched.seen.length, 0);
  const moved = world({ switch: true });
  assert.match(await saved(moved.db, fakeFetch().fetcher, { before: "scheduled", after: "live" }), /^Saved: live\. Prompt added: /);
});

test("the save: with the switch off the admin line is the spec's, word for word, and nothing is fetched", async () => {
  const f = fakeFetch();
  assert.equal(await saved(world({ switch: false }).db, f.fetcher, { before: "scheduled", after: "live" }), "Placement saved. Placement prompts are switched off.");
  assert.equal(await saved(world({}).db, f.fetcher, { before: null, after: "live", saved: "Logged x (live)." }), "Placement saved. Placement prompts are switched off.");
  assert.equal(f.seen.length, 0);
});

test("the save: a failed read is the spec's line, with the retry, and the Retry's own lines never say 'Placement saved'", async () => {
  const w = world({ switch: true });
  assert.equal(await saved(w.db, fakeFetch(403, "").fetcher, { before: "scheduled", after: "live" }), "Placement saved; no prompt added: couldn't read the article (HTTP 403). Retry from the placement row.");
  assert.equal(await saved(w.db, fakeFetch(403, "").fetcher, { before: "live", after: "live", retry: true }), "No prompt added: couldn't read the article (HTTP 403). Retry from the placement row.");
  assert.equal(await saved(w.db, fakeFetch().fetcher, { before: "live", after: "live", retry: true }), "Prompt added: “best accounting apps for small businesses”, first asked 30 Sep.");
  assert.equal(await saved(w.db, fakeFetch().fetcher, { before: "live", after: "live", retry: true }), "It already has its prompt: “best accounting apps for small businesses”.");
  assert.equal(await saved(world({ switch: false }).db, fakeFetch().fetcher, { before: "live", after: "live", retry: true }), SWITCHED_OFF, "a Retry from a page drawn before the switch went off");
  assert.equal(await saved(world({ switch: true, kind: "on_site" }).db, fakeFetch().fetcher, { before: "live", after: "live", retry: true }), "No prompt added: on-site work adds no prompt.");
  assert.equal(await saved(world({ switch: true, kind: "link_insertion" }).db, fakeFetch().fetcher, { before: "live", after: "live", retry: true }), "No prompt added: a link insertion adds one only with “Add a prompt from this article's title” ticked.");
  assert.match(await saved(world({ switch: true, kind: "link_insertion" }).db, fakeFetch().fetcher, { before: "live", after: "live", retry: true, insertion: true }), /^Prompt added: /, "ticked");
  assert.equal(await saved(world({ switch: true, status: "pitched" }).db, fakeFetch().fetcher, { before: "pitched", after: "pitched", retry: true }), "No prompt added: not live.");
});

test("the save: a move to removed stops the placement's prompt, or says why it could not", async () => {
  const prompt = { id: "pq", client_domain_id: "cl", cluster_id: "c1", text: "best accounting apps for small businesses", source: "nomada", added_on: "2026-09-01", stopped_on: null, origin_kind: "placement", origin_ref: "p1", allowance: "placement" };
  const w = world({ prompts: [prompt] });
  const f = fakeFetch();
  assert.equal(await saved(w.db, f.fetcher, { before: "live", after: "removed", saved: "Saved: removed." }), "Saved: removed. Its prompt “best accounting apps for small businesses” stops from 30 Sep; its history stays.");
  assert.equal(f.seen.length, 0, "a removal fetches nothing, switch or no switch");
  assert.equal(await saved(w.db, f.fetcher, { before: "removed", after: "removed", saved: "Saved: removed." }), "Saved: removed.", "already removed: nothing to stop");
  const broken = world({ prompts: [{ ...prompt }] });
  broken.failNext("tracked_questions", "connection reset");
  assert.equal(await saved(broken.db, f.fetcher, { before: "live", after: "removed", saved: "Saved: removed." }), "Saved: removed. Its prompt was not stopped: Could not read its prompt: connection reset");
  assert.equal(await saved(world({}).db, f.fetcher, { before: "live", after: "removed", saved: "Saved: removed." }), "Saved: removed.", "no prompt to stop");
});
