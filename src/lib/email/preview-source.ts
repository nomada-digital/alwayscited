import "server-only";

import { TRACKED_PRICE } from "@/config/pricing";
import { dashOrigin } from "@/lib/dash/host";
import {
  type CustomerEmail,
  firstReading,
  invite,
  linksFor,
  loginLink,
  paymentFailed,
  planEnded,
  type Rendered,
  setupConfirmed,
  setupReminder,
  thisWeek,
  trialEnding,
  trialMidpoint,
  trialTerms,
  welcome,
} from "@/lib/email/lifecycle";
import { trialRecap } from "@/lib/email/lifecycle-schedule";
import { clientMail } from "@/lib/email/merge-source";
import { clusterPrompts, firstReadingFigures, focusCluster, setupStatus, trialFigures, upsellAllowed, weekFigures, workThisMonth } from "@/lib/email/merge";
import { thisWeekContent } from "@/lib/email/this-week-source";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { formatDay } from "@/lib/tracking/figures";
import { PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { firstAsked } from "@/lib/tracking/setup-landing";

/**
 * /admin/emails on a real client (brief item 2e, 18 Oct 2026): all twelve
 * customer emails rendered for one client domain, from the same readers the
 * send sites use (merge-source.ts, this-week-source.ts), so what Danny
 * approves is what the client would get. Reads only; sends nothing. Where an
 * email needs an event that has not happened to this client - a trial end, a
 * failed payment - the client's own columns are used when they exist, and
 * otherwise the moment is today, which the page says.
 */
export type ClientPreview = { slug: string; domain: string; mails: Record<CustomerEmail, Rendered>; notes: string[] };

const live = (r: { stopped_on: string | null }) => r.stopped_on === null;

export async function customerEmailsFor(key: string): Promise<ClientPreview | null> {
  const db = supabaseAdmin();
  const k = key.trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(k)) return null;
  const { data: rows, error } = await db.from("client_domains").select("id, slug, domain").or(`slug.eq.${k},domain.eq.${k}`).not("slug", "is", null).limit(1);
  if (error || !rows?.length) return null;
  const row = rows[0]!;
  const m = await clientMail(row.id as string, db);
  if (!m) return null;
  const notes: string[] = [];
  const raw = m.raw;
  const c = raw.client;
  const origin = dashOrigin();
  const links = linksFor(m.slug, origin);
  const now = Date.now();
  const today = trackingDay(new Date(now));
  const settings = links.settings;
  const domain = m.domain;

  // The payment columns may predate BL-2's migration; an owner may be missing. Either failure is said on the page.
  const { data: extra, error: payErr } = await db.from("client_domains").select("payment_retry_at, payment_invoice_url").eq("id", c.id).maybeSingle();
  if (payErr) notes.push(`The payment columns were not read: ${payErr.message}`);
  const { data: owner, error: ownerErr } = await db.from("dashboard_members").select("email").eq("account_id", m.accountId).eq("role", "owner").is("removed_at", null).limit(1);
  if (ownerErr) notes.push(`The account's owner was not read: ${ownerErr.message}`);

  const clusters = raw.clusters.filter(live);
  const prompts = raw.prompts.filter((p) => live(p) && p.allowance !== "placement");
  const withPrompts = new Set(prompts.map((p) => p.cluster_id).filter((id): id is string => !!id && clusters.some((x) => x.id === id))).size;
  const focus = focusCluster(raw, m.forms);
  const first = firstReadingFigures(raw);
  if (!first) notes.push("No reading yet: first_reading shows 0 of 0, and the blocks that need a reading are hidden.");
  const liveKw = raw.keywords.filter(live);
  const latestSerp = new Map<string, number | null>();
  for (const s of [...raw.serp].sort((a, b) => a.run_date.localeCompare(b.run_date))) latestSerp.set(s.keyword_id, s.position);
  const page1 = liveKw.filter((kw) => {
    const p = latestSerp.get(kw.id);
    return typeof p === "number" && p <= 10;
  }).length;

  const endsAt = c.trial_ends_at ?? new Date(now + 14 * 86_400_000).toISOString();
  if (!c.trial_ends_at) notes.push("Not on a trial: the trial emails use a trial ending 14 days from now.");
  const trial = trialTerms({ endsAt, market: c.market, price: TRACKED_PRICE, billing: links.plan });
  const answerDays = [...new Set(raw.answers.map((a) => a.run_date))].sort();
  const recap = trialRecap({
    rows: raw.answers.map((a) => ({ run_date: a.run_date, question_id: a.question_id, engine: a.engine, answered: a.answered, named: a.named, brands: (a.brands ?? []).map(String) })),
    firstDay: answerDays[0] ?? null,
    today,
    you: m.brand,
    clustersInUse: clusters.length,
    clusterLimit: c.cluster_limit,
    livePrompts: prompts.length,
    firstAsk: firstAsked({ today, startedOn: c.started_on, market: c.market, now }),
  });
  const tf = trialFigures(raw);

  let weekMail: Rendered;
  try {
    const content = await thisWeekContent({ id: c.id, domain, brand: m.brand, market: c.market, tier: m.tier, startedOn: c.started_on }, today);
    weekMail = thisWeek({
      tier: m.tier,
      domain,
      weekOf: today,
      items: content.items,
      changes: content.changes,
      link: `${links.dashboard}/plan`,
      week: weekFigures(raw),
      focus,
      work: workThisMonth(raw),
      settings,
      unsubscribe: `${origin}/api/dash/unsubscribe?t=preview-only`,
    });
  } catch (err) {
    notes.push(`This week's actions could not be read: ${err instanceof Error ? err.message : String(err)}`);
    weekMail = thisWeek({ tier: m.tier, domain, weekOf: today, items: [], changes: { state: "unread" }, link: `${links.dashboard}/plan`, week: weekFigures(raw), focus, work: workThisMonth(raw), settings });
  }

  const retry = typeof extra?.payment_retry_at === "string" ? formatDay(extra.payment_retry_at.slice(0, 10), true) : null;
  const mails: Record<CustomerEmail, Rendered> = {
    login_link: loginLink({ link: `${origin}/auth?token=preview-only` }),
    trial_started: welcome({ tier: "tracked", clusters: 1, clusterLimit: c.cluster_limit, domain, link: links.setup, trial, market: c.market, startedOn: c.started_on, engines: m.engines, prompts: prompts.length, settings }),
    welcome: welcome({ tier: m.tier, clusters: Math.max(1, clusters.length), clusterLimit: c.cluster_limit, domain, link: links.setup, market: c.market, startedOn: c.started_on, engines: m.engines, prompts: prompts.length, settings }),
    setup_reminder: setupReminder({ tier: m.tier, domain, link: links.setup, withPrompts, clusterLimit: c.cluster_limit, status: setupStatus(raw, m.forms, PROMPTS_PER_CLUSTER), firstAsk: withPrompts ? null : firstAsked({ today, startedOn: c.started_on, market: c.market, now }), settings }),
    setup_confirmed: setupConfirmed({ tier: m.tier, clusters: clusters.map((x) => x.name), link: links.dashboard, market: c.market, today, startedOn: c.started_on, livePrompts: prompts.length, now, domain, focus, prompts: focus ? clusterPrompts(raw, focus.clusterId) : [], engines: m.engines, settings }),
    first_reading: firstReading({ tier: m.tier, domain, named: first?.named ?? 0, answers: first?.answers ?? 0, page1, keywords: liveKw.length, link: links.dashboard, figures: first, focus, upsell: upsellAllowed({ tier: m.tier, mode: m.mode, clientFacing: false }), settings }),
    this_week: weekMail,
    invite: invite({ domain, brand: m.brand, link: links.dashboard, inviter: (owner?.[0]?.email as string | undefined) ?? "the account owner", role: "viewer", agency: m.mode === "agency" ? m.agency : null, engines: m.engines, settings }),
    trial_midpoint: trialMidpoint({ domain, link: links.dashboard, recap, trial, figures: tf, settings }),
    trial_ending: trialEnding({ domain, link: links.dashboard, recap, trial, figures: tf, settings }),
    payment_failed: paymentFailed({ domain, amount: null, failedOn: formatDay(today, true), retryOn: retry, invoice: typeof extra?.payment_invoice_url === "string" ? extra.payment_invoice_url : null, plan: links.plan }),
    plan_ended: planEnded({ tier: m.tier, domain, billing: links.plan, endedOn: formatDay(today, true), settings }),
  };
  if (!retry) notes.push("No failed payment on record: payment_failed is dated today, with no retry date or invoice amount.");
  return { slug: m.slug, domain, mails, notes };
}
