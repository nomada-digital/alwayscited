import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import { trialCharge, trialMoment } from "../../config/trial.ts";
import { TIER_PLAIN } from "../tier-text.ts";
import { NO_PROMPT_NO_CHECK } from "../tracking/check-time.ts";
import { MARK_URL, NOMADA_LINE } from "./design.ts";
import {
  CUSTOMER_EMAILS,
  flagFor,
  flagOn,
  invite,
  KEPT_DAYS,
  LIFECYCLE_EMAILS,
  loginLink,
  paymentAmount,
  paymentFailed,
  planEnded,
  previews,
  previewSets,
  setupConfirmed,
  setupReminder,
  trialTerms,
  welcome,
} from "./lifecycle.ts";

/**
 * R159 (1 Oct 2026), rebuilt from the approved designs on 18 Oct 2026 (brief
 * item 2e): the customer emails' shared rules, on the preview fixtures.
 * Nothing is sent.
 */

/**
 * A made-up price, so these tests check that the charge is worded by
 * trialCharge and never hold a second copy of TRACKED_PRICE (pricing.ts is
 * not loadable here; the preview page passes the real one).
 */
const PRICE = { us: 101, uk: 77 };
const all = previews(PRICE);
const sets = previewSets(PRICE);
/** Every case of every email, as the preview page draws them. */
const every = Object.entries(sets).flatMap(([name, list]) => list.map((p) => [`${name} (${p.label})`, p.mail, name] as const));
// 19 Oct 2026: Plan's Billing, where Open billing is, not Settings' plan card that only links on to it.
const PLAN = "https://dashboards.alwayscited.com/tallyroo-com/plan#billing";

/**
 * Ten flags until 18 Oct 2026, when payment_failed joined (brief 2e, #11).
 * Twelve emails: the login link (#1) has no flag - it is how anyone signs in.
 */
test("every customer email has a template and a preview, and each flagged one's flag is email_<name>_enabled", () => {
  assert.deepEqual(Object.keys(all).sort(), [...CUSTOMER_EMAILS].sort());
  assert.deepEqual(Object.keys(sets).sort(), [...CUSTOMER_EMAILS].sort());
  assert.equal(CUSTOMER_EMAILS.length, 12);
  assert.equal(LIFECYCLE_EMAILS.length, 11);
  assert.deepEqual([...CUSTOMER_EMAILS].filter((n) => !(LIFECYCLE_EMAILS as readonly string[]).includes(n)), ["login_link"]);
  for (const n of LIFECYCLE_EMAILS) assert.match(flagFor(n), /^email_[a-z_]+_enabled$/);
  assert.equal(flagFor("payment_failed"), "email_payment_failed_enabled");
  for (const n of CUSTOMER_EMAILS) {
    assert.ok(sets[n].length >= 1, `${n} has no preview`);
    assert.equal(new Set(sets[n].map((p) => p.label)).size, sets[n].length, `${n}: two previews share a label`);
  }
  assert.ok(every.length >= 32, `only ${every.length} preview cases: the sweep below is reading too few`);
});

/**
 * "One button, the help block (Book a call, email us), the company line"
 * until 18 Oct 2026: the approved designs have one button, and a footer with
 * Help and our address; the nomada digital line on every email but a
 * client-facing one; and Email settings on every email but #1 and #11.
 */
test("each has one button, the footer's Help and our address, and the hosted mark - in HTML and plain text", () => {
  for (const [name, m] of every) {
    assert.equal(m.html.match(/<td bgcolor=/g)?.length, 1, `${name}: one button`);
    assert.ok(m.html.includes(`src="${MARK_URL}"`), `${name}: the wordmark's hosted PNG`);
    assert.doesNotMatch(m.html, /<svg|image\/svg/, `${name}: no SVG - Gmail and Outlook block it`);
    for (const part of [m.html, m.text]) {
      assert.ok(part.includes(CONTACT_EMAIL), `${name}: our address`);
      assert.match(part, /Help/, `${name}: help`);
    }
    assert.ok(m.subject.length > 0 && m.subject.length < 90, `${name}: subject`);
  }
});

test("Email settings on every email but the login link and payment failed", () => {
  for (const [label, m, name] of every) {
    const has = /Email settings/.test(m.text) && /settings#email/.test(m.html);
    assert.equal(has, name !== "login_link" && name !== "payment_failed", label);
  }
});

test("the nomada digital line on every email but a client-facing one; the invite carries the agency's name under the wordmark", () => {
  for (const [label, m, name] of every) {
    const has = m.text.includes(COMPANY_LINE) && m.html.includes(COMPANY_LINE) && m.text.includes(NOMADA_LINE);
    assert.equal(has, name !== "invite", label);
  }
  const agency = sets.invite.find((p) => /agency/.test(p.label))!.mail;
  assert.match(agency.html, />for Northline Digital<\/div>/);
  assert.match(agency.text, /^alwayscited for Northline Digital$/m);
  assert.equal(agency.subject, "sam@northline.example from Northline Digital shared the Tallyroo dashboard with you");
  // Client-facing: no tier, no upsell, no nomada digital.
  for (const p of sets.invite) {
    assert.doesNotMatch(p.mail.text + p.mail.html, /nomada digital|alwaystracked|alwaysmentioned|alwayseverywhere|the alwayscited plan/i, p.label);
  }
});

test("the brand is lowercase and tiers are TIER_PLAIN, never a capitalised form - nor set in capitals by CSS", () => {
  for (const [name, m] of every) {
    for (const part of [m.subject, m.html, m.text]) {
      assert.doesNotMatch(part, /AlwaysCited|Alwayscited|ALWAYS|always cited|Always(tracked|mentioned|everywhere)/, name);
      assert.doesNotMatch(part, /tier-name__accent|--brand-purple/, `${name}: no tier colouring in mail`);
    }
    for (const p of m.html.match(/<p [^>]*text-transform:uppercase[^>]*>[^<]*<\/p>/g) ?? []) assert.doesNotMatch(p, /always/i, `${name}: a capitalised label names the brand: ${p}`);
  }
  assert.ok(all.welcome.text.includes(TIER_PLAIN.cited));
  assert.ok(all.plan_ended.subject.includes(TIER_PLAIN.cited));
});

test("what the buyer typed is escaped in the HTML, and the plain text is as typed", () => {
  const m = welcome({ tier: "mentioned", clusters: 1, clusterLimit: 10, domain: `a<b>&"c.com`, link: "https://alwayscited.com/auth?token=x&y=1" });
  assert.ok(!m.html.includes("a<b>"), "domain escaped");
  assert.ok(m.html.includes("a&lt;b&gt;&amp;&quot;c.com"));
  assert.ok(m.html.includes('href="https://alwayscited.com/auth?token=x&amp;y=1"'));
  assert.ok(m.text.includes(`a<b>&"c.com`), "plain text is as typed");
  assert.match(m.text, /1 cluster/);
});

test("every email has a plain-text version that carries its headline, its button link and its footer", () => {
  for (const [name, m] of every) {
    const h1 = /<h1[^>]*>([^<]*)<\/h1>/.exec(m.html)?.[1];
    assert.ok(h1, `${name}: a headline`);
    const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    assert.ok(m.text.includes(unescape(h1!)), `${name}: the plain text has the headline`);
    const href = /<td bgcolor=[^>]*><a href="([^"]+)"/.exec(m.html)?.[1];
    assert.ok(href && m.text.includes(unescape(href)), `${name}: the plain text has the button's link`);
    assert.doesNotMatch(m.text, /<[a-z][^>]*>/i, `${name}: no markup in the plain text`);
    assert.match(m.text, /^--$/m, `${name}: the footer`);
  }
});

test("#3 welcome and #12 plan ended are from Danny, with his sign-off; nothing else is", () => {
  for (const [label, m, name] of every) {
    const danny = name === "welcome" || name === "plan_ended";
    assert.equal(m.sender === "danny", danny, label);
    assert.equal(/Danny Sullivan/.test(m.text), danny, `${label}: the sign-off`);
  }
  // trial_started is rendered by welcome() with a trial, and is not from Danny.
  for (const p of sets.trial_started) assert.notEqual(p.mail.sender, "danny", p.label);
});

test("activation-16: the alwaystracked welcome states the plan's 10 clusters, and on the trial never says bought", () => {
  const base = { tier: "tracked" as const, clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x" };
  const paid = welcome(base);
  assert.match(paid.text, /tracks up to 10 clusters/);
  assert.doesNotMatch(paid.text, /with 1 cluster/);
  const trial = welcome({ ...base, trial: { ends: "22 Oct 2026, 3:30pm ET", charge: "$101 a month", billing: "https://example.com/b#plan" } });
  assert.match(trial.text, /10 clusters/);
  assert.equal(trial.subject, "Your 14 days start now");
  assert.match(trial.text, /trial/);
  assert.doesNotMatch(trial.text, /\bbought\b/i);
  assert.doesNotMatch(trial.text, /with 1 cluster/);
});

test("activation-16: the setup reminder says what the runner does - prompts are read whether or not setup is confirmed", () => {
  const some = setupReminder({ tier: "tracked", domain: "example.com", link: "https://example.com/s", withPrompts: 1, clusterLimit: 10 });
  assert.match(some.text, /are being checked, but 9 of your 10 clusters are still empty/);
  assert.doesNotMatch(some.text + some.html + some.subject, /Nothing is checked|Nothing's running|waiting on one thing/);
  const none = setupReminder({ tier: "tracked", domain: "example.com", link: "https://example.com/s", withPrompts: 0, clusterLimit: 10 });
  assert.match(none.text, /Nothing is checked until your first cluster has prompts/);
  assert.equal(none.subject, "Your first reading is waiting on one thing");
  assert.equal(sets.setup_reminder.length, 2, "both cases are drawn for approval");
  // The steps table only with a status read; hidden without one.
  assert.doesNotMatch(some.text, /Target page/);
  assert.match(sets.setup_reminder[0]!.mail.text, /Target page \[Missing\]/);
});

/**
 * copy-2 (9 Oct 2026) and the review of 3eaa592: setup_confirmed's subject
 * and the line under its heading, on each branch. The time is the client's
 * zone's on the day; a "first" check is promised only while it is still to
 * come; and a client with no live prompt - the runner skips it - is promised
 * no check at all, in the Overview's words. 18 Oct 2026 (brief 2e): the
 * subject is the design's "Set. Your first reading lands <when>." while a
 * first check is to come; the heading "You're set. Here's exactly what we'll
 * check." - or, with no prompt, what is left to do.
 */
test("copy-2: setup_confirmed says when checks run in the client's zone, and promises none the runner will not make", () => {
  const base = { tier: "tracked" as const, clusters: ["invoicing software"], link: "https://example.com/app" };
  const SET = "You're set. Here's exactly what we'll check.";
  const cases = [
    { why: "US, started tomorrow", d: { market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 5 }, subject: "Set. Your first reading lands tomorrow at 1:00am ET.", head: SET, line: "The first check runs tomorrow at 1:00am ET." },
    { why: "UK, the day after the clocks go back", d: { market: "UK", today: "2026-10-26", startedOn: "2026-10-27", livePrompts: 5 }, subject: "Set. Your first reading lands tomorrow at 05:00 UK time.", head: SET, line: "The first check runs tomorrow at 05:00 UK time." },
    // "Checks run every day at 06:00 UK time." until 12 Oct 2026 (email review L2): wrong from 25 Oct. The next run only.
    { why: "UK, checks began before the confirm", d: { market: "UK", today: "2026-10-12", startedOn: "2026-10-10", livePrompts: 5 }, subject: SET, head: SET, line: "Checks run every day. The next one runs tomorrow at 06:00 UK time." },
    { why: "US, no prompts, started tomorrow", d: { market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 0 }, subject: "Add prompts to start your checks", head: "Add prompts to start your checks", line: NO_PROMPT_NO_CHECK },
    { why: "US, no prompts, started yesterday", d: { market: "US", today: "2026-10-09", startedOn: "2026-10-08", livePrompts: 0 }, subject: "Add prompts to start your checks", head: "Add prompts to start your checks", line: NO_PROMPT_NO_CHECK },
    // Email review H3 (12 Oct 2026): the confirm's moment, 21:30 ET on 9 Oct - 10 Oct in London.
    { why: "US, confirmed at 21:30 ET, started the day after London's", d: { market: "US", today: "2026-10-10", startedOn: "2026-10-11", livePrompts: 5, now: Date.parse("2026-10-10T01:30:00Z") }, subject: "Set. Your first reading lands on 11 Oct at 1:00am ET.", head: SET, line: "The first check runs on 11 Oct at 1:00am ET." },
    { why: "US, confirmed at 21:30 ET, started on London's day", d: { market: "US", today: "2026-10-10", startedOn: "2026-10-10", livePrompts: 5, now: Date.parse("2026-10-10T01:30:00Z") }, subject: "Set. Your first reading lands tomorrow at 1:00am ET.", head: SET, line: "The first check runs tomorrow at 1:00am ET." },
  ];
  for (const c of cases) {
    const m = setupConfirmed({ ...base, ...c.d });
    assert.equal(m.subject, c.subject, c.why);
    assert.ok(m.text.includes(`${c.head}\n\n${c.line}`), `${c.why}: heading, then ${c.line}\n${m.text}`);
    assert.ok(m.html.includes(`>${c.head.replace(/'/g, "&#39;")}<`), `${c.why}: the HTML heading`);
    assert.ok(m.html.includes(c.line), `${c.why}: the HTML line`);
    if (!c.d.livePrompts) assert.doesNotMatch(m.subject + m.text + m.html, /\b(?:first check|first reading|every day)\b|\d:\d\d/, `${c.why}: no check promised`);
  }
  assert.equal(sets.setup_confirmed.length, 5, "each branch is drawn for approval");
  const evening = sets.setup_confirmed.find((p) => /next day in London/.test(p.label))!.mail;
  assert.equal(evening.subject, "Set. Your first reading lands on 11 Oct at 1:00am ET.", "the evening confirm is not told tomorrow");
  assert.ok(sets.setup_confirmed.some((p) => p.mail.text.includes(NO_PROMPT_NO_CHECK)), "the no-prompt case is one of them");
  // The lead cluster as it will be checked: keyword, other form, target page, each prompt with its angle.
  assert.match(all.setup_confirmed.text, /invoicing app for freelancers \+ invoicing apps for freelancers\n-> tallyroo\.com\/invoicing/);
  assert.match(all.setup_confirmed.text, /- alternatives to Ledgerbird for freelancers - Comparison/);
});

/**
 * activation-1 and copy-4 (8 Oct 2026): the trial's emails, on a tracked-tier
 * trial in both zones. Each running-trial email names the end moment as
 * trialMoment words it for the market, the charge as trialCharge words it,
 * and the cancel route, linked to the client's plan settings ("Settings >
 * Billing" on /app until 18 Oct 2026; the dashboards host's Settings > Plan
 * that day; Plan > Billing, where Open billing is, since 19 Oct 2026). None
 * says bought or receipt.
 */
const US_END = trialMoment("2026-10-22T19:30:00Z", "US");
const UK_END = trialMoment("2026-10-22T13:30:00Z", "UK");

test("activation-1, copy-4: trial_started, trial_midpoint and trial_ending name the end in the market's zone, the charge and the cancel route", () => {
  assert.equal(US_END, "22 Oct 2026, 3:30pm ET");
  assert.equal(UK_END, "22 Oct 2026, 14:30 UK time");
  for (const name of ["trial_started", "trial_midpoint", "trial_ending"] as const) {
    const cases = sets[name];
    const zone = (label: string) => /, (US|UK)$/.exec(label)?.[1];
    assert.deepEqual([...new Set(cases.map((c) => zone(c.label)))].sort(), ["UK", "US"], `${name}: a US and a UK case, each labelled with its zone`);
    for (const { label, mail } of cases) {
      const [end, charge] = zone(label) === "US" ? [US_END, trialCharge("US", PRICE)] : [UK_END, trialCharge("UK", PRICE)];
      const where = `${name} (${label})`;
      assert.ok(mail.text.includes(end), `${where}: names ${end}`);
      assert.ok(mail.text.includes(charge), `${where}: names ${charge}`);
      assert.match(mail.text, new RegExp(`cancel[^\\n]*Plan > Billing \\(${PLAN.replace(/[.#/]/g, "\\$&")}\\)`, "i"), `${where}: the cancel route, linked`);
      assert.ok(mail.html.includes(`<a href="${PLAN}" style="color:#0f1115;font-weight:600">Plan &gt; Billing</a>`), `${where}: the link in the HTML`);
      assert.doesNotMatch(mail.subject + mail.text, /You bought|\bbought\b|receipt/i, where);
    }
  }
  assert.equal(sets.trial_ending[0]!.mail.subject, "Your trial ends on 22 Oct");
  assert.match(sets.trial_ending[0]!.mail.text, /To keep tracking, there is nothing to do\./);
  assert.match(sets.trial_midpoint[0]!.mail.text, /named in 7 of 60 AI answers\. The other brand named most often: Xero, in 31 answers\./);
  assert.match(sets.trial_midpoint[0]!.mail.text, /You are using 2 of your 10 clusters\./);
  assert.match(sets.trial_midpoint[1]!.mail.text, /Nothing has been checked yet: no cluster has prompts\./);
  const t = trialTerms({ endsAt: "2026-10-22T19:30:00Z", market: "US", price: PRICE, billing: PLAN });
  assert.equal(t.date, "22 Oct 2026");
  assert.equal(t.day, "22 Oct");
});

/** Review of 7e133a7 (8 Oct 2026): every recap body each trial email can take is drawn, and each preview takes exactly one. */
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

/** Email review H2 (12 Oct 2026): no plan_ended promises a receipt. */
test("H2: no plan_ended promises a receipt", () => {
  for (const p of sets.plan_ended) assert.doesNotMatch(p.mail.subject + p.mail.text + p.mail.html, /receipt/i, p.label);
  for (const tier of ["tracked", "mentioned", "cited", "everywhere"] as const) {
    assert.doesNotMatch(planEnded({ tier, domain: "example.com", billing: "https://example.com/b" }).text, /receipt/i, tier);
  }
});

/**
 * Email review L4 (12 Oct 2026): "the pages that were cited instead" said the
 * client was passed over, which it may not have been. 18 Oct 2026: the
 * design's "Named instead" table says the same of brands, so it is "Other
 * brands named".
 */
test("L4: first_reading does not say anything was cited or named instead of the client", () => {
  for (const p of sets.first_reading) assert.doesNotMatch(p.mail.text + p.mail.html, /instead/, p.label);
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

/**
 * copy-4 (8 Oct 2026): the ended trial says it was not charged and that there
 * is no second trial; the paid one sends the owner to ask us - a new order
 * cannot bring an ended client back (cbdffad). 19 Oct 2026: asking is a reply
 * to the email, and the button opens the plan - its Ask us was /app's. 18 Oct 2026 (Danny): readings
 * are kept for 90 days after a plan ends, and both say so - never "kept" with
 * no end, and never "indefinitely".
 */
test("copy-4: plan_ended - the trial not charged, no second trial; the paid one asks us; both keep the history 90 days", () => {
  assert.equal(KEPT_DAYS, 90);
  const trial = planEnded({ tier: "tracked", domain: "example.com", billing: "https://example.com/b", trial: true });
  assert.match(trial.text, /You were not charged/);
  assert.match(trial.text, /no second free trial/);
  assert.doesNotMatch(trial.subject + trial.text, /receipt|pick the plan again|You bought/i);
  const paid = planEnded({ tier: "cited", domain: "example.com", billing: "https://example.com/b", endedOn: "1 Nov 2026" });
  assert.equal(paid.subject, "Your alwayscited plan has ended");
  assert.match(paid.text, /ended on 1 Nov 2026/);
  assert.doesNotMatch(paid.text, /pick the plan again|picks up where it stopped/);
  for (const m of [trial, paid]) {
    assert.match(m.html, />See your plan &rarr;<\/a>/);
    assert.match(m.text, /reply to this email/i);
    assert.match(m.text, /stay in your account for 90 days/);
    assert.doesNotMatch(m.text + m.html, /indefinitely|for ever|forever|still in your account\./i);
  }
  assert.ok(sets.plan_ended.some((p) => /trial/.test(p.label)), "the trial case is drawn for approval");
});

test("the welcome carries the sign-in link on its one button", () => {
  const m = all.welcome;
  assert.equal(m.subject, "You're on alwayscited. Here's the next 30 days.");
  assert.match(m.html, />Set up your cluster &rarr;<\/a>/);
  assert.match(m.html, /\/auth\?token=preview-only/);
  // The alwayscited plan's monthly deliverables, as tiles.
  assert.match(m.text, /^3 placements a month$/m);
  assert.match(m.text, /^2\+ link insertions a month$/m);
  assert.match(m.text, /^Schema on your target page$/m);
});

test("#1 the login link: the link on its button, no Email settings, from the team", () => {
  const m = loginLink({ link: "https://dashboards.alwayscited.com/auth?token=abc" });
  assert.equal(m.subject, "Your alwayscited login link");
  assert.match(m.text, /Open the dashboard: https:\/\/dashboards\.alwayscited\.com\/auth\?token=abc/);
  assert.match(m.text, /works once and expires in 15 minutes/);
  assert.doesNotMatch(m.text, /Email settings/);
  assert.equal(m.sender, undefined);
});

test("#11 payment failed: the amount, the day, the retry, the invoice page; no settings link; nothing promised that is not read", () => {
  const m = paymentFailed({ domain: "example.com", amount: "$129", failedOn: "21 Oct 2026", retryOn: "24 Oct 2026", invoice: "https://invoice.stripe.com/i/x", plan: PLAN });
  assert.equal(m.subject, "Your payment didn't go through");
  assert.match(m.text, /We couldn't take \$129 for example\.com on 21 Oct 2026\. Nothing has stopped\. Daily checks keep running, and the card is tried again on 24 Oct 2026\./);
  assert.match(m.text, /View the invoice \(https:\/\/invoice\.stripe\.com\/i\/x\)/);
  assert.match(m.text, new RegExp(`Update payment details: ${PLAN.replace(/[.#/]/g, "\\$&")}`));
  const bare = paymentFailed({ domain: "example.com", amount: null, failedOn: "21 Oct 2026", retryOn: null, invoice: null, plan: PLAN });
  assert.match(bare.text, /We couldn't take your payment for example\.com on 21 Oct 2026\. Nothing has stopped\. Daily checks keep running\./);
  assert.doesNotMatch(bare.text + bare.html, /tried again|View the invoice/);
  assert.equal(paymentAmount(12900, "usd"), "$129");
  assert.equal(paymentAmount(11880, "gbp"), "£118.80");
  assert.equal(paymentAmount(5000, "sek"), "50 SEK");
  for (const bad of [0, -5, Number.NaN, "129", null]) assert.equal(paymentAmount(bad, "usd"), null, String(bad));
});

test("the invite names who shared it and the role, and says when it is every client", () => {
  const one = invite({ domain: "tallyroo.com", brand: "Tallyroo", link: "https://d/x", inviter: "sam@tallyroo.com", role: "viewer" });
  assert.equal(one.subject, "sam@tallyroo.com shared the Tallyroo dashboard with you");
  assert.match(one.text, /sam@tallyroo\.com gave you access to the AI visibility dashboard for Tallyroo, as a viewer\./);
  assert.doesNotMatch(one.text, /other client|more/, "the one-client invite does not say there are others");
  // AG-1 (9 Oct 2026): an invite to every client on an account with three.
  const every3 = sets.invite.find((p) => /every client/.test(p.label))!.mail;
  assert.equal(every3.subject, "sam@tallyroo.com shared the Tallyroo dashboard and 2 more with you");
  assert.match(every3.text, /gave you access to the dashboards for Tallyroo and the 2 other clients on their account, as an editor\./);
  // No login token in an invite: the invitee signs in the normal way.
  for (const p of sets.invite) assert.doesNotMatch(p.mail.text, /token=/, p.label);
});

test("the templates do not send: no mail client, network, environment or flag write in the module", async () => {
  // lifecycle-schedule.ts joined 8 Oct 2026, this-week-mail.ts 13 Oct 2026; design.ts and merge.ts 18 Oct 2026 (brief 2e).
  for (const file of ["./lifecycle.ts", "./lifecycle-schedule.ts", "./this-week-mail.ts", "./design.ts", "./merge.ts"]) {
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
  assert.match(signup, /lifecycleOn\(db, "plan_ended"\)[\s\S]{0,1200}sendLifecycle\(\{ memberEmail: m\.email as string, mail \}\)/);
  assert.match(signup, /: await sendLoginLink\(\{ memberEmail: o\.email, link \}\)/, "the login link stays the default while welcome is off");
  // The invite (#8): the designed one with its flag on, in every mode since 18 Oct 2026 (brief 2e) - client-facing,
  // no tier - else the plain inviteMail as before. 9 Oct 2026 (AG-1): both take everyClient.
  const member = read("../../app/api/app/[client]/member/route.ts");
  assert.match(member, /\(await lifecycleOn\(db, "invite"\)\)\s*\? inviteEmail\([\s\S]{0,400}: inviteMail\(\{ inviter: email, domain: client\.domain, role: f\.role!, agency, everyClient \}\)/);
  // #11 payment_failed (18 Oct 2026): its flag before any read, its claim before the send.
  const pay = read("./payment-failed-mail.ts");
  const at = (s: string) => pay.indexOf(s);
  assert.ok(at('lifecycleOn(db, "payment_failed")') >= 0 && at('lifecycleOn(db, "payment_failed")') < at('.from("client_domains")'), "payment_failed asks its flag first");
  assert.ok(at(".insert({ client_domain_id: clientId") >= 0 && at(".insert({ client_domain_id: clientId") < at("sendLifecycle("), "the claim is written before the send");
  assert.match(pay, /\.eq\("role", "owner"\)\.is\("removed_at", null\)/, "live owners only");
  assert.match(pay, /=== "agency"\) return;/, "never in agency mode");
  const events = read("../checkout/subscription-events.ts");
  assert.match(events, /if \(ok && wrote && client\.exact && mailFailed\) await mailFailed\(db, client\.id, invoice, at\);/, "only after this invoice wrote the past-due state to an exact client");
  const hook = read("../../app/api/stripe/webhook/route.ts");
  assert.match(hook, /paymentFailed: \(invoice, at\) => onInvoicePaymentFailed\(supabaseAdmin\(\), invoice, at, mailPaymentFailed\)/);
});

test("first_reading: flag first, the client's only finished run, no agency, the Overview's own figures", () => {
  const runner = fs.readFileSync(new URL("../tracking/runner.ts", import.meta.url), "utf8");
  const body = runner.slice(runner.indexOf("async function mailFirstReading"));
  assert.ok(body.length > 200, "mailFirstReading is gone from runner.ts");
  const at = (s: string) => body.indexOf(s);
  assert.ok(at('lifecycleOn(db, "first_reading")') >= 0 && at('lifecycleOn(db, "first_reading")') < at("sendLifecycle("), "the flag is asked before the send");
  assert.ok(at("if (count !== 1) return;") >= 0 && at("if (count !== 1) return;") < at("sendLifecycle("), "only on the client's first finished run");
  assert.ok(at('=== "agency") return;') >= 0 && at('=== "agency") return;') < at("sendLifecycle("), "never in agency mode");
  // 18 Oct 2026 (brief 2e): the merge read comes after the flag, so nothing is read while it is off.
  assert.ok(at("clientMail(") > at('lifecycleOn(db, "first_reading")'), "the dashboard rows are read only with the flag on");
  assert.match(body, /upsell: upsellAllowed\(\{ tier, mode: upsellMode\(account\.upsell_mode\), clientFacing: false \}\)/, "the upsell line is gated on the tier and the account's mode");
  assert.match(runner, /const all = kept \? dayRows\(kept, written, serpRows\) : \{ answers: answerRows, serp: serpRows \};/);
  assert.match(runner, /named: namedRate\(all\.answers, range\),\s*page1: keywordsOnPage1\(all\.serp, range, keywords\.length\)/);
  assert.match(runner, /if \(status !== "failed" && !rerun\?\.landed\) \{/);
});

test("the upsell line is in first_reading only, and only where it was allowed", () => {
  for (const [label, m, name] of every) {
    const has = /Getting into them is/.test(m.text);
    if (name !== "first_reading") assert.equal(has, false, `${label}: an upsell outside #6`);
  }
  assert.match(sets.first_reading.find((p) => /upsell on/.test(p.label))!.mail.text, /Getting into them is alwaysmentioned \(https:\/\/alwayscited\.com\/alwaysmentioned\), one cluster at a time\./);
  assert.doesNotMatch(sets.first_reading.find((p) => /no upsell/.test(p.label))!.mail.text, /Getting into them is/);
});

/**
 * 8 Oct 2026 (audit activation-1): the cron's sends - trial_midpoint,
 * trial_ending, setup_reminder - and Stripe's trial_will_end, read off the
 * source the way first_reading is above.
 */
test("the lifecycle sweep: flags first, claim before send, live owners, no agency, after the dispatch", () => {
  const sweep = fs.readFileSync(new URL("./lifecycle-sweep.ts", import.meta.url), "utf8");
  const body = sweep.slice(sweep.indexOf("export async function sweepLifecycleMail("));
  assert.ok(body.length > 500, "sweepLifecycleMail is gone from lifecycle-sweep.ts");
  const flags = ["trial_midpoint", "trial_ending", "setup_reminder", "this_week"].map((n) => body.indexOf(`lifecycleOn(db, "${n}")`));
  for (const at of flags) assert.ok(at >= 0 && at < body.indexOf('.from("client_domains")') && at < body.indexOf("sweepThisWeek(db"), "a flag is asked before the first read");
  assert.match(body, /if \(!on\.trial_midpoint && !on\.trial_ending && !on\.setup_reminder && !on\.this_week\) return out;/);
  assert.match(body, /if \(on\.this_week\) \{\s*try \{\s*await sweepThisWeek\(db, io, now, out\);/, "This week goes only with its own flag on, and its failure is its own");
  assert.match(body, /if \(!on\.trial_midpoint && !on\.trial_ending && !on\.setup_reminder\) return out;/);
  assert.match(body, /if \(!due \|\| !on\[due\]\) continue;/, "a trial email goes only with its own flag on");
  const deliver = sweep.slice(sweep.indexOf("async function deliver("), sweep.indexOf("export async function sweepLifecycleMail("));
  const claimAt = deliver.indexOf(".insert({ client_domain_id: c.id");
  assert.ok(claimAt >= 0 && claimAt < deliver.indexOf("io.send("), "the claim is written before the send");
  const week = sweep.slice(sweep.indexOf("async function deliverWeek("), sweep.indexOf("export async function sweepLifecycleMail("));
  assert.ok(week.indexOf(".insert({ client_domain_id: c.id") >= 0 && week.indexOf(".insert({ client_domain_id: c.id") < week.indexOf("io.send("), "This week's claim is written before the send");
  assert.match(week, /const to = await weekRecipients\(db, c\.account_id, c\.id\);/, "mailed to week-recipients.ts's list");
  const team = fs.readFileSync(new URL("./week-recipients.ts", import.meta.url), "utf8");
  assert.match(team, /\.from\("dashboard_members"\)\.select\("id, email, role"\)\.eq\("account_id", accountId\)\.in\("role", \["owner", "editor"\]\)\.is\("removed_at", null\)/, "owners and editors, live");
  assert.match(team, /sees\(scopes\.of\.get\(String\(m\.id\)\), clientId\) && !out\.has\(String\(m\.id\)\)/, "only members who can see this client and have not switched it off");
  assert.doesNotMatch(sweep, /^import [^;]*(?:"resend"|lifecycle-mail|"server-only")/m, "the sweep sends only through the io it is handed");
  const cronIo = fs.readFileSync(new URL("./lifecycle-cron.ts", import.meta.url), "utf8");
  // 18 Oct 2026 (brief 2e): links on the dashboards host, the dashboard's rows for the figures, and #7's signed
  // unsubscribe link. siteUrl() until then.
  assert.match(cronIo, /return \{ send: sendLifecycle, origin: dashOrigin\(\), price: TRACKED_PRICE, thisWeek: thisWeekContent, client: \(id\) => clientMail\(id\), unsubscribe: unsubscribeFor \};/, "the live io");
  assert.match(cronIo, /sweepLifecycleMail\(supabaseAdmin\(\), lifecycleIo\(\)\)/);
  assert.match(fs.readFileSync(new URL("../checkout/signup.ts", import.meta.url), "utf8"), /return mailTrialEnding\(db, lifecycleIo\(\), clientId\);/, "trial_will_end sends with the same io");
  assert.match(deliver, /\.from\("dashboard_members"\)\.select\("email"\)\.eq\("account_id", c\.account_id\)\.eq\("role", "owner"\)\.is\("removed_at", null\)/);
  assert.equal(body.match(/if \(agency\.has\(c\.account_id\)\) continue;/g)?.length, 3, "every loop skips agency mode");
  const ending = sweep.slice(sweep.indexOf("export async function mailTrialEnding("));
  assert.ok(ending.indexOf('lifecycleOn(db, "trial_ending")') >= 0 && ending.indexOf('lifecycleOn(db, "trial_ending")') < ending.indexOf("deliver("), "trial_will_end asks the flag first");
  const cron = fs.readFileSync(new URL("../../app/api/cron/track/route.ts", import.meta.url), "utf8");
  assert.ok(cron.indexOf("await dispatchTrackingRuns()") < cron.indexOf("await sweepLifecycleMailSafely()"), "the sweep runs after the dispatch");
  const hook = fs.readFileSync(new URL("../../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  assert.match(hook, /trialWillEnd: \(sub\) => onTrialWillEnd\(supabaseAdmin\(\), sub\)/);
});

/** 18 Oct 2026 (brief 2e): every link is on the dashboards host, built from the origin the send site passes. */
test("links: the dashboard, setup, plan and email settings on the origin passed in", () => {
  for (const [label, m, name] of every) {
    if (name === "first_reading" && /upsell/.test(label)) continue;
    const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]!.replace(/&amp;/g, "&"));
    for (const h of hrefs) {
      assert.ok(h.startsWith("https://dashboards.alwayscited.com/") || h === "https://alwayscited.com/help" || h.startsWith("https://invoice.stripe.com/"), `${label}: ${h}`);
    }
  }
});
