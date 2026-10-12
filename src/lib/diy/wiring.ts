import type { JobHandler } from "./core/jobs.ts";

/**
 * What the DIY night runs, and where Plan's candidates come from (13 Oct
 * 2026, DIY P1; spec 10 sections 5.7 and 6.1). A registry: P1 creates it
 * empty, and only the shell packages edit it - P5 in wave 1 (P3's
 * `plan_refresh`), P9 in wave 2 (P6, P7 and P8's jobs and candidate sources),
 * P10 in wave 3 (the Backlinks jobs). `refuseHandlers` (jobs.ts) is the rule
 * the shell's wiring test runs over JOB_HANDLERS.
 *
 * P1 has no per-client job: the two free vendor reads belong to the
 * dispatcher, never to a job.
 */
export const JOB_HANDLERS: JobHandler[] = [];

/**
 * Plan's candidate sources (P3 owns the contract, `src/lib/diy/plan/types.ts`
 * `CandidateSource`). Typed loosely here so this file does not depend on a
 * package that branches after it; the shell that registers the first source
 * narrows it to `CandidateSource[]`.
 */
export const CANDIDATE_SOURCES: readonly unknown[] = [];
