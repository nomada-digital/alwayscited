import type { Metadata } from "next";

import { CONTACT_EMAIL } from "@/config/contact";
import { OG_IMAGE } from "@/config/og";
import { PACK_CLUSTERS, PACK_KEYWORDS, PACK_PROMPTS, TRACKED_BASIS, TRACKED_CLUSTERS, TRACKED_PRICE, TRACKING_ENGINES, contactUrlFor, trackingPackPrice } from "@/config/pricing";
import { listOf } from "@/config/scan-shape";
import { SITE_URL } from "@/config/schema";
import { PLAN_TERMS, TRIAL, TRIAL_TERMS, trialCharge, trialLine } from "@/config/trial";
import { appUrl } from "@/lib/app-host";
import { SERP_DEPTH } from "@/lib/scan/dataforseo-request";
import { ENGINE_SPECS } from "@/lib/scan/engines";
import { TIER_PLAIN } from "@/lib/tier-text";
import { ASKS_PER_MEMBER_PER_DAY } from "@/lib/tracking/ask";
import { COMPARE_OPTIONS, YOUNG_RANGE_DAYS, presets } from "@/lib/tracking/date-range";
import { clockIn } from "@/lib/tracking/check-time";
import { UNRANKED_AS } from "@/lib/tracking/figures";
import { ANGLES, BRANDED_CHIP, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { BRANDS_NOT_READ } from "@/lib/tracking/report-csv";
import { MISSING_READS } from "@/lib/tracking/run-note";
import { LOGIN_PER_EMAIL_PER_HOUR, LOGIN_TTL_MS, SESSION_TTL_MS } from "@/lib/tracking/session";
import { INVITES_PER_OWNER_PER_DAY, MEMBERS_PER_CLIENT } from "@/lib/tracking/team";

/** A moment to show what a time looks like in each market. The zone label is clockIn's, the one the trial strip uses, never typed here (check-time.test.mts, 9 Oct 2026). */
const ZONE_EXAMPLE = "2026-10-23T05:00:00Z";

/**
 * The help centre (MK-2, 9 Oct 2026): what an alwaystracked buyer needs to
 * answer "why is this 27%?" or "why is today partial?" without writing to us.
 *
 * Every sentence here was checked against the code that does the thing on
 * 9 Oct 2026, and the facts it states are read from that code rather than
 * typed: the limits from limits.ts and team.ts, the sign-in lifetimes from
 * session.ts, the engines from pricing.ts and engines.ts, the prices from
 * pricing.ts, the trial from trial.ts, the partial sentence from run-note.ts.
 * A number in the copy below is always an interpolation. `help.test.mts`
 * holds that, and holds every control the copy names in bold (`ui`) to a
 * label the product really draws, so a renamed button fails there rather
 * than leaving the help describing a screen that no longer exists.
 *
 * Deliberately not here:
 * - a reply time. Danny reversed the one promise of that kind (R24, 26 Sep
 *   2026), so "Still stuck?" names where to write and nothing about when;
 * - agency mode. It is set per account by us, nothing public offers it, and
 *   the dashboard still carries our mark in it (`dashboardBranding` is false
 *   in config/capabilities.ts), so describing it would be a new offer. The
 *   one sentence an agency client needs - billing is handled by your account
 *   contact - is said where the dashboard says it;
 * - when the check runs. The cron is a schedule, not a promise; the help says
 *   where the dashboard shows the time a check finished, as the UI does.
 *
 * Copy is plain text, so the same strings serve the page head (where tier
 * names stay plain) and the body (where HelpShell renders them through
 * TierText). Two marks only: `[label](href)` is a link, `**label**` is a
 * control the dashboard draws, written through `ui()`.
 *
 * The copy is `helpContent(trialOn)`, built for one state of the free trial,
 * the way every other reader of config/trial.ts takes `enabled` (9 Oct 2026,
 * review of MK-2): the meta description, the owner's role and the receipt
 * sentences named the trial whatever its state, so turning it off would have
 * left /help and llms.txt offering a trial that did not exist. help.test.mts
 * builds it off and finds no trial wording. The slug `trial-and-cancelling`
 * stays in both states so a link to it keeps working; only its words change.
 */

/** A control or heading the dashboard draws, quoted. help.test.mts finds each one in the product's source. */
export const ui = (label: string) => `**${label}**`;

/** A link in the copy. */
export const link = (label: string, href: string) => `[${label}](${href})`;

export type HelpBlock = string | { list: string[] } | { steps: string[] };
export type HelpSection = { id: string; heading: string; blocks: HelpBlock[] };
export type HelpArticle = {
  slug: string;
  /** The h1, the nav label and the start of the title tag. */
  title: string;
  /** The meta description, and the article's line on the help index. */
  description: string;
  standfirst: string;
  sections: HelpSection[];
};

export const HELP_PATH = "/help";
export const helpHref = (slug: string, section?: string) => `${HELP_PATH}/${slug}${section ? `#${section}` : ""}`;

const TRACKED = TIER_PLAIN.tracked;
const MAIL = link(CONTACT_EMAIL, `mailto:${CONTACT_EMAIL}`);
const SIGN_IN = appUrl("/login", SITE_URL);

const LOGIN_MINUTES = Math.round(LOGIN_TTL_MS / 60_000);
const SESSION_DAYS = Math.round(SESSION_TTL_MS / 86_400_000);

/** The engines alwaystracked reads, split the way engines.ts reads them. */
const engineNames = (kind?: "scraper" | "model") => TRACKING_ENGINES.filter((e) => !kind || ENGINE_SPECS[e].kind === kind).map((e) => ENGINE_SPECS[e].label);
const verb = (names: string[]) => (names.length === 1 ? "is" : "are");
const READ_DIRECT = engineNames("scraper");
const ASKED_DIRECT = engineNames("model");

/** The date picker's labels, read off its own presets; the default range is the "l28" one, or "all" for a young client (date-range.ts defaultRange). */
const PRESET = Object.fromEntries(presets("2026-10-09", null).map((p) => [p.id, p.label]));
const COMPARE = COMPARE_OPTIONS.map((o) => ui(o.label));

/**
 * The worked example under the Overview's headline: invented counts, named
 * as an example on the page, so the arithmetic is shown without putting a
 * figure that reads like a client's result on a public page.
 */
const EXAMPLE = { answers: 400, named: 108 };
const EXAMPLE_PCT = Math.round((EXAMPLE.named / EXAMPLE.answers) * 100);

export type HelpContent = {
  articles: HelpArticle[];
  /** The quick answers on the help index. */
  quick: { q: string; href: string }[];
  /** The index page's head and header. */
  index: { title: string; heading: string; description: string; standfirst: string };
};

/** The help copy for one state of the free trial; the pages take the shipped one below. */
export function helpContent(trialOn: boolean = TRIAL.enabled): HelpContent {
  const articles: HelpArticle[] = [
    {
      slug: "getting-started",
      title: "Getting started",
      description: `From checkout to your first readings: the sign-in link, setting up your clusters, and when the first daily check runs on your ${TRACKED} dashboard.`,
      standfirst: "What happens between checking out and your first readings, and the few things you do in between.",
      sections: [
        {
          id: "after-checkout",
          heading: "After checkout",
          blocks: [
            `${trialOn ? "Stripe emails a receipt for each charge. On the free trial nothing is charged at checkout, so your first receipt comes with the first charge after it." : "Stripe emails your receipt."} We set up your dashboard for the website on your order, and email a sign-in link to the address you checked out with.`,
            `If you ordered from a scan, your first cluster starts from it: the scan's keyword, when it picked one, and its prompts. Otherwise it starts as ${ui("Needs a keyword")}, with any keyword you typed at checkout waiting in its keyword field.`,
            `Your plan has ${TRACKED_CLUSTERS} clusters and your dashboard starts with that one. You add the others on ${ui("Clusters")} when you are ready - see ${link("adding a cluster", helpHref("clusters", "add"))}.`,
          ],
        },
        {
          id: "sign-in",
          heading: "Signing in",
          blocks: [
            {
              steps: [
                `Go to ${link("the sign-in page", SIGN_IN)} and enter your email address.`,
                `We email you a link. It works once, for ${LOGIN_MINUTES} minutes.`,
                `Open it in the browser you want to use. You stay signed in there for ${SESSION_DAYS} days, or until you sign out.`,
              ],
            },
            `Only someone on a dashboard's team gets a link, and the page answers the same way whatever address is typed, so it never says who is a customer. If nothing arrives, check it is the address you checked out or were invited with. You can ask for up to ${LOGIN_PER_EMAIL_PER_HOUR} links an hour.`,
            `To sign out, use ${ui("Sign out")} in ${ui("Settings")}. ${ui("Sign out of every device")} ends your sessions on every browser at once.`,
          ],
        },
        {
          id: "setup",
          heading: "Setting up your clusters",
          blocks: [
            `Your first sign-in opens a page that asks you to set up your clusters. It lists your cluster with its Google keyword and its prompts, then asks you to ${ui("Review and confirm")}.`,
            `A cluster marked ${ui("Needs a keyword")} has a field to try a keyword of your own with ${ui("Check keyword")}, which checks it has Google searches and a buying intent. When it passes, you can set it on the cluster, whenever the cluster has no keyword yet.`,
            `A cluster with a keyword and no prompts yet shows ${PROMPTS_PER_CLUSTER} prompts drafted from the keyword, one per angle. Edit any of them and choose ${ui("Save these prompts")}; they are asked from the next daily check. Nothing in a cluster is checked until it has prompts.`,
            "Want something changed? Tell us before you confirm, and we make the change. Until setup is confirmed, signing in brings you back to this page. An owner or an editor confirms it.",
          ],
        },
        {
          id: "first-readings",
          heading: "Your first readings",
          blocks: [
            "The first daily check runs the day after checkout, for every prompt that is live by then. A cluster with no prompts yet is asked from the check after they are added.",
            `From then on the check runs once a day, and the top of the ${ui("Overview")} says when the last one finished. Your history starts at your first check: a day before it cannot be read later.`,
            `Next: ${link("what a cluster is", helpHref("clusters"))}, ${link("how the daily check reads each engine", helpHref("daily-check"))} and ${link("what each page of the dashboard shows", helpHref("dashboard"))}.`,
          ],
        },
      ],
    },
    {
      slug: "clusters",
      title: "Clusters, keywords and prompts",
      description: `What a cluster is in ${TRACKED}, how the keyword check works, and how adding, editing and stopping prompts and clusters changes what is read.`,
      standfirst: "A cluster is the unit your dashboard counts in: one Google keyword, and the prompts buyers ask AI about it.",
      sections: [
        {
          id: "what",
          heading: "What a cluster is",
          blocks: [
            `A cluster is one Google keyword and up to ${PROMPTS_PER_CLUSTER} prompts about it, one for each angle: ${listOf([...ANGLES])}. The prompts we draft each ask for a recommendation the way a buyer would, so they show whether the engines name you.`,
            `Every day each prompt is asked on every engine your plan reads, and the keyword is checked on Google. ${link("How the daily check works", helpHref("daily-check"))} says what that reads.`,
            `Your ${TRACKED} plan covers ${TRACKED_BASIS}. An extra tracking pack adds ${PACK_CLUSTERS} more - see ${link("Billing questions", helpHref("billing", "packs"))}. ${ui("Clusters in use")} in ${ui("Settings")} shows how many you are using.`,
          ],
        },
        {
          id: "keyword",
          heading: "The keyword check",
          blocks: [
            `Every cluster keyword has to pass ${ui("Check keyword")} first. It must:`,
            {
              list: [
                "be more than one word - a single word is too broad to place against",
                "not be your own brand or domain, which only finds people who already know you",
                "not read as a request for an explanation: a keyword that starts like a question, or asks for a guide, a definition or examples, is refused",
                "not be one you already track",
                "have measured Google searches a month in your market, and a commercial or transactional intent",
              ],
            },
            `When a keyword passes, the check shows its searches a month and its intent. When it does not, it says why, and you can choose ${ui("Ask us to pick one")} instead. Checks have a daily limit for each client; past it, try again the next day or ask us to pick one.`,
          ],
        },
        {
          id: "add",
          heading: "Adding a cluster",
          blocks: [
            {
              steps: [
                `On ${ui("Clusters")}, choose ${ui("Add a cluster")}.`,
                `Type a keyword and choose ${ui("Check keyword")}.`,
                `If it passes, we draft ${PROMPTS_PER_CLUSTER} prompts from it, one per angle. Edit any of them.`,
                `Choose ${ui("Start tracking this cluster")}.`,
              ],
            },
            "The new cluster is asked from the next daily check. Until its first reading, its prompts can still be edited and its keyword changed.",
            "When every cluster in your plan is in use, there is no room for another until you stop one or add a pack. Owners and editors add clusters; viewers cannot.",
          ],
        },
        {
          id: "change",
          heading: "Editing and stopping",
          blocks: [
            "A prompt's text can be edited until its first reading. After that it is fixed, so its history stays true to what was asked: to ask something else, stop it and add a new one.",
            `A cluster's keyword works the same way. ${ui("Change keyword")} is there until the cluster's first reading; after that, stop the cluster and add a new one.`,
            `${ui("Stop")} is on every prompt and every cluster. A stop takes effect from the next daily check: today's readings stay in your figures, and until the next check the row has ${ui("Undo")}. Stopping a cluster stops its keyword and all its prompts.`,
            "Stopping never deletes anything. A stopped prompt's history stays in your reports, and its place in the cluster is free at once for a new prompt. Once a stop has taken effect it cannot be undone; add the prompt again as a new one.",
            "Every change - an added cluster, an edited prompt, a stop - starts at the next daily check.",
          ],
        },
        {
          id: "branded",
          heading: "Prompts that name your brand",
          blocks: [
            `A prompt that names your brand will nearly always get answers that name you, so it lifts your figures without measuring what a buyer asks. You can still track one if you choose; it carries a ${ui(BRANDED_CHIP)} chip so it stands out.`,
          ],
        },
        {
          id: "ungrouped",
          heading: "Ungrouped prompts",
          blocks: [
            `Some dashboards have prompts in no cluster, listed as ungrouped on ${ui("Clusters")}. They are asked every day like the rest. Owners and editors can stop one, or pick a cluster with room and choose ${ui("Move")}.`,
          ],
        },
      ],
    },
    {
      slug: "daily-check",
      title: "How the daily check works",
      description: `What ${TRACKED} reads every day, how each AI engine is asked, what counts as naming you, and what a partial or failed check means for your figures.`,
      standfirst: "Once a day we ask every live prompt on each of your plan's engines and check every cluster keyword on Google. This is what that reads, and what happens when part of it does not come back.",
      sections: [
        {
          id: "what",
          heading: "What is read each day",
          blocks: [
            `Every live prompt is asked on ${listOf(engineNames())}, and every cluster keyword is checked on Google. Every read is made for your market, the US or the UK. ${ENGINE_SPECS.claude.label} is added on ${TIER_PLAIN.mentioned} and above.`,
            `The check runs once a day. The top of the ${ui("Overview")} says when the last one finished, and ${ui("Settings")} shows when the next is due. Reads that did not come back on a day are not filled in later, and a day before your first check cannot be read.`,
          ],
        },
        {
          id: "engines",
          heading: "How each engine is read",
          blocks: [
            `${listOf(READ_DIRECT)} ${verb(READ_DIRECT)} read from the product a buyer uses. ${listOf(ASKED_DIRECT)} ${verb(ASKED_DIRECT)} asked through ${ASKED_DIRECT.length === 1 ? "its" : "their"} model directly, not read from ${ASKED_DIRECT.length === 1 ? "its app" : "their apps"}; so ${ASKED_DIRECT.length === 1 ? "is" : "are"} ${ENGINE_SPECS.claude.label} on the higher plans.`,
            "When a Google results page carries no AI Overview for a prompt, we record no answer for that day, not a miss.",
            "What we keep of each answer is what each engine said, with link addresses taken out of the text, and the pages it cited, kept separately. Both are kept for the life of the account.",
          ],
        },
        {
          id: "named",
          heading: "What counts as naming you",
          blocks: [
            `An answer names you when its text uses one of the names in ${ui("Settings")}, under ${ui("Names we match")}: your brand, and any other spellings we have set. A name that appears only inside a link's web address does not count.`,
            `We set those names, not you, because each one changes what being named means. To change them, use ${ui("Ask us to change these")} in ${ui("Settings")}.`,
            `The other brands in each answer are read from the same text and matched the same way. They make up share of voice and ${ui("Who is named")}. Being cited is separate: a page of yours an answer cites is counted on ${ui("Cited pages")}, whether or not the text named you.`,
          ],
        },
        {
          id: "no-answer",
          heading: "No answer is not a miss",
          blocks: [
            "If an engine gives no answer to a prompt on a day, that read is left out of the figures for that day. It does not count against you. So each engine's figures are out of the days it answered, which is why one engine can show fewer days than another for the same prompt.",
          ],
        },
        {
          id: "partial",
          heading: "Complete, partial and failed checks",
          blocks: [
            "Each day's check ends in one of these ways:",
            {
              list: [
                "Complete: every read came back.",
                "Partial: some reads failed even after retrying, or the other brands could not be read in some answers.",
                "Failed: none of the reads came back, or the check stopped before it finished.",
              ],
            },
            "A read fails when the request for it errors or runs out of time. A read that fails on a temporary error is retried while the check has time left.",
            `Every dashboard page with dates names, at the top, each check in its range that lost reads - partial or failed - with the day and, where it can, the engine or the Google keyword positions that lost them. A partial check's note ends: "${MISSING_READS}"`,
            "That is the rule everywhere: a read that did not come back is left out, never counted as a miss against you. It does mean that day's figures rest on fewer answers.",
            `If only the other brands could not be read, every read came back. Those answers still count towards whether you were named, but are left out of share of voice and ${ui("Who is named")}, and those pages say how many answers were left out.`,
            `When today's check failed, the ${ui("Overview")} says so and says which day your figures run to. A check that failed part way through says it did not finish, and the reads it stored before it stopped are in your figures. On one cluster's page, ${ui("Latest answers")} shows the last check with an answer, and says why when a later check in the range failed.`,
          ],
        },
        {
          id: "google",
          heading: "Google positions",
          blocks: [
            `Each cluster keyword is checked in Google's organic results for your market, down to position ${SERP_DEPTH}. The position is where your site's best-ranking page sits, and the dashboard shows which page that is.`,
            `Outside the top ${SERP_DEPTH} is a reading, not a gap: the Keywords CSV leaves the position blank, and an average position counts it as #${UNRANKED_AS}, so dropping out makes the average worse rather than better.`,
            // 13 Oct 2026 (Danny: a keyword we read outside the top 20 showed 3rd in a signed-in browser). The
            // request, read in dataforseo-request.ts keywordRankRequest that day: Google organic results, location_code
            // by the client's market, desktop, depth SERP_DEPTH, and nothing else - no account, cookie or history.
            // Google's side is Google's own page, "Why your Google Search results differ from others"
            // (support.google.com/websearch/answer/12412910, no updated date shown, read 13 Oct 2026): personalisation
            // from account activity applies to signed-in users with it turned on; location and device change results too.
            "Each reading is a Google search for your market, the UK or the US, made on desktop with no Google account or search history behind it, so it is not personalised. A search you make yourself can show you in a different place: Google says a signed-in person's results can be personalised from their own activity, and that location and device change results too.",
          ],
        },
      ],
    },
    {
      slug: "dashboard",
      title: "Reading your dashboard",
      description: `What every page of the ${TRACKED} dashboard shows, how each figure is counted, and how the date range and the comparison work.`,
      standfirst: "Figures in the dashboard are counted from stored readings, and come with what they were counted out of: beside the figure, or in a line that shows when you hover over it.",
      sections: [
        {
          id: "range",
          heading: "Dates and comparisons",
          blocks: [
            `Every page with dates opens on ${ui(PRESET.l28!)}, compared with the period before - or, while your tracking is under ${YOUNG_RANGE_DAYS} days old, on ${ui(PRESET.all!)}. The date button changes both: pick a preset such as ${ui(PRESET.l7!)} or ${ui(PRESET.all!)}, or any days since tracking began, then what to compare with: ${COMPARE.slice(0, -1).join(", ")} or ${COMPARE[COMPARE.length - 1]}.`,
            "When the comparison would reach back before your first check, the figures are compared with your first week instead, and the page says so. Until your first week is over, they are compared with your first reading, and a range that ends on your first reading has nothing to compare yet. Every change says what it is compared with, and from which date.",
            "The range is in the page's address, so a link you share or bookmark opens on the same dates, and it stays with you as you move between pages.",
            `On the ${ui("Overview")}, every change is like-for-like: it counts only the clusters tracked for the whole of both periods, so a cluster added part way through does not move it.`,
          ],
        },
        {
          id: "overview",
          heading: "Overview",
          blocks: [
            "The headline - named in some percentage of AI answers - is the answers that named you, out of every answer an engine gave in the range, across all your clusters, prompts and engines. Reads that got no answer are not in it. Under it is the same figure like-for-like, and its change.",
            `For example, with invented numbers: if your prompts drew ${EXAMPLE.answers} answers in the range and ${EXAMPLE.named} of them named you, the headline reads ${EXAMPLE_PCT}%.`,
            {
              list: [
                `${ui("Answers naming you")}: the headline figure, with its count.`,
                `${ui("Prompts you are named in")}: prompts that named you at least once, on any engine, out of the prompts with an answer in the range.`,
                `${ui("Share of voice")}: your mentions out of every brand mention in your answers - one answer naming a brand is one mention - and your rank among the brands named.`,
                `${ui("Cluster keywords on page 1")}: keywords whose latest Google position in the range is on the first page, and the average position of all of them.`,
              ],
            },
            `${ui("Every daily check, by cluster")} has one row per cluster and one cell per day, shaded by the share of that cluster's answers that named you that day.`,
            `${ui("Your clusters")} gives each cluster's figure, by angle, with its Google position; pick one to chart it, and ${ui("Open cluster")} goes to its own page. ${ui("Who is named instead")} and ${ui("Pages the engines cite most")} are the top of ${ui("Who is named")} and ${ui("Cited pages")}, below.`,
          ],
        },
        {
          id: "clusters-page",
          heading: "Clusters and one cluster",
          blocks: [
            `${ui("Clusters")} lists every cluster with its keyword and prompts, and is where you add, edit and stop them - see ${link("Clusters, keywords and prompts", helpHref("clusters"))}. Beside each prompt, the number by each engine is the days it named you, out of the days that engine answered. If an engine missed some of the prompt's days, the row reads "of up to" the days checked, so no count is read against a day that engine gave no answer.`,
            `One cluster's page has its figures and chart, its prompts, ${ui("Every check, day by day")}, and ${ui("Latest answers")}: what each engine said at the latest check, with the pages it cited and the brands it named. Owners and editors can ${ui("Add a note")}, dated, on a prompt; everyone sees the ${ui("Notes on this cluster")}.`,
          ],
        },
        {
          id: "named-page",
          heading: "Who is named",
          blocks: [
            `${ui("Who is named")} lists every brand the engines name in answers to your prompts, with its share of every brand mention and its change. Filter it by engine, or search for a brand.`,
          ],
        },
        {
          id: "cited-page",
          heading: "Cited pages",
          blocks: [
            `${ui("Cited pages")} lists every page the engines cite in answers to your prompts: how many times, on which engines and for how many prompts. Filter to ${ui("Your site")} or ${ui("Other sites")}. Pages are shown as host and path, without query strings.`,
          ],
        },
        {
          id: "reports",
          heading: "Reports and CSV downloads",
          blocks: [
            `${ui("Reports")} downloads any range, or a month at a time:`,
            {
              list: [
                `${ui("Answers CSV")}: one row per prompt, engine and day - the date, the cluster and its keyword, the angle, the prompt, the engine, whether it answered, whether it named you, the brands it named and the pages it cited. An answer whose other brands could not be read says ${BRANDS_NOT_READ} among its brands.`,
                `${ui("Keywords CSV")}: each cluster keyword's Google position per day, blank where it was not in the top ${SERP_DEPTH}.`,
              ],
            },
            "A plan with placements gets a Placements CSV as well. Each month's card gives that month's figures beside its files, and anyone on the team can download, viewers included.",
          ],
        },
        {
          id: "settings",
          heading: "Settings",
          blocks: [
            `${ui("Settings")} has your plan and its clusters in use, the names we match, your team, billing and signing out. See ${link("Team and roles", helpHref("team"))} and ${link("Billing questions", helpHref("billing"))}.`,
          ],
        },
      ],
    },
    {
      slug: "team",
      title: "Team and roles",
      description: `Who can see and change an ${TRACKED} dashboard: owners, editors and viewers, inviting and removing people, and dashboards with more than one website.`,
      standfirst: "A dashboard belongs to an account, and everyone on the account's team signs in with their own email address.",
      sections: [
        {
          id: "roles",
          heading: "Owners, editors and viewers",
          blocks: [
            {
              list: [
                `Owner: everything an editor can do, plus inviting people, changing roles, removing people${trialOn ? ", cancelling a free trial" : ""} and asking us about billing.`,
                "Editor: adds, edits and stops clusters and prompts, checks keywords, adds notes and confirms setup.",
                "Viewer: reads every page and downloads the CSVs, and changes nothing that is tracked.",
              ],
            },
            `Owners are set up by us. If you need another, write to ${MAIL}. Owners can switch someone between editor and viewer and remove anyone but themselves, and a dashboard always keeps at least one owner.`,
          ],
        },
        {
          id: "invite",
          heading: "Inviting someone",
          blocks: [
            {
              steps: [
                `In ${ui("Settings")}, under ${ui("Team")}, choose ${ui("Invite someone")}. Only owners see it.`,
                "Enter their email address and pick Editor or Viewer.",
                `If your account has more than one website, choose under ${ui("Who they see")}: only the website you are in, or every website on the account, including any added later.`,
                `Choose ${ui("Send invite")}. We email them, and they sign in with that address.`,
              ],
            },
            `Each website has at most ${MEMBERS_PER_CLIENT} people on its team, and each owner can send up to ${INVITES_PER_OWNER_PER_DAY} invites a day. Someone who was removed can be invited again.`,
          ],
        },
        {
          id: "remove",
          heading: "Changing a role, or removing someone",
          blocks: [
            `An owner has ${ui("Make viewer")} or ${ui("Make editor")} beside each editor and viewer, and ${ui("Remove")} beside anyone else on the team, which asks you to confirm. A removed person loses access at once. Nothing they did is undone: the clusters, prompts and history stay as they are.`,
          ],
        },
        {
          id: "websites",
          heading: "More than one website",
          blocks: [
            "An account can hold more than one website. Each person sees the websites they were invited to: one, or every website on the account, which includes any added later. Owners see them all. Switch between the websites you can see from the list in the sidebar.",
          ],
        },
        {
          id: "sign-in",
          heading: "Signing in and out",
          blocks: [
            `Everyone signs in with a link we email them: see ${link("Signing in", helpHref("getting-started", "sign-in"))}. ${ui("Sign out of every device")}, in ${ui("Settings")}, ends your sessions on every browser at once.`,
          ],
        },
      ],
    },
    {
      slug: "trial-and-cancelling",
      title: trialOn ? "The free trial, and cancelling" : "Cancelling your plan",
      description: trialOn
        ? `How the ${TRACKED} ${TRIAL.days}-day free trial works, how an owner cancels it in Settings > Billing, how a paid plan is stopped, and what happens to your data when tracking ends.`
        : `How an ${TRACKED} plan is stopped, and what happens to your data when tracking ends.`,
      standfirst: trialOn
        ? "How the free trial works, how to cancel it before the first charge, and what happens when tracking ends."
        : "How a plan is stopped, and what happens when tracking ends.",
      sections: [
        ...(trialOn
          ? [
              {
                id: "trial",
                heading: "How the trial works",
                blocks: [{ list: [...TRIAL_TERMS] }] as HelpBlock[],
              },
              {
                id: "trial-date",
                heading: "Where to see when it ends",
                blocks: [
                  `While the trial runs, a strip across the top of every dashboard page says how many days are left and when the trial ends. Settings shows the same moment and what the first charge will be. Both are in your market's time, written like ${clockIn(ZONE_EXAMPLE, "uk")} on a UK plan and ${clockIn(ZONE_EXAMPLE, "us")} on a US one.`,
                ] as HelpBlock[],
              },
              {
                id: "cancel-trial",
                heading: "Cancelling during the trial",
                blocks: [
                  {
                    steps: [
                      `Sign in as an owner and open ${ui("Settings")}.`,
                      `Under ${ui("Billing")}, choose ${ui("Cancel trial")}.`,
                      `Choose ${ui("Yes, cancel the trial")}.`,
                    ],
                  },
                  "Tracking carries on until the trial ends, then stops, and nothing is charged. Settings and the strip at the top of each page then say when tracking stops.",
                  `Only an owner can cancel; editors and viewers are told to ask one. If the cancellation does not go through, Settings says so: try again, or use ${ui("Ask us")} or write to ${MAIL}, and we cancel it.`,
                ] as HelpBlock[],
              },
            ]
          : []),
        {
          id: "paid",
          heading: "Stopping a paid plan",
          blocks: [
            `${trialOn ? "Once the first charge is taken, there" : "There"} is no cancel button in the dashboard. The plan's terms are ${PLAN_TERMS}. To stop it, an owner uses ${ui("Ask us")} under ${ui("Billing")} in ${ui("Settings")}, or writes to ${MAIL}.`,
            "If your Settings says billing is handled by your account contact, your plan is billed through them: ask them instead.",
          ],
        },
        {
          id: "ended",
          heading: "When tracking ends",
          blocks: [
            "When a plan ends, no more checks run. Everything read so far stays in the dashboard: anyone on the team can still sign in, read it and download it. The dashboard says tracking has ended, and an owner can ask us to restart it.",
          ],
        },
        {
          id: "data",
          heading: "Your data",
          blocks: [
            "Stopping a prompt or a cluster deletes nothing, and neither does a plan ending: on a tracked account, what each engine said every day is kept for the life of the account.",
            `To keep your own copy, download the CSVs from ${ui("Reports")}. To have your data deleted, see ${link("your rights in our privacy policy", "/legal#rights")}.`,
          ],
        },
      ],
    },
    {
      slug: "billing",
      title: "Billing questions",
      description: `What ${TRACKED} costs, how tax and receipts work, adding extra tracking packs, and who to ask about a charge or your card.`,
      standfirst: "What you pay, what Stripe sends you, and who to ask when something about a charge needs changing.",
      sections: [
        {
          id: "price",
          heading: "What you pay",
          blocks: [
            `You pay ${trialCharge("us", TRACKED_PRICE)} for ${TRACKED} on a US plan, or ${trialCharge("uk", TRACKED_PRICE)} on a UK one.${trialLine("tracked", trialOn) ? ` ${trialLine("tracked", trialOn)}` : ""}`,
            "A US plan is billed in dollars and a UK plan in pounds. Prices are before tax: at checkout, Stripe works out any tax due from your billing address and adds it, and a business can add its tax ID.",
            `Each website you track is its own plan, with its own subscription and its own charge. ${trialOn ? "Stripe emails a receipt for each charge; nothing is charged during the free trial, so it has none." : "Stripe emails your receipt."}`,
          ],
        },
        {
          id: "packs",
          heading: "Extra clusters",
          blocks: [
            `An extra tracking pack adds ${PACK_CLUSTERS} clusters - ${PACK_PROMPTS} prompts and ${PACK_KEYWORDS} keywords - for ${trackingPackPrice("US")} a month on a US plan, or ${trackingPackPrice("UK")} on a UK one.`,
            `Packs are added on request: use the link in your dashboard's plan panel, or ${link("ask us", contactUrlFor("tracked"))}. Once a pack is on your subscription, your cluster limit rises, and ${ui("Clusters in use")} in ${ui("Settings")} shows the new total.`,
          ],
        },
        {
          id: "questions",
          heading: "Your card, a charge, or your plan",
          blocks: [
            `There is no page in the dashboard for changing your card or your plan yourself. For anything about a charge, your card or your plan, an owner uses ${ui("Ask us")} under ${ui("Billing")} in ${ui("Settings")}: it tells us you have a billing question, and we reply to the email address you sign in with. Or write to ${MAIL}.`,
            `Each person can send up to ${ASKS_PER_MEMBER_PER_DAY} asks a day from the dashboard, across all its ask buttons.`,
            "If your Settings says billing is handled by your account contact, your plan is billed through them: ask them instead.",
            `Other plans are on ${link("the packages page", "/packages")}. To move to one, ask us the same way.`,
          ],
        },
        {
          id: "cancel",
          heading: "Cancelling",
          blocks: [
            `${trialOn ? "Cancelling a free trial, stopping a paid plan" : "Stopping a plan"} and what happens to your data are on ${link(trialOn ? "The free trial, and cancelling" : "Cancelling your plan", helpHref("trial-and-cancelling"))}.`,
          ],
        },
      ],
    },
  ];

  /** The quick answers on the help index: the questions MK-2 was written for, first. */
  const quick = [
    { q: "Why does a page say a check was partial?", href: helpHref("daily-check", "partial") },
    { q: "What does the headline percentage count?", href: helpHref("dashboard", "overview") },
    { q: "What counts as an answer naming us?", href: helpHref("daily-check", "named") },
    { q: "How do I add a cluster?", href: helpHref("clusters", "add") },
    ...(trialOn ? [{ q: "How do I cancel the free trial?", href: helpHref("trial-and-cancelling", "cancel-trial") }] : []),
    { q: "How do I invite someone to the dashboard?", href: helpHref("team", "invite") },
    { q: "How do I download the data?", href: helpHref("dashboard", "reports") },
  ];

  const index = {
    title: `${TRACKED} help`,
    heading: `Help with ${TRACKED}`,
    description: `Help with ${TRACKED}: getting started, clusters, the daily check and partial days, reading the dashboard, team and roles, ${trialOn ? "the free trial, cancelling" : "cancelling"} and billing.`,
    standfirst: `How the daily check reads the engines, what each figure in your dashboard counts, and how setup, ${trialOn ? "your team, the trial and billing" : "your team and billing"} work.`,
  };

  return { articles, quick, index };
}

const SHIPPED = helpContent();
export const HELP: HelpArticle[] = SHIPPED.articles;
export const QUICK = SHIPPED.quick;
export const HELP_INDEX = SHIPPED.index;

/** "Still stuck?": where to write, and nothing about when. */
export const STILL_STUCK = `Send your question to ${MAIL}, or through ${link("the contact form", "/contact")}. For billing, an owner can also use ${ui("Ask us")} under ${ui("Billing")} in ${ui("Settings")}.`;

export const SIGN_IN_HREF = SIGN_IN;

export function helpArticle(slug: string): HelpArticle {
  const a = HELP.find((x) => x.slug === slug);
  if (!a) throw new Error(`no help article "${slug}"`);
  return a;
}

/** The head every help page carries: the page's own canonical and og:url, and the site's card. */
function head(path: string, title: string, description: string): Metadata {
  const url = SITE_URL + path;
  return { title, description, alternates: { canonical: url }, openGraph: { url, images: OG_IMAGE } };
}

export const helpIndexMetadata = (): Metadata => head(HELP_PATH, HELP_INDEX.title, HELP_INDEX.description);

export function helpMetadata(slug: string): Metadata {
  const a = helpArticle(slug);
  return head(helpHref(slug), `${a.title} - ${HELP_INDEX.title}`, a.description);
}
