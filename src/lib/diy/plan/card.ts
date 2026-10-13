import { formatDay } from "../../tracking/figures.ts";
import { SYSTEM, isStaleNote, staleNote } from "./refresh.ts";
import { type PlanItem, STATUS_LABEL } from "./types.ts";

/**
 * The card's rule-written lines that depend on who is looking (13 Oct 2026,
 * DIY P3, after review). Pure, so node --test holds them; PlanCard draws
 * what these answer.
 */

export type Member = { email: string; name: string | null };

/**
 * The owner as the card says it: "You" only when it is the viewer, a
 * member's name or address otherwise, and null - no owner line - when nobody
 * is assigned, as the select's "Nobody in particular" says (review, 13 Oct
 * 2026: an unassigned item told every member they owned it).
 */
export function ownerName(email: string | null, viewer: string, members: readonly Member[] | null): string | null {
  if (!email) return null;
  if (email.toLowerCase() === viewer.toLowerCase()) return "You";
  const m = members?.find((x) => x.email.toLowerCase() === email.toLowerCase());
  return m?.name?.trim() || email;
}

/**
 * The note lines: a member's note, and the system's "No longer applies" line
 * on an item the system dropped - from its note when it wrote one, else from
 * the day it dropped it. A stale line is never drawn on a live card, nor
 * offered back as the member's note.
 */
export function noteLines(item: Pick<PlanItem, "status" | "statusBy" | "statusAt" | "note">): { note: string | null; stale: string | null } {
  const note = item.note && !isStaleNote(item.note) ? item.note : null;
  if (item.status !== "dropped" || item.statusBy !== SYSTEM) return { note, stale: null };
  return { note, stale: isStaleNote(item.note) ? item.note : staleNote(item.statusAt.slice(0, 10)) };
}

/**
 * A card's status in words, first on the card in the list's In progress,
 * where To do and Doing sit together (13 Oct 2026, Danny): "To do", or
 * "Doing since 3 Oct" with the day it was started, "Doing" when that day is
 * not known.
 */
export function stateLine(item: Pick<PlanItem, "status" | "startedOn">): string {
  if (item.status === "doing") return item.startedOn ? `Doing since ${formatDay(item.startedOn)}` : STATUS_LABEL.doing;
  return STATUS_LABEL[item.status];
}
