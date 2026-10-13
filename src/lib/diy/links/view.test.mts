import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { pickRow, rowCopy, serviceLine } from "../../tracking/upgrade-prompts.ts";
import type { DiyFixtureState } from "../core/fixture.ts";

import { fixtureLinksWorld, linksChecksUsedFixture, linksFixture } from "./data.ts";
import type { Opportunity } from "../opportunities/types.ts";
import { linksToast, readDone, readWhy } from "./toast.ts";
import { type LinksPage, type WorldPart, linksPage, revealFacts, stateOf } from "./view.ts";

/**
 * What the Links page draws, on every fixture state (13 Oct 2026, DIY P10;
 * spec 10 sections 4.8 and 7.11): `full` (a summary, 13 weeks, a gap of 72
 * rows, 28 targets with 5 revealed, 6 mentions, and two rows on another
 * client's placements that must appear nowhere), `dark`, `nolinks`, `capped`,
 * `fewcompetitors`, `day0` and `zero`. The fixture file is read as the
 * server reads it; the page model is pure.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const TODAY = "2026-09-29";
const NOW = Date.parse(`${TODAY}T12:00:00Z`);
const CLIENT = { domain: "tallyroo.com", trial: false, market: "US" };

function pageFor(state: DiyFixtureState, client = CLIENT): { page: LinksPage; world: ReturnType<typeof fixtureLinksWorld> } {
  const env = { TRACKING_FIXTURE: "1", VERCEL_ENV: "development", DIY_FIXTURE_STATE: state };
  const fx = linksFixture(env, ROOT);
  const world = fixtureLinksWorld(fx, { revealed: fx.revealed, checks: fx.checks }, { clientId: "fixture", today: TODAY, enabled: state !== "dark" });
  return { page: linksPage(world, { client, now: NOW, today: TODAY }), world };
}

const PLACED = /softwarecritic\.com|accountsweekly\.example/;

test("full: every section, read and labelled; Nomada's placements nowhere - not in a row, a count or the payload", () => {
  const { page, world } = pageFor("full");
  assert.equal(page.state, "ready");
  assert.ok(world.gap!.value.rows.some((r) => PLACED.test(r.domain)), "the fixture does carry the two placement rows, so this test is not vacuous");
  assert.doesNotMatch(JSON.stringify(page), PLACED, "the page model names no placement anywhere");
  assert.deepEqual(page.profile, { readOn: "2026-09-24", notIndexed: false, rank: 212, backlinks: 1840, referringDomains: 312, follow: { followed: 86, notFollowed: 14, of: 1840 } });
  assert.deepEqual(page.errors, [], "every read came back");
  assert.equal(page.weeks!.bars.length, 13);
  assert.equal(page.moved!.lost.length, 2, "the lost row on a placed domain is gone");
  assert.equal(page.gap!.rows.length, 25);
  assert.deepEqual([page.gap!.more, page.gap!.hedge, page.gap!.capped], [47, "exact", false], "72 after the subtraction, 25 shown, every row read");
  assert.equal(page.gap!.rows[0]!.linksTo, 3, "links to 3 first");
  assert.equal(page.gap!.rows.filter((r) => r.pursued).length, 1, "the seeded pursuit is marked, not offered again");
  assert.deepEqual([page.targets!.earlier.length, page.targets!.thisMonth.length, page.targets!.more, page.targets!.hedge, page.targets!.unrevealedRead, page.targets!.left, page.targets!.used], [5, 0, 23, "exact", 23, 5, 0], "28 after the subtraction, 5 revealed last month and kept");
  assert.equal(page.mentions!.rows.length, 6, "the placed mention is gone");
  assert.equal(page.compare!.rows.length, 4);
  assert.match(page.compare!.line, /the vendor sites holding the most page-1 places/);
  assert.equal(page.wins.length, 2);
  assert.equal(page.checks.length, 1);
});

test("no sponsored, attributes or spam key or word reaches the page model, on any state", () => {
  for (const s of ["full", "dark", "nolinks", "capped", "fewcompetitors", "day0", "zero"] as DiyFixtureState[]) {
    const json = JSON.stringify(pageFor(s).page);
    assert.doesNotMatch(json, /sponsored|"attributes"|spam/i, s);
    assert.doesNotMatch(json, /\$\s?\d|£|€/, `${s}: no price`);
  }
});

test("dark: sections 1-5 are hidden; the pursued wins and the checks still show", () => {
  const { page } = pageFor("dark");
  assert.equal(page.state, "dark");
  assert.deepEqual([page.profile, page.weeks, page.moved, page.compare, page.gap, page.targets, page.mentions], [null, null, null, null, null, null, null]);
  assert.equal(page.wins.length, 2);
  assert.equal(page.checks.length, 1);
});

test("nolinks: the latest paid Backlinks call failed with 40204, so the profile is not available and nothing paid shows", () => {
  const { page, world } = pageFor("nolinks");
  assert.equal(world.access.state, "inactive");
  assert.equal(world.access.code, 40204);
  assert.equal(page.state, "inactive");
  assert.equal(page.gap, null);
  assert.equal(page.wins.length, 2, "pursued link wins still work");
});

test("day0: not read yet, with the first read's date only because a weekly job is queued; zero: not in the index", () => {
  const { page } = pageFor("day0");
  assert.equal(page.state, "not_read");
  assert.equal(page.firstRead, "2026-09-30");
  const zero = pageFor("zero").page;
  assert.equal(zero.profile!.notIndexed, true);
  assert.equal(stateOf({ enabled: true, access: { state: "not_read", at: null, code: null }, summary: null }), "not_read");
  assert.equal(stateOf({ enabled: true, access: { state: "failed", at: "x", code: 50000 }, summary: null }), "ready", "a failed read keeps what was read before");
});

test("fewcompetitors: no gap or targets, and the compare line gives each domain its own basis", () => {
  const { page } = pageFor("fewcompetitors");
  assert.equal(page.few, true);
  assert.equal(page.gap, null);
  assert.equal(page.targets, null);
  assert.equal(page.compare!.line, "Compared with ledgerline.com (page-1 places for your keywords: 14) and sumly.example (shares 212 keywords with you, DataForSEO estimate). Derived 10 Sep.");
  assert.equal(page.compare!.rows.length, 3);
});

test("capped: this month's 5 are revealed, so U5 fires - and its body is the cited service line, its count after the subtraction", () => {
  const { page } = pageFor("capped");
  // DataForSEO counted more than was read (412 pages, 1,937 sites): the counts are its estimate, worded so; U5 counts only pages read.
  assert.deepEqual([page.targets!.thisMonth.length, page.targets!.left, page.targets!.unrevealedRead, page.targets!.more, page.targets!.hedge], [5, 0, 18, 400, "about"]);
  assert.deepEqual([page.gap!.more, page.gap!.hedge, page.gap!.read, page.gap!.capped], [1900, "about", 74, true]);
  const facts = { tier: "tracked" as const, mode: "nomada" as const, state: "ok" as const, startedOn: "2026-06-10", today: TODAY, hidden: new Set<never>(), reveals: revealFacts(page.targets) };
  assert.deepEqual(facts.reveals, { used: 5, of: 5, more: 18, resetsOn: "2026-10-01" });
  assert.equal(pickRow(facts), "U5");
  const copy = rowCopy("U5", facts)!;
  const line = serviceLine("cited", false);
  assert.deepEqual({ lead: copy.lead, tier: copy.tier, tail: copy.tail }, line);
  assert.equal(copy.why, "Shown because you revealed this month's 5 link targets. They reset on 1 Oct.");
  assert.doesNotMatch(`${copy.title} ${copy.lead} ${copy.tail} ${copy.why}`, /does it for you|the whole list|outreach|rank for your keywords|this site/i);
  const full = pageFor("full").page;
  assert.equal(pickRow({ ...facts, reveals: revealFacts(full.targets) }), null, "no U5 while reveals remain");
  assert.equal(pickRow({ ...facts, reveals: { used: 5, of: 5, more: 4, resetsOn: "2026-10-01" } }), null, "no U5 with fewer than 5 more pages counted");
});

test("the trial: 10 gap rows, 2 targets a month", () => {
  const { page } = pageFor("full", { ...CLIENT, trial: true });
  assert.equal(page.gap!.rows.length, 10);
  assert.deepEqual([page.gap!.more, page.gap!.hedge], [62, "exact"]);
  assert.equal(page.targets!.limit, 2);
});

test("the toast's words are fixed: a code outside the list says nothing, and nothing is echoed", () => {
  const p = { cap: 10, resets: "1 Oct", revealLine: "You've used this month's 5 link targets. They reset on 1 Oct.", checkLine: null };
  assert.equal(linksToast("revealed", null, p)!.text, "Revealed. These pages stay on your list.");
  assert.equal(linksToast("refused", "reveal_cap", p)!.text, p.revealLine);
  assert.equal(linksToast("refused", "cap", p)!.text, "You're working 10 pages at once. Mark one won, declined or not for us to pursue another.");
  assert.equal(linksToast("refused", "running", p)!.text, "Your daily check is running. Try again in a few minutes.");
  assert.equal(linksToast("refused", "<script>", p)!.text, "That didn't save. Try again in a moment.");
  assert.equal(linksToast("<b>hi</b>", null, p), null);
  assert.equal(readDone("checked"), "checked");
  assert.equal(readWhy("nope"), null);
});

test("link checks: one count - the ledger's paid checks and verifications, and the sites logged; a check our own fetch answered uses none", () => {
  const since = "2026-09-01T04:00:00.000Z";
  const logged = (id: string, at: string) => ({ id, lens: "logged", createdAt: at }) as Opportunity;
  const ledger = [{ action: "link_check", status: "ok" }, { action: "verify", status: "partial" }, { action: "verify", status: "failed" }, { action: "page_check", status: "ok" }, { action: "log", status: "ok" }];
  assert.equal(linksChecksUsedFixture(ledger, [logged("a", "2026-09-10T00:00:00.000Z"), logged("b", "2026-08-30T00:00:00.000Z")], since), 3, "2 from the ledger, 1 site logged this month; a logged site's own paid read is not counted twice");
});

/** The full world with some reads failed. */
function failedWorld(...parts: WorldPart[]) {
  const env = { TRACKING_FIXTURE: "1", VERCEL_ENV: "development", DIY_FIXTURE_STATE: "full" };
  const fx = linksFixture(env, ROOT);
  return fixtureLinksWorld(fx, { revealed: fx.revealed, checks: fx.checks }, { clientId: "fixture", today: TODAY, enabled: true, unread: new Set(parts) });
}

test("each section stands on its own read: one that fails says so in its own card, and the rest - Check a link's list among them - still draw", () => {
  const summary = linksPage(failedWorld("summary"), { client: CLIENT, now: NOW, today: TODAY });
  assert.equal(summary.state, "ready", "a failed summary is not 'not read yet'");
  assert.deepEqual(summary.errors, ["profile"]);
  assert.equal(summary.profile, null);
  assert.ok(summary.gap && summary.targets && summary.mentions, "the other sections draw");
  // The placements: no list is drawn without them to subtract - but the profile, the weeks and the checks are.
  const placed = linksPage(failedWorld("placed"), { client: CLIENT, now: NOW, today: TODAY });
  assert.deepEqual(placed.errors, ["moved", "compare", "gap", "targets", "mentions", "wins"]);
  assert.deepEqual([placed.gap, placed.targets, placed.mentions, placed.moved, placed.compare, placed.wins], [null, null, null, null, null, []]);
  assert.equal(placed.few, false, "unknown, not fewer than 3");
  assert.ok(placed.profile && placed.weeks);
  assert.equal(placed.checks.length, 1);
  // The new tables not there yet (a deploy before its migration): each Backlinks section says so; the wins and the checks' form don't need them.
  const tables = linksPage(failedWorld("summary", "new_lost", "timeseries", "bulk", "domain_gap", "page_gap", "mentions", "set", "checks"), { client: CLIENT, now: NOW, today: TODAY });
  assert.deepEqual(tables.errors, ["profile", "weeks", "moved", "compare", "gap", "targets", "mentions", "checks"]);
  assert.equal(tables.wins.length, 2, "the pursued wins still draw");
  // Whether DIY is on, or whether access is active, unknown: nothing paid is drawn, and the page says it could not read.
  for (const part of ["enabled", "access"] as const) {
    const unknown = linksPage(failedWorld(part), { client: CLIENT, now: NOW, today: TODAY });
    assert.equal(unknown.state, "error", part);
    assert.equal(unknown.gap, null);
    assert.equal(unknown.wins.length, 2);
  }
});

test("reveals count against the month from the table, before any subtraction: a reveal whose domain later became a placement still uses one", () => {
  const env = { TRACKING_FIXTURE: "1", VERCEL_ENV: "development", DIY_FIXTURE_STATE: "capped" };
  const fx = linksFixture(env, ROOT);
  const world = fixtureLinksWorld(fx, { revealed: fx.revealed, checks: fx.checks }, { clientId: "fixture", today: TODAY, enabled: true });
  assert.equal(world.revealsThisMonth, 5);
  const first = world.linkRows.find((o) => o.revealedAt && o.revealedAt >= "2026-09-01")!;
  const later = { ...world, placed: { domains: new Set([...world.placed.domains, first.domain]), keys: world.placed.keys } };
  const t = linksPage(later, { client: CLIENT, now: NOW, today: TODAY }).targets!;
  assert.equal(t.thisMonth.length, 4, "the placed page is no longer drawn");
  assert.deepEqual([t.used, t.left], [5, 0], "but the month's 5 stay used, as Settings counts them");
  assert.doesNotMatch(JSON.stringify(t), new RegExp(first.domain.replace(/\./g, "\\.")));
});
