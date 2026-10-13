import { FREE_ENGINES, type Engine } from "../scan/engines.ts";
import { countCitedDomains } from "./citation-count.ts";
import { coveragePieces } from "./pieces.ts";
import { PLACEHOLDER, coveragePrompts } from "./prompts.ts";
import { buildCoverage, buildSources } from "./reading-figures.ts";
import type { CampaignReading } from "./reading.ts";

/**
 * The reading fixture (R151, 1 Oct 2026). `COVERAGE_FIXTURE_STATE` set to
 * complete, running, failed or stalled makes `/coverage-check/fixture` render
 * that state from made-up rows, so the four states of the reading page can be
 * shot without a real campaign token or a database - none existed in the repo
 * when the page's one-primary-action fix shipped, and it went out unseen.
 *
 * Only the token `fixture` answers; every other token still reads the database.
 * Never in production: with `VERCEL_ENV=production` set alongside the switch it
 * throws, the same refusal as `TRACKING_FIXTURE` (tracking/fixture-mode.ts).
 *
 * The brand is the placeholder `[Client brand]`, so a shot of it can never be
 * read as a measurement of anyone real.
 */
export const READING_FIXTURE_TOKEN = "fixture";

const STATES = ["complete", "running", "failed", "stalled"] as const;

export function readingFixture(
  token: string,
  env: Record<string, string | undefined> = process.env,
): CampaignReading | null {
  const state = env.COVERAGE_FIXTURE_STATE;
  if (!state || token !== READING_FIXTURE_TOKEN) return null;
  if (env.VERCEL_ENV === "production") {
    throw new Error("COVERAGE_FIXTURE_STATE is set in production - the reading page refuses the fixture");
  }
  if (!(STATES as readonly string[]).includes(state)) return null;

  const engines: Engine[] = [...FREE_ENGINES];
  const complete = state === "complete";
  const status = state === "running" ? "running" : state === "stalled" ? "draft" : state;
  // COVERAGE_FIXTURE_QUESTIONS=1-5 keeps the first N, standing in for an agency's own
  // fewer-than-five prompts (agencyPrompts), so the page's question counts can be seen.
  const keep = Number(env.COVERAGE_FIXTURE_QUESTIONS);
  const prompts = coveragePrompts(PLACEHOLDER).slice(0, keep >= 1 ? keep : undefined);

  // Named on every engine for the brand question, on some for the rest, on
  // none for the news one - the three pill tones the board draws.
  const questions = complete
    ? prompts.map((p, idx) => ({
        idx,
        kind: p.kind,
        question: p.question,
        answers: engines.map((engine, e) => {
          const answered = !(idx === 3 && e === engines.length - 1);
          return { engine, answered, brandNamed: answered && (idx === 0 || (!p.weak && e % 2 === 0)) };
        }),
      }))
    : // R151 (3 Oct 2026): a running or failed reading has its question rows from the
      // start (startBenchmark stores them), only no answers; without them the running
      // card read "0 questions". A stalled one may have died before they were written.
      state === "stalled"
      ? []
      : prompts.map((p, idx) => ({ idx, kind: p.kind, question: p.question, answers: [] as { engine: Engine; answered: boolean; brandNamed: boolean }[] }));
  const answers = questions.flatMap((q) => q.answers);
  const named = { count: answers.filter((a) => a.answered && a.brandNamed).length, of: answers.length };

  // R151 (3 Oct 2026): sources and pieces come from one made-up citation list,
  // through the functions the real reading uses, so they agree with each other
  // and with the questions kept. They were fixed figures - "cited in 6 answers"
  // beside a piece cited by one engine - which could not both be true, and with
  // COVERAGE_FIXTURE_QUESTIONS=2 claimed 6 of 8 answers. Five questions read as
  // before: 6, 4, 2 and 1.
  const cite = (domain: string, page: string | null, e: number, qs: number[]) =>
    qs.filter((q) => q < questions.length).map((q) => ({ source_domain: domain, url: page, question_id: `q${q}`, engine: engines[e] }));
  const citations = complete
    ? [
        ...cite("example-trade.com", "https://example-trade.com/news/launch", 0, [0, 1, 2]),
        ...cite("example-trade.com", "https://example-trade.com/news/round-up", 2, [0, 2, 4]),
        ...cite("example-review.com", null, 1, [0, 1, 2, 3]),
        ...cite("example-news.co.uk", null, 3, [0, 1]),
        ...cite("example-blog.com", null, 2, [1]),
      ]
    : [];
  const placed = new Set(["example-trade.com", "example-weekly.com"]);
  const counts = countCitedDomains(citations);
  const coverageRows = [
    { url: "https://example-trade.com/news/launch", source_domain: "example-trade.com" },
    { url: "https://example-weekly.com/feature", source_domain: "example-weekly.com" },
  ];

  return {
    campaign: {
      brand: PLACEHOLDER.brand,
      domain: "example.com",
      topic: PLACEHOLDER.topic,
      segment: null,
      market: "UK",
      createdAt: "2026-09-30T09:00:00Z",
    },
    reading: {
      id: "fixture-reading",
      scanToken: complete ? "fixture-scan" : null,
      market: "UK",
      status,
      step: null,
      error: state === "failed" ? "fixture: the engines did not answer" : null,
      createdAt: "2026-09-30T09:00:00Z",
      completedAt: complete ? "2026-09-30T09:04:00Z" : null,
      engines,
      enginesAnswered: complete ? engines : [],
    },
    questions,
    sources: complete ? buildSources(counts, placed) : [],
    coverage: complete ? buildCoverage(placed, counts) : { uploaded: 0, cited: 0, uncited: [] },
    pieces: complete ? coveragePieces(coverageRows, citations, engines) : [],
    named,
    history: [
      {
        id: "fixture-reading",
        status,
        takenAt: complete ? "2026-09-30T09:04:00Z" : null,
        named: named.count,
        answers: named.of,
      },
    ],
  };
}
