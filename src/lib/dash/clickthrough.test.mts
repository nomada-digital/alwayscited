import assert from "node:assert/strict";
import { test } from "node:test";

import { answerDiff, highlight, ownNames } from "./highlight.ts";
import { readOp } from "./ops.ts";
import { sourcesIn } from "./sources.ts";
import { packCheckoutForm, packQuantity } from "../checkout/packs.ts";
import { handleWebhook, signStripePayload } from "../checkout/webhook.ts";
import { keywordDifficultyRequest, keywordSuggestionsRequest, parseKeywordDifficulty, parseKeywordSuggestions, parseRelatedKeywords, relatedKeywordsRequest } from "../scan/dataforseo-request.ts";

/** Click-through views, keyword research and packs (17 Oct 2026). */

test("highlight: the client's names and the named competitors are marked, whole words, longest first", () => {
  const segs = highlight("Try Michael Page Life Sciences, Acme or acmeville.", ["Acme"], ["Michael Page", "Michael Page Life Sciences"]);
  assert.deepEqual(segs.filter((s) => s.mark).map((s) => [s.text, s.mark]), [["Michael Page Life Sciences", "rival"], ["Acme", "you"]]);
  assert.equal(highlight("ok", ["ab"], []).length, 1, "names under 3 characters are never matched");
  assert.deepEqual(ownNames({ brand: null, domain: "www.meetlifesciences.com" }), ["meetlifesciences.com", "meetlifesciences"]);
});

test("answerDiff: named gained or lost, brands and sources in and out", () => {
  const d = answerDiff({ named: false, brands: ["A", "B"], sources: ["x.com"] }, { named: true, brands: ["b", "C"], sources: ["x.com", "y.com"] });
  assert.equal(d.named, "gained");
  assert.deepEqual(d.brandsIn, ["C"]);
  assert.deepEqual(d.brandsOut, ["A"]);
  assert.deepEqual(d.sourcesIn, ["y.com"]);
  assert.equal(answerDiff(null, { named: true, brands: [], sources: [] }).named, null);
});

test("sources over a range: counted per answer, only live prompts, the client's own site flagged", () => {
  const rows = [
    { run_date: "2026-10-01", question_id: "p1", engine: "chatgpt" as const, named: true, citations: [{ url: "https://www.list.com/a" }, { url: "https://list.com/b" }, { url: "https://acme.com/" }] },
    { run_date: "2026-10-02", question_id: "p1", engine: "gemini" as const, named: false, citations: [{ url: "https://list.com/a" }] },
    { run_date: "2026-10-02", question_id: "gone", engine: "gemini" as const, named: false, citations: [{ url: "https://other.com/" }] },
  ];
  const s = sourcesIn(rows, new Set(["p1"]), "acme.com");
  assert.deepEqual(s.map((x) => [x.domain, x.answers, x.urls, x.you]), [["list.com", 2, 2, false], ["acme.com", 1, 1, true]]);
});

test("keyword research: requests are capped and parsers read only named fields", () => {
  assert.equal(keywordSuggestionsRequest({ seed: "  Life Sciences  Recruitment ", market: "US" }).rows, 50);
  assert.equal(((keywordSuggestionsRequest({ seed: "x y", market: "UK" }).body as unknown as { keyword: string }[])[0]!.keyword), "x y");
  assert.throws(() => keywordSuggestionsRequest({ seed: "a", market: "US" }));
  assert.throws(() => relatedKeywordsRequest({ seed: "abc", market: "US", limit: 101 }));
  assert.equal(keywordDifficultyRequest({ keywords: ["A b", "a B", "c d"], market: "US" }).rows, 2, "de-duplicated");
  const task = (items: unknown[]) => ({ status_code: 20000, result: [{ items }] }) as never;
  assert.deepEqual(parseKeywordSuggestions(task([{ keyword: "Life Sciences Staffing", keyword_info: { search_volume: 320, cpc: 4.567 }, keyword_properties: { keyword_difficulty: 41.6 }, search_intent_info: { main_intent: "commercial" } }, { keyword: "" }])), [
    { keyword: "life sciences staffing", volume: 320, kd: 42, cpc: 4.57, intent: "commercial" },
  ]);
  assert.equal(parseRelatedKeywords(task([{ keyword_data: { keyword: "biotech recruiters", keyword_info: { search_volume: 90 } } }]))[0]?.volume, 90);
  assert.deepEqual(parseKeywordDifficulty(task([{ keyword: "x y", keyword_difficulty: 120 }])), [{ keyword: "x y", kd: 100 }]);
});

test("keyword.add from research carries volume and intent, and only sane ones", () => {
  const op = readOp({ op: "keyword.add", tempId: "t1", clusterId: "k1", groupId: null, keyword: "x y", volume: 320, intent: "commercial" });
  assert.deepEqual(op, { op: "keyword.add", tempId: "t1", clusterId: "k1", groupId: null, keyword: "x y", volume: 320, intent: "commercial" });
  assert.deepEqual(readOp({ op: "keyword.add", tempId: "t1", clusterId: "k1", groupId: null, keyword: "x y", volume: -3, intent: "evil" }), { op: "keyword.add", tempId: "t1", clusterId: "k1", groupId: null, keyword: "x y" });
});

test("packs: the Checkout form is the client's own customer, pricing's amount, marked kind=pack on session and subscription", () => {
  const f = packCheckoutForm({ customer: "cus_1", clientId: "c", slug: "acme-com", market: "uk", unitAmount: 39, name: "pack", returnTo: "https://x/acme-com/plan" });
  assert.equal(f.get("customer"), "cus_1");
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "3900");
  assert.equal(f.get("line_items[0][price_data][currency]"), "gbp");
  assert.equal(f.get("metadata[kind]"), "pack");
  assert.equal(f.get("subscription_data[metadata][kind]"), "pack");
  assert.equal(packQuantity({ items: { data: [{ quantity: 2 }] } }), 2);
});

test("the webhook sends a pack to its own handler and never to signup", async () => {
  const secret = "whsec_test";
  const calls: string[] = [];
  const deps = {
    record: async () => "new" as const,
    forget: async () => {},
    completed: async () => (calls.push("signup"), true),
    updated: async () => (calls.push("updated"), true),
    deleted: async () => (calls.push("deleted"), true),
    trialWillEnd: async () => true,
    paymentFailed: async () => true,
    packCompleted: async () => (calls.push("pack-completed"), true),
    packChanged: async (_s: Record<string, unknown>, ended: boolean) => (calls.push(ended ? "pack-ended" : "pack-changed"), true),
  };
  const send = async (type: string, object: Record<string, unknown>) => {
    const raw = JSON.stringify({ id: `evt_${type}`, type, created: 1, data: { object } });
    const t = Math.floor(Date.now() / 1000);
    return handleWebhook(raw, `t=${t},v1=${signStripePayload(raw, secret, t)}`, secret, deps as never);
  };
  await send("checkout.session.completed", { metadata: { kind: "pack", client_domain_id: "x" }, subscription: "sub_1" });
  await send("customer.subscription.updated", { id: "sub_1", metadata: { kind: "pack" } });
  await send("customer.subscription.deleted", { id: "sub_1", metadata: { kind: "pack" } });
  await send("customer.subscription.updated", { id: "sub_main", metadata: {} });
  assert.deepEqual(calls, ["pack-completed", "pack-changed", "pack-ended", "updated"]);
});
