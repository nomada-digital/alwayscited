import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import type { PlanItem } from "../diy/plan/types.ts";
import { previewSets, thisWeek } from "./lifecycle.ts";
import type { Focus } from "./merge.ts";
import { changeTone, THIS_WEEK_CHANGES, thisWeekChanges, thisWeekItems, weekSubject, worthSending } from "./this-week-mail.ts";

/**
 * The Monday "This week" email's copy, pinned (13 Oct 2026, DIY P9; spec 10
 * section 7.10; redesigned 18 Oct 2026, brief item 2e). Illustrative:
 * Tallyroo, Ledgerly and every site here are made up. Nothing is sent: these
 * render templates only.
 */

const LINK = "https://dashboards.alwayscited.com/tallyroo-com/plan";
const SETTINGS = "https://dashboards.alwayscited.com/tallyroo-com/settings#email";
const items = [
  { severity: "blocking" as const, title: "Let Googlebot crawl /pricing", why: "robots.txt line 'Disallow: /pricing' blocks Googlebot from 1 key page of 8 (checked 17 Oct)." },
  { severity: "closest" as const, title: "Get onto the best-of lists ranking for 'invoicing software'", why: "'invoicing software' read #11 on 18 Oct." },
  { severity: "tidy" as const, title: "Add Organization schema to your homepage", why: null },
];
const changes = { state: "ok" as const, lines: ["Perplexity started naming you for 'simple invoicing for a small agency'.", "'invoice app for contractors' entered page 1: 13th to 8th."], more: 4 };
const focus: Focus = {
  clusterId: "k",
  name: "invoicing app for freelancers",
  keyword: "invoicing app for freelancers",
  pair: "invoicing apps for freelancers",
  target: "tallyroo.com/invoicing",
  positions: [
    { keyword: "invoicing app for freelancers", label: "singular", now: 6, before: 7 },
    { keyword: "invoicing apps for freelancers", label: "plural", now: 9, before: 11 },
  ],
};
const base = { tier: "tracked" as const, domain: "tallyroo.com", weekOf: "2026-10-19", items, changes, link: LINK, settings: SETTINGS };

test("the copy, pinned: with no figures the subject is the week's actions; the items with why they are here, the changes, one button", () => {
  const m = thisWeek(base);
  assert.equal(m.subject, "This week for tallyroo.com: 3 actions");
  assert.ok(
    m.text.includes(
      [
        "Week of 19 Oct 2026 · tallyroo.com",
        "",
        "This week",
        "",
        "What changed",
        "",
        "Change",
        "- Perplexity started naming you for 'simple invoicing for a small agency' [New]",
        "- 'invoice app for contractors' entered page 1: 13th to 8th [New]",
        "",
        "4 more changes are on your dashboard.",
        "",
        "Your actions this week",
        "",
        "Action / Why it's here",
        "- Let Googlebot crawl /pricing [Blocking]",
        "  robots.txt line 'Disallow: /pricing' blocks Googlebot from 1 key page of 8 (checked 17 Oct).",
        "- Get onto the best-of lists ranking for 'invoicing software' [Closest win]",
        "  'invoicing software' read #11 on 18 Oct.",
        "- Add Organization schema to your homepage [Tidy-up]",
        "",
        `Open this week: ${LINK}`,
      ].join("\n"),
    ),
    m.text,
  );
  assert.match(m.text, /You're getting this because you get the Monday summary for tallyroo\.com\. Change it in Email settings\./);
  assert.ok(m.text.includes(`Email settings: ${SETTINGS}`));
  assert.ok(m.text.includes(COMPANY_LINE) && m.text.includes(CONTACT_EMAIL));
  assert.equal(m.html.match(/<td bgcolor=/g)?.length, 1, "one button");
  assert.match(m.html, /Open this week &rarr;/);
  assert.equal(m.headers, undefined, "no List-Unsubscribe without a signed link");
});

test("the subject and headline come from the real figures; a down week says so plainly", () => {
  const up = thisWeek({ ...base, week: { readings: 7, pct: 28, before: 22 }, focus });
  assert.equal(up.subject, "This week: named in 28% of answers, up 6 pts · #7 → #6");
  assert.match(up.text, /^A better week\. Here's what moved\.$/m);
  assert.match(up.text, /^28% of answers name you \(\+6 pts on last week\)$/m);
  // Singular and plural apart, never averaged with each other or with the AI figure.
  assert.match(up.text, /^#6 Google, singular \(up 1 from #7\)$/m);
  assert.match(up.text, /^#9 Google, plural \(up 2 from #11\)$/m);
  assert.match(up.text, /never averaged into one number/);
  assert.match(up.text, /^invoicing app for freelancers \+ invoicing apps for freelancers\n-> tallyroo\.com\/invoicing$/m);

  const down = thisWeek({ ...base, week: { readings: 7, pct: 19, before: 25 }, focus: { ...focus, positions: [{ ...focus.positions[0]!, now: 9, before: 6 }] } });
  assert.equal(down.subject, "A harder week. Here's what moved: named in 19%, down 6 pts · #6 → #9");
  assert.match(down.text, /^A harder week\. Here's what moved\.$/m);
  assert.doesNotMatch(down.subject + down.text, /better week|steady week/);

  // The same share and the lead keyword lower on Google: still a harder week, said so.
  const slip = thisWeek({ ...base, week: { readings: 7, pct: 25, before: 25 }, focus: { ...focus, positions: [{ ...focus.positions[0]!, now: 8, before: 5 }] } });
  assert.match(slip.subject, /^A harder week\. Here's what moved: named in 25%, no change · #5 → #8$/);

  const flat = thisWeek({ ...base, week: { readings: 7, pct: 30, before: 30 } });
  assert.equal(flat.subject, "This week: named in 30% of answers, no change");
  assert.match(flat.text, /^A steady week\. Here's what moved\.$/m);
});

test("blocks with no data are hidden, never shown as 0 or a placeholder", () => {
  const none = thisWeek(base);
  assert.doesNotMatch(none.text, /name you|Google, |The work this week|-> /, "no figures, no keyword head, no work table");
  const noBefore = thisWeek({ ...base, week: { readings: 7, pct: 28, before: null } });
  assert.match(noBefore.text, /^28% of answers name you$/m, "no week-old figure, no change line");
  assert.doesNotMatch(noBefore.subject, /pts|no change/);
  const noPct = thisWeek({ ...base, week: { readings: 7, pct: null, before: null } });
  assert.doesNotMatch(noPct.text, /%/);
  assert.equal(noPct.subject, "This week for tallyroo.com: 3 actions");
  assert.match(noPct.text, /^This week$/m, "no figure, no better or harder week");
});

test("the paid-tier work table: placements and insertions against the plan, hidden on alwaystracked", () => {
  const sets = previewSets({ us: 129, uk: 99 }).this_week;
  const paid = sets.find((p) => /paid tier/.test(p.label))!.mail;
  assert.match(paid.text, /^The work this week$/m);
  assert.match(paid.text, /^Month to date: 2 of 3 placements live, 0 of 2\+ insertions, 1 on-site change live\.$/m);
  assert.match(paid.text, /- solodesk\.io: placement \[Live\]\n {2}anchor: invoicing app for freelancers/);
  const tracked = sets.find((p) => /alwaystracked/.test(p.label))!.mail;
  assert.doesNotMatch(tracked.text + tracked.html, /The work this week|Month to date/);
});

test("the unsubscribe: a footer link and the List-Unsubscribe headers, for this recipient", () => {
  const url = "https://dashboards.alwayscited.com/api/dash/unsubscribe?t=abc.def";
  const m = thisWeek({ ...base, unsubscribe: url });
  assert.deepEqual(m.headers, { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  assert.ok(m.text.includes(`Unsubscribe: ${url}`));
  assert.ok(m.html.includes(`href="${url}"`));
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
  const none = thisWeek({ ...base, weekOf: "2026-10-12", items: [] });
  assert.equal(none.subject, "This week for tallyroo.com");
  assert.match(none.text, /^Nothing is pinned for the week of 12 Oct for tallyroo\.com\. New actions arrive as your checks find them\.$/m);
  const early = thisWeek({ ...base, changes: { state: "early" } });
  assert.match(early.text, /^Changes start from your second check\.$/m);
  const held = thisWeek({ ...base, changes: { state: "ok", lines: [], more: 0 } });
  assert.match(held.text, /^Nothing held a change over your last checks\.$/m);
  const quiet = thisWeek({ ...base, changes: { state: "quiet" } });
  assert.match(quiet.text, /fewer than three checks finished in the last 7 days/i);
  const unread = thisWeek({ ...base, changes: { state: "unread" } });
  assert.doesNotMatch(unread.text, /What changed/, "changes that could not be read are left out, never said as none");
});

test("weekSubject and changeTone on their own", () => {
  assert.equal(weekSubject({ domain: "a.com", items: [], week: null }, null, null), "This week for a.com");
  assert.equal(weekSubject({ domain: "a.com", items: [], week: { readings: 7, pct: null, before: null } }, "up", { now: 3, before: 5 }), "This week: Google · #5 → #3");
  assert.equal(weekSubject({ domain: "a.com", items: [], week: { readings: 7, pct: null, before: null } }, "down", { now: 5, before: 3 }), "A harder week. Here's what moved: Google · #3 → #5");
  assert.deepEqual(changeTone("ChatGPT stopped naming you for 'x'"), { label: "Lost", tone: "bad" });
  assert.deepEqual(changeTone("Gemini started naming you for 'x'"), { label: "New", tone: "good" });
  assert.deepEqual(changeTone("'x' moved 13th to 8th"), { label: "Moved", tone: "quiet" });
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
