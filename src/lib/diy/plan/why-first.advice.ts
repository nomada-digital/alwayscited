import type { AdviceLine } from "../core/evidence.ts";

/**
 * "Why this is first", one fixed line per severity (13 Oct 2026, DIY P3; spec
 * 10 section 6.1). Advice lines, so they live in an `*.advice.ts` file, each
 * with its grade, and a line that leans on a document names its register
 * entry: advice-grades.test.mts (P1) holds every line here to the register.
 *
 * Blocking's line says what S41 (Google Search Central, "AI features and your
 * website", updated 10 Dec 2025, read 12 Oct 2026) says and no more: that a
 * page must be crawlable to appear in Google's AI features. The rest are our
 * own readings or common practice, and promise nothing.
 */
export const ADVICE: AdviceLine[] = [
  {
    id: "plan.first.blocking",
    text: "Blocking comes first: Google says a page must be crawlable to appear in its AI features (Search Central, updated 10 Dec 2025).",
    grade: "documented",
    sourceId: "S41",
  },
  { id: "plan.first.slipping", text: "It was on page 1 (or named) and your last readings agree it isn't now.", grade: "your_data" },
  { id: "plan.first.closest", text: "Of your cluster keywords, this one sits closest to page 1.", grade: "your_data" },
  { id: "plan.first.gap", text: "Of the pages the engines cite, this one leaves you out of the most answers.", grade: "your_data" },
  { id: "plan.first.tidy", text: "Quick to do, and nothing else is waiting.", grade: "practice" },
];
