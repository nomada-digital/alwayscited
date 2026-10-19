import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TIER_PLAIN } from "../tier-text.ts";
import {
  CITED_SERVICE,
  type Facts,
  MENTIONED_PLACEMENTS,
  MENTIONED_SERVICE,
  ROW_CTA,
  type UpgradeRow,
  firstPromptDay,
  hiddenCtas,
  hiddenSince,
  hiddenUntil,
  pickPrompt,
  pickRow,
  promptCopy,
  readSurface,
  rowCopy,
  serviceLine,
  triggered,
  triggeredRows,
  upgradeTrigger,
} from "./upgrade-prompts.ts";

/** Every trigger over its threshold, on a tracked client well past its first 14 days. */
const all = (over: Partial<Facts> = {}): Facts => ({
  tier: "tracked",
  mode: "nomada",
  state: "ok",
  startedOn: "2026-08-01",
  today: "2026-09-30",
  hidden: new Set(),
  neverNamed: { prompts: 5, of: 45, answers: 448, hosts: ["thesmallbizstack.com", "softwarecritic.com", "ledgerline.com"] },
  offPageOne: { keywords: 3, of: 9, best: 11, worst: 14 },
  trade: { brand: "Ledgerline", share: 28, theirs: 41, ours: 3, subject: "Tallyroo" },
  atLimit: true,
  outsideCluster: true,
  ...over,
});

test("one prompt per screen, the highest tier gap winning", () => {
  assert.equal(pickPrompt(all()), "everywhere");
  assert.equal(pickPrompt(all({ trade: undefined })), "cited");
  assert.equal(pickPrompt(all({ trade: undefined, offPageOne: undefined })), "mentioned");
  assert.equal(pickPrompt(all({ trade: undefined, offPageOne: undefined, neverNamed: undefined })), "pack");
  // A tie at no gap: the pack over a second cluster.
  assert.equal(pickPrompt(all({ tier: "cited", trade: undefined })), "pack");
  assert.equal(pickPrompt(all({ tier: "cited", trade: undefined, atLimit: false })), "cluster");
});

test("the brief's thresholds", () => {
  assert.deepEqual(triggered(all({ neverNamed: { prompts: 2, of: 45, answers: 448, hosts: [] }, offPageOne: { keywords: 1, of: 9, best: 11, worst: 11 }, trade: undefined, atLimit: false, outsideCluster: false })), []);
  assert.deepEqual(triggered(all({ offPageOne: undefined, trade: undefined, atLimit: false, outsideCluster: false })), ["mentioned"]);
  // 5x and at least 10: 9 against 0 is not enough, 14 against 3 is not 5x, 15 against 3 is.
  const t = (theirs: number, ours: number) => triggered(all({ neverNamed: undefined, offPageOne: undefined, atLimit: false, trade: { brand: "B", share: 1, theirs, ours, subject: "S" } }));
  assert.deepEqual(t(9, 0), []);
  assert.deepEqual(t(14, 3), []);
  assert.deepEqual(t(15, 3), ["everywhere"]);
  // A second cluster is for mentioned and cited only.
  assert.ok(!triggered(all()).includes("cluster"));
  assert.ok(triggered(all({ tier: "mentioned" })).includes("cluster"));
  assert.ok(!triggered(all({ tier: "everywhere" })).includes("cluster"));
});

test("never in the first 14 days", () => {
  assert.equal(firstPromptDay("2026-09-16"), "2026-09-30");
  assert.equal(pickPrompt(all({ startedOn: "2026-09-17" })), null);
  assert.equal(pickPrompt(all({ startedOn: "2026-09-16" })), "everywhere");
});

test("never on an empty, error or partial state", () => {
  for (const state of ["empty", "error", "partial"] as const) assert.equal(pickPrompt(all({ state })), null);
});

test("never for a tier already held", () => {
  assert.ok(!triggered(all({ tier: "mentioned" })).includes("mentioned"));
  assert.ok(!triggered(all({ tier: "cited" })).some((c) => c === "mentioned" || c === "cited"));
  assert.deepEqual(triggered(all({ tier: "everywhere", atLimit: false })), []);
  assert.equal(pickPrompt(all({ tier: "everywhere", atLimit: false })), null);
});

test("off shows none; agency writes no tier name and no tier-page button", () => {
  assert.equal(pickPrompt(all({ mode: "off" })), null);
  const f = all({ mode: "agency" });
  assert.equal(pickPrompt(f), "everywhere");
  for (const cta of ["mentioned", "cited", "everywhere"] as const) {
    const c = promptCopy(cta, f)!;
    assert.equal(c.tier, null);
    assert.equal(c.button, false);
    const words = [c.title, c.lead, c.tail, c.why, c.ask].join(" ");
    for (const name of Object.values(TIER_PLAIN)) assert.ok(!words.includes(name), `${cta} names ${name} in agency mode`);
    assert.ok(!/nomada/i.test(words), `${cta} names nomada in agency mode`);
  }
});

test("hidden stays hidden for 30 days for that member", () => {
  assert.equal(hiddenSince("2026-09-30"), "2026-08-31T00:00:00Z");
  const rows = [
    { cta: "everywhere", action: "hidden", created_at: "2026-08-31T09:00:00Z" },
    { cta: "cited", action: "hidden", created_at: "2026-08-30T23:59:59Z" },
    { cta: "mentioned", action: "shown", created_at: "2026-09-29T09:00:00Z" },
    { cta: "nonsense", action: "hidden", created_at: "2026-09-29T09:00:00Z" },
  ];
  const hidden = hiddenCtas(rows, "2026-09-30");
  assert.deepEqual([...hidden], ["everywhere"]);
  assert.equal(pickPrompt(all({ hidden })), "cited");
});

test("the toast's last hidden day is the last day hiddenCtas still counts the row (DS29)", () => {
  const row = [{ cta: "cited", action: "hidden", created_at: "2026-10-02T23:59:00Z" }];
  assert.equal(hiddenUntil("2026-10-02"), "2026-11-01");
  assert.deepEqual([...hiddenCtas(row, hiddenUntil("2026-10-02"))], ["cited"]);
  assert.deepEqual([...hiddenCtas([{ ...row[0], created_at: "2026-10-02T00:00:00Z" }], "2026-11-02")], []);
});

test("the board's words on its three prompts", () => {
  const f = all();
  const m = promptCopy("mentioned", f)!;
  assert.equal(m.title, "5 prompts never name you");
  assert.equal(`${m.lead}${TIER_PLAIN[m.tier!]}${m.tail}`, `Engines answer them from pages like thesmallbizstack.com and softwarecritic.com. Getting placed on the pages they cite is what alwaysmentioned does, ${MENTIONED_PLACEMENTS} per cluster.`);
  assert.equal(m.why, "Shown because 5 of your 45 prompts named you in none of their 448 answers this period.");
  assert.equal(m.ask, "Ask about these 5");
  const c = promptCopy("cited", f)!;
  assert.equal(c.title, "3 keywords sit just off page 1");
  // 13 Oct 2026, DIY P4: the tail reads "the alwayscited plan" - the plan, not the company (CLAUDE.md; spec 10 section 2.7,
  // U2 "existing copy, with the tail fixed"). It was "is what alwayscited adds to placements."
  assert.equal(`${c.lead}${TIER_PLAIN[c.tier!]}${c.tail}`, "Positions 11 to 14. Link insertions on pages that already rank for them, plus on-site work on your own pages, is what the alwayscited plan adds to placements.");
  assert.equal(c.why, "Shown because 3 of your 9 cluster keywords rank #11 to #20 today.");
  const e = promptCopy("everywhere", f)!;
  assert.equal(e.title, "Ledgerline has 28% of brand mentions");
  assert.equal(`${e.lead}${TIER_PLAIN[e.tier!]}${e.tail}`, "Engines cite news and trade coverage of Ledgerline 41 times this period, and of Tallyroo 3 times. Earned media across every engine is alwayseverywhere.");
  assert.equal(e.ask, "Book a call");
  assert.equal(e.dark, true);
  assert.equal(promptCopy("pack", f), null);
});

test("the placements phrase is pricing.ts's own alwaysmentioned line", () => {
  // Deliberate difference from the board ("3 guest posts a month per
  // cluster"): the count and noun come from the tier's include line.
  const pricing = readFileSync("src/config/pricing.ts", "utf8");
  // "topic" became "keyword cluster" site-wide on 16 Oct 2026 (Danny).
  assert.ok(pricing.includes(`"${MENTIONED_PLACEMENTS} on one keyword cluster"`));
});

// ---- 13 Oct 2026, DIY P4 (spec 10 section 2.7): U1-U8 as rules and words, drawn by the pages that gather their facts.

/** Each DIY row's facts over its threshold, one at a time, on a tracked client past its first 14 days. */
const ROW_FACTS: Record<Exclude<UpgradeRow, "U1" | "U2">, Partial<Facts>> = {
  U3: { leavesOut: { names: ["Brightly", "Ledgerly"], answers: 12, days: 28, status: "pursuing", clusterOpen: 1 } },
  U4: { stalled: { items: 3, since: "2026-09-03" } },
  U5: { reveals: { used: 5, of: 5, more: 47, resetsOn: "2026-10-01" } },
  U6: { fit: { keyword: "invoicing software", fits: true, offPage1: 22, readings: 28 } },
  U7: { atLimit: true, gaining: { keyword: "payroll for sole traders", clusters: 10, packLine: "Extra tracking pack: +$49/mo for +5 clusters (25 prompts, 5 keywords)." } },
  U8: { pursuits: { active: 10, cap: 10 } },
};
const one = (over: Partial<Facts> = {}): Facts => ({ tier: "tracked", mode: "nomada", state: "ok", startedOn: "2026-08-01", today: "2026-09-30", hidden: new Set(), ...over });
const body = (c: { lead: string; tier: string | null; tail: string }) => `${c.lead}${c.tier ? TIER_PLAIN[c.tier as keyof typeof TIER_PLAIN] : ""}${c.tail}`;

test("U1-U8: each row's trigger, and the cta it sells", () => {
  assert.deepEqual(triggeredRows(one({ neverNamed: all().neverNamed })), ["U1"]);
  assert.deepEqual(triggeredRows(one({ offPageOne: all().offPageOne })), ["U2"]);
  for (const [row, facts] of Object.entries(ROW_FACTS)) {
    assert.deepEqual(triggeredRows(one(facts)), [row], row);
    assert.equal(pickRow(one(facts)), row, row);
    assert.equal(pickPrompt(one(facts)), ROW_CTA[row as UpgradeRow], row);
  }
  assert.deepEqual(ROW_CTA, { U1: "mentioned", U2: "cited", U3: "mentioned", U4: "mentioned", U5: "cited", U6: "cited", U7: "pack", U8: "mentioned" });
});

test("U3-U8: under each threshold, nothing", () => {
  const l = ROW_FACTS.U3.leavesOut!;
  assert.deepEqual(triggeredRows(one({ leavesOut: { ...l, names: ["Brightly"] } })), [], "one competitor named");
  assert.deepEqual(triggeredRows(one({ leavesOut: { ...l, status: "new", clusterOpen: 2 } })), [], "not pursued, and only 2 open in the cluster");
  assert.deepEqual(triggeredRows(one({ leavesOut: { ...l, status: "new", clusterOpen: 3 } })), ["U3"], "3 open in its cluster");
  assert.deepEqual(triggeredRows(one({ leavesOut: { ...l, status: "pitched", clusterOpen: 0 } })), ["U3"]);
  assert.deepEqual(triggeredRows(one({ stalled: { items: 2, since: "2026-09-01" } })), []);
  assert.deepEqual(triggeredRows(one({ stalled: { items: 3, since: "2026-09-10" } })), [], "20 days, not 21");
  assert.deepEqual(triggeredRows(one({ stalled: { items: 3, since: "2026-09-09" } })), ["U4"], "21 days");
  assert.deepEqual(triggeredRows(one({ reveals: { used: 4, of: 5, more: 47, resetsOn: "2026-10-01" } })), [], "a reveal left");
  assert.deepEqual(triggeredRows(one({ reveals: { used: 5, of: 5, more: 4, resetsOn: "2026-10-01" } })), [], "fewer than 5 more pages");
  assert.deepEqual(triggeredRows(one({ fit: { keyword: "x", fits: false, offPage1: 28, readings: 28 } })), [], "does not fit");
  assert.deepEqual(triggeredRows(one({ fit: { keyword: "x", fits: true, offPage1: 19, readings: 28 } })), []);
  assert.deepEqual(triggeredRows(one({ gaining: ROW_FACTS.U7.gaining })), [], "a keyword gaining, but a cluster free");
  assert.deepEqual(triggeredRows(one({ pursuits: { active: 9, cap: 10 } })), []);
});

test("U1-U8: the T11 mechanics hold for every row - quiet 14 days, hidden, a tier held, off, dark", () => {
  for (const [row, facts] of Object.entries(ROW_FACTS)) {
    const cta = ROW_CTA[row as UpgradeRow];
    assert.equal(pickRow(one({ ...facts, startedOn: "2026-09-17" })), null, `${row}: first 14 days`);
    assert.equal(pickRow(one({ ...facts, hidden: new Set([cta]) })), null, `${row}: hidden`);
    assert.equal(pickRow(one({ ...facts, mode: "off" })), null, `${row}: off`);
    for (const state of ["empty", "error", "partial", "dark"] as const) assert.equal(pickRow(one({ ...facts, state })), null, `${row}: ${state}`);
    if (cta === "mentioned") assert.equal(pickRow(one({ ...facts, tier: "mentioned" })), null, `${row}: mentioned held`);
    if (cta === "cited") assert.equal(pickRow(one({ ...facts, tier: "cited" })), null, `${row}: cited held`);
    if (cta === "cited") assert.equal(pickRow(one({ ...facts, tier: "mentioned" })), row, `${row}: shown above the tier held`);
  }
  // U8 then U3 on Opportunities: both mentioned, so the order decides.
  assert.equal(pickRow(one({ ...ROW_FACTS.U3, ...ROW_FACTS.U8 })), "U8");
  // The highest tier gap still wins across rows: a cited row over a mentioned one.
  assert.equal(pickRow(one({ ...ROW_FACTS.U8, ...ROW_FACTS.U5 })), "U5");
});

test("U3-U8: the spec's words", () => {
  const copy = (row: UpgradeRow, mode: Facts["mode"] = "nomada") => rowCopy(row, one({ ...ROW_FACTS[row as keyof typeof ROW_FACTS], mode }))!;
  assert.equal(copy("U3").title, "Pages like this one leave you out");
  assert.equal(copy("U3").why, "Shown because this page names Brightly and Ledgerly, not you, and was cited in 12 answers to your prompts in the last 28 days.");
  assert.equal(copy("U4").title, "3 items have been in Doing for 3 weeks");
  assert.equal(copy("U4").why, "Shown because 3 opportunity items have been in Doing since 3 Sep with no change.");
  assert.equal(copy("U5").title, "This month's link targets are used");
  assert.equal(copy("U5").why, "Shown because you revealed this month's 5 link targets. They reset on 1 Oct.");
  assert.equal(copy("U6").title, "'invoicing software' read #11-#20 on 22 of its last 28 readings");
  assert.equal(body(copy("U6")), `Your page matches what Google shows for 'invoicing software'. ${body(serviceLine("cited", false))}`);
  assert.equal(copy("U7").lead, "'payroll for sole traders' is gaining ground and all 10 clusters are in use. Extra tracking pack: +$49/mo for +5 clusters (25 prompts, 5 keywords).");
  assert.equal(copy("U7").button, false, "until the pack is self-serve the ask stands in");
  assert.equal(copy("U7").ask, "Ask us");
  assert.equal(copy("U8").title, "You're working 10 pages at once");
  assert.equal(copy("U8").why, "Shown because 10 pages are in Pursuing or Pitched, the most at once.");
  // promptCopy draws the same row the pick does.
  assert.deepEqual(promptCopy("mentioned", one(ROW_FACTS.U8)), copy("U8"));
  assert.deepEqual(promptCopy("pack", one(ROW_FACTS.U7)), copy("U7"));
  for (const row of Object.keys(ROW_FACTS) as UpgradeRow[]) assert.match(copy(row).why, /^Shown because /, row);
});

test("every U3-U8 body is one of the two service lines, never retyped (agency: the next-step form)", () => {
  const mentioned = `Getting placed in the sources the engines already cite is what alwaysmentioned does, ${MENTIONED_PLACEMENTS} per cluster.`;
  const cited = "Link insertions on pages that already rank, plus on-site work on your own pages, is what the alwayscited plan adds to placements.";
  assert.equal(body(serviceLine("mentioned", false)), mentioned);
  assert.equal(body(serviceLine("cited", false)), cited);
  assert.equal(body(serviceLine("mentioned", true)), "Getting placed in the sources the engines already cite is the next step.");
  assert.equal(body(serviceLine("cited", true)), "Link insertions on pages that already rank, plus on-site work on your own pages, is the next step.");
  const U6 = "Your page matches what Google shows for 'invoicing software'. ";
  for (const mode of ["nomada", "agency"] as const) {
    const lines = [body(serviceLine("mentioned", mode === "agency")), body(serviceLine("cited", mode === "agency"))];
    for (const row of ["U3", "U4", "U5", "U6", "U8"] as const) {
      const c = rowCopy(row, one({ ...ROW_FACTS[row], mode }))!;
      assert.ok(lines.includes(body(c).replace(row === "U6" ? U6 : "", "")), `${row} ${mode}: "${body(c)}" is not a service line`);
    }
  }
  // U2 shares CITED_SERVICE's words, with its own "for them".
  const u2 = promptCopy("cited", all({ trade: undefined }))!;
  assert.ok(u2.lead.includes(`${CITED_SERVICE.rank} for them${CITED_SERVICE.work}${CITED_SERVICE.lead}`));
  assert.equal(u2.tail, CITED_SERVICE.tail);
  assert.ok(MENTIONED_SERVICE.tail.includes(MENTIONED_PLACEMENTS));
});

test("agency mode: no tier name, no tier button, no nomada, no price; off: none at all", () => {
  for (const row of Object.keys(ROW_FACTS) as UpgradeRow[]) {
    const f = one({ ...ROW_FACTS[row as keyof typeof ROW_FACTS], mode: "agency" });
    const c = rowCopy(row, f)!;
    assert.equal(c.tier, null, row);
    assert.equal(c.button, false, row);
    const words = [c.title, c.lead, c.tail, c.why, c.ask].join(" ");
    for (const name of Object.values(TIER_PLAIN)) assert.ok(!words.includes(name), `${row} names ${name} in agency mode`);
    assert.ok(!/nomada/i.test(words), `${row} names nomada in agency mode`);
    assert.ok(!/[$£€]\s?\d/.test(words), `${row} prints a price in agency mode`);
    assert.equal(pickRow({ ...f, mode: "off" }), null);
  }
});

test("no U copy says 'does it for you', 'the whole list', 'outreach' or 'rank for your keywords'", () => {
  const banned = /does it for you|the whole list|outreach|rank for your keywords/i;
  const texts: string[] = [];
  for (const mode of ["nomada", "agency"] as const) {
    for (const row of Object.keys(ROW_FACTS) as UpgradeRow[]) {
      const c = rowCopy(row, one({ ...ROW_FACTS[row as keyof typeof ROW_FACTS], mode }))!;
      texts.push(c.title, body(c), c.why, c.ask);
    }
    for (const cta of ["mentioned", "cited", "everywhere"] as const) {
      const c = promptCopy(cta, all({ mode }))!;
      texts.push(c.title, body(c), c.why, c.ask);
    }
  }
  assert.ok(texts.length >= 70, `${texts.length} strings read`);
  for (const t of texts) assert.doesNotMatch(t, banned, t);
  for (const t of texts) assert.doesNotMatch(t, /\b(caused|drove|because of|thanks to|resulted in|delivered)\b/i, t);
});

test("trigger jsonb: the surface, and id-shaped facts on the recorded keys only", () => {
  assert.deepEqual(upgradeTrigger("opportunity", { route: "ask_added", cluster: "c1" }), { surface: "opportunity", route: "ask_added", cluster: "c1" });
  assert.deepEqual(upgradeTrigger("ai", { row: "U1", items: "5" }), { surface: "ai", row: "U1", items: "5" });
  // A typed word or a key nobody recorded is dropped, never stored.
  assert.deepEqual(upgradeTrigger("plan", { route: "best invoicing app", cluster: "c1", ...({ note: "x" } as object) }), { surface: "plan", cluster: "c1" });
  assert.equal(readSurface("ai"), "ai");
  assert.equal(readSurface("admin"), null);
});

// 19 Oct 2026: "trigger jsonb is written: the hide and ask routes record the surface the prompt carried (review of P4,
// 13 Oct 2026)" is retired. Its subject was the two routes' calls, and /api/app/[client]/hide and /ask were deleted
// with the old /app dashboard's remaining code (commit 78b1023); the prompt half had gone on 18 Oct 2026 (brief 2d).
// Nothing posts a surface now. upgradeTrigger's own rule is held by "trigger jsonb: the surface, and id-shaped facts
// on the recorded keys only" above.
