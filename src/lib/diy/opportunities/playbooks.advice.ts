import type { AdviceLine } from "../core/evidence.ts";

import type { Route } from "./types.ts";

/**
 * The method library for the pages the engines cite (13 Oct 2026, DIY P7;
 * spec 10 sections 2.4 and 6.2, "Playbooks"): every route's steps, what to
 * send, where to point them, our estimate of the effort, and the line not to
 * cross. Static, in-app only, and graded line by line (advice-grades.test.mts):
 * "Common practice" unless a line leans on a dated Google document, which
 * names its register entry (core.sources.ts G1, S41). Steps state no outcome.
 *
 * Every playbook ends with the one engine-adjacent claim, Google's, dated
 * (G1). It stops at "link spam": how paid links should be marked is advice
 * about paid placements, which the brief rules out, so the words for that
 * appear nowhere in rendered DIY text (gating.test.mts bans both).
 *
 * The link routes (earn_link, ask_for_link) are P10's playbooks, in
 * links.advice.ts, in wave 3.
 */

const practice = (id: string, text: string): AdviceLine => ({ id, text, grade: "practice" });
const google = (id: string, text: string, sourceId: "G1" | "S41"): AdviceLine => ({ id, text, grade: "documented", sourceId });

/** The closing line on every playbook (G1, Google's spam policies, updated 28 Aug 2026). */
export const LINE_G1 = google(
  "opp-g1-spam",
  "Google's spam policies (updated 28 Aug 2026) treat buying links that pass ranking credit, excessive link exchanges, and keyword-rich anchor text in articles you supply as link spam.",
  "G1",
);

/** "What to point it at": the anchor (section 4.7). */
export const LINE_ANCHOR = google("opp-anchor", "Anchor: your brand name or the page's title. Never a keyword-rich anchor on an article you supply.", "G1");

/** "Who to write to": the method only (section 4.7). */
export const LINE_WHO = practice("opp-who", "Start with the byline's author page, then the site's contact page or its team page. We never supply names or addresses.");

/** The target page rule, as the detail page says it. */
export const LINE_TARGET = practice("opp-target", "Point them to the page of yours that ranks for this cluster's keyword, else the page that serves it. Never a blog post for a buying keyword.");

export type Playbook = {
  route: Route;
  /** The steps, in order. */
  steps: AdviceLine[];
  send: AdviceLine | null;
  pointTo: AdviceLine | null;
  /** Our estimate, always labelled as one. */
  effort: string;
  /** The line not to cross. */
  line: AdviceLine | null;
};

export const PLAYBOOKS: Partial<Record<Route, Playbook>> = {
  ask_added: {
    route: "ask_added",
    steps: [
      practice("opp-ask-1", "Check it is maintained: a last-updated date, or a year in the title. We show what we read."),
      practice("opp-ask-2", "Read the criteria it ranks on. We list its headings."),
      practice("opp-ask-3", "Pick the one criterion you meet best, and the page of yours that proves it."),
      practice("opp-ask-4", "Send one short request, then at most one follow-up."),
    ],
    send: practice("opp-ask-send", "Two or three sentences: what you are, the criterion you meet, and the page that proves it. No demand for a link."),
    pointTo: practice("opp-ask-point", "Your page for this cluster."),
    effort: "about an hour",
    line: google("opp-ask-line", "No payment for a followed link, and no keyword-rich anchor.", "G1"),
  },
  send_correction: {
    route: "send_correction",
    steps: [
      practice("opp-fix-1", "Find the fact that is wrong or missing."),
      practice("opp-fix-2", "Put the correct fact on your own site, in text, with a date."),
      practice("opp-fix-3", "Send the fact, where it is on your site, and the date."),
    ],
    send: practice("opp-fix-send", "The one fact, and the address of the page on your site that holds it."),
    pointTo: practice("opp-fix-point", "The page on your site holding that fact."),
    effort: "about 30 minutes",
    line: practice("opp-fix-line", "Never ask for a re-rank."),
  },
  get_listed: {
    route: "get_listed",
    steps: [
      practice("opp-list-1", "Claim the profile."),
      practice("opp-list-2", "Complete every field with the same facts as your site."),
      practice("opp-list-3", "Ask real customers for reviews at a steady pace, following the platform's own rules."),
    ],
    send: practice("opp-list-send", "A complete profile, and a review request to recent customers."),
    pointTo: practice("opp-list-point", "Your homepage."),
    effort: "1-2 hours, then ongoing",
    line: practice("opp-list-line", "Never pay for or incentivise reviews against the platform's rules."),
  },
  answer_thread: {
    route: "answer_thread",
    steps: [
      practice("opp-thread-1", "Check the thread is live: recent replies, and still cited this week. We show the last day it was cited."),
      practice("opp-thread-2", "Answer what the thread asks, as a person, and say who you are."),
      practice("opp-thread-3", "Name your product among the options only if it answers what was asked."),
    ],
    send: practice("opp-thread-send", "A genuine answer, with who you are said plainly."),
    pointTo: practice("opp-thread-point", "Rarely anywhere; a page of yours only if someone asks."),
    effort: "about 15 minutes",
    line: practice("opp-thread-line", "No dropped links, and no second accounts."),
  },
  offer_resource: {
    route: "offer_resource",
    steps: [
      practice("opp-res-1", "See what the page points readers to: the resources of the sites you compete with."),
      practice("opp-res-2", "Offer one specific data point, quote or tool that improves the page."),
    ],
    send: practice("opp-res-send", "One specific improvement."),
    pointTo: practice("opp-res-point", "Your resource page."),
    effort: "a few hours",
    line: google("opp-res-line", "No link-for-link swaps. Excessive link exchanges are link spam.", "G1"),
  },
  publish_own: {
    route: "publish_own",
    steps: [
      practice("opp-pub-1", "Publish the page type the answers and Google's top 10 show for this keyword, on your own site: a comparison or a best-of list."),
      practice("opp-pub-2", "Include the sites you compete with honestly, with your criteria and a date."),
      google("opp-pub-3", "Put key facts in text: keep important content in text form.", "S41"),
      practice("opp-pub-4", "Point to it from your pages that already rank."),
    ],
    send: null,
    pointTo: null,
    effort: "a few days",
    line: practice("opp-pub-line", "Don't present a list about yourself as independent."),
  },
  refresh_own: {
    route: "refresh_own",
    steps: [
      practice("opp-ref-1", "Update the date and the facts."),
      practice("opp-ref-2", "Add a table of the criteria you compare on."),
      google("opp-ref-3", "Make sure key facts are visible text, not images or scripts.", "S41"),
    ],
    send: null,
    pointTo: null,
    effort: "a few hours",
    line: null,
  },
};

/** Every line, for the census: each playbook's, then the shared ones. */
export const ADVICE: readonly AdviceLine[] = [
  ...Object.values(PLAYBOOKS).flatMap((p) => (p ? [...p.steps, ...(p.send ? [p.send] : []), ...(p.pointTo ? [p.pointTo] : []), ...(p.line ? [p.line] : [])] : [])),
  LINE_G1,
  LINE_ANCHOR,
  LINE_WHO,
  LINE_TARGET,
];

/** The routes the Methods view lists, in the order the lenses do. */
export const METHOD_ROUTES: readonly Route[] = ["ask_added", "send_correction", "offer_resource", "answer_thread", "get_listed", "publish_own", "refresh_own"];
