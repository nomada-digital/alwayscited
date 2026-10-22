import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import { trialCharge, trialMoment } from "../../config/trial.ts";
import { TIER_PLAIN } from "../tier-text.ts";
import { NO_PROMPT_NO_CHECK } from "../tracking/check-time.ts";
import { flagFor, flagOn, LIFECYCLE_EMAILS, planEnded, previews, previewSets, setupConfirmed, setupReminder, welcome } from "./lifecycle.ts";

/** R159 (1 Oct 2026): the lifecycle templates' shared rules, on the preview fixtures. Nothing is sent. */

/**
 * A made-up price, so these tests check that the charge is worded by
 * trialCharge and never hold a second copy of TRACKED_PRICE (pricing.ts is
 * not loadable here; the preview page passes the real one).
 */
const PRICE = { us: 101, uk: 77 };
const all = previews(PRICE);
const sets = previewSets(PRICE);
/** Every case of every email, as the preview page draws them. */
const every = Object.entries(sets).flatMap(([name, list]) => list.map((p) => [`${name} (${p.label})`, p.mail] as const));

/**
 * Six until 8 Oct 2026, when the trial's three joined (audit activation-1,
 * copy-4): trial_started (the welcome for a trial order), trial_midpoint and
 * trial_ending, each behind its own flag.
 */
test("every lifecycle email has a template and a preview, and its flag is email_<name>_enabled", () => {
  assert.deepEqual(Object.keys(all).sort(), [...LIFECYCLE_EMAILS].sort());
  assert.deepEqual(Object.keys(sets).sort(), [...LIFECYCLE_EMAILS].sort());
  // 13 Oct 2026, DIY P9: ten - this_week, the Monday "This week" email, built dark (spec 10 section 7.10).
  assert.equal(LIFECYCLE_EMAILS.length, 10);
  for (const n of LIFECYCLE_EMAILS) {
    assert.match(flagFor(n), /^email_[a-z_]+_enabled$/);
    assert.ok(sets[n].length >= 1, `${n} has no preview`);
    assert.equal(new Set(sets[n].map((p) => p.label)).size, sets[n].length, `${n}: two previews share a label`);
  }
  // Raised 13 Oct 2026 (DIY P9): 27 - the 23 before and this_week's 4.
  assert.ok(every.length >= 27, `only ${every.length} preview cases: the sweep below is reading too few`);
});

test("each has one button, the help block and the footer company line, in HTML and plain text", () => {
  for (const [name, m] of every) {
    assert.equal(m.html.match(/<td bgcolor=/g)?.length, 1, `${name}: one button`);
    for (const part of [m.html, m.text]) {
      assert.ok(part.includes(COMPANY_LINE), `${name}: company line`);
      assert.ok(part.includes(CONTACT_EMAIL), `${name}: email us`);
      assert.match(part, /Book a call/, `${name}: book a call`);
      assert.match(part, /\/contact\?tier=always/, `${name}: the call is prefilled with the tier`);
    }
    assert.ok(m.subject.length > 0 && m.subject.length < 90, `${name}: subject`);
  }
});

test("the brand is lowercase and tiers are TIER_PLAIN, never a capitalised form", () => {
  for (const [name, m] of every) {
    for (const part of [m.subject, m.html, m.text]) {
      assert.doesNotMatch(part, /AlwaysCited|Alwayscited|always cited|Always(tracked|mentioned|everywhere)/, name);
      assert.doesNotMatch(part, /tier-name__accent|--brand-purple/, `${name}: no tier colouring in mail`);
    }
  }
  assert.ok(all.welcome.text.includes(TIER_PLAIN.mentioned));
  assert.ok(all.plan_ended.subject.includes(TIER_PLAIN.cited));
});

// "with 1 cluster" was asserted here for tracked until 8 Oct 2026 - the defect
// audit activation-16 names: the alwaystracked plan is 10 clusters, and 1 is
// only what signup makes. A placements order still states what it bought.
test("what the buyer typed is escaped in the HTML", () => {
  const m = welcome({ tier: "mentioned", clusters: 1, clusterLimit: 10, domain: `a<b>&"c.com`, link: "https://alwayscited.com/app/auth?token=x&y=1" });
  assert.ok(!m.html.includes("a<b>"), "domain escaped");
  assert.ok(m.html.includes("a&lt;b&gt;&amp;&quot;c.com"));
  assert.ok(m.html.includes('href="https://alwayscited.com/app/auth?token=x&amp;y=1"'));
  assert.ok(m.text.includes(`a<b>&"c.com`), "plain text is as typed");
  assert.match(m.text, /with 1 cluster\./);
});

test("activation-16: the alwaystracked welcome states the plan's 10 clusters, and on the trial never says bought", () => {
  const base = { tier: "tracked" as const, clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x" };
  const paid = welcome(base);
  assert.match(paid.text, /tracks up to 10 clusters/);
  assert.doesNotMatch(paid.text, /with 1 cluster/);
  const trial = welcome({ ...base, trial: { ends: "22 Oct 2026, 3:30pm ET", charge: "$101 a month", billing: "https://example.com/b#set-billing" } });
  assert.match(trial.text, /10 clusters/);
  assert.match(trial.subject, /free trial/);
  assert.match(trial.text, /free trial/);
  assert.doesNotMatch(trial.text, /\bbought\b/i);
  assert.doesNotMatch(trial.text, /with 1 cluster/);
});

test("activation-16: the setup reminder says what the runner does - prompts are read whether or not setup is confirmed", () => {
  const some = setupReminder({ tier: "tracked", domain: "example.com", link: "https://example.com/s", withPrompts: 1, clusterLimit: 10 });
  assert.match(some.text, /are being checked, but 9 of your 10 clusters are still empty/);
  assert.doesNotMatch(some.text + some.html, /Nothing is checked/);
  const none = setupReminder({ tier: "tracked", domain: "example.com", link: "https://example.com/s", withPrompts: 0, clusterLimit: 10 });
  assert.match(none.text, /Nothing is checked until your first cluster has prompts/);
  assert.equal(sets.setup_reminder.length, 2, "both cases are drawn for approval");
});

/**
 * copy-2 (9 Oct 2026) and the review of 3eaa592: setup_confirmed's subject,
 * heading and the line under it, on each branch. The time is the client's
 * zone's on the day; a "first" check is promised only while it is still to
 * come; and a client with no live prompt - the runner skips it - is promised
 * no check at all, in the Overview's words.
 */
test("copy-2: setup_confirmed says when checks run in the client's zone, and promises none the runner will not make", () => {
  const base = { tier: "tracked" as const, clusters: ["invoicing software"], link: "https://example.com/app" };
  const cases = [
    { why: "US, started tomorrow", d: { market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 5 }, head: "Your first check runs tomorrow at 1:00am ET", line: null },
    { why: "UK, the day after the clocks go back", d: { market: "UK", today: "2026-10-26", startedOn: "2026-10-27", livePrompts: 5 }, head: "Your first check runs tomorrow at 05:00 UK time", line: null },
    // "Checks run every day at 06:00 UK time." until 12 Oct 2026 (email review L2): wrong from 25 Oct. The next run only.
    { why: "UK, checks began before the confirm", d: { market: "UK", today: "2026-10-12", startedOn: "2026-10-10", livePrompts: 5 }, head: "Your clusters are set up", line: "Checks run every day. The next one runs tomorrow at 06:00 UK time." },
    // "Your clusters are set up" over "Nothing is checked..." until 12 Oct 2026 (email review L1): the heading now says what is left.
    { why: "US, no prompts, started tomorrow", d: { market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 0 }, head: "Add prompts to start your checks", line: NO_PROMPT_NO_CHECK },
    { why: "US, no prompts, started yesterday", d: { market: "US", today: "2026-10-09", startedOn: "2026-10-08", livePrompts: 0 }, head: "Add prompts to start your checks", line: NO_PROMPT_NO_CHECK },
    // Email review H3 (12 Oct 2026): the confirm's moment, 21:30 ET on 9 Oct - 10 Oct in London.
    { why: "US, confirmed at 21:30 ET, started the day after London's", d: { market: "US", today: "2026-10-10", startedOn: "2026-10-11", livePrompts: 5, now: Date.parse("2026-10-10T01:30:00Z") }, head: "Your first check runs on 11 Oct at 1:00am ET", line: null },
    { why: "US, confirmed at 21:30 ET, started on London's day", d: { market: "US", today: "2026-10-10", startedOn: "2026-10-10", livePrompts: 5, now: Date.parse("2026-10-10T01:30:00Z") }, head: "Your first check runs tomorrow at 1:00am ET", line: null },
  ];
  for (const c of cases) {
    const m = setupConfirmed({ ...base, ...c.d });
    assert.equal(m.subject, c.head, c.why);
    assert.ok(m.text.startsWith(`${c.head}\n\n${c.line ? `${c.line}\n\n` : ""}You chose these clusters:\n`), `${c.why}: heading, then ${c.line ?? "no line"}\n${m.text}`);
    assert.ok(m.html.includes(`>${c.head}<`), `${c.why}: the HTML heading`);
    if (c.line) assert.ok(m.html.includes(c.line), `${c.why}: the HTML line`);
    if (!c.d.livePrompts) assert.doesNotMatch(m.subject + m.text + m.html, /\b(?:first check|every day|clusters are set up)\b|\d:\d\d/, `${c.why}: no check promised`);
  }
  // 4 until 12 Oct 2026 (email review H3): the US confirm late in its evening, a day ahead in London, is drawn too.
  assert.equal(sets.setup_confirmed.length, 5, "each branch is drawn for approval");
  const evening = sets.setup_confirmed.find((p) => /next day in London/.test(p.label))!.mail;
  assert.equal(evening.subject, "Your first check runs on 11 Oct at 1:00am ET", "the evening confirm is not told tomorrow");
  assert.ok(sets.setup_confirmed.some((p) => p.mail.text.includes(NO_PROMPT_NO_CHECK)), "the no-prompt case is one of them");
});

/**
 * activation-1 and copy-4 (8 Oct 2026): the trial's emails, on a tracked-tier
 * trial in both zones. Each running-trial email names the end moment as
 * trialMoment words it for the market, the charge as trialCharge words it,
 * and the cancel route, linked to the client's Billing. None says bought or
 * receipt. The ended trial says it was not charged and that there is no second trial.
 */
const US_END = trialMoment("2026-10-22T19:30:00Z", "US");
const UK_END = trialMoment("2026-10-22T13:30:00Z", "UK");

test("activation-1, copy-4: trial_started, trial_midpoint and trial_ending name the end in the market's zone, the charge and the cancel route", () => {
  assert.equal(US_END, "22 Oct 2026, 3:30pm ET");
  assert.equal(UK_END, "22 Oct 2026, 14:30 UK time");
  for (const name of ["trial_started", "trial_midpoint", "trial_ending"] as const) {
    const cases = sets[name];
    // Exactly a US and a UK case each until 8 Oct 2026 (review of 7e133a7), when the
    // trial_midpoint and trial_ending previews grew a case per recap body. The zone is
    // now read off each label, and both zones must still be drawn for every email.
    const zone = (label: string) => /, (US|UK)$/.exec(label)?.[1];
    assert.deepEqual([...new Set(cases.map((c) => zone(c.label)))].sort(), ["UK", "US"], `${name}: a US and a UK case, each labelled with its zone`);
    for (const { label, mail } of cases) {
      const [end, charge] = zone(label) === "US" ? [US_END, trialCharge("US", PRICE)] : [UK_END, trialCharge("UK", PRICE)];
      const where = `${name} (${label})`;
      assert.ok(mail.text.includes(end), `${where}: names ${end}`);
      assert.ok(mail.text.includes(charge), `${where}: names ${charge}`);
      assert.match(mail.text, /cancel[^\n]*Plan > Billing \(https:\/\/dashboards\.alwayscited\.com\/tallyroo-com\/plan#billing\)/i, `${where}: the cancel route, linked`);
      assert.match(mail.html, /<a href="https:\/\/dashboards\.alwayscited\.com\/tallyroo-com\/plan#billing"[^>]*>Plan &gt; Billing<\/a>/, `${where}: the link in the HTML`);
      assert.doesNotMatch(mail.subject + mail.text, /You bought|\bbought\b|receipt/i, where);
    }
  }
  assert.match(sets.trial_started[0]!.mail.subject, /^Your 14-day free trial of alwaystracked has started$/);
  assert.match(sets.trial_ending[0]!.mail.text, /To keep tracking, there is nothing to do\./);
  assert.match(sets.trial_midpoint[0]!.mail.text, /named in 7 of 60 AI answers\. The other brand named most often: Xero, in 31 answers\./);
  assert.match(sets.trial_midpoint[0]!.mail.text, /You are using 2 of your 10 clusters\./);
  assert.match(sets.trial_midpoint[1]!.mail.text, /Nothing has been checked yet: no cluster has prompts\./);
});

/**
 * Review of 7e133a7 (8 Oct 2026): /admin/emails says it draws every case a
 * flag would send, and trial_ending drew one of the three bodies its recap
 * can take, trial_midpoint two. Danny would have approved trial_ending
 * without seeing "No check has finished yet" or "Nothing has been checked
 * yet". Each preview must match exactly one body, so a reworded body fails
 * here until it is named. What this cannot see: a fourth branch added to
 * recapLines that no preview reaches.
 */
test("every recap body of trial_midpoint and trial_ending is drawn for approval", () => {
  const BODIES = {
    "checks read": /Since the first check on [^,]+, tallyroo\.com was named in \d+ of /,
    "prompts live, no check finished": /No check has finished yet\. You are using \d+ of your \d+ clusters\./,
    "nothing set up": /Nothing has been checked yet: no cluster has prompts\./,
  };
  for (const name of ["trial_midpoint", "trial_ending"] as const) {
    for (const [body, re] of Object.entries(BODIES)) {
      assert.ok(sets[name].some((p) => re.test(p.mail.text)), `${name}: the "${body}" body is not among its previews`);
    }
    for (const p of sets[name]) {
      assert.equal(Object.values(BODIES).filter((re) => re.test(p.mail.text)).length, 1, `${name} (${p.label}): exactly one recap body`);
    }
  }
});

/**
 * Email review H2 (12 Oct 2026): the paid plan_ended said "Stripe sends the
 * final receipt". A plan that stops at its period's end takes no payment as it
 * ends, and Stripe's receipt emails are not a setting we have confirmed.
 */
test("H2: no plan_ended promises a receipt", () => {
  for (const p of sets.plan_ended) assert.doesNotMatch(p.mail.subject + p.mail.text + p.mail.html, /receipt/i, p.label);
  for (const tier of ["tracked", "mentioned", "cited", "everywhere"] as const) {
    assert.doesNotMatch(planEnded({ tier, domain: "example.com", billing: "https://example.com/b" }).text, /receipt/i, tier);
  }
});

/** Email review L4 (12 Oct 2026): "the pages that were cited instead" said the client was passed over, which it may not have been. */
test("L4: first_reading does not say the cited pages were cited instead of the client", () => {
  assert.doesNotMatch(all.first_reading.text + all.first_reading.html, /instead/);
  assert.match(all.first_reading.text, /the pages the answers cited\./);
});

/** Email review L3 (12 Oct 2026): "the morning after one has" was a night early for a US client saving in its evening. */
test("L3: the nothing-set-up recap names when new prompts are first asked, worked out in the client's zone", () => {
  for (const name of ["trial_midpoint", "trial_ending"] as const) {
    const p = sets[name].find((c) => /nothing set up/.test(c.label))!;
    assert.doesNotMatch(p.mail.text, /morning after/, `${name}: the old words`);
    assert.match(p.mail.text, /Prompts you save now are first asked tomorrow at 06:00 UK time\./, name);
  }
});

test("copy-4: plan_ended for a trial that ended uncharged - no receipt, not charged, no second trial; the paid one sends the owner to ask us", () => {
  const trial = planEnded({ tier: "tracked", domain: "example.com", billing: "https://example.com/b", trial: true });
  assert.match(trial.text, /You were not charged/);
  assert.match(trial.text, /no second free trial/);
  assert.doesNotMatch(trial.subject + trial.text, /receipt|pick the plan again|You bought/i);
  const paid = planEnded({ tier: "cited", domain: "example.com", billing: "https://example.com/b" });
  // "To restart, pick the plan again; the dashboard picks up where it stopped" until 8 Oct 2026:
  // a new order cannot bring an ended client back (cbdffad), so it asks us, as the ended banner does.
  assert.doesNotMatch(paid.text, /pick the plan again|picks up where it stopped/);
  for (const m of [trial, paid]) assert.match(m.html, />Ask us to restart it<\/a>/);
  assert.ok(sets.plan_ended.some((p) => /trial/.test(p.label)), "the trial case is drawn for approval");
});

test("the welcome carries the sign-in link on its one button and the 3-step strip", () => {
  const m = all.welcome;
  assert.equal(m.subject, "You're in - set up your clusters");
  assert.match(m.html, />Set up your clusters<\/a>/);
  assert.match(m.html, /https:\/\/dashboards\.alwayscited\.com\/auth\?token=preview-only/);
  assert.equal(m.html.match(/<li /g)?.length, 3);
  assert.match(m.text, /\n1\. .*\n2\. .*\n3\. /);
});

test("the templates do not send: no mail client, network or flag write in the module", async () => {
  // lifecycle-schedule.ts joined 8 Oct 2026: it decides when, and must not send either.
  // this-week-mail.ts joined 13 Oct 2026 (DIY P9): the This week email's builder, a template like the rest.
  for (const file of ["./lifecycle.ts", "./lifecycle-schedule.ts", "./this-week-mail.ts"]) {
    const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /resend|fetch\(|\.from\(|process\.env/i, file);
  }
});

test("a flag is on only for jsonb true; a missing row or any other value is off", () => {
  assert.equal(flagOn(true), true);
  for (const v of [undefined, null, false, "true", 1, {}, []]) assert.equal(flagOn(v), false, JSON.stringify(v));
});

/** Part 3 (1 Oct 2026): the flags ship off, and each send site asks its own flag first. */
test("every flag ships off, and each send site asks its flag before sending", async () => {
  const fs = await import("node:fs");
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  const sql = fs.readdirSync(dir).map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n");
  for (const n of LIFECYCLE_EMAILS) {
    assert.match(sql, new RegExp(`\\('${flagFor(n)}', 'false'::jsonb\\)`), `${flagFor(n)} not inserted as false`);
    assert.doesNotMatch(sql, new RegExp(`'${flagFor(n)}', 'true'`), `${flagFor(n)} switched on in a migration`);
  }
  const signup = read("../checkout/signup.ts");
  assert.equal(signup.match(/sendLifecycle\(/g)?.length, 2, "welcome and plan_ended are the two send sites");
  // 8 Oct 2026 (audit activation-1): a trial order's welcome asks trial_started's flag, never welcome's.
  assert.match(signup, /lifecycleOn\(db, trial \? "trial_started" : "welcome"\)[\s\S]{0,300}sendLifecycle\(\{ memberEmail: o\.email, mail: welcome\(/);
  assert.match(signup, /lifecycleOn\(db, "plan_ended"\)[\s\S]{0,800}sendLifecycle\(\{ memberEmail: m\.email as string, mail \}\)/);
  assert.match(signup, /: await sendLoginLink\(\{ memberEmail: o\.email, link \}\)/, "the login link stays the default while welcome is off");
  // The invite: branded only outside agency mode and with its flag on, else the plain inviteMail as before.
  // 9 Oct 2026 (AG-1): both take everyClient, the count an invite to every client names.
  const member = read("../../app/api/app/[client]/member/route.ts");
  assert.match(member, /!agency && \(await lifecycleOn\(db, "invite"\)\)\s*\? inviteEmail\([\s\S]{0,300}: inviteMail\(\{ inviter: email, domain: client\.domain, role: f\.role!, agency, everyClient \}\)/);
});

test("first_reading: flag first, the client's only finished run, no agency, the Overview's own figures", () => {
  const runner = fs.readFileSync(new URL("../tracking/runner.ts", import.meta.url), "utf8");
  const body = runner.slice(runner.indexOf("async function mailFirstReading"));
  assert.ok(body.length > 200, "mailFirstReading is gone from runner.ts");
  const at = (s: string) => body.indexOf(s);
  assert.ok(at('lifecycleOn(db, "first_reading")') >= 0 && at('lifecycleOn(db, "first_reading")') < at("sendLifecycle("), "the flag is asked before the send");
  assert.ok(at("if (count !== 1) return;") >= 0 && at("if (count !== 1) return;") < at("sendLifecycle("), "only on the client's first finished run");
  assert.ok(at('=== "agency") return;') >= 0 && at('=== "agency") return;') < at("sendLifecycle("), "never in agency mode");
  // 9 Oct 2026 (audit reliability-4): a re-run reads again only what did not
  // come back, so the day's figures are its rows merged over what the run kept
  // (rerun.ts dayRows); the cron's pass keeps nothing and reads its own rows,
  // as before. Still the Overview's namedRate and keywordsOnPage1.
  assert.match(runner, /const all = kept \? dayRows\(kept, written, serpRows\) : \{ answers: answerRows, serp: serpRows \};/);
  assert.match(runner, /named: namedRate\(all\.answers, range\),\s*page1: keywordsOnPage1\(all\.serp, range, keywords\.length\)/);
  // Once a day: not on a re-run of a run an earlier pass of which landed.
  assert.match(runner, /if \(status !== "failed" && !rerun\?\.landed\) \{/);
});

test("the invite names who added you and the role", () => {
  const t = all.invite.text;
  assert.match(t, /sam@tallyroo\.com added you to the tallyroo\.com dashboard as a viewer/);
});

test("AG-1 (9 Oct 2026): an invite to every client says so; an invite to one client names that client only", () => {
  const every = sets.invite.find((p) => /every client/.test(p.label))!.mail;
  assert.equal(every.subject, "You've been added to the tallyroo.com dashboard and 2 more");
  assert.match(every.text, /sam@tallyroo\.com added you to the dashboards for tallyroo\.com and the 2 other clients on their account, as an editor\./);
  assert.doesNotMatch(all.invite.text, /other client|more/, "the one-client invite does not say there are others");
});

/**
 * 8 Oct 2026 (audit activation-1): the cron's sends - trial_midpoint,
 * trial_ending, setup_reminder - and Stripe's trial_will_end, read off the
 * source the way first_reading is above. Each asks its flag before any read,
 * claims its dashboard_events row before the send, mails live owners only and
 * never in agency mode; the cron runs it after the dispatch and cannot fail on it.
 */
test("the lifecycle sweep: flags first, claim before send, live owners, no agency, after the dispatch", () => {
  const sweep = fs.readFileSync(new URL("./lifecycle-sweep.ts", import.meta.url), "utf8");
  const body = sweep.slice(sweep.indexOf("export async function sweepLifecycleMail("));
  assert.ok(body.length > 500, "sweepLifecycleMail is gone from lifecycle-sweep.ts");
  // 13 Oct 2026, DIY P9: this_week's flag joins, asked with the others before any read; with every flag off nothing is
  // read, and the owners' three still return early when only this_week is on.
  const flags = ["trial_midpoint", "trial_ending", "setup_reminder", "this_week"].map((n) => body.indexOf(`lifecycleOn(db, "${n}")`));
  for (const at of flags) assert.ok(at >= 0 && at < body.indexOf('.from("client_domains")') && at < body.indexOf("sweepThisWeek(db"), "a flag is asked before the first read");
  assert.match(body, /if \(!on\.trial_midpoint && !on\.trial_ending && !on\.setup_reminder && !on\.this_week\) return out;/);
  assert.match(body, /if \(on\.this_week\) \{\s*try \{\s*await sweepThisWeek\(db, io, now, out\);/, "This week goes only with its own flag on, and its failure is its own");
  assert.match(body, /if \(!on\.trial_midpoint && !on\.trial_ending && !on\.setup_reminder\) return out;/);
  assert.match(body, /if \(!due \|\| !on\[due\]\) continue;/, "a trial email goes only with its own flag on");
  const deliver = sweep.slice(sweep.indexOf("async function deliver("), sweep.indexOf("export async function sweepLifecycleMail("));
  // The send was sendLifecycle( until 8 Oct 2026 (review of 7e133a7): the sweep now takes its
  // sender as io.send so lifecycle-sweep.test.mts can run it, and lifecycle-cron.ts hands it
  // sendLifecycle - asserted below, with the sweep importing no sender of its own.
  const claimAt = deliver.indexOf(".insert({ client_domain_id: c.id");
  assert.ok(claimAt >= 0 && claimAt < deliver.indexOf("io.send("), "the claim is written before the send");
  // 13 Oct 2026, DIY P9: the This week email claims and sends the same way, to the owners and editors who see the client.
  const week = sweep.slice(sweep.indexOf("async function deliverWeek("), sweep.indexOf("export async function sweepLifecycleMail("));
  assert.ok(week.indexOf(".insert({ client_domain_id: c.id") >= 0 && week.indexOf(".insert({ client_domain_id: c.id") < week.indexOf("io.send("), "This week's claim is written before the send");
  assert.match(week, /const to = await weekRecipients\(db, c\.account_id, c\.id\);/, "mailed to week-recipients.ts's list");
  const team = fs.readFileSync(new URL("./week-recipients.ts", import.meta.url), "utf8");
  assert.match(team, /\.from\("dashboard_members"\)\.select\("id, email, role"\)\.eq\("account_id", accountId\)\.in\("role", \["owner", "editor"\]\)\.is\("removed_at", null\)/, "owners and editors, live");
  assert.match(team, /sees\(scopes\.of\.get\(String\(m\.id\)\), clientId\)/, "only members who can see this client");
  assert.doesNotMatch(sweep, /^import [^;]*(?:"resend"|lifecycle-mail|"server-only")/m, "the sweep sends only through the io it is handed");
  const cronIo = fs.readFileSync(new URL("./lifecycle-cron.ts", import.meta.url), "utf8");
  // 13 Oct 2026, DIY P9: and the This week content source, read on the server through the app's own readers.
  assert.match(cronIo, /return \{ send: sendLifecycle, origin: siteUrl\(\), price: TRACKED_PRICE, thisWeek: thisWeekContent \};/, "the live io is Resend, the canonical origin, the real price and the app's readers");
  assert.match(cronIo, /sweepLifecycleMail\(supabaseAdmin\(\), lifecycleIo\(\)\)/);
  assert.match(fs.readFileSync(new URL("../checkout/signup.ts", import.meta.url), "utf8"), /return mailTrialEnding\(db, lifecycleIo\(\), clientId\);/, "trial_will_end sends with the same io");
  assert.match(deliver, /\.from\("dashboard_members"\)\.select\("email"\)\.eq\("account_id", c\.account_id\)\.eq\("role", "owner"\)\.is\("removed_at", null\)/);
  // 13 Oct 2026, DIY P9: three - the This week loop skips agency mode too, until Danny answers the agency-mode
  // email question (HANDOVER item 5).
  assert.equal(body.match(/if \(agency\.has\(c\.account_id\)\) continue;/g)?.length, 3, "every loop skips agency mode");
  const ending = sweep.slice(sweep.indexOf("export async function mailTrialEnding("));
  assert.ok(ending.indexOf('lifecycleOn(db, "trial_ending")') >= 0 && ending.indexOf('lifecycleOn(db, "trial_ending")') < ending.indexOf("deliver("), "trial_will_end asks the flag first");
  const cron = fs.readFileSync(new URL("../../app/api/cron/track/route.ts", import.meta.url), "utf8");
  assert.ok(cron.indexOf("await dispatchTrackingRuns()") < cron.indexOf("await sweepLifecycleMailSafely()"), "the sweep runs after the dispatch");
  const hook = fs.readFileSync(new URL("../../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  assert.match(hook, /trialWillEnd: \(sub\) => onTrialWillEnd\(supabaseAdmin\(\), sub\)/);
});
