/**
 * Self-serve editing on the dashboards host (17 Oct 2026): every change a
 * customer can make to what is tracked, as one typed operation.
 *
 * One function judges an operation (`refuseOp`) and one applies it to the rows
 * (`applyOp`). Both are pure, and both run in three places: the browser, to
 * answer a typo or a full allowance instantly and draw the change before the
 * server has it; the server, which judges again before it writes (write.ts);
 * and a local run's in-memory store (fixture.ts). The browser's answer is never
 * the only guard.
 *
 * Removing is stopping, as everywhere on this product: a prompt, keyword,
 * group or cluster removed today carries `stopped_on` tomorrow, the day of the
 * first check that skips it, and nothing is deleted. Until then it can be put
 * back, which is what Undo does.
 *
 * Allowances are the plan's, client-wide (allowance.ts): a cluster's keywords
 * and prompts are drawn from the client's pool, so a cluster can be split into
 * groups each with its own keyword and prompts.
 */

import { PROMPT_LENGTH, PROMPT_MAX, PROMPT_MIN, PROMPT_TRACKED, promptKey } from "../tracking/prompt-text.ts";
import { refuseRole, stopDay } from "../tracking/stop.ts";

import { allowances, type PlanShape } from "./allowance.ts";
import { MANAGED_TIERS, type Raw, type RawGroup, type RawKeyword, type RawPrompt } from "./types.ts";

export const KEYWORD_MIN = 2;
export const KEYWORD_MAX = 120;
export const NAME_MAX = 80;
export const TERMS_MAX = 20;
export const TERM_MAX = 60;
export const NOTE_MAX = 200;

export type Op =
  | { op: "cluster.add"; tempId: string; name: string; keyword: string | null }
  | { op: "cluster.rename"; id: string; name: string }
  | { op: "cluster.remove"; id: string }
  | { op: "cluster.restore"; id: string }
  | { op: "group.add"; tempId: string; clusterId: string; name: string; terms: string[] }
  | { op: "group.edit"; id: string; name?: string; note?: string | null; terms?: string[] }
  | { op: "group.remove"; id: string }
  | { op: "group.restore"; id: string; keywords: string[]; prompts: string[] }
  | { op: "keyword.add"; tempId: string; clusterId: string; groupId: string | null; keyword: string }
  | { op: "keyword.remove"; id: string }
  | { op: "keyword.restore"; id: string }
  | { op: "keyword.move"; id: string; clusterId: string; groupId: string | null }
  | { op: "prompt.add"; tempId: string; clusterId: string; groupId: string | null; text: string }
  | { op: "prompt.edit"; id: string; text: string; tempId: string }
  | { op: "prompt.remove"; id: string }
  | { op: "prompt.restore"; id: string }
  | { op: "prompt.move"; id: string; clusterId: string; groupId: string | null };

export type OpKind = Op["op"];
export const OP_KINDS: readonly OpKind[] = [
  "cluster.add", "cluster.rename", "cluster.remove", "cluster.restore",
  "group.add", "group.edit", "group.remove", "group.restore",
  "keyword.add", "keyword.remove", "keyword.restore", "keyword.move",
  "prompt.add", "prompt.edit", "prompt.remove", "prompt.restore", "prompt.move",
];

// ---------------------------------------------------------------- reading a posted op

const ID = /^[0-9A-Za-z_-]{1,64}$/;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const id = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const idOrNull = (v: unknown): string | null | undefined => (v === null ? null : (id(v) ?? undefined));
const ids = (v: unknown): string[] | null => (Array.isArray(v) && v.length <= 200 && v.every((x) => id(x) !== null) ? (v as string[]) : null);

/** Normalise group terms: lower-case, trimmed, de-duplicated, at most TERMS_MAX of 2-60 characters. */
export function cleanTerms(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of raw) {
    const c = t.toLowerCase().replace(/\s+/g, " ").trim();
    if (c.length >= 2 && c.length <= TERM_MAX && !out.includes(c)) out.push(c);
    if (out.length >= TERMS_MAX) break;
  }
  return out;
}

/** A posted body as an Op, or null. Shape only; refuseOp judges it. */
export function readOp(b: unknown): Op | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  switch (o.op) {
    case "cluster.add": {
      const tempId = id(o.tempId), name = str(o.name, 200), keyword = o.keyword === null || o.keyword === undefined ? null : str(o.keyword, 200);
      return tempId && name !== null && (keyword !== null || o.keyword == null) ? { op: o.op, tempId, name, keyword } : null;
    }
    case "cluster.rename": {
      const i = id(o.id), name = str(o.name, 200);
      return i && name !== null ? { op: o.op, id: i, name } : null;
    }
    case "cluster.remove": case "cluster.restore": case "keyword.remove": case "keyword.restore":
    case "prompt.remove": case "prompt.restore": case "group.remove": {
      const i = id(o.id);
      return i ? ({ op: o.op, id: i } as Op) : null;
    }
    case "group.add": {
      const tempId = id(o.tempId), clusterId = id(o.clusterId), name = str(o.name, 200);
      const terms = Array.isArray(o.terms) ? o.terms.filter((t): t is string => typeof t === "string").slice(0, 50) : [];
      return tempId && clusterId && name !== null ? { op: o.op, tempId, clusterId, name, terms } : null;
    }
    case "group.edit": {
      const i = id(o.id);
      if (!i) return null;
      const out: Op = { op: o.op, id: i };
      if (o.name !== undefined) { const n = str(o.name, 200); if (n === null) return null; out.name = n; }
      if (o.note !== undefined) { const n = o.note === null ? null : str(o.note, 400); if (n === null && o.note !== null) return null; out.note = n; }
      if (o.terms !== undefined) { if (!Array.isArray(o.terms)) return null; out.terms = o.terms.filter((t): t is string => typeof t === "string").slice(0, 50); }
      return out;
    }
    case "group.restore": {
      const i = id(o.id), k = ids(o.keywords ?? []), p = ids(o.prompts ?? []);
      return i && k && p ? { op: o.op, id: i, keywords: k, prompts: p } : null;
    }
    case "keyword.add": {
      const tempId = id(o.tempId), clusterId = id(o.clusterId), groupId = idOrNull(o.groupId ?? null), keyword = str(o.keyword, 200);
      return tempId && clusterId && groupId !== undefined && keyword !== null ? { op: o.op, tempId, clusterId, groupId, keyword } : null;
    }
    case "prompt.add": {
      const tempId = id(o.tempId), clusterId = id(o.clusterId), groupId = idOrNull(o.groupId ?? null), text = str(o.text, 600);
      return tempId && clusterId && groupId !== undefined && text !== null ? { op: o.op, tempId, clusterId, groupId, text } : null;
    }
    case "keyword.move": case "prompt.move": {
      const i = id(o.id), clusterId = id(o.clusterId), groupId = idOrNull(o.groupId ?? null);
      return i && clusterId && groupId !== undefined ? ({ op: o.op, id: i, clusterId, groupId } as Op) : null;
    }
    case "prompt.edit": {
      const i = id(o.id), text = str(o.text, 600), tempId = id(o.tempId);
      return i && text !== null && tempId ? { op: o.op, id: i, text, tempId } : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- judging

const live = <T extends { stopped_on: string | null }>(r: T) => r.stopped_on === null;
export const keywordKey = (k: string) => k.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function refuseName(name: string, what: string): string | null {
  const n = name.trim();
  if (n.length < 1) return `Give the ${what} a name.`;
  if (n.length > NAME_MAX) return `A ${what} name is at most ${NAME_MAX} characters.`;
  return null;
}

export function refuseKeywordText(raw: string, liveKeywords: readonly string[]): string | null {
  const k = raw.replace(/\s+/g, " ").trim();
  if (k.length < KEYWORD_MIN || k.length > KEYWORD_MAX) return `A keyword is ${KEYWORD_MIN} to ${KEYWORD_MAX} characters.`;
  if (/[<>{}]/.test(k)) return "A keyword is plain words.";
  const key = keywordKey(k);
  if (liveKeywords.some((l) => keywordKey(l) === key)) return "You already track that keyword.";
  return null;
}

export function refusePromptText(raw: string, liveInCluster: readonly string[]): string | null {
  const t = raw.trim();
  if (t.length < PROMPT_MIN || t.length > PROMPT_MAX) return PROMPT_LENGTH;
  const key = promptKey(t);
  if (liveInCluster.some((l) => promptKey(l) === key)) return PROMPT_TRACKED;
  return null;
}

/**
 * Managed clusters (17 Oct 2026): the clusters we work on each month on a paid
 * plan. Their keyword is what the month's placements are built around, so it
 * is not renamed, removed or swapped self-serve - the client asks, and the
 * swap takes effect at the next billing date, once the month's work is done.
 * Groups, keywords and prompts inside a managed cluster stay free to edit.
 */
export const MANAGED_SWAP = "We work on this cluster each month, so its keyword changes on request, from your next billing date. Ask us from the plan tab. You can still edit its groups, keywords and prompts.";

export function isManaged(raw: Pick<Raw, "client" | "clusters">, clusterId: string | null): boolean {
  if (!clusterId || raw.client.tier === "tracked") return false;
  const c = raw.clusters.find((x) => x.id === clusterId);
  return !!c && (MANAGED_TIERS as readonly string[]).includes(c.tier);
}

/** The reason an op is refused on these rows, or null when it may go ahead. */
export function refuseOp(raw: Raw, op: Op, plan: PlanShape): string | null {
  const role = refuseRole(raw.client.status === "ended" ? "viewer" : raw.role);
  if (role) return role;
  const a = allowances(raw, plan);
  const cluster = (cid: string) => raw.clusters.find((c) => c.id === cid && live(c)) ?? null;
  const group = (gid: string) => raw.groups.find((g) => g.id === gid) ?? null;
  const groupIn = (gid: string | null, cid: string): string | null => {
    if (gid === null) return null;
    if (!raw.groupsReady) return "Groups are not switched on yet.";
    const g = group(gid);
    if (!g || !live(g)) return "That group has been removed.";
    return g.cluster_id === cid ? null : "That group is in another cluster.";
  };
  const liveKeywords = () => raw.keywords.filter(live).map((k) => k.keyword);
  const livePrompts = (cid: string, except?: string) => raw.prompts.filter((p) => live(p) && p.cluster_id === cid && p.id !== except).map((p) => p.text);
  const stopped = (r: { stopped_on: string | null } | undefined): string | null => {
    if (!r) return "That is not on this dashboard.";
    if (r.stopped_on === null) return "That is already tracked.";
    return r.stopped_on <= raw.today ? "That was removed before today. Add it again as a new one." : null;
  };

  switch (op.op) {
    case "cluster.add": {
      if (a.clusters.used >= a.clusters.limit) return `Every cluster on your plan is in use (${a.clusters.limit}).`;
      const n = refuseName(op.name, "cluster");
      if (n) return n;
      if (raw.clusters.some((c) => live(c) && keywordKey(c.name) === keywordKey(op.name))) return "You already have a cluster with that name.";
      if (op.keyword !== null && op.keyword.trim()) {
        if (a.keywords.used >= a.keywords.limit) return `Every keyword on your plan is in use (${a.keywords.limit}).`;
        return refuseKeywordText(op.keyword, liveKeywords());
      }
      return null;
    }
    case "cluster.rename": {
      if (!cluster(op.id)) return "That cluster has been removed.";
      if (isManaged(raw, op.id)) return MANAGED_SWAP;
      return refuseName(op.name, "cluster");
    }
    case "cluster.remove":
      if (cluster(op.id) && isManaged(raw, op.id)) return MANAGED_SWAP;
      return cluster(op.id) ? null : "That cluster has already been removed.";
    case "cluster.restore": {
      const c = raw.clusters.find((x) => x.id === op.id);
      const s = stopped(c);
      if (s) return s;
      if (a.clusters.used >= a.clusters.limit) return `Every cluster on your plan is in use (${a.clusters.limit}).`;
      const comes = raw.prompts.filter((p) => p.cluster_id === op.id && p.stopped_on === c!.stopped_on).length;
      if (a.prompts.used + comes > a.prompts.limit) return `Putting it back would pass your plan's ${a.prompts.limit} prompts.`;
      const kws = raw.keywords.filter((k) => k.cluster_id === op.id && k.stopped_on === c!.stopped_on).length;
      if (a.keywords.used + kws > a.keywords.limit) return `Putting it back would pass your plan's ${a.keywords.limit} keywords.`;
      return null;
    }
    case "group.add": {
      if (!raw.groupsReady) return "Groups are not switched on yet.";
      if (!cluster(op.clusterId)) return "That cluster has been removed.";
      const n = refuseName(op.name, "group");
      if (n) return n;
      if (raw.groups.some((g) => live(g) && g.cluster_id === op.clusterId && keywordKey(g.name) === keywordKey(op.name))) return "That cluster already has a group with that name.";
      return null;
    }
    case "group.edit": {
      const g = group(op.id);
      if (!g || !live(g)) return "That group has been removed.";
      if (op.name !== undefined) {
        const n = refuseName(op.name, "group");
        if (n) return n;
        if (raw.groups.some((o) => o.id !== g.id && live(o) && o.cluster_id === g.cluster_id && keywordKey(o.name) === keywordKey(op.name!))) return "That cluster already has a group with that name.";
      }
      if (op.note && op.note.length > NOTE_MAX) return `A note is at most ${NOTE_MAX} characters.`;
      return null;
    }
    case "group.remove": {
      const g = group(op.id);
      return g && live(g) ? null : "That group has already been removed.";
    }
    case "group.restore": {
      const g = group(op.id);
      if (!g) return "That is not on this dashboard.";
      if (g.stopped_on === null) return "That group is already there.";
      if (g.stopped_on <= raw.today) return "That was removed before today. Add it again as a new one.";
      return cluster(g.cluster_id) ? null : "Its cluster has been removed.";
    }
    case "keyword.add": {
      if (!cluster(op.clusterId)) return "That cluster has been removed.";
      const g = groupIn(op.groupId, op.clusterId);
      if (g) return g;
      if (a.keywords.used >= a.keywords.limit) return `Every keyword on your plan is in use (${a.keywords.limit}).`;
      return refuseKeywordText(op.keyword, liveKeywords());
    }
    case "keyword.remove": {
      const k = raw.keywords.find((x) => x.id === op.id);
      if (k && live(k) && raw.clusters.some((c) => c.keyword_id === k.id && isManaged(raw, c.id))) return MANAGED_SWAP;
      return k && live(k) ? null : "That keyword has already been removed.";
    }
    case "keyword.restore": {
      const k = raw.keywords.find((x) => x.id === op.id);
      const s = stopped(k);
      if (s) return s;
      if (a.keywords.used >= a.keywords.limit) return `Every keyword on your plan is in use (${a.keywords.limit}).`;
      if (raw.keywords.some((o) => live(o) && keywordKey(o.keyword) === keywordKey(k!.keyword))) return "You already track that keyword.";
      return null;
    }
    case "keyword.move": {
      const k = raw.keywords.find((x) => x.id === op.id);
      if (!k || !live(k)) return "That keyword has been removed.";
      if (!cluster(op.clusterId)) return "That cluster has been removed.";
      if (op.clusterId !== k.cluster_id && raw.clusters.some((c) => c.keyword_id === k.id && isManaged(raw, c.id))) return MANAGED_SWAP;
      if (!raw.groupsReady && (op.groupId !== null || op.clusterId !== k.cluster_id)) return "Moving keywords is not switched on yet.";
      return groupIn(op.groupId, op.clusterId);
    }
    case "prompt.add": {
      if (!cluster(op.clusterId)) return "That cluster has been removed.";
      const g = groupIn(op.groupId, op.clusterId);
      if (g) return g;
      if (a.prompts.used >= a.prompts.limit) return `Every prompt on your plan is in use (${a.prompts.limit}).`;
      return refusePromptText(op.text, livePrompts(op.clusterId));
    }
    case "prompt.edit": {
      const p = raw.prompts.find((x) => x.id === op.id);
      if (!p || !live(p)) return "That prompt has been removed.";
      if (p.text.trim() === op.text.trim()) return null;
      return refusePromptText(op.text, p.cluster_id ? livePrompts(p.cluster_id, p.id) : []);
    }
    case "prompt.remove": {
      const p = raw.prompts.find((x) => x.id === op.id);
      return p && live(p) ? null : "That prompt has already been removed.";
    }
    case "prompt.restore": {
      const p = raw.prompts.find((x) => x.id === op.id);
      const s = stopped(p);
      if (s) return s;
      if (p!.cluster_id && !cluster(p!.cluster_id)) return "Its cluster has been removed. Put the cluster back instead.";
      if (a.prompts.used >= a.prompts.limit) return `Every prompt on your plan is in use (${a.prompts.limit}).`;
      return p!.cluster_id ? refusePromptText(p!.text, livePrompts(p!.cluster_id)) : null;
    }
    case "prompt.move": {
      const p = raw.prompts.find((x) => x.id === op.id);
      if (!p || !live(p)) return "That prompt has been removed.";
      if (!cluster(op.clusterId)) return "That cluster has been removed.";
      const g = groupIn(op.groupId, op.clusterId);
      if (g) return g;
      if (op.clusterId !== p.cluster_id) return refusePromptText(p.text, livePrompts(op.clusterId));
      return null;
    }
  }
}

// ---------------------------------------------------------------- applying

/** Whether an edit to this prompt starts a new one: its text is fixed once it has a reading (limits.ts refuseEdit). */
export function editReplaces(raw: Raw, promptId: string): boolean {
  return raw.answers.some((x) => x.question_id === promptId);
}

/**
 * The rows after an op. `newId` turns an op's tempId into the row's id: the
 * browser keeps the tempId until the server's answer, the server and the
 * fixture pass the id they wrote.
 */
export function applyOp(raw: Raw, op: Op, ctx: { by: string; newId?: (tempId: string) => string }): Raw {
  const next: Raw = { ...raw, clusters: [...raw.clusters], groups: [...raw.groups], keywords: [...raw.keywords], prompts: [...raw.prompts] };
  const day = stopDay(raw.today);
  const nid = (t: string) => (ctx.newId ? ctx.newId(t) : t);
  const set = <T extends { id: string }>(rows: T[], rid: string, patch: Partial<T>) => {
    const i = rows.findIndex((r) => r.id === rid);
    if (i >= 0) rows[i] = { ...rows[i]!, ...patch };
  };
  const newKeyword = (tempId: string, keyword: string, clusterId: string, groupId: string | null): RawKeyword => ({
    id: nid(tempId), keyword: keyword.replace(/\s+/g, " ").trim(), search_volume: null, intent: null, added_on: day, stopped_on: null, cluster_id: clusterId, group_id: groupId,
  });
  const newPrompt = (tempId: string, text: string, clusterId: string | null, groupId: string | null, angle: string | null = null): RawPrompt => ({
    id: nid(tempId), text: text.trim(), cluster_id: clusterId, group_id: groupId, angle, added_on: day, stopped_on: null, origin_kind: "client",
  });

  switch (op.op) {
    case "cluster.add": {
      const cid = nid(op.tempId);
      const kw = op.keyword && op.keyword.trim() ? newKeyword(`${op.tempId}-k`, op.keyword, cid, null) : null;
      next.clusters.push({ id: cid, name: op.name.trim(), keyword_id: kw?.id ?? null, tier: raw.client.tier, started_on: day, stopped_on: null });
      if (kw) next.keywords.push(kw);
      break;
    }
    case "cluster.rename":
      set(next.clusters, op.id, { name: op.name.trim() });
      break;
    case "cluster.remove":
      set(next.clusters, op.id, { stopped_on: day });
      for (const r of next.prompts) if (r.cluster_id === op.id && r.stopped_on === null) set(next.prompts, r.id, { stopped_on: day });
      for (const r of next.keywords) if (r.cluster_id === op.id && r.stopped_on === null) set(next.keywords, r.id, { stopped_on: day });
      for (const r of next.groups) if (r.cluster_id === op.id && r.stopped_on === null) set(next.groups, r.id, { stopped_on: day });
      break;
    case "cluster.restore": {
      const c = raw.clusters.find((x) => x.id === op.id);
      const was = c?.stopped_on ?? null;
      set(next.clusters, op.id, { stopped_on: null });
      for (const r of next.prompts) if (r.cluster_id === op.id && r.stopped_on === was) set(next.prompts, r.id, { stopped_on: null });
      for (const r of next.keywords) if (r.cluster_id === op.id && r.stopped_on === was) set(next.keywords, r.id, { stopped_on: null });
      for (const r of next.groups) if (r.cluster_id === op.id && r.stopped_on === was) set(next.groups, r.id, { stopped_on: null });
      break;
    }
    case "group.add": {
      const pos = Math.max(0, ...raw.groups.filter((g) => g.cluster_id === op.clusterId).map((g) => g.position + 1));
      next.groups.push({ id: nid(op.tempId), cluster_id: op.clusterId, name: op.name.trim(), note: null, terms: cleanTerms(op.terms), position: pos, stopped_on: null });
      break;
    }
    case "group.edit": {
      const patch: Partial<RawGroup> = {};
      if (op.name !== undefined) patch.name = op.name.trim();
      if (op.note !== undefined) patch.note = op.note && op.note.trim() ? op.note.trim() : null;
      if (op.terms !== undefined) patch.terms = cleanTerms(op.terms);
      set(next.groups, op.id, patch);
      break;
    }
    case "group.remove":
      set(next.groups, op.id, { stopped_on: day });
      // Its keywords and prompts stay tracked: they go back to the cluster's own.
      for (const r of next.keywords) if (r.group_id === op.id) set(next.keywords, r.id, { group_id: null });
      for (const r of next.prompts) if (r.group_id === op.id) set(next.prompts, r.id, { group_id: null });
      break;
    case "group.restore":
      set(next.groups, op.id, { stopped_on: null });
      for (const k of op.keywords) if (next.keywords.some((r) => r.id === k && r.group_id === null)) set(next.keywords, k, { group_id: op.id });
      for (const p of op.prompts) if (next.prompts.some((r) => r.id === p && r.group_id === null)) set(next.prompts, p, { group_id: op.id });
      break;
    case "keyword.add":
      next.keywords.push(newKeyword(op.tempId, op.keyword, op.clusterId, op.groupId));
      break;
    case "keyword.remove":
      set(next.keywords, op.id, { stopped_on: day });
      break;
    case "keyword.restore":
      set(next.keywords, op.id, { stopped_on: null });
      break;
    case "keyword.move":
      set(next.keywords, op.id, { cluster_id: op.clusterId, group_id: op.groupId });
      break;
    case "prompt.add":
      next.prompts.push(newPrompt(op.tempId, op.text, op.clusterId, op.groupId));
      break;
    case "prompt.edit": {
      const p = raw.prompts.find((x) => x.id === op.id);
      if (!p || p.text.trim() === op.text.trim()) break;
      if (editReplaces(raw, op.id)) {
        // A measured prompt's words are fixed: the edit stops it and starts a new one in its place.
        set(next.prompts, op.id, { stopped_on: day });
        next.prompts.push(newPrompt(op.tempId, op.text, p.cluster_id, p.group_id, p.angle));
      } else {
        set(next.prompts, op.id, { text: op.text.trim() });
      }
      break;
    }
    case "prompt.remove":
      set(next.prompts, op.id, { stopped_on: day });
      break;
    case "prompt.restore":
      set(next.prompts, op.id, { stopped_on: null });
      break;
    case "prompt.move":
      set(next.prompts, op.id, { cluster_id: op.clusterId, group_id: op.groupId });
      break;
  }
  return next;
}

/**
 * The op that takes this one back, read off the rows before it was applied -
 * what the Undo in the toast sends. Null for an op with nothing to take back
 * that Undo would offer (an add is taken back by removing the row it made, so
 * its inverse needs the id the server returned and is built by the caller).
 */
export function inverseOp(before: Raw, op: Op): Op | null {
  switch (op.op) {
    case "cluster.rename": {
      const c = before.clusters.find((x) => x.id === op.id);
      return c ? { op: "cluster.rename", id: op.id, name: c.name } : null;
    }
    case "cluster.remove":
      return { op: "cluster.restore", id: op.id };
    case "group.edit": {
      const g = before.groups.find((x) => x.id === op.id);
      if (!g) return null;
      const back: Op = { op: "group.edit", id: op.id };
      if (op.name !== undefined) back.name = g.name;
      if (op.note !== undefined) back.note = g.note;
      if (op.terms !== undefined) back.terms = g.terms;
      return back;
    }
    case "group.remove":
      return {
        op: "group.restore",
        id: op.id,
        keywords: before.keywords.filter((k) => k.group_id === op.id && k.stopped_on === null).map((k) => k.id),
        prompts: before.prompts.filter((p) => p.group_id === op.id && p.stopped_on === null).map((p) => p.id),
      };
    case "keyword.remove":
      return { op: "keyword.restore", id: op.id };
    case "keyword.move": {
      const k = before.keywords.find((x) => x.id === op.id);
      return k && k.cluster_id ? { op: "keyword.move", id: op.id, clusterId: k.cluster_id, groupId: k.group_id } : null;
    }
    case "prompt.remove":
      return { op: "prompt.restore", id: op.id };
    case "prompt.move": {
      const p = before.prompts.find((x) => x.id === op.id);
      return p && p.cluster_id ? { op: "prompt.move", id: op.id, clusterId: p.cluster_id, groupId: p.group_id } : null;
    }
    case "cluster.add":
    case "group.add":
    case "keyword.add":
    case "prompt.add":
    case "prompt.edit":
    case "cluster.restore":
    case "group.restore":
    case "keyword.restore":
    case "prompt.restore":
      return null;
  }
}

/** The removal that takes back an add, once the add's real id is known. */
export function undoAdd(op: Op, idOf: (tempId: string) => string): Op | null {
  switch (op.op) {
    case "cluster.add": return { op: "cluster.remove", id: idOf(op.tempId) };
    case "group.add": return { op: "group.remove", id: idOf(op.tempId) };
    case "keyword.add": return { op: "keyword.remove", id: idOf(op.tempId) };
    case "prompt.add": return { op: "prompt.remove", id: idOf(op.tempId) };
    default: return null;
  }
}
