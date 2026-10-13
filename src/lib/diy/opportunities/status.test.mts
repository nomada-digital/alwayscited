import assert from "node:assert/strict";
import { test } from "node:test";

import { promptsDb } from "../prompts/fake-prompts-db.mts";

import { ENDED_REASON, VIEWER_REASON, decideOpp, ensureOpportunity, historyOf, oppToast, opportunityOf, pursueOpportunity, pursuitCap, planCandidate, planMoveFor } from "./status.ts";
import { EMPTY_EVIDENCE } from "./types.ts";

/**
 * Statuses (13 Oct 2026, DIY P7; spec 10 sections 2.2, 2.5 and 4.7): the
 * moves, the cap of 10 pages at once (3 in the trial), roles, the ended
 * client read-only, `ensureOpportunity` for every lens (P10 calls it with
 * `link_domain`), and `pursueOpportunity` putting the Plan item in Doing.
 */

const TODAY = "2026-10-13";
const NOW = "2026-10-13T09:00:00.000Z";
const ctx = (over: Partial<Parameters<typeof decideOpp>[2]> = {}) => ({ role: "owner", ended: false, trial: false, active: 0, today: TODAY, now: NOW, by: "owner@example.com", ...over });
const row = (status: string, over: Record<string, unknown> = {}) => ({ status, pursuedOn: null, note: null, ...over }) as Parameters<typeof decideOpp>[1];

test("moves: from where to where", () => {
  const ok = (d: ReturnType<typeof decideOpp>) => (d.op === "update" ? d.to : d.why);
  assert.equal(ok(decideOpp({ do: "pursue" }, row("new"), ctx())), "pursuing");
  assert.equal(ok(decideOpp({ do: "pursue" }, row("dismissed"), ctx())), "pursuing");
  assert.equal(ok(decideOpp({ do: "pitched" }, row("pursuing"), ctx())), "pitched");
  assert.equal(ok(decideOpp({ do: "won" }, row("pitched"), ctx())), "won");
  assert.equal(ok(decideOpp({ do: "decline" }, row("pursuing"), ctx())), "declined");
  assert.equal(ok(decideOpp({ do: "reopen" }, row("won"), ctx())), "new");
  assert.equal(ok(decideOpp({ do: "pitched" }, row("new"), ctx())), "move");
  assert.equal(ok(decideOpp({ do: "won" }, row("new"), ctx())), "move");
  assert.equal(ok(decideOpp({ do: "reopen" }, row("new"), ctx())), "move");
  assert.equal(ok(decideOpp({ do: "pursue" }, null, ctx())), "gone");
});

test("not for us takes a reason from the fixed list; a note is 0-200 characters", () => {
  const d = decideOpp({ do: "dismiss", reason: "not_relevant" }, row("new"), ctx());
  assert.ok(d.op === "update" && d.patch.dismiss_reason === "not_relevant");
  assert.deepEqual(decideOpp({ do: "dismiss", reason: "spam" }, row("new"), ctx()), { op: "refuse", why: "reason" });
  assert.deepEqual(decideOpp({ do: "dismiss" }, row("new"), ctx()), { op: "refuse", why: "reason" });
  const n = decideOpp({ do: "note", note: "  Wrote   to the editor.  " }, row("pursuing"), ctx());
  assert.ok(n.op === "update" && n.patch.note === "Wrote to the editor." && n.expect === "pursuing");
  assert.deepEqual(decideOpp({ do: "note", note: "x".repeat(201) }, row("pursuing"), ctx()), { op: "refuse", why: "note" });
  const clear = decideOpp({ do: "note", note: "" }, row("pursuing"), ctx());
  assert.ok(clear.op === "update" && clear.patch.note === null);
});

test("the cap: 10 pages in Pursuing or Pitched at once, 3 in the trial", () => {
  assert.equal(pursuitCap({ trial: false }), 10);
  assert.equal(pursuitCap({ trial: true }), 3);
  assert.equal(decideOpp({ do: "pursue" }, row("new"), ctx({ active: 9 })).op, "update");
  assert.deepEqual(decideOpp({ do: "pursue" }, row("new"), ctx({ active: 10 })), { op: "refuse", why: "cap" });
  assert.deepEqual(decideOpp({ do: "pursue" }, row("new"), ctx({ active: 3, trial: true })), { op: "refuse", why: "cap" });
  assert.equal(decideOpp({ do: "won" }, row("pursuing"), ctx({ active: 10 })).op, "update", "the cap stops a new pursuit only");
  assert.match(oppToast("refused", "cap", { cap: 10 })!.text, /You're working 10 pages at once\. Mark one won, declined or not for us to pursue another\./);
});

test("roles: a viewer is refused, and an ended client is read-only", () => {
  assert.deepEqual(decideOpp({ do: "pursue" }, row("new"), ctx({ role: "viewer" })), { op: "refuse", why: "viewer" });
  assert.deepEqual(decideOpp({ do: "note", note: "x" }, row("new"), ctx({ role: "viewer" })), { op: "refuse", why: "viewer" });
  assert.deepEqual(decideOpp({ do: "pursue" }, row("new"), ctx({ ended: true })), { op: "refuse", why: "ended" });
  assert.equal(decideOpp({ do: "pursue" }, row("new"), ctx({ role: "editor" })).op, "update");
  assert.equal(oppToast("refused", "viewer")!.text, VIEWER_REASON);
  assert.equal(oppToast("refused", "ended")!.text, ENDED_REASON);
});

test("the first pursuit sets the pursued day; a later one keeps it", () => {
  const first = decideOpp({ do: "pursue" }, row("new"), ctx());
  assert.ok(first.op === "update" && first.patch.pursued_on === TODAY);
  const again = decideOpp({ do: "pursue" }, row("declined", { pursuedOn: "2026-09-01" }), ctx());
  assert.ok(again.op === "update" && !("pursued_on" in again.patch));
});

test("toasts are fixed words; an unknown code draws nothing, and nothing is echoed", () => {
  assert.equal(oppToast(null, null), null);
  assert.equal(oppToast("<script>", null), null);
  assert.equal(oppToast("refused", "<b>x</b>")!.text, "That didn't save. Try again in a moment.");
  assert.match(oppToast("asked", null, { cap: 10, who: "your account contact", member: "a@example.com" })!.text, /^Sent to your account contact\. They'll reply to a@example\.com\.$/);
});

test("ensureOpportunity: every lens, link_domain included; idempotent on (client, page, lens); a bad lens or URL is refused", async () => {
  const { db, tables } = promptsDb({ opportunities: [] });
  const a = await ensureOpportunity(db, "c1", { lens: "link_domain", url: "https://linkhub.example/", route: "earn_link", today: TODAY, now: NOW });
  assert.ok(a?.created);
  const b = await ensureOpportunity(db, "c1", { lens: "link_domain", url: "https://linkhub.example/", route: "earn_link", today: TODAY, now: NOW });
  assert.deepEqual(b, { id: a!.id, created: false });
  assert.equal(tables.opportunities!.length, 1);
  const r = tables.opportunities![0]!;
  assert.equal(r.lens, "link_domain");
  assert.equal(r.url_key, "linkhub.example");
  assert.equal(r.domain, "linkhub.example");
  assert.equal(r.status, "new");
  assert.equal(await ensureOpportunity(db, "c1", { lens: "nope" as never, url: "https://x.example/", route: "earn_link", today: TODAY, now: NOW }), null);
  assert.equal(await ensureOpportunity(db, "c1", { lens: "logged", url: "not a url", route: "ask_added", today: TODAY, now: NOW }), null);
  const page = await ensureOpportunity(db, "c1", { lens: "link_page", url: "https://linkhub.example/best-tools", route: "earn_link", today: TODAY, now: NOW });
  assert.ok(page?.created, "a page on the same domain under another lens is its own row");
});

test("pursueOpportunity: the cap counted, the move written against the status read, the Plan item put in Doing", async () => {
  const opp = { id: "o1", client_domain_id: "c1", lens: "link_domain", url: "https://linkhub.example/", url_key: "linkhub.example", domain: "linkhub.example", route: "earn_link", status: "new", evidence: EMPTY_EVIDENCE(TODAY), history: [], live: true, created_at: NOW };
  const { db, tables } = promptsDb({ opportunities: [opp], plan_items: [] });
  const r = await pursueOpportunity(db, { id: "c1", trial: false, ended: false }, "o1", { role: "editor", by: "e@example.com", today: TODAY, now: NOW });
  assert.deepEqual(r, { ok: true, done: "pursued" });
  assert.equal(tables.opportunities![0]!.status, "pursuing");
  assert.equal(tables.opportunities![0]!.pursued_on, TODAY);
  assert.equal(historyOf(tables.opportunities![0]!.history)[0]?.status, "pursuing");
  const item = tables.plan_items![0]!;
  assert.equal(item.dedupe_key, "opp:o1");
  assert.equal(item.kind, "earn_link");
  assert.equal(item.status, "doing");
  assert.equal(item.started_on, TODAY);
  assert.equal(item.ref_table, "opportunities");
  // Pursued again: refused as a move, nothing written twice.
  assert.deepEqual(await pursueOpportunity(db, { id: "c1", trial: false, ended: false }, "o1", { role: "editor", by: "e@example.com", today: TODAY, now: NOW }), { ok: false, why: "move" });
  assert.equal(tables.plan_items!.length, 1);
});

test("pursueOpportunity at the cap, and for a viewer, writes nothing", async () => {
  const many = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, client_domain_id: "c1", lens: "cited", url: `https://x${i}.example/`, url_key: `x${i}.example`, domain: `x${i}.example`, route: "ask_added", status: "pursuing", evidence: {}, history: [] }));
  const opp = { id: "o1", client_domain_id: "c1", lens: "cited", url: "https://lists.example/best", url_key: "lists.example/best", domain: "lists.example", route: "ask_added", status: "new", evidence: {}, history: [] };
  const { db, tables } = promptsDb({ opportunities: [...many, opp], plan_items: [] });
  assert.deepEqual(await pursueOpportunity(db, { id: "c1", trial: true, ended: false }, "o1", { role: "owner", by: "o@example.com", today: TODAY, now: NOW }), { ok: false, why: "cap" });
  assert.deepEqual(await pursueOpportunity(db, { id: "c1", trial: false, ended: false }, "o1", { role: "viewer", by: "v@example.com", today: TODAY, now: NOW }), { ok: false, why: "viewer" });
  assert.equal(tables.opportunities!.find((o) => o.id === "o1")!.status, "new");
  assert.equal(tables.plan_items!.length, 0);
});

test("the Plan item a pursuit makes, and the move each status makes", () => {
  const o = opportunityOf({ id: "o9", client_domain_id: "c1", cluster_id: "k1", lens: "cited", url: "https://lists.example/best", url_key: "lists.example/best", domain: "lists.example", route: "ask_added", status: "new", page_type: "best_of", evidence: { to: TODAY, answers: 12, prompt_count: 3, leaves_out: 12, rank: 4, keyword: "invoicing software" } })!;
  const c = planCandidate(o);
  assert.equal(c.title, "Ask to be added to lists.example's best-of list");
  assert.equal(c.kind, "get_onto_page");
  assert.equal(c.severity, "gap");
  assert.equal(c.href, "/opportunities/o9");
  assert.equal(c.why[0]!.text, "Cited in 12 answers to 3 of your prompts in the 28 days to 13 Oct; 12 left you out.");
  assert.equal(c.why[1]!.text, "Ranks #4 on Google for 'invoicing software'.");
  assert.equal(planMoveFor("won"), "done");
  assert.equal(planMoveFor("dismissed"), "dropped");
  assert.equal(planMoveFor("new"), null);
});
