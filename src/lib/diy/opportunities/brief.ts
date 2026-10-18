import { type Day, formatDay } from "../../tracking/figures.ts";

import { LINE_ANCHOR, LINE_TARGET, LINE_WHO, PLAYBOOKS, type Playbook } from "./playbooks.advice.ts";
import { PITCH_ROUTES } from "./routes.ts";
import { NOT_CLASSIFIED, PAGE_TYPE_LABEL, type Opportunity, type PageFacts, type PageType } from "./types.ts";

/**
 * One opportunity's brief (13 Oct 2026, DIY P7; spec 10 sections 4.7 and
 * 6.2, "The brief is deterministic"): assembled from the evidence, what we
 * read on the page, the route's playbook, the client's target page and the
 * pitch outline. No model writes any of it. Pure.
 *
 * **The pitch outline's blanks are filled only from our own data**: the
 * page's title, its last-updated date and its headings as we read them, the
 * client's brand, and the target page. Everything else stays a blank in
 * square brackets - the reader's name, the one fact, the sender - so the
 * outline is never a send-ready email.
 */

/** Where the client's target page came from (section 4.7, "What to point it at"). */
export type Target = { url: string | null; how: "chosen" | "ranking" | "key_page" | "homepage" | "pick" };

/**
 * The cluster's target page: the one a person chose for it (dash/target.ts,
 * 18 Oct 2026) whatever it is, else the latest URL of the client's ranking for
 * the cluster keyword, else a key page serving the cluster, else the homepage.
 * Never a blog post for a buying keyword unless a person chose it: a ranking
 * URL that is one is skipped (Nomada op:450-473). "Pick a page" when there is
 * no domain at all.
 */
export function targetPage(p: { domain: string; chosen?: string | null; ranking: string | null; keyPage: string | null; intent: string | null }): Target {
  if (p.chosen) return { url: p.chosen, how: "chosen" };
  const blog = (u: string) => /\/(blog|news|articles?|posts?)\//i.test(u);
  const buying = p.intent === "commercial" || p.intent === "transactional";
  if (p.ranking && !(buying && blog(p.ranking))) return { url: p.ranking, how: "ranking" };
  if (p.keyPage && !(buying && blog(p.keyPage))) return { url: p.keyPage, how: "key_page" };
  if (p.domain) return { url: `https://${p.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/`, how: "homepage" };
  return { url: null, how: "pick" };
}

export const TARGET_LABEL: Record<Target["how"], string> = {
  chosen: "The target page set for this cluster",
  ranking: "Your page that ranks for this cluster's keyword",
  key_page: "Your key page for this cluster",
  homepage: "Your homepage, until a page of yours ranks for this cluster",
  pick: "Pick a page",
};

/** A blank, as the outline writes one. */
const blank = (what: string) => `[${what}]`;

/** Headings that are about the page, not a criterion it lists on. */
const NOT_A_CRITERION = /^(how we|our (picks|methodology|verdict|top)|methodology|faq|frequently asked|conclusion|final (thoughts|words)|summary|why (trust|you can trust)|about (us|the author)|table of contents|related|comments?)\b/i;

/** The criteria the page lists on: its headings, less the ones about the page itself, at most 8. */
export function criteria(facts: PageFacts | null): string[] {
  return (facts?.status === "ok" ? facts.headings : []).filter((h) => !NOT_A_CRITERION.test(h.trim())).slice(0, 8);
}

/**
 * The pitch outline for a route that has one (section 4.7): one outline with
 * blanks, never a sequence. Null for a route without one.
 */
export function pitchOutline(p: { route: Opportunity["route"]; facts: PageFacts | null; brand: string; target: Target }): string | null {
  if (!PITCH_ROUTES.includes(p.route)) return null;
  const read = p.facts?.status === "ok" ? p.facts : null;
  const title = read?.title ? `'${read.title}'` : blank("their page title");
  const updated = read?.updatedOn ? formatDay(read.updatedOn, true) : blank("the date it was updated");
  const first = criteria(read)[0];
  const criterion = first ? blank(`the criterion they use, for example '${first}'`) : blank("the criterion they use");
  const proof = p.target.url ?? blank("your proof page");
  const brand = p.brand || blank("your brand");
  const sign = blank("your name, role");
  switch (p.route) {
    case "send_correction":
      return [
        `Subject: A correction for ${title}`,
        `Hi ${blank("first name")}, I read ${title} (${updated}).`,
        `It says ${blank("what it says now")} about ${brand}. The current fact is ${blank("the fact")}, dated on our site here: ${proof}.`,
        sign,
      ].join("\n");
    // 13 Oct 2026, DIY P10's review (outside P10's 7.11 edit list): Links' two routes, each its own outline. A mention
    // fell to the best-of-list default ("You rank tools on ..."), the wrong pitch for thanking someone for a mention.
    case "ask_for_link":
      return [
        `Subject: Thanks for mentioning ${brand}`,
        `Hi ${blank("first name")}, thanks for naming ${brand} in ${title}.`,
        `Would a link to ${proof} help your readers who ${blank("what they would do there")}?`,
        sign,
      ].join("\n");
    case "earn_link":
      return [
        `Subject: ${blank("what you made")} for readers of ${title}`,
        `Hi ${blank("first name")}, I read ${title} (${updated}). It points readers to ${blank("the page it links to now, and what it offers")}.`,
        `${brand} has made ${blank("what you made")}, here: ${proof}. ${blank("The one reason it helps their readers")}.`,
        sign,
      ].join("\n");
    case "offer_resource":
      return [
        `Subject: A resource for ${title}`,
        `Hi ${blank("first name")}, I read ${title} (${updated}).`,
        `It points readers to ${blank("what it points to now")}. ${brand} has ${blank("the one data point, quote or tool")}, here: ${proof}.`,
        "If it helps your next update, you're welcome to use it.",
        sign,
      ].join("\n");
    default:
      return [
        `Subject: An addition for ${title}`,
        `Hi ${blank("first name")}, I read ${title} (${updated}). You rank tools on ${criterion}.`,
        `${brand} ${blank("the one fact that meets it")}, shown here: ${proof}.`,
        "If it helps your next update, the details are on that page.",
        sign,
      ].join("\n");
  }
}

/** "What it is" (section 4.7): what we read on the page, or why there is nothing yet; a whole site (a Links gap domain) says it is one. */
export type WhatItIs = { kind: "read"; pageType: string; criteria: string[]; updated: Day | null; readOn: Day; via: PageFacts["via"] } | { kind: "unread" } | { kind: "unreadable"; text: string } | { kind: "site"; text: string };

/** A gap domain's "What it is" (13 Oct 2026, DIY P10's review): no page is read for a whole site, so "It is read overnight" was never true of one. */
export const SITE_LINE = "A whole site, not one page, so no one page of it is read. Open it and find the pages that link to the sites you compete with.";

export function whatItIs(opp: Pick<Opportunity, "pageType"> & { lens?: Opportunity["lens"] }, facts: PageFacts | null): WhatItIs {
  if (opp.lens === "link_domain") return { kind: "site", text: SITE_LINE };
  const type = opp.pageType ? PAGE_TYPE_LABEL[opp.pageType as PageType] : NOT_CLASSIFIED;
  if (!facts) return { kind: "unread" };
  if (facts.status !== "ok") return { kind: "unreadable", text: unreadableLine(facts) };
  return { kind: "read", pageType: type, criteria: criteria(facts), updated: facts.updatedOn, readOn: facts.readAt.slice(0, 10), via: facts.via };
}

/** "We couldn't read this page on 3 Nov (HTTP 403)." Never "doesn't name you" (section 4.7). */
export function unreadableLine(facts: Pick<PageFacts, "readAt" | "http" | "status">): string {
  const day = formatDay(facts.readAt.slice(0, 10));
  if (facts.status === "blocked") return `We couldn't read this page on ${day}: it asks crawlers like ours not to.`;
  if (facts.status === "not_html") return `We couldn't read this page on ${day}: it isn't a web page.`;
  return `We couldn't read this page on ${day}${facts.http ? ` (HTTP ${facts.http})` : ""}.`;
}

/** The brief's blocks other than the why lines, which payload.ts writes with their evidence links. */
export type Brief = {
  whatItIs: WhatItIs;
  target: Target;
  targetLabel: string;
  playbook: Playbook | null;
  pitch: string | null;
  anchor: typeof LINE_ANCHOR;
  who: typeof LINE_WHO;
  targetRule: typeof LINE_TARGET;
};

export function brief(p: { opp: Opportunity; facts: PageFacts | null; brand: string; target: Target }): Brief {
  return {
    whatItIs: whatItIs(p.opp, p.facts),
    target: p.target,
    targetLabel: TARGET_LABEL[p.target.how],
    playbook: PLAYBOOKS[p.opp.route] ?? null,
    pitch: pitchOutline({ route: p.opp.route, facts: p.facts, brand: p.brand, target: p.target }),
    anchor: LINE_ANCHOR,
    who: LINE_WHO,
    targetRule: LINE_TARGET,
  };
}
