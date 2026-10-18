import type { Metadata } from "next";

import HeroSection from "@/components/scan/HeroSection";
import { isPlausibleDomain, normalizeDomain } from "@/lib/scan/domain";
import { handoffMarket, scanRef } from "@/lib/scan/handoff";

/**
 * The landing for a domain submitted from elsewhere on the site. It prefills
 * the field and nothing more. Not indexed - it is a state, not a page.
 *
 * **A GET here cannot start a scan, and that is worth stating because the
 * question is a fair one.** `robots.txt` closes `/scan/` with a trailing
 * slash, which does not close `/scan?domain=...` - robots matching is literal
 * prefix, and after `/scan` comes `?`. GPTBot, Googlebot and Bingbot are all
 * `Allow: /` on this path, so if a GET with a query string started a pass,
 * every crawler that followed one would spend a scan. Asked by the 20 Sep
 * design review; answered from the source, three ways:
 *
 *  - `domain` below becomes a `useState` initial value and nothing else;
 *  - there is no `useEffect` in `HeroSection`, `LiveScanChecker` or
 *    `RequestScanForm`, so nothing at all runs on mount;
 *  - the fetch to `/api/scan/start` is inside a submit handler, and that route
 *    exports POST only. A crawler issues GETs and does not submit forms.
 *
 * The third is now a tripwire - `src/app/api/paid-get.test.mts` - because a
 * route gains a method in one line and nothing else in the tree would notice.
 *

 * It is also where a verification link lands when it cannot do its job, which
 * is why it reads `verify`. Both of those redirects existed and neither said
 * anything: somebody who clicked the link in their email arrived at a plain
 * scan form, with the report they had just proved an address for nowhere on
 * screen and no hint that anything had gone wrong. A dead end that looks like
 * a home page is worse than an error, because there is nothing to act on.
 */
export const metadata: Metadata = {
  title: "Checking your client's domain",
  robots: { index: false, follow: false },
};

/**
 * One sentence for what happened and one for what to do about it. `failed` is
 * retryable and says so - the same link works on the next click, because the
 * verify route recovers a lead whose unlock did not land. `invalid` is not, so
 * it points at the only thing that still works.
 *
 * A Map, because the key is a query string. As an object literal the lookup
 * read the prototype chain as well as the table, and the names on it are
 * ordinary words: `/scan?verify=constructor` resolved to the Object function,
 * `?? null` did not fire because a function is not nullish, and a function was
 * then passed from this server component into a client one - which Next
 * refuses.
 * The funnel's landing page answered 500 to a query string anybody could type,
 * confirmed live before this change. A Map has no inherited keys, so the only
 * thing this can answer with is a sentence written here.
 */
const VERIFY_NOTICE: ReadonlyMap<string, string> = new Map([
  [
    "failed",
    "We could not open your report just now. Click the link in your email again in a moment - it will still work.",
  ],
  [
    "invalid",
    "That link does not match a report we hold. It may have been truncated by an email client. Run a scan below and we will send you a fresh one.",
  ],
]);

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; verify?: string; ref?: string; market?: string }>;
}) {
  const { domain = "", verify, ref, market } = await searchParams;
  // A scan handed over from a partner site (18 Oct 2026): a plausible ?domain= starts by itself, with its ref and market
  // checked here (lib/scan/handoff.ts). No domain, or one that cannot be an address: the step 1 form, as before. A
  // verify notice is a person arriving from an email link, never a hand-off, so it never auto-starts.
  const handoff = { ref: scanRef(ref), market: handoffMarket(market) };
  const autoStart = !verify && isPlausibleDomain(normalizeDomain(domain));
  return <HeroSection initialDomain={domain} notice={(verify && VERIFY_NOTICE.get(verify)) || null} autoStart={autoStart} handoff={handoff} />;
}
