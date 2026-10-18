/**
 * What the product does today, for the copy that would claim it.
 *
 * LB1 of the go-to-market audit (8 Oct 2026, every claim checked by two or
 * three adversarial verifiers): the live site sold an agency a white-label
 * dashboard, white-label reports, its own domain, coverage upload, Google
 * positions for the host article and consolidated invoicing. The product did
 * none of them, and nothing joined the copy to the code - `/white-label`'s
 * table was the site's record of who brands what, and nothing checked the
 * table against the product.
 *
 * So each capability is one flag here, false until the feature ships, and
 * every line of copy that claims one is written inside `listIf` or `onlyIf`
 * naming the flag it needs. While the flag is false the line is withheld; the
 * day the feature ships, flipping the flag restores every line at once, in
 * the words it had. `capability-claims.test.mts` fails when copy claims a
 * capability that is off - in the source outside its gate, always, and on a
 * built page after `npm run build` and `npm run capture`.
 *
 * Flipping a flag is a claim to a buyer. Do it in the commit that ships the
 * feature, with the evidence, and move the dated record in
 * `capability-claims.test.mts` in the same commit.
 *
 * No imports, so a `.mts` census can load this file as it is.
 */

export type Capability =
  | "dashboardBranding"
  | "reportBranding"
  | "ownDomain"
  | "coverageUpload"
  | "hostArticleRankings"
  | "consolidatedInvoicing";

export const CAPABILITIES: Readonly<Record<Capability, boolean>> = {
  /**
   * The dashboard and its sign-in mail carry the agency's name, logo and
   * colours and no mark of ours. Build item AG-2. Today `Sidebar.tsx`'s
   * Lockup draws the alwayscited mark and the alwaystracked name in every
   * mode, and `login-mail.ts` sends "Your alwayscited login link" under our
   * own wordmark. Since 18 Oct 2026 (brief 2e) the client-facing invite email
   * reads `accounts.agency_name` and prints it as "for <agency>" under our
   * wordmark - a name, not branding: no logo, no colours, and our mark stays.
   */
  dashboardBranding: false,
  /**
   * A monthly report an agency can send under its own name and logo. Build
   * item RP-1. Today a report is the range's CSVs (`report-csv.ts`), and PDF
   * and scheduled reports are out of v1.
   */
  reportBranding: false,
  /**
   * The dashboard served on the agency's own domain or subdomain. No build
   * item: AG-2 keeps the shared app host, and own-domain white label is out of
   * scope (docs/tracked-dashboard-2026-10-05-app/04-migration-brief.md).
   */
  ownDomain: false,
  /**
   * A client pastes a campaign's coverage and sees which pieces the engines
   * cite. Build item DB-10. Today `placements.ts` refuses kind "coverage"
   * below alwayseverywhere and the admin form refuses any placement for
   * alwaystracked. The public one-off `/coverage-check` is a different thing
   * and is not this flag.
   */
  coverageUpload: false,
  /**
   * Google positions for the article hosting a placement, read apart from the
   * client's own page. Build item DB-10. Today `runner.ts` asks
   * `readKeywordPosition` for the client's domain only.
   */
  hostArticleRankings: false,
  /**
   * One invoice across an agency's clients. No build item: checkout creates
   * one subscription per client domain, so this is a billing decision.
   */
  consolidatedInvoicing: false,
};

const live = (needs: Capability | readonly Capability[]): boolean =>
  (typeof needs === "string" ? [needs] : needs).every((c) => CAPABILITIES[c]);

/**
 * The items while every capability they claim is live, and none while any is
 * not. Spread into a list: `[...listIf("coverageUpload", "Coverage matching")]`.
 */
export function listIf<T>(needs: Capability | readonly Capability[], ...items: T[]): T[] {
  return live(needs) ? items : [];
}

/**
 * The value while every capability it claims is live, else null. For a single
 * node or sentence; `?? today` after the call gives the form that is true now,
 * and sits outside the gate on purpose so the census reads it as live copy.
 */
export function onlyIf<T>(needs: Capability | readonly Capability[], value: T): T | null {
  return live(needs) ? value : null;
}
