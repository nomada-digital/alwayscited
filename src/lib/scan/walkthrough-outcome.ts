/**
 * R151 (3 Oct 2026): the walkthrough ask posted without script comes back by a
 * 303 carrying only its outcome - never the address - as `?walkthrough=`. The
 * page reads it here and hands it to WalkthroughForm, which says it in place.
 *
 * 13 Oct 2026: name, category and market are required (Danny), so a refusal
 * of each comes back as its own word and the form puts it under that field.
 * The value typed is not carried back, for the reason the address is not.
 */
export type WalkthroughOutcome = "video" | "demo" | "bad" | "personal" | "name" | "category" | "market" | "failed";

const OUTCOMES: readonly WalkthroughOutcome[] = ["video", "demo", "bad", "personal", "name", "category", "market", "failed"];

export function readWalkthroughOutcome(raw: string | string[] | undefined): WalkthroughOutcome | null {
  return OUTCOMES.find((o) => o === raw) ?? null;
}

/** The word a route refusal comes back to the page as; anything unnamed is "failed". */
const REFUSED: Readonly<Record<string, WalkthroughOutcome>> = {
  bad_email: "bad",
  personal_email: "personal",
  bad_name: "name",
  bad_category: "category",
  bad_market: "market",
};

export function refusedOutcome(error: string | undefined): WalkthroughOutcome {
  return error && Object.hasOwn(REFUSED, error) ? REFUSED[error] : "failed";
}

/** Where a form post goes back to: the scan result or the reading it came from, else the scan. */
export function walkthroughBack(raw: unknown, token: string): string {
  return typeof raw === "string" && /^\/(scan|coverage-check)\/[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : `/scan/${token}`;
}
