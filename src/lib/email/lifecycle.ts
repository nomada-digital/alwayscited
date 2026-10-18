import { TRIAL, trialCharge, trialMoment } from "../../config/trial.ts";
import { count } from "../plural.ts";
import { TIER_PLAIN, type TierKey } from "../tier-text.ts";
import { checkTime } from "../tracking/check-time.ts";
import { formatDay } from "../tracking/figures.ts";
import { PROMPTS_PER_CLUSTER } from "../tracking/limits.ts";
import { firstAsked, setupChecks } from "../tracking/setup-landing.ts";
import { type Block, type MaybeBlock, button, callout, eyebrow, fine, h1, h2, keywordHead, note, page, para, type Row, signature, stats, steps, table, textLink } from "./design.ts";
import {
  type Focus,
  type FirstReading,
  monthToDate,
  type Position,
  pointsChange,
  positionLabel,
  positionMove,
  type SetupStatus,
  type TrialFigures,
  type WeekFigures,
  weekDirection,
  type Work,
} from "./merge.ts";
import { changeTone, type ThisWeekData, weekSubject } from "./this-week-mail.ts";
import { SEVERITY_LABEL } from "../diy/plan/types.ts";

/**
 * The customer emails (R159, Danny, 1 Oct 2026; rebuilt from the approved
 * designs on 18 Oct 2026, brief item 2e), as templates only. Each renders a
 * subject, HTML and plain text from its data. Pure, so the preview page and
 * the tests render them with fixture data and nothing is sent. Each send site
 * checks its own app_settings flag, email_<name>_enabled, which stays false
 * until Danny approves that preview; the login link (#1) has no flag.
 *
 * The rules every template keeps, tested in lifecycle.test.mts: the brand in
 * lowercase; the tier as TIER_PLAIN (no colour in mail); one button; the
 * footer with Help and our address, the nomada digital line on every email
 * but a client-facing one, and Email settings on every email but the login
 * link and payment failed. Every figure comes from merge.ts, which reads the
 * dashboard's own rows, and a block with no figure behind it is left out.
 *
 * Links (18 Oct 2026): the customer dashboard is moving to the dashboards
 * host, so every link is built on the origin the caller passes - dashOrigin()
 * from dash/host.ts at every send site - as `${origin}/${slug}/...`.
 */

/** The emails that have a flag, email_<name>_enabled, each false until Danny turns it on. */
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
  "this_week",
  "payment_failed",
] as const;
export type LifecycleEmail = (typeof LIFECYCLE_EMAILS)[number];

/** All twelve, in the brief's order: the login link, which is always on, and the eleven behind a flag. */
export const CUSTOMER_EMAILS = [
  "login_link",
  "trial_started",
  "welcome",
  "setup_reminder",
  "setup_confirmed",
  "first_reading",
  "this_week",
  "invite",
  "trial_midpoint",
  "trial_ending",
  "payment_failed",
  "plan_ended",
] as const;
export type CustomerEmail = (typeof CUSTOMER_EMAILS)[number];

/** The app_settings key that turns one on. Default false; only Danny turns one on. */
export const flagFor = (name: LifecycleEmail) => `email_${name}_enabled`;

/** On only for a jsonb true: a missing row, a string or anything else is off. */
export const flagOn = (value: unknown) => value === true;

/**
 * A rendered email. `sender` is who it is from (mail-from.ts words it): #3
 * welcome and #12 plan ended come from "Danny at alwayscited". `headers` are
 * extra mail headers - #7's List-Unsubscribe and List-Unsubscribe-Post.
 */
export type Rendered = { subject: string; html: string; text: string; sender?: "team" | "danny"; headers?: Record<string, string> };

const SITE = "https://alwayscited.com";
const HELP = `${SITE}/help`;

/** A client's pages on the dashboards host. */
export type Links = { dashboard: string; setup: string; plan: string; settings: string };

const base = (origin: string) => origin.replace(/\/+$/, "");
export const dashboardUrl = (slug: string, origin: string) => `${base(origin)}/${slug}`;
export const setupUrl = (slug: string, origin: string) => `${base(origin)}/${slug}/setup`;
/** The plan and billing section of Settings, where an owner cancels a trial, updates a card or asks us to restart. */
export const planUrl = (slug: string, origin: string) => `${base(origin)}/${slug}/settings#plan`;
/** The old name, kept for the send sites that call it. */
export const billingUrl = planUrl;
export const emailSettingsUrl = (slug: string, origin: string) => `${base(origin)}/${slug}/settings#email`;
/** A client's This week page, where #7's button goes. */
export const actionsUrl = (slug: string, origin: string) => `${base(origin)}/${slug}/plan`;

export function linksFor(slug: string, origin: string): Links {
  return { dashboard: dashboardUrl(slug, origin), setup: setupUrl(slug, origin), plan: planUrl(slug, origin), settings: emailSettingsUrl(slug, origin) };
}

/**
 * A running trial's terms, as every trial email states them: when it ends in
 * the client's own zone, what is charged then, and the plan link to cancel.
 * Worked out here from config/trial.ts, so no send site words a date or a price
 * itself. `date` ("22 Oct 2026") and `day` ("22 Oct") are the end's date in the
 * same zone, for the headlines.
 */
export type TrialTerms = { ends: string; charge: string; billing: string; date?: string; day?: string };

export function trialTerms(p: { endsAt: string; market: string; price: { us: number; uk: number }; billing: string }): TrialTerms {
  const ends = trialMoment(p.endsAt, p.market);
  const date = ends.split(",")[0]!;
  return { ends, charge: trialCharge(p.market, p.price), billing: p.billing, date, day: date.replace(/ \d{4}$/, "") };
}

const dayOf = (t: TrialTerms) => t.day ?? t.ends.split(",")[0]!.replace(/ \d{4}$/, "");

const SIGN_IN_ONCE = "The button signs you in. It works once, for 15 minutes; after that, sign in asks for a new link.";
/** The later emails carry no login token: signed out, the reader asks for a link at sign in. */
const SIGN_IN_ASKS = "If you are signed out, sign in with this email address and we send you a one-time link.";
/** The plan terms as the trial emails say them (config/trial.ts PLAN_TERMS, its first two clauses). */
const TERMS = "monthly, no minimum term";

/** "... in Settings > Plan ...", linked to the client's plan section. */
const cancelNote = (t: TrialTerms, text: string, after: string): Block => note(text, { label: "Settings > Plan", href: t.billing, after });

function render(p: {
  subject: string;
  preheader: string;
  blocks: MaybeBlock[];
  reason: string;
  settings: string | null;
  unsubscribe?: string | null;
  sender?: "team" | "danny";
  clientFacing?: { agency: string | null } | null;
}): Rendered {
  const { html, text } = page({
    title: p.subject,
    preheader: p.preheader,
    blocks: p.blocks,
    footer: { reason: p.reason, settings: p.settings, unsubscribe: p.unsubscribe ?? null, help: HELP },
    clientFacing: p.clientFacing ?? null,
  });
  return { subject: p.subject, html, text, ...(p.sender === "danny" ? { sender: "danny" as const } : {}) };
}

const engineList = (engines: readonly string[] | null | undefined) =>
  engines && engines.length ? (engines.length === 1 ? engines[0]! : `${engines.slice(0, -1).join(", ")} and ${engines.at(-1)}`) : "the AI engines";

// ------------------------------------------------------------------ #1

/**
 * #1 the login link, always on (no flag). To an address already in
 * dashboard_members only (login-mail.ts); the link works once, for 15 minutes.
 * No Email settings link: it is the one email nobody can turn off.
 */
export function loginLink(d: { link: string }): Rendered {
  return render({
    subject: "Your alwayscited login link",
    preheader: "One click and you're in. The link works once and expires in 15 minutes.",
    blocks: [
      eyebrow("Log in"),
      h1("Here's your link."),
      para("Click below to open your dashboard. It works once and expires in 15 minutes."),
      button(d.link, "Open the dashboard"),
      note("If you didn't ask for this, ignore it. Nobody gets in without the link."),
    ],
    reason: "You're getting this because someone asked for a login link for this address.",
    settings: null,
  });
}

// ------------------------------------------------------------------ #2 and #3

/** The three setup steps the trial and the alwaystracked welcome draw. */
const SETUP_STEPS = [
  { title: "Check a Google keyword", body: "The search your buyers type. We show its volume and where you rank today, and offer the plural too, at no extra cost." },
  { title: "Pick the target page", body: "The one page on your site you want ranked and cited for it." },
  { title: `Edit ${PROMPTS_PER_CLUSTER} prompts`, body: "We draft the questions buyers ask AI about it. Change anything that isn't how your buyers talk." },
];

/** What a worked plan lands each month, as the welcome's tiles show it (brief 2e). */
function deliverableTiles(tier: TierKey, clusters: number): { value: string; label: string }[] {
  const per = clusters > 1 ? " per cluster" : "";
  if (tier === "mentioned") return [{ value: "3", label: `placements a month${per}` }];
  if (tier === "cited") return [{ value: "3", label: `placements a month${per}` }, { value: "2+", label: `link insertions a month${per}` }, { value: "Schema", label: "on your target page" }];
  return [];
}

/**
 * #3 the welcome (paid checkout), from Danny, and #2 trial_started, its
 * version for an alwaystracked order on the free trial: when the trial ends,
 * what is charged then and where to cancel, and never "bought" - nothing was.
 * A paid alwaystracked order states the plan's room, `clusterLimit`, not the
 * one cluster signup makes (audit activation-16, 8 Oct 2026).
 *
 * The daily check's time is said in the client's zone when signup passes the
 * market and start (ON-3, 9 Oct 2026, checkTime); without them no time.
 * `prompts` is the prompts signup copied from the scan: a cluster that has
 * them is checked without waiting on setup.
 */
export function welcome(d: {
  tier: TierKey;
  clusters: number;
  clusterLimit: number;
  domain: string;
  link: string;
  trial?: TrialTerms | null;
  market?: string | null;
  startedOn?: string | null;
  engines?: readonly string[] | null;
  prompts?: number;
  settings?: string | null;
}): Rendered {
  const plan = TIER_PLAIN[d.tier];
  const at = d.market && d.startedOn ? checkTime(d.startedOn, d.market) : null;
  const settings = d.settings ?? null;
  const room = `The plan tracks up to ${count(d.clusterLimit, "cluster")}.`;
  if (d.trial) {
    return render({
      subject: `Your ${TRIAL.days} days start now`,
      preheader: d.prompts ? `Your first cluster is checked from its prompts. Nothing is charged until ${dayOf(d.trial)}.` : "Set up your first cluster and the daily check starts reading the engines for you.",
      blocks: [
        eyebrow(`${plan} trial`),
        h1(`You're in. Nothing is charged until ${dayOf(d.trial)}.`),
        para(`For the next ${TRIAL.days} days, ${plan} reads ${engineList(d.engines)} every day for **${d.domain}**. ${room} Cancel before ${d.trial.ends} and you pay nothing.`),
        para(
          d.prompts
            ? `Your first cluster starts with the prompts from your scan, so its checks run${at ? ` daily at ${at}` : " daily"}. Check them, and set up the rest. It takes about ten minutes:`
            : `The first check can't run until you've set up at least one cluster. That takes about ten minutes${at ? `, and checks run daily at ${at}` : ""}:`,
        ),
        steps(SETUP_STEPS),
        button(d.link, "Set up your first cluster"),
        cancelNote(d.trial, `Trial ends ${d.trial.ends}. Then ${d.trial.charge}, ${TERMS}. Cancel any time from`, "."),
        note(SIGN_IN_ONCE),
      ],
      reason: `You're getting this because you started an ${plan} trial for ${d.domain}.`,
      settings,
    });
  }
  const worked = d.tier !== "tracked";
  const tiles = deliverableTiles(d.tier, d.clusters);
  const ones = d.clusters === 1 ? "cluster" : "clusters";
  const timeline = worked
    ? [
        { title: `Today: set up your ${ones}`, body: `Keyword, plural, target page and ${PROMPTS_PER_CLUSTER} prompts. It's the only thing we need from you.` },
        { title: at ? `Daily at ${at}: the reading` : "Daily: the reading", body: "Who the engines name, where you rank, and the pages the answers are built from." },
        { title: "Week 1: the shortlist", body: "We pick placement targets from the sources the engines already cite for your cluster. Not a domain-authority list." },
        { title: "Weeks 2-4: placements go live", body: "Each one shows in your dashboard with the answers it appears in, and the anchor text we agreed with you." },
      ]
    : [...SETUP_STEPS.slice(0, 2), { title: at ? `Daily at ${at}: the reading` : "Daily: the reading", body: "Who the engines name, where you rank, and the pages the answers are built from." }];
  return render({
    subject: `You're on ${plan}. Here's the next 30 days.`,
    preheader: "What lands, when it lands, and the one thing we need from you today.",
    sender: "danny",
    blocks: [
      eyebrow(worked ? `the ${plan} plan · ${count(d.clusters, "cluster")}` : `${plan} · up to ${count(d.clusterLimit, "cluster")}`),
      h1("Welcome. Here's the month ahead."),
      para(
        worked
          ? `You're on the **${plan}** plan for **${d.domain}**: ${d.clusters === 1 ? "one keyword cluster" : `${d.clusters} keyword clusters`} worked every month, plus the full ${TIER_PLAIN.tracked} data on up to ${count(d.clusterLimit, "cluster")}. We say exactly what lands, so you can hold us to it.`
          : `You're on **${plan}** for **${d.domain}**. ${room} Every day it reads ${engineList(d.engines)} on the questions your buyers ask.`,
      ),
      tiles.length > 0 && stats(tiles),
      h2(worked ? "The next 30 days" : "What happens next"),
      steps(timeline),
      button(d.link, `Set up your ${ones}`),
      note(SIGN_IN_ONCE),
      signature(),
    ],
    reason: `You're getting this because you bought ${worked ? `the ${plan} plan` : plan} for ${d.domain}.`,
    settings,
  });
}

// ------------------------------------------------------------------ #4

/**
 * #4 setup reminder, from the daily cron 24 and 72 hours after signup while
 * the setup is unconfirmed (lifecycle-schedule.ts), twice at most. It says
 * what the runner does (audit activation-16, 8 Oct 2026): every live prompt is
 * read whether or not setup was confirmed, so a client with prompts is not
 * told "nothing's running". `withPrompts` is the live clusters with a live
 * prompt; never sent once every cluster has prompts (setupStillEmpty).
 * `status` is the first unfinished cluster's steps (merge.ts setupStatus),
 * and `firstAsk` when prompts saved now are first asked (setup-landing.ts).
 */
export function setupReminder(d: { tier: TierKey; domain: string; link: string; withPrompts: number; clusterLimit: number; status?: SetupStatus | null; firstAsk?: string | null; settings?: string | null }): Rendered {
  const empty = Math.max(0, d.clusterLimit - d.withPrompts);
  const checking = d.withPrompts > 0;
  const s = d.status ?? null;
  const rows: Row[] = s
    ? [
        { left: s.pair ? "Google keyword + plural" : "Google keyword", right: s.keyword ? "Done" : "Missing", tone: s.keyword ? "good" : "bad" },
        { left: "Target page", sub: s.target, right: s.target ? "Done" : "Missing", tone: s.target ? "good" : "bad" },
        { left: "Prompts", right: `${Math.min(s.prompts, PROMPTS_PER_CLUSTER)} of ${PROMPTS_PER_CLUSTER} saved`, tone: s.prompts >= PROMPTS_PER_CLUSTER ? "good" : "quiet" },
      ]
    : [];
  return render({
    subject: checking ? "Your setup isn't finished yet" : "Your first reading is waiting on one thing",
    preheader: checking ? `${empty} of your ${count(d.clusterLimit, "cluster")} still empty.` : "Nothing is checked until your first cluster has prompts.",
    blocks: [
      eyebrow("Setup"),
      h1(checking ? "Your setup isn't finished." : "Nothing's running yet."),
      para(
        checking
          ? `The prompts for ${d.domain} are being checked, but ${empty} of your ${count(d.clusterLimit, "cluster")} ${empty === 1 ? "is" : "are"} still empty.`
          : `The dashboard for ${d.domain} is waiting on its clusters. Nothing is checked until your first cluster has prompts.`,
      ),
      s && table([s.keyword ?? s.cluster, "Status"], rows),
      para(`Each cluster is one keyword and up to ${PROMPTS_PER_CLUSTER} prompts.`),
      d.firstAsk && para(`Finish now and the first reading lands ${d.firstAsk}.`),
      button(d.link, "Finish setup"),
      note(SIGN_IN_ASKS),
    ],
    reason: `You're getting this because ${d.domain}'s setup isn't finished. We send this twice at most.`,
    settings: d.settings ?? null,
  });
}

// ------------------------------------------------------------------ #5

/**
 * #5 setup_confirmed, to the member who pressed Confirm. When checks run is
 * the setup page's line (setupChecks), in the client's zone, from the
 * confirm's moment `now` (email review H3, 12 Oct 2026): no "first" check once
 * checks have begun, and none at all with no live prompt (review of 3eaa592).
 * `focus` and `prompts` are the lead cluster as it will be checked: keyword,
 * other form, target page and its prompts with their angles.
 */
export function setupConfirmed(d: {
  tier: TierKey;
  clusters: string[];
  link: string;
  market: string;
  today: string;
  startedOn: string | null;
  livePrompts: number;
  now?: number;
  domain?: string;
  focus?: Focus | null;
  prompts?: { text: string; angle: string | null }[];
  engines?: readonly string[] | null;
  settings?: string | null;
}): Rendered {
  const { first, line } = setupChecks({ startedOn: d.startedOn, today: d.today, market: d.market, livePrompts: d.livePrompts, ...(d.now === undefined ? {} : { now: d.now }) });
  const empty = d.livePrompts < 1;
  const head = empty ? "Add prompts to start your checks" : "You're set. Here's exactly what we'll check.";
  const subject = first ? `Set. Your first reading lands ${first}.` : head;
  const f = d.focus ?? null;
  const prompts = d.prompts ?? [];
  return render({
    subject,
    preheader: empty ? line : "Here's exactly what we'll check every day, so you can catch anything wrong before it runs.",
    blocks: [
      eyebrow("Setup complete"),
      h1(head),
      para(empty ? line : `${line} Each engine is read side by side, never averaged. If anything below is wrong, change it before then and the check uses the new version.`),
      f?.keyword && prompts.length > 0 && keywordHead({ keyword: f.keyword, pair: f.pair, target: f.target }),
      f?.keyword && prompts.length > 0 && table(["Prompt", "Angle"], prompts.map((p) => ({ left: p.text, right: p.angle ?? "" }))),
      d.clusters.length > 0 && table([d.clusters.length === 1 ? "Your cluster" : "Your clusters", ""], d.clusters.map((c) => ({ left: c, right: "" }))),
      d.engines && d.engines.length > 0 && fine(`Engines: ${d.engines.join(", ")}.`),
      button(d.link, d.clusters.length === 1 ? "Review your cluster" : "Review your clusters"),
      note(empty ? "You can add a cluster's prompts from the dashboard at any time." : "You can change a cluster's prompts from the dashboard at any time."),
    ],
    reason: `You're getting this because you finished setting up ${d.domain ?? "your dashboard"}.`,
    settings: d.settings ?? null,
  });
}

// ------------------------------------------------------------------ #6

/** Position tiles for a cluster's forms, each apart - never averaged with each other or with AI visibility. */
function positionTiles(positions: readonly Position[], lead: string, withMove: boolean) {
  return positions
    .filter((p) => p.now !== null)
    .slice(0, 2)
    .map((p) => ({ value: `#${p.now}`, label: positionLabel(p, lead), note: withMove ? positionMove(p) : null }));
}

const NEVER_AVERAGED = "AI visibility and Google position are reported side by side, never averaged into one number.";

/**
 * #6 first_reading: after a client's first finished run, to its live owners.
 * The subject and headline are the Overview's own namedRate for the run
 * (runner.ts); `figures` and `focus` are the rest of the reading from the
 * dashboard's rows (merge.ts). The one upsell line in any email is here, and
 * only when `upsell` (merge.ts upsellAllowed: alwaystracked, upsell_mode not
 * off, not client-facing).
 */
export function firstReading(d: {
  tier: TierKey;
  domain: string;
  named: number;
  answers: number;
  page1: number;
  keywords: number;
  link: string;
  figures?: FirstReading | null;
  focus?: Focus | null;
  upsell?: boolean;
  settings?: string | null;
}): Rendered {
  const f = d.figures ?? null;
  const focus = d.focus ?? null;
  const pos = positionTiles(focus?.positions ?? [], "on Google", false);
  const tiles = [{ value: `${d.named}/${d.answers}`, label: "answers name you" }, ...(pos.length ? pos : d.keywords > 0 ? [{ value: `${d.page1}/${d.keywords}`, label: "keywords on page 1 of Google" }] : [])];
  return render({
    subject: `First reading: named in ${d.named} of ${d.answers} answers`,
    preheader: f?.instead.length ? "Who the engines named, and the site they drew on most." : `${d.page1} of ${d.keywords} keywords on page 1 of Google.`,
    blocks: [
      eyebrow(f ? `First reading · ${formatDay(f.day, true)}` : "First reading"),
      h1(`The engines named you in ${d.named} of ${d.answers} answers.`),
      para(`That's today's baseline${focus?.keyword ? ` for **${focus.keyword}**` : ""}. From here, every change is a change in the answers, because the questions stay the same.`),
      focus?.keyword && focus.target ? keywordHead({ keyword: focus.keyword, pair: focus.pair, target: focus.target }) : null,
      stats(tiles),
      tiles.length > 1 && fine(NEVER_AVERAGED),
      f && f.opportunities > 0 && note(`${f.opportunities} placement ${f.opportunities === 1 ? "opportunity" : "opportunities"} found. They're in the dashboard.`),
      f && f.byEngine.length > 0 && h2("By engine"),
      f && f.byEngine.length > 0 && table(["Engine", "Named you"], f.byEngine.map((r) => ({ left: r.engine, right: `${r.named} of ${r.answers}`, tone: r.named > 0 ? "good" : "bad" }))),
      f && f.instead.length > 0 && h2("Other brands named"),
      f && f.instead.length > 0 && table(["Brand", "Answers"], f.instead.map((b) => ({ left: b.name, right: String(b.answers) }))),
      f?.source && callout(`The site they drew on most: ${f.source.domain}`, `Cited in ${count(f.source.answers, "answer")} today. That's the kind of page a placement goes into.`),
      note("One day is one reading. Answers move daily, so the pattern means more from week two."),
      button(d.link, "Open the full reading"),
      d.upsell && note("Found the gaps? Getting into them is", { label: TIER_PLAIN.mentioned, href: `${SITE}/alwaysmentioned`, after: ", one cluster at a time." }),
      // L4 (12 Oct 2026, email review): never "the pages that were cited instead".
      fine("The dashboard has every answer, and the pages the answers cited."),
    ],
    reason: `You're getting this because ${d.domain}'s first daily check just finished.`,
    settings: d.settings ?? null,
  });
}

// ------------------------------------------------------------------ #7

/**
 * #7 this_week (13 Oct 2026, DIY P9; redesigned 18 Oct 2026): the Monday
 * email, to owners and editors who have not switched it off. The subject and
 * headline come from the week's real figures (this-week-mail.ts weekSubject);
 * a down week says so plainly. The paid-tier work table is hidden on
 * alwaystracked (merge.ts workThisMonth is null there). `unsubscribe` adds the
 * footer link and the List-Unsubscribe headers for this recipient.
 */
export function thisWeek(d: ThisWeekData): Rendered {
  const week: WeekFigures | null = d.week ?? null;
  const focus: Focus | null = d.focus ?? null;
  const lead = focus?.positions[0] ?? null;
  // A direction only with a figure behind it: no share and no week-old position says nothing about the week.
  const dir = week && (week.pct !== null || (lead !== null && lead.now !== null && lead.before !== null)) ? weekDirection(week, lead) : null;
  const delta = week ? pointsChange(week) : null;
  const tiles = [
    ...(week && week.pct !== null
      ? [{ value: `${week.pct}%`, label: "of answers name you", note: delta === null ? null : { text: delta === 0 ? "no change on last week" : `${delta > 0 ? "+" : ""}${delta} pts on last week`, tone: delta > 0 ? ("good" as const) : delta < 0 ? ("bad" as const) : ("quiet" as const) } }]
      : []),
    ...positionTiles(focus?.positions ?? [], "Google", true),
  ];
  const n = d.items.length;
  const work: Work | null = d.work ?? null;
  const c = d.changes;
  const changeRows: Row[] = c.state === "ok" ? c.lines.map((l) => ({ left: l.replace(/\.$/, ""), right: changeTone(l).label, tone: changeTone(l).tone })) : [];
  const changeNote =
    c.state === "early"
      ? "Changes start from your second check."
      : c.state === "quiet"
        ? "Fewer than three checks finished in the last 7 days, so there are no changes to list."
        : c.state === "ok" && !c.lines.length
          ? "Nothing held a change over your last checks."
          : null;
  const headline = dir === "down" ? "A harder week. Here's what moved." : dir === "up" ? "A better week. Here's what moved." : dir === "flat" ? "A steady week. Here's what moved." : "This week";
  const mail = render({
    subject: weekSubject(d, dir, lead),
    preheader: n ? `${n} ${n === 1 ? "action" : "actions"} for the week, and what changed since your last check.` : "What changed since your last check.",
    blocks: [
      eyebrow(`Week of ${formatDay(d.weekOf, true)} · ${d.domain}`),
      h1(headline),
      focus?.keyword && keywordHead({ keyword: focus.keyword, pair: focus.pair, target: focus.target }),
      tiles.length > 0 && stats(tiles),
      tiles.length > 1 && fine(NEVER_AVERAGED),
      c.state !== "unread" && h2("What changed"),
      changeRows.length > 0 && table(["Change", ""], changeRows),
      c.state === "ok" && c.more > 0 && fine(`${c.more} more ${c.more === 1 ? "change is" : "changes are"} on your dashboard.`),
      changeNote && para(changeNote),
      h2("Your actions this week"),
      n
        ? table(["Action", "Why it's here"], d.items.map((i) => ({ left: i.title.replace(/\.$/, ""), sub: i.why, right: SEVERITY_LABEL[i.severity], tone: i.severity === "blocking" ? "bad" : "quiet" })))
        : para(`Nothing is pinned for the week of ${formatDay(d.weekOf)} for ${d.domain}. New actions arrive as your checks find them.`),
      work && h2("The work this week"),
      work && table(["Placement", "Status"], work.rows.map((r) => ({ left: `${r.domain}: ${r.what}`, sub: r.anchor ? `anchor: ${r.anchor}` : null, right: r.status, tone: r.tone }))),
      work && fine(monthToDate(work)),
      button(d.link, "Open this week"),
      note(SIGN_IN_ASKS),
    ],
    reason: `You're getting this because you get the Monday summary for ${d.domain}. Change it in Email settings.`,
    settings: d.settings ?? null,
    unsubscribe: d.unsubscribe ?? null,
  });
  return d.unsubscribe ? { ...mail, headers: unsubscribeHeaders(d.unsubscribe) } : mail;
}

/** RFC 2369 and RFC 8058: the one-click unsubscribe a mail client offers, for #7 only. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

// ------------------------------------------------------------------ #8

/**
 * #8 the invite: to the address an owner invited (invite-mail.ts). Always
 * client-facing - no upsell, no nomada digital line - and in agency mode the
 * agency's name (accounts.agency_name) under the wordmark and in the subject.
 * No tier is named. No login token: the invitee signs in the normal way.
 * `everyClient` (AG-1, 9 Oct 2026): the account's client count when the invite
 * is to every client on an account with two or more.
 */
export function invite(d: { domain: string; brand?: string | null; link: string; inviter: string; role: "editor" | "viewer"; everyClient?: number | null; agency?: string | null; engines?: readonly string[] | null; settings?: string | null }): Rendered {
  const as = d.role === "editor" ? "an editor" : "a viewer";
  const brand = d.brand?.trim() || d.domain;
  const rest = d.everyClient && d.everyClient > 1 ? d.everyClient - 1 : 0;
  const agency = d.agency?.trim() || null;
  const what = rest ? `the ${brand} dashboard and ${rest} more` : `the ${brand} dashboard`;
  return render({
    subject: `${d.inviter}${agency ? ` from ${agency}` : ""} shared ${what} with you`,
    preheader: `See, every day, which AI engines name ${brand} and where it ranks on Google.`,
    clientFacing: { agency },
    blocks: [
      eyebrow("You've been given access"),
      h1(`${d.inviter} shared ${what} with you.`),
      para(
        rest
          ? `${d.inviter}${agency ? ` at ${agency}` : ""} gave you access to the dashboards for **${brand}** and the ${count(rest, "other client")} on their account, as ${as}. Every day they show:`
          : `${d.inviter}${agency ? ` at ${agency}` : ""} gave you access to the AI visibility dashboard for **${brand}**, as ${as}. Every day it shows:`,
      ),
      steps([
        { title: `Which AI engines name ${brand}`, body: `${engineList(d.engines)[0]!.toUpperCase()}${engineList(d.engines).slice(1)}, on the questions your buyers ask.` },
        { title: "Where it ranks on Google", body: "Side by side with the answers, never averaged." },
        { title: "The pages the answers are built from", body: "The sources the engines cite, ranked by how often." },
      ]),
      button(d.link, "Open the dashboard"),
      note("Sign in with this email address and we send you a one-time link."),
    ],
    reason: `You're getting this because ${d.inviter} invited this address.`,
    settings: d.settings ?? null,
  });
}

// ------------------------------------------------------------------ #9 and #10

/**
 * What the trial has read so far, for trial_midpoint and trial_ending
 * (lifecycle-schedule.ts trialRecap, with the Overview's namedRate and
 * brandBoard). `since` is the first check's day, null before any finished.
 */
export type TrialRecap = {
  named: number;
  answers: number;
  since: string | null;
  topOther: { name: string; answers: number } | null;
  clustersInUse: number;
  clusterLimit: number;
  livePrompts: number;
  /** When prompts saved at the send are first asked (setup-landing.ts firstAsked, email review L3). Null words no moment. */
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

/** "up 8 pts since day 1" / "down 3 pts since day 1" / "the same as day 1", or null without both. */
function sinceDayOne(f: TrialFigures): { text: string; tone: "good" | "bad" | "quiet" } | null {
  if (f.pct === null || f.firstPct === null || f.readings < 2) return null;
  const d = f.pct - f.firstPct;
  return d === 0 ? { text: "the same as day 1", tone: "quiet" } : { text: `${d > 0 ? "up" : "down"} ${Math.abs(d)} pts since day 1`, tone: d > 0 ? "good" : "bad" };
}

/** #9 trial_midpoint, from the daily cron once the trial is a week in (lifecycle-schedule.ts). */
export function trialMidpoint(d: { domain: string; link: string; recap: TrialRecap; trial: TrialTerms; figures?: TrialFigures | null; settings?: string | null }): Rendered {
  const plan = TIER_PLAIN.tracked;
  const read = d.recap.answers > 0 && d.recap.since !== null;
  const f = read ? (d.figures ?? null) : null;
  return render({
    subject: read ? "Seven days in: here's what a week of readings shows" : `Seven days in: your ${plan} trial so far`,
    preheader: read ? `${d.domain} named in ${d.recap.named} of ${count(d.recap.answers, "AI answer")} so far.` : `Your free trial ends ${d.trial.ends}.`,
    blocks: [
      eyebrow(`Trial · a week into ${TRIAL.days} days`),
      h1(read ? "A week of readings. Here's the pattern." : "Your free trial so far"),
      f &&
        stats([
          { value: String(f.readings), label: f.readings === 1 ? "daily reading" : "daily readings" },
          { value: String(f.answers), label: "answers read" },
          ...(f.pct !== null ? [{ value: `${f.pct}%`, label: "of answers name you", note: sinceDayOne(f) }] : []),
        ]),
      ...recapLines(d.domain, d.recap).map(para),
      f?.best && f.worst && h2("Your best and worst prompt"),
      f?.best && f.worst && table(["Prompt", "Named, this week"], [f.best, f.worst].map((p) => ({ left: p.text, right: `${p.named} of ${p.answers}` }))),
      f?.source && callout(`Worth getting into: ${f.source.domain}`, `Cited in ${count(f.source.answers, "answer")} this week, on ${f.source.engines === 1 ? "one engine" : `${f.source.engines} engines`}.`),
      para(`Your free trial ends ${d.trial.ends}. Then it is ${d.trial.charge}, ${TERMS}. You don't need to do anything.`),
      cancelNote(d.trial, "To stop, cancel before then in", " and nothing is charged."),
      button(d.link, "See the week"),
      note(SIGN_IN_ASKS),
    ],
    reason: `You're getting this because you're on an ${plan} trial for ${d.domain}.`,
    settings: d.settings ?? null,
  });
}

/**
 * #10 trial_ending, three days before the end: from the daily cron, or from
 * Stripe's customer.subscription.trial_will_end when that comes first.
 * Whichever is first sends it; the other finds it sent.
 */
export function trialEnding(d: { domain: string; link: string; recap: TrialRecap; trial: TrialTerms; figures?: TrialFigures | null; settings?: string | null }): Rendered {
  const plan = TIER_PLAIN.tracked;
  const read = d.recap.answers > 0 && d.recap.since !== null;
  const f = read ? (d.figures ?? null) : null;
  const tiles = f
    ? [
        { value: String(f.readings), label: f.readings === 1 ? "day of readings" : "days of readings" },
        ...(f.pct !== null ? [{ value: `${f.pct}%`, label: "of answers name you", note: sinceDayOne(f) }] : []),
        ...(f.bestPosition !== null ? [{ value: `#${f.bestPosition}`, label: "Google, best position" }] : []),
      ]
    : [];
  return render({
    subject: `Your trial ends on ${dayOf(d.trial)}`,
    preheader: `Then it is ${d.trial.charge}. To keep tracking, there is nothing to do.`,
    blocks: [
      eyebrow("Trial · 3 days left"),
      h1(`Your trial ends on ${dayOf(d.trial)}.`),
      para(`Your free trial of ${plan} for ${d.domain} ends **${d.trial.ends}**. From then it is **${d.trial.charge}**, charged to the card you gave at checkout, ${TERMS}.`),
      para("To keep tracking, there is nothing to do."),
      cancelNote(d.trial, "To stop, cancel before then in", " and nothing is charged. Your clusters, prompts and readings stay in your account for 90 days if you come back."),
      tiles.length > 0 && stats(tiles),
      ...recapLines(d.domain, d.recap).map(para),
      button(d.link, "Keep tracking"),
      textLink(d.trial.billing, "Cancel the trial"),
      note(SIGN_IN_ASKS),
    ],
    reason: `You're getting this because your ${plan} trial for ${d.domain} ends soon.`,
    settings: d.settings ?? null,
  });
}

// ------------------------------------------------------------------ #11

/**
 * #11 payment_failed (new, 18 Oct 2026): invoice.payment_failed on a renewal
 * (checkout/payment.ts afterFailedInvoice), to the live owners, once per
 * invoice. Tracking carries on while Stripe retries (past_due). `amount` is
 * the invoice's own, worded by paymentAmount; `invoice` is Stripe's hosted
 * page, checked by hostedInvoiceUrl. No Email settings link: a billing notice
 * cannot be switched off.
 */
export function paymentFailed(d: { domain: string; amount: string | null; failedOn: string; retryOn: string | null; invoice: string | null; plan: string }): Rendered {
  return render({
    subject: "Your payment didn't go through",
    preheader: d.retryOn ? `Tracking keeps running while the card is tried again on ${d.retryOn}.` : "Tracking keeps running. Update your card in one click.",
    blocks: [
      eyebrow("Billing"),
      h1("Your payment didn't go through."),
      para(`We couldn't take ${d.amount ?? "your payment"} for ${d.domain} on ${d.failedOn}. Nothing has stopped. Daily checks keep running${d.retryOn ? `, and the card is tried again on ${d.retryOn}` : ""}.`),
      para("If the card's expired or changed, updating it takes a minute."),
      button(d.plan, "Update payment details"),
      d.invoice ? note("Already sorted it? Ignore this.", { label: "View the invoice", href: d.invoice, after: "." }) : note("Already sorted it? Ignore this."),
    ],
    reason: `You're getting this because a payment for ${d.domain} failed.`,
    settings: null,
  });
}

/** An invoice amount in its currency: "$129", "£118.80". Null for anything unreadable. */
export function paymentAmount(cents: unknown, currency: unknown): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0 || typeof currency !== "string") return null;
  const sym: Record<string, string> = { usd: "$", gbp: "£", eur: "€" };
  const n = cents / 100;
  const v = Number.isInteger(n) ? String(n) : n.toFixed(2);
  const s = sym[currency.toLowerCase()];
  return s ? `${s}${v}` : `${v} ${currency.toUpperCase()}`;
}

// ------------------------------------------------------------------ #12

/** Danny, 18 Oct 2026: readings are kept for 90 days after a plan ends. */
export const KEPT_DAYS = 90;

/**
 * #12 the plan has ended (customer.subscription.deleted, or an .updated whose
 * status is canceled: signup.ts endClient, once whichever lands first), from
 * Danny. A trial that ended without a charge says so, with no receipt line
 * and no second trial (audit copy-4, 8 Oct 2026). A new order cannot bring an
 * ended client back (cbdffad), so the owner is sent to the plan section, where
 * Ask us is, to ask us to restart it. The history is kept for KEPT_DAYS days.
 */
export function planEnded(d: { tier: TierKey; domain: string; billing: string; trial?: boolean; endedOn?: string | null; settings?: string | null }): Rendered {
  const plan = TIER_PLAIN[d.tier];
  const kept = `Your clusters and readings so far stay in your account for ${KEPT_DAYS} days.`;
  return render({
    subject: d.trial ? `Your free trial of ${plan} has ended` : `Your ${plan} plan has ended`,
    preheader: d.trial ? `You were not charged. Your history is kept for ${KEPT_DAYS} days.` : `Daily checks for ${d.domain} have stopped. Your history is kept for ${KEPT_DAYS} days.`,
    sender: "danny",
    blocks: [
      eyebrow(d.trial ? "Trial ended" : "Plan ended"),
      h1(`Daily checks for ${d.domain} have stopped.`),
      para(
        d.trial
          ? `The free trial of ${plan} for ${d.domain} has ended, so no more checks run. You were not charged.`
          : `Your ${plan} plan ${d.endedOn ? `ended on ${d.endedOn}` : "has ended"}. We've stopped reading the engines for ${d.domain}, and nothing more will be charged.`,
      ),
      para(
        d.trial
          ? `${kept} Restarting starts a paid plan; there is no second free trial. To restart, ask us from your plan settings.`
          : `${kept} Ask us to restart it and the daily check carries on from where it stopped, on the same questions, so the trend stays comparable.`,
      ),
      button(d.billing, "Ask us to restart it"),
      para("If something didn't work for you, reply and tell me. I read every one."),
      signature(),
      note(SIGN_IN_ASKS),
    ],
    reason: `You're getting this because your ${d.trial ? `${plan} trial` : `${plan} plan`} for ${d.domain} ended.`,
    settings: d.settings ?? null,
  });
}

// ------------------------------------------------------------------ previews

export type Preview = { label: string; mail: Rendered };

/** The previews' made-up client. Never a real one. */
const DOMAIN = "tallyroo.com";
const SLUG = "tallyroo-com";
const FIXTURE_ORIGIN = "https://dashboards.alwayscited.com";

/**
 * Fixture data for the preview page and the tests. Made-up domain; never a
 * client. Each email's first preview is the case its flag is mostly about.
 * `price` is TRACKED_PRICE, passed in because config/pricing.ts is not
 * loadable by `node --test`. /admin/emails also renders each email on a real
 * client's rows (preview-source.ts).
 */
export function previewSets(price: { us: number; uk: number }): Record<CustomerEmail, Preview[]> {
  const origin = FIXTURE_ORIGIN;
  const links = linksFor(SLUG, origin);
  const link = `${origin}/auth?token=preview-only`;
  const domain = DOMAIN;
  const us = trialTerms({ endsAt: "2026-10-22T19:30:00Z", market: "US", price, billing: links.plan });
  const uk = trialTerms({ endsAt: "2026-10-22T13:30:00Z", market: "UK", price, billing: links.plan });
  const recap: TrialRecap = { named: 7, answers: 60, since: "9 Oct", topOther: { name: "Xero", answers: 31 }, clustersInUse: 2, clusterLimit: 10, livePrompts: 10 };
  const waiting: TrialRecap = { named: 0, answers: 0, since: null, topOther: null, clustersInUse: 1, clusterLimit: 10, livePrompts: 5 };
  const unread: TrialRecap = { named: 0, answers: 0, since: null, topOther: null, clustersInUse: 1, clusterLimit: 10, livePrompts: 0 };
  const unreadOn = (today: string): TrialRecap => ({ ...unread, firstAsk: firstAsked({ today, startedOn: "2026-10-09", market: "UK", now: Date.parse(`${today}T05:00:00Z`) }) });
  const focus: Focus = {
    clusterId: "k1",
    name: "invoicing app for freelancers",
    keyword: "invoicing app for freelancers",
    pair: "invoicing apps for freelancers",
    target: "tallyroo.com/invoicing",
    positions: [
      { keyword: "invoicing app for freelancers", label: "singular", now: 6, before: 7 },
      { keyword: "invoicing apps for freelancers", label: "plural", now: 9, before: 11 },
    ],
  };
  const trialFig: TrialFigures = {
    readings: 7,
    answers: 140,
    pct: 24,
    firstPct: 16,
    best: { text: "multi-currency invoicing for freelancers", named: 19, answers: 35 },
    worst: { text: "alternatives to Ledgerbird for freelancers", named: 0, answers: 35 },
    source: { domain: "solodesk.io", answers: 41, engines: 4 },
    bestPosition: 6,
  };
  const setupClusters = ["invoicing software", "expense tracking", "payroll for small business"];
  const engines = ["Google AI Overviews", "ChatGPT", "Gemini", "Perplexity"];
  const prompts = [
    { text: "best invoicing app for freelancers", angle: "Category" },
    { text: "multi-currency invoicing for freelancers", angle: "Positioning" },
    { text: "invoicing software freelance designers use", angle: "Sector" },
    { text: "invoicing that gets freelancers paid on time", angle: "Outcome" },
    { text: "alternatives to Ledgerbird for freelancers", angle: "Comparison" },
  ];
  const settings = links.settings;
  const items = [
    { severity: "blocking" as const, title: "Let Googlebot crawl /pricing", why: "robots.txt line 'Disallow: /pricing' blocks Googlebot from 1 key page of 8 (checked 17 Oct)." },
    { severity: "closest" as const, title: "Get onto the best-of lists ranking for 'invoicing software'", why: "'invoicing software' read #11 on 18 Oct." },
    { severity: "tidy" as const, title: "Add Organization schema to your homepage", why: "No Organization markup in the structured data we found (checked 17 Oct)." },
  ];
  const changes = {
    state: "ok" as const,
    lines: ["Gemini started naming you for 'multi-currency invoicing for freelancers'", "'invoice app for contractors' entered page 1: 13th to 8th", "ChatGPT stopped naming you for 'alternatives to Ledgerbird'"],
    more: 2,
  };
  const work: Work = {
    rows: [
      { domain: "solodesk.io", what: "placement", anchor: "invoicing app for freelancers", status: "Live", tone: "good" },
      { domain: "freelancefield.com", what: "placement", anchor: "invoicing apps for freelancers", status: "Live", tone: "good" },
      { domain: "invoicingguide.co", what: "link insertion", anchor: null, status: "Scheduled 23 Oct", tone: "quiet" },
    ],
    placementsLive: 2,
    insertionsLive: 0,
    onSiteLive: 1,
    target: { placements: 3, insertions: 2 },
  };
  const unsubscribe = `${origin}/api/dash/unsubscribe?t=preview-only`;
  const week = { tier: "cited" as const, domain, weekOf: "2026-10-19", items, changes, link: `${links.dashboard}/plan`, settings, focus, work };
  return {
    login_link: [{ label: "a member asked for a link", mail: loginLink({ link }) }],
    trial_started: [
      { label: "alwaystracked free trial, US", mail: welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain, link, trial: us, market: "US", startedOn: "2026-10-10", engines, settings }) },
      { label: "alwaystracked free trial from a scan, prompts copied, UK", mail: welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain, link, trial: uk, market: "UK", startedOn: "2026-10-10", engines, prompts: 5, settings }) },
    ],
    welcome: [
      { label: "the alwayscited plan, 1 cluster, US", mail: welcome({ tier: "cited", clusters: 1, clusterLimit: 10, domain, link, market: "US", startedOn: "2026-10-10", settings }) },
      { label: "alwaysmentioned, 3 clusters bought, UK", mail: welcome({ tier: "mentioned", clusters: 3, clusterLimit: 10, domain, link, market: "UK", startedOn: "2026-10-10", settings }) },
      { label: "alwaystracked, paid with no trial, UK", mail: welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain, link, market: "UK", startedOn: "2026-10-10", engines, settings }) },
    ],
    setup_reminder: [
      { label: "no prompts yet, target page missing", mail: setupReminder({ tier: "tracked", domain, link: links.setup, withPrompts: 0, clusterLimit: 10, status: { cluster: "invoicing app for freelancers", keyword: "invoicing app for freelancers", pair: "invoicing apps for freelancers", target: null, prompts: 0 }, firstAsk: firstAsked({ today: "2026-10-11", startedOn: "2026-10-10", market: "UK", now: Date.parse("2026-10-11T12:00:00Z") }), settings }) },
      { label: "a scan buyer: 1 cluster with prompts", mail: setupReminder({ tier: "tracked", domain, link: links.setup, withPrompts: 1, clusterLimit: 10, settings }) },
    ],
    setup_confirmed: [
      { label: "alwaysmentioned, US, confirmed the day it was bought", mail: setupConfirmed({ tier: "mentioned", clusters: setupClusters, link: links.dashboard, market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 15, now: Date.parse("2026-10-09T18:00:00Z"), domain, focus, prompts, engines: [...engines, "Claude"], settings }) },
      { label: "alwaystracked, US, confirmed late in the evening it was bought, already the next day in London", mail: setupConfirmed({ tier: "tracked", clusters: setupClusters, link: links.dashboard, market: "US", today: "2026-10-10", startedOn: "2026-10-11", livePrompts: 15, now: Date.parse("2026-10-10T01:30:00Z"), domain, settings }) },
      { label: "alwaystracked, UK, confirmed the day it was bought", mail: setupConfirmed({ tier: "tracked", clusters: setupClusters, link: links.dashboard, market: "UK", today: "2026-10-26", startedOn: "2026-10-27", livePrompts: 15, now: Date.parse("2026-10-26T12:00:00Z"), domain, settings }) },
      { label: "alwaystracked, UK, confirmed after checks began", mail: setupConfirmed({ tier: "tracked", clusters: setupClusters, link: links.dashboard, market: "UK", today: "2026-10-12", startedOn: "2026-10-10", livePrompts: 15, now: Date.parse("2026-10-12T12:00:00Z"), domain, settings }) },
      { label: "alwaystracked, US, no prompts yet", mail: setupConfirmed({ tier: "tracked", clusters: ["invoicing software"], link: links.dashboard, market: "US", today: "2026-10-09", startedOn: "2026-10-10", livePrompts: 0, now: Date.parse("2026-10-09T18:00:00Z"), domain, settings }) },
    ],
    first_reading: [
      {
        label: "alwaystracked, upsell on",
        mail: firstReading({
          tier: "tracked",
          domain,
          named: 6,
          answers: 25,
          page1: 1,
          keywords: 2,
          link: links.dashboard,
          focus,
          upsell: true,
          settings,
          figures: {
            day: "2026-10-19",
            named: 6,
            answers: 25,
            byEngine: [
              { engine: "Google AI Overviews", named: 2, answers: 5 },
              { engine: "ChatGPT", named: 2, answers: 5 },
              { engine: "Gemini", named: 1, answers: 5 },
              { engine: "Perplexity", named: 1, answers: 5 },
              { engine: "Claude", named: 0, answers: 5 },
            ],
            instead: [
              { name: "Ledgerbird", answers: 11 },
              { name: "Stackbill", answers: 9 },
              { name: "Pennywell", answers: 7 },
            ],
            source: { domain: "solodesk.io", answers: 7 },
            opportunities: 9,
          },
        }),
      },
      { label: "the alwayscited plan, no upsell, figures only from the run", mail: firstReading({ tier: "cited", domain, named: 7, answers: 20, page1: 3, keywords: 10, link: links.dashboard, settings }) },
    ],
    this_week: [
      { label: "a better week, paid tier with the work table", mail: thisWeek({ ...week, week: { readings: 7, pct: 28, before: 22 }, unsubscribe }) },
      { label: "a harder week, alwaystracked", mail: thisWeek({ ...week, tier: "tracked", work: null, week: { readings: 7, pct: 19, before: 25 }, focus: { ...focus, positions: [{ ...focus.positions[0]!, now: 9, before: 6 }] }, unsubscribe }) },
      { label: "actions before the second check, no figures yet", mail: thisWeek({ tier: "tracked", domain, weekOf: "2026-10-12", items: items.slice(1), changes: { state: "early" }, link: `${links.dashboard}/plan`, settings }) },
      { label: "changes only, nothing pinned", mail: thisWeek({ tier: "mentioned", domain, weekOf: "2026-10-19", items: [], changes, link: `${links.dashboard}/plan`, settings, week: { readings: 7, pct: 30, before: 30 } }) },
    ],
    invite: [
      { label: "an agency's client, a viewer", mail: invite({ domain, brand: "Tallyroo", link: links.dashboard, inviter: "sam@northline.example", role: "viewer", agency: "Northline Digital", engines: [...engines, "Claude"], settings }) },
      { label: "a teammate, an editor on every client of three", mail: invite({ domain, brand: "Tallyroo", link: links.dashboard, inviter: "sam@tallyroo.com", role: "editor", everyClient: 3, engines, settings }) },
    ],
    trial_midpoint: [
      { label: "a week in, US", mail: trialMidpoint({ domain, link: links.dashboard, recap, trial: us, figures: trialFig, settings }) },
      { label: "a week in with nothing set up, UK", mail: trialMidpoint({ domain, link: links.dashboard, recap: unreadOn("2026-10-15"), trial: uk, settings }) },
      { label: "a week in with prompts but no check finished yet, US", mail: trialMidpoint({ domain, link: links.dashboard, recap: waiting, trial: us, settings }) },
    ],
    trial_ending: [
      { label: "three days before the end, US", mail: trialEnding({ domain, link: links.dashboard, recap, trial: us, figures: { ...trialFig, readings: 11, pct: 27 }, settings }) },
      { label: "three days before the end, UK", mail: trialEnding({ domain, link: links.dashboard, recap, trial: uk, settings }) },
      { label: "three days before the end with prompts but no check finished yet, US", mail: trialEnding({ domain, link: links.dashboard, recap: waiting, trial: us, settings }) },
      { label: "three days before the end with nothing set up, UK", mail: trialEnding({ domain, link: links.dashboard, recap: unreadOn("2026-10-19"), trial: uk, settings }) },
    ],
    payment_failed: [
      { label: "a renewal failed, Stripe retries", mail: paymentFailed({ domain, amount: paymentAmount(12900, "usd"), failedOn: "21 Oct 2026", retryOn: "24 Oct 2026", invoice: "https://invoice.stripe.com/i/preview-only", plan: links.plan }) },
      { label: "no retry date, no invoice page", mail: paymentFailed({ domain, amount: null, failedOn: "21 Oct 2026", retryOn: null, invoice: null, plan: links.plan }) },
    ],
    plan_ended: [
      { label: "the alwayscited plan, paid", mail: planEnded({ tier: "cited", domain, billing: links.plan, endedOn: "1 Nov 2026", settings }) },
      { label: "an alwaystracked trial that ended with no charge", mail: planEnded({ tier: "tracked", domain, billing: links.plan, trial: true, settings }) },
    ],
  };
}

/** Each email's first preview. */
export function previews(price: { us: number; uk: number }): Record<CustomerEmail, Rendered> {
  const sets = previewSets(price);
  return Object.fromEntries(CUSTOMER_EMAILS.map((n) => [n, sets[n][0]!.mail])) as Record<CustomerEmail, Rendered>;
}
