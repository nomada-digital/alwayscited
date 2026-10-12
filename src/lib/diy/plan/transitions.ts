import { APP_LIMITS } from "../../../config/contact.ts";
import { isPlausibleEmail } from "../../email-address.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { CHANGED, type Changed, PLAN_STATUSES, type PlanItem, type PlanStatus } from "./types.ts";

/**
 * What a member may do to a Plan item, and what each move writes (13 Oct
 * 2026, DIY P3; spec 10 sections 3.6 and 4.6). Pure: the route, the fixture
 * twin and the tests all ask these, so the rule is one rule.
 *
 * The route's `do` values are section 3.6's: accept, start, later, move,
 * drop, add, note, assign. Owners and editors write; viewers read, and an
 * ended client is read-only to everyone (member.ts writeRole, which the
 * route applies before it asks `refusePlanRole`).
 */

export const PLAN_DO = ["accept", "start", "later", "move", "drop", "add", "note", "assign"] as const;
export type PlanDo = (typeof PLAN_DO)[number];

export const isPlanDo = (v: unknown): v is PlanDo => typeof v === "string" && (PLAN_DO as readonly string[]).includes(v);

/** "Not now" hides a suggestion for this many days (section 4.6). */
export const HIDE_DAYS = 14;

/** The words on every control a viewer cannot use (section 2.2). */
export const VIEWER_REASON = "Viewers can't change this. Ask an owner or editor.";
/** The same for an ended client, whose history stays readable. */
export const ENDED_REASON = "Tracking has ended for this client, so its actions are read-only.";

const WRITERS = new Set(["owner", "editor"]);

/** Null when this role may change items; the route passes writeRole(client), so an ended client reads as a viewer. */
export function refusePlanRole(role: string): string | null {
  return WRITERS.has(role) ? null : VIEWER_REASON;
}

/** The statuses a member can move an item to with the select. `suggested` is the system's alone. */
export const MOVE_TO: readonly PlanStatus[] = ["todo", "doing", "done", "dropped"];

/**
 * Why `from` cannot become `to`, or null when it can.
 *
 * - Nothing moves back to Suggested: a suggestion is the system's word.
 * - A suggestion is accepted (To do), started (Doing) or dropped. It is not
 *   marked done before anyone has started it: Start it first.
 * - To do, Doing and Done move among themselves and to Dropped. Done back to
 *   To do or Doing reopens it.
 * - Dropped comes back to To do only.
 */
export function refuseMove(from: PlanStatus, to: PlanStatus): string | null {
  if (from === to) return "It is already there.";
  if (to === "suggested") return "Only new suggestions are Suggested.";
  if (from === "suggested" && to === "done") return "Start it before marking it done.";
  if (from === "dropped" && to !== "todo") return "A dropped item comes back to To do first.";
  return null;
}

/** The moves the card's select offers from `from`, in board order. */
export function movesFrom(from: PlanStatus): PlanStatus[] {
  return MOVE_TO.filter((to) => to !== from && refuseMove(from, to) === null);
}

/** One plan_items update, in column names. */
export type PlanPatch = {
  status?: PlanStatus;
  status_at?: string;
  status_by?: string;
  started_on?: Day | null;
  done_on?: Day | null;
  hidden_until?: Day | null;
  verified?: null;
  readout_base?: { changed?: Changed } | null;
  note?: string | null;
  owner_email?: string | null;
};

/**
 * What moving one item writes. `today` is the dashboard's tracking day,
 * `now` an ISO instant, `by` the member's email.
 *
 * - Entering Doing stamps `started_on` once (the chart's Started marker).
 * - Entering Done stamps `done_on` and keeps the optional answer to "Did you
 *   change the page?" in `readout_base.changed`.
 * - Leaving Done clears `done_on`, the readout's base and any verification:
 *   a reopened item is not done, so nothing may read as verified.
 */
export function movePatch(item: Pick<PlanItem, "status" | "startedOn">, to: PlanStatus, p: { today: Day; now: string; by: string; changed?: Changed | null }): PlanPatch {
  const patch: PlanPatch = { status: to, status_at: p.now, status_by: p.by };
  if (to === "doing" && !item.startedOn) patch.started_on = p.today;
  if (to === "done") {
    patch.done_on = p.today;
    patch.readout_base = p.changed ? { changed: p.changed } : {};
  }
  if (item.status === "done" && to !== "done") {
    patch.done_on = null;
    patch.readout_base = null;
    patch.verified = null;
  }
  return patch;
}

/** "Not now": the suggestion is hidden until `today` + HIDE_DAYS and keeps its status. */
export function hidePatch(p: { today: Day; now: string; by: string }): PlanPatch {
  return { hidden_until: addDays(p.today, HIDE_DAYS), status_at: p.now, status_by: p.by };
}

/** Whether an item is hidden by "Not now" today. */
export function isHidden(item: Pick<PlanItem, "hiddenUntil">, today: Day): boolean {
  return item.hiddenUntil !== null && item.hiddenUntil > today;
}

/** The `do` values that only a suggestion takes. */
export function refuseOnSuggestion(d: PlanDo, status: PlanStatus): string | null {
  if ((d === "accept" || d === "start" || d === "later") && status !== "suggested") return "Only a suggestion can be accepted, started or hidden.";
  return null;
}

/** The status `accept` and `start` move to. */
export const DO_TO: Partial<Record<PlanDo, PlanStatus>> = { accept: "todo", start: "doing", drop: "dropped" };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** An own task's title: 1-200 characters once whitespace is squashed (plan_items.title's own check). */
export function readTitle(raw: unknown): { ok: true; title: string } | { ok: false; why: "title" } {
  if (typeof raw !== "string") return { ok: false, why: "title" };
  const title = squash(raw);
  return title.length >= 1 && title.length <= APP_LIMITS.task ? { ok: true, title } : { ok: false, why: "title" };
}

/** A note: up to 200 characters; an empty one clears the note. */
export function readNoteText(raw: unknown): { ok: true; note: string | null } | { ok: false; why: "note" } {
  if (typeof raw !== "string") return { ok: false, why: "note" };
  const note = squash(raw);
  if (note.length > APP_LIMITS.note) return { ok: false, why: "note" };
  return { ok: true, note: note || null };
}

/**
 * The owner: blank is nobody in particular; otherwise one of this client's
 * live members, matched without case. The shape is checked as every door
 * that takes an address checks it (email-address.ts), before the match.
 */
export function readOwner(raw: unknown, members: readonly { email: string }[]): { ok: true; owner: string | null } | { ok: false; why: "owner" } {
  if (typeof raw !== "string" || raw.length > APP_LIMITS.email) return { ok: false, why: "owner" };
  const want = raw.trim().toLowerCase();
  if (!want) return { ok: true, owner: null };
  if (!isPlausibleEmail(want)) return { ok: false, why: "owner" };
  const m = members.find((x) => x.email.toLowerCase() === want);
  return m ? { ok: true, owner: m.email } : { ok: false, why: "owner" };
}

/** The answer to "Did you change the page?"; anything else is no answer. */
export function readChanged(raw: unknown): Changed | null {
  return typeof raw === "string" && (CHANGED as readonly string[]).includes(raw) ? (raw as Changed) : null;
}

/** A status the select may post. */
export function readTo(raw: unknown): PlanStatus | null {
  return typeof raw === "string" && (PLAN_STATUSES as readonly string[]).includes(raw) ? (raw as PlanStatus) : null;
}

/** An item id as the form posts it: a uuid in production, a short id on the fixture. */
export const ITEM_ID = /^[0-9A-Za-z_-]{1,64}$/;

// ---- The toast after a write: fixed words, nothing echoed from the URL. ----

export const PLAN_DONE = ["accepted", "started", "hidden", "moved", "dropped", "added", "noted", "assigned", "refused"] as const;
export type PlanDone = (typeof PLAN_DONE)[number];

export const PLAN_WHY = ["viewer", "title", "note", "owner", "move", "gone", "cluster", "failed", "readonly"] as const;
export type PlanWhy = (typeof PLAN_WHY)[number];

const DONE_SAID: Record<Exclude<PlanDone, "refused">, string> = {
  accepted: "Added to To do.",
  started: "Moved to Doing.",
  hidden: `Hidden for ${HIDE_DAYS} days. It comes back if it still applies.`,
  moved: "Moved.",
  dropped: "Dropped. It stays under Dropped if you want it back.",
  added: "Task added to To do.",
  noted: "Note saved.",
  assigned: "Owner saved.",
};

const WHY_SAID: Record<PlanWhy, string> = {
  viewer: VIEWER_REASON,
  title: "A task needs a title of 1 to 200 characters.",
  note: "A note can be up to 200 characters.",
  owner: "Pick someone on this team, or nobody.",
  move: "That move isn't one this item can make.",
  gone: "That item has changed or gone. The list below is up to date.",
  cluster: "Pick one of your clusters, or none.",
  failed: "That didn't save. Try again in a moment.",
  readonly: "This preview doesn't save changes.",
};

/** The toast for `?done=&why=`, or null. Only known codes are drawn. */
export function planToast(done: string | null, why: string | null): string | null {
  if (done === "refused") return WHY_SAID[(PLAN_WHY as readonly string[]).includes(why ?? "") ? (why as PlanWhy) : "failed"];
  if (done && done in DONE_SAID) return DONE_SAID[done as keyof typeof DONE_SAID];
  return null;
}

/** What the route read off the form, before any rule. */
export type PlanForm = { do: PlanDo; id: string | null; to: unknown; changed: unknown; note: unknown; owner: unknown; title: unknown; cluster: unknown };

/** What one post does: change one item (only while it still has the status it was read with), add a task, or nothing and why. */
export type Decision =
  | { op: "update"; id: string; patch: PlanPatch; expect: PlanStatus; done: Exclude<PlanDone, "refused"> }
  | { op: "insert"; title: string; clusterId: string | null; done: "added" }
  | { op: "refuse"; why: PlanWhy };

/**
 * The rule for one post, on the item as read (null when there is none on
 * this client). `role` is writeRole(client); `members` are this client's
 * live members; `clusters` its live cluster ids.
 */
export function decide(form: PlanForm, item: Pick<PlanItem, "id" | "status" | "startedOn"> | null, ctx: { role: string; today: Day; now: string; by: string; members: readonly { email: string }[]; clusters: readonly string[] }): Decision {
  if (refusePlanRole(ctx.role)) return { op: "refuse", why: "viewer" };
  const stamp = { today: ctx.today, now: ctx.now, by: ctx.by };
  if (form.do === "add") {
    const t = readTitle(form.title);
    if (!t.ok) return { op: "refuse", why: "title" };
    const cluster = typeof form.cluster === "string" && form.cluster ? form.cluster : null;
    if (cluster !== null && !ctx.clusters.includes(cluster)) return { op: "refuse", why: "cluster" };
    return { op: "insert", title: t.title, clusterId: cluster, done: "added" };
  }
  if (!item) return { op: "refuse", why: "gone" };
  const update = (patch: PlanPatch): Decision => ({ op: "update", id: item.id, patch, expect: item.status, done: DONE_OF[form.do] });
  if (refuseOnSuggestion(form.do, item.status)) return { op: "refuse", why: "move" };
  switch (form.do) {
    case "later":
      return update(hidePatch(stamp));
    case "accept":
    case "start":
    case "drop":
    case "move": {
      const to = form.do === "move" ? readTo(form.to) : DO_TO[form.do]!;
      if (!to || refuseMove(item.status, to)) return { op: "refuse", why: "move" };
      return update(movePatch(item, to, { ...stamp, changed: readChanged(form.changed) }));
    }
    case "note": {
      const n = readNoteText(form.note);
      return n.ok ? update({ note: n.note }) : { op: "refuse", why: "note" };
    }
    case "assign": {
      const o = readOwner(form.owner, ctx.members);
      return o.ok ? update({ owner_email: o.owner }) : { op: "refuse", why: "owner" };
    }
  }
}

/** The done code each `do` answers with. */
export const DONE_OF: Record<PlanDo, Exclude<PlanDone, "refused">> = {
  accept: "accepted",
  start: "started",
  later: "hidden",
  move: "moved",
  drop: "dropped",
  add: "added",
  note: "noted",
  assign: "assigned",
};
