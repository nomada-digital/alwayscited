import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import type { PlanItem } from "../diy/plan/types.ts";
import { TIER_PLAIN } from "../tier-text.ts";
import { previewSets, thisWeek } from "./lifecycle.ts";
import { THIS_WEEK_CHANGES, thisWeekChanges, thisWeekItems, worthSending } from "./this-week-mail.ts";

/**
 * The Monday "This week" email's copy, pinned (13 Oct 2026, DIY P9; spec 10
 * section 7.10). Illustrative: Tallyroo, Ledgerly and every site here are made
 * up. Nothing is sent: these render templates only.
 */

const LINK = "https://app.alwayscited.com/tallyroo-com/plan";
const items = [
  { severity: "blocking" as const, title: "Let Googlebot crawl /pricing", why: "robots.txt line 'Disallow: /pricing' blocks Googlebot from 1 key page of 8 (checked 17 Oct)." },
  { severity: "closest" as const, title: "Get onto the best-of lists ranking for 'invoicing software'", why: "'invoicing software' read #11 on 18 Oct." },
  { severity: "tidy" as const, title: "Add Organization schema to your homepage", why: null },
];
const changes = { state: "ok" as const, lines: ["Perplexity started naming you for 'simple invoicing for a small agency'.", "'invoice app for contractors' entered page 1: 13th to 8th."], more: 4 };

test("the copy, pinned: subject, heading, the items with why they are here, the changes, one button", () => {
  const m = thisWeek({ tier: "tracked", domain: "tallyroo.com", weekOf: "2026-10-19", items, changes, link: LINK });
  assert.equal(m.subject, "This week for tallyroo.com: 3 actions");
  assert.equal(
    m.text,
    [
      "This week",
      "",
      "Your actions for the week of 19 Oct for tallyroo.com, most important first. Each says why it is here.",
      "",
      "1. Blocking: Let Googlebot crawl /pricing. Why: robots.txt line 'Disallow: /pricing' blocks Googlebot from 1 key page of 8 (checked 17 Oct).",
      "2. Closest win: Get onto the best-of lists ranking for 'invoicing software'. Why: 'invoicing software' read #11 on 18 Oct.",
      "3. Tidy-up: Add Organization schema to your homepage.",
      "",
      "Since your last check:",
      "- Perplexity started naming you for 'simple invoicing for a small agency'.",
      "- 'invoice app for contractors' entered page 1: 13th to 8th.",
      "4 more changes are on your dashboard.",
      "",
      `Open your actions: ${LINK}`,
      "If you are signed out, sign in with this email address and we send you a one-time link.",
      "",
      "Need a hand?",
      `Book a call: https://alwayscited.com/contact?tier=${TIER_PLAIN.tracked}`,
      `Email us: ${CONTACT_EMAIL}`,
      "",
      `alwayscited is run by ${COMPANY_LINE}.`,
    ].join("\n"),
  );
  assert.equal(m.html.match(/<td bgcolor=/g)?.length, 1, "one button");
  assert.match(m.html, /Open your actions/);
});

test("the conventions: lowercase brand, no clock time, no causal word, no tier name but TIER_PLAIN", () => {
  for (const p of previewSets({ us: 129, uk: 99 }).this_week) {
    const all = `${p.mail.subject}\n${p.mail.text}\n${p.mail.html}`;
    assert.doesNotMatch(all, /AlwaysCited|Alwayscited|always cited|Always(tracked|mentioned|everywhere)/, p.label);
    assert.doesNotMatch(p.mail.text, /\b\d{1,2}:\d{2}\b|\b\d{1,2}(am|pm)\b/i, `${p.label}: a clock time`);
    assert.doesNotMatch(p.mail.text, /\b(caused|drove|because of|thanks to|resulted in|delivered)\b/i, `${p.label}: a causal word`);
    assert.doesNotMatch(p.mail.text, /\b(rank for your keywords|does it for you|the whole list|outreach)\b/i, p.label);
    assert.ok(p.mail.subject.length < 90, p.label);
  }
});

test("a week with nothing pinned, before the second check, with no change held, or with the changes unread", () => {
  const none = thisWeek({ tier: "tracked", domain: "tallyroo.com", weekOf: "2026-10-12", items: [], changes, link: LINK });
  assert.equal(none.subject, "This week for tallyroo.com");
  assert.match(none.text, /^Nothing is pinned for the week of 12 Oct for tallyroo\.com\. New actions arrive as your checks find them\.$/m);
  const early = thisWeek({ tier: "tracked", domain: "tallyroo.com", weekOf: "2026-10-12", items, changes: { state: "early" }, link: LINK });
  assert.match(early.text, /^Since your last check: changes start from your second check\.$/m);
  const held = thisWeek({ tier: "tracked", domain: "tallyroo.com", weekOf: "2026-10-12", items, changes: { state: "ok", lines: [], more: 0 }, link: LINK });
  assert.match(held.text, /^Since your last check: nothing held a change over your last checks\.$/m);
  const quiet = thisWeek({ tier: "tracked", domain: "tallyroo.com", weekOf: "2026-10-12", items, changes: { state: "quiet" }, link: LINK });
  assert.match(quiet.text, /fewer than three checks finished in the last 7 days/);
  const unread = thisWeek({ tier: "tracked", domain: "tallyroo.com", weekOf: "2026-10-12", items, changes: { state: "unread" }, link: LINK });
  assert.doesNotMatch(unread.text, /Since your last check/, "changes that could not be read are left out, never said as none");
});

test("an empty week is not worth a mail; items or a change line is", () => {
  assert.equal(worthSending({ items: [], changes: { state: "ok", lines: [], more: 0 } }), false);
  assert.equal(worthSending({ items: [], changes: { state: "early" } }), false);
  assert.equal(worthSending({ items: [], changes: { state: "unread" } }), false);
  assert.equal(worthSending({ items: items.slice(0, 1), changes: { state: "unread" } }), true);
  assert.equal(worthSending({ items: [], changes }), true);
});

const plan = (over: Partial<PlanItem>): PlanItem =>
  ({ id: "i", clientId: "c", clusterId: null, kind: "add_schema", severity: "tidy", status: "suggested", title: "t", why: [], grade: "practice", sourceId: null, effort: "minutes", href: null, refTable: null, refId: null, dedupeKey: "k", weekOf: "2026-10-12", newSinceMonday: false, ownerEmail: null, note: null, hiddenUntil: null, createdBy: "system", createdAt: "2026-10-12T03:00:00Z", statusAt: "2026-10-12T03:00:00Z", statusBy: null, startedOn: null, doneOn: null, verified: null, readoutBase: null, ...over }) as PlanItem;

test("the items are this Monday's pins in This week's order, done and dropped left out, each with its first fact", () => {
  const out = thisWeekItems(
    [
      plan({ id: "a", dedupeKey: "a", severity: "tidy", title: "Tidy", why: [{ text: "One fact." }, { text: "Two." }] }),
      plan({ id: "b", dedupeKey: "b", severity: "blocking", title: "Block" }),
      plan({ id: "c", dedupeKey: "c", status: "done", title: "Done" }),
      plan({ id: "d", dedupeKey: "d", weekOf: "2026-10-05", title: "Last week" }),
      plan({ id: "e", dedupeKey: "e", status: "dropped", title: "Dropped" }),
    ],
    "2026-10-14",
  );
  assert.deepEqual(out, [
    { severity: "blocking", title: "Block", why: null },
    { severity: "tidy", title: "Tidy", why: "One fact." },
  ]);
});

test("the changes: Since last check's top three lines, the rest counted with its own count", () => {
  const lines = ["a.", "b.", "c.", "d.", "e."].map((text) => ({ kind: "lost" as const, text, link: null }));
  assert.deepEqual(thisWeekChanges({ state: "ok", days: 7, lines, more: 3 }), { state: "ok", lines: ["a.", "b.", "c."], more: 5 });
  assert.equal(THIS_WEEK_CHANGES, 3);
  assert.deepEqual(thisWeekChanges({ state: "early", days: 1 }), { state: "early" });
  assert.deepEqual(thisWeekChanges(null), { state: "unread" });
});
