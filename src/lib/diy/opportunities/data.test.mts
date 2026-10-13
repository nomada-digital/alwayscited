import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { expandFixture } from "../../tracking/fixture-mode.ts";
import { addDays } from "../../tracking/figures.ts";
import { promptsDb } from "../prompts/fake-prompts-db.mts";

import { KIND_PAGES_AT_ONCE, countLoggedSince, countOpenOpportunities, factsOf, loggedSince, fixtureEntry, fixtureWorld, missingTable, readKeyPages, readKinds, readPageReads, readWorld, type OppFixtureState, type Overlay } from "./data.ts";
import { writePageRead } from "./record.ts";
import { ENGINE_ORDER } from "./refresh.job.ts";
import { EMPTY_ALL_NAME_YOU, EMPTY_NO_CITATIONS, citedEmpty, headerCounts, listed } from "./payload.ts";

/**
 * Opportunities' loader and fixture (13 Oct 2026, DIY P7; spec 10 sections
 * 7.0 item 6 and 7.8, "Fixture states"): the fixture derives what the rules
 * make of its made-up world with the tracking fixture's answers, exactly as
 * the night does, so each state shows the exclusions working: `full` (40 and
 * more rows across lenses and statuses, an unreadable read, the Shopify
 * case, prompts added, two cited pages that are another fixture client's
 * placements and do not appear), `dark` (nothing read, no rival's
 * comparison page), `day0` (no citations: lists and own only), `capped` (10
 * pursued) and `zero` (every cited page names you). The tolerant readers say
 * so on a missing table and never read a failure as zero.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const fx = expandFixture(JSON.parse(readFileSync(join(ROOT, "src/lib/tracking/fixture.json"), "utf8")));
const file = JSON.parse(readFileSync(join(ROOT, "src/lib/diy/fixtures/opportunities.json"), "utf8")) as Record<string, OppFixtureState>;
const t = { today: fx.today, engines: ENGINE_ORDER, answers: fx.data.answers.filter((a) => a.run_date >= addDays(fx.today, -27)), questions: fx.data.questions, clusters: fx.data.clusters, keywords: fx.data.keywords, domain: fx.client.domain };
const world = (state: "full" | "dark" | "day0" | "zero" | "capped") => fixtureWorld(fixtureEntry(file, state), t, "fixture");
const lenses = (w: ReturnType<typeof world>) => new Set(w.rows.map((r) => r.lens));

test("full: 40 and more rows across every tab lens and status, page reads with an unreadable one, the Shopify case, prompts added", () => {
  const w = world("full");
  assert.ok(w.rows.length >= 40, `${w.rows.length} rows`);
  for (const l of ["cited", "lists", "threads", "profiles", "own", "logged"]) assert.ok(lenses(w).has(l as never), l);
  const statuses = new Set(w.rows.map((r) => r.status));
  for (const s of ["new", "pursuing", "pitched", "won", "declined", "dismissed"]) assert.ok(statuses.has(s as never), s);
  assert.ok([...w.reads.values()].some((f) => f.status === "error" && f.http === 403), "a page we could not read");
  assert.ok(fixtureEntry(file, "full").kinds!.some((k) => k.key === "d:shopify.example" && k.domain_type === "platform"));
  assert.ok(w.rows.some((r) => r.domain === "shopify.example"), "a platform's page is listed");
  assert.ok(w.rows.some((r) => r.promptId !== null), "prompts added from pursued pages");
  assert.ok(w.rows.some((r) => r.route === "send_correction"));
  assert.ok(w.rows.some((r) => r.lens === "own" && r.route === "refresh_own"));
});

test("full: the two cited pages that are another fixture client's placements appear nowhere; the client's own placements do", () => {
  const w = world("full");
  const placed = fixtureEntry(file, "full").placed!;
  assert.equal(placed.length, 2);
  const cited = new Set(t.answers.flatMap((a) => a.citations.map((c) => c.url)));
  assert.ok(cited.has(`https://${placed[0]}`), "one is cited in the tracking fixture's own answers");
  for (const k of placed) assert.ok(!w.rows.some((r) => r.urlKey === k), k);
  assert.ok(!JSON.stringify(w.rows).includes(placed[1]!));
  assert.ok(w.rows.some((r) => r.urlKey === "ownerledger.co/guides/switching-accounting-software"), "this client's own placement is unaffected");
});

test("full: competitors' own pages never appear - a vendor, and a rival's 'X vs Y'", () => {
  const w = world("full");
  assert.ok(!w.rows.some((r) => r.domain === "ledgerline.com"));
  assert.ok(!w.rows.some((r) => r.domain === "brightbook.example"));
});

test("dark: nothing read or classified; the rival's comparison page and the unclassified Shopify page are left out; rows still render from citations", () => {
  const w = world("dark");
  assert.equal(w.reads.size, 0);
  assert.ok(!w.rows.some((r) => r.domain === "brightbook.example"), "an unclassified rival's own comparison page");
  assert.ok(!w.rows.some((r) => r.domain === "shopify.example"), "Shopify unclassified fails closed");
  assert.ok(w.rows.filter((r) => r.lens === "cited" && r.status === "new").length >= 10);
  assert.equal(fixtureEntry(file, "dark").canned, null);
});

test("day0: no citations, so only best-of lists on Google and the client's own pages", () => {
  const w = world("day0");
  assert.deepEqual([...lenses(w)].sort(), ["lists", "own"]);
  assert.equal(headerCounts(w.rows).total, 0);
});

test("capped: 10 pages in Pursuing or Pitched, the most at once", () => {
  const w = world("capped");
  assert.equal(w.rows.filter((r) => r.status === "pursuing" || r.status === "pitched").length, 10);
});

test("zero: every cited page names you, so no cited row", () => {
  const w = world("zero");
  assert.ok(!w.rows.some((r) => r.lens === "cited" || r.lens === "threads" || r.lens === "profiles"));
  assert.ok([...w.reads.values()].some((f) => f.namesClient === true));
});

test("the cited tab's empty state on each fixture state: zero names you only because every cited page was read naming you (review of DIY P7, 13 Oct 2026)", () => {
  const zero = world("zero");
  assert.equal(listed(zero.rows, "cited").length, 0);
  assert.equal(zero.cited!.readNamingYou, zero.cited!.pages, "every page the tracking fixture cites has a read that names the client");
  assert.equal(citedEmpty(zero.cited!, zero.rows), EMPTY_ALL_NAME_YOU);
  assert.equal(citedEmpty(world("day0").cited!, world("day0").rows), EMPTY_NO_CITATIONS);
  // The reviewer's case: every new AI-cited page on the full fixture set aside. They leave the client out, so the tab
  // must never say every page names you.
  const full = world("full");
  const state: Record<string, Overlay> = { ...(fixtureEntry(file, "full").state ?? {}) };
  for (const o of full.rows.filter((r) => r.status === "new" && ["cited", "threads", "profiles"].includes(r.lens))) state[`${o.lens}|${o.urlKey}`] = { id: o.id, status: "dismissed", dismiss_reason: "not_relevant" };
  const setAside = fixtureWorld(fixtureEntry(file, "full"), t, "fixture", { state, logged: [] });
  assert.equal(listed(setAside.rows, "cited").length, 0);
  const line = citedEmpty(setAside.cited!, setAside.rows);
  assert.notEqual(line, EMPTY_ALL_NAME_YOU);
  assert.match(line, /under Pursuing/);
});

test("a page lens change on the fixture is matched as the night matches it: a set-aside row is never listed again", () => {
  const full = world("full");
  const o = full.rows.find((r) => r.lens === "cited" && r.status === "new")!;
  // The same page set aside while it was a Google list: tonight it is cited, and it stays set aside, with no new row.
  const state: Record<string, Overlay> = { ...(fixtureEntry(file, "full").state ?? {}), [`lists|${o.urlKey}`]: { id: "opp-set-aside", status: "dismissed", dismiss_reason: "not_relevant" } };
  const w = fixtureWorld(fixtureEntry(file, "full"), t, "fixture", { state, logged: [] });
  const same = w.rows.filter((r) => r.urlKey === o.urlKey);
  assert.deepEqual(same.map((r) => [r.id, r.lens, r.status]), [["opp-set-aside", "lists", "dismissed"]]);
  assert.ok(!listed(w.rows, null).some((r) => r.urlKey === o.urlKey));
});

test("Log a site uses one link check: this month's logged pages are counted, from the table and on the fixture", async () => {
  const rows = world("full").rows;
  assert.equal(loggedSince(rows, "2026-09-01T00:00:00.000Z"), 2, "the fixture's two logged pages, both this month");
  assert.equal(loggedSince(rows, "2026-09-25T00:00:00.000Z"), 1);
  const { db } = promptsDb({ opportunities: [{ id: "a", client_domain_id: "c1", lens: "logged", created_at: "2026-10-02T10:00:00Z" }, { id: "b", client_domain_id: "c1", lens: "logged", created_at: "2026-09-30T10:00:00Z" }, { id: "c", client_domain_id: "c1", lens: "cited", created_at: "2026-10-03T10:00:00Z" }, { id: "d", client_domain_id: "c2", lens: "logged", created_at: "2026-10-03T10:00:00Z" }] });
  assert.equal(await countLoggedSince(db, "c1", "2026-10-01T00:00:00.000Z"), 1);
  const src = readFileSync(join(ROOT, "src/app/api/app/[client]/opportunity/route.ts"), "utf8");
  const log = src.slice(src.indexOf("async function logSite("));
  assert.ok(log.indexOf('room("link_checks"') > 0 && log.indexOf('room("link_checks"') < log.indexOf("runOnDemand("), "the allowance is checked before any read");
  assert.ok(log.indexOf("heldRow(rows, checked.key)") < log.indexOf('room("link_checks"'), "a page already held opens its row and uses nothing");
});

test("a failed read keeps the good facts and records only the try (review of DIY P7, 13 Oct 2026)", async () => {
  const good = { client_domain_id: "c1", url_key: "lists.example/best", url: "https://lists.example/best", read_at: "2026-09-01T03:00:00Z", via: "own", status: "ok", http_status: 200, title: "Best", names_client: false, attempted_at: null };
  const { db } = promptsDb({ page_reads: [{ ...good }] });
  const had = factsOf(good)!;
  const failed = { ...had, readAt: "2026-09-20T03:00:00Z", status: "error" as const, http: 503, title: null, namesClient: null };
  assert.equal(await writePageRead(db, "c1", failed, had), false);
  const back = await readPageReads(db, "c1");
  const f = back.get("lists.example/best")!;
  assert.equal(f.status, "ok");
  assert.equal(f.title, "Best");
  assert.equal(f.readAt, "2026-09-01T03:00:00Z");
  assert.equal(f.attemptedAt, "2026-09-20T03:00:00Z");
});

test("the tolerant readers: key pages absent is an empty list; a failed count is null, never 0", async () => {
  assert.ok(missingTable({ code: "42P01", message: "relation \"key_pages\" does not exist" }));
  assert.ok(missingTable({ code: "PGRST205", message: "Could not find the table 'public.key_pages' in the schema cache" }));
  assert.ok(!missingTable({ message: "timeout" }));
  const absent = promptsDb({});
  absent.failNext("key_pages", "Could not find the table 'public.key_pages' in the schema cache", "PGRST205");
  assert.deepEqual(await readKeyPages(absent.db, "c1"), []);
  const broken = promptsDb({});
  broken.failNext("key_pages", "permission denied");
  await assert.rejects(readKeyPages(broken.db, "c1"), /permission denied/);
  const here = promptsDb({ key_pages: [{ client_domain_id: "c1", url: "https://tallyroo.com/invoicing", cluster_ids: ["k1"], removed_on: null }, { client_domain_id: "c1", url: "https://tallyroo.com/old", cluster_ids: [], removed_on: "2026-10-01" }] });
  assert.deepEqual(await readKeyPages(here.db, "c1"), [{ url: "https://tallyroo.com/invoicing", clusterIds: ["k1"] }]);
  const counted = promptsDb({ opportunities: [{ id: "a", client_domain_id: "c1", status: "new", live: true, cluster_id: "k1", page_type: "best_of" }, { id: "b", client_domain_id: "c1", status: "new", live: false, cluster_id: "k1", page_type: "best_of" }, { id: "c", client_domain_id: "c1", status: "pursuing", live: true, cluster_id: "k1", page_type: "best_of" }] });
  assert.equal(await countOpenOpportunities(counted.db, "c1", { clusterId: "k1", pageTypes: ["best_of"] }), 1);
  const failing = promptsDb({});
  failing.failNext("opportunities", "relation \"opportunities\" does not exist", "42P01");
  assert.equal(await countOpenOpportunities(failing.db, "c1"), null);
});

test("readWorld: other clients' placements subtracted at read time, and a subtraction that cannot be read fails the section", async () => {
  const rows = [
    { id: "a", client_domain_id: "c1", lens: "cited", url: "https://kept.example/x", url_key: "kept.example/x", domain: "kept.example", route: "ask_added", status: "new", evidence: {}, live: true, last_seen: "2026-11-14", history: [] },
    { id: "b", client_domain_id: "c1", lens: "cited", url: "https://placed.example/x", url_key: "placed.example/x", domain: "placed.example", route: "ask_added", status: "pursuing", evidence: {}, live: true, last_seen: "2026-11-14", history: [] },
  ];
  const ok = promptsDb({ opportunities: rows, page_reads: [], placements: [{ id: "p1", client_domain_id: "other", url_key: "placed.example/x" }, { id: "p2", client_domain_id: "c1", url_key: "kept.example/x" }], diy_jobs: [] });
  const w = await readWorld(ok.db, "c1");
  assert.deepEqual(w.rows.map((r) => r.id), ["a"], "another client's placement goes, whatever this client's status on it; this client's own stays");
  assert.equal(w.refreshedTo, "2026-11-14");
  const bad = promptsDb({ opportunities: rows, page_reads: [], diy_jobs: [] });
  bad.failNext("placements", "connection reset");
  await assert.rejects(readWorld(bad.db, "c1"), /connection reset/);
});

test("origins.opportunity.json: P7's opportunity prompt is merged after P2's, and points at a fixture opportunity", async () => {
  // 13 Oct 2026, review of DIY P7: the row is the `capped` state's only. Under `full` it re-labelled P2's q1-5, which
  // moved facts P2's, P4's and P5's own tests record (spec 10 section 7.0 item 1: a later package edits an earlier
  // one's files only where its list says so). `capped` is P7's alone; `full`'s prompts are added by Pursue itself.
  const { readOriginsFiles, fixtureOriginMap } = await import("../prompts/origins.ts");
  const dir = join(ROOT, "src", "lib", "diy", "fixtures");
  const o = fixtureOriginMap(await readOriginsFiles(dir, "capped"), fx.data.questions, []).get("q1-5");
  assert.equal(o?.kind, "opportunity");
  assert.ok(world("capped").rows.some((r) => r.id === o?.ref && r.promptId === "q1-5"), "the chip links to an opportunity that carries the prompt");
  const full = fixtureOriginMap(await readOriginsFiles(dir, "full"), fx.data.questions, []);
  assert.ok(![...full.values()].some((x) => x.kind === "opportunity"), "nothing of P7's under full: P2's chips stand as P2 recorded them");
});

// 13 Oct 2026 (dashboard speed work): readKinds' 200-key pages go out side by side, KIND_PAGES_AT_ONCE at a time, where
// they went one after another; every key is still asked for once, and a page that fails still throws.
test("readKinds: every key asked once across the pages side by side, every cached type returned; a failed page throws", async () => {
  const keys = Array.from({ length: 1301 }, (_, i) => `site${i}.example`);
  const rows = keys.filter((_, i) => i % 3 === 0).map((key) => ({ key, level: "domain", domain_type: "blog", page_type: null, set_by: "rule" }));
  let inFlight = 0;
  let most = 0;
  const asked: string[] = [];
  const db = {
    from: () => {
      let chunk: string[] = [];
      const b = {
        select: () => b,
        in: (_c: string, vs: string[]) => ((chunk = vs), b),
        limit: () => b,
        then: (resolve: (v: unknown) => void) => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          asked.push(...chunk);
          setTimeout(() => {
            inFlight -= 1;
            resolve({ data: rows.filter((r) => chunk.includes(r.key)), error: null });
          }, 5);
        },
      };
      return b;
    },
  } as unknown as Parameters<typeof readKinds>[0];
  const got = await readKinds(db, [...keys, ...keys.slice(0, 10)]);
  assert.equal(got.size, rows.length);
  assert.deepEqual([...asked].sort(), [...keys].sort(), "each key once");
  assert.equal(most, Math.min(KIND_PAGES_AT_ONCE, Math.ceil(keys.length / 200)), "the pages were in flight together");
  const broken = { from: () => ({ select() { return this; }, in() { return this; }, limit() { return this; }, then: (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "statement timeout" } }) }) } as unknown as Parameters<typeof readKinds>[0];
  await assert.rejects(readKinds(broken, keys), /could not read the page types: statement timeout/);
});
