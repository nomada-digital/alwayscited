import type { SupabaseClient } from "@supabase/supabase-js";

import { type Row, type Tables, fakeDb } from "../../tracking/fake-db.mts";

import type { DiyClient } from "./client.ts";
import { type ReadRuntime, mintReadCtx, pool } from "./ctx.ts";
import type { OnDemandAction, ReadCtx, ReadTrigger } from "./jobs.ts";

/**
 * The tracking fake database (fake-db.mts) with what the DIY core also calls:
 * `rpc("diy_spend")` answered from the `diy_reads` rows it holds, the way the
 * migration's function sums them; an upsert on a unique key; a count; `.gt`,
 * `.neq` and `.not`. Test support, not a test - the runner does not run it,
 * and the source walks read `.ts` and `.tsx` only (13 Oct 2026, DIY P1).
 */

type Opts = { maxRows?: number; failInsert?: (table: string, row: Row) => boolean; failRpc?: boolean; failSelect?: (table: string) => boolean; failUpdate?: (table: string) => boolean };

/** The migration's `diy_spend`, over rows in memory. */
export function diySpendOf(rows: readonly Row[], client: string, dayStart: string, monthStart: string): Row[] {
  const live = rows.filter((r) => ["reserved", "ok", "partial", "failed"].includes(String(r.status)) && String(r.created_at) >= (dayStart < monthStart ? dayStart : monthStart));
  const amount = (r: Row) => Number(r.cost ?? r.estimate ?? 0);
  const today = live.filter((r) => String(r.created_at) >= dayStart);
  const counts: Record<string, number> = {};
  for (const r of today.filter((r) => r.client_domain_id === client)) counts[`${r.trigger}:${r.door}`] = (counts[`${r.trigger}:${r.door}`] ?? 0) + 1;
  const sums: Record<string, number> = {};
  for (const r of live.filter((r) => r.client_domain_id === client && String(r.created_at) >= monthStart)) {
    const k = r.door === "model" ? "model" : r.trigger === "on_demand" ? "on_demand" : "scheduled";
    sums[k] = (sums[k] ?? 0) + amount(r);
  }
  return [
    {
      global_dfs_today: today.filter((r) => r.door !== "model").reduce((t, r) => t + amount(r), 0),
      global_model_today: today.filter((r) => r.door === "model").reduce((t, r) => t + amount(r), 0),
      door_counts: counts,
      month_sums: sums,
    },
  ];
}

export function fakeDiyDb(tables: Tables, opts: Opts = {}) {
  const base = fakeDb(tables, opts);
  const clock = { now: Date.parse("2026-10-14T03:31:00Z") };
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let nextId = 1000;

  const from = (table: string) => {
    const b = base.db.from(table) as unknown as Record<string, (...a: unknown[]) => unknown> & { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown> };
    let count: null | { head: boolean } = null;
    let upsertRows: Row[] | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let isUpdate = false;
    const extra: ((r: Row) => boolean)[] = [];
    const select = b.select!;
    b.select = (cols?: unknown, o?: unknown) => {
      if ((o as { count?: string } | undefined)?.count) count = { head: (o as { head?: boolean }).head === true };
      return select(cols);
    };
    const update = b.update!;
    b.update = (patch: unknown) => {
      isUpdate = true;
      return update(patch);
    };
    const insert = b.insert!;
    // The database stamps created_at and a uuid id; the base fake numbers its rows.
    b.insert = (row: unknown) => insert({ id: `${table}-${nextId++}`, created_at: new Date(clock.now).toISOString(), ...(row as Row) });
    b.upsert = (rows: unknown, o?: unknown) => {
      upsertRows = (Array.isArray(rows) ? rows : [rows]) as Row[];
      upsertOpts = (o ?? {}) as typeof upsertOpts;
      return b;
    };
    // Filters the base fake lacks, applied on top: the base sees none of them,
    // so a select or update narrowed by one is narrowed here instead.
    b.gt = (c: unknown, v: unknown) => (extra.push((r) => r[c as string] != null && String(r[c as string]) > String(v)), b);
    b.neq = (c: unknown, v: unknown) => (extra.push((r) => r[c as string] !== v), b);
    b.not = (c: unknown, op: unknown, v: unknown) => {
      if (op === "is") extra.push((r) => (r[c as string] ?? null) !== v);
      else if (op === "in") extra.push((r) => !String(v).replace(/[()]/g, "").split(",").includes(String(r[c as string])));
      else throw new Error(`fakeDiyDb: .not(${String(op)}) is not supported`);
      return b;
    };
    const then = b.then.bind(b);
    b.then = (resolve, reject) => {
      if (upsertRows) {
        const rows = (tables[table] ??= []);
        const keys = (upsertOpts.onConflict ?? "id").split(",").map((k) => k.trim());
        if (opts.failInsert && upsertRows.some((r) => opts.failInsert!(table, r))) return Promise.resolve(resolve({ data: null, error: { message: `${table} upsert refused by the test` } }));
        for (const r of upsertRows) {
          const hit = rows.find((x) => keys.every((k) => String(x[k]) === String(r[k])));
          if (hit) {
            if (!upsertOpts.ignoreDuplicates) Object.assign(hit, r);
            continue;
          }
          rows.push({ id: `job-${nextId++}`, created_at: new Date(clock.now).toISOString(), ...r });
        }
        return Promise.resolve(resolve({ data: null, error: null }));
      }
      if (opts.failSelect?.(table) && !isUpdate) return Promise.resolve(resolve({ data: null, error: { message: `${table} select refused by the test` } }));
      if (opts.failUpdate?.(table) && isUpdate) return Promise.resolve(resolve({ data: null, error: { message: `${table} update refused by the test` } }));
      if (extra.length) {
        // Hide the rows the extra filters reject from the base fake for this one call.
        const all = (tables[table] ??= []);
        const hidden = all.filter((r) => !extra.every((f) => f(r)));
        tables[table] = all.filter((r) => extra.every((f) => f(r)));
        const restore = (v: unknown) => {
          const kept = tables[table] ?? [];
          tables[table] = [...kept, ...hidden];
          return v;
        };
        return then((v: unknown) => resolve(restore(shape(v))), (e: unknown) => (restore(null), reject ? reject(e) : Promise.reject(e)));
      }
      return then((v: unknown) => resolve(shape(v)), reject);
    };
    const shape = (v: unknown) => {
      if (!count) return v;
      const r = v as { data: unknown; error: unknown };
      return { data: count.head ? null : r.data, count: Array.isArray(r.data) ? r.data.length : 0, error: r.error };
    };
    return b;
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (opts.failRpc) return { data: null, error: { message: "diy_spend refused by the test" } };
    if (name !== "diy_spend") return { data: null, error: { message: `no fake for ${name}` } };
    return { data: diySpendOf(tables.diy_reads ?? [], String(args.p_client), String(args.p_day_start), String(args.p_month_start)), error: null };
  };

  return { db: { from, rpc } as unknown as SupabaseClient, tables, calls: base.calls, rpcCalls, clock };
}

/** A DIY client for tests: the tracking fixture's made-up brand. */
export function testClient(over: Partial<DiyClient> = {}): DiyClient {
  return {
    id: "c-tallyroo",
    slug: "tallyroo",
    domain: "tallyroo.com",
    brand: "Tallyroo",
    market: "UK",
    zone: "Europe/London",
    tier: "tracked",
    placed: false,
    trial: false,
    status: "active",
    startedOn: "2026-09-01",
    setupConfirmedAt: "2026-08-31T12:00:00Z",
    upsellMode: "nomada",
    ...over,
  };
}

/** A minted ctx over a fake runtime, for tests only (the shipped mints are the worker's and runOnDemand's). */
export function testCtx(db: SupabaseClient, clock: { now: number }, over: { client?: DiyClient; trigger?: ReadTrigger; action?: OnDemandAction | null; deadlineMs?: number; fixture?: boolean; sleeps?: number[] } = {}): ReadCtx {
  const trigger = over.trigger ?? "scheduled";
  const runtime: ReadRuntime = {
    db,
    now: () => clock.now,
    sleep: async (ms) => {
      over.sleeps?.push(ms);
    },
    reads: pool(4),
    models: pool(1),
    fixture: over.fixture === true,
  };
  return mintReadCtx(
    { client: over.client ?? testClient(), trigger, action: over.action ?? (trigger === "on_demand" ? "page_check" : null), deadlineMs: over.deadlineMs ?? clock.now + 270_000 },
    runtime,
  );
}

/** App settings rows as the migration seeds them, with DIY switched on. */
export function settingsRows(over: Record<string, unknown> = {}): Row[] {
  const v: Record<string, unknown> = {
    diy_enabled: true,
    diy_daily_cost_cap_usd: 10,
    diy_daily_model_cap_usd: 5,
    diy_client_month_scheduled_usd: 2.5,
    diy_client_month_ondemand_usd: 3,
    diy_client_month_model_usd: 2,
    diy_trial_month_scheduled_usd: 1,
    diy_trial_month_ondemand_usd: 1,
    diy_trial_month_model_usd: 1,
    ...over,
  };
  return Object.entries(v)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value }));
}
