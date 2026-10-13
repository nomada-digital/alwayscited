import type { AdviceLine } from "../core/evidence.ts";
import type { Playbook } from "../opportunities/playbooks.advice.ts";

/**
 * The link playbooks (13 Oct 2026, DIY P10; spec 10 sections 2.4 and 6.3,
 * "Playbooks"): Earn a link and Ask for a link, the method strip at the foot
 * of the gap, the targets and the mentions. Static, in-app only, graded line
 * by line (advice-grades.test.mts): "Common practice" for every step, which
 * states no outcome, and "Google documents this" (G1, Google's spam
 * policies, updated 28 Aug 2026) only for the line not to cross, which says
 * what those policies say and no more. Each strip ends with P7's dated G1
 * line (opportunities/playbooks.advice.ts LINE_G1), drawn by P7's Playbook.
 *
 * Execution stays the client's (section 2.4): no names, addresses or forms,
 * one message and never a sequence, nothing sent for them, and no word that
 * a site takes placements. Nothing here says a link will move a ranking.
 */

const practice = (id: string, text: string): AdviceLine => ({ id, text, grade: "practice" });
const google = (id: string, text: string): AdviceLine => ({ id, text, grade: "documented", sourceId: "G1" });

export const EARN_LINK: Playbook = {
  route: "earn_link",
  steps: [
    practice("link-earn-1", "Open the site and find the pages that link to the sites you compete with. Link targets reveals some of them each month."),
    practice("link-earn-2", "Work out why they link: a resource, a comparison, a quote or a tool."),
    practice("link-earn-3", "Make the equivalent, or better, on your own site."),
    practice("link-earn-4", "Offer it once, with the one reason it helps their readers."),
  ],
  send: practice("link-earn-send", "One short message: what you made, and the one reason it helps their readers."),
  pointTo: practice("link-earn-point", "The page on your site you made for it."),
  effort: "a few hours",
  line: google("link-earn-line", "Never pay for a followed link."),
};

export const ASK_FOR_LINK: Playbook = {
  route: "ask_for_link",
  steps: [
    practice("link-ask-1", "Thank them for the mention."),
    practice("link-ask-2", "Ask whether linking the named product to your page would help their readers."),
    practice("link-ask-3", "Send one message, with no follow-up chain."),
  ],
  send: practice("link-ask-send", "Two or three sentences: thanks for the mention, the page of yours that matches what they wrote, and whether a link would help their readers."),
  pointTo: practice("link-ask-point", "The page of yours that matches what they wrote about, else your homepage."),
  effort: "about 15 minutes",
  line: google("link-ask-line", "No payment, and no request for a keyword-rich anchor."),
};

/** Who to write to: the method only (section 2.4). */
export const LINE_WHO_LINKS = practice("link-who", "Start with the page's author, then the site's contact or editorial page. We never supply names or addresses.");

/** Reclaiming a lost link (the Reclaim card's method line). */
export const LINE_RECLAIM = practice("link-reclaim", "Check whether the page moved or the link was removed, then ask once for the link to point at your current page.");

export const LINK_PLAYBOOKS: readonly Playbook[] = [EARN_LINK, ASK_FOR_LINK];

export const ADVICE: readonly AdviceLine[] = [
  ...LINK_PLAYBOOKS.flatMap((p) => [...p.steps, ...(p.send ? [p.send] : []), ...(p.pointTo ? [p.pointTo] : []), ...(p.line ? [p.line] : [])]),
  LINE_WHO_LINKS,
  LINE_RECLAIM,
];
