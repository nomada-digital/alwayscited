import type { Source } from "./evidence.ts";

/**
 * The evidence register's seed (13 Oct 2026, DIY P1; spec 10 section 6.10
 * item 1, the table of sources as read 12 Oct 2026 in research notes 05 and
 * 06 under docs/diy-platform-2026-10-12).
 *
 * G1-G4 and S41 are Google's own pages, read directly on 12 Oct 2026 (05's
 * register marks G1-G4 "P", read directly; 06 records S41 the same day), so
 * they are verified and may back a "Google documents this" line. Their
 * titles are the register's own descriptions, not the pages' headings.
 *
 * S43, S8 and S40 are internal: design rationale that no advice line may
 * cite and nothing renders. Each names a competitor tool or its study, so
 * none is named here; each points at the research note that holds the full
 * citation. They stay unverified because nothing may cite them.
 *
 * Vendor pages still to be read (the AI crawlers' documentation, Google's
 * software-app requirements, each review platform's policy) join the register
 * unverified, in the files of the packages that use them.
 */
export const SOURCES: Source[] = [
  {
    id: "G1",
    title: "Search Central, spam policies",
    publisher: "Google",
    url: "https://developers.google.com/search/docs/essentials/spam-policies",
    updated: "2026-08-28",
    read: "2026-10-12",
    verified: true,
    internal: false,
    note: "The link-spam line on every playbook (buying links that pass ranking credit, excessive link exchanges, keyword-rich anchors in supplied articles); cloaking.",
  },
  {
    id: "G2",
    title: "Search Central, general structured data guidelines",
    publisher: "Google",
    url: "https://developers.google.com/search/docs/appearance/structured-data/sd-policies",
    updated: "2026-07-10",
    read: "2026-10-12",
    verified: true,
    internal: false,
    note: "Marked-up content must be visible, relevant, complete and not misleading; markup is no guarantee of a rich result.",
  },
  {
    id: "G3",
    title: "Search Central, structured data search gallery",
    publisher: "Google",
    url: "https://developers.google.com/search/docs/appearance/structured-data/search-gallery",
    updated: "2026-06-15",
    read: "2026-10-12",
    verified: true,
    internal: false,
    note: "The structured data types Google Search supports.",
  },
  {
    id: "G4",
    title: "Search Central, FAQPage documentation",
    publisher: "Google",
    url: "https://developers.google.com/search/docs/appearance/structured-data/faqpage",
    updated: "2026-05-07",
    read: "2026-10-12",
    verified: true,
    internal: false,
    note: "FAQ rich results are no longer shown from 7 May 2026 (changelog entries 8 May and 15 Jun 2026): the FAQ info line.",
  },
  {
    id: "S41",
    title: "Search Central, AI features and your website",
    publisher: "Google",
    url: "https://developers.google.com/search/docs/appearance/ai-features",
    updated: "2025-12-10",
    read: "2026-10-12",
    verified: true,
    internal: false,
    note: "No special schema or AI text files are needed; crawling must be allowed; keep important content in text form.",
  },
  {
    id: "S43",
    title: "JSON-LD and AI citations, a matched-control study of 1,885 pages against 4,000 controls",
    publisher: "a competitor tool (named in research note 06, register entry S43)",
    url: "docs/diy-platform-2026-10-12/06-competitors-ai-visibility.md",
    updated: "2026-05-11",
    read: "2026-10-12",
    verified: false,
    internal: true,
    note: "Internal only: why the schema copy never promises AI citations. Never rendered: it names a competitor, and a one-line summary would drop its AI Overviews result.",
  },
  {
    id: "S8",
    title: "Prompt wording and AI visibility, a working paper",
    publisher: "a competitor tool (named in research note 06, register entry S8)",
    url: "docs/diy-platform-2026-10-12/06-competitors-ai-visibility.md",
    updated: null,
    read: "2026-10-12",
    verified: false,
    internal: true,
    note: "Internal only: the rationale for one prompt per placement. Dated June 2026 in the note.",
  },
  {
    id: "S40",
    title: "Answers vary from one day to the next, a tracking vendor's study as reported by a search trade publication",
    publisher: "a search trade publication (named in research note 06, register entry S40)",
    url: "docs/diy-platform-2026-10-12/06-competitors-ai-visibility.md",
    updated: "2026-01-30",
    read: "2026-10-12",
    verified: false,
    internal: true,
    note: "Internal only: why a status line changes only when two readings agree. Never quoted: the vendor sells tracking.",
  },
];
