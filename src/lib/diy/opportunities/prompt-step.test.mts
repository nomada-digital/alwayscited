import assert from "node:assert/strict";
import { test } from "node:test";

import { promptsDb } from "../prompts/fake-prompts-db.mts";
import { swapCandidates } from "../prompts/swap.ts";

import { dbPromptPort, runPromptStep, stepLine, swapPromptStep, undoPromptStep } from "./prompt-step.ts";
import { promptState } from "./detail.ts";

/**
 * The prompt step (13 Oct 2026, DIY P7 on P2's rules; spec 10 section 6.7),
 * run through limits.ts and stop.ts as they are, on a fake PostgREST: a free
 * slot takes the prompt with its origin and the first free angle; Undo
 * stops it while pending; a duplicate links the prompt that measures it; a
 * full cluster sends the member to the swap picker; Swap stops the chosen
 * prompt and puts the new one in its angle; placement prompts are never
 * offered or stopped. Illustrative: every brand here is made up.
 */

const TODAY = "2026-10-13";
const TOMORROW = "2026-10-14";
const OPP = { id: "opp-1", lens: "cited" as const, pageType: "best_of" as const, title: null, clusterId: "k1" };
const FACTS = { title: "The 9 best invoicing apps for freelancers (2026) - SmallBizDesk", h1: null };
const ANGLES = ["category", "positioning", "sector", "outcome", "comparison"];

function world(prompts: { text: string; angle?: string; allowance?: string | null; added_on?: string; stopped_on?: string | null }[], answers: Record<string, unknown>[] = []) {
  const f = promptsDb({
    client_domains: [{ id: "c1", cluster_limit: 10 }],
    tracked_clusters: [{ id: "k1", client_domain_id: "c1", stopped_on: null, keyword_id: null }],
    tracked_questions: prompts.map((p, i) => ({ id: `q${i + 1}`, client_domain_id: "c1", cluster_id: "k1", text: p.text, angle: p.angle ?? ANGLES[i] ?? null, allowance: p.allowance ?? null, added_on: p.added_on ?? "2026-06-10", stopped_on: p.stopped_on ?? null, source: "scan" })),
    opportunities: [{ id: "opp-1", client_domain_id: "c1", prompt_id: null }],
    tracking_answers: answers,
  });
  return { ...f, port: dbPromptPort(f.db, { clientId: "c1", today: TODAY, by: "o@example.com", role: "owner" }) };
}
const FOUR = ["What's the best invoicing software?", "Which invoicing software is easiest for one person?", "Which invoicing software do consultants recommend?", "Which invoicing software gets paid fastest?"].map((text) => ({ text }));
const step = { opp: OPP, facts: FACTS, keyword: "invoicing software", market: "US", today: TODAY, by: "o@example.com" };

test("a free slot: the prompt goes in with its origin, the first free angle, source client, first asked tomorrow", async () => {
  const w = world(FOUR);
  const r = await runPromptStep(w.port, step);
  assert.equal(r.kind, "added");
  assert.ok(r.kind === "added" && r.text === "best invoicing apps for freelancers" && r.slot === 5 && r.of === 5);
  const q = w.tables.tracked_questions!.find((x) => x.text === "best invoicing apps for freelancers")!;
  assert.equal(q.origin_kind, "opportunity");
  assert.equal(q.origin_ref, "opp-1");
  assert.equal(q.source, "client");
  assert.equal(q.angle, "comparison");
  assert.equal(q.added_on, TOMORROW);
  assert.equal(q.cluster_id, "k1");
  assert.equal(w.tables.opportunities![0]!.prompt_id, q.id);
  assert.equal(stepLine(r, "invoicing software"), "Added 'best invoicing apps for freelancers' to 'invoicing software' (slot 5 of 5).");
});

test("Undo while pending stops it through the stop path; not once it has a reading, and never a prompt it only links", async () => {
  const w = world(FOUR);
  const r = await runPromptStep(w.port, step);
  assert.ok(r.kind === "added");
  const q = w.tables.tracked_questions!.find((x) => x.id === r.promptId)!;
  const undone = await undoPromptStep(w.port, { opportunityId: "opp-1", prompt: { id: q.id as string, origin_ref: "opp-1", added_on: TOMORROW, stopped_on: null }, today: TODAY });
  assert.deepEqual(undone, { ok: true });
  assert.equal(q.stopped_on, TOMORROW, "stopped from tomorrow, never deleted");
  assert.equal(w.tables.opportunities![0]!.prompt_id, null);
  assert.ok(w.tables.tracked_questions!.includes(q));
  const read = await undoPromptStep(w.port, { opportunityId: "opp-1", prompt: { id: "q1", origin_ref: "opp-1", added_on: "2026-06-10", stopped_on: null }, today: TODAY });
  assert.equal(read.ok, false, "a prompt with readings stays");
  const linked = await undoPromptStep(w.port, { opportunityId: "opp-1", prompt: { id: "q1", origin_ref: null, added_on: TOMORROW, stopped_on: null }, today: TODAY });
  assert.deepEqual(linked, { ok: false, message: "That prompt wasn't added from this page." });
});

test("a duplicate links the prompt that already measures it, and adds nothing", async () => {
  const w = world([{ text: "What's the best invoicing app for freelancers?" }, ...FOUR.slice(1)]);
  const before = w.tables.tracked_questions!.length;
  const r = await runPromptStep(w.port, step);
  assert.deepEqual(r, { kind: "duplicate", promptId: "q1", text: "What's the best invoicing app for freelancers?" });
  assert.equal(w.tables.tracked_questions!.length, before);
  assert.equal(w.tables.opportunities![0]!.prompt_id, "q1");
  assert.equal(stepLine(r, "x"), "Already measured by 'What's the best invoicing app for freelancers?'.");
});

test("a full cluster sends the member to the swap picker, and adds nothing", async () => {
  const w = world([...FOUR, { text: "Which invoicing software is better than Brightly?" }]);
  const r = await runPromptStep(w.port, step);
  assert.deepEqual(r, { kind: "full", text: "best invoicing apps for freelancers" });
  assert.equal(w.tables.tracked_questions!.length, 5);
});

test("Swap stops the chosen prompt from tomorrow and puts the new one in its angle", async () => {
  const w = world([...FOUR, { text: "Which invoicing software is better than Brightly?" }]);
  const r = await swapPromptStep(w.port, { ...step, stopId: "q3" });
  assert.equal(r.kind, "added");
  const stopped = w.tables.tracked_questions!.find((x) => x.id === "q3")!;
  assert.equal(stopped.stopped_on, TOMORROW);
  const added = w.tables.tracked_questions!.find((x) => x.text === "best invoicing apps for freelancers")!;
  assert.equal(added.angle, "sector");
  assert.equal(added.origin_ref, "opp-1");
  const bad = await swapPromptStep(w.port, { ...step, stopId: "nope" });
  assert.equal(bad.kind, "refused");
});

test("placement prompts are never offered in the picker, never stopped, and take no angle slot", async () => {
  const w = world([...FOUR, { text: "best accounting apps for small businesses", angle: "placement", allowance: "placement" }]);
  const r = await runPromptStep(w.port, step);
  assert.equal(r.kind, "added", "four angle prompts and a placement prompt leave a slot");
  const full = world([...FOUR, { text: "Which invoicing software is better than Brightly?" }, { text: "best accounting apps for small businesses", allowance: "placement" }]);
  const live = await full.port.live("k1");
  const picker = swapCandidates(live, [], { today: TODAY });
  assert.ok(!picker.some((c) => c.text === "best accounting apps for small businesses"));
  const s = await swapPromptStep(full.port, { ...step, stopId: "q6" });
  assert.equal(s.kind, "refused");
  assert.equal(full.tables.tracked_questions!.find((x) => x.id === "q6")!.stopped_on, null);
});

test("no prompt for a link lens, a page with no cluster, or a title that makes none", async () => {
  const w = world(FOUR);
  assert.equal((await runPromptStep(w.port, { ...step, opp: { ...OPP, lens: "link_domain" } })).kind, "none");
  assert.equal((await runPromptStep(w.port, { ...step, opp: { ...OPP, clusterId: null } })).kind, "none");
  // 13 Oct 2026, review of DIY P7: a logged page is never given a cluster, so it never promises one ("no cluster yet").
  assert.deepEqual(await runPromptStep(w.port, { ...step, opp: { ...OPP, lens: "logged", clusterId: null } }), { kind: "none", reason: "a page you logged has no cluster" });
  assert.equal((await runPromptStep(w.port, { ...step, facts: { title: "Home", h1: null } })).kind, "none");
});

test("the page's prompt state: preview, added with Undo while pending, duplicate, watching, full with the picker", () => {
  const base = { offered: { ok: true as const, text: "best invoicing apps for freelancers" }, cluster: { id: "k1", name: "invoicing software" }, today: TODAY, candidates: [] };
  const live = FOUR.map((p, i) => ({ id: `q${i + 1}`, text: p.text, angle: ANGLES[i]!, added_on: "2026-06-10", placement: false }));
  assert.equal(promptState({ ...base, opp: { id: "o", status: "new", lens: "cited", promptId: null, history: [] }, live, prompt: null })?.kind, "preview");
  const added = promptState({ ...base, opp: { id: "o", status: "pursuing", lens: "cited", promptId: "q9", history: [] }, live: [...live, { id: "q9", text: "best invoicing apps for freelancers", angle: "comparison", added_on: TOMORROW, placement: false }], prompt: { id: "q9", text: "best invoicing apps for freelancers", origin_ref: "o", added_on: TOMORROW, stopped_on: null } });
  assert.ok(added?.kind === "added" && added.undo && added.slot === 5);
  const dup = promptState({ ...base, opp: { id: "o", status: "pursuing", lens: "cited", promptId: "q1", history: [] }, live, prompt: { id: "q1", text: FOUR[0]!.text, origin_ref: null, added_on: "2026-06-10", stopped_on: null } });
  assert.equal(dup?.kind, "duplicate");
  const watching = promptState({ ...base, opp: { id: "o", status: "pursuing", lens: "cited", promptId: null, history: [{ at: "x", kind: "status", status: "pursuing" }, { at: "y", kind: "prompt", text: "Chose to watch the page, with no prompt." }] }, live: [...live, { id: "q5", text: "x", angle: "comparison", added_on: "2026-06-10", placement: false }], prompt: null });
  assert.equal(watching?.kind, "watching");
  const full = promptState({ ...base, opp: { id: "o", status: "pursuing", lens: "cited", promptId: null, history: [] }, live: [...live, { id: "q5", text: "x", angle: "comparison", added_on: "2026-06-10", placement: false }], prompt: null });
  assert.equal(full?.kind, "full");
  assert.equal(promptState({ ...base, opp: { id: "o", status: "pursuing", lens: "link_page", promptId: null, history: [] }, live, prompt: null }), null);
});
