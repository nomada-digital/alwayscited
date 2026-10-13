import { type RefusalCode, refusalWords } from "../core/caps.ts";

/**
 * The Links route's answers (13 Oct 2026, DIY P10; spec 10 sections 3.6 and
 * 4.8): fixed codes in the 303's `done` and `why`, and their fixed words
 * here. Nothing typed is echoed from the URL. Plain module, so node --test
 * runs it.
 */

export const LINKS_DONE = ["revealed", "already", "pursued", "checked", "refused"] as const;
export type LinksDone = (typeof LINKS_DONE)[number];

export const LINKS_WHY = [
  "viewer",
  "ended",
  "cap",
  "reveal_cap",
  "none",
  "gone",
  "url",
  "own",
  "failed",
  "readonly",
  "dark",
  "running",
  "paused",
  "daily",
  "month",
  "allowance",
  "inactive",
  "spend",
] as const;
export type LinksWhy = (typeof LINKS_WHY)[number];

export const readDone = (v: string | null): LinksDone | null => ((LINKS_DONE as readonly string[]).includes(v ?? "") ? (v as LinksDone) : null);
export const readWhy = (v: string | null): LinksWhy | null => ((LINKS_WHY as readonly string[]).includes(v ?? "") ? (v as LinksWhy) : null);

export const VIEWER_REASON = "Viewers can't change this. Ask an owner or editor.";
export const ENDED_REASON = "This account has ended, so Links is read-only.";

/** A refused read as its toast code, so its words are section 5.6's own. */
export function whyOfRefusal(code: RefusalCode): LinksWhy {
  switch (code) {
    case "tracking_running":
      return "running";
    case "global_daily":
    case "model_headroom":
      return "paused";
    case "door_daily":
      return "daily";
    case "month_budget":
      return "month";
    case "allowance":
      return "allowance";
    case "disabled":
      return "dark";
    case "client_inactive":
      return "inactive";
    case "ledger_unreadable":
    case "deadline":
    case "fixture":
      return "spend";
  }
}

const REFUSAL: Partial<Record<LinksWhy, RefusalCode>> = { running: "tracking_running", paused: "global_daily", daily: "door_daily", month: "month_budget", inactive: "client_inactive", spend: "ledger_unreadable" };

/**
 * The toast for a route answer. `cap` is the pursuits at once; `resets` the
 * day this client's allowance month turns; `revealLine` and `checkLine` the
 * used-up lines of its link targets and link checks (allowances.ts usedUpLine).
 */
export function linksToast(done: string | null, why: string | null, p: { cap: number; resets: string; revealLine: string | null; checkLine: string | null }): { tone: "good" | "bad"; text: string } | null {
  const d = readDone(done);
  if (!d) return null;
  const ok: Record<Exclude<LinksDone, "refused">, string> = {
    revealed: "Revealed. These pages stay on your list.",
    already: "Those pages were already revealed. They're on the list below.",
    pursued: "Pursuing. It's in Opportunities, under Pursuing, and in Actions.",
    checked: "Checked. The result is below.",
  };
  if (d !== "refused") return { tone: "good", text: ok[d] };
  const w = readWhy(why);
  const read = w && REFUSAL[w] ? refusalWords(REFUSAL[w]!, { resets: p.resets }) : null;
  const no: Record<LinksWhy, string> = {
    viewer: VIEWER_REASON,
    ended: ENDED_REASON,
    cap: `You're working ${p.cap} pages at once. Mark one won, declined or not for us to pursue another.`,
    reveal_cap: p.revealLine ?? `This month's link targets are used. They reset on ${p.resets}.`,
    none: "Every page in this month's read is already revealed.",
    gone: "That row has changed since you opened the page. The list is up to date now.",
    url: "That isn't a web address we can read. Paste the page's full address, starting https://.",
    own: "That's a page on your own site. Check a page on another site for a link to yours.",
    failed: "That didn't save. Try again in a moment.",
    readonly: "This preview doesn't save changes.",
    dark: "Your link data isn't switched on yet, so there is nothing to reveal or pursue here.",
    running: read ?? "",
    paused: read ?? "",
    daily: read ?? "",
    month: read ?? "",
    allowance: p.checkLine ?? `This month's link checks are used. They reset on ${p.resets}.`,
    inactive: read ?? "",
    spend: read ?? "We couldn't start that check just now. Try again in a few minutes.",
  };
  return { tone: "bad", text: (w && no[w]) || no.failed };
}
