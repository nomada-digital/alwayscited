/**
 * How a customer can act on what the dashboard shows, on their own (Danny,
 * 17 Oct 2026: "give them the tools and the know-how ... without giving too
 * much away"). Method only: what to look for and what to change, in general
 * terms. Never a vendor, a site list, a price, an outreach script or how we
 * place - that is the service the paid plans sell.
 *
 * Each entry is a situation the dashboard can detect, with a short label for
 * a table cell and the steps behind it.
 */

export type Guide = { label: string; title: string; steps: string[] };

/** Google situations, one per tracked keyword (lib/dash/guidance.ts keywordSituation). */
export const KEYWORD_GUIDES = {
  homepage: {
    label: "Give it its own page",
    title: "Your homepage is what ranks",
    steps: [
      "Your homepage covers everything you do. A page about exactly this topic is a clearer match for the search, so create or choose one.",
      "Use the search's own words in that page's title and first heading, and answer the question a searcher has in the first paragraph.",
      "Link to it from your homepage and from the pages that already rank for related searches, using words that describe it.",
    ],
  },
  swap: {
    label: "Pick one page",
    title: "Google keeps switching which of your pages it ranks",
    steps: [
      "Two of your pages are competing for the same search, so neither holds its place.",
      "Decide which page should rank. Make the other one about something distinctly different, or merge it in and redirect it.",
      "Point your internal links for this topic at the page you chose.",
    ],
  },
  near: {
    label: "Within reach",
    title: "On page 2, within reach of page 1",
    steps: [
      "Pages just off page 1 usually need depth, not a rewrite. Compare yours with the pages above it: what questions do they answer that yours does not?",
      "Add those answers, with specifics only you can give - examples, numbers, how you work.",
      "Add internal links to it from your strongest related pages, and keep its title close to the search.",
    ],
  },
  absent: {
    label: "Nothing ranks yet",
    title: "No page of yours is in the top 100",
    steps: [
      "Google has no page of yours it connects with this search. Check one exists that is clearly about it - not a mention in passing.",
      "If it exists, make sure it can be found: linked from your navigation or related pages, and not blocked from indexing.",
      "Then give it time before judging it, and watch its position here.",
    ],
  },
  top: {
    label: "Hold it",
    title: "On page 1",
    steps: [
      "Keep the page current: refresh facts and dates, and add answers as questions change.",
      "Watch the pages just below you here; a jump from one of them is the early sign to act.",
    ],
  },
} satisfies Record<string, Guide>;

/** What AI answers draw on, for the Sources page. */
export const SOURCES_GUIDE: Guide = {
  label: "How to use this",
  title: "Getting onto the sources AI reads",
  steps: [
    "The sites at the top are the ones cited most often in the answers to your prompts - the pages behind what your buyers are told.",
    "Open the pages that are cited but leave you out. Look at why the brands on them are there: a list they were added to, a profile they keep up to date, a guide they contributed to, a question they answered.",
    "Do the same, honestly and usefully: keep your own profiles complete and accurate, offer a genuinely useful addition where one fits, and correct anything wrong about you.",
    "Your own site counts too. A clear page that answers the question directly is one the engines can cite.",
  ],
};

/** For the AI visibility page: prompts that never name the client. */
export const PROMPTS_GUIDE: Guide = {
  label: "When a prompt never names you",
  title: "When a prompt never names you",
  steps: [
    "Look at who is named instead, and which pages are cited for that prompt - Sources shows them.",
    "Check your own site answers that exact question, in plain words, on a page about it.",
    "Prompts that name a buying criterion (price, size, speed, a sector) are won by saying clearly, and with evidence, where you fit it.",
  ],
};

/** Opportunity routes (opportunities.route), expanded from the one-line reason the page already gives. */
export const ROUTE_GUIDES: Record<string, Guide> = {
  ask_added: {
    label: "Ask to be added",
    title: "A list the engines read leaves you out",
    steps: ["Read how the list chooses who is on it.", "If you fit, contact its author with the specific reason you belong there and the evidence for it.", "Keep it short and factual; offer what readers need, not a pitch."],
  },
  offer_resource: {
    label: "Offer a resource",
    title: "A cited page where something from you fits",
    steps: ["Find the gap: a question the page leaves unanswered, or data it lacks.", "Offer that specific thing - a quote, a figure, an example - to the page's author.", "Make it useful on its own, with your name attached as the source."],
  },
  get_listed: {
    label: "Get listed",
    title: "A directory or review profile the engines read",
    steps: ["Claim or create your profile.", "Complete every field accurately, in the words your buyers use.", "Ask recent clients for honest reviews where the platform allows it."],
  },
  answer_thread: {
    label: "Answer the thread",
    title: "A forum or community thread the engines cite",
    steps: ["Read the whole thread first.", "Answer the question that was asked, with real detail, as a person - say who you are.", "Link to your site only where it genuinely adds to the answer."],
  },
  publish_own: {
    label: "Publish on your site",
    title: "A question nobody answers well yet",
    steps: ["Write the clearest answer to the exact question, on its own page.", "Lead with the answer, then the detail and evidence.", "Link to it from related pages on your site."],
  },
};
