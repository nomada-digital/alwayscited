import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import type { Day } from "../../tracking/figures.ts";
import { GRADES, type Grade } from "../core/evidence.ts";
import { diyFixtureState, diyFixtureStore, diyFixtureWrites, readDiyFixture, type DiyFixtureState } from "../core/fixture.ts";
import { CHANGED, EFFORTS, PLAN_COLUMNS, PLAN_KINDS, PLAN_STATUSES, SEVERITIES, type Effort, type ItemSeverity, type PlanItem, type PlanKind, type PlanStatus, type ReadoutBase, type Verified, type WhyFact, clientPath } from "./types.ts";

/**
 * The Plan's loader (13 Oct 2026, DIY P3; spec 10 sections 3.3 and 7.0 item
 * 6): Supabase, or the fixture. Plain module with the database passed in, so
 * node --test runs both branches.
 *
 * A row is read through `itemOf`, which keeps only what the columns' checks
 * allow and drops what it cannot read: a fact with no words, an href that is
 * not a dashboard path, a verification with no text. Nothing from a row is
 * drawn that was not named here.
 *
 * On the fixture (`TRACKING_FIXTURE=1`) the items are
 * src/lib/diy/fixtures/plan.json's entry for `DIY_FIXTURE_STATE`; with
 * `TRACKING_FIXTURE_WRITE=1` the route's writes are held in memory over it
 * (`planFixture`), as the tracking fixture's are.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): Day | null => (typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const pick = <T extends string>(v: unknown, set: readonly T[]): T | null => (typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : null);

function whyOf(v: unknown): WhyFact[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f): f is { text: string; href?: unknown } => !!f && typeof f === "object" && typeof (f as { text?: unknown }).text === "string" && (f as { text: string }).text.trim() !== "")
    .slice(0, 3)
    .map((f) => {
      const href = clientPath(f.href);
      return href ? { text: f.text, href } : { text: f.text };
    });
}

function verifiedOf(v: unknown): Verified | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const at = day(o.at);
  return typeof o.text === "string" && o.text.trim() && at ? { by: typeof o.by === "string" ? o.by : "", at, text: o.text } : null;
}

function baseOf(v: unknown): ReadoutBase | null {
  if (!v || typeof v !== "object") return null;
  const changed = pick((v as Record<string, unknown>).changed, CHANGED);
  return changed ? { changed } : {};
}

/** One plan_items row as an item, or null when its kind, severity or status is not one the table allows. */
export function itemOf(r: Record<string, unknown>): PlanItem | null {
  const kind = pick<PlanKind>(r.kind, PLAN_KINDS);
  const severity = pick<ItemSeverity>(r.severity, [...SEVERITIES, "own"]);
  const status = pick<PlanStatus>(r.status, PLAN_STATUSES);
  const id = r.id === undefined || r.id === null ? null : String(r.id);
  if (!kind || !severity || !status || !id || typeof r.title !== "string" || typeof r.dedupe_key !== "string") return null;
  return {
    id,
    clusterId: str(r.cluster_id),
    kind,
    severity,
    status,
    title: r.title,
    why: whyOf(r.why),
    grade: pick<Grade>(r.grade, GRADES),
    sourceId: str(r.source_id),
    effort: pick<Effort>(r.effort, EFFORTS),
    href: clientPath(r.href),
    refTable: str(r.ref_table),
    refId: str(r.ref_id),
    dedupeKey: r.dedupe_key,
    weekOf: day(r.week_of),
    newSinceMonday: r.new_since_monday === true,
    ownerEmail: str(r.owner_email),
    note: str(r.note),
    hiddenUntil: day(r.hidden_until),
    createdBy: str(r.created_by) ?? "system",
    createdAt: str(r.created_at) ?? "",
    statusAt: str(r.status_at) ?? "",
    statusBy: str(r.status_by),
    startedOn: day(r.started_on),
    doneOn: day(r.done_on),
    verified: verifiedOf(r.verified),
    readoutBase: baseOf(r.readout_base),
    seenOn: day(r.seen_on),
    missed: typeof r.missed === "number" ? r.missed : 0,
    missedOn: day(r.missed_on),
  };
}

/** Every item of one client, any status, oldest first. Paged; a failed read throws. */
export async function loadPlanItems(db: SupabaseClient, clientId: string): Promise<PlanItem[]> {
  const rows = await selectAll<Record<string, unknown>>((lo, hi) => db.from("plan_items").select(PLAN_COLUMNS).eq("client_domain_id", clientId).order("created_at").order("id").range(lo, hi));
  return rows.map(itemOf).filter((i): i is PlanItem => i !== null);
}

/** The fixture's file: per state, the items as rows. */
export type PlanFixture = { items: Record<string, unknown>[] };

type Env = Record<string, string | undefined>;

/** The fixture's items for the current DIY state, as rows, before any write. */
export function fixtureRows(env: Env = process.env, root?: string): Record<string, unknown>[] {
  return readDiyFixture<PlanFixture>("plan", env, root).items;
}

type Held = { state: DiyFixtureState; rows: Record<string, unknown>[] };

/**
 * The fixture's items as the route's writes have left them. Held per state,
 * so a spec that switches DIY_FIXTURE_STATE is served the new state's file.
 */
export function planFixture(env: Env = process.env, root?: string): { rows(): Record<string, unknown>[]; write(next: Record<string, unknown>[]): boolean } {
  const state = diyFixtureState(env) ?? "full";
  const store = diyFixtureStore<Held>("plan", () => ({ state, rows: fixtureRows(env, root) }));
  const held = () => {
    const h = store.get();
    if (h.state === state) return h;
    const fresh = { state, rows: fixtureRows(env, root) };
    store.set(fresh);
    return fresh;
  };
  return {
    rows: () => held().rows.map((r) => ({ ...r })),
    write(next) {
      if (!diyFixtureWrites(env)) return false;
      store.set({ state, rows: next });
      return true;
    },
  };
}

/** A section's read: its rows, or that it could not be read. A failed section never reads as empty (spec section 3.4). */
export type Section<T> = { ok: true; value: T } | { ok: false };

/** Run one read as a section: a throw is logged as `[diy] <section>: <message>` and becomes `{ ok: false }`. */
export async function section<T>(name: string, read: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (err) {
    console.warn(`[diy] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false };
  }
}

/**
 * The client's items: the fixture's when it is on, else Supabase's through
 * `db`. Fixture rows carry the tracking fixture's client id ("fixture"), so
 * the two-clients state's second client has none, as it has no readings.
 */
export async function readPlan(db: () => SupabaseClient, clientId: string, env: Env = process.env): Promise<PlanItem[]> {
  if (diyFixtureState(env) !== null) {
    return planFixture(env)
      .rows()
      .filter((r) => r.client_domain_id === clientId)
      .map(itemOf)
      .filter((i): i is PlanItem => i !== null);
  }
  return loadPlanItems(db(), clientId);
}
