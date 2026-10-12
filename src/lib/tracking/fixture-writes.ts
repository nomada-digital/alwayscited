import { keywordForm } from "../scan/dataforseo-request.ts";

import { type KeywordCheck, precheckKeyword, refuseDrafts, signCheck, verifyCheck } from "./add-cluster.ts";
import { fixtureAccount, fixtureClients, fixtureMode, placementAllowance, type Fixture, type FixtureMember } from "./fixture-mode.ts";
import { type Edit, refuseEdits } from "./edit.ts";
import { ANGLES, PROMPTS_PER_CLUSTER, angleFor, freeAngle, refuseCluster, refuseEdit, refuseGrouping, refuseKeyword, refusePrompts } from "./limits.ts";
import { refuseDraftsAt } from "./prompt-text.ts";
import { refuseRekey } from "./rekey.ts";
import { refuseSlotText } from "./slot.ts";
import { type StopKind, refuseRole, refuseStop, refuseUndo, stopDay } from "./stop.ts";
import type { InviteScope } from "./scope.ts";
import { type InviteRole, type TeamOp, planTeam, refuseActor, removeKind } from "./team.ts";

/**
 * R168 (Danny, 2 Oct 2026, danny.md lines 177-179): `TRACKING_FIXTURE_WRITE=1`
 * makes the /app fixture writable, so a journey sees its own change. Writes
 * are held in process memory over the fixture repo.ts serves, and are gone on
 * restart. Nothing reaches a database.
 *
 * Refused in production exactly as TRACKING_FIXTURE is: with
 * `VERCEL_ENV=production` the switch throws, whether or not TRACKING_FIXTURE
 * is also set, and it is on only when the fixture itself is.
 *
 * Each writer here is pure: the fixture in, the fixture after the write out,
 * under the same rules the database writers ask (stop.ts, limits.ts).
 */
export function fixtureWrites(env: Record<string, string | undefined> = process.env): boolean {
  if (env.TRACKING_FIXTURE_WRITE !== "1") return false;
  if (env.VERCEL_ENV === "production") {
    throw new Error("TRACKING_FIXTURE_WRITE=1 is set in production - /app refuses to write to the fixture");
  }
  return fixtureMode(env);
}

export type FixtureWritten = { ok: true; fixture: Fixture } | { ok: false; message: string };

type Day = Fixture["today"];

/** Stop.ts's stop and undoStop, on the fixture. A cluster takes its keyword and live prompts with it, and brings back only those stopped on its day. */
export function fixtureStop(f: Fixture, p: { kind: StopKind; id: string; today: Day; role: string; undo: boolean }): FixtureWritten {
  const role = refuseRole(p.role);
  if (role) return { ok: false, message: role };
  const { clusters, questions, keywords } = f.data;
  const row = p.kind === "prompt" ? questions.find((q) => q.id === p.id) : clusters.find((c) => c.id === p.id);
  if (!p.undo) {
    const refused = refuseStop(row ?? null);
    if (refused) return { ok: false, message: refused };
    const day = stopDay(p.today);
    const live = <T extends { stopped_on: Day | null }>(r: T, hit: boolean): T => (hit && r.stopped_on === null ? { ...r, stopped_on: day } : r);
    if (p.kind === "prompt") return written(f, { questions: questions.map((q) => live(q, q.id === p.id)) });
    const keywordId = (row as (typeof clusters)[number]).keyword_id;
    return written(f, {
      clusters: clusters.map((c) => live(c, c.id === p.id)),
      questions: questions.map((q) => live(q, q.cluster_id === p.id)),
      keywords: keywords.map((k) => live(k, k.id === keywordId)),
    });
  }
  const refused = refuseUndo(row ?? null, p.today) ?? refuseRoom(f, p.kind, row!);
  if (refused) return { ok: false, message: refused };
  const day = row!.stopped_on;
  const back = <T extends { stopped_on: Day | null }>(r: T, hit: boolean): T => (hit && r.stopped_on === day ? { ...r, stopped_on: null } : r);
  if (p.kind === "prompt") return written(f, { questions: questions.map((q) => back(q, q.id === p.id)) });
  const keywordId = (row as (typeof clusters)[number]).keyword_id;
  return written(f, {
    clusters: clusters.map((c) => back(c, c.id === p.id)),
    questions: questions.map((q) => back(q, q.cluster_id === p.id)),
    keywords: keywords.map((k) => back(k, k.id === keywordId)),
  });
}

/** stop.ts's refuseRoom, counted on the fixture: an undo takes a slot back only while one is free. */
function refuseRoom(f: Fixture, kind: StopKind, row: { stopped_on: Day | null; cluster_id?: string | null }): string | null {
  const { clusters, questions } = f.data;
  const clusterLimit = f.client.cluster_limit;
  if (kind === "cluster") return refuseCluster(clusters.filter((c) => c.stopped_on === null).length, clusterLimit);
  const clusterId = row.cluster_id ?? null;
  if (clusterId && clusters.find((c) => c.id === clusterId)?.stopped_on != null) return "Its cluster is stopped. Undo the cluster instead.";
  // 13 Oct 2026, DIY P2: a placement prompt is not in an angle slot, as limits.ts counts.
  const live = questions.filter((q) => q.stopped_on === null && !placementAllowance(q));
  return refusePrompts({ clientLive: live.length, clusterLive: clusterId ? live.filter((q) => q.cluster_id === clusterId).length : null, clusterLimit });
}

/** slot.ts's fillSlot on the fixture: a new row in the cluster at the stopped prompt's angle, first read tomorrow. */
export function fixtureFillSlot(f: Fixture, p: { clusterId: string; angle: string | null; text: string; today: Day; role: string }): FixtureWritten & { id?: string } {
  const r = fixtureFillSlots(f, { clusterId: p.clusterId, slots: [{ text: p.text, angle: p.angle }], today: p.today, role: p.role });
  return r.ok ? { ok: true, fixture: r.fixture, id: r.ids?.[0] } : r;
}

/** slot.ts's fillSlots on the fixture: each text against the live prompts and the ones before it, then the room for all of them. */
export function fixtureFillSlots(f: Fixture, p: { clusterId: string; slots: readonly { text: string; angle: string | null }[]; today: Day; role: string }): (FixtureWritten & { ids?: string[] }) | { ok: false; message: string; at?: number } {
  const role = refuseRole(p.role);
  if (role) return { ok: false, message: role };
  const { clusters, questions } = f.data;
  const c = clusters.find((x) => x.id === p.clusterId);
  if (!c) return { ok: false, message: "That cluster is not on this client." };
  if (c.stopped_on !== null) return { ok: false, message: "That cluster is stopped." };
  const live = questions.filter((q) => q.stopped_on === null);
  const mine = live.filter((q) => q.cluster_id === p.clusterId);
  for (let i = 0; i < p.slots.length; i++) {
    const refused = refuseSlotText(p.slots[i]!.text, [...mine.map((q) => q.text), ...p.slots.slice(0, i).map((s) => s.text)]);
    if (refused) return { ok: false, message: refused, at: i };
  }
  // 13 Oct 2026, DIY P2: the text is checked against every live prompt in the cluster (the database's index is), the room against the angle slots only (limits.ts).
  const slots = (rows: typeof live) => rows.filter((q) => !placementAllowance(q)).length;
  const room = refusePrompts({ clientLive: slots(live), clusterLive: slots(mine), clusterLimit: f.client.cluster_limit }, p.slots.length);
  if (room) return { ok: false, message: room };
  const taken = questions.map((q) => q.id);
  const rows = p.slots.map((s) => {
    const id = newIdOf(taken);
    taken.push(id);
    return { id, text: s.text.trim(), added_on: stopDay(p.today), stopped_on: null, cluster_id: p.clusterId, angle: angleFor(s.angle) };
  });
  return { ...written(f, { questions: [...questions, ...rows] }), ids: rows.map((r) => r.id) };
}

/**
 * new-cluster.ts's fillDrafts on the fixture (ON-1, 9 Oct 2026): the drafts' rule first, then the five through the
 * free slot's write, one per angle. Held in memory and written in one step, so there is no read-then-insert race
 * for the database's unique index (20261009040000) to stop; refuseSlotText's key is at least as strict as it.
 */
export function fixtureFillDrafts(f: Fixture, p: { clusterId: string; prompts: string[]; today: Day; role: string }): (FixtureWritten & { ids?: string[] }) | { ok: false; message: string; at?: number } {
  const role = refuseRole(p.role);
  if (role) return { ok: false, message: role };
  const r = refuseDraftsAt(p.prompts, PROMPTS_PER_CLUSTER);
  if (r) return { ok: false, message: r.message, ...(r.at === null ? {} : { at: r.at }) };
  return fixtureFillSlots(f, { clusterId: p.clusterId, slots: p.prompts.map((text, i) => ({ text, angle: ANGLES[i]! })), today: p.today, role: p.role });
}

/** edit.ts's editPrompts on the fixture: a pending cluster's prompts rewritten in place, each only while it has no reading. */
export function fixtureEditPrompts(f: Fixture, p: { clusterId: string; edits: readonly Edit[]; role: string }): FixtureWritten {
  const role = refuseRole(p.role);
  if (role) return { ok: false, message: role };
  const { clusters, questions, answers } = f.data;
  const c = clusters.find((x) => x.id === p.clusterId);
  if (!c) return { ok: false, message: "That cluster is not on this client." };
  if (c.stopped_on !== null) return { ok: false, message: "That cluster is stopped." };
  const live = questions.filter((q) => q.cluster_id === p.clusterId && q.stopped_on === null);
  const verdict = refuseEdits(p.edits, new Map(live.map((q) => [q.id, q.text])));
  if (typeof verdict === "string") return { ok: false, message: verdict };
  for (const e of verdict.changed) {
    const fixed = refuseEdit(answers.filter((a) => a.question_id === e.id).length);
    if (fixed) return { ok: false, message: fixed };
  }
  const text = new Map(verdict.changed.map((e) => [e.id, e.text]));
  return written(f, { questions: questions.map((q) => (text.has(q.id) ? { ...q, text: text.get(q.id)! } : q)) });
}

/**
 * The member route's invite, changeRole and removeMember on fixture.members,
 * on the client whose Settings posted (`slug`), under the route's own rules:
 * team.ts planTeam, called as the route calls it, with the account's whole
 * live team (AG-1, 9 Oct 2026). An invite revives a removed row with the new
 * role and this client only, or every client, as invite's pending path does;
 * someone live for other clients only gets this client added. A removal
 * leaves the member's list as it is, as removeMember leaves the scope rows.
 * No mail: sendInvite is never reached on the fixture. The daily invite cap
 * is not counted here - the fixture keeps no event rows.
 */
export function fixtureTeam(f: Fixture, p: { op: TeamOp; email: string; role: InviteRole | null; scope: InviteScope | null; slug: string; now: string }): FixtureWritten {
  const actor = refuseActor(f.member.role);
  if (actor) return { ok: false, message: actor };
  const client = fixtureClients(f, f.member.email).find((c) => c.slug === p.slug);
  if (!client) return { ok: false, message: "Not found." };
  const all = f.members.filter((m) => !m.removed_at).map((m) => ({ email: m.email, role: m.role, removed_at: null, clients: m.clients ?? null }));
  const plan = planTeam({
    form: { op: p.op, email: p.email, role: p.role, scope: p.op === "invite" ? p.scope : null },
    actor: f.member.email,
    rows: all,
    scoping: f.scoping !== false,
    clientId: client.id,
    clientIds: fixtureAccount(f).map((c) => c.id),
    invitesToday: 0,
  });
  if (typeof plan === "string") return { ok: false, message: plan };
  // A member with no `clients` sees every client; the key is left off rather than set to undefined.
  const scoped = (m: FixtureMember, clients: string[] | null): FixtureMember => {
    const out = { ...m };
    delete out.clients;
    return clients ? { ...out, clients } : out;
  };
  if (plan.op === "invite") {
    // Live for other clients: this one joins their list. New or removed: this client only, or every client.
    const after = (m: FixtureMember | null): string[] | null => (plan.scope === "account" ? null : plan.elsewhere && m?.clients ? [...m.clients, client.id] : [client.id]);
    const had = f.members.some((m) => m.email === p.email);
    const members = had
      ? f.members.map((m) => (m.email === p.email ? scoped({ ...m, role: plan.role, removed_at: null }, after(m)) : m))
      : [...f.members, scoped({ email: p.email, name: null, role: plan.role, last_login_at: null, removed_at: null }, after(null))];
    return { ok: true, fixture: { ...f, members } };
  }
  const kind = removeKind(plan.row);
  const hit = (m: Fixture["members"][number]) => m.email === p.email && !m.removed_at;
  const members = f.members.map((m) =>
    !hit(m)
      ? m
      : plan.op === "role"
        ? { ...m, role: plan.role }
        : kind === "client"
          ? scoped(m, (m.clients ?? []).filter((id) => id !== client.id))
          : { ...m, removed_at: p.now },
  );
  return { ok: true, fixture: { ...f, members } };
}

/**
 * Check keyword on the fixture: the free prechecks for real (tracked, own
 * brand, informational, too broad), then a canned pass in place of the two
 * paid reads - 1,000 searches a month, commercial. Signed with a key used only
 * here; fixtureWrites() throws in production, so neither the key nor a canned
 * pass can reach a real client.
 */
export const FIXTURE_CHECK_VOLUME = 1000;
const FIXTURE_CHECK_KEY = "fixture-only-check-key";

export function fixtureCheck(f: Fixture, raw: string, keep: (k: string) => boolean = () => true): { check: KeywordCheck; sig?: string } {
  const tracked = f.data.keywords.filter((k) => k.stopped_on === null).map((k) => k.keyword).filter(keep);
  const pre = precheckKeyword(raw, { tracked, brands: [f.client.brand ?? "", f.client.domain] });
  if (!pre.ok) return { check: pre };
  const check: KeywordCheck = { ok: true, keyword: pre.keyword, volume: FIXTURE_CHECK_VOLUME, intent: "commercial", message: "" };
  return { check, sig: signCheck({ clientId: f.client.id, keyword: pre.keyword, volume: FIXTURE_CHECK_VOLUME, intent: "commercial", day: f.today }, FIXTURE_CHECK_KEY) };
}

/** new-cluster.ts's addCluster on the fixture: a verified check, five prompts in ANGLES order, its keyword, all from tomorrow. */
export function fixtureAddCluster(
  f: Fixture,
  p: { keyword: string; volume: number; intent: string; sig: string | null; prompts: string[]; role: string },
): FixtureWritten & { id?: string } {
  if (!verifyCheck({ clientId: f.client.id, keyword: p.keyword, volume: p.volume, intent: p.intent, day: f.today }, p.sig, FIXTURE_CHECK_KEY)) {
    return { ok: false, message: "The keyword check did not verify." };
  }
  const r = refuseRole(p.role) ?? refuseDrafts(p.prompts);
  if (r) return { ok: false, message: r };
  const { clusters, questions, keywords } = f.data;
  const keyword = keywordForm(p.keyword);
  const liveKw = keywords.filter((k) => k.stopped_on === null);
  if (liveKw.some((k) => keywordForm(k.keyword) === keyword)) return { ok: false, message: "You already track this keyword." };
  const limit = f.client.cluster_limit;
  const room =
    refuseCluster(clusters.filter((c) => c.stopped_on === null).length, limit) ??
    refuseKeyword({ clientLive: liveKw.length, clusterHasLive: null, clusterLimit: limit }) ??
    refusePrompts({ clientLive: questions.filter((q) => q.stopped_on === null).length, clusterLive: 0, clusterLimit: limit }, p.prompts.length);
  if (room) return { ok: false, message: room };
  const day = stopDay(f.today);
  const kId = unused(keywords.map((k) => k.id), "fk");
  const cId = unused(clusters.map((c) => c.id), "fc");
  const taken = questions.map((q) => q.id);
  const rows = p.prompts.map((text, i) => {
    const id = unused(taken, "fw");
    taken.push(id);
    return { id, text: text.trim(), added_on: day, stopped_on: null, cluster_id: cId, angle: ANGLES[i]! };
  });
  return {
    ...written(f, {
      keywords: [...keywords, { id: kId, keyword, added_on: day, stopped_on: null, search_volume: p.volume, intent: p.intent }],
      clusters: [...clusters, { id: cId, name: keyword, keyword_id: kId, tier: f.client.tier, started_on: day, stopped_on: null }],
      questions: [...questions, ...rows],
    }),
    id: cId,
  };
}

/** limits.ts's moveIntoCluster on the fixture: one live ungrouped prompt into a live cluster, refuseGrouping's rules, the first free angle if it has none. */
export function fixtureGroup(f: Fixture, p: { clusterId: string; id: string; role: string }): FixtureWritten {
  const role = refuseRole(p.role);
  if (role) return { ok: false, message: role };
  const { clusters, questions } = f.data;
  const c = clusters.find((x) => x.id === p.clusterId);
  if (!c) return { ok: false, message: "That cluster is not on this client." };
  if (c.stopped_on !== null) return { ok: false, message: "That cluster is stopped." };
  const live = questions.filter((q) => q.stopped_on === null);
  // 13 Oct 2026, DIY P2: the cluster's angle slots only, as limits.ts's groupPrompts counts.
  const mine = live.filter((q) => q.cluster_id === p.clusterId && !placementAllowance(q));
  const ungrouped = new Set(live.filter((q) => q.cluster_id === null).map((q) => q.id));
  const refused = refuseGrouping({ ids: [p.id], ungrouped, clusterLive: mine.length });
  if (refused) return { ok: false, message: refused };
  const angle = freeAngle(mine.map((q) => q.angle));
  return written(f, { questions: questions.map((q) => (q.id === p.id ? { ...q, cluster_id: p.clusterId, angle: q.angle ?? angle } : q)) });
}

/** rekey.ts's changeKeyword on the fixture: a verified check, refuseRekey's rules, the keyword changed in place or added, prompts kept. */
export function fixtureRekey(f: Fixture, p: { clusterId: string; keyword: string; volume: number; intent: string; sig: string | null; role: string }): FixtureWritten {
  if (!verifyCheck({ clientId: f.client.id, keyword: p.keyword, volume: p.volume, intent: p.intent, day: f.today }, p.sig, FIXTURE_CHECK_KEY)) {
    return { ok: false, message: "The keyword check did not verify." };
  }
  const { clusters, keywords, serp } = f.data;
  const c = clusters.find((x) => x.id === p.clusterId) ?? null;
  const keyword = keywordForm(p.keyword);
  const own = c?.keyword_id ?? null;
  const live = keywords.filter((k) => k.stopped_on === null);
  const mine = new Set(f.data.questions.filter((q) => q.cluster_id === p.clusterId).map((q) => q.id));
  const refused = refuseRekey({
    role: p.role,
    cluster: c,
    today: f.today,
    readings: own ? serp.filter((s) => s.keyword_id === own).length : 0,
    taken: live.some((k) => k.id !== own && keywordForm(k.keyword) === keyword),
    // ON-1 (9 Oct 2026): a cluster that never had a keyword, and none of whose prompts has a reading, may take its first at any time.
    keywordless: !!c && !own && !f.data.answers.some((a) => mine.has(a.question_id)),
  });
  if (refused) return { ok: false, message: refused };
  const ownLive = !!own && live.some((k) => k.id === own);
  const kId = ownLive ? own! : unused(keywords.map((k) => k.id), "fk");
  return written(f, {
    keywords: ownLive
      ? keywords.map((k) => (k.id === own ? { ...k, keyword, search_volume: p.volume, intent: p.intent } : k))
      : [...keywords, { id: kId, keyword, added_on: c!.started_on > f.today ? c!.started_on : stopDay(f.today), stopped_on: null, search_volume: p.volume, intent: p.intent }],
    clusters: clusters.map((x) => (x.id === p.clusterId ? { ...x, name: keyword, keyword_id: kId } : x)),
  });
}

function unused(ids: readonly string[], prefix: string): string {
  const seen = new Set(ids);
  let n = seen.size + 1;
  while (seen.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** A prompt id the fixture has not used (none of `taken`), in readStopForm's alphabet. */
function newIdOf(taken: readonly string[]): string {
  const ids = new Set(taken);
  let n = ids.size + 1;
  while (ids.has(`fw${n}`)) n++;
  return `fw${n}`;
}

function written(f: Fixture, data: Partial<Fixture["data"]>): FixtureWritten {
  return { ok: true, fixture: { ...f, data: { ...f.data, ...data } } };
}
