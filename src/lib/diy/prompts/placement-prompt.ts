import type { SupabaseClient } from "@supabase/supabase-js";

import { PAGE } from "../../supabase/page.ts";
import { adminStop } from "../../tracking/admin-edit.ts";
import { addDays, formatDay, type Day } from "../../tracking/figures.ts";
import { fixtureMode, fixturePlacementPromptsOn } from "../../tracking/fixture-mode.ts";
import { PLACEMENT_FULL, PLACEMENT_PROMPTS_PER_CLIENT, insertPrompts, livePromptCount, missingColumn } from "../../tracking/limits.ts";
import { placedTier } from "../../tracking/placement-figures.ts";
import { readPlacement, urlKey } from "../../tracking/placements.ts";
import { PROMPT_TRACKED } from "../../tracking/prompt-text.ts";

import { duplicateOf } from "./dedupe.ts";
import { promptFromTitle, titleOf } from "./title-rule.ts";

/**
 * Prompts from placements (13 Oct 2026, DIY P2; spec 10 sections 5.5, 6.7 and
 * 7.3; Danny's 12 Oct call: "for done-for-you clients, prompts are added
 * automatically from the articles Nomada places").
 *
 * `addPlacementPrompt` is the admin hook: /admin/tracking's logPlacement and
 * updatePlacement call it when a placement goes live, and its Retry posts the
 * same action with prompt=1. It reads `app_settings.placement_prompts_enabled`
 * first. Seeded false, and a missing or unreadable row is off, as lifecycleOn
 * reads its flags: while it is off nothing is fetched or added, and the admin
 * reads "Placement saved. Placement prompts are switched off." It waits on
 * Danny (spec 8.3 Q1) because each prompt adds a read on every engine to a
 * daily run already near its time limit; earlier live placements are not
 * backfilled in bulk, each gets its prompt through its own Retry.
 *
 * When on, for a live placement with a URL, of kind guest_post or coverage
 * (link_insertion only when the admin ticks "Add a prompt from this article's
 * title": an insertion's article is someone else's page), on a placed tier,
 * in a live cluster, with no live placement prompt of its own yet:
 *
 * 1. one own fetch of the article (placements.ts readPlacement: polite user
 *    agent, 8 s, never throws) - costs nothing;
 * 2. the title rule (title-rule.ts);
 * 3. a duplicate of a live prompt in the cluster adds nothing, and the admin
 *    is told which prompt already measures it;
 * 4. `insertPrompts(..., { allowance: "placement" })`, source nomada,
 *    origin_kind placement, origin_ref the placement, added_by nomada, first
 *    asked tomorrow.
 *
 * At PLACEMENT_PROMPTS_PER_CLIENT live, the client's oldest placement prompt
 * is stopped from tomorrow (never deleted) to make room, but only one whose
 * placement has been live 12 weeks or more and whose page was never cited in
 * an answer to the client's prompts; otherwise the insert is refused,
 * "Placement prompt allowance full (10)".
 *
 * `stopPlacementPrompt` stops a placement's prompt when it moves to removed.
 * It needs no switch: it only ever takes reads away.
 */

export const PLACEMENT_SWITCH = "placement_prompts_enabled";
export const SWITCHED_OFF = "Placement prompts are switched off.";
/** The admin's line while the switch is off (spec 6.7), word for word. */
export const SAVED_SWITCHED_OFF = `Placement saved. ${SWITCHED_OFF}`;
/** A placement live this long and never cited may give up its prompt for a new one. */
export const ROTATE_AFTER_DAYS = 12 * 7;
/** The kinds that add a prompt on their own; link_insertion only when ticked. */
export const PROMPT_KINDS = ["guest_post", "coverage"] as const;

type Fetcher = Parameters<typeof readPlacement>[1];

/** Why a kind adds no prompt, as the admin reads it on a Retry. */
const SKIPPED_KIND: Record<string, string> = {
  on_site: "on-site work adds no prompt",
  link_insertion: "a link insertion adds one only with “Add a prompt from this article's title” ticked",
};

/** Whether placement prompts are on: the row holds jsonb true. A failed or missing read is off. */
export async function placementPromptsOn(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", PLACEMENT_SWITCH).maybeSingle();
  if (error) {
    console.warn(`[diy] ${PLACEMENT_SWITCH} not read, treated as off: ${error.message}`);
    return false;
  }
  return (data as { value?: unknown } | null)?.value === true;
}

/**
 * The switch as a page reads it: the fixture's own answer on TRACKING_FIXTURE
 * (on in its placed states), else Supabase through the service-role client.
 * Off whenever it cannot be read.
 */
export async function loadPlacementPromptsOn(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (fixtureMode(env)) return fixturePlacementPromptsOn(env);
  try {
    return await placementPromptsOn((await import("../../supabase/admin.ts")).supabaseAdmin());
  } catch (e) {
    console.warn(`[diy] ${PLACEMENT_SWITCH} not read, treated as off: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * A prompt stopped to make room whose replacement was then not added
 * (13 Oct 2026 review): its stop is taken back, so the client loses no
 * measured prompt, and the admin is told either way.
 */
export type RotationUndone = { text: string; restored: true } | { text: string; restored: false; stoppedOn: Day; why: string };

export type PlacementPromptOutcome =
  | { kind: "off" }
  | { kind: "skipped"; why: string }
  | { kind: "exists"; promptId: string; text: string }
  | { kind: "added"; promptId: string; text: string; addedOn: Day; rotated: { id: string; text: string; stoppedOn: Day } | null }
  | { kind: "duplicate"; text: string; of: string; rotation?: RotationUndone }
  | { kind: "unread"; why: string }
  | { kind: "no_prompt"; why: string }
  | { kind: "full"; rotation?: RotationUndone }
  | { kind: "failed"; message: string; rotation?: RotationUndone };

type PlacementRead = { id: string; cluster_id: string; kind: string; url: string; url_key: string; status: string; live_on: Day | null };

/**
 * Whether the placement's page was ever cited in an answer to this client's
 * prompts since it went live: citesPlacement's rule, the cited URL's url_key
 * against the placement's, and nothing else.
 *
 * 13 Oct 2026 review: this first narrowed the answers by
 * `citations @> [{source_domain: <the url_key's host>}]`. engines.ts stores
 * `source_domain` from an engine's own `domain` field when it gives one, which
 * need not be the URL's host (a subdomain, a parent domain), so a page cited
 * under another source_domain read as never cited and its prompt could be
 * rotated out. Now every answer of the client since the live day is read, a
 * page at a time, and the read stops at the first citation of the page. It
 * runs only at the allowance's cap, for a placement 12 weeks live.
 */
export async function everCited(db: SupabaseClient, clientId: string, p: Pick<PlacementRead, "url_key" | "live_on">): Promise<boolean | string> {
  if (!p.url_key) return false;
  for (let from = 0; ; ) {
    const { data, error } = await db
      .from("tracking_answers")
      .select("id, citations")
      .eq("client_domain_id", clientId)
      .gte("run_date", p.live_on ?? "1970-01-01")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return `Could not read the citations: ${error.message}`;
    const rows = (data ?? []) as { citations: { url?: string | null }[] | null }[];
    if (!rows.length) return false;
    if (rows.some((r) => (Array.isArray(r.citations) ? r.citations : []).some((c) => !!c?.url && urlKey(c.url) === p.url_key))) return true;
    // The next offset is what came back, not PAGE: a server row ceiling under PAGE skips nothing (page.ts).
    from += rows.length;
  }
}

/**
 * The prompt to stop to make room: the oldest live placement prompt whose
 * placement went live ROTATE_AFTER_DAYS or more ago and was never cited. Pure;
 * `cited` answers per placement id.
 */
export function pickRotation(prompts: readonly { id: string; text: string; added_on: Day; origin_ref: string | null }[], placements: ReadonlyMap<string, { live_on: Day | null }>, cited: ReadonlyMap<string, boolean>, today: Day): { id: string; text: string } | null {
  const by = addDays(today, -ROTATE_AFTER_DAYS);
  const pick = [...prompts]
    .sort((a, b) => a.added_on.localeCompare(b.added_on) || a.id.localeCompare(b.id))
    .find((q) => {
      const live = q.origin_ref ? placements.get(q.origin_ref)?.live_on : null;
      return !!live && live <= by && cited.get(q.origin_ref!) === false;
    });
  return pick ? { id: pick.id, text: pick.text } : null;
}

/** Room for one more placement prompt: none needed, a prompt stopped to make it, or full. */
async function makeRoom(db: SupabaseClient, clientId: string, today: Day): Promise<{ rotated: { id: string; text: string; stoppedOn: Day } | null } | "full" | { failed: string }> {
  const live = await livePromptCount(db, "client_domain_id", clientId, "placement");
  if (typeof live === "string") return { failed: live };
  if (live < PLACEMENT_PROMPTS_PER_CLIENT) return { rotated: null };
  const { data: prompts, error } = await db
    .from("tracked_questions")
    .select("id, text, added_on, origin_ref")
    .eq("client_domain_id", clientId)
    .eq("allowance", "placement")
    .is("stopped_on", null)
    .order("added_on", { ascending: true })
    .limit(50);
  if (error) return { failed: `Could not read the placement prompts: ${error.message}` };
  // Oldest first, as pickRotation reads them, so the citations read stop at the prompt it will pick.
  const rows = ((prompts ?? []) as { id: string; text: string; added_on: Day; origin_ref: string | null }[]).sort((a, b) => a.added_on.localeCompare(b.added_on) || a.id.localeCompare(b.id));
  const refs = [...new Set(rows.map((r) => r.origin_ref).filter((r): r is string => !!r))];
  if (!refs.length) return "full";
  const { data: pls, error: pErr } = await db.from("placements").select("id, url_key, live_on").eq("client_domain_id", clientId).in("id", refs);
  if (pErr) return { failed: `Could not read the placements: ${pErr.message}` };
  const placements = new Map(((pls ?? []) as { id: string; url_key: string; live_on: Day | null }[]).map((p) => [p.id, p]));
  const by = addDays(today, -ROTATE_AFTER_DAYS);
  const cited = new Map<string, boolean>();
  for (const r of rows) {
    const p = r.origin_ref ? placements.get(r.origin_ref) : undefined;
    if (!p || !p.live_on || p.live_on > by || cited.has(p.id)) continue;
    const c = await everCited(db, clientId, p);
    if (typeof c === "string") return { failed: c };
    cited.set(p.id, c);
    if (!c) break;
  }
  const pick = pickRotation(rows, placements, cited, today);
  if (!pick) return "full";
  const stopped = await adminStop(db, { kind: "prompt", clientId, id: pick.id, today });
  if (!stopped.ok) return { failed: stopped.message };
  return { rotated: { ...pick, stoppedOn: addDays(today, 1) } };
}

/**
 * Take back a rotation's stop when the prompt it made room for was not added.
 * The stop is from tomorrow, so nothing was missed: the row is live again as
 * if it had never been stopped. Only the stop this hook made is taken back -
 * the same day, by nomada, still pending.
 */
async function undoRotation(db: SupabaseClient, clientId: string, r: { id: string; text: string; stoppedOn: Day }): Promise<RotationUndone> {
  const { data, error } = await db
    .from("tracked_questions")
    .update({ stopped_on: null, stopped_by: null })
    .eq("id", r.id)
    .eq("client_domain_id", clientId)
    .eq("stopped_on", r.stoppedOn)
    .eq("stopped_by", "nomada")
    .select("id");
  if (error) return { text: r.text, restored: false, stoppedOn: r.stoppedOn, why: error.message };
  if (!(data ?? []).length) return { text: r.text, restored: false, stoppedOn: r.stoppedOn, why: "its stop had already changed" };
  return { text: r.text, restored: true };
}

/** The admin hook (see the head of this file). Never throws; the outcome says what happened, and `placementPromptMessage` says it to the admin. */
export async function addPlacementPrompt(db: SupabaseClient, p: { clientId: string; placementId: string; insertion?: boolean; today: Day }, deps: { fetcher: Fetcher }): Promise<PlacementPromptOutcome> {
  try {
    if (!(await placementPromptsOn(db))) return { kind: "off" };

    const { data: row, error } = await db.from("placements").select("id, cluster_id, kind, url, url_key, status, live_on").eq("id", p.placementId).eq("client_domain_id", p.clientId).maybeSingle();
    if (error) return { kind: "failed", message: `Could not read the placement: ${error.message}` };
    const pl = row as PlacementRead | null;
    if (!pl) return { kind: "skipped", why: "no such placement on this client" };
    if (pl.status !== "live" || !pl.url) return { kind: "skipped", why: "not live" };
    if (!(PROMPT_KINDS as readonly string[]).includes(pl.kind) && !(pl.kind === "link_insertion" && p.insertion)) return { kind: "skipped", why: SKIPPED_KIND[pl.kind] ?? `a ${pl.kind.replace(/_/g, " ")} adds no prompt` };

    const { data: client, error: cErr } = await db.from("client_domains").select("tier, market").eq("id", p.clientId).maybeSingle();
    if (cErr) return { kind: "failed", message: `Could not read the client: ${cErr.message}` };
    if (!client || !placedTier(String((client as { tier?: unknown }).tier ?? ""))) return { kind: "skipped", why: "not a placed tier" };
    const market = (client as { market?: string | null }).market ?? null;

    const { data: own, error: oErr } = await db.from("tracked_questions").select("id, text").eq("client_domain_id", p.clientId).eq("origin_kind", "placement").eq("origin_ref", pl.id).is("stopped_on", null).limit(1);
    if (oErr) return { kind: "failed", message: missingColumn(oErr) ? "the prompt_origins migration is not applied" : `Could not read the prompts: ${oErr.message}` };
    const mine = (own ?? []) as { id: string; text: string }[];
    if (mine[0]) return { kind: "exists", promptId: mine[0].id, text: mine[0].text };

    const { data: cluster, error: clErr } = await db.from("tracked_clusters").select("id, stopped_on").eq("id", pl.cluster_id).eq("client_domain_id", p.clientId).maybeSingle();
    if (clErr) return { kind: "failed", message: `Could not read the cluster: ${clErr.message}` };
    if (!cluster || (cluster as { stopped_on: Day | null }).stopped_on !== null) return { kind: "skipped", why: "its cluster is stopped" };

    const read = await readPlacement(pl.url, deps.fetcher);
    if (read.kind === "failed") return { kind: "unread", why: read.reason || "no answer" };
    if (read.status < 200 || read.status >= 300) return { kind: "unread", why: `HTTP ${read.status}` };
    const made = promptFromTitle(titleOf(read.html), market);
    if (!made.ok) return { kind: "no_prompt", why: made.reason };

    const { data: live, error: lErr } = await db.from("tracked_questions").select("id, text").eq("client_domain_id", p.clientId).eq("cluster_id", pl.cluster_id).is("stopped_on", null);
    if (lErr) return { kind: "failed", message: `Could not read the cluster's prompts: ${lErr.message}` };
    const twin = duplicateOf(made.text, (live ?? []) as { id: string; text: string }[]);
    if (twin) return { kind: "duplicate", text: made.text, of: twin.text };

    const room = await makeRoom(db, p.clientId, p.today);
    if (room === "full") return { kind: "full" };
    if ("failed" in room) return { kind: "failed", message: room.failed };

    const addedOn = addDays(p.today, 1);
    // The rotation has to come first: the insert counts the allowance, and the rotated prompt is out of it from its stop.
    // So an insert that then fails takes the rotation back (13 Oct 2026 review) - never a stopped prompt and no new one.
    const w = await insertPrompts(db, p.clientId, pl.cluster_id, [{ text: made.text, source: "nomada", added_on: addedOn, added_by: "nomada", origin_kind: "placement", origin_ref: pl.id }], { allowance: "placement" });
    if (!w.ok) {
      const rotation = room.rotated ? { rotation: await undoRotation(db, p.clientId, room.rotated) } : {};
      if (w.message === PLACEMENT_FULL) return { kind: "full", ...rotation };
      if (w.message === PROMPT_TRACKED) return { kind: "duplicate", text: made.text, of: made.text, ...rotation };
      return { kind: "failed", message: w.message, ...rotation };
    }
    return { kind: "added", promptId: w.ids[0]!, text: made.text, addedOn, rotated: room.rotated };
  } catch (e) {
    return { kind: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Stop a placement's live prompt from tomorrow, when the placement moves to removed. Never deletes. */
export async function stopPlacementPrompt(db: SupabaseClient, p: { clientId: string; placementId: string; today: Day }): Promise<{ ok: true; stopped: { id: string; text: string }[] } | { ok: false; message: string }> {
  const { data, error } = await db.from("tracked_questions").select("id, text").eq("client_domain_id", p.clientId).eq("origin_kind", "placement").eq("origin_ref", p.placementId).is("stopped_on", null);
  if (missingColumn(error)) return { ok: true, stopped: [] };
  if (error) return { ok: false, message: `Could not read its prompt: ${error.message}` };
  const stopped: { id: string; text: string }[] = [];
  for (const q of (data ?? []) as { id: string; text: string }[]) {
    const s = await adminStop(db, { kind: "prompt", clientId: p.clientId, id: q.id, today: p.today });
    if (!s.ok) return { ok: false, message: s.message };
    stopped.push(q);
  }
  return { ok: true, stopped };
}

/**
 * What the admin reads after a save (spec 6.7's lines, word for word where it
 * gives them). `saved` is the action's own line, kept where nothing about a
 * prompt needs saying. A Retry (`retry`) saved nothing, so its lines do not
 * start "Placement saved", and it says why a placement it skipped adds none.
 */
export function placementPromptMessage(saved: string, o: PlacementPromptOutcome, retry = false): string {
  const none = (rest: string) => (retry ? `No prompt added: ${rest}` : `Placement saved; no prompt added: ${rest}`);
  switch (o.kind) {
    case "off":
      return retry ? SWITCHED_OFF : SAVED_SWITCHED_OFF;
    case "skipped":
      return retry ? none(`${o.why}.`) : saved;
    case "exists":
      return retry ? `It already has its prompt: “${o.text}”.` : saved;
    case "added":
      return `${retry ? "" : `${saved} `}Prompt added: “${o.text}”, first asked ${formatDay(o.addedOn)}.${o.rotated ? ` To make room, “${o.rotated.text}” stops from ${formatDay(o.rotated.stoppedOn)}: its placement has been live 12 weeks or more and was never cited.` : ""}`;
    case "duplicate":
      return none(`“${o.text}” is already measured by “${o.of}”.${rotationLine(o.rotation)}`);
    case "unread":
      return none(`couldn't read the article (${o.why}). Retry from the placement row.`);
    case "no_prompt":
      return none(`${o.why}.`);
    case "full":
      return none(`${PLACEMENT_FULL}.${rotationLine(o.rotation)}`);
    case "failed":
      return none(`${o.message}.${rotationLine(o.rotation)} Retry from the placement row.`);
  }
}

/**
 * What a placement save does about its prompt, and the admin's line for it
 * (/admin/tracking's logPlacement and updatePlacement call this, so the
 * message paths have a test on a fake database - 13 Oct 2026 review):
 *
 * - a save that leaves the placement live, from any other status or as a new
 *   row, runs the hook; a row merely re-saved while live does not, so turning
 *   the switch on backfills nothing in bulk;
 * - the row's Retry runs the hook and saves nothing else: it posts no fields,
 *   so it cannot write back values another save has since changed;
 * - a move to removed stops the placement's prompt from tomorrow.
 *
 * `before` is the status before the save, null for a new row.
 */
export async function placementSaved(
  db: SupabaseClient,
  p: { clientId: string; placementId: string; before: string | null; after: string; retry: boolean; insertion: boolean; today: Day; saved: string },
  deps: { fetcher: Fetcher },
): Promise<string> {
  const hook = async () => {
    const o = await addPlacementPrompt(db, { clientId: p.clientId, placementId: p.placementId, insertion: p.insertion, today: p.today }, deps);
    if (o.kind === "failed") console.warn(`[diy] placement prompt for ${p.placementId}: ${o.message}`);
    return placementPromptMessage(p.saved, o, p.retry);
  };
  if (p.retry) return hook();
  if (p.after === "live" && p.before !== "live") return hook();
  if (p.after === "removed" && p.before !== null && p.before !== "removed") {
    const stopped = await stopPlacementPrompt(db, { clientId: p.clientId, placementId: p.placementId, today: p.today });
    if (!stopped.ok) return `${p.saved} Its prompt was not stopped: ${stopped.message}`;
    return stopped.stopped.length ? `${p.saved} Its prompt “${stopped.stopped[0]!.text}” stops from ${formatDay(addDays(p.today, 1))}; its history stays.` : p.saved;
  }
  return p.saved;
}

/** What happened to a prompt stopped to make room for one that was then not added. */
function rotationLine(r: RotationUndone | undefined): string {
  if (!r) return "";
  return r.restored
    ? ` “${r.text}” was stopped to make room and is live again.`
    : ` “${r.text}” was stopped to make room and still stops from ${formatDay(r.stoppedOn)}: taking that stop back failed (${r.why}).`;
}
