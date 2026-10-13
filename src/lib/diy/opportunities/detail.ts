import { formatDay, type Day } from "../../tracking/figures.ts";
import { PROMPTS_PER_CLUSTER } from "../../tracking/limits.ts";
import type { SwapCandidate } from "../prompts/swap.ts";

import type { OppDo } from "./status.ts";
import { DISMISS_LABEL, type HistoryEntry, type OppStatus, type Opportunity, STATUS_LABEL } from "./types.ts";

/**
 * One opportunity's page, worked out (13 Oct 2026, DIY P7; spec 10 section
 * 4.7): which moves it offers, its status in words, its history in words,
 * who an ask goes to, and the prompt step's state. Pure.
 */

/** The moves a status offers (status.ts holds the rule; these are the buttons). */
export function movesFor(status: OppStatus): OppDo[] {
  switch (status) {
    case "new":
      return ["pursue", "dismiss"];
    case "pursuing":
      return ["pitched", "won", "decline", "dismiss"];
    case "pitched":
      return ["won", "decline", "dismiss"];
    case "won":
      return ["reopen"];
    case "declined":
    case "dismissed":
      return ["pursue", "reopen"];
  }
}

/** "Pursuing since 3 Oct", "Not for us: not relevant, since 3 Oct", "New, first seen 12 Sep". */
export function statusLine(o: Pick<Opportunity, "status" | "statusAt" | "firstSeen" | "dismissReason">): string {
  const since = o.statusAt ? ` since ${formatDay(o.statusAt.slice(0, 10))}` : "";
  if (o.status === "new") return o.firstSeen ? `New, first seen ${formatDay(o.firstSeen)}` : "New";
  if (o.status === "dismissed") return `Not for us${o.dismissReason ? `: ${DISMISS_LABEL[o.dismissReason].toLowerCase()}` : ""}${since ? `,${since}` : ""}`;
  return `${STATUS_LABEL[o.status]}${since}`;
}

/** Who did it, as the history says it: a member's address, or the night's own checks. */
const who = (by: string | undefined) => (!by ? "" : by === "system" ? " by the nightly check" : ` by ${by}`);

/** The history's lines, newest first. */
export function historyLines(h: readonly HistoryEntry[]): { at: string; text: string }[] {
  return [...h].reverse().map((e) => {
    if (e.kind === "status" && e.status) return { at: e.at, text: `${STATUS_LABEL[e.status]}${who(e.by)}.` };
    const text = (e.text ?? "").trim().replace(/\.$/, "");
    return { at: e.at, text: `${text}${e.kind === "note" || e.kind === "prompt" ? who(e.by) : ""}.` };
  });
}

/**
 * The ask on an opportunity's page (section 2.2): "Suggest this to your
 * account lead" on a placed tier in nomada mode; "Ask your agency about this
 * page" in agency mode, on any tier; none on the tracked tier in nomada mode
 * (its upgrade prompt is U3) and none in `off` mode.
 */
export function askLabel(p: { placed: boolean; mode: "nomada" | "agency" | "off" }): string | null {
  if (p.mode === "off") return null;
  if (p.mode === "agency") return "Ask your agency about this page";
  return p.placed ? "Suggest this to your account lead" : null;
}

export type LivePromptRow = { id: string; text: string; angle: string | null; added_on: Day; placement: boolean };
export type PromptRowState = { id: string; text: string; origin_ref: string | null; added_on: Day; stopped_on: Day | null };

export type PromptState =
  | { kind: "preview"; text: string; cluster: string }
  | { kind: "added"; text: string; cluster: string; slot: number; of: number; undo: boolean }
  | { kind: "duplicate"; text: string }
  | { kind: "full"; text: string; cluster: string; candidates: SwapCandidate[] }
  | { kind: "room"; text: string; cluster: string }
  | { kind: "watching"; text: string | null; room: boolean; cluster: string }
  | { kind: "none"; reason: string };

/** Whether the member chose "Just watch the page" since pursuing. */
export const watching = (h: readonly HistoryEntry[]): boolean => {
  for (let i = h.length - 1; i >= 0; i--) {
    const e = h[i]!;
    if (e.kind === "prompt") return e.text === WATCH_TEXT;
    if (e.kind === "status" && e.status === "pursuing") return false;
  }
  return false;
};
export const WATCH_TEXT = "Chose to watch the page, with no prompt.";

/** The prompt step's state on the page. Null for a link lens, which has none, and a row nobody can pursue. */
export function promptState(p: {
  opp: Pick<Opportunity, "id" | "status" | "lens" | "promptId" | "history">;
  offered: { ok: true; text: string } | { ok: false; reason: string };
  cluster: { id: string; name: string } | null;
  live: readonly LivePromptRow[];
  prompt: PromptRowState | null;
  today: Day;
  candidates: SwapCandidate[];
}): PromptState | null {
  if (p.opp.lens === "link_domain" || p.opp.lens === "link_page" || p.opp.lens === "mention") return null;
  const pursued = p.opp.status === "pursuing" || p.opp.status === "pitched" || p.opp.status === "won";
  const slots = p.live.filter((q) => !q.placement);
  const room = slots.length < PROMPTS_PER_CLUSTER;
  if (!pursued) {
    if (!p.offered.ok || !p.cluster || p.opp.status !== "new") return null;
    return { kind: "preview", text: p.offered.text, cluster: p.cluster.name };
  }
  if (p.prompt && p.opp.promptId === p.prompt.id) {
    if (p.prompt.origin_ref === p.opp.id && p.prompt.stopped_on === null) {
      const at = slots.findIndex((q) => q.id === p.prompt!.id);
      return { kind: "added", text: p.prompt.text, cluster: p.cluster?.name ?? "its cluster", slot: at >= 0 ? at + 1 : slots.length, of: PROMPTS_PER_CLUSTER, undo: p.prompt.added_on > p.today };
    }
    if (p.prompt.origin_ref !== p.opp.id) return { kind: "duplicate", text: p.prompt.text };
  }
  if (!p.offered.ok) return { kind: "none", reason: p.offered.reason };
  if (!p.cluster) return { kind: "none", reason: "its page has no cluster yet" };
  if (watching(p.opp.history)) return { kind: "watching", text: p.offered.text, room, cluster: p.cluster.name };
  if (room) return { kind: "room", text: p.offered.text, cluster: p.cluster.name };
  return { kind: "full", text: p.offered.text, cluster: p.cluster.name, candidates: p.candidates };
}
