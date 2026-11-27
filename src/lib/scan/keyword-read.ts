import type { Market } from "./domain.ts";
import { type OrganicDetail, type OrganicHit, parseGoogleAio, parseOrganic, parseOrganicDetailed, rankOfRead, serpFault } from "./engines.ts";

/**
 * What a tracked keyword's SERP says, beyond the position (27 Nov 2026, Danny: "the numbers stay honest but the visibility is visible").
 * Pure, so a test can read a recorded response; dataforseo.ts only fetches and resolves redirects.
 *
 *  rank, fault   the client's own position and whether the page can be ranked on, exactly as before (rankOfRead, serpFault)
 *  aio           whether an AI Overview showed, and whether it names the client (its text, or the client's site among its sources)
 *  candidates    third-party results in the top 10 whose title or snippet names the client: a directory or partner page that lists
 *                the brand (craftcms.com's COMMON page). Never counted as the client's own position.
 */
export type Listed = { rank: number; domain: string; url: string | null; title: string | null };
export type Analysis = {
  organic: OrganicHit[];
  detail: OrganicDetail[];
  rank: number | null | undefined;
  fault: ReturnType<typeof serpFault>;
  aio: { shown: boolean; named: boolean };
  candidates: OrganicDetail[];
};

const ownDomain = (d: string, own: string) => d === own || d.endsWith(`.${own}`);

export function analyseKeywordResult(result: Record<string, unknown> | undefined | null, o: { domain: string; market: Market; partial: boolean; names: (text: string) => boolean }): Analysis {
  const own = o.domain.toLowerCase().replace(/^www\./, "");
  const organic = parseOrganic(result);
  const detail = parseOrganicDetailed(result);
  const rank = rankOfRead(organic, own, o.partial, o.market);
  const aio = parseGoogleAio(result);
  const claimed = !!(aio.raw as { claimed_but_absent?: boolean } | null)?.claimed_but_absent;
  const named = aio.answered && (o.names(aio.prose) || aio.citations.some((c) => ownDomain(c.source_domain.toLowerCase().replace(/^www\./, ""), own)));
  const candidates = detail.filter((d) => d.rank <= 10 && !ownDomain(d.domain, own) && o.names(`${d.title ?? ""} ${d.description ?? ""}`));
  return { organic, detail, rank, fault: serpFault(organic, o.market), aio: { shown: aio.answered || claimed, named }, candidates };
}
