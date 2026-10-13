import type { SupabaseClient } from "@supabase/supabase-js";

import { keywordForm } from "../../scan/dataforseo-request.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { formatDate } from "../../format-date.ts";
import { ENDED_REASON, VIEWER_REASON } from "../plan/transitions.ts";

import { DISMISS_DAYS, type Dismissal, liveDismissal } from "./data.ts";

/** Why a member cannot write here, in the words the Plan uses: an ended client's, or a viewer's. */
export const readOnlyReason = (c: { status?: string | null }): string => (c.status === "ended" ? ENDED_REASON : VIEWER_REASON);

/**
 * Dismiss and restore a gaining-ground keyword (13 Oct 2026, DIY P6; spec 10
 * section 3.6: `/api/app/[client]/keywords`, `do` = dismiss or restore, a
 * keyword of at most 120 characters). Pure decision plus two small writes.
 *
 * Allow-listed, never free text: a dismiss names a keyword the client's
 * latest footprint pull holds, and a restore one of its live dismissals, so
 * the only text stored is DataForSEO's own keyword, as the pull has it.
 * Nothing is deleted: a restore sets `until` to the day before, keeping who
 * dismissed it and when.
 *
 * The toast is a code, `done` and `why`, drawn as fixed words (KEYWORDS_TOAST);
 * the keyword a dismissed toast names is read back from the stored row, never
 * from the URL.
 */

export const KEYWORDS_DO = ["dismiss", "restore"] as const;
export type KeywordsDo = (typeof KEYWORDS_DO)[number];
export const isKeywordsDo = (v: unknown): v is KeywordsDo => (KEYWORDS_DO as readonly unknown[]).includes(v);

export type KeywordsDone = "dismissed" | "restored" | "refused";
export type KeywordsWhy = "viewer" | "ended" | "unknown" | "failed" | "readonly" | "dark";
export const KEYWORDS_DONE: readonly KeywordsDone[] = ["dismissed", "restored", "refused"];
export const KEYWORDS_WHY: readonly KeywordsWhy[] = ["viewer", "ended", "unknown", "failed", "readonly", "dark"];

/** The keyword field's bound (diy_dismissals.key's check). */
export const KEYWORD_MAX = 120;

export type KeywordsDecision =
  | { op: "dismiss"; key: string; until: Day }
  | { op: "restore"; key: string; until: Day }
  | { op: "refuse"; why: KeywordsWhy };

/**
 * What one post does. `refused` is writeRole's refusal (null when the member
 * may write) and `ended` whether the client's tracking has ended - writeRole
 * refuses an owner there too, and the toast says that reason, not the
 * viewer's (13 Oct 2026, review of the P6 handoff); `latest` the keywords of
 * the latest pull; `dismissals` the client's.
 */
export function decideKeywords(p: { do: KeywordsDo; keyword: unknown; refused: string | null; ended?: boolean; enabled: boolean; latest: ReadonlySet<string> | null; dismissals: readonly Dismissal[]; today: Day }): KeywordsDecision {
  if (p.refused) return { op: "refuse", why: p.ended ? "ended" : "viewer" };
  if (!p.enabled) return { op: "refuse", why: "dark" };
  const raw = typeof p.keyword === "string" ? p.keyword.trim() : "";
  if (!raw || raw.length > KEYWORD_MAX) return { op: "refuse", why: "unknown" };
  const key = keywordForm(raw);
  if (p.do === "dismiss") {
    if (!p.latest) return { op: "refuse", why: "failed" };
    const held = [...p.latest].find((k) => keywordForm(k) === key);
    if (!held) return { op: "refuse", why: "unknown" };
    return { op: "dismiss", key: held, until: addDays(p.today, DISMISS_DAYS) };
  }
  const live = p.dismissals.find((d) => keywordForm(d.key) === key && liveDismissal(d, p.today));
  if (!live) return { op: "refuse", why: "unknown" };
  return { op: "restore", key: live.key, until: addDays(p.today, -1) };
}

/** A dismissal, written or written again: the newest one is the one a toast's Undo restores. */
export async function writeDismissal(db: SupabaseClient, p: { clientId: string; key: string; until: Day; by: string; now: string }): Promise<void> {
  const { error } = await db
    .from("diy_dismissals")
    .upsert([{ client_domain_id: p.clientId, kind: "gaining_keyword", key: p.key, until: p.until, by_email: p.by, created_at: p.now }], { onConflict: "client_domain_id,kind,key" });
  if (error) throw new Error(`could not save the dismissal: ${error.message}`);
}

/** A restore: the dismissal lapses yesterday. One client's row, by its key. */
export async function lapseDismissal(db: SupabaseClient, p: { clientId: string; key: string; until: Day }): Promise<void> {
  const { error } = await db.from("diy_dismissals").update({ until: p.until }).eq("client_domain_id", p.clientId).eq("kind", "gaining_keyword").eq("key", p.key);
  if (error) throw new Error(`could not restore the keyword: ${error.message}`);
}

/** The same two writes on the fixture's dismissals, held in memory. */
export function applyToFixture(rows: readonly Dismissal[], d: Exclude<KeywordsDecision, { op: "refuse" }>, p: { by: string; now: string }): Dismissal[] {
  const rest = rows.filter((r) => keywordForm(r.key) !== keywordForm(d.key));
  const had = rows.find((r) => keywordForm(r.key) === keywordForm(d.key));
  if (d.op === "dismiss") return [{ key: d.key, until: d.until, by: p.by, at: p.now }, ...rest];
  return had ? [...rest, { ...had, until: d.until }] : [...rest];
}

export const readDone = (v: string | null): KeywordsDone | null => ((KEYWORDS_DONE as readonly string[]).includes(String(v)) ? (v as KeywordsDone) : null);
export const readWhy = (v: string | null): KeywordsWhy | null => ((KEYWORDS_WHY as readonly string[]).includes(String(v)) ? (v as KeywordsWhy) : null);

const WHY: Record<KeywordsWhy, string> = {
  viewer: VIEWER_REASON,
  ended: ENDED_REASON,
  unknown: "That keyword isn't in your latest Google footprint, so nothing changed.",
  failed: "That didn't save. Try again.",
  readonly: "This preview doesn't save changes.",
  dark: "Gaining ground isn't switched on yet, so nothing changed.",
};

/** The toast's fixed words. A dismissal names its keyword and its end from the stored row (`newest`), never from the URL. */
export function keywordsToast(done: KeywordsDone | null, why: KeywordsWhy | null, newest: Dismissal | null): string | null {
  if (done === "dismissed") return newest ? `'${newest.key}' is dismissed. It stays out of gaining ground until ${formatDate(newest.until)}.` : "Dismissed.";
  if (done === "restored") return "Restored. It shows in gaining ground again while it keeps climbing.";
  if (done === "refused") return WHY[why ?? "failed"];
  return null;
}
