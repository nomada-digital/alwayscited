/**
 * For the censuses that read `pricing.ts` as text (price-claims,
 * price-surfaces, price-schema, video): Node cannot import that file because
 * of its `@/` specifiers, so they regex its literals. Since R50 section 3 the
 * sector tiers' figures are calls - `fromLabel("cited")`, `fromPrice("cited",
 * "us")` - and this writes each call back as the literal it evaluates to, so
 * the parsers read the figure the page will actually draw rather than going
 * blind on a call.
 */
/*
 * Where the figures come from. sector-prices.json is the output of the sector
 * costs method (R50, 27 Sep 2026; the script and its cost basis live outside
 * this public repository): per sector and market, the trimmed mean marketplace
 * price of a guest post and of a link insertion on DR 30+ sites with traffic in
 * the market, priced at the sector's most expensive member category, then
 *
 *   alwaysmentioned = up to the next x95 of max(995, 3 guest posts + 495)
 *   alwayscited     = up to the next x95 of max(2,495, 3 guest posts
 *                     + 2 insertions at 350 or more + 350 on-site + 995)
 *
 * with every floor, margin and allowance in pounds and converted for the US.
 *
 * Funeral and end-of-life (15 Nov 2026, for the Dignity Funerals proposal;
 * NOT yet approved by Danny). The answer engines were asked 20 UK buyer
 * prompts across four clusters - funeral plans, direct cremation, funeral
 * costs, funeral directors and crematoria. What they cite is personal-finance
 * and consumer-advice publishing, regulators and government guidance, and the
 * providers themselves; few of the publishers sell placements, so much of the
 * work is pitched or earned rather than bought. The marketplace has no
 * funeral category. Funeral plans are a regulated financial product and their
 * cited sources are finance sources, so by the method's own rule (a sector is
 * priced at its most expensive member) the sector takes the Finance basis:
 * the same figures as Finance. The cited sites that do sell placements cost
 * no more than that basis assumes. The US figures follow the same basis and
 * were not checked against US answers.
 */
import { fromLabel, fromPrice, type Market, type SectorTier } from "./sector-pricing.ts";

export function inlineSectorPrices(source: string): string {
  return source
    .replace(/fromLabel\("(mentioned|cited)"\)/g, (_, t: SectorTier) => JSON.stringify(fromLabel(t)))
    .replace(/fromPrice\("(mentioned|cited)",\s*"(us|uk)"\)/g, (_, t: SectorTier, m: Market) => String(fromPrice(t, m)));
}
