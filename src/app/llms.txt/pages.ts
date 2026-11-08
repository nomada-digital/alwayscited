import type { Metadata } from "next";

import { metadata as home } from "@/app/page";
import { metadata as packages } from "@/app/packages/page";
import { metadata as tracked } from "@/app/alwaystracked/page";
import { metadata as mentioned } from "@/app/alwaysmentioned/page";
import { metadata as cited } from "@/app/alwayscited/page";
import { metadata as everywhere } from "@/app/alwayseverywhere/page";
import { metadata as whatIsAeo } from "@/app/what-is-aeo/page";
import { metadata as howItWorks } from "@/app/how-it-works/page";
import { metadata as caseStudies } from "@/app/case-studies/page";
import { metadata as vibeRetail } from "@/app/case-studies/vibe-retail/page";
import { metadata as blog } from "@/app/blog/page";
import { metadata as postLlms } from "@/app/blog/how-llms-pick-which-brands-to-recommend/page";
import { metadata as postAeoSeo } from "@/app/blog/aeo-vs-seo-whats-actually-different/page";
import { metadata as postAudits } from "@/app/blog/why-most-aeo-audits-are-a-waste-of-money/page";
import { metadata as postAgencies } from "@/app/blog/best-ai-seo-agencies/page";
import { metadata as compare } from "@/app/compare/page";
import { metadata as whiteLabel } from "@/app/white-label/page";
import { metadata as seoAgencies } from "@/app/seo-agencies/page";
import { metadata as prAgencies } from "@/app/pr-agencies/page";
import { metadata as coverageCheck } from "@/app/coverage-check/page";
import { metadata as llmChecker } from "@/app/llm-visibility-checker/page";
import { metadata as legal } from "@/app/legal/page";
import { metadata as terms } from "@/app/terms/page";
import { metadata as about } from "@/app/about/page";
import { metadata as contact } from "@/app/contact/page";
import { metadata as help } from "@/app/help/page";
import { metadata as helpStart } from "@/app/help/getting-started/page";
import { metadata as helpClusters } from "@/app/help/clusters/page";
import { metadata as helpCheck } from "@/app/help/daily-check/page";
import { metadata as helpDashboard } from "@/app/help/dashboard/page";
import { metadata as helpTeam } from "@/app/help/team/page";
import { metadata as helpTrial } from "@/app/help/trial-and-cancelling/page";
import { metadata as helpBilling } from "@/app/help/billing/page";

/**
 * What /llms.txt lists: the pages `sitemap.ts` offers, grouped, each with the
 * page's own `metadata` imported rather than a description typed here - so the
 * line an assistant reads is the meta description a crawler reads, and the two
 * cannot drift. `llms.test.mts` holds the paths equal to the sitemap's.
 */
export type LlmsPage = { path: string; meta: Metadata };

export const SECTIONS: { heading: string; pages: LlmsPage[] }[] = [
  {
    heading: "Start here",
    pages: [
      { path: "", meta: home },
      { path: "/how-it-works", meta: howItWorks },
      { path: "/what-is-aeo", meta: whatIsAeo },
    ],
  },
  {
    heading: "Packages",
    pages: [
      { path: "/packages", meta: packages },
      { path: "/alwaystracked", meta: tracked },
      { path: "/alwaysmentioned", meta: mentioned },
      { path: "/alwayscited", meta: cited },
      { path: "/alwayseverywhere", meta: everywhere },
      { path: "/compare", meta: compare },
      { path: "/white-label", meta: whiteLabel },
    ],
  },
  {
    heading: "Who it is for",
    pages: [
      { path: "/seo-agencies", meta: seoAgencies },
      { path: "/pr-agencies", meta: prAgencies },
    ],
  },
  {
    heading: "Evidence and writing",
    pages: [
      { path: "/case-studies", meta: caseStudies },
      { path: "/case-studies/vibe-retail", meta: vibeRetail },
      { path: "/blog", meta: blog },
      { path: "/blog/best-ai-seo-agencies", meta: postAgencies },
      { path: "/blog/how-llms-pick-which-brands-to-recommend", meta: postLlms },
      { path: "/blog/aeo-vs-seo-whats-actually-different", meta: postAeoSeo },
      { path: "/blog/why-most-aeo-audits-are-a-waste-of-money", meta: postAudits },
    ],
  },
  {
    heading: "Tools",
    pages: [
      { path: "/llm-visibility-checker", meta: llmChecker },
      { path: "/coverage-check", meta: coverageCheck },
    ],
  },
  {
    // MK-2, 9 Oct 2026: the help centre for alwaystracked clients.
    heading: "Help",
    pages: [
      { path: "/help", meta: help },
      { path: "/help/getting-started", meta: helpStart },
      { path: "/help/clusters", meta: helpClusters },
      { path: "/help/daily-check", meta: helpCheck },
      { path: "/help/dashboard", meta: helpDashboard },
      { path: "/help/team", meta: helpTeam },
      { path: "/help/trial-and-cancelling", meta: helpTrial },
      { path: "/help/billing", meta: helpBilling },
    ],
  },
  {
    heading: "Company",
    pages: [
      { path: "/about", meta: about },
      { path: "/contact", meta: contact },
      { path: "/legal", meta: legal },
      { path: "/terms", meta: terms },
    ],
  },
];

/** A page's title as its own metadata gives it, before the layout's template. */
export function titleOf(meta: Metadata): string {
  const t = meta.title;
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    if ("absolute" in t && t.absolute) return t.absolute;
    if ("default" in t && t.default) return t.default;
  }
  throw new Error("an llms.txt page has no title in its metadata");
}

export function descriptionOf(meta: Metadata): string {
  if (!meta.description) throw new Error("an llms.txt page has no description in its metadata");
  return meta.description;
}
