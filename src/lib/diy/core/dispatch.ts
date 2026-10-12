import type { SupabaseClient } from "@supabase/supabase-js";

import { SITE_URL } from "../../../config/schema.ts";
import { DIY_FREE_PATHS, type DiyFreeKind, type DiyFreePath } from "../../scan/dataforseo-request.ts";
import { selectAll } from "../../supabase/page.ts";
import { signRun } from "../../tracking/decide.ts";
import { addDays } from "../../tracking/figures.ts";

import { type DiyClient, loadDiyClients } from "./client.ts";
import { type JobSpec, type LastJob, WORKERS_PER_PASS, claimable, diyDay, dueJobs, refuseHandlers } from "./jobs.ts";
import { readDiySettings } from "./settings.ts";

/**
 * The DIY night dispatch, `dispatchDiyWork` (13 Oct 2026, DIY P1; spec 10
 * section 5.7), and `enqueueOnboarding` for the setup confirm.
 *
 * **Why it rides on two other crons.** Builders may stage only `src`,
 * `supabase` and `public`, and a cron entry lives in `vercel.json`, which is
 * outside them; `cron-schedule.test.mts` fails a cron route that is not in it.
 * So the dispatch runs as one more step of the two existing night crons -
 * `/api/cron/purge-responses` at 03:30 UTC (pass 1) and
 * `/api/cron/reap-stalled-scans` at 03:45 UTC (pass 2) - in its own try, so
 * neither job can hide the other's failure. Both finish well before the
 * 05:00 tracking burst. A dedicated `/api/cron/diy` is a later tidy-up for
 * whoever can edit `vercel.json`.
 *
 * Each pass:
 *
 * 1. reads `app_settings` (a failed read reads as off: nothing paid queued);
 * 2. once a UTC day, makes the two free vendor reads (Labs' refresh date, the
 *    Backlinks filter names) through `freeRead`, each in its own try, whatever
 *    `diy_enabled` says, and stores them in `diy_vendor_status`;
 * 3. for every active client, asks jobs.ts which kinds are due and upserts
 *    one `diy_jobs` row each on (client, kind, due day) - paid kinds only for
 *    a confirmed client while DIY is on;
 * 4. posts `WORKERS_PER_PASS` workers to `/api/diy/run`, signed with an HMAC
 *    of the body keyed on CRON_SECRET (as the tracking dispatch signs its
 *    runs), only while claimable due jobs remain. The 03:30 pass's workers
 *    have finished by 03:45 (270 s budget), so no more than two run at once.
 *
 * Posted to SITE_URL, never the cron request's own host: the tracking cron
 * dispatched to `new URL(req.url).origin` on 30 Sep and no run was ever
 * claimed (src/lib/tracking/dispatch.ts records it).
 *
 * Loadable by node --test: the database, the free reader and the fetch are
 * handed in.
 */

/** Where the workers are posted. */
export const DIY_RUN_URL = `${SITE_URL}/api/diy/run`;

/** The worker route reads the signature from this header. */
export const DIY_SIGNATURE_HEADER = "x-diy-signature";

/** How far back the dispatcher reads `diy_jobs` for each kind's newest row: two months covers a monthly kind's last slot. */
export const LOOKBACK_DAYS = 62;

/** Rows per upsert. */
const UPSERT_CHUNK = 500;

export type FreeAnswer = { kind: DiyFreeKind; googleDate: string | null; payload: unknown };
export type FreeReader = (path: DiyFreePath) => Promise<FreeAnswer>;
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number }>;

export type DispatchDeps = {
  db: SupabaseClient;
  handlers: readonly JobSpec[];
  /** 1 at 03:30 UTC, 2 at 03:45 UTC. */
  pass: 1 | 2;
  /** `freeRead` from doors.ts. */
  free: FreeReader;
  now?: () => number;
  secret?: string | undefined;
  fetchImpl?: FetchLike;
  loadClients?: (db: SupabaseClient, now: number) => Promise<DiyClient[]>;
};

export type DispatchSummary = {
  pass: 1 | 2;
  day: string;
  enabled: boolean;
  vendor: Partial<Record<DiyFreeKind, "read" | "had" | "failed">>;
  clients: number;
  queued: number;
  pending: number;
  posted: number;
  errors: string[];
};

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** The signed body of one worker post. */
export function workerBody(p: { pass: 1 | 2; worker: number; day: string }): string {
  return JSON.stringify({ pass: p.pass, worker: p.worker, day: p.day });
}

/** Post one worker. Answers whether the worker route took it (202). */
export async function postWorker(body: string, secret: string, fetchImpl: FetchLike): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetchImpl(DIY_RUN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", [DIY_SIGNATURE_HEADER]: signRun(body, secret) },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    return res.status === 202 ? { ok: true } : { ok: false, reason: `the DIY worker route answered ${res.status}` };
  } catch (err) {
    return { ok: false, reason: `could not post a DIY worker: ${msg(err)}` };
  }
}

/** Step 2: the free vendor reads, once a UTC day, each in its own try. */
async function vendorReads(db: SupabaseClient, free: FreeReader, day: string, out: DispatchSummary): Promise<void> {
  const { data, error } = await db.from("diy_vendor_status").select("kind").eq("read_on", day).limit(10);
  if (error) {
    out.errors.push(`could not read diy_vendor_status: ${error.message}`);
    return;
  }
  const had = new Set(((data ?? []) as { kind: string }[]).map((r) => r.kind));
  for (const kind of Object.keys(DIY_FREE_PATHS) as DiyFreeKind[]) {
    if (had.has(kind)) {
      out.vendor[kind] = "had";
      continue;
    }
    try {
      const got = await free(DIY_FREE_PATHS[kind]);
      const { error: upErr } = await db
        .from("diy_vendor_status")
        .upsert([{ kind, read_on: day, google_date: got.googleDate, payload: got.payload ?? {} }], { onConflict: "kind,read_on", ignoreDuplicates: true });
      if (upErr) throw new Error(upErr.message);
      out.vendor[kind] = "read";
    } catch (err) {
      out.vendor[kind] = "failed";
      out.errors.push(`${kind}: ${msg(err)}`);
    }
  }
}

type LastRow = { client_domain_id: string; kind: string; due_on: string; created_at: string };

/** Each client's newest row of each kind, from one paged read of the last LOOKBACK_DAYS. */
export function newestByClient(rows: readonly LastRow[]): Map<string, Map<string, LastJob>> {
  const out = new Map<string, Map<string, LastJob>>();
  for (const r of rows) {
    const kinds = out.get(r.client_domain_id) ?? new Map<string, LastJob>();
    const had = kinds.get(r.kind);
    if (!had || r.due_on > had.due_on || (r.due_on === had.due_on && r.created_at > had.created_at)) kinds.set(r.kind, { due_on: r.due_on, created_at: r.created_at });
    out.set(r.client_domain_id, kinds);
  }
  return out;
}

type Queued = { client_domain_id: string; kind: string; due_on: string; priority: number; payload: { onboarding: boolean } };

async function upsertJobs(db: SupabaseClient, rows: readonly Queued[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await db
      .from("diy_jobs")
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "client_domain_id,kind,due_on", ignoreDuplicates: true });
    if (error) throw new Error(`could not queue DIY jobs: ${error.message}`);
  }
}

type PendingRow = { id: string; due_on: string; claimed_at: string | null; done_at: string | null; attempts: number };

/** How many due jobs a worker could claim now. Throws when they cannot be read. */
export async function pendingJobs(db: SupabaseClient, today: string, now: number): Promise<number> {
  const rows = await selectAll<PendingRow>((from, to) =>
    db.from("diy_jobs").select("id, due_on, claimed_at, done_at, attempts").is("done_at", null).lte("due_on", today).order("id", { ascending: true }).range(from, to),
  );
  return rows.filter((r) => claimable(r, today, now)).length;
}

/** One night pass. Never throws: every failure is in `errors`, so the cron route's own job still answers. */
export async function dispatchDiyWork(deps: DispatchDeps): Promise<DispatchSummary> {
  const now = deps.now ?? Date.now;
  const day = diyDay(now());
  const out: DispatchSummary = { pass: deps.pass, day, enabled: false, vendor: {}, clients: 0, queued: 0, pending: 0, posted: 0, errors: [] };

  // 1. Settings. A failed read is off: free kinds still queue, nothing paid does.
  try {
    out.enabled = (await readDiySettings(deps.db)).enabled;
  } catch (err) {
    out.errors.push(msg(err));
  }

  // 2. The two free vendor reads, once a UTC day, whatever the switch says.
  try {
    await vendorReads(deps.db, deps.free, day, out);
  } catch (err) {
    out.errors.push(`vendor reads: ${msg(err)}`);
  }

  // 3. Queue what is due.
  const wiring = refuseHandlers(deps.handlers);
  if (wiring.length) {
    out.errors.push(`JOB_HANDLERS is wired wrong, nothing queued: ${wiring.join("; ")}`);
  } else if (deps.handlers.length) {
    try {
      const clients = await (deps.loadClients ?? loadDiyClients)(deps.db, now());
      out.clients = clients.length;
      const since = addDays(day, -LOOKBACK_DAYS);
      const rows = await selectAll<LastRow>((from, to) =>
        deps.db.from("diy_jobs").select("client_domain_id, kind, due_on, created_at").gte("due_on", since).order("id", { ascending: true }).range(from, to),
      );
      const last = newestByClient(rows);
      const queued: Queued[] = [];
      for (const client of clients) {
        for (const due of dueJobs(deps.handlers, client, { enabled: out.enabled, today: day, last: last.get(client.id) ?? new Map() })) {
          queued.push({ client_domain_id: client.id, kind: due.kind, due_on: due.due_on, priority: due.priority, payload: { onboarding: due.onboarding } });
        }
      }
      await upsertJobs(deps.db, queued);
      out.queued = queued.length;
    } catch (err) {
      out.errors.push(msg(err));
    }
  }

  // 4. Post the workers, only while something is left for them.
  try {
    out.pending = await pendingJobs(deps.db, day, now());
  } catch (err) {
    out.errors.push(msg(err));
    return out;
  }
  if (out.pending === 0) return out;
  const secret = deps.secret ?? process.env.CRON_SECRET;
  if (!secret) {
    out.errors.push("CRON_SECRET is not set, so no DIY worker was posted");
    return out;
  }
  const posts = await Promise.all(
    Array.from({ length: WORKERS_PER_PASS }, (_, i) => postWorker(workerBody({ pass: deps.pass, worker: i + 1, day }), secret, deps.fetchImpl ?? fetch)),
  );
  out.posted = posts.filter((p) => p.ok).length;
  for (const p of posts) if (!p.ok) out.errors.push(p.reason);
  return out;
}

/**
 * Setup confirmed (P6 calls this from the setup route): queue the onboarding
 * runs of every kind that has one, due today, so the next night pass runs
 * them - the free ones (key pages, bots) always, the paid ones (section 5.5's
 * onboarding reads) only while DIY is on. The dispatcher would queue the same
 * rows on its first pass after the confirm; queuing them now makes the
 * "First read" date real at once. Throws on a failed write: the setup route
 * catches and logs it, and the next pass queues them anyway.
 */
export async function enqueueOnboarding(db: SupabaseClient, clientId: string, opts: { handlers: readonly JobSpec[]; now?: number }): Promise<number> {
  const now = opts.now ?? Date.now();
  const day = diyDay(now);
  let enabled = false;
  try {
    enabled = (await readDiySettings(db)).enabled;
  } catch (err) {
    console.warn(`[diy] onboarding: ${msg(err)}; paid onboarding waits for the next pass`);
  }
  const rows: Queued[] = opts.handlers
    .filter((h) => h.onboarding && (!h.paid || enabled))
    .map((h) => ({ client_domain_id: clientId, kind: h.kind, due_on: day, priority: h.priority, payload: { onboarding: true } }));
  await upsertJobs(db, rows);
  return rows.length;
}
