/**
 * Sample recommendations (22 Nov 2026), so the Recommendations page can be drawn and reviewed with no database.
 *
 * Used for the generated sample client (sample-world.ts) and a local run on a snapshot (DASH_FIXTURE), never for a
 * real client. Five for the main list - one of each kind a customer can act on - and two "we could build this for
 * you" rows. The upgrade rows carry a tier and a sentence only: the price on the card comes from config/pricing.ts,
 * as it does for a real row.
 *
 * Fictional, as the rest of the sample world: bluemahoeretreats.com does not resolve, and no figure here is a claim
 * about anybody.
 */

import type { Recommendation } from "./recommendations.ts";

/** The Monday on or before a day (YYYY-MM-DD). */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

export function sampleRecommendations(today: string): { week: string; items: Recommendation[]; upgrades: Recommendation[] } {
  const week = mondayOf(today);
  const base = { week_of: week, status: "new" as const, released_at: `${week}T09:00:00Z`, offer: null, href: null };
  const items: Recommendation[] = [
    {
      ...base,
      id: "sample-rec-1",
      position: 1,
      kind: "schema",
      title: "Add review markup to your Rooms page",
      why: "The engines can only quote what they can read cleanly. Your Rooms page has the details guests ask about, but nothing marks them up, so the engines lean on other sites that do.",
      evidence: { answers: 14, engines: ["google_aio", "chatgpt", "perplexity"], url: "https://bluemahoeretreats.com/rooms", since: "2026-11-02" },
      how: [
        "Open the Schema section of this dashboard and pick the Rooms page.",
        "Copy the review markup we have drafted for it.",
        "Paste it into the page's head, or ask whoever manages your site to.",
        "Test the page in Google's Rich Results Test, then check it again next week.",
      ],
    },
    {
      ...base,
      id: "sample-rec-2",
      position: 2,
      kind: "profile",
      title: "Claim and complete your Trustpilot profile",
      why: "Trustpilot comes up in answers about where to stay and who to trust, and your profile is unclaimed with no description. Competitors with a finished profile are the ones being described.",
      evidence: { answers: 9, engines: ["chatgpt", "gemini"], domain: "trustpilot.com", competitors: ["Montego Palms Resort", "Negril Sands Hotel"], since: "2026-11-09" },
      how: [
        "Search for your business on Trustpilot and claim the profile with your work email.",
        "Add a two-sentence description in plain words: where you are, who you suit, what you offer.",
        "Add your website, phone number and three photos.",
        "Send a short, honest review request to your last ten guests.",
      ],
      href: "https://business.trustpilot.com/",
    },
    {
      ...base,
      id: "sample-rec-3",
      position: 3,
      kind: "on_page_answer",
      title: "Answer \"best hotels in Jamaica for couples\" on your site",
      why: "You are not named for this question, and no page on your site answers it directly. The engines pick pages that open with a straight answer, then back it up.",
      evidence: {
        answers: 22,
        engines: ["google_aio", "chatgpt", "gemini", "perplexity", "claude"],
        prompts: ["Best hotels in Jamaica for couples travelling from the UK"],
        competitors: ["Montego Palms Resort", "Ocho Rios Cove", "Treasure Bay Lodge"],
        since: "2026-10-26",
      },
      how: [
        "Add a page called \"Hotels in Jamaica for couples\" and link it from your homepage.",
        "Open with one clear sentence that says who you are best for and why.",
        "List what couples ask about: quiet rooms, beach access, airport transfers, dinner for two.",
        "Add three real guest comments and the dates they stayed.",
        "Add a short question and answer section at the bottom.",
      ],
    },
    {
      ...base,
      id: "sample-rec-4",
      position: 4,
      kind: "listing",
      title: "Get listed on the Jamaica tourist board's places to stay page",
      why: "This directory is cited in answers about where to stay, and it names several of your competitors but not you. A listing there is a plain, trusted mention.",
      evidence: { answers: 11, engines: ["google_aio", "perplexity"], domain: "visitjamaica.com", url: "https://visitjamaica.com/places-to-stay/", competitors: ["Negril Sands Hotel", "Port Antonio House"], since: "2026-11-02" },
      how: [
        "Open the directory page and find its listing or contact form.",
        "Submit your name, address, website and a short description that matches your site.",
        "Use the same name and address everywhere you are listed.",
        "Come back in two weeks to confirm it is live.",
      ],
      href: "https://visitjamaica.com/places-to-stay/",
    },
    {
      ...base,
      id: "sample-rec-5",
      position: 5,
      kind: "content",
      title: "Add a getting-there section for guests flying from the UK",
      why: "Travellers ask how long the journey takes and how to get from the airport. Your site does not say, so the engines quote a competitor's page that does.",
      evidence: { answers: 7, engines: ["gemini", "claude"], prompts: ["How do I get to a beach hotel in Jamaica from the UK?"], since: "2026-11-09" },
      how: [
        "Add a section to your Location page headed \"Getting here from the UK\".",
        "State the airport, the usual journey time and the transfer options in plain sentences.",
        "Say what a transfer costs, or how to book one with you.",
        "Keep it under 300 words and link to your booking page.",
      ],
    },
  ];
  const upgrades: Recommendation[] = [
    {
      ...base,
      id: "sample-rec-6",
      position: 1,
      kind: "upgrade",
      title: "Placements on pages the engines already read",
      why: "Three of the pages cited most for your prompts are independent lists you cannot add yourself to. Getting named on them is slow to arrange by hand, and it is the part we do every month.",
      evidence: { answers: 31 },
      how: [],
      offer: { tier: "cited", what: "We would pitch and place you on the independent lists the engines cite for your prompts, and report each one that goes live." },
    },
    {
      ...base,
      id: "sample-rec-7",
      position: 2,
      kind: "upgrade",
      title: "Fixing the schema across your site",
      why: "Schema is page by page work, and many of your pages would benefit. Doing it yourself is possible, but it is a lot of careful copying.",
      evidence: { answers: 14 },
      how: [],
      offer: { tier: "mentioned", what: "We would write and add the markup to your pages, and check each one is read correctly." },
    },
  ];
  return { week, items, upgrades };
}
