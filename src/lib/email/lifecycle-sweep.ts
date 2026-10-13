import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../supabase/page.ts";
import { upsellMode } from "../tracking/ask.ts";
import { trackingDay } from "../tracking/decide.ts";
import type { AnswerRow } from "../tracking/figures.ts";
import { CLUSTER_BASE } from "../tracking/limits.ts";
import { SETUP_CONFIRMED_EVENT, firstAsked } from "../tracking/setup-landing.ts";
import type { TierKey } from "../tier-text.ts";
import { actionsUrl, billingUrl, dashboardUrl, type Rendered, setupReminder, setupUrl, thisWeek, trialEnding, trialMidpoint, trialTerms } from "./lifecycle.ts";
import { lifecycleOn } from "./lifecycle-flag.ts";
import { SETUP_MAIL_EVENTS, SETUP_WINDOW_MS, TRIAL_MAIL_EVENT, type TrialMail, setupReminderDue, setupStillEmpty, thisWeekDue, thisWeekEvent, trialEndingOnStripe, trialMailDue, trialRecap, unsentEvent } from "./lifecycle-schedule.ts";
import { type ThisWeekChanges, type ThisWeekItem, worthSending } from "./this-week-mail.ts";
import { weekRecipients } from "./week-recipients.ts";
import { zoneDay } from "../tracking/check-time.ts";

/**
 * The lifecycle emails the daily cron sends (8 Oct 2026, audit activation-1):
 * trial_midpoint and trial_ending to a running trial's owners, and
 * setup_reminder 24 and 72 hours after a checkout signup whose setup is
 * unconfirmed. lifecycle-schedule.ts decides which is due; this reads the
 * rows, sends, and records.
 *
 * Bounded three ways. Each email asks its own email_<name>_enabled flag
 * first, and every flag ships false, so this reads nothing until Danny turns
 * one on. Each goes once per client: the dashboard_events row is written
 * before the send (claimed), and a recorded one is never picked again. And
 * only live owners are mailed (removed_at null), never in agency mode - the
 * emails name alwayscited and the tier, as first_reading does.
 *
 * Never fatal: the cron's dispatch has already run, and a failed client is
 * logged and left for tomorrow.
 *
 * Loadable by node --test since 8 Oct 2026 (review of 7e133a7): no
 * server-only, relative imports, and the sender, origin and price come in as
 * `io`. lifecycle-cron.ts passes the live ones (sendLifecycle, siteUrl(),
 * TRACKED_PRICE); lifecycle-sweep.test.mts runs every rule here against an
 * in-memory database with a recording sender.
 */

/** What the sweep sends with: the sender, the origin its links are built on, and the alwaystracked price trialCharge words. */
export type SweepIo = {
  send: (input: { memberEmail: string; mail: Rendered }) => Promise<boolean>;
  origin: string;
  price: { us: number; uk: number };
  /**
   * 13 Oct 2026, DIY P9: the This week email's content for one client - the week's Actions items and Since last
   * check's top lines - read by the server (this-week-source.ts, through the Overview's own readers), handed in
   * as the sender is so node --test runs the sweep on a fake. None, and no This week email is built.
   */
  thisWeek?: (c: ThisWeekClient, today: string) => Promise<{ items: ThisWeekItem[]; changes: ThisWeekChanges }>;
};

/** What the This week source reads a client by. */
export type ThisWeekClient = { id: string; domain: string; brand: string; market: string; tier: TierKey; startedOn: string | null };

type Client = {
  id: string;
  account_id: string;
  domain: string;
  brand_name: string | null;
  market: string;
  slug: string;
  status: string | null;
  tier: string | null;
  cluster_limit: number | null;
  trial_ends_at: string | null;
  trial_cancelled_at: string | null;
  started_on: string | null;
};
const CLIENT_COLUMNS = "id, account_id, domain, brand_name, market, slug, status, tier, cluster_limit, trial_ends_at, trial_cancelled_at, started_on";

const SWEPT_EVENTS = [...Object.values(TRIAL_MAIL_EVENT), ...SETUP_MAIL_EVENTS, SETUP_CONFIRMED_EVENT];

export type SweepResult = { sent: string[]; unsent: string[]; errors: string[] };

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** Each client's recorded events among the ones this sweep reads. */
async function eventsFor(db: SupabaseClient, ids: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!ids.length) return out;
  const rows = await selectAll<{ client_domain_id: string; event: string }>((from, to) =>
    db.from("dashboard_events").select("client_domain_id, event").in("client_domain_id", ids).in("event", SWEPT_EVENTS).order("id", { ascending: true }).range(from, to),
  );
  for (const r of rows) {
    const s = out.get(r.client_domain_id) ?? new Set<string>();
    s.add(r.event);
    out.set(r.client_domain_id, s);
  }
  return out;
}

/** Account ids in agency mode, whose clients get none of these. */
async function agencyAccounts(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await db.from("accounts").select("id, upsell_mode").in("id", ids);
  if (error) throw new Error(`could not read the accounts: ${error.message}`);
  return new Set((data ?? []).filter((a) => upsellMode(a.upsell_mode) === "agency").map((a) => a.id as string));
}

/** Live clusters (as Settings counts them), live prompts, and live clusters with a live prompt. */
async function liveCounts(db: SupabaseClient, clientId: string): Promise<{ clusters: number; prompts: number; withPrompts: number }> {
  const [{ data: cl, error: cErr }, { data: qs, error: qErr }] = await Promise.all([
    db.from("tracked_clusters").select("id").eq("client_domain_id", clientId).is("stopped_on", null),
    db.from("tracked_questions").select("cluster_id").eq("client_domain_id", clientId).is("stopped_on", null),
  ]);
  if (cErr) throw new Error(`could not read the clusters: ${cErr.message}`);
  if (qErr) throw new Error(`could not read the prompts: ${qErr.message}`);
  const live = new Set((cl ?? []).map((c) => c.id as string));
  const withPrompts = new Set((qs ?? []).map((q) => q.cluster_id as string | null).filter((id): id is string => id !== null && live.has(id))).size;
  return { clusters: live.size, prompts: (qs ?? []).length, withPrompts };
}

/** trial_midpoint or trial_ending for one client, with the trial so far in the Overview's figures. */
async function trialMail(db: SupabaseClient, io: SweepIo, c: Client, name: TrialMail, now: number): Promise<Rendered> {
  const today = trackingDay(new Date(now));
  const { data: first, error: fErr } = await db
    .from("tracking_runs")
    .select("run_date")
    .eq("client_domain_id", c.id)
    .in("status", ["complete", "partial"])
    .order("run_date", { ascending: true })
    .limit(1);
  if (fErr) throw new Error(`could not read the runs: ${fErr.message}`);
  const firstDay = (first?.[0]?.run_date as string | undefined) ?? null;
  const rows = firstDay
    ? (
        await selectAll<Record<string, unknown>>((from, to) =>
          db
            .from("tracking_answers")
            .select("run_date, question_id, engine, answered, named, brands")
            .eq("client_domain_id", c.id)
            .gte("run_date", firstDay)
            .lte("run_date", today)
            .order("id", { ascending: true })
            .range(from, to),
        )
      ).map(
        (a): AnswerRow => ({
          run_date: a.run_date as string,
          question_id: a.question_id as string,
          engine: a.engine as string,
          answered: a.answered === true,
          named: a.named === true,
          brands: Array.isArray(a.brands) ? (a.brands as unknown[]).filter((b): b is string => typeof b === "string") : [],
        }),
      )
    : [];
  const live = await liveCounts(db, c.id);
  // L3 (12 Oct 2026, email review): with nothing set up, when prompts saved now are first asked, in the client's zone.
  const firstAsk = firstAsked({ today, startedOn: c.started_on ?? null, market: c.market, now });
  const recap = trialRecap({ rows, firstDay, today, you: c.brand_name ?? c.domain, clustersInUse: live.clusters, clusterLimit: c.cluster_limit ?? CLUSTER_BASE, livePrompts: live.prompts, firstAsk });
  const trial = trialTerms({ endsAt: c.trial_ends_at!, market: c.market, price: io.price, billing: billingUrl(c.slug, io.origin) });
  const d = { domain: c.domain, link: dashboardUrl(c.slug, io.origin), recap, trial };
  return name === "trial_midpoint" ? trialMidpoint(d) : trialEnding(d);
}

/**
 * Claim, send to the live owners, and keep the claim only if one was mailed.
 * "taken" when another run's claim got there first (the unique index), or
 * there is no owner to mail.
 */
async function deliver(db: SupabaseClient, io: SweepIo, c: Client, event: string, mail: Rendered): Promise<"sent" | "unsent" | "taken"> {
  const { data: owners, error: oErr } = await db.from("dashboard_members").select("email").eq("account_id", c.account_id).eq("role", "owner").is("removed_at", null);
  if (oErr) throw new Error(`could not read the owners: ${oErr.message}`);
  if (!owners?.length) return "taken";
  const { data: claim, error: cErr } = await db.from("dashboard_events").insert({ client_domain_id: c.id, member_email: null, event, path: null, props: {} }).select("id").single();
  if (cErr) {
    if (cErr.code === "23505") return "taken";
    throw new Error(`could not record ${event}: ${cErr.message}`);
  }
  let mailed = 0;
  for (const m of owners) if (await io.send({ memberEmail: m.email as string, mail })) mailed++;
  if (mailed) return "sent";
  // Nobody was mailed: the row leaves the sent set (and the unique index), so tomorrow tries again.
  const { error: uErr } = await db.from("dashboard_events").update({ event: unsentEvent(event) }).eq("id", claim.id as number);
  if (uErr) console.warn(`[mail] ${event} for ${c.id} not sent, and its claim not released: ${uErr.message}`);
  return "unsent";
}

/**
 * The This week claim and send (13 Oct 2026, DIY P9), as deliver does it for the owners' emails: the
 * dashboard_events row is written before the send, a claim another run holds (the unique index) is "taken",
 * and a send that reached nobody releases its row for the next run.
 */
async function deliverWeek(db: SupabaseClient, io: SweepIo, c: Client, event: string, mail: Rendered): Promise<"sent" | "unsent" | "taken"> {
  const to = await weekRecipients(db, c.account_id, c.id);
  if (!to.length) return "taken";
  const { data: claim, error: cErr } = await db.from("dashboard_events").insert({ client_domain_id: c.id, member_email: null, event, path: null, props: {} }).select("id").single();
  if (cErr) {
    if (cErr.code === "23505") return "taken";
    throw new Error(`could not record ${event}: ${cErr.message}`);
  }
  let mailed = 0;
  for (const email of to) if (await io.send({ memberEmail: email, mail })) mailed++;
  if (mailed) return "sent";
  const { error: uErr } = await db.from("dashboard_events").update({ event: unsentEvent(event) }).eq("id", claim.id as number);
  if (uErr) console.warn(`[mail] ${event} for ${c.id} not sent, and its claim not released: ${uErr.message}`);
  return "unsent";
}

export async function sweepLifecycleMail(db: SupabaseClient, io: SweepIo, now: number = Date.now()): Promise<SweepResult> {
  const out: SweepResult = { sent: [], unsent: [], errors: [] };
  const on: Record<TrialMail | "setup_reminder" | "this_week", boolean> = {
    trial_midpoint: await lifecycleOn(db, "trial_midpoint"),
    trial_ending: await lifecycleOn(db, "trial_ending"),
    setup_reminder: await lifecycleOn(db, "setup_reminder"),
    this_week: await lifecycleOn(db, "this_week"),
  };
  if (!on.trial_midpoint && !on.trial_ending && !on.setup_reminder && !on.this_week) return out;
  // 13 Oct 2026, DIY P9: the Monday This week email, before and apart from the owners' emails below.
  if (on.this_week) {
    try {
      await sweepThisWeek(db, io, now, out);
    } catch (err) {
      out.errors.push(`this_week: ${msg(err)}`);
    }
  }
  if (!on.trial_midpoint && !on.trial_ending && !on.setup_reminder) return out;

  const trials: Client[] = [];
  if (on.trial_midpoint || on.trial_ending) {
    const { data, error } = await db
      .from("client_domains")
      .select(CLIENT_COLUMNS)
      .eq("status", "active")
      .not("trial_ends_at", "is", null)
      .is("trial_cancelled_at", null)
      .gt("trial_ends_at", new Date(now).toISOString());
    if (error) throw new Error(`could not read the trial clients: ${error.message}`);
    trials.push(...((data ?? []) as Client[]));
  }

  // A setup reminder is for a checkout signup in its first week: its earliest order is when it signed up.
  const signedUp = new Map<string, string>();
  const setups: Client[] = [];
  if (on.setup_reminder) {
    const { data: orders, error } = await db
      .from("orders")
      .select("client_domain_id, created_at")
      .not("client_domain_id", "is", null)
      .gte("created_at", new Date(now - SETUP_WINDOW_MS).toISOString());
    if (error) throw new Error(`could not read the orders: ${error.message}`);
    for (const o of orders ?? []) {
      const id = o.client_domain_id as string;
      const at = o.created_at as string;
      if (!signedUp.has(id) || at < signedUp.get(id)!) signedUp.set(id, at);
    }
    if (signedUp.size) {
      const { data, error: cErr } = await db.from("client_domains").select(CLIENT_COLUMNS).in("id", [...signedUp.keys()]).eq("status", "active");
      if (cErr) throw new Error(`could not read the new clients: ${cErr.message}`);
      setups.push(...((data ?? []) as Client[]));
    }
  }

  const all = [...trials, ...setups];
  if (!all.length) return out;
  const events = await eventsFor(db, [...new Set(all.map((c) => c.id))]);
  const agency = await agencyAccounts(db, [...new Set(all.map((c) => c.account_id))]);
  const none = new Set<string>();

  for (const c of trials) {
    if (agency.has(c.account_id)) continue;
    const due = trialMailDue({ status: c.status, trialEndsAt: c.trial_ends_at, cancelledAt: c.trial_cancelled_at, sent: events.get(c.id) ?? none, now });
    if (!due || !on[due]) continue;
    try {
      const r = await deliver(db, io, c, TRIAL_MAIL_EVENT[due], await trialMail(db, io, c, due, now));
      if (r !== "taken") out[r].push(`${due} ${c.id}`);
    } catch (err) {
      out.errors.push(`${due} ${c.id}: ${msg(err)}`);
    }
  }

  for (const c of setups) {
    if (agency.has(c.account_id)) continue;
    const sent = events.get(c.id) ?? none;
    const due = setupReminderDue({ status: c.status, signedUpAt: signedUp.get(c.id)!, confirmed: sent.has(SETUP_CONFIRMED_EVENT), sent, now });
    if (!due) continue;
    try {
      const live = await liveCounts(db, c.id);
      const clusterLimit = c.cluster_limit ?? CLUSTER_BASE;
      // Every cluster already has prompts: the reminder would say "0 of your 10 are still empty" (review of 7e133a7).
      if (!setupStillEmpty({ withPrompts: live.withPrompts, clusterLimit })) continue;
      const tier = (["tracked", "mentioned", "cited", "everywhere"].includes(c.tier ?? "") ? c.tier : "tracked") as TierKey;
      const mail = setupReminder({ tier, domain: c.domain, link: setupUrl(c.slug, io.origin), withPrompts: live.withPrompts, clusterLimit });
      const r = await deliver(db, io, c, due, mail);
      if (r !== "taken") out[r].push(`${due} ${c.id}`);
    } catch (err) {
      out.errors.push(`${due} ${c.id}: ${msg(err)}`);
    }
  }
  return out;
}

/**
 * The Monday "This week" email (13 Oct 2026, DIY P9; spec 10 section 7.10), behind email_this_week_enabled,
 * which ships false. On the Monday of each active client's own zone, to the live owners and editors who can see
 * it, never in agency mode (HANDOVER item 5: the agency-mode email question is Danny's), once per client per
 * Monday. A week with no item and no change is not mailed. Without a content source (io.thisWeek) nothing is
 * built. Each client's failure is its own: logged, and the rest still go.
 */
async function sweepThisWeek(db: SupabaseClient, io: SweepIo, now: number, out: SweepResult): Promise<void> {
  if (!io.thisWeek) return;
  const clients = await selectAll<Client>((from, to) => db.from("client_domains").select(CLIENT_COLUMNS).eq("status", "active").order("id", { ascending: true }).range(from, to));
  if (!clients.length) return;
  // This Monday's claim for each client, by the day in its own zone.
  const due = new Map(clients.map((c) => [c.id, thisWeekEvent(zoneDay(now, c.market))] as const));
  const { data: claimed, error } = await db.from("dashboard_events").select("client_domain_id, event").in("client_domain_id", [...due.keys()]).in("event", [...new Set(due.values())]);
  if (error) throw new Error(`could not read this week's claims: ${error.message}`);
  const sent = new Map<string, Set<string>>();
  for (const r of claimed ?? []) sent.set(r.client_domain_id as string, (sent.get(r.client_domain_id as string) ?? new Set<string>()).add(r.event as string));
  const agency = await agencyAccounts(db, [...new Set(clients.map((c) => c.account_id))]);
  const today = trackingDay(new Date(now));
  for (const c of clients) {
    if (agency.has(c.account_id)) continue;
    const event = thisWeekDue({ status: c.status, market: c.market, sent: sent.get(c.id) ?? new Set<string>(), now });
    if (!event) continue;
    try {
      const tier = (["tracked", "mentioned", "cited", "everywhere"].includes(c.tier ?? "") ? c.tier : "tracked") as TierKey;
      const content = await io.thisWeek({ id: c.id, domain: c.domain, brand: c.brand_name ?? c.domain, market: c.market, tier, startedOn: c.started_on }, today);
      const data = { tier, domain: c.domain, weekOf: event.slice(-10), items: content.items, changes: content.changes, link: actionsUrl(c.slug, io.origin) };
      if (!worthSending(data)) continue;
      const r = await deliverWeek(db, io, c, event, thisWeek(data));
      if (r !== "taken") out[r].push(`this_week ${c.id}`);
    } catch (err) {
      out.errors.push(`this_week ${c.id}: ${msg(err)}`);
    }
  }
}

/**
 * Stripe's customer.subscription.trial_will_end, three days before a trial
 * ends: trial_ending's fallback trigger, for a day the cron misses. False
 * only when a read failed, so Stripe retries; a send that reached nobody is
 * released for the cron to try.
 */
export async function mailTrialEnding(db: SupabaseClient, io: SweepIo, clientId: string, now: number = Date.now()): Promise<boolean> {
  try {
    if (!(await lifecycleOn(db, "trial_ending"))) return true;
    const { data, error } = await db.from("client_domains").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
    if (error) throw new Error(`could not read the client: ${error.message}`);
    const c = data as Client | null;
    if (!c) return true;
    if ((await agencyAccounts(db, [c.account_id])).has(c.account_id)) return true;
    const sent = (await eventsFor(db, [c.id])).get(c.id) ?? new Set<string>();
    if (!trialEndingOnStripe({ status: c.status, trialEndsAt: c.trial_ends_at, cancelledAt: c.trial_cancelled_at, sent, now })) return true;
    const r = await deliver(db, io, c, TRIAL_MAIL_EVENT.trial_ending, await trialMail(db, io, c, "trial_ending", now));
    if (r === "unsent") console.warn(`[mail] trial_ending for ${clientId} reached nobody; the cron tries again`);
    return true;
  } catch (err) {
    console.error(`[mail] trial_ending for ${clientId} not sent: ${msg(err)}`);
    return false;
  }
}

/**
 * plan_ended's recipients (moved here from checkout/signup.ts on 8 Oct 2026,
 * review of 7e133a7, so the rule has a behaviour test): the live owners, and
 * none outside upsell mode nomada - the email sends the owner to Billing to
 * ask us to restart, and only nomada mode has Ask us there, as the ended
 * banner decides - or when a read failed.
 */
export async function planEndedOwners(db: SupabaseClient, accountId: string): Promise<{ email: unknown }[]> {
  const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode").eq("id", accountId).maybeSingle();
  if (aErr) console.error(`[stripe] plan_ended not sent, account not read: ${aErr.message}`);
  if (aErr || upsellMode(account?.upsell_mode) !== "nomada") return [];
  const { data: owners, error: oErr } = await db.from("dashboard_members").select("email").eq("account_id", accountId).eq("role", "owner").is("removed_at", null);
  if (oErr) console.error(`[stripe] plan_ended not sent, owners not read: ${oErr.message}`);
  return owners ?? [];
}
