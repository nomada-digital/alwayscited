import type { Source } from "../core/evidence.ts";

/**
 * Your pages' own register entries (13 Oct 2026, DIY P8; spec 10 sections
 * 4.9, 6.4 and 6.10 item 1): the vendor pages that say what each crawler is
 * for, and Google's software-app requirements. Every one is seeded
 * `verified: false`, so none can back an advice line or render until someone
 * reads the vendor's page, records its address, its updated date and the day
 * it was read, and sets `verified` (advice-grades.test.mts holds that).
 *
 * Until then, on the Bots view, these crawlers show their name and their
 * state only - never what they are for - and a block of one raises no
 * Blocking item (section 6.4: only for crawlers whose source says they serve
 * search or answers). Googlebot is the one crawler with a verified source at
 * launch, S41 in core.sources.ts.
 *
 * The addresses here are each vendor's own host, as the privacy census
 * records them (privacy.test.mts DOMAINS); the page's exact address is
 * written in when it is read and verified.
 */
export const SOURCES: Source[] = [
  {
    id: "V-OPENAI",
    title: "OpenAI's crawler documentation (GPTBot, OAI-SearchBot, ChatGPT-User)",
    publisher: "OpenAI",
    url: "https://openai.com/",
    updated: null,
    read: null,
    verified: false,
    internal: false,
    note: "What GPTBot, OAI-SearchBot and ChatGPT-User are for. Not yet read: their purpose is not shown, and a block of one raises no Blocking item.",
  },
  {
    id: "V-PERPLEXITY",
    title: "Perplexity's crawler documentation (PerplexityBot, Perplexity-User)",
    publisher: "Perplexity",
    url: "https://perplexity.ai/",
    updated: null,
    read: null,
    verified: false,
    internal: false,
    note: "What PerplexityBot and Perplexity-User are for. Not yet read.",
  },
  {
    id: "V-ANTHROPIC",
    title: "Anthropic's crawler documentation (ClaudeBot, Claude-SearchBot, Claude-User)",
    publisher: "Anthropic",
    url: "https://anthropic.com/",
    updated: null,
    read: null,
    verified: false,
    internal: false,
    note: "What ClaudeBot, Claude-SearchBot and Claude-User are for. Not yet read.",
  },
  {
    id: "V-GEXTENDED",
    title: "Google's common crawlers, Google-Extended",
    publisher: "Google",
    url: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
    updated: null,
    read: null,
    verified: false,
    internal: false,
    note: "What Google-Extended controls. Not yet read: the Bots view shows it as a choice, never as an error, whatever this says.",
  },
  {
    id: "V-BING",
    title: "Bing's crawlers",
    publisher: "Microsoft Bing",
    url: "https://bing.com/webmasters",
    updated: null,
    read: null,
    verified: false,
    internal: false,
    note: "What Bingbot is for. Not yet read.",
  },
  {
    id: "V-SOFTWAREAPP",
    title: "Search Central, software app (SoftwareApplication) structured data",
    publisher: "Google",
    url: "https://developers.google.com/search/docs/appearance/structured-data/software-app",
    updated: null,
    read: null,
    verified: false,
    internal: false,
    note: "Google's SoftwareApplication requirements: the software check and its examples pair do not ship until this is read (spec 10 sections 4.9 and 6.4, [VERIFY]).",
  },
];
