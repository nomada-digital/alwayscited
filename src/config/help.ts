import type { Metadata } from "next";

import { CONTACT_EMAIL } from "@/config/contact";
import { OG_IMAGE } from "@/config/og";
import { PACK_CLUSTERS, PACK_KEYWORDS, PACK_PROMPTS, TRACKED_BASIS, TRACKED_PRICE, TRACKING_ENGINES, trackingPackPrice } from "@/config/pricing";
import { listOf } from "@/config/scan-shape";
import { SITE_URL } from "@/config/schema";
import { KEPT_DAYS } from "@/config/retention";
import { PLAN_TERMS, TRIAL, TRIAL_TERMS, trialCharge, trialLine } from "@/config/trial";
import { dashOrigin } from "@/lib/dash/host";
import { SERP_DEPTH } from "@/lib/scan/dataforseo-request";
import { ENGINE_SPECS } from "@/lib/scan/engines";
import { TIER_PLAIN } from "@/lib/tier-text";
import { clockIn } from "@/lib/tracking/check-time";
import { ANGLES, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { LOGIN_PER_EMAIL_PER_HOUR, LOGIN_TTL_MS, SESSION_TTL_MS } from "@/lib/tracking/session";
import { INVITES_PER_OWNER_PER_DAY, MEMBERS_PER_CLIENT } from "@/lib/tracking/team";

/** A moment to show what a time looks like in each market. The zone label is clockIn's, the one the trial strip uses, never typed here (check-time.test.mts, 9 Oct 2026). */
const ZONE_EXAMPLE = "2026-10-23T05:00:00Z";

/**
 * The help centre (MK-2, 9 Oct 2026): what an alwaystracked buyer needs to
 * answer "why is this 27%?" or "why did today's reading not count?" without
 * writing to us.
 *
 * 19 Oct 2026 (Danny: "update the help centre and anything else customer-facing
 * that references the old dashboard"): rewritten for the dashboards host, the
 * one customer dashboard since /app was retired (c7670f5). Every step, label
 * and screen name below was read off src/app/dashboards and src/components/dash
 * that day - the sidebar in Shell.tsx, setup in SetupWizard.tsx, the cluster
 * menus in ClusterEditor.tsx, ClustersBoard.tsx, KeywordManager.tsx and
 * PromptManager.tsx, Settings and Plan. What only /app drew is not described
 * as existing: CSV downloads and the Reports page, cluster notes, signing out
 * of every device, the separate cancel-trial button (a trial is now cancelled
 * through Plan's Open billing, Stripe's billing page), the names-we-match and
 * ask-us panels of Settings, the date-range picker and the partial-check notes,
 * and the Who is named and Cited pages screens (their content is on AI
 * visibility and Sources). Where a reader would look for one, the copy says
 * what to do instead - usually to write to us - and offers nothing new.
 *
 * As before, the facts it states are read from the code that does the thing
 * rather than typed: the limits from limits.ts and team.ts, the sign-in
 * lifetimes from session.ts, the engines from pricing.ts and engines.ts, the
 * prices and packs from pricing.ts, the trial from trial.ts. A number in the
 * copy below is always an interpolation. `help.test.mts` holds that, and holds
 * every control the copy names in bold (`ui`) to a label the dashboards host
 * really draws, so a renamed button fails there rather than leaving the help
 * describing a screen that no longer exists.
 *
 * Deliberately not here:
 * - a reply time. Danny reversed the one promise of that kind (R24, 26 Sep
 *   2026), so "Still stuck?" names where to write and nothing about when;
 * - agency mode. It is set per account by us, nothing public offers it, and
 *   the dashboard still carries our mark in it (`dashboardBranding` is false
 *   in config/capabilities.ts), so describing it would be a new offer. The one
 *   sentence an agency client needs - a plan billed through an account contact
 *   is cancelled through them - is said where cancelling is;
 * - when the check runs. The cron is a schedule, not a promise; the help says
 *   where the dashboard shows the last and next check, as the Overview does;
 * - labels drawn from a template (the paid plan's own tab, "Your alwaystracked
 *   view", "Also track ... (free)", the pack button with its price). They are
 *   described in words, outside `ui()`, because rule 2 can only find a label
 *   the code writes out whole.
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
/** The dashboards host's sign-in page (19 Oct 2026: /app/login only 308s there). */
const SIGN_IN = `${dashOrigin()}/login`;

const LOGIN_MINUTES = Math.round(LOGIN_TTL_MS / 60_000);
const SESSION_DAYS = Math.round(SESSION_TTL_MS / 86_400_000);

/** The engines alwaystracked reads, split the way engines.ts reads them. */
const engineNames = (kind?: "scraper" | "model") => TRACKING_ENGINES.filter((e) => !kind || ENGINE_SPECS[e].kind === kind).map((e) => ENGINE_SPECS[e].label);
const verb = (names: string[]) => (names.length === 1 ? "is" : "are");
const READ_DIRECT = engineNames("scraper");
const ASKED_DIRECT = engineNames("model");

/** The plans we work clusters on (lib/dash/types.ts MANAGED_TIERS), named plainly. */
const WORKED = listOf([TIER_PLAIN.mentioned, TIER_PLAIN.cited, TIER_PLAIN.everywhere]);

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
            "If you ordered from a scan, your first cluster starts from it: the scan's keyword, when it picked one. Otherwise the cluster waits for a keyword, with any keyword you typed at checkout already in its keyword field.",
            `Your plan covers ${TRACKED_BASIS}, shared across your clusters. You add clusters on ${ui("Clusters")} when you are ready - see ${link("adding a cluster", helpHref("clusters", "add"))}.`,
          ],
        },
        {
          id: "sign-in",
          heading: "Signing in",
          blocks: [
            {
              steps: [
                `Go to ${link("the sign-in page", SIGN_IN)}, enter your email address and choose ${ui("Email me a sign-in link")}.`,
                `We email you a link. It works once, for ${LOGIN_MINUTES} minutes.`,
                `Open it in the browser you want to use and choose ${ui("Sign in")}. You stay signed in there for ${SESSION_DAYS} days, or until you sign out.`,
              ],
            },
            `Only someone on a dashboard's team gets a link, and the page answers the same way whatever address is typed, so it never says who is a customer. If nothing arrives, check it is the address you checked out or were invited with. You can ask for up to ${LOGIN_PER_EMAIL_PER_HOUR} links an hour.`,
            `To sign out, use ${ui("Sign out")} at the foot of the sidebar. It signs out the browser you are in; any other browser stays signed in until its own sign-in runs out or you sign out there too.`,
          ],
        },
        {
          id: "setup",
          heading: "Setting up your clusters",
          blocks: [
            "Until setup is confirmed, opening your dashboard takes owners and editors to the setup page. It has one card per cluster, done in this order:",
            {
              steps: [
                `The Google keyword. Type it and choose ${ui("Check on Google")}: it checks the keyword has Google searches and a buying intent, and says where you rank for it now and with which page. When it passes, choose ${ui("Use this keyword")}. If the keyword has a plural or singular, the card offers to target that too, ticked, at no extra charge - see ${link("singular and plural", helpHref("clusters", "plural"))}.`,
                `The target page: the one page on your site the cluster should rank and be cited with. ${ui("Where does it rank?")} shows where that page sits on Google for the keyword, and if another page of yours ranks better, ${ui("Use it")} swaps it in. Choose ${ui("Set target page")}. It is required on a cluster we work on, and optional on one you only track - see ${link("target pages", helpHref("clusters", "target"))}.`,
                `The prompts. The card drafts ${PROMPTS_PER_CLUSTER} questions buyers ask, from the keyword, one per angle. Edit any of them, then choose ${ui("Save these prompts")}. Nothing in a cluster is asked until its prompts are saved.`,
              ],
            },
            `When every card is done, choose ${ui("Confirm and start tracking")}. Until then the page lists what is still to do. An owner or an editor confirms it; viewers see the dashboard, not setup.`,
            "Want something changed, or a keyword picked for you? Tell us before you confirm, and we make the change.",
          ],
        },
        {
          id: "first-readings",
          heading: "Your first readings",
          blocks: [
            "A saved prompt and a checked keyword are read from the next morning's check. A cluster with no prompts yet is asked from the check after they are saved.",
            `From then on the check runs once a day, and the top of the ${ui("Overview")} says when the last one ran and when the next is due. Your history starts at your first check: a day before it cannot be read later.`,
            `Next: ${link("what a cluster is", helpHref("clusters"))}, ${link("how the daily check reads each engine", helpHref("daily-check"))} and ${link("what each page of the dashboard shows", helpHref("dashboard"))}.`,
          ],
        },
      ],
    },
    {
      slug: "clusters",
      title: "Clusters, keywords and prompts",
      description: `What a cluster is in ${TRACKED}, how the keyword check, keyword groups, singular and plural forms and target pages work, and how adding, editing and stopping changes what is read.`,
      standfirst: "A cluster is the unit your dashboard counts in: one search you want to win, the keywords that mean the same thing, and the prompts buyers ask AI about it.",
      sections: [
        {
          id: "what",
          heading: "What a cluster is",
          blocks: [
            "A cluster starts from one Google keyword: the search you most want to win. Inside it, keyword groups gather the other searches that mean the same thing, and each group can have keywords tracked on Google and prompts asked of AI.",
            `The prompts we draft each ask for a recommendation the way a buyer would, one for each angle: ${listOf([...ANGLES])}. So they show whether the engines name you.`,
            `Every day each live prompt is asked on every engine your plan reads, and each tracked keyword is checked on Google. ${link("How the daily check works", helpHref("daily-check"))} says what that reads.`,
            `Your ${TRACKED} plan covers ${TRACKED_BASIS}. Keywords and prompts are one allowance for the whole website, not a fixed number per cluster, so one cluster can hold more than another. The meters at the foot of the sidebar, and ${ui("Allowances")} on ${ui("Plan")}, show how much is in use. An extra tracking pack adds more - see ${link("Billing questions", helpHref("billing", "packs"))}.`,
          ],
        },
        {
          id: "keyword",
          heading: "The keyword check",
          blocks: [
            `A cluster's keyword is checked in setup, with ${ui("Check on Google")}. It must:`,
            {
              list: [
                "be more than one word - a single word is too broad to place against",
                "not be your own brand or domain, which only finds people who already know you",
                "not read as a request for an explanation: a keyword that starts like a question, or asks for a guide, a definition or examples, is refused",
                "not be one you already track",
                "have measured Google searches a month in your market, and a commercial or transactional intent",
              ],
            },
            `When a keyword passes, the check shows its searches a month and where you rank for it now. When it does not, it says why. Checks have a daily limit for each client; past it, try again the next day. If no keyword you try passes, write to ${MAIL} and we pick one with you.`,
            "Keywords you track later, from a cluster's page or from Search positions, are not put through this check: they are tracked as you type them.",
          ],
        },
        {
          id: "plural",
          heading: "Singular and plural",
          blocks: [
            "Buyers search both forms of a keyword, and Google can rank different pages for each. So when a keyword has a plural (or a singular), we offer to track that form too, free: it does not use a keyword from your plan, it sits in the same cluster, it shares the cluster's target page, and it is checked on Google beside the keyword, each with its own position. Neither is averaged into the other.",
            `It is offered, ticked, in setup, and under the keyword when you add a ${ui("New cluster")}. For a keyword you already track, its menu on the cluster's page or on ${ui("Search positions")} offers to also track the other form, marked free. A tracked form shows as plural, free or singular, free beside its keyword.`,
            "When Google treats both forms as one search - most of the same pages rank for both - setup says so: one page may rank for both, and tracking both still shows each position on its own.",
          ],
        },
        {
          id: "target",
          heading: "Target pages",
          blocks: [
            "Each cluster has one target page: the page on your own site it should rank and be cited with. Every placement and link insertion we make for the cluster links to it, so it is chosen once, for the cluster, not per placement.",
            `On a cluster we work on (${WORKED}) the target page is required: setup cannot be confirmed without it. On a cluster you only track it is optional. The cluster's card on ${ui("Clusters")} and its own page show the target page, or say it is not chosen yet.`,
            `The page has to be on your website. To change it later, open your dashboard's setup page - its address is your dashboard's with /setup on the end - and choose ${ui("Change target page")}, or write to ${MAIL}.`,
          ],
        },
        {
          id: "add",
          heading: "Adding a cluster",
          blocks: [
            {
              steps: [
                `On ${ui("Clusters")}, choose ${ui("New cluster")}.`,
                "Type the keyword, and a name if you want one other than the keyword. Leave the other form ticked to track it free.",
                `Choose ${ui("Add cluster")}.`,
                `Open the cluster and add its groups, keywords and prompts - see ${link("keyword groups", helpHref("clusters", "groups"))}.`,
              ],
            },
            "The new cluster's keyword is checked on Google from the next morning's check, and its prompts are asked once you add them.",
            "When every cluster on your plan is in use, an owner sees a button to add more clusters in place of New cluster, which adds a tracking pack. Owners and editors add clusters; viewers cannot.",
          ],
        },
        {
          id: "groups",
          heading: "Keyword groups",
          blocks: [
            `A group is one way of searching for the same thing - "staffing agencies" beside "recruitment agencies". On a cluster's page, under ${ui("Keyword groups")}, choose ${ui("Add group")}, name it and give it the words to match. The keywords you rank for that contain those words, from your monthly ranking snapshot, sort themselves into it; choose ${ui("Track")} beside one to check it on Google every day.`,
            `Each group has its own field to add a keyword or a prompt. Keywords and prompts in no group are listed under ${ui("Not in a group")}. Move one by dragging it, or from its menu with ${ui("Move to group")} or ${ui("Move to cluster")}.`,
            `A group's menu has ${ui("Rename")}, ${ui("Add a note")} - a line on who searches this way and why it matters - and ${ui("Remove group")}, which keeps its keywords and prompts tracked.`,
          ],
        },
        {
          id: "change",
          heading: "Editing and stopping",
          blocks: [
            `A prompt is edited in place: choose its text, or ${ui("Edit")} from its menu. A prompt with no readings yet is simply changed. Once it has readings, saving starts a new prompt in its place, so the old one's history stays true to what was asked, and the old history is kept.`,
            `${ui("Stop tracking")} is in every keyword's and every prompt's menu. To stop a whole cluster, use ${ui("Stop tracking this cluster")} in its menu on ${ui("Clusters")}: that stops its keywords and prompts too.`,
            `A stop takes effect from the next morning's check: today's readings stay in your figures, and the message that confirms the stop has ${ui("Undo")}. After that, add the keyword or prompt again as a new one.`,
            "Stopping never deletes anything. A stopped prompt's history stays in your dashboard, and its place in your allowance is free at once.",
            "Every change - an added cluster, a new keyword, an edited prompt, a stop - is read from the next morning's check.",
          ],
        },
        {
          id: "worked",
          heading: "Clusters we work on",
          blocks: [
            `On ${WORKED}, the clusters we place for are marked ${ui("Managed by us")}, and a tab in the sidebar under your plan's name lists them with what the plan delivers on each this month. Each month's placements are built around the cluster's keyword, so that keyword changes on request, from your next billing date: use ${ui("Ask to swap")} on that tab. Inside a cluster we work on, you can change groups, keywords and prompts whenever you like.`,
          ],
        },
        {
          id: "branded",
          heading: "Prompts that name your brand",
          blocks: [
            "A prompt that names your brand will nearly always get answers that name you, so it lifts your figures without measuring what a buyer asks. You can still track one if you choose; keep it in mind when you read the figures.",
          ],
        },
      ],
    },
    {
      slug: "daily-check",
      title: "How the daily check works",
      description: `What ${TRACKED} reads every day, how each AI engine is asked, what counts as naming you, and what a read that did not come back means for your figures.`,
      standfirst: "Once a day we ask every live prompt on each of your plan's engines and check every tracked keyword on Google. This is what that reads, and what happens when part of it does not come back.",
      sections: [
        {
          id: "what",
          heading: "What is read each day",
          blocks: [
            `Every live prompt is asked on ${listOf(engineNames())}, and every tracked keyword is checked on Google. Every read is made for your market, the US or the UK. ${ENGINE_SPECS.claude.label} is added on ${TIER_PLAIN.mentioned} and above.`,
            `The check runs once a day. The top of the ${ui("Overview")} says when the last one ran and when the next is due. Reads that did not come back on a day are not filled in later, and a day before your first check cannot be read.`,
          ],
        },
        {
          id: "engines",
          heading: "How each engine is read",
          blocks: [
            `${listOf(READ_DIRECT)} ${verb(READ_DIRECT)} read from the product a buyer uses. ${listOf(ASKED_DIRECT)} ${verb(ASKED_DIRECT)} asked through ${ASKED_DIRECT.length === 1 ? "its" : "their"} model directly, not read from ${ASKED_DIRECT.length === 1 ? "its app" : "their apps"}; so ${ASKED_DIRECT.length === 1 ? "is" : "are"} ${ENGINE_SPECS.claude.label} on the higher plans.`,
            "When a Google results page carries no AI Overview for a prompt, we record no answer for that day, not a miss.",
            `What we keep of each answer is what each engine said, with link addresses taken out of the text, and the pages it cited, kept separately. Both are kept while your plan runs, and for ${KEPT_DAYS} days after it ends.`,
          ],
        },
        {
          id: "named",
          heading: "What counts as naming you",
          blocks: [
            `An answer names you when its text uses one of the names we match for you: your brand, and any other spellings we have set. A name that appears only inside a link's web address does not count. On a prompt's page, your name and the other brands an answer names are marked in its text.`,
            `We set those names, not you, because each one changes what being named means. To change them, write to ${MAIL}.`,
            `The other brands in each answer are read from the same text and matched the same way. They make up ${ui("Named instead of you")} on the ${ui("Overview")} and ${ui("Who gets named")} on ${ui("AI visibility")}. Being cited is separate: a page an answer cites is counted on ${ui("Sources")}, whether or not the text named you.`,
          ],
        },
        {
          id: "no-answer",
          heading: "No answer is not a miss",
          blocks: [
            "If an engine gives no answer to a prompt on a day, that read is left out of the figures for that day. It does not count against you. So each figure is out of the answers the engines gave, which is why one engine can show fewer answers than another for the same prompts.",
          ],
        },
        {
          id: "partial",
          heading: "Reads that did not come back",
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
            `That is the rule everywhere: a read that did not come back is left out, never counted as a miss against you. It does mean that day's figures rest on fewer answers. On a prompt's page, ${ui("Every reading")} has one square per morning for each engine, and hovering a square says whether the engine named you, answered without you, gave no answer, or was not read that day.`,
          ],
        },
        {
          id: "google",
          heading: "Google positions",
          blocks: [
            `Each tracked keyword is checked in Google's organic results for your market, down to position ${SERP_DEPTH}. The position is where your site's best-ranking page sits, and the dashboard shows which page that is, and marks the day Google switches to a different page of yours.`,
            `Outside the top ${SERP_DEPTH} is a reading, not a gap: the keyword shows a dash for that day, and it does not count towards keywords on the first page.`,
            // 13 Oct 2026 (Danny: a keyword we read outside the top 20 showed 3rd in a signed-in browser). The
            // request, read in dataforseo-request.ts keywordRankRequest that day: Google organic results, location_code
            // by the client's market, desktop, depth SERP_DEPTH, and nothing else - we send no account, cookie or
            // history. Only what we send is claimed (review, 13 Oct 2026): how DataForSEO fetches is theirs, so the line
            // no longer says "not personalised". Only organic results count: engines.ts collectOrganic keeps
            // type "organic" alone, so a local pack or map place, an ad or an AI Overview link is never a position.
            // Google's side is Google's own page, "Why your Google Search results differ from others"
            // (support.google.com/websearch/answer/12412910, no updated date shown, read 13 Oct 2026): results can be
            // personalised from your activity, signed in, and customised signed out unless turned off; location and
            // device change results too. position-slot.test.mts holds the request, the runner's read and the organic filter.
            "Each reading is a Google search for your market, the UK or the US, made on desktop. We send no Google account, cookies or search history with it. Only Google's ordinary (organic) results count: a place in the map results, an ad or a link in an AI Overview is not a position here. A search you make yourself can show you in a different place: Google says your results can be personalised from your own activity, and that location and device change results too.",
          ],
        },
      ],
    },
    {
      slug: "dashboard",
      title: "Reading your dashboard",
      description: `What every page of the ${TRACKED} dashboard shows, how each figure is counted, and how to read any day's answers and positions.`,
      standfirst: "Figures in the dashboard are counted from stored readings, and each one says what it is counted out of: beside the figure, or in a line under it.",
      sections: [
        {
          id: "pages",
          heading: "The pages",
          blocks: [
            `The sidebar has ${ui("Overview")}, ${ui("Clusters")}, ${ui("AI visibility")}, ${ui("Search positions")}, ${ui("Sources")}, ${ui("Opportunities")}, ${ui("Integrations")}, ${ui("Plan")} and ${ui("Settings")}. On ${WORKED}, it also has a tab under your plan's name for the clusters we work on, and a view of your own figures as ${TRACKED} would show them.`,
            `At its foot are meters for the clusters, keywords and prompts in use, the ${ui("Help centre")}, and ${ui("Sign out")}. If you can see more than one website, a list under the website's name switches between them.`,
          ],
        },
        {
          id: "overview",
          heading: "Overview",
          blocks: [
            "The top line says when the last check ran, when the next is due, and which engines are read.",
            {
              list: [
                `${ui("AI names you")}: the answers that named you, out of every answer an engine gave, across all your prompts and engines, on the latest reading. Reads that got no answer are not in it. Under it is how far it has moved over the readings shown.`,
                `${ui("Keywords on page 1")}: your tracked keywords on Google's first page today, out of all of them.`,
                `${ui("Clusters")}: the clusters in use, out of your plan's, and how many keyword groups they hold.`,
                `${ui("AI cites your site")}: answers, on any engine, that cited a page of your site, over the latest week of readings.`,
              ],
            },
            `For example, with invented numbers: if your prompts drew ${EXAMPLE.answers} answers on the latest reading and ${EXAMPLE.named} of them named you, the figure reads ${EXAMPLE_PCT}%.`,
            `Below, each cluster has its Google position, its change on the week, and how often AI names you, with a link to its page. ${ui("Named instead of you")} lists the brands the engines recommend most over the latest week of readings, and the plan card has ${ui("Plan and allowances")}.`,
          ],
        },
        {
          id: "clusters-page",
          heading: "Clusters and one cluster",
          blocks: [
            `${ui("Clusters")} has a card per cluster: its keyword and target page, its Google position and change, how often AI names you, and how much it tracks. It is where you add, rename and stop clusters - see ${link("Clusters, keywords and prompts", helpHref("clusters"))}.`,
            `One cluster's page has its keyword's Google position against a week before, how often its prompts name you on the latest reading, its ${ui("Tracked keywords on page 1")}, and its ${ui("Keyword groups")}. Each keyword has its position and change; each prompt has a mark per engine for its latest reading.`,
            `With ${ui("Search Console")} or ${ui("Bing")} picked above the groups, each keyword shows clicks, impressions and position from that service instead, once it is connected on ${ui("Integrations")}. Until then, ${ui("Preview with sample data")} shows what the columns hold, marked as a sample.`,
          ],
        },
        {
          id: "ai",
          heading: "AI visibility, and one prompt",
          blocks: [
            `${ui("AI visibility")} has, for each engine, the share of its answers that name you on the latest reading; your prompts, each with its latest reading by engine and its recent readings; and ${ui("Who gets named")}, every brand the engines recommended across your prompts over the latest week of readings, by how many answers named it.`,
            `Open a prompt to read every answer. ${ui("Every reading")} has a row of squares per engine, one per morning since the prompt was added: filled when the answer named you, with a dot when it cited your site. Pick a day to read what each engine said, the brands it named and its ${ui("Sources cited")}; pick another under ${ui("compare with")} to set both side by side, with what changed between them.`,
          ],
        },
        {
          id: "google-page",
          heading: "Search positions, and one keyword",
          blocks: [
            `${ui("Tracked daily")} lists every keyword checked on Google: its searches a month, its difficulty, its position, its change on the week, its trend and the page that ranks. Search volume and difficulty are DataForSEO estimates. A plural or singular tracked free sits straight after its keyword.`,
            `Open a keyword for ${ui("Position over time")}, every change of ranking page, and Google's top ${SERP_DEPTH} on any day it was stored, beside another day when you pick one.`,
            `${ui("Find keywords")} searches from a word your buyers use - ${ui("Matching terms")} or ${ui("Related")} - with volume, difficulty, cost per click and intent, and ${ui("Track")} adds one to the cluster and group you pick. ${ui("Also ranking, in your groups")} lists the keywords from your monthly ranking snapshot that fall into your groups.`,
          ],
        },
        {
          id: "sources-page",
          heading: "Sources and Opportunities",
          blocks: [
            `${ui("Sources")} lists the sites the engines cite when they answer your prompts, over the range you pick: how many answers cited each, how many of its pages, for how many prompts and on which engines. Your own site is marked. Open a site for its ${ui("Pages cited")} and the ${ui("Answers citing it")}, each with whether it named you.`,
            `${ui("Opportunities")} lists pages the engines cite for your prompts that leave you out, sorted by what to do about each, with ${ui("How to do this yourself")}. They appear once a week of readings shows which pages the engines rely on.`,
          ],
        },
        {
          id: "integrations",
          heading: "Integrations",
          blocks: [
            `${ui("Integrations")} has Google Search Console, Bing Webmaster Tools and Google Analytics. ${ui("Connect")} sends us a request and the card then shows it as requested; we get in touch when the connection opens, and there is nothing to do until then. Owners and editors can ask for one.`,
          ],
        },
        {
          id: "reports",
          heading: "Getting your data out",
          blocks: [
            `There are no downloads in the dashboard: every answer and every Google reading is on the dashboard itself, on its prompt's or keyword's page. If you need your data as a file, write to ${MAIL} and we send it to you.`,
          ],
        },
        {
          id: "settings",
          heading: "Settings",
          blocks: [
            `${ui("Settings")} has your ${ui("Team")}, your ${ui("Email")} - the Monday summary, which you can turn off - and a link to your plan. Billing is on ${ui("Plan")}. See ${link("Team and roles", helpHref("team"))} and ${link("Billing questions", helpHref("billing"))}.`,
          ],
        },
      ],
    },
    {
      slug: "team",
      title: "Team and roles",
      description: `Who can see and change an ${TRACKED} dashboard: owners, editors and viewers, inviting and removing people, email settings, and dashboards with more than one website.`,
      standfirst: "A dashboard belongs to an account, and everyone on the account's team signs in with their own email address.",
      sections: [
        {
          id: "roles",
          heading: "Owners, editors and viewers",
          blocks: [
            {
              list: [
                `Owner: everything an editor can do, plus inviting people, changing roles, removing people, adding tracking packs and billing${trialOn ? ", including cancelling a free trial" : ""}.`,
                "Editor: adds, edits and stops clusters, groups, keywords and prompts, sets target pages, checks keywords, confirms setup and asks for integrations.",
                "Viewer: reads every page, and changes nothing that is tracked.",
              ],
            },
            `Owners are set up by us. If you need another, write to ${MAIL}. Owners can switch someone between editor and viewer and remove anyone but other owners, and a dashboard always keeps at least one owner.`,
          ],
        },
        {
          id: "invite",
          heading: "Inviting someone",
          blocks: [
            {
              steps: [
                `In ${ui("Settings")}, under ${ui("Team")}, enter their email address. Only owners see the form.`,
                "Pick Editor or Viewer.",
                `Choose ${ui("Invite")}. We email them, and they sign in with that address.`,
              ],
            },
            `An invite from Settings gives them the website you are in. To give someone every website on your account, write to ${MAIL}.`,
            `Each website has at most ${MEMBERS_PER_CLIENT} people on its team, and each owner can send up to ${INVITES_PER_OWNER_PER_DAY} invites a day. Someone who was removed can be invited again.`,
          ],
        },
        {
          id: "remove",
          heading: "Changing a role, or removing someone",
          blocks: [
            `An owner has ${ui("Make viewer")} or ${ui("Make editor")} beside each editor and viewer, and ${ui("Remove")} beside them too. A removed person loses access at once. Nothing they did is undone: the clusters, prompts and history stay as they are.`,
          ],
        },
        {
          id: "email",
          heading: "Email settings",
          blocks: [
            `We email the address you sign in with: a sign-in link when you ask for one, and service emails about the dashboard. The Monday summary is yours to switch off: in ${ui("Settings")}, under ${ui("Email")}, choose ${ui("Turn it off")}, or ${ui("Turn it on")} to have it again. It is set for you alone, not for the whole team.`,
          ],
        },
        {
          id: "websites",
          heading: "More than one website",
          blocks: [
            "An account can hold more than one website. Each person sees the websites they were invited to. Switch between the websites you can see from the list under the website's name in the sidebar.",
          ],
        },
        {
          id: "sign-in",
          heading: "Signing in and out",
          blocks: [
            `Everyone signs in with a link we email them: see ${link("Signing in", helpHref("getting-started", "sign-in"))}. ${ui("Sign out")}, at the foot of the sidebar, signs out the browser you are in. If you think someone else is signed in as you, write to ${MAIL}.`,
          ],
        },
      ],
    },
    {
      slug: "trial-and-cancelling",
      title: trialOn ? "The free trial, and cancelling" : "Cancelling your plan",
      description: trialOn
        ? `How the ${TRACKED} ${TRIAL.days}-day free trial works, how an owner cancels it from Plan > Billing, how a paid plan is stopped, and what happens to your data when tracking ends.`
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
                  `While the trial runs, a strip across the top of every dashboard page says how many days are left and when the trial ends, with a link to ${ui("Billing")}. The plan card on the ${ui("Overview")} says the day too. Times are in your market's time, written like ${clockIn(ZONE_EXAMPLE, "uk")} on a UK plan and ${clockIn(ZONE_EXAMPLE, "us")} on a US one.`,
                ] as HelpBlock[],
              },
              {
                id: "cancel-trial",
                heading: "Cancelling during the trial",
                blocks: [
                  {
                    steps: [
                      `Sign in as an owner and open ${ui("Plan")}.`,
                      `Under ${ui("Billing")}, choose ${ui("Open billing")}. It opens Stripe's billing page for your subscription.`,
                      "Cancel the plan there.",
                    ],
                  },
                  "Tracking carries on until the trial ends, then stops, and nothing is charged. The strip at the top of each page then says when tracking stops.",
                  `Only an owner can open billing; editors and viewers are told to ask one. If billing does not open, Plan says why: try again, or write to ${MAIL}, and we cancel it.`,
                ] as HelpBlock[],
              },
            ]
          : []),
        {
          id: "paid",
          heading: "Stopping a paid plan",
          blocks: [
            `The plan's terms are ${PLAN_TERMS}. To stop it, an owner opens ${ui("Plan")}, chooses ${ui("Open billing")} under ${ui("Billing")}, and cancels on Stripe's billing page. As Plan says, cancelling stops the plan at the end of the period you have paid for. Or write to ${MAIL}.`,
            "If your plan is billed through an agency or an account contact rather than by card with us, ask them instead.",
          ],
        },
        {
          id: "ended",
          heading: "When tracking ends",
          blocks: [
            `When a plan ends, no more checks run. Everything read so far stays in the dashboard: anyone on the team can still sign in and read it. A strip at the top of each page says tracking has ended, and an owner can ask us to restart it by writing to ${MAIL}.`,
          ],
        },
        {
          id: "data",
          heading: "Your data",
          blocks: [
            `Stopping a prompt or a cluster deletes nothing, and neither does a plan ending: on a tracked account, what each engine said every day is kept in your account for ${KEPT_DAYS} days after the plan ends.`,
            `To keep your own copy, write to ${MAIL} and we send it to you as a file. To have your data deleted, see ${link("your rights in our privacy policy", "/legal#rights")}.`,
          ],
        },
      ],
    },
    {
      slug: "billing",
      title: "Billing questions",
      description: `What ${TRACKED} costs, how tax and receipts work, adding extra tracking packs, and where to change your card or see your invoices.`,
      standfirst: "What you pay, what Stripe sends you, and where to go when something about a charge needs changing.",
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
            `An owner adds one on ${ui("Plan")}, under ${ui("Track more")}: the button there opens Stripe's checkout, paid monthly by card, and you can add as many as you need. The same button appears wherever an allowance runs out. Once the pack is on your subscription, the meters and ${ui("Allowances")} show the new totals.`,
          ],
        },
        {
          id: "questions",
          heading: "Your card, invoices, or your plan",
          blocks: [
            `Invoices, your card and cancelling are on Stripe's billing page: an owner opens ${ui("Plan")} and chooses ${ui("Open billing")} under ${ui("Billing")}. Only the owner can open it.`,
            `For anything else about a charge, or a question the billing page does not answer, write to ${MAIL}.`,
            "If your plan is billed through an agency or an account contact rather than by card with us, ask them instead.",
            `Other plans are on ${link("the packages page", "/packages")}, and ${ui("Plan")} lists the plans above yours with ${ui("See what it adds")}. To move to one, write to us.`,
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
    { q: "Why did a day's reading not count against us?", href: helpHref("daily-check", "partial") },
    { q: "What does the headline percentage count?", href: helpHref("dashboard", "overview") },
    { q: "What counts as an answer naming us?", href: helpHref("daily-check", "named") },
    { q: "How do I add a cluster?", href: helpHref("clusters", "add") },
    { q: "What is a target page?", href: helpHref("clusters", "target") },
    ...(trialOn ? [{ q: "How do I cancel the free trial?", href: helpHref("trial-and-cancelling", "cancel-trial") }] : []),
    { q: "How do I invite someone to the dashboard?", href: helpHref("team", "invite") },
    { q: "How do I get a copy of our data?", href: helpHref("dashboard", "reports") },
  ];

  const index = {
    title: `${TRACKED} help`,
    heading: `Help with ${TRACKED}`,
    description: `Help with ${TRACKED}: getting started, clusters, the daily check, reading the dashboard, team and roles, ${trialOn ? "the free trial, cancelling" : "cancelling"} and billing.`,
    standfirst: `How the daily check reads the engines, what each figure in your dashboard counts, and how setup, ${trialOn ? "your team, the trial and billing" : "your team and billing"} work.`,
  };

  return { articles, quick, index };
}

const SHIPPED = helpContent();
export const HELP: HelpArticle[] = SHIPPED.articles;
export const QUICK = SHIPPED.quick;
export const HELP_INDEX = SHIPPED.index;

/** "Still stuck?": where to write, and nothing about when. */
export const STILL_STUCK = `Send your question to ${MAIL}, or through ${link("the contact form", "/contact")}. For invoices, your card or cancelling, an owner can also use ${ui("Open billing")} on ${ui("Plan")}.`;

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
