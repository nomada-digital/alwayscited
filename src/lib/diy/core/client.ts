import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import { type UpsellMode, upsellMode } from "../../tracking/ask.ts";
import { marketZone } from "../../tracking/check-time.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import type { Fixture } from "../../tracking/fixture-mode.ts";
import { placedTier } from "../../tracking/placement-figures.ts";
import { SETUP_CONFIRMED_EVENT } from "../../tracking/setup-landing.ts";

/**
 * The client as every DIY job, door and loader sees it (13 Oct 2026, DIY P1
 * milestone M1; spec 10 sections 2.2, 5.6, 5.7). Named fields only. The
 * upsell mode comes through the client row's own join, as
 * upgrade-context.ts reads it, so no account id is read at all.
 *
 * Loadable by node --test: relative imports, no server-only, the database
 * passed in. Three ways in, one shape out:
 *
 * - `loadDiyClients(db, now)`: every active client, paged, for the dispatcher;
 * - `loadDiyClient(db, id, now)`: one client, for the worker and the routes;
 * - `fixtureDiyClient(client, facts, now)`: the tracking fixture's client, for
 *   the fixture branch of each package's loader.
 *
 * A failed read throws. A client whose setup or mode could not be read is
 * not a client with no setup: the dispatcher would then queue nothing paid,
 * and a page would say "nomada digital" in agency mode.
 */

export type ClientStatus = "active" | "paused" | "ended";

export type DiyClient = {
  id: string;
  slug: string;
  domain: string;
  /** `brand_name`, else the domain, as the runner names the client. */
  brand: string;
  market: string;
  /** The market's zone (check-time.ts marketZone): allowances reset on the 1st there. */
  zone: "Europe/London" | "America/New_York";
  tier: string;
  /** alwaysmentioned, the alwayscited plan or alwayseverywhere (placement-figures.ts placedTier). */
  placed: boolean;
  /** In the alwaystracked trial when loaded: `trial_ends_at` still ahead. Trial clients get the trial allowances and the `diy_trial_*` caps. */
  trial: boolean;
  status: ClientStatus;
  /** `started_on`: the cadence anchor (jobs.ts slotOn). Null for a client that has not been given one. */
  startedOn: Day | null;
  /** When setup was first confirmed (the earliest `setup_confirmed` event), or null while it is not. Paid kinds wait for it. */
  setupConfirmedAt: string | null;
  /** `accounts.upsell_mode`: agency mode never names Nomada. */
  upsellMode: UpsellMode;
};

/** The `client_domains` columns a DiyClient is made from, with the account's mode joined. */
export const DIY_CLIENT_COLUMNS = "id, slug, domain, brand_name, market, tier, started_on, status, trial_ends_at, accounts(upsell_mode)";

/** The account join as PostgREST answers it: one object for a to-one join, an array in older shapes. */
type AccountJoin = { upsell_mode: unknown } | { upsell_mode: unknown }[] | null | undefined;

export type ClientRow = {
  id: string;
  slug: string | null;
  domain: string;
  brand_name: string | null;
  market: string;
  tier: string;
  started_on: string | null;
  status: string | null;
  trial_ends_at?: string | null;
  accounts?: AccountJoin;
};

function status(v: string | null): ClientStatus {
  if (v === null || v === "active") return "active";
  if (v === "paused" || v === "ended") return v;
  throw new Error(`client status ${JSON.stringify(v)} is not one client_domains allows`);
}

/**
 * The joined account's mode. `client_domains.account_id` is not null, so a
 * row with no account in its join is a read that went wrong, and throws
 * rather than reading as "nomada".
 */
export function modeOf(row: Pick<ClientRow, "id" | "accounts">): UpsellMode {
  const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;
  if (!account) throw new Error(`client ${row.id} came back with no account`);
  return upsellMode(account.upsell_mode);
}

/** One client row, its first setup confirm and its account's mode, as a DiyClient at `now`. Pure. */
export function diyClient(row: ClientRow, facts: { setupConfirmedAt: string | null; upsellMode: unknown }, now: number): DiyClient {
  const trialEnds = row.trial_ends_at ? Date.parse(row.trial_ends_at) : NaN;
  return {
    id: row.id,
    slug: row.slug ?? "",
    domain: row.domain,
    brand: row.brand_name || row.domain,
    market: row.market,
    zone: marketZone(row.market),
    tier: row.tier,
    placed: placedTier(row.tier),
    trial: Number.isFinite(trialEnds) && trialEnds > now,
    status: status(row.status),
    startedOn: row.started_on ? row.started_on.slice(0, 10) : null,
    setupConfirmedAt: facts.setupConfirmedAt,
    upsellMode: upsellMode(facts.upsellMode),
  };
}

/** The earliest setup confirm per client, from `dashboard_events` rows. */
export function confirmedAt(rows: readonly { client_domain_id: string | null; created_at: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.client_domain_id) continue;
    const had = out.get(r.client_domain_id);
    if (had === undefined || Date.parse(r.created_at) < Date.parse(had)) out.set(r.client_domain_id, r.created_at);
  }
  return out;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

type ConfirmRow = { client_domain_id: string | null; created_at: string };

/**
 * Every active client with a slug, oldest id first, as DiyClients (spec 5.7
 * step 3: any tier, trial included; paused and ended ones are not read). Two
 * paged reads, because PostgREST answers a select with at most a thousand
 * rows and says so nowhere (supabase/page.ts): the clients with their
 * account's mode, and every setup confirm.
 */
export async function loadDiyClients(db: SupabaseClient, now: number): Promise<DiyClient[]> {
  let rows: ClientRow[];
  let events: ConfirmRow[];
  try {
    [rows, events] = await Promise.all([
      selectAll<ClientRow>((from, to) => db.from("client_domains").select(DIY_CLIENT_COLUMNS).eq("status", "active").order("id", { ascending: true }).range(from, to)),
      selectAll<ConfirmRow>((from, to) => db.from("dashboard_events").select("client_domain_id, created_at").eq("event", SETUP_CONFIRMED_EVENT).order("id", { ascending: true }).range(from, to)),
    ]);
  } catch (err) {
    throw new Error(`could not read the DIY clients: ${msg(err)}`);
  }
  const confirmed = confirmedAt(events);
  return rows.filter((r) => r.slug).map((r) => diyClient(r, { setupConfirmedAt: confirmed.get(r.id) ?? null, upsellMode: modeOf(r) }, now));
}

/** One client, whatever its status, or null when there is no such client. Throws on a failed read. */
export async function loadDiyClient(db: SupabaseClient, clientId: string, now: number): Promise<DiyClient | null> {
  const [{ data: row, error }, { data: events, error: eErr }] = await Promise.all([
    db.from("client_domains").select(DIY_CLIENT_COLUMNS).eq("id", clientId).maybeSingle(),
    db.from("dashboard_events").select("client_domain_id, created_at").eq("client_domain_id", clientId).eq("event", SETUP_CONFIRMED_EVENT).order("created_at", { ascending: true }).limit(1),
  ]);
  if (error) throw new Error(`could not read the client: ${error.message}`);
  if (eErr) throw new Error(`could not read the client's setup: ${eErr.message}`);
  if (!row) return null;
  const r = row as ClientRow;
  const first = confirmedAt((events ?? []) as ConfirmRow[]).get(clientId) ?? null;
  return diyClient(r, { setupConfirmedAt: first, upsellMode: modeOf(r) }, now);
}

/**
 * The tracking fixture's client as a DiyClient (fixture-mode.ts applies the
 * tracking state first, so `trial`, `ended` and the rest arrive here as the
 * pages see them). The fixture records no confirm time: a confirmed fixture
 * client counts as confirmed at noon the day before its start day, as a
 * client confirmed on its signup day starts tracking the next.
 */
export function fixtureDiyClient(client: Fixture["client"], facts: { setupConfirmed: boolean; upsellMode?: unknown }, now: number): DiyClient {
  const row: ClientRow = { ...client, brand_name: client.brand, status: client.status ?? "active", trial_ends_at: client.trial_ends_at ?? null };
  return diyClient(row, { setupConfirmedAt: facts.setupConfirmed ? `${addDays(client.started_on, -1)}T12:00:00Z` : null, upsellMode: facts.upsellMode ?? "nomada" }, now);
}
