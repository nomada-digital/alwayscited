import type { JobHandler } from "./core/jobs.ts";
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
 * held, which reads nothing paid. Wave 2 adds P7's opportunities and P8's
 * pages and P6's keywords here.
 */
export const CANDIDATE_SOURCES: readonly CandidateSource[] = [trackingCandidates];

/**
 * 13 Oct 2026, DIY P5: `plan_refresh` (P3), free and daily, over every
 * registered candidate source. Free kinds are queued whatever `diy_enabled`
 * says (spec 5.7 dispatch step 4), so this runs from the first night after the
 * push, once the diy_core and plan_items migrations are applied.
 */
export const JOB_HANDLERS: JobHandler[] = [planRefreshHandler(CANDIDATE_SOURCES)];
