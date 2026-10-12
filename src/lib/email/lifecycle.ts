import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import { NEXT_STEPS, nextSteps } from "../../config/onboarding.ts";
import { T } from "../../config/tokens.ts";
import { TRIAL, trialCharge, trialMoment } from "../../config/trial.ts";
import { appUrl } from "../app-host.ts";
import { count } from "../plural.ts";
import { escapeHtml, shell, type Palette } from "../scan/email-render.ts";
import { TIER_PLAIN, type TierKey } from "../tier-text.ts";
import { checkTime } from "../tracking/check-time.ts";
import { PROMPTS_PER_CLUSTER } from "../tracking/limits.ts";
import { firstAsked, setupChecks } from "../tracking/setup-landing.ts";

/**
 * The lifecycle emails (R159, Danny, 1 Oct 2026, danny.md lines 159-167), as
 * templates only. Each renders a subject, HTML and plain text from its data.
 * Pure, so the preview page and the tests render them with fixture data and
 * nothing is sent. Nothing here sends: each send site, when wired, checks its
 * own app_settings flag, email_<name>_enabled, which stays false until Danny
 * approves that preview.
 *
 * The rules every template keeps, tested in lifecycle.test.mts: the brand in
 * lowercase; the tier as TIER_PLAIN (no colour in mail); one button; the help
 * block (book a call, email us); the company line in the footer. Receipts,
 * VAT invoices and failed payments are Stripe's, so none of them is here.
 *
 * The trial's three (8 Oct 2026, audit activation-1, copy-4): trial_started
 * is the welcome for an order on the alwaystracked free trial, sent at signup
 * in its place; trial_midpoint and trial_ending go from the daily cron
 * (lifecycle-sweep.ts), picked by lifecycle-schedule.ts. Each names the moment
 * the trial ends in the client's zone (trialMoment), what is charged then
 * (trialCharge) and where to cancel. Each has its own flag, off.
 */

export const LIFECYCLE_EMAILS = [
  "welcome",
  "trial_started",
  "setup_reminder",
  "setup_confirmed",
  "first_reading",
  "trial_midpoint",
  "trial_ending",
  "invite",
  "plan_ended",
] as const;
export type LifecycleEmail = (typeof LIFECYCLE_EMAILS)[number];

/** The app_settings key that turns one on. Default false; only Danny turns one on. */
export const flagFor = (name: LifecycleEmail) => `email_${name}_enabled`;

/** On only for a jsonb true: a missing row, a string or anything else is off. */
export const flagOn = (value: unknown) => value === true;

export type Rendered = { subject: string; html: string; text: string };

const ORIGIN = "https://alwayscited.com";

const P: Palette = { ground: T.bg, card: T.surface, ink: T.ink, body: "#3d4451", quiet: T.soft, line: T.line, accent: T.accent, onAccent: T.surface };
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";

/** Book a call goes to /contact with the tier prefilled, as contactUrlFor builds it. */
const callUrl = (tier: TierKey) => `${ORIGIN}/contact?tier=${encodeURIComponent(TIER_PLAIN[tier])}`;

/** A client's dashboard, its setup page, and its Billing section, where an owner cancels a trial or asks us to restart. */
export const dashboardUrl = (slug: string, origin: string) => appUrl(`/${slug}`, origin);
export const setupUrl = (slug: string, origin: string) => appUrl(`/${slug}/setup`, origin);
export const billingUrl = (slug: string, origin: string) => `${appUrl(`/${slug}/settings`, origin)}#set-billing`;

/**
 * A running trial's terms, as every trial email states them: when it ends in
 * the client's own zone, what is charged then, and the Billing link to cancel.
 * Worked out here from config/trial.ts, so no send site words a date or a price itself.
 */
export type TrialTerms = { ends: string; charge: string; billing: string };

export function trialTerms(p: { endsAt: string; market: string; price: { us: number; uk: number }; billing: string }): TrialTerms {
  return { ends: trialMoment(p.endsAt, p.market), charge: trialCharge(p.market, p.price), billing: p.billing };
}

function help(tier: TierKey): { html: string; text: string[] } {
  const call = callUrl(tier);
  return {
    html:
      `Need a hand? <a href="${escapeHtml(call)}" style="color:${P.accent};">Book a call</a> or email ` +
      `<a href="mailto:${CONTACT_EMAIL}" style="color:${P.accent};">${CONTACT_EMAIL}</a>.<br><br>` +
      `alwayscited is run by ${escapeHtml(COMPANY_LINE)}.`,
    text: ["Need a hand?", `Book a call: ${call}`, `Email us: ${CONTACT_EMAIL}`, "", `alwayscited is run by ${COMPANY_LINE}.`],
  };
}

const linkLine = (link: string) =>
  `If the button does nothing, paste this into your browser:<br><span style="color:${P.accent};word-break:break-all;">${escapeHtml(link)}</span>`;

/**
 * A body line: plain text, or text around one inline link (the trial's
 * Billing link), so the one-button rule holds. The plain text gives the
 * address in brackets.
 */
type Line = string | { text: string; link: { label: string; href: string }; after: string };

type Parts = { subject: string; preheader: string; heading: string; body: Line[]; list?: string[]; cta: { href: string; label: string }; footnote: string; tier: TierKey };

const lineHtml = (l: Line) =>
  typeof l === "string" ? escapeHtml(l) : `${escapeHtml(l.text)}<a href="${escapeHtml(l.link.href)}" style="color:${P.accent};">${escapeHtml(l.link.label)}</a>${escapeHtml(l.after)}`;
const lineText = (l: Line) => (typeof l === "string" ? l : `${l.text}${l.link.label} (${l.link.href})${l.after}`);

/** Body lines are plain text; this escapes them once for the HTML. */
function render(p: Parts): Rendered {
  const h = help(p.tier);
  const list = p.list?.length
    ? `<ol style="margin:16px 0 0;padding-left:20px;">${p.list.map((l) => `<li style="padding-bottom:6px;">${escapeHtml(l)}</li>`).join("")}</ol>`
    : "";
  const html = shell(P, FONT, {
    title: escapeHtml(p.subject),
    preheader: escapeHtml(p.preheader),
    heading: escapeHtml(p.heading),
    body: p.body.map(lineHtml).join("<br><br>") + list,
    cta: { href: p.cta.href, label: escapeHtml(p.cta.label) },
    footnote: `${escapeHtml(p.footnote)} ${linkLine(p.cta.href)}`,
    aside: h.html,
  });
  const text = [
    p.heading,
    "",
    ...p.body.flatMap((b) => [lineText(b), ""]),
    ...(p.list?.length ? [...p.list.map((l, i) => `${i + 1}. ${l}`), ""] : []),
    `${p.cta.label}: ${p.cta.href}`,
    p.footnote,
    "",
    ...h.text,
  ].join("\n");
  return { subject: p.subject, html, text };
}

/** The 3-step strip, what happens after the welcome; shared with the pages that sell. */
export { NEXT_STEPS };

const SIGN_IN_ONCE = "The button signs you in. It works once, for 15 minutes; after that, sign in asks for a new link.";
/** The cron's and the webhook's later emails carry no login token: signed out, the reader asks for a link at sign in. */
const SIGN_IN_ASKS = "If you are signed out, sign in with this email address and we send you a one-time link.";

/** "... in Settings > Billing ...", the trial's one way out, linked to the client's Billing. */
const cancelLine = (t: TrialTerms, text: string, after: string): Line => ({ text, link: { label: "Settings > Billing", href: t.billing }, after });

/**
 * The welcome, sent at signup in place of the bare login link once its flag
 * is on. Three cases (8 Oct 2026, audit activation-16, copy-4):
 *
 * - an alwaystracked order on the free trial gets trial_started's version:
 *   the trial, when it ends and what is charged then, and where to cancel.
 *   Never "bought" - nothing was;
 * - a paid alwaystracked order states the plan's room, `clusterLimit` (10),
 *   not the one cluster signup makes - "with 1 cluster" read as the whole plan;
 * - a placements order keeps the clusters it bought.
 *
 * The strip it lists says the daily check's time in the client's zone when
 * signup passes the market and start (ON-3, 9 Oct 2026): checkTime on the
 * start day, the first a check can run, as signup.ts sets it. Without them,
 * the public pages' time-free words.
 */
export function welcome(d: { tier: TierKey; clusters: number; clusterLimit: number; domain: string; link: string; trial?: TrialTerms | null; market?: string | null; startedOn?: string | null }): Rendered {
  const plan = TIER_PLAIN[d.tier];
  const room = `The plan tracks up to ${count(d.clusterLimit, "cluster")}.`;
  const steps = d.market && d.startedOn ? nextSteps(checkTime(d.startedOn, d.market)) : NEXT_STEPS;
  if (d.trial) {
    return render({
      tier: d.tier,
      subject: `Your ${TRIAL.days}-day free trial of ${plan} has started`,
      preheader: `Nothing is charged until ${d.trial.ends}.`,
      heading: "Your free trial has started",
      body: [
        `You started a ${TRIAL.days}-day free trial of ${plan} for ${d.domain}. ${room}`,
        `Nothing is charged until ${d.trial.ends}. Then it is ${d.trial.charge}.`,
        cancelLine(d.trial, "To stop, cancel any time before then in ", " and nothing is charged."),
        "Here is what happens next:",
      ],
      list: [...steps],
      cta: { href: d.link, label: "Set up your clusters" },
      footnote: SIGN_IN_ONCE,
    });
  }
  const bought = d.tier === "tracked" ? `You bought ${plan} for ${d.domain}. ${room}` : `You bought ${plan} for ${d.domain}, with ${count(d.clusters, "cluster")}.`;
  return render({
    tier: d.tier,
    subject: "You're in - set up your clusters",
    preheader: `Your ${plan} dashboard for ${d.domain} is ready to set up.`,
    heading: "You're in - set up your clusters",
    body: [`${bought} Here is what happens next:`],
    list: [...steps],
    cta: { href: d.link, label: "Set up your clusters" },
    footnote: SIGN_IN_ONCE,
  });
}

/**
 * Setup reminder, from the daily cron 24 and 72 hours after signup while the
 * setup is unconfirmed (lifecycle-schedule.ts). It says what the runner does
 * (8 Oct 2026, audit activation-16): shouldTrack checks every live prompt
 * whether or not setup was confirmed, so a scan buyer's prompts are already
 * read each morning and "nothing is checked until they are set up" was false.
 * `withPrompts` is the live clusters that have a live prompt. Never sent once
 * every cluster has prompts (setupStillEmpty in lifecycle-schedule.ts), so
 * "0 of your 10 clusters" is never written.
 */
export function setupReminder(d: { tier: TierKey; domain: string; link: string; withPrompts: number; clusterLimit: number }): Rendered {
  const empty = Math.max(0, d.clusterLimit - d.withPrompts);
  const checking = d.withPrompts > 0;
  return render({
    tier: d.tier,
    subject: "Your clusters aren't set up yet",
    preheader: checking ? `${empty} of your ${count(d.clusterLimit, "cluster")} still empty.` : "Nothing is checked until your first cluster has prompts.",
    heading: "Your clusters aren't set up yet",
    body: [
      checking
        ? `The prompts for ${d.domain} are being checked, but ${empty} of your ${count(d.clusterLimit, "cluster")} ${empty === 1 ? "is" : "are"} still empty.`
        : `The dashboard for ${d.domain} is waiting on its clusters. Nothing is checked until your first cluster has prompts.`,
      `Each cluster is one keyword and up to ${PROMPTS_PER_CLUSTER} prompts.`,
    ],
    cta: { href: d.link, label: "Set up your clusters" },
    footnote: SIGN_IN_ASKS,
  });
}

/**
 * setup_confirmed, to the member who pressed Confirm. The check time is the
 * client's zone's on the day (9 Oct 2026, audit copy-2): a bare time with no zone
 * was an hour wrong from 25 Oct and a London time to a US client. What it
 * says of the checks is the setup page's line (setupChecks): a client whose
 * checks began before the confirm - the runner reads a live prompt whether
 * or not setup was confirmed - is promised no "first" check, and one with no
 * live prompt is promised no check at all (review of 3eaa592). `today` is the
 * tracking day the confirm landed on; `livePrompts` the prompts not stopped.
 *
 * `now` (12 Oct 2026, email review H3): the moment of the confirm, so the
 * first check is said from the client's own day, as the setup page says it
 * (setupChecks with now, checkOn). Without it "tomorrow" was counted from
 * London's tracking day, a day early in the subject for a US client
 * confirming between 7pm and midnight ET. setup-mail.ts passes Date.now().
 *
 * No live prompt (L1, same review): the heading was "Your clusters are set
 * up" over "Nothing is checked until a cluster has prompts". It now says
 * what is left to do.
 */
export function setupConfirmed(d: { tier: TierKey; clusters: string[]; link: string; market: string; today: string; startedOn: string | null; livePrompts: number; now?: number }): Rendered {
  const { first, line } = setupChecks({ startedOn: d.startedOn, today: d.today, market: d.market, livePrompts: d.livePrompts, ...(d.now === undefined ? {} : { now: d.now }) });
  const empty = d.livePrompts < 1;
  const head = first ? `Your first check runs ${first}` : empty ? "Add prompts to start your checks" : "Your clusters are set up";
  return render({
    tier: d.tier,
    subject: head,
    preheader: empty ? line : `${d.clusters.length === 1 ? "1 cluster" : `${d.clusters.length} clusters`} set up.`,
    heading: head,
    body: [...(first ? [] : [line]), "You chose these clusters:"],
    list: d.clusters,
    cta: { href: d.link, label: "See your dashboard" },
    footnote: empty ? "You can add a cluster's prompts from the dashboard at any time." : "You can change a cluster's prompts from the dashboard at any time.",
  });
}

export function firstReading(d: { tier: TierKey; domain: string; named: number; answers: number; page1: number; keywords: number; link: string }): Rendered {
  return render({
    tier: d.tier,
    subject: `${d.domain}: named in ${d.named} of ${d.answers} answers`,
    preheader: `${d.page1} of ${d.keywords} keywords on page 1 of Google.`,
    heading: "Your first reading is in",
    body: [`In the first check, ${d.domain} was named in ${d.named} of ${d.answers} AI answers, and ${d.page1} of ${d.keywords} keywords are on page 1 of Google.`],
    cta: { href: d.link, label: "See your dashboard" },
    // L4 (12 Oct 2026, email review): "the pages that were cited instead" said the engines cited them in place of
    // the client, which is not so where the client was named too.
    footnote: "The dashboard has every answer, and the pages the answers cited.",
  });
}

/**
 * What the trial has read so far, for trial_midpoint and trial_ending
 * (lifecycle-schedule.ts trialRecap builds it with the Overview's own
 * namedRate and brandBoard). `since` is the first check's day as the
 * dashboard prints it, null before any check finished. `clustersInUse` is
 * the live clusters, counted as Settings counts them; `livePrompts` says
 * whether there is anything to check yet.
 */
export type TrialRecap = {
  named: number;
  answers: number;
  since: string | null;
  topOther: { name: string; answers: number } | null;
  clustersInUse: number;
  clusterLimit: number;
  livePrompts: number;
  /**
   * When prompts saved at the send are first asked, as setup-landing.ts
   * firstAsked says it in the client's zone (12 Oct 2026, email review L3):
   * "the morning after one has" was a night early for a US client saving in
   * its evening. Null words no moment.
   */
  firstAsk?: string | null;
};

function recapLines(domain: string, r: TrialRecap): string[] {
  const use = `You are using ${r.clustersInUse} of your ${count(r.clusterLimit, "cluster")}.`;
  if (!r.answers || !r.since) {
    return [r.livePrompts ? `No check has finished yet. ${use}` : `Nothing has been checked yet: no cluster has prompts.${r.firstAsk ? ` Prompts you save now are first asked ${r.firstAsk}.` : ""}`];
  }
  return [
    `Since the first check on ${r.since}, ${domain} was named in ${r.named} of ${count(r.answers, "AI answer")}.` +
      (r.topOther ? ` The other brand named most often: ${r.topOther.name}, in ${count(r.topOther.answers, "answer")}.` : ""),
    use,
  ];
}

/** trial_midpoint, from the daily cron once the trial is a week in (lifecycle-schedule.ts). */
export function trialMidpoint(d: { domain: string; link: string; recap: TrialRecap; trial: TrialTerms }): Rendered {
  const plan = TIER_PLAIN.tracked;
  const read = d.recap.answers > 0 && d.recap.since !== null;
  return render({
    tier: "tracked",
    subject: `How your free trial of ${plan} is going`,
    preheader: read ? `${d.domain} named in ${d.recap.named} of ${count(d.recap.answers, "AI answer")} so far.` : `Your free trial ends ${d.trial.ends}.`,
    heading: "Your free trial so far",
    body: [
      ...recapLines(d.domain, d.recap),
      `Your free trial ends ${d.trial.ends}. Then it is ${d.trial.charge}.`,
      cancelLine(d.trial, "To stop, cancel before then in ", " and nothing is charged."),
    ],
    cta: { href: d.link, label: "See your dashboard" },
    footnote: SIGN_IN_ASKS,
  });
}

/**
 * trial_ending, three days before the end: from the daily cron, or from
 * Stripe's customer.subscription.trial_will_end when that comes first.
 * Whichever is first sends it; the other finds it sent.
 */
export function trialEnding(d: { domain: string; link: string; recap: TrialRecap; trial: TrialTerms }): Rendered {
  const plan = TIER_PLAIN.tracked;
  return render({
    tier: "tracked",
    subject: `Your free trial of ${plan} ends ${d.trial.ends}`,
    preheader: `Then it is ${d.trial.charge}. To keep tracking, there is nothing to do.`,
    heading: "Your free trial ends soon",
    body: [
      `Your free trial of ${plan} for ${d.domain} ends ${d.trial.ends}. From then it is ${d.trial.charge}, charged to the card you gave at checkout.`,
      "To keep tracking, there is nothing to do.",
      cancelLine(d.trial, "To stop, cancel before then in ", " and nothing is charged."),
      ...recapLines(d.domain, d.recap),
    ],
    cta: { href: d.link, label: "See your dashboard" },
    footnote: SIGN_IN_ASKS,
  });
}

/**
 * Names alwayscited and the tier, so the member route sends it only outside agency mode.
 * `everyClient` (AG-1, 9 Oct 2026): the account's client count when the invite is to
 * every client on an account with two or more, so the mail says they will see them all;
 * an invite to one client names that client only, as team.ts inviteMail does.
 */
export function invite(d: { tier: TierKey; domain: string; link: string; inviter: string; role: "editor" | "viewer"; everyClient?: number | null }): Rendered {
  const as = d.role === "editor" ? "an editor" : "a viewer";
  const rest = d.everyClient && d.everyClient > 1 ? d.everyClient - 1 : 0;
  const added = rest ? `You've been added to the ${d.domain} dashboard and ${rest} more` : `You've been added to the ${d.domain} dashboard`;
  return render({
    tier: d.tier,
    subject: added,
    preheader: "Sign in with this email address.",
    heading: added,
    body: [
      rest
        ? `${d.inviter} added you to the dashboards for ${d.domain} and the ${count(rest, "other client")} on their account, as ${as}. Sign in with this email address to see them.`
        : `${d.inviter} added you to the ${d.domain} dashboard as ${as}. Sign in with this email address to see it.`,
    ],
    cta: { href: d.link, label: "Sign in" },
    footnote: "Sign in sends a one-time link to this address.",
  });
}

/**
 * The plan has ended (customer.subscription.deleted; from 9 Oct 2026, BL-2,
 * also customer.subscription.updated with status canceled - both through
 * signup.ts endClient, which sends it only when its own update ended the
 * client, so once whichever lands first). Two corrections (8 Oct 2026, audit
 * copy-4):
 *
 * - a trial that ended without a charge says so, with no receipt line - there
 *   is no receipt - and says restarting is a paid plan, because noTrialLine
 *   refuses a second trial. From 12 Oct 2026 (email review H2) that includes a
 *   trial whose first charge failed and which Stripe then cancelled
 *   (lifecycle-schedule.ts firstChargeFailed);
 * - "pick the plan again; the dashboard picks up where it stopped" was false:
 *   a new order cannot bring an ended client back (cbdffad, review of
 *   2379757). As the ended banner does, the owner is sent to Billing, where
 *   Ask us is, to ask us to restart it.
 */
export function planEnded(d: { tier: TierKey; domain: string; billing: string; trial?: boolean }): Rendered {
  const plan = TIER_PLAIN[d.tier];
  if (d.trial) {
    return render({
      tier: d.tier,
      subject: `Your free trial of ${plan} has ended`,
      preheader: "You were not charged. Your history is kept.",
      heading: "Your free trial has ended",
      body: [
        `The free trial of ${plan} for ${d.domain} has ended, so no more checks run. You were not charged.`,
        "Everything read during the trial is kept. Restarting starts a paid plan; there is no second free trial. To restart, ask us from Billing in the dashboard.",
      ],
      cta: { href: d.billing, label: "Ask us to restart it" },
      footnote: SIGN_IN_ASKS,
    });
  }
  return render({
    tier: d.tier,
    subject: `Your ${plan} plan has ended`,
    preheader: "Your history is kept.",
    heading: `Your ${plan} plan has ended`,
    body: [`The ${plan} plan for ${d.domain} has ended, so no more checks run. Everything read so far is kept.`, "To restart, ask us from Billing in the dashboard."],
    cta: { href: d.billing, label: "Ask us to restart it" },
    // H2 (12 Oct 2026, email review): "Stripe sends the final receipt" until then. A plan that stops at its
    // period's end takes no payment as it ends, so there is no receipt to send.
    footnote: SIGN_IN_ASKS,
  });
}

export type Preview = { label: string; mail: Rendered };

/**
 * Fixture data for the preview page and the tests. Made-up domain; never a
 * client. Each email's first preview is the case its flag is mostly about;
 * the trial ones render a tracked-tier trial in both market zones. `price`
 * is TRACKED_PRICE, passed in because config/pricing.ts is not loadable by
 * `node --test`.
 */
export function previewSets(price: { us: number; uk: number }): Record<LifecycleEmail, Preview[]> {
  const link = appUrl("/auth?token=preview-only", ORIGIN);
  const domain = "tallyroo.com";
  const slug = "tallyroo-com";
  const dash = dashboardUrl(slug, ORIGIN);
  const billing = billingUrl(slug, ORIGIN);
  // A trial that ends at 3:30pm in New York, and one at 2:30pm in London.
  const us = trialTerms({ endsAt: "2026-10-22T19:30:00Z", market: "US", price, billing });
  const uk = trialTerms({ endsAt: "2026-10-22T13:30:00Z", market: "UK", price, billing });
  // The three recaps recapLines words (8 Oct 2026, review of 7e133a7: trial_ending drew only the
  // first, so two of its three bodies were never put in front of Danny): checks read, prompts live
  // but no check finished yet, and nothing set up.
  const recap: TrialRecap = { named: 7, answers: 60, since: "9 Oct", topOther: { name: "Xero", answers: 31 }, clustersInUse: 2, clusterLimit: 10, livePrompts: 10 };
  const waiting: TrialRecap = { named: 0, answers: 0, since: null, topOther: null, clustersInUse: 1, clusterLimit: 10, livePrompts: 5 };
  const unread: TrialRecap = { named: 0, answers: 0, since: null, topOther: null, clustersInUse: 1, clusterLimit: 10, livePrompts: 0 };
  // L3 (12 Oct 2026): the nothing-set-up recap says when prompts saved then are first asked, from the cron's run on the
  // day each email goes - a week in (15 Oct) and three days before the end (19 Oct) - for the UK client these draw.
  const unreadOn = (today: string): TrialRecap => ({ ...unread, firstAsk: firstAsked({ today, startedOn: "2026-10-09", market: "UK", now: Date.parse(`${today}T05:00:00Z`) }) });
  const setupClusters = ["invoicing software", "expense tracking", "payroll for small business"];
  return {
    // ON-3 (9 Oct 2026): signup passes the market and start, so the strip says the check's time in the client's zone.
    welcome: [
      { label: "alwaysmentioned, 3 clusters bought, US", mail: welcome({ tier: "mentioned", clusters: 3, clusterLimit: 10, domain, link, market: "US", startedOn: "2026-10-10" }) },
      { label: "alwaystracked, paid with no trial, UK", mail: welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain, link, market: "UK", startedOn: "2026-10-10" }) },
    ],
    trial_started: [
      { label: "alwaystracked free trial, US", mail: welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain, link, trial: us, market: "US", startedOn: "2026-10-10" }) },
      { label: "alwaystracked free trial, UK", mail: welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain, link, trial: uk, market: "UK", startedOn: "2026-10-10" }) },
    ],
    setup_reminder: [
      { label: "a scan buyer: 1 cluster with prompts", mail: setupReminder({ tier: "tracked", domain, link: setupUrl(slug, ORIGIN), withPrompts: 1, clusterLimit: 10 }) },
      { label: "no prompts yet", mail: setupReminder({ tier: "tracked", domain, link: setupUrl(slug, ORIGIN), withPrompts: 0, clusterLimit: 10 }) },
    ],
    // 9 Oct 2026 (audit copy-2): the check time in each market's zone, a UK one after the clocks go back, a confirm after
    // checks began, and (review of 3eaa592) a no-scan order whose clusters have no prompt yet, so no check is promised.
    // 12 Oct 2026 (email review H3): each confirm has its moment, as setup-mail.ts passes it, and a US confirm at
    // 9:30pm ET - already the next day in London - is drawn, whose first check is two nights away, not "tomorrow".
    setup_confirmed: [
      { label: "alwaysmentioned, US, confirmed the day it was bought", mail: setupConfirmed({ tier: "mentioned", clusters: setupClusters, link: appUrl("/", ORIGIN), market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 15, now: Date.parse("2026-10-09T18:00:00Z") }) },
      { label: "alwaystracked, US, confirmed late in the evening it was bought, already the next day in London", mail: setupConfirmed({ tier: "tracked", clusters: setupClusters, link: appUrl("/", ORIGIN), market: "US", today: "2026-10-10", startedOn: "2026-10-11", livePrompts: 15, now: Date.parse("2026-10-10T01:30:00Z") }) },
      { label: "alwaystracked, UK, confirmed the day it was bought", mail: setupConfirmed({ tier: "tracked", clusters: setupClusters, link: appUrl("/", ORIGIN), market: "UK", today: "2026-10-26", startedOn: "2026-10-27", livePrompts: 15, now: Date.parse("2026-10-26T12:00:00Z") }) },
      { label: "alwaystracked, UK, confirmed after checks began", mail: setupConfirmed({ tier: "tracked", clusters: setupClusters, link: appUrl("/", ORIGIN), market: "UK", today: "2026-10-12", startedOn: "2026-10-10", livePrompts: 15, now: Date.parse("2026-10-12T12:00:00Z") }) },
      { label: "alwaystracked, US, no prompts yet", mail: setupConfirmed({ tier: "tracked", clusters: ["invoicing software"], link: appUrl("/", ORIGIN), market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 0, now: Date.parse("2026-10-09T18:00:00Z") }) },
    ],
    first_reading: [{ label: "alwaystracked", mail: firstReading({ tier: "tracked", domain, named: 7, answers: 20, page1: 3, keywords: 10, link: appUrl("/", ORIGIN) }) }],
    trial_midpoint: [
      { label: "a week in, US", mail: trialMidpoint({ domain, link: dash, recap, trial: us }) },
      { label: "a week in with nothing set up, UK", mail: trialMidpoint({ domain, link: dash, recap: unreadOn("2026-10-15"), trial: uk }) },
      { label: "a week in with prompts but no check finished yet, US", mail: trialMidpoint({ domain, link: dash, recap: waiting, trial: us }) },
    ],
    trial_ending: [
      { label: "three days before the end, US", mail: trialEnding({ domain, link: dash, recap, trial: us }) },
      { label: "three days before the end, UK", mail: trialEnding({ domain, link: dash, recap, trial: uk }) },
      { label: "three days before the end with prompts but no check finished yet, US", mail: trialEnding({ domain, link: dash, recap: waiting, trial: us }) },
      { label: "three days before the end with nothing set up, UK", mail: trialEnding({ domain, link: dash, recap: unreadOn("2026-10-19"), trial: uk }) },
    ],
    invite: [
      { label: "a viewer", mail: invite({ tier: "tracked", domain, link: appUrl("/login", ORIGIN), inviter: "sam@tallyroo.com", role: "viewer" }) },
      // AG-1 (9 Oct 2026): an invite to every client on an account with three.
      { label: "an editor on every client of three", mail: invite({ tier: "tracked", domain, link: appUrl("/login", ORIGIN), inviter: "sam@tallyroo.com", role: "editor", everyClient: 3 }) },
    ],
    plan_ended: [
      { label: "the alwayscited plan, paid", mail: planEnded({ tier: "cited", domain, billing }) },
      { label: "an alwaystracked trial that ended with no charge", mail: planEnded({ tier: "tracked", domain, billing, trial: true }) },
    ],
  };
}

/** Each email's first preview. */
export function previews(price: { us: number; uk: number }): Record<LifecycleEmail, Rendered> {
  const sets = previewSets(price);
  return Object.fromEntries(LIFECYCLE_EMAILS.map((n) => [n, sets[n][0]!.mail])) as Record<LifecycleEmail, Rendered>;
}
