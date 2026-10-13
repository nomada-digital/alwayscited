import { type RefusalCode, refusalWords } from "../core/caps.ts";
import { VIEWER_REASON } from "../plan/transitions.ts";

/** The words on every control a viewer cannot use (spec 10 section 2.2), as Actions writes them. */
export { VIEWER_REASON };
/** The same for an ended client, whose pages stay readable. */
export const ENDED_REASON = "Tracking has ended for this client, so its pages are read-only.";

/**
 * The pages route's answers, as fixed codes in the 303's query and fixed
 * words on the page (13 Oct 2026, DIY P8; spec 10 sections 2.1 item 9 and
 * 3.6). Nothing typed is echoed from the URL: an unknown code draws nothing.
 */

export const PAGES_DO = ["add", "remove", "check", "example", "act"] as const;
export type PagesDo = (typeof PAGES_DO)[number];
export const isPagesDo = (v: unknown): v is PagesDo => typeof v === "string" && (PAGES_DO as readonly string[]).includes(v);

export const PAGES_DONE = ["added", "replaced", "removed", "checked", "checked_own", "requested", "acted", "refused"] as const;
export type PagesDone = (typeof PAGES_DONE)[number];

/** Refusals of the route's own, beside runOnDemand's refusal codes. */
export const PAGES_WHY = [
  "not_own",
  "already",
  "full",
  "bad_url",
  "role",
  "gone",
  "failed",
  "readonly",
  "pending",
  "cluster",
  "item",
  "unreadable",
  "elsewhere",
  "examples_out",
  "checks_out",
  "tracking_running",
  "global_daily",
  "model_headroom",
  "door_daily",
  "month_budget",
  "allowance",
  "disabled",
  "ledger_unreadable",
  "deadline",
  "fixture",
  "client_inactive",
] as const;
export type PagesWhy = (typeof PAGES_WHY)[number];

const DONE_WORDS: Record<Exclude<PagesDone, "refused">, string> = {
  added: "Added. We read it now and again with your other key pages each week.",
  replaced: "Added, in place of your oldest automatic key page.",
  removed: "Removed. We won't add it back on our own.",
  checked: "Checked. This page's reads are up to date.",
  checked_own: "We read your page; the JavaScript read didn't finish. It didn't use a check.",
  requested: "Writing your example. It's usually ready in a minute; refresh to see it.",
  acted: "Added to Actions.",
};

const OWN_WHY: Partial<Record<PagesWhy, string>> = {
  not_own: "That address isn't on your own domain, so it can't be a key page.",
  already: "That page is already one of your key pages.",
  full: "All 10 key pages are ones you added. Remove one first.",
  bad_url: "That isn't a web address we can read. Paste the page's full address.",
  role: "Viewers can't change this. Ask an owner or editor.",
  gone: "That page has changed since you opened it. Try again.",
  failed: "That didn't save. Try again in a few minutes.",
  readonly: "This preview doesn't save changes.",
  pending: "An example for this page is already being written. Refresh to see it.",
  cluster: "This page doesn't serve that cluster.",
  item: "That can't be added to Actions from here.",
  unreadable: "We couldn't read this page, so there is nothing to draft from yet.",
  elsewhere: "Another of your pages is the one that ranks for this keyword. Ask for the example on that page.",
};

const isWhy = (v: string | null): v is PagesWhy => v !== null && (PAGES_WHY as readonly string[]).includes(v);

/**
 * The toast's words, or null. A used-up allowance comes back as which one
 * (`examples_out`, `checks_out`), and its line is the one the page works out
 * itself from this month's counts (allowances.ts usedUpLine).
 */
export function pagesToast(done: string | null, why: string | null, p: { resets: string; examplesLine?: string | null; checksLine?: string | null }): string | null {
  if (done && done !== "refused" && (PAGES_DONE as readonly string[]).includes(done)) return DONE_WORDS[done as Exclude<PagesDone, "refused">];
  if (done !== "refused" || !isWhy(why)) return null;
  if (why === "examples_out") return refusalWords("allowance", { resets: p.resets, allowanceLine: p.examplesLine });
  if (why === "checks_out") return refusalWords("allowance", { resets: p.resets, allowanceLine: p.checksLine });
  return OWN_WHY[why] ?? refusalWords(why as RefusalCode, p);
}
