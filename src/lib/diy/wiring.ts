import type { JobHandler } from "./core/jobs.ts";
import { footprintHandler } from "./keywords/footprint.job.ts";
import { keywordCandidates } from "./keywords/candidates.ts";
import { opportunityCandidates } from "./opportunities/candidates.ts";
import { classifyHandler } from "./opportunities/classify.job.ts";
import { pageReadsHandler } from "./opportunities/page-reads.job.ts";
import { opportunityRefreshHandler } from "./opportunities/refresh.job.ts";
import { linksCandidates } from "./links/candidates.ts";
import { backlinksMonthlyHandler } from "./links/monthly.job.ts";
import { backlinksWeeklyHandler } from "./links/weekly.job.ts";
import { watchHandler } from "./opportunities/watch.job.ts";
import { pagesCandidates } from "./pages/candidates.ts";
import { keyPagesMonthlyHandler } from "./pages/monthly.job.ts";
import { keyPagesWeeklyHandler } from "./pages/weekly.job.ts";
import { planRefreshHandler } from "./plan/plan-refresh.job.ts";
import { trackingCandidates } from "./plan/tracking-candidates.ts";
import type { CandidateSource } from "./plan/types.ts";

/**
 * What the DIY night runs, and where Plan's candidates come from (13 Oct
 * 2026, DIY P1; spec 10 sections 5.7 and 6.1). A registry: P1 creates it
 * empty, and only the shell packages edit it - P5 in wave 1 (P3's
 * `plan_refresh`), P9 in wave 2 (P6, P7 and P8's jobs and candidate sources),
 * P10 in wave 3 (the Backlinks jobs). `refuseHandlers` (jobs.ts) is the rule
 * the shell's wiring test runs over JOB_HANDLERS (wiring.test.mts).
 *
 * P1 has no per-client job: the two free vendor reads belong to the
 * dispatcher, never to a job.
 */

/**
 * Plan's candidate sources (P3 owns the contract, `src/lib/diy/plan/types.ts`
 * `CandidateSource`). 13 Oct 2026, DIY P5: narrowed from `unknown[]` now the
 * first source is registered - P3's Slipping from the tracking data already
 * held, which reads nothing paid.
 *
 * 13 Oct 2026, DIY P9 (spec 10 section 6.1): wave 2's three, in the spec's
 * order - tracking + keywords + opportunities + pages. P6's keywords (Tidy-up:
 * a gaining keyword while a cluster slot is free; nothing while diy_enabled is
 * off or unreadable), P7's opportunities (Biggest gap, and Slipping when a
 * pursued page or won link was found removed), P8's pages (Blocking, Closest
 * win, and the schema Tidy-up). Each reads only stored rows; none spends.
 *
 * 13 Oct 2026, DIY P10 (spec 10 sections 6.1 and 6.3): wave 3's Reclaim, a
 * Slipping card for a lost link that pointed at a live key page, read from
 * the stored weekly Backlinks read; nothing while diy_enabled is off.
 */
export const CANDIDATE_SOURCES: readonly CandidateSource[] = [trackingCandidates, keywordCandidates, opportunityCandidates, pagesCandidates, linksCandidates];

/**
 * 13 Oct 2026, DIY P5: `plan_refresh` (P3), free and daily, over every
 * registered candidate source. Free kinds are queued whatever `diy_enabled`
 * says (spec 5.7 dispatch step 4), so this runs from the first night after the
 * push, once the diy_core and plan_items migrations are applied.
 *
 * 13 Oct 2026, DIY P9 (spec 10 section 5.7, the job kinds table): wave 2's
 * seven. Free, queued whatever `diy_enabled` says: P7's `opportunity_refresh`
 * (daily: derives the AI-cited and lists rows from stored citations) and
 * `watch` (daily, choosing pursued pages weekly and won pages monthly; own
 * fetch only), P8's `key_pages_weekly` (weekly and onboarding: own fetches of
 * the key pages, robots.txt and llms.txt). Paid, queued only for confirmed
 * clients while `diy_enabled` is on, every read through P1's doors and the
 * ledger: P6's `footprint` (weekly when DataForSEO's Labs date moved, and
 * onboarding), P7's `page_reads` (daily, at most 40 content_parsing reads,
 * and onboarding) and `classify` (daily model calls in chunks of at most 50),
 * P8's `key_pages_monthly` (monthly and onboarding: instant_pages, the
 * validator, top-3 structure reads). The default dependencies are the real
 * doors and our guarded fetch; the tests pass fakes.
 *
 * 13 Oct 2026, DIY P10 (spec 10 sections 5.2 and 5.7): wave 3's two, both
 * paid, through P1's doors on the backlinks and content doors: P10's
 * `backlinks_weekly` (weekly and onboarding: the profile summary, the week's
 * new and lost referring domains) and `backlinks_monthly` (monthly: the
 * comparison set, the 13-week series, bulk x 3, the domain and page gaps,
 * and the mentions with our own reads to confirm them).
 */
export const JOB_HANDLERS: JobHandler[] = [
  planRefreshHandler(CANDIDATE_SOURCES),
  footprintHandler(),
  opportunityRefreshHandler(),
  pageReadsHandler(),
  classifyHandler(),
  watchHandler(),
  keyPagesWeeklyHandler(),
  keyPagesMonthlyHandler(),
  backlinksWeeklyHandler(),
  backlinksMonthlyHandler(),
];
