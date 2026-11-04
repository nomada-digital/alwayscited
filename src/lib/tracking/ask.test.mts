import assert from "node:assert/strict";
import { test } from "node:test";

import { ASKS_PER_MEMBER_PER_DAY, ASK_ITEMS_MAX, ASK_REFUSED, aliasAskMail, askGate, askRefusal, billingAskMail, readAskAbout, askMail, askRecipient, askToast, readAskItems, readAskKeyword, readHideCta, readUpgradeCta, recordHidden, upgradeAskMail, upsellMode } from "./ask.ts";

/** A stub of the one count askGate reads, recording the filters it was given. */
function countDb(count: number | null, error: { message: string } | null = null) {
  const filters: [string, string, unknown][] = [];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
    gte: (c: string, v: unknown) => (filters.push(["gte", c, v]), Promise.resolve({ count, error })),
  };
  return { db: { from: (t: string) => (assert.equal(t, "cta_events"), q) } as never, filters };
}

test("off asks nobody; agency asks its contact, or us when it has none; nomada asks us", () => {
  assert.equal(askRecipient("off", "a@agency.example"), null);
  assert.deepEqual(askRecipient("agency", "a@agency.example"), { to: "a@agency.example", who: "your account contact" });
  assert.deepEqual(askRecipient("agency", null), { to: null, who: "Nomada Digital" });
  assert.deepEqual(askRecipient("nomada", "a@agency.example"), { to: null, who: "Nomada Digital" });
  assert.equal(upsellMode("agency"), "agency");
  assert.equal(upsellMode("anything"), "nomada");
});

test("three asks a member a day, counted off today's asked rows for this client", async () => {
  assert.equal(ASKS_PER_MEMBER_PER_DAY, 3);
  const two = countDb(2);
  assert.deepEqual(await askGate(two.db, { clientId: "c", email: "m@example.com", today: "2026-09-30" }), { ok: true });
  assert.deepEqual(two.filters, [
    ["eq", "client_domain_id", "c"],
    ["eq", "member_email", "m@example.com"],
    ["eq", "action", "asked"],
    ["gte", "created_at", "2026-09-30T00:00:00Z"],
  ]);
  assert.deepEqual(await askGate(countDb(3).db, { clientId: "c", email: "m", today: "2026-09-30" }), { ok: false, reason: "capped" });
  assert.deepEqual(await askGate(countDb(null, { message: "x" }).db, { clientId: "c", email: "m", today: "2026-09-30" }), { ok: false, reason: "read_failed" });
});

test("the keyword is trimmed and single-spaced; blank is no ask", () => {
  assert.equal(readAskKeyword("  cloud   accounting "), "cloud accounting");
  assert.equal(readAskKeyword("   "), null);
  assert.equal(readAskKeyword(undefined), null);
});

test("the mail names the client, the member and the keyword, and no tier in agency mode", () => {
  const m = askMail({ brand: "Tallyroo", domain: "example.com", member: "m@example.com", keyword: "invoices", mode: "nomada" });
  assert.equal(m.subject, "Pick a cluster keyword for Tallyroo");
  assert.match(m.text, /m@example\.com \(Tallyroo, example\.com\)/);
  assert.match(m.text, /The keyword they tried: invoices/);
  assert.match(m.text, /alwaystracked/);
  assert.doesNotMatch(askMail({ brand: "T", domain: "example.com", member: "m", keyword: "k", mode: "agency" }).text, /always/);
});

test("the toast, as the board's: who it went to and who will be answered", () => {
  assert.equal(askToast("Nomada Digital", "m@example.com"), "Sent to Nomada Digital. We'll reply to m@example.com.");
  assert.equal(askToast("your account contact", "m@example.com"), "Sent to your account contact. They'll reply to m@example.com.");
  // CTAs.dc.html, after "Ask about these".
  assert.equal(askToast("Nomada Digital", "maya@tallyroo.com", "5 prompts"), "Sent to Nomada Digital with the 5 prompts attached. We'll reply to maya@tallyroo.com.");
});

test("R151 (3 Oct 2026): the day's cap says tomorrow, a failed send says later, and only those two codes are read", () => {
  assert.equal(askRefusal("capped"), `You have sent today's ${ASKS_PER_MEMBER_PER_DAY} asks. Ask again tomorrow.`);
  assert.equal(askRefusal("refused"), ASK_REFUSED.refused);
  assert.equal(askRefusal("sent"), null);
  assert.equal(askRefusal("toString"), null);
  assert.equal(askRefusal(["capped"]), null);
});

test("Ask about these: only the two prompts with an ask, uuid items once each, capped", () => {
  assert.equal(readUpgradeCta("mentioned"), "mentioned");
  assert.equal(readUpgradeCta("cited"), "cited");
  assert.equal(readUpgradeCta("everywhere"), null, "its second button is Book a call");
  assert.equal(readUpgradeCta(null), null);
  const id = "0b7e7c1e-3b1a-4c2d-9e8f-0123456789ab";
  assert.deepEqual(readAskItems([id, id.toUpperCase(), "not-an-id", 7, "' or 1=1"]), [id]);
  const many = Array.from({ length: ASK_ITEMS_MAX + 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.equal(readAskItems(many).length, ASK_ITEMS_MAX);
});

test("Ask about these: the mail lists the items and names a tier only outside agency mode", () => {
  const m = upgradeAskMail({ brand: "Tallyroo", domain: "example.com", member: "m@example.com", cta: "mentioned", items: ["What is the best invoicing tool?", "Cheapest bookkeeping app?"], mode: "nomada" });
  assert.equal(m.subject, "Tallyroo asked about 2 prompts");
  assert.match(m.text, /^- What is the best invoicing tool\?$/m);
  assert.match(m.text, /^- Cheapest bookkeeping app\?$/m);
  assert.match(m.text, /alwaysmentioned/);
  const a = upgradeAskMail({ brand: "T", domain: "example.com", member: "m", cta: "cited", items: ["invoicing software"], mode: "agency" });
  assert.equal(a.subject, "T asked about 1 keyword");
  assert.doesNotMatch(a.text, /always/);
});

test("Hide for 30 days: any prompt's cta, one hidden row for this member", async () => {
  assert.equal(readHideCta("everywhere"), "everywhere");
  assert.equal(readHideCta("shown"), null);
  let row: unknown = null;
  const db = { from: (t: string) => (assert.equal(t, "cta_events"), { insert: (r: unknown) => ((row = r), Promise.resolve({ error: null })) }) } as never;
  assert.equal(await recordHidden(db, { clientId: "c", email: "m@example.com", cta: "mentioned" }), true);
  assert.deepEqual(row, { client_domain_id: "c", member_email: "m@example.com", cta: "mentioned", action: "hidden", trigger: {} });
});

test("Settings asks (R142 part 3): aliases and billing only, tier-free in agency mode", () => {
  assert.equal(readAskAbout("aliases"), "aliases");
  assert.equal(readAskAbout("billing"), "billing");
  assert.equal(readAskAbout("mentioned"), null);
  assert.equal(readAskAbout(undefined), null);
  const m = aliasAskMail({ brand: "T", domain: "example.com", member: "m@example.com", names: ["T", "T Ltd"], mode: "nomada" });
  assert.equal(m.subject, "Change the names matched for T");
  assert.match(m.text, /^- T Ltd$/m);
  assert.match(m.text, /alwaystracked/);
  assert.doesNotMatch(aliasAskMail({ brand: "T", domain: "example.com", member: "m", names: ["T"], mode: "agency" }).text, /always/);
  assert.doesNotMatch(billingAskMail({ brand: "T", domain: "example.com", member: "m", mode: "agency" }).text, /always/);
});
