import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { trialMoment } from "../../config/trial.ts";
import { CHECK_HOUR_UTC, NO_PROMPT_NO_CHECK, checkTime, clockIn, marketZone, nextCheckAt } from "./check-time.ts";
import { shouldTrack } from "./decide.ts";
import { addDays } from "./figures.ts";
import { firstCheckWhen, setupChecks } from "./setup-landing.ts";

/**
 * The daily check's time, in the client's own zone (9 Oct 2026, audit copy-2,
 * data-9, ia-9, activation-13). "06:00" was written about thirty times with
 * no zone: London wall-clock while BST lasts, so an hour wrong from 25 Oct
 * 2026, and a London time to a US client all year. The helper's cases, then
 * the census that keeps a hard-coded clock time out of the copy and ties the
 * helper's hour to the cron that actually runs.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

test("the check time is the client's zone's on the day meant, labelled, either side of each clock change", () => {
  // UK: BST ends 25 Oct 2026 at 01:00 UTC, so that day's 05:00 UTC run is already 05:00 GMT.
  assert.equal(checkTime("2026-10-24", "UK"), "06:00 UK time");
  assert.equal(checkTime("2026-10-25", "UK"), "05:00 UK time");
  assert.equal(checkTime("2026-10-26", "uk"), "05:00 UK time");
  assert.equal(checkTime("2027-03-28", "UK"), "06:00 UK time");
  // US: EDT ends 1 Nov 2026 at 06:00 UTC, after that day's run; EST ends 14 Mar 2027 at 07:00 UTC, after that day's.
  assert.equal(checkTime("2026-10-26", "US"), "1:00am ET");
  assert.equal(checkTime("2026-11-01", "US"), "1:00am ET");
  assert.equal(checkTime("2026-11-02", "US"), "12:00am ET");
  assert.equal(checkTime("2027-03-14", "us"), "12:00am ET");
  assert.equal(checkTime("2027-03-15", "US"), "1:00am ET");
});

test("the acceptance dates: 2 Nov 2026 reads 05:00 UK time and midnight ET, never a bare 06:00", () => {
  const today = "2026-11-02";
  assert.equal(checkTime(addDays(today, 1), "UK"), "05:00 UK time");
  assert.equal(checkTime(addDays(today, 1), "US"), "12:00am ET");
  assert.equal(checkTime(addDays("2026-10-25", 1), "UK"), "05:00 UK time", "the day after the clocks go back");
});

test("a run's finishing time is the client's zone's too", () => {
  // The fixture's run finishes at 06:10Z: London read 07:10 with no zone, to a US client.
  assert.equal(clockIn("2026-09-29T06:10:00Z", "US"), "2:10am ET");
  assert.equal(clockIn("2026-09-29T06:10:00Z", "UK"), "07:10 UK time");
  assert.equal(clockIn("2026-12-01T05:08:00Z", "UK"), "05:08 UK time");
  assert.equal(clockIn("2026-12-01T05:08:00Z", "US"), "12:08am ET");
  assert.equal(clockIn("nonsense", "UK"), null);
  assert.equal(marketZone("UK"), "Europe/London");
  assert.equal(marketZone("US"), "America/New_York");
});

test("the trial's end and the check times share one zone and one wording", () => {
  assert.equal(trialMoment("2026-10-22T05:00:00Z", "UK"), `22 Oct 2026, ${checkTime("2026-10-22", "UK")}`);
  assert.equal(trialMoment("2026-11-02T05:00:00Z", "US"), `2 Nov 2026, ${checkTime("2026-11-02", "US")}`);
});

test("the next run is today's at the cron's hour while it is still to come, else tomorrow's", () => {
  assert.equal(new Date(nextCheckAt(Date.parse("2026-10-09T04:59:59Z"))).toISOString(), "2026-10-09T05:00:00.000Z");
  assert.equal(new Date(nextCheckAt(Date.parse("2026-10-09T05:00:00Z"))).toISOString(), "2026-10-10T05:00:00.000Z");
  assert.equal(new Date(nextCheckAt(Date.parse("2026-10-09T23:30:00Z"))).toISOString(), "2026-10-10T05:00:00.000Z");
});

test("a first check is promised only while it is still to come", () => {
  assert.equal(firstCheckWhen("2026-10-27", "2026-10-26", "UK"), "tomorrow at 05:00 UK time");
  assert.equal(firstCheckWhen("2026-10-10", "2026-10-09", "US"), "tomorrow at 1:00am ET");
  assert.equal(firstCheckWhen("2026-10-12", "2026-10-09", "UK"), "on 12 Oct at 06:00 UK time");
  // Checks began, or no start recorded: the runner reads live prompts whether or not setup was confirmed.
  assert.equal(firstCheckWhen("2026-10-09", "2026-10-09", "UK"), null);
  assert.equal(firstCheckWhen("2026-10-01", "2026-10-09", "UK"), null);
  assert.equal(firstCheckWhen(null, "2026-10-09", "UK"), null);
});

/**
 * Review of 3eaa592 (9 Oct 2026): firstCheckWhen looked at started_on only, so
 * the R180 no-scan order - no live prompt, started tomorrow - was told "The
 * first check runs tomorrow at 1:00am ET" on the setup page, and a day later
 * "Checks run every day at 1:00am ET", while the runner skips it and its own
 * Overview said nothing is checked. setupChecks is what both surfaces say.
 */
test("setup promises a check only when the runner would make one: a live prompt, and the start come or to come", () => {
  const base = { today: "2026-10-09", market: "US" };
  // The signup-typed fixture's case: 0 live prompts, started tomorrow, then the day after.
  for (const startedOn of ["2026-10-10", "2026-10-09", "2026-10-01", null]) {
    assert.deepEqual(setupChecks({ ...base, startedOn, livePrompts: 0 }), { first: null, line: NO_PROMPT_NO_CHECK }, String(startedOn));
    assert.equal(shouldTrack({ id: "c", status: "active", started_on: startedOn, activeQuestions: 0 }, startedOn ?? base.today), false, "and the runner agrees");
  }
  assert.equal(NO_PROMPT_NO_CHECK, "Nothing is checked until a cluster has prompts.");
  assert.deepEqual(setupChecks({ ...base, startedOn: "2026-10-10", livePrompts: 5 }), { first: "tomorrow at 1:00am ET", line: "The first check runs tomorrow at 1:00am ET." });
  assert.deepEqual(setupChecks({ today: "2026-10-26", market: "UK", startedOn: "2026-10-27", livePrompts: 5 }), { first: "tomorrow at 05:00 UK time", line: "The first check runs tomorrow at 05:00 UK time." });
  // Checks began: a live prompt and a start that has come is what shouldTrack runs.
  assert.equal(shouldTrack({ id: "c", status: "active", started_on: "2026-10-01", activeQuestions: 1 }, base.today), true);
  // "Checks run every day at 1:00am ET." until 12 Oct 2026 (email review L2): a standing time stops being true when the
  // clocks change, and the setup_confirmed mail keeps it. The line now names the next run only, in its own zone's time.
  assert.deepEqual(setupChecks({ ...base, startedOn: "2026-10-01", livePrompts: 1 }), { first: null, line: "Checks run every day. The next one runs tomorrow at 1:00am ET." });
  assert.deepEqual(setupChecks({ today: "2026-11-02", market: "US", startedOn: "2026-10-01", livePrompts: 1 }), { first: null, line: "Checks run every day. The next one runs tomorrow at 12:00am ET." });
  assert.deepEqual(setupChecks({ today: "2026-10-24", market: "UK", startedOn: "2026-10-01", livePrompts: 1 }), { first: null, line: "Checks run every day. The next one runs tomorrow at 05:00 UK time." }, "the night the clocks go back");
});

/**
 * Email review H3 (12 Oct 2026): setup_confirmed counted "tomorrow" from
 * London's tracking day, so a US client confirming at 21:30 ET - already the
 * next day in London - was told "tomorrow" for a check two nights away, in
 * the subject. With the confirm's moment, the mail and the setup page say the
 * same thing, in the client's own day.
 */
test("H3: a US confirm at 21:30 ET is said from the client's evening, not London's next day", () => {
  const now = Date.parse("2026-10-10T01:30:00Z"); // 21:30 EDT on 9 Oct, 02:30 BST on 10 Oct
  const today = "2026-10-10"; // the tracking day (London's) at that moment
  // Bought that evening: signup starts the client the day after London's day, so the first check is 1am ET on 11 Oct.
  assert.deepEqual(setupChecks({ today, market: "US", startedOn: "2026-10-11", livePrompts: 5, now }), { first: "on 11 Oct at 1:00am ET", line: "The first check runs on 11 Oct at 1:00am ET." });
  // Bought that afternoon (started 10 Oct): London's day has turned but the 10 Oct check has not run - it is the US client's tomorrow.
  assert.deepEqual(setupChecks({ today, market: "US", startedOn: "2026-10-10", livePrompts: 5, now }), { first: "tomorrow at 1:00am ET", line: "The first check runs tomorrow at 1:00am ET." });
  // The London-day rule this replaced said "tomorrow" for the first and nothing for the second.
  assert.equal(firstCheckWhen("2026-10-11", today, "US", now), "on 11 Oct at 1:00am ET");
  assert.equal(firstCheckWhen("2026-10-10", today, "US", now), "tomorrow at 1:00am ET");
  // Once that check has run, checks have begun, and the next is named from the client's day.
  const after = Date.parse("2026-10-10T13:30:00Z");
  assert.deepEqual(setupChecks({ today, market: "US", startedOn: "2026-10-10", livePrompts: 5, now: after }), { first: null, line: "Checks run every day. The next one runs tomorrow at 1:00am ET." });
  // A UK client in London's small hours, started today: today's check is still to come.
  assert.equal(firstCheckWhen("2026-10-10", today, "UK", now), "today at 06:00 UK time");
});

// ------------------------------------------------------------------ census

test("census: CHECK_HOUR_UTC is the hour vercel.json runs the track cron at", () => {
  const crons = (JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[] }).crons ?? [];
  const track = crons.filter((c) => c.path === "/api/cron/track");
  assert.equal(track.length, 1, "one track cron");
  assert.equal(track[0]!.schedule, `0 ${CHECK_HOUR_UTC} * * *`, "every check time the copy states is worked out from this hour");
});

/**
 * Where a client reads a check time: the dashboard, setup, Settings, Reports,
 * the API routes' toasts and the checkout pages, the lifecycle and order mail,
 * and the tracking and config modules that word their copy.
 */
const ROOTS = ["src/components/app", "src/app/app", "src/app/api/app", "src/app/checkout", "src/lib/email", "src/lib/tracking", "src/lib/checkout", "src/config"];
/** Files walked on 9 Oct 2026: 151. A walk that stops matching reports a clean tree. */
const FLOOR = 140;

/** A clock time, "06:00", "6:10", "6am", "6 a.m.". Not one inside an ISO timestamp ("T05:00:00Z"). */
const CLOCK = /(?<![\w:.])(?:[01]?\d|2[0-3]):[0-5]\d(?![\w:])|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)? ?[ap]\.?m\.?(?![a-z])/i;
/** A zone label. Only check-time.ts writes one, so a time can never carry a zone it was not worked out in. */
const ZONE = / ET\b|\bUK time\b|\b(?:BST|GMT|EDT|EST)\b|\bLondon time\b/;

/**
 * The clock times allowed in code, each with its reason. Pinned as lines, not
 * files, so copy added beside one still fails.
 */
const ALLOWED: Record<string, string> = {
  'src/lib/tracking/repo.ts :: const at = ["05:10", "05:11", "05:12", "05:12"];':
    "the fixture's answer times: UTC data built into ISO timestamps, which the one-cluster page shows through clockIn. Never copy.",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.includes(".test.") ? [p] : [];
  });
}

/** Code with its comments taken out, as causal-copy.test.mts strips them; JSX comments are block comments. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

export function clockHits(src: string): string[] {
  return code(src).split("\n").filter((l) => CLOCK.test(l)).map((l) => l.trim());
}

export function zoneHits(src: string): string[] {
  return code(src).split("\n").filter((l) => ZONE.test(l)).map((l) => l.trim());
}

const files = () => ROOTS.flatMap((r) => walk(join(ROOT, r))).map((f) => ({ file: relative(ROOT, f), src: readFileSync(f, "utf8") }));

test("census: no check time is typed into copy - every one is check-time.ts's, for the client's zone and the day", () => {
  const all = files();
  assert.ok(all.length >= FLOOR, `walked ${all.length} files, floor ${FLOOR}`);
  const found = all.flatMap(({ file, src }) => clockHits(src).map((l) => `${file} :: ${l}`));
  assert.deepEqual(found.filter((h) => !(h in ALLOWED)), [], "a hard-coded clock time: say it with checkTime (a day's check) or clockIn (a moment) from check-time.ts");
  assert.deepEqual(Object.keys(ALLOWED).filter((h) => !found.includes(h)), [], "an allowed line is gone: take it out of ALLOWED");
});

test("census: only check-time.ts writes a zone label", () => {
  const found = files().flatMap(({ file, src }) => zoneHits(src).map((l) => `${file} :: ${l}`));
  assert.deepEqual(
    found.map((h) => h.split(" :: ")[0]),
    ["src/lib/tracking/check-time.ts", "src/lib/tracking/check-time.ts"],
    "the UK and the ET label, once each",
  );
});

/**
 * The surfaces that state a check time, each asking the helper (9 Oct 2026).
 * A floor too, on call expressions in those surfaces: check-time.ts itself,
 * and a `function name(` that declares one, are not calls. Until the review
 * of 3eaa592 (9 Oct 2026) the count took in both - 21, of which four were
 * check-time.ts's two declarations and its own clockIn call and
 * firstCheckWhen's declaration - so a floor of 20 held only 16 real calls.
 * Re-counted on 9 Oct 2026, with setupChecks the setup page's and the mail's
 * one call: 17 (Overview 5, Clusters 2, OneCluster 1, Settings 1, Reports 1,
 * latest-answers 1, trial 1, setup page 1, lifecycle 1, setup-landing 3 -
 * firstCheckWhen's checkTime, setupChecks' firstCheckWhen and checkTime).
 */
const CALLERS = [
  "src/components/app/Overview.tsx",
  "src/components/app/Settings.tsx",
  "src/components/app/Clusters.tsx",
  "src/components/app/OneCluster.tsx",
  "src/components/app/Reports.tsx",
  "src/app/app/[client]/setup/page.tsx",
  "src/lib/email/lifecycle.ts",
  "src/lib/tracking/latest-answers.ts",
  "src/lib/tracking/setup-landing.ts",
  "src/config/trial.ts",
];
const CALLS_FLOOR = 17;

/** A call of the helper or a wrapper of it; a declaration, `function checkTime(`, is not one. */
const CALL = /(?<!\bfunction\s+)\b(?:checkTime|clockIn|firstCheckWhen|setupChecks)\(/g;
export const callsIn = (src: string) => (code(src).match(CALL) ?? []).length;

test("census: every surface that states a check time asks check-time.ts", () => {
  const calls = files()
    .filter(({ file }) => file !== "src/lib/tracking/check-time.ts")
    .map(({ file, src }) => ({ file, n: callsIn(src) }));
  for (const f of CALLERS) assert.ok((calls.find((c) => c.file === f)?.n ?? 0) > 0, `${f} no longer asks check-time.ts`);
  const total = calls.reduce((s, c) => s + c.n, 0);
  assert.ok(total >= CALLS_FLOOR, `${total} calls, floor ${CALLS_FLOOR}`);
  // The Overview's next check and Settings' are the same day's, so they cannot disagree.
  for (const f of ["src/components/app/Overview.tsx", "src/components/app/Settings.tsx"]) {
    assert.match(readFileSync(join(ROOT, f), "utf8"), /checkTime\(addDays\(today, 1\), market\)/, f);
  }
});

/**
 * Review of 3eaa592 (9 Oct 2026): firstCheckWhen knows the start date and not
 * the prompts, so a surface that asks it directly can promise a check the
 * runner never makes. Only setupChecks asks it; the setup page and the mail
 * ask setupChecks, with a live-prompt count.
 */
test("census: only setupChecks asks firstCheckWhen, and setup's two surfaces ask setupChecks with the live prompts", () => {
  const direct = files().filter(({ file, src }) => file !== "src/lib/tracking/setup-landing.ts" && /(?<!\bfunction\s+)\bfirstCheckWhen\(/.test(code(src)));
  assert.deepEqual(direct.map((f) => f.file), [], "say it through setupChecks, which knows whether a prompt is live");
  for (const f of ["src/app/app/[client]/setup/page.tsx", "src/lib/email/lifecycle.ts"]) {
    assert.match(code(readFileSync(join(ROOT, f), "utf8")), /setupChecks\(\{[^}]*livePrompts/, f);
  }
  assert.match(code(readFileSync(join(ROOT, "src/lib/tracking/setup-mail.ts"), "utf8")), /livePrompts: livePrompts \?\? 0/, "the mail's send site counts the prompts");
  assert.match(code(readFileSync(join(ROOT, "src/components/app/Overview.tsx"), "utf8")), /: NO_PROMPT_NO_CHECK;/, "the Overview's day-zero line is the same words");
});

test("census probe: the old copy fires, comments and ISO timestamps do not", () => {
  assert.equal(clockHits(`const s = "Next check tomorrow at 06:00.";`).length, 1);
  assert.equal(clockHits("<span>First check tomorrow, 06:00</span>").length, 1);
  assert.equal(clockHits("`Checks run every day at 6am`").length, 1);
  assert.equal(clockHits(`subject: "Your first check runs tomorrow at 6 a.m."`).length, 1);
  assert.equal(clockHits("// tomorrow's 06:00 check\n/* 06:00 in London */\n{/* 06:00 */}").length, 0);
  assert.equal(clockHits("const at = `${day}T05:00:00Z`;").length, 0);
  assert.equal(clockHits("Step 2 amounts to 5 prompts").length, 0);
  assert.equal(zoneHits("`${t} UK time`").length, 1);
  assert.equal(zoneHits("`${t}am ET`").length, 1);
  assert.equal(zoneHits("Date.UTC(y, m, d)").length, 0);
  // The call floor counts calls, not the declarations that would pad it.
  assert.equal(callsIn("export function clockIn(at) {}\nexport function checkTime(day) { return clockIn(day); }"), 1);
  assert.equal(callsIn("const s = `at ${checkTime(addDays(today, 1), market)}`; // checkTime(x)"), 1);
  assert.equal(callsIn("const { first } = setupChecks({ livePrompts: 0 });"), 1);
});
