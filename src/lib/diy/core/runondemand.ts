import type { SupabaseClient } from "@supabase/supabase-js";

import { runIsStalled } from "../../tracking/dispatch.ts";

import { type AllowanceKey, allowanceMonth, room, usedUpLine } from "./allowances.ts";
import { type Refusal, type RefusalCode, decideReservation, refusalWords } from "./caps.ts";
import type { DiyClient } from "./client.ts";
import { mintReadCtx, pool, realSleep } from "./ctx.ts";
import { diyFixtureState, readDiyFixture } from "./fixture.ts";
import type { OnDemandAction, ReadCtx } from "./jobs.ts";
import { readDiySpend, utcDayStart } from "./ledger.ts";
import { type Door, DFS_PRICES, modelEstimate } from "./prices.ts";
import { readDiySettings } from "./settings.ts";
import { type CoreFixture, type UsageKey, countLedger, countUsage } from "./usage-meter.ts";

/**
 * A member's paid button, `runOnDemand` (13 Oct 2026, DIY P1; spec 10
 * sections 3.6 and 5.7): a page check, a drafted example, "Verify now", a
 * logged site, "Check a link". Routes call it; it is the only other place a
 * ReadCtx is minted.
 *
 * In order, refusing at the first that fails, and reserving nothing on any
 * refusal:
 *
 * 0. **the client is not active** - a paused or ended client spends nothing,
 *    whatever the calling route's role check allowed (13 Oct 2026, review of
 *    DIY P1: writeRole downgrades only an ended client's members);
 * 1. **a tracking run is running.** The 05:00-05:15 UTC burst runs every
 *    client's reads over the account's 30 concurrent DataForSEO slots, and a
 *    DIY read in it would fail or take a slot a client's run needs. A run
 *    left `running` past the stall line was killed by the platform and does
 *    not block (tracking/dispatch.ts runIsStalled);
 * 2. **the product allowance** (allowances.ts), counted by usage-meter.ts -
 *    "You've used this month's 30 page checks. They reset on 1 Nov.";
 * 3. **the caps, as a preflight** - the switch, the global day, this door's
 *    on-demand count today, this client's month budget - at the action's
 *    largest read, so a refusal is the member's answer at once rather than a
 *    pending row that fails in `after()`;
 *
 * then mints the ctx and runs `fn` inline (page check, link check: short
 * reads) or schedules it with `after` (a drafted example: `defer`). Each paid
 * read `fn` makes is still reserved and checked by the ledger as it goes out,
 * so the preflight is a courtesy, never the cap. An unreadable count or
 * ledger refuses: it is never read as room.
 *
 * **Free first** (`FREE_FIRST`: verify, a logged site, "Check a link"): the
 * action's first step is our own fetch, which is free, and only its
 * `content_parsing` fallback is paid. Steps 1-3 then refuse the fallback, not
 * the action: `fn` still runs, and the fallback's door answers `refused` with
 * the step's code before any ledger read or row (ctx.ts `preRefusal`). So
 * while DIY is dark, during the tracking burst, or at a cap, "Check a link"
 * still reads the page itself (spec 10 section 4.8: "Check a link uses an own
 * fetch, which is free; its content_parsing fallback is skipped while dark").
 * A free check writes no ledger row, so it is never counted against the
 * allowance (usage-meter.ts).
 *
 * On the fixture nothing reaches a vendor or a database: the state decides
 * (`dark` is switched off, `capped` has used every allowance), and `fn` gets a
 * fixture ctx whose doors refuse, so the package serves its canned read
 * (ctx.ts isFixtureCtx). A free-first action runs on every state.
 */

export type OnDemandInput = {
  /** Null only on the fixture. */
  db: SupabaseClient | null;
  client: DiyClient;
  /** The member pressing, for the log. */
  member: string;
  action: OnDemandAction;
  /** Run `fn` after the response (a drafted example). */
  defer?: boolean;
  /** `after` from next/server; required with `defer`. */
  after?: (task: () => Promise<void>) => void;
  now?: () => number;
};

export type OnDemandAnswer<T> =
  | { ok: true; deferred: false; value: T }
  | { ok: true; deferred: true }
  | { ok: false; code: RefusalCode; words: string };

/** The allowance each action draws on. A logged site has none of its own: the door's daily count and the month budget bound it. */
export const ACTION_ALLOWANCE: Record<OnDemandAction, AllowanceKey | null> = {
  page_check: "page_checks",
  example: "examples",
  verify: "link_checks",
  link_check: "link_checks",
  log: null,
};

/** Each action's door and the largest read it makes, for the preflight. An example's input is about 11k tokens (section 5.3). */
export const ACTION_READ: Record<OnDemandAction, { door: Door; estimate: number }> = {
  page_check: { door: "onpage", estimate: DFS_PRICES.instantPagesJs },
  example: { door: "model", estimate: modelEstimate(11_000 * 3) },
  verify: { door: "onpage", estimate: DFS_PRICES.contentParsing },
  link_check: { door: "onpage", estimate: DFS_PRICES.contentParsing },
  log: { door: "onpage", estimate: DFS_PRICES.contentParsing },
};

/** The actions whose first step is a free own fetch, with a paid `content_parsing` fallback (spec 10 sections 3.6 and 4.8). */
export const FREE_FIRST: Record<OnDemandAction, boolean> = {
  page_check: false,
  example: false,
  verify: true,
  link_check: true,
  log: true,
};

/** How long an inline action may take, and a deferred one (the pages route's maxDuration is 180). */
export const INLINE_MS = 25_000;
export const DEFERRED_MS = 170_000;

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Whether a tracking run is reading now. Throws when it cannot be told. */
export async function trackingRunning(db: SupabaseClient, now: number): Promise<boolean> {
  const { data, error } = await db.from("tracking_runs").select("id, status, started_at").eq("status", "running").limit(50);
  if (error) throw new Error(`could not read the tracking runs: ${error.message}`);
  return ((data ?? []) as { status: string; started_at: string | null }[]).some((r) => !runIsStalled(r, now));
}

function refused<T>(code: RefusalCode, client: DiyClient, now: number, allowanceLine?: string | null): OnDemandAnswer<T> {
  return { ok: false, code, words: refusalWords(code, { resets: allowanceMonth(client.market, now).resetsLabel, allowanceLine }) };
}

export async function runOnDemand<T>(input: OnDemandInput, fn: (ctx: ReadCtx) => Promise<T>): Promise<OnDemandAnswer<T>> {
  const now = input.now ?? Date.now;
  const at = now();
  if (input.defer && !input.after) throw new Error("a deferred on-demand action needs after() from next/server");
  const key = ACTION_ALLOWANCE[input.action];
  const freeFirst = FREE_FIRST[input.action];
  const deadlineMs = at + (input.defer ? DEFERRED_MS : INLINE_MS);
  // One reservation decided at a time across everything this action reads (ctx.ts `ledger`).
  const runtime = { now, sleep: realSleep, reads: pool(4), models: pool(1), ledger: pool(1) };
  const fields = { client: input.client, trigger: "on_demand" as const, action: input.action, deadlineMs };

  // 0. The client is not active.
  if (input.client.status !== "active") {
    console.log(`[diy] on-demand ${input.action} for ${input.client.domain} by ${input.member} refused: the client is ${input.client.status}`);
    return refused("client_inactive", input.client, at);
  }

  /**
   * A step refused. True: refuse the action. A free-first action is not
   * refused: the first such refusal is kept for its paid fallback, and the
   * later steps are not read.
   */
  let preRefusal: Refusal | null = null;
  const stop = (refusal: Refusal): boolean => {
    if (!freeFirst) return true;
    preRefusal ??= refusal;
    return false;
  };

  // The fixture: the state decides; nothing is read or reserved.
  if (diyFixtureState() !== null) {
    const state = diyFixtureState()!;
    if (state === "dark" && stop({ code: "disabled", reason: "the fixture is dark" })) return refused("disabled", input.client, at);
    if (key) {
      const fx = readDiyFixture<CoreFixture>("core");
      const used =
        key === "page_checks" || key === "link_checks" ? countLedger(fx.reads, key) : (fx.counts[key as Exclude<UsageKey, "page_checks" | "link_checks">] ?? 0);
      const line = usedUpLine(key, used, input.client, at);
      if (room(key, used, input.client).out && stop({ code: "allowance", reason: "the fixture's allowance is used" })) return refused("allowance", input.client, at, line);
    }
    const ctx = mintReadCtx(fields, { ...runtime, db: null as unknown as SupabaseClient, fixture: true, preRefusal });
    return finish(ctx);
  }

  const db = input.db;
  if (!db) return refused("ledger_unreadable", input.client, at);
  const unreadable = (err: unknown): Refusal => {
    console.warn(`[diy] on-demand ${input.action}: ${msg(err)}`);
    return { code: "ledger_unreadable", reason: msg(err) };
  };

  // 1. A tracking run is reading.
  try {
    if (await trackingRunning(db, at)) {
      if (stop({ code: "tracking_running", reason: "a tracking run is running" })) return refused("tracking_running", input.client, at);
    }
  } catch (err) {
    if (stop(unreadable(err))) return refused("ledger_unreadable", input.client, at);
  }

  // 2. The allowance.
  let allowanceOut = false;
  let allowanceLine: string | null = null;
  if (key && !preRefusal) {
    try {
      const used = await countUsage(db, input.client, key as UsageKey, at);
      allowanceOut = room(key, used, input.client).out;
      allowanceLine = usedUpLine(key, used, input.client, at);
    } catch (err) {
      if (stop(unreadable(err))) return refused("ledger_unreadable", input.client, at);
    }
  }

  // 3. The caps, at the action's largest read.
  if (!preRefusal) {
    let refusal: Refusal | null = null;
    try {
      const [settings, spend] = await Promise.all([readDiySettings(db), readDiySpend(db, input.client.id, utcDayStart(at), allowanceMonth(input.client.market, at).start)]);
      const read = ACTION_READ[input.action];
      refusal = decideReservation({
        settings,
        door: read.door,
        trigger: "on_demand",
        estimate: read.estimate,
        trial: input.client.trial,
        spend,
        allowance: key ? { out: allowanceOut } : undefined,
      });
    } catch (err) {
      refusal = unreadable(err);
    }
    if (refusal) {
      console.log(`[diy] on-demand ${input.action} for ${input.client.domain} by ${input.member} ${freeFirst ? "runs free only" : "refused"}: ${refusal.reason}`);
      if (stop(refusal)) return refused(refusal.code, input.client, at, allowanceLine);
    }
  }

  const ctx = mintReadCtx(fields, { ...runtime, db, fixture: false, preRefusal });
  return finish(ctx);

  async function finish(ctx: ReadCtx): Promise<OnDemandAnswer<T>> {
    if (input.defer) {
      input.after!(async () => {
        try {
          await fn(ctx);
        } catch (err) {
          console.warn(`[diy] on-demand ${input.action} for ${input.client.domain} failed: ${msg(err)}`);
        }
      });
      return { ok: true, deferred: true };
    }
    return { ok: true, deferred: false, value: await fn(ctx) };
  }
}
