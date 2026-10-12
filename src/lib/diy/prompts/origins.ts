import type { SupabaseClient } from "@supabase/supabase-js";

import { appPath } from "../../app-host.ts";
import { selectAll } from "../../supabase/page.ts";
import type { UpsellMode } from "../../tracking/ask.ts";
import { missingColumn } from "../../tracking/limits.ts";

/**
 * Where each tracked prompt came from (13 Oct 2026, DIY P2; spec 10 sections
 * 4.10, 6.7 and 7.3). P2 is the only owner of `loadPromptOrigins`: every other
 * page that draws an origin receives the map as a prop or imports this loader,
 * and never reads the columns itself.
 *
 * The columns are `tracked_questions.origin_kind`, `origin_ref` and
 * `allowance` (migration 20261013010000). A row with no `origin_kind` is a
 * legacy row, and its origin is read from `source`, whose check is unchanged:
 * `scan` is Setup, `client` is You, `nomada` is nomada digital.
 *
 * Tolerant of the columns not being there yet (a deploy landing before its
 * migration): the read falls back to `id, source`, so every prompt still gets
 * its legacy chip, and says so once in the log. A read that fails outright is
 * an empty map and one warning; a page then draws no chips, never an error.
 *
 * Plain module, relative imports only, so `node --test` loads it. Its static
 * imports are pure, so a client component may take the chip's words and
 * links from it: the file system, the fixture switch, the fixture's repo and
 * the service-role client are reached through dynamic imports inside the
 * loader, and only when the caller did not pass its own.
 */

/** The chips, in the spec's order (section 6.7). `scan` is a legacy column value, read as `setup`. */
export const ORIGIN_KINDS = ["setup", "client", "nomada", "placement", "opportunity", "momentum"] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

/** The prompts the client chose: `/ai?origin=chosen` is their figures, like for like (spec 6.7, "Honesty"). A legacy row counts as chosen. */
export const CHOSEN_KINDS: readonly OriginKind[] = ["setup", "client", "nomada"];

export const isOriginKind = (v: unknown): v is OriginKind => typeof v === "string" && (ORIGIN_KINDS as readonly string[]).includes(v);

/** A tracked_questions row as far as its origin goes. Every field but `id` may be missing: a legacy read, or the fixture. */
export type OriginRow = { id: string; source?: string | null; origin_kind?: string | null; origin_ref?: string | null; allowance?: string | null };

export type PromptOrigin = {
  kind: OriginKind;
  /** origin_ref: the placement's or the opportunity's id; null when none. */
  ref: string | null;
  /** allowance = 'placement': outside the 5 angle slots and the client's 5 per cluster (limits.ts). */
  placement: boolean;
  /** A placement prompt's publication domain, for its chip; null for every other kind, or when the placement was not read. */
  domain: string | null;
};

const FROM_SOURCE: Record<string, OriginKind> = { scan: "setup", client: "client", nomada: "nomada" };

/** One row's origin: its own kind when set (`scan` is `setup`), else its source's. Null when neither says. */
export function originOf(row: OriginRow): PromptOrigin | null {
  const k = row.origin_kind ?? null;
  const kind: OriginKind | null = k === null ? (FROM_SOURCE[row.source ?? ""] ?? null) : k === "scan" ? "setup" : isOriginKind(k) ? k : null;
  if (!kind) return null;
  return { kind, ref: row.origin_ref ?? null, placement: row.allowance === "placement", domain: null };
}

/** The publication domain of a placement's url_key ("thesmallbizstack.com/best-accounting-apps" to its host). */
export const domainOfKey = (urlKey: string): string | null => urlKey.split("/")[0] || null;

/** Rows to the map the pages take, each placement origin given its publication's domain. */
export function originMap(rows: readonly OriginRow[], placements: readonly { id: string; url_key: string }[] = []): Map<string, PromptOrigin> {
  const domains = new Map(placements.map((p) => [p.id, domainOfKey(p.url_key)]));
  const out = new Map<string, PromptOrigin>();
  for (const r of rows) {
    const o = originOf(r);
    if (!o) continue;
    out.set(r.id, o.kind === "placement" && o.ref ? { ...o, domain: domains.get(o.ref) ?? null } : o);
  }
  return out;
}

/** The map's kinds alone, for a table that takes `Map<id, OriginKind>` (the /ai prompt table, P4). */
export function originKinds(origins: ReadonlyMap<string, PromptOrigin>): Map<string, OriginKind> {
  return new Map([...origins].map(([id, o]) => [id, o.kind]));
}

/** Whether a prompt is one the client chose: setup, client, nomada, or legacy with no origin read. */
export const isChosen = (o: PromptOrigin | null | undefined): boolean => !o || CHOSEN_KINDS.includes(o.kind);

/** Whether a prompt uses the placement allowance rather than an angle slot. */
export const isPlacementPrompt = (origins: ReadonlyMap<string, PromptOrigin> | null | undefined, id: string): boolean => origins?.get(id)?.placement === true;

/**
 * The chip's words (spec 6.7). In agency mode Nomada is never named: its chip
 * reads "Your account contact". So does `off`: loadUpgradeContext answers off
 * when the mode could not be read, and naming Nomada is right only when the
 * account is known to be ours. A placement shows where it was published.
 */
export function originLabel(o: Pick<PromptOrigin, "kind" | "domain">, mode: UpsellMode): string {
  switch (o.kind) {
    case "setup":
      return "Setup";
    case "client":
      return "You";
    case "nomada":
      return mode === "nomada" ? "nomada digital" : "Your account contact";
    case "placement":
      return o.domain ? `Placement · ${o.domain}` : "Placement";
    case "opportunity":
      return "Opportunity";
    case "momentum":
      return "Momentum";
  }
}

/**
 * Where a chip goes (spec 4.10): Placement to the client's placements,
 * Opportunity to its opportunity, Momentum to Google's gaining-ground block.
 * The others are not links. No W1 chip points at a page W1 has not built: no
 * opportunity or momentum prompt can exist before W2.
 */
export function originHref(o: Pick<PromptOrigin, "kind" | "ref">, slug: string): string | null {
  const base = `/${encodeURIComponent(slug)}`;
  if (o.kind === "placement") return appPath(`${base}/placements`);
  if (o.kind === "opportunity") return o.ref ? appPath(`${base}/opportunities/${encodeURIComponent(o.ref)}`) : null;
  if (o.kind === "momentum") return appPath(`${base}/google?gaining=1`);
  return null;
}

// ---- The reads. ----

type PgError = { code?: string; message: string };

const FULL = "id, source, origin_kind, origin_ref, allowance";
const LEGACY = "id, source";

/** Every prompt row of one client, paged; on missing columns, the legacy columns only. Throws on any other failure. */
export async function readOriginRows(db: SupabaseClient, clientId: string): Promise<OriginRow[]> {
  const read = (cols: string) =>
    selectAll<OriginRow>((from, to) => db.from("tracked_questions").select(cols).eq("client_domain_id", clientId).order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: OriginRow[] | null; error: PgError | null }>);
  try {
    return await read(FULL);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!missingColumn({ message })) throw e;
    console.warn(`[diy] origins: ${message}; chips from source only until the prompt_origins migration is applied`);
    return read(LEGACY);
  }
}

/** One client's origins from Supabase, placement chips with their domains. Never throws: a failed read is an empty map and a warning. */
export async function readPromptOrigins(db: SupabaseClient, clientId: string): Promise<Map<string, PromptOrigin>> {
  try {
    const rows = await readOriginRows(db, clientId);
    if (!rows.some((r) => r.origin_kind === "placement" && r.origin_ref)) return originMap(rows);
    const placements = await selectAll<{ id: string; url_key: string }>((from, to) =>
      db.from("placements").select("id, url_key").eq("client_domain_id", clientId).order("id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: { id: string; url_key: string }[] | null; error: PgError | null }>,
    ).catch((e: unknown) => {
      // The chips still draw, as "Placement" with no domain.
      console.warn(`[diy] origins: placements not read: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    });
    return originMap(rows, placements);
  } catch (e) {
    console.warn(`[diy] origins: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
}

// ---- The fixture (spec 7.0 item 6). ----

type Env = Record<string, string | undefined>;

/** A fixture origins file: `origins.json` (P2) or `origins.<pkg>.json` (P6, P7), keyed by DIY fixture state. */
export type OriginsFile = { full: OriginRow[] } & Record<string, OriginRow[] | undefined>;

export const ORIGINS_FILE = /^origins(\.[a-z0-9-]+)?\.json$/;

/** `origins.json` first, then every `origins.<pkg>.json` beside it, in name order; each file's entry for the state, else its `full`. */
export async function readOriginsFiles(dir: string, state: string): Promise<OriginRow[]> {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const names = readdirSync(dir)
    .filter((n) => ORIGINS_FILE.test(n))
    .sort((a, b) => (a === "origins.json" ? -1 : b === "origins.json" ? 1 : a.localeCompare(b)));
  return names.flatMap((n) => {
    const file = JSON.parse(readFileSync(join(dir, n), "utf8")) as OriginsFile;
    return file[state] ?? file.full ?? [];
  });
}

/**
 * The fixture's origins: the files' rows, then the origin columns the served
 * fixture's own prompt rows carry (fixture-mode.ts gives its `placed` states'
 * placement prompts theirs, as the database holds them on the row). Only
 * prompts the served fixture has are kept, so a count over the map is a count
 * of real prompts.
 */
export function fixtureOriginMap(fileRows: readonly OriginRow[], questions: readonly ({ id: string } & Partial<OriginRow>)[], placements: readonly { id: string; url_key: string }[]): Map<string, PromptOrigin> {
  const have = new Set(questions.map((q) => q.id));
  const byId = new Map<string, OriginRow>();
  for (const r of fileRows) if (have.has(r.id)) byId.set(r.id, r);
  for (const q of questions) {
    if (q.origin_kind === undefined && q.source === undefined && q.allowance === undefined) continue;
    byId.set(q.id, { id: q.id, source: q.source ?? null, origin_kind: q.origin_kind ?? null, origin_ref: q.origin_ref ?? null, allowance: q.allowance ?? null });
  }
  return originMap([...byId.values()], placements);
}

/** What the fixture branch reads, injectable for tests: the served fixture's prompts and placements. */
export type OriginRepo = {
  structure(clientId: string): Promise<{ questions: readonly { id: string }[] }>;
  placements(clientId: string): Promise<readonly { id: string; url_key: string }[]>;
};

export type OriginDeps = { db?: SupabaseClient; repo?: OriginRepo; env?: Env; root?: string };

/**
 * One client's prompt origins, keyed by prompt id. Supabase, or on the
 * tracking fixture the files in `src/lib/diy/fixtures` and the fixture's own
 * rows. Never throws.
 */
export async function loadPromptOrigins(clientId: string, deps: OriginDeps = {}): Promise<Map<string, PromptOrigin>> {
  const env = deps.env ?? process.env;
  const { fixtureMode } = await import("../../tracking/fixture-mode.ts");
  if (fixtureMode(env)) {
    try {
      const repo = deps.repo ?? ((await import("../../tracking/repo.ts")).trackingRepo() as unknown as OriginRepo);
      const [structure, placements] = await Promise.all([repo.structure(clientId), repo.placements(clientId)]);
      const rows = await readOriginsFiles(`${deps.root ?? process.cwd()}/src/lib/diy/fixtures`, env.DIY_FIXTURE_STATE || "full");
      return fixtureOriginMap(rows, structure.questions, placements);
    } catch (e) {
      console.warn(`[diy] origins: ${e instanceof Error ? e.message : String(e)}`);
      return new Map();
    }
  }
  let db: SupabaseClient;
  try {
    db = deps.db ?? (await import("../../supabase/admin.ts")).supabaseAdmin();
  } catch (e) {
    console.warn(`[diy] origins: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
  return readPromptOrigins(db, clientId);
}
