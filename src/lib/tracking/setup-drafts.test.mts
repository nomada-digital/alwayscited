import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { draftPrompts, refuseDrafts } from "./add-cluster.ts";
import { ADMIN_LIMITS, trackingDay } from "./decide.ts";
import { addDays } from "./figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { FIXTURE_CHECK_VOLUME, fixtureCheck, fixtureFillDrafts, fixtureRekey } from "./fixture-writes.ts";
import { ANGLES } from "./limits.ts";
import { fillDrafts } from "./new-cluster.ts";
import { KEYWORD_FIXED, refuseRekey } from "./rekey.ts";
import { checkOn, firstAsked, setupChecks } from "./setup-landing.ts";
import { DRAFTS_RESET, draftAt, draftField, draftsFor, draftsLine, draftsReturn, readDrafts } from "./setup-drafts.ts";
import { PROMPT_MAX, PROMPT_TRACKED, PROMPT_TWIN, promptKey, refuseDraftsAt, refuseSlotText } from "./prompt-text.ts";
import { SLOT_WHY, slotWhyOf } from "./slot.ts";

/**
 * ON-1 (9 Oct 2026, launch blocker LB8): a trial bought with no scan gets a
 * "Needs a keyword" cluster with no prompts, and the runner skips a client
 * with no live prompt. The setup card now drafts five prompts from the
 * keyword, and Save writes them through the free slot's write. These hold the
 * card's rules, the route's reading of the form and its way back, the write's
 * refusals and rows, and the keyword a keywordless cluster can now be given.
 */

const KW = "invoicing app for freelancers";

test("only a cluster with a keyword and no prompt is offered drafts, and they are draftPrompts' five", () => {
  assert.deepEqual(draftsFor({ keyword: KW, prompts: [] }), draftPrompts(KW));
  assert.equal(draftsFor({ keyword: KW, prompts: [{ id: "q1" }] }), null, "a cluster with prompts keeps them");
  assert.equal(draftsFor({ keyword: null, prompts: [] }), null, "no keyword, nothing to draft from");
  assert.equal(draftPrompts(KW).length, ANGLES.length);
  assert.equal(refuseDrafts(draftPrompts(KW)), null, "the drafts pass their own rule as drafted");
});

test("the posted drafts are read as five, a missing one as empty, an over-long one still refused", () => {
  const form = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  assert.equal(readDrafts(form({ text: "Which app is best for a sole trader?" })), null, "the free slot's one text is not drafts");
  const five = Object.fromEntries(draftPrompts(KW).map((t, i) => [draftField(i), t]));
  assert.deepEqual(readDrafts(form(five)), draftPrompts(KW));
  const four = readDrafts(form({ ...five, [draftField(4)]: undefined as unknown as string }))!;
  assert.equal(four[4], "");
  assert.ok(refuseDrafts(four), "a missing draft is refused by the drafts' rule");
  const long = readDrafts(form({ ...five, [draftField(2)]: "x".repeat(ADMIN_LIMITS.question * 3) }))!;
  assert.equal(long[2]!.length, ADMIN_LIMITS.question + 1);
  assert.ok(refuseDrafts(long), "cut one past the limit, so it is refused rather than trimmed into a pass");
});

test("the way back to the setup card, and the line it draws from fixed words only", () => {
  assert.equal(draftsReturn("acme", "c1", true), "/app/acme/setup?card=c1&drafts=saved#card-c1");
  assert.equal(draftsReturn("acme", "c1", false, "duplicate"), "/app/acme/setup?card=c1&drafts=refused&why=duplicate", "a refusal keeps no fragment, so the field can take focus");
  assert.equal(draftsReturn("acme", "c1", false), "/app/acme/setup?card=c1&drafts=refused");
  // ON-1 review (9 Oct 2026): the refused field rides back as its index, never its text.
  assert.equal(draftsReturn("acme", "c1", false, "twin", 3), "/app/acme/setup?card=c1&drafts=refused&why=twin&at=3");
  assert.equal(draftsReturn("acme", "c1", false, "twin", 7), "/app/acme/setup?card=c1&drafts=refused&why=twin", "only one of the five");
  assert.equal(draftsReturn("acme", "c1", true, null, 2), "/app/acme/setup?card=c1&drafts=saved#card-c1");
  assert.deepEqual(["0", "4", "5", "-1", "1.5", "01", "x", null].map((v) => draftAt(v)), [0, 4, null, null, null, null, null, null]);
  assert.deepEqual(draftsLine("saved", null, "tomorrow at 06:00 UK time"), { ok: true, text: "Saved. They are first asked tomorrow at 06:00 UK time." });
  // A refusal says the fields came back as drafted: the member's typing is not in the URL.
  assert.deepEqual(draftsLine("refused", "duplicate", "x"), { ok: false, text: `${SLOT_WHY.duplicate} ${DRAFTS_RESET}` });
  assert.deepEqual(draftsLine("refused", "twin", "x"), { ok: false, text: `${PROMPT_TWIN} ${DRAFTS_RESET}` });
  assert.equal(draftsLine("refused", "<script>", "x")!.text, `Those prompts did not save. ${DRAFTS_RESET}`, "an unknown code is never echoed");
  // "full" in the card's real count, not "its 5" when it holds two.
  assert.deepEqual(draftsLine("refused", "full", "x", 2), { ok: false, text: "That cluster already has 2 live prompts, so 5 more would pass 5. Nothing was saved." });
  assert.deepEqual(draftsLine("refused", "full", "x", 1)!.text, "That cluster already has 1 live prompt, so 5 more would pass 5. Nothing was saved.");
  assert.equal(draftsLine("refused", "full", "x", 5)!.text, SLOT_WHY.full);
  assert.equal(draftsLine(null, null, "x"), null);
  assert.equal(draftsLine("anything", null, "x"), null);
});

// ---- the write ----

const untouchable = new Proxy({}, { get: () => { throw new Error("the database was touched"); } }) as unknown as SupabaseClient;
const base = { clientId: "c", clusterId: "k", prompts: draftPrompts(KW), today: "2026-10-09", by: "owner@example.com", role: "owner" };

test("a viewer, a twin and a short draft are refused before any read or write, naming the field", async () => {
  assert.match(((await fillDrafts(untouchable, { ...base, role: "viewer" })) as { message: string }).message, /owners and editors/i);
  // ON-1 review (9 Oct 2026): two the same in the batch is "twin", not "already tracked", and says which field.
  const twin = (await fillDrafts(untouchable, { ...base, prompts: [...base.prompts.slice(0, 4), `  ${base.prompts[0]!.toUpperCase()} `] })) as { message: string; at?: number };
  assert.deepEqual([slotWhyOf(twin.message), twin.at], ["twin", 4]);
  const short = (await fillDrafts(untouchable, { ...base, prompts: [base.prompts[0]!, "short", ...base.prompts.slice(2)] })) as { message: string; at?: number };
  assert.deepEqual([slotWhyOf(short.message), short.at], ["length", 1]);
  assert.equal((await fillDrafts(untouchable, { ...base, prompts: base.prompts.slice(0, 4) })).ok, false, "five, not four");
});

/** Just the calls fillDrafts makes: the cluster, its live prompts, the room (insertPrompts) and the insert. */
function stand(p: { stopped: string | null; live: string[]; clientLive: number; insertError?: { code: string; message: string } }) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      let head = false;
      let rows: Record<string, unknown>[] | null = null;
      const b = {
        select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
        eq: () => b,
        is: () => b,
        single: () => b,
        maybeSingle: () => b,
        insert: (r: Record<string, unknown>[]) => ((rows = r), inserted.push(...r), b),
        then(ok: (v: unknown) => unknown) {
          if (rows && p.insertError) return Promise.resolve(ok({ data: null, error: p.insertError }));
          if (rows) return Promise.resolve(ok({ data: rows.map((_, i) => ({ id: `new-${i}` })), error: null }));
          if (table === "tracked_clusters") return Promise.resolve(ok({ data: { stopped_on: p.stopped }, error: null }));
          if (table === "client_domains") return Promise.resolve(ok({ data: { cluster_limit: 10 }, error: null }));
          if (head) return Promise.resolve(ok({ count: table === "tracked_questions" ? p.clientLive : 0, error: null }));
          return Promise.resolve(ok({ data: p.live.map((text) => ({ text })), error: null }));
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, inserted };
}

test("five drafts are written as the free slot writes a prompt: one per angle, from tomorrow, the member's own", async () => {
  const { db, inserted } = stand({ stopped: null, live: [], clientLive: 0 });
  const r = await fillDrafts(db, base);
  assert.deepEqual(r, { ok: true, ids: ["new-0", "new-1", "new-2", "new-3", "new-4"] });
  assert.deepEqual(
    inserted.map((q) => [q.text, q.angle, q.added_on, q.source, q.added_by, q.cluster_id]),
    draftPrompts(KW).map((t, i) => [t, ANGLES[i], addDays(base.today, 1), "client", "owner@example.com", "k"]),
  );
});

/**
 * ON-1 review (9 Oct 2026): the reads are no lock. Two saves at once both pass them; the database's unique index
 * on a cluster's live texts (20261009040000) refuses the second insert - one statement, so none of its five - and
 * insertPrompts reads that 23505 as the duplicate refusal, never as a failed write.
 */
test("a second save that races the first is the duplicate refusal, and writes none of its five", async () => {
  const raced = stand({ stopped: null, live: [], clientLive: 0, insertError: { code: "23505", message: 'duplicate key value violates unique constraint "tracked_questions_cluster_live_text_uniq"' } });
  const r = await fillDrafts(raced.db, base);
  assert.equal(r.ok, false);
  assert.equal((r as { message: string }).message, PROMPT_TRACKED);
  assert.equal(slotWhyOf((r as { message: string }).message), "duplicate");
  const other = stand({ stopped: null, live: [], clientLive: 0, insertError: { code: "57014", message: "statement timeout" } });
  assert.match(((await fillDrafts(other.db, base)) as { message: string }).message, /^Could not add the prompts: statement timeout$/, "any other failure keeps its own words");
});

test("the migration holds one live prompt per text in a cluster, and the app's key is at least as strict", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261009040000_live_prompt_unique.sql", import.meta.url), "utf8");
  assert.match(sql, /create unique index if not exists tracked_questions_cluster_live_text_uniq\s+on tracked_questions \(cluster_id, lower\(btrim\(text\)\)\)\s+where stopped_on is null;/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(drop|truncate|delete|rename|alter)\b/i, "additive only");
  // What lower(btrim(text)) makes one, promptKey makes one: case, the spaces btrim takes, and the letters Postgres lowers further.
  const pairs = [
    ["Which app is best?", "  which APP is best?  "],
    ["İstanbul invoicing apps", "istanbul invoicing apps"],
    ["ΛΟΓΙΣΤΙΚΟΣ ΟΔΟΣ", "λογιστικοσ οδοσ"],
  ];
  for (const [x, y] of pairs) assert.equal(promptKey(x!), promptKey(y!), `${x} / ${y}`);
  assert.equal(refuseSlotText("  which APP is best?  ", ["Which app is best?"]), PROMPT_TRACKED);
  assert.notEqual(promptKey("Which app is best?"), promptKey("Which apps are best?"));
});

test("a stopped cluster, or one that already has live prompts, takes none of them", async () => {
  const stopped = stand({ stopped: "2026-10-08", live: [], clientLive: 0 });
  assert.match(((await fillDrafts(stopped.db, base)) as { message: string }).message, /is stopped/);
  assert.equal(stopped.inserted.length, 0);
  // The room is read per cluster (liveCount on cluster_id) - two live, five more would pass five.
  const full = stand({ stopped: null, live: ["Which app is best for a sole trader?", "Who makes the simplest invoicing app?"], clientLive: 2 });
  const r = await fillDrafts(full.db, base);
  assert.equal(r.ok, false);
  assert.equal(slotWhyOf((r as { message: string }).message), "full");
  assert.equal(full.inserted.length, 0);
});

// ---- the keyword a keywordless cluster is given, then its drafts, on the fixture ----

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));

test("a cluster that never had a keyword may be given its first at any time; a keyword it has stays fixed", () => {
  const today = "2026-10-09";
  const started = { started_on: "2026-10-05", stopped_on: null };
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 0, taken: false, keywordless: true }), null);
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 0, taken: false }), KEYWORD_FIXED, "R179 unchanged for a keyword it has");
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 3, taken: false, keywordless: false }), KEYWORD_FIXED);
  assert.match(refuseRekey({ role: "viewer", cluster: started, today, readings: 0, taken: false, keywordless: true })!, /owners and editors/i);
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 0, taken: true, keywordless: true }), "You already track this keyword.");
});

/**
 * Review of ON-1 (9 Oct 2026): a scan signup whose scan chose no keyword has prompts read from its start. A
 * keyword set on it renames the cluster across past ranges and labels past CSV rows, so it stays fixed; only a
 * cluster none of whose prompts has a reading - the no-scan one - is "keywordless".
 */
test("a cluster whose prompts have readings keeps no keyword it never had; one with none takes its first", () => {
  const s0 = fixtureState(fx, { TRACKING_FIXTURE_STATE: "signup" });
  const today = addDays(s0.today, 3);
  const card = s0.data.clusters[0]!;
  assert.equal(card.keyword_id, null);
  const q = s0.data.questions.find((x) => x.cluster_id === card.id)!;
  const unread = { ...s0, today };
  const read = { ...unread, data: { ...unread.data, answers: [{ run_date: addDays(s0.today, 1), question_id: q.id, engine: "chatgpt", answered: true, named: false, brands: [], citations: [] }] } };
  const use = (f: typeof s0) => {
    const { check, sig } = fixtureCheck(f, KW);
    return fixtureRekey(f, { clusterId: card.id, keyword: KW, volume: FIXTURE_CHECK_VOLUME, intent: check.ok ? check.intent : "", sig: sig ?? null, role: "owner" });
  };
  const refused = use(read);
  assert.equal(refused.ok, false);
  assert.equal((refused as { message: string }).message, KEYWORD_FIXED, "its prompts were read: fixed, as R179 says");
  assert.ok(use(unread).ok, "nothing of it read: it takes its first keyword");
  // The live write reads the cluster's prompts and counts their answers before it decides.
  const rekey = readFileSync(new URL("./rekey.ts", import.meta.url), "utf8");
  assert.match(rekey, /const unread = await clusterUnread\(db, p\.clientId, p\.clusterId\);/);
  assert.match(rekey, /\.from\("tracking_answers"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("client_domain_id", clientId\)\.in\("question_id", ids\)/);
});

test("on the fixture, a no-scan signup checks its keyword, sets it days after its start, and saves the five drafts", () => {
  // signup-typed is day zero; move it on three days, as a buyer who comes back to setup later.
  const s0 = fixtureState(fx, { TRACKING_FIXTURE_STATE: "signup-typed" });
  const today = addDays(s0.today, 3);
  const s = { ...s0, today };
  const card = s.data.clusters[0]!;
  assert.equal(card.keyword_id, null);
  assert.equal(s.data.questions.length, 0);
  assert.ok(card.started_on <= today, "the cluster has started");
  const { check, sig } = fixtureCheck(s, KW);
  assert.ok(check.ok && sig);
  const keyed = fixtureRekey(s, { clusterId: card.id, keyword: KW, volume: FIXTURE_CHECK_VOLUME, intent: check.ok ? check.intent : "", sig: sig ?? null, role: "owner" });
  assert.ok(keyed.ok, keyed.ok ? "" : keyed.message);
  const kw = keyed.fixture.data.keywords.find((k) => k.keyword === KW)!;
  assert.equal(kw.added_on, addDays(today, 1), "checked from the next daily check, not back-dated to the start");
  const saved = fixtureFillDrafts(keyed.fixture, { clusterId: card.id, prompts: draftPrompts(KW), today, role: "owner" });
  assert.ok(saved.ok, saved.ok ? "" : saved.message);
  const mine = saved.fixture.data.questions.filter((q) => q.cluster_id === card.id);
  assert.deepEqual(mine.map((q) => [q.angle, q.added_on]), ANGLES.map((a) => [a, addDays(today, 1)]));
  // A second save finds no room: the cluster has its five.
  const again = fixtureFillDrafts(saved.fixture, { clusterId: card.id, prompts: draftPrompts("invoicing software for freelancers"), today, role: "owner" });
  assert.equal(again.ok, false);
  assert.equal(slotWhyOf((again as { message: string }).message), "full");
  // A viewer saves nothing.
  assert.equal(fixtureFillDrafts(keyed.fixture, { clusterId: card.id, prompts: draftPrompts(KW), today, role: "viewer" }).ok, false);
});

test("census: the free slot's route writes posted drafts with fillDrafts", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const route = src("../../app/api/app/[client]/prompt/route.ts");
  assert.match(route, /const drafts = readDrafts\(/, "the prompt route reads the drafts");
  assert.match(route, /await fillDrafts\(supabaseAdmin\(\), \{ clientId: client\.id, clusterId: f\.id, prompts: drafts, today: trackingDay\(\), by: email, role: writeRole\(client\) \}\)/, "and writes them through fillDrafts, as the member's role on a live client");
  const draft = src("./new-cluster.ts");
  assert.match(draft, /return fillSlots\(db, \{/, "fillDrafts is the free slot's write, not a fork of it");
  // 18 Oct 2026, brief 2d: the callers' half - the /app setup card and the empty Clusters row posting drafts, owners
  // and editors only - retired with /app; every /app address 308s to the dashboards host, whose setup posts to its own
  // route. The route's write through fillDrafts still holds.
});

/**
 * ON-1 review (9 Oct 2026): the tracking day is London's, so at 21:30 ET on 9 Oct it is already 10 Oct there,
 * prompts saved then are added for 11 Oct, and their first check is 1:00am ET on 11 Oct - which the card said
 * was "tomorrow". Said now from the first check's own moment, in the client's zone.
 */
test("when saved drafts are first asked is said from now, in the client's zone", () => {
  const at = (iso: string, market: string, startedOn: string | null = null) => {
    const now = Date.parse(iso);
    return firstAsked({ today: trackingDay(new Date(now)), startedOn, market, now });
  };
  assert.equal(at("2026-10-10T01:30:00Z", "US"), "on 11 Oct at 1:00am ET", "21:30 ET on 9 Oct");
  assert.equal(at("2026-10-09T16:00:00Z", "US"), "tomorrow at 1:00am ET", "noon ET on 9 Oct");
  assert.equal(at("2026-10-10T04:30:00Z", "US"), "tomorrow at 1:00am ET", "00:30 ET on 10 Oct: the 1am run that night reads none of them");
  assert.equal(at("2026-10-09T22:30:00Z", "UK"), "tomorrow at 06:00 UK time", "23:30 in London");
  assert.equal(at("2026-10-09T23:30:00Z", "UK"), "tomorrow at 06:00 UK time", "00:30 in London: its tracking day has turned too");
  assert.equal(at("2026-10-09T16:00:00Z", "US", "2026-10-12"), "on 12 Oct at 1:00am ET", "a start later than tomorrow");
  assert.equal(checkOn("2026-10-10", "US", Date.parse("2026-10-10T04:30:00Z")), "today at 1:00am ET");
  // setupChecks with now: an evening US purchase starts on London's day after, two of its own days away.
  const now = Date.parse("2026-10-10T01:30:00Z");
  assert.deepEqual(setupChecks({ startedOn: "2026-10-11", today: trackingDay(new Date(now)), market: "US", livePrompts: 5, now }), { first: "on 11 Oct at 1:00am ET", line: "The first check runs on 11 Oct at 1:00am ET." });
});

test("the text rules the page runs before posting are the routes' own, and their length is ADMIN_LIMITS.question", () => {
  assert.equal(PROMPT_MAX, ADMIN_LIMITS.question);
  const d = draftPrompts(KW);
  assert.equal(refuseDraftsAt(d, 5), null);
  assert.deepEqual(refuseDraftsAt([d[0]!, d[1]!, d[0]!, d[3]!, d[4]!], 5), { message: PROMPT_TWIN, at: 2 });
  assert.deepEqual(refuseDraftsAt([d[0]!, d[1]!, d[2]!, "short", d[4]!], 5), { message: SLOT_WHY.length, at: 3 });
  assert.equal(refuseDrafts([d[0]!, d[1]!, d[0]!, d[3]!, d[4]!]), PROMPT_TWIN, "refuseDrafts is the same rule");
  // DraftsCheck imports prompt-text.ts alone, which imports nothing - so the page's bundle carries no server code.
  // 18 Oct 2026, brief 2d: DraftsCheck and SubmitButton (src/components/app) retired with /app; prompt-text.ts still
  // imports nothing, so any page that runs these rules carries no server code.
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.doesNotMatch(src("./prompt-text.ts"), /^import /m);
});
