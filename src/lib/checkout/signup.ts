import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { siteUrl } from "@/lib/scan/verify-email";
import { dashOrigin } from "@/lib/dash/host";
import { sendOrderEmail } from "@/lib/checkout/order-mail";
import { clustersToMake, orderEmailText, orderRow, packsOn, signupMarket, signupResume, trialCancelPending, trialConverted, trialEndsAtAfter, trialStillRunning, type CompletedOrder } from "@/lib/checkout/webhook";
import { livePacks } from "@/lib/checkout/packs";
import { readSubscription } from "@/lib/checkout/stripe";
import { afterSubscription } from "@/lib/checkout/payment";
import { clientOfSubscription, recordPayment } from "@/lib/checkout/subscription-events";
import { recordTrialCancel } from "@/lib/checkout/trial-cancel";
import { siteFacts } from "@/lib/scan/anthropic";
import { fillStarters, type StarterInput } from "@/lib/tracking/starter";
import { TRACKED_PRICE } from "@/config/pricing";
import { trialCharge, trialMoment } from "@/config/trial";
import { dayAfter, slugFor, trackingDay } from "@/lib/tracking/decide";
import { angleFor, CLUSTER_BASE, clusterLimitFor, insertCluster, insertKeyword, insertPrompts, namesBrandIn, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { promptKey } from "@/lib/tracking/prompt-text";
import { billingUrl, planEnded, trialTerms, welcome } from "@/lib/email/lifecycle";
import { lifecycleOn, sendLifecycle } from "@/lib/email/lifecycle-mail";
import { lifecycleIo } from "@/lib/email/lifecycle-cron";
import { planEndedInTrial } from "@/lib/email/lifecycle-schedule";
import { mailTrialEnding, planEndedOwners } from "@/lib/email/lifecycle-sweep";
import type { TierKey } from "@/lib/tier-text";
import { sendLoginLink } from "@/lib/tracking/login-mail";
import { LOGIN_TTL_MS, hashToken, newToken } from "@/lib/tracking/session";

/**
 * What the Stripe webhook writes (BRIEF-3 C4, 30 Sep 2026). Each returns
 * false only when Stripe should retry; the route then forgets the event id.
 *
 * checkout.session.completed with a scan token: the account by email, the
 * client from the scan at the tier bought, the first cluster from the scan's
 * keyword and its first five prompts (or "Needs a keyword" when the scan chose
 * none, R117), the buyer as owner, and a login link. Without a scan, the same
 * from the website the order carries (R158, clientFromOrder below).
 * One public.orders row per Session either way, keyed on its id so a replay
 * writes nothing; a refused row is logged and named in the order email, never
 * a retry, because the client above is already made. The order email goes to
 * Danny either way (pricing spec section 5).
 */

export const NEEDS_A_KEYWORD = "Needs a keyword";
const TIERS = ["tracked", "mentioned", "cited"];

type Scan = {
  id: string;
  domain: string;
  brand_name: string | null;
  topic: string | null;
  positioning: string | null;
  topic_variants: string[] | null;
  site_facts: unknown;
  market: string;
  cluster_keyword: string | null;
  cluster_keyword_volume: number | null;
  cluster_keyword_intent: string | null;
  cluster_keyword_status: string | null;
};

/**
 * Any paid order gets its account, client, clusters, owner and login link
 * (R158, Danny, 1 Oct 2026, danny.md 168): from the scan when the order
 * carries one, else from the website /checkout asked for. A scan only
 * prefills cluster 1; every other cluster bought starts "Needs a keyword".
 * Before this an order without a scan built nothing and the buyer heard nothing.
 */
async function clientFromOrder(db: SupabaseClient, o: CompletedOrder, trialEndsAt: string | null = null): Promise<{ ok: boolean; outcome: string; clientId?: string; starter?: StarterInput }> {
  if (!o.email) return { ok: true, outcome: "no buyer email on the Session, so no client was created" };
  const tier = TIERS.includes(o.tier) ? o.tier : "tracked";

  let scan: Scan | null = null;
  if (o.scanToken) {
    const { data, error: sErr } = await db
      .from("scans")
      .select("id, domain, brand_name, topic, positioning, topic_variants, site_facts, market, status, cluster_keyword, cluster_keyword_volume, cluster_keyword_intent, cluster_keyword_status")
      .eq("public_token", o.scanToken)
      .maybeSingle();
    if (sErr) return { ok: false, outcome: `could not read the scan: ${sErr.message}` };
    if (data && data.status === "complete" && (data.market === "UK" || data.market === "US")) scan = data as Scan;
  }
  // The plan paid for sets the market; a scan from the other market still names the site but prefills nothing (signupMarket).
  const { market, useScan } = signupMarket(o.market, scan?.market ?? null);
  const prefill = useScan ? scan : null;
  const domain = scan ? scan.domain : o.website;
  if (!domain || !market) {
    return {
      ok: true,
      outcome: o.scanToken
        ? "the scan on the order is missing, unfinished or has no market, so no client was created"
        : "no scan and no website on the order, so no client was created",
    };
  }

  // Exact, never ilike (8 Oct 2026, audit security-1): ILIKE reads `_` and `%`
  // as wildcards, so a buyer could be made owner of a stranger's account.
  // o.email is lowercased in completedOrder, and stored emails are lowercase.
  const { data: found, error: aErr } = await db.from("accounts").select("id").eq("email", o.email).maybeSingle();
  if (aErr) return { ok: false, outcome: `could not read accounts: ${aErr.message}` };
  let accountId = found?.id as string | undefined;
  if (!accountId) {
    const { data: made, error: mErr } = await db.from("accounts").insert({ email: o.email }).select("id").single();
    if (mErr) return { ok: false, outcome: `could not create the account: ${mErr.message}` };
    accountId = made.id as string;
  }

  const startedOn = dayAfter(trackingDay());
  const clientRow = {
    account_id: accountId,
    domain,
    brand_name: scan?.brand_name ?? null,
    topic: scan?.topic ?? null,
    market,
    slug: slugFor(domain),
    status: "active",
    tier,
    started_on: startedOn,
    source_scan_id: prefill?.id ?? null,
  };
  let clientId: string;
  // The slug and cluster_limit come back for the welcome's links and the plan's room.
  let made: { slug: string; cluster_limit: number | null } = { slug: clientRow.slug, cluster_limit: null };
  if (clientRow.topic !== null) {
    const { data: client, error: cErr } = await db.from("client_domains").upsert(clientRow, { onConflict: "account_id,domain,topic,market" }).select("id, slug, cluster_limit").single();
    if (cErr) return { ok: false, outcome: `could not create the client: ${cErr.message}` };
    clientId = client.id as string;
    made = client as typeof made;
  } else {
    // A null topic never conflicts in a unique index (nulls are distinct), so a
    // retry would make a second client: look for the first one instead.
    const { data: had, error: hErr } = await db
      .from("client_domains")
      .select("id, slug, cluster_limit")
      .eq("account_id", accountId)
      .eq("domain", domain)
      .eq("market", market)
      .is("topic", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (hErr) return { ok: false, outcome: `could not read the client: ${hErr.message}` };
    if (had?.[0]) {
      clientId = had[0].id as string;
      made = had[0] as typeof made;
    } else {
      const { data: client, error: cErr } = await db.from("client_domains").insert(clientRow).select("id, slug, cluster_limit").single();
      if (cErr) return { ok: false, outcome: `could not create the client: ${cErr.message}` };
      clientId = client.id as string;
      made = client as typeof made;
    }
  }

  const chosen = prefill?.cluster_keyword_status === "chosen" && typeof prefill.cluster_keyword === "string" && prefill.cluster_keyword.trim();
  const clusterName = chosen ? (prefill!.cluster_keyword as string).trim() : NEEDS_A_KEYWORD;

  // A Stripe retry of a signup that failed part way picks up where it stopped (signupResume).
  const { data: prior, error: pErr } = await db
    .from("tracked_clusters")
    .select("id, keyword_id")
    .eq("client_domain_id", clientId)
    .eq("name", clusterName)
    .is("stopped_on", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (pErr) return { ok: false, outcome: `could not read the client's clusters: ${pErr.message}`, clientId };
  let existing: Parameters<typeof signupResume>[0] = null;
  if (prior?.[0]) {
    const { count, error: nErr } = await db.from("tracked_questions").select("id", { count: "exact", head: true }).eq("cluster_id", prior[0].id).is("stopped_on", null);
    if (nErr) return { ok: false, outcome: `could not count the cluster's prompts: ${nErr.message}`, clientId };
    existing = { id: prior[0].id as string, keywordId: (prior[0].keyword_id as string | null) ?? null, livePrompts: count ?? 0 };
  }
  const resume = signupResume(existing);

  let clusterId = resume.clusterId;
  if (!clusterId) {
    const cluster = await insertCluster(db, clientId, { name: clusterName, tier, started_on: startedOn });
    if (!cluster.ok) return { ok: false, outcome: `client made, cluster refused: ${cluster.message}`, clientId };
    clusterId = cluster.ids[0]!;
  }
  if (chosen && resume.keyword) {
    const kw = await insertKeyword(db, clientId, clusterId, {
      keyword: (prefill!.cluster_keyword as string).trim(),
      added_on: startedOn,
      added_by: "nomada",
      search_volume: prefill!.cluster_keyword_volume ?? null,
      intent: prefill!.cluster_keyword_intent ?? null,
    });
    if (!kw.ok) return { ok: false, outcome: `cluster made, keyword refused: ${kw.message}`, clientId };
  }

  let rows: { text: string; angle: string | null; source: string; added_on: string; added_by: string }[] = [];
  if (prefill) {
    const scan = prefill;
    const { data: sq, error: qErr } = await db.from("scan_questions").select("idx, question, kind").eq("scan_id", scan.id).order("idx", { ascending: true });
    if (qErr) return { ok: false, outcome: `could not read the scan's prompts: ${qErr.message}`, clientId };
    // Each prompt keeps its scan kind as its angle (BRIEF-3 C3).
    rows = (sq ?? [])
      .map((q) => ({ text: String(q.question).trim(), angle: angleFor(q.kind) }))
      // A scan prompt naming the brand is left behind: this copies the scan, which measures unprompted naming (R133, limits.ts).
      .filter((q) => q.text.length >= 8 && q.text.length <= 300 && !namesBrandIn(q.text, { brand: scan.brand_name, domain: scan.domain }))
      // One of each (9 Oct 2026): tracked_questions_cluster_live_text_uniq refuses two live prompts with the same text in a
      // cluster, and as one insert it would refuse all five - a paid signup left with no prompts over a repeated scan question.
      .filter((q, i, all) => all.findIndex((o) => promptKey(o.text) === promptKey(q.text)) === i)
      .slice(0, PROMPTS_PER_CLUSTER)
      .map((q) => ({ text: q.text, angle: q.angle, source: "scan", added_on: startedOn, added_by: "nomada" }));
    const prompts = resume.prompts ? await insertPrompts(db, clientId, clusterId, rows) : ({ ok: true } as const);
    if (!prompts.ok) return { ok: false, outcome: `cluster made, prompts refused: ${prompts.message}`, clientId };
  }

  // Every other cluster bought starts "Needs a keyword" (R158); a retry makes only the missing ones.
  const { data: live, error: lErr } = await db.from("tracked_clusters").select("name").eq("client_domain_id", clientId).is("stopped_on", null);
  if (lErr) return { ok: false, outcome: `could not read the client's clusters: ${lErr.message}`, clientId };
  const missing = clustersToMake(tier === "tracked" ? 1 : o.quantity, clusterName, NEEDS_A_KEYWORD, (live ?? []).map((c) => String(c.name)));
  for (const name of missing) {
    const made = await insertCluster(db, clientId, { name, tier, started_on: startedOn });
    if (!made.ok) return { ok: false, outcome: `client made, cluster refused: ${made.message}`, clientId };
  }
  const clusters = tier === "tracked" ? 1 : Math.max(1, o.quantity);

  const { error: memErr } = await db
    .from("dashboard_members")
    .upsert({ account_id: accountId, email: o.email, role: "owner" }, { onConflict: "account_id,email", ignoreDuplicates: true });
  if (memErr) return { ok: false, outcome: `client made, owner not added: ${memErr.message}`, clientId };

  // The login link, the same token row /api/app/login writes; sent to the member just stored.
  const token = newToken();
  const { error: tErr } = await db
    .from("dashboard_login_tokens")
    .insert({ token_hash: hashToken(token), email: o.email, ip_hash: null, expires_at: new Date(Date.now() + LOGIN_TTL_MS).toISOString(), used_at: null });
  // The welcome replaces the bare link only once its flag is on (R159; off until Danny approves it).
  // A trial order's welcome is trial_started's, behind its own flag (8 Oct 2026, audit activation-1,
  // copy-4): the paid welcome says "bought", so a trialist never gets it, whichever flag is on.
  // 18 Oct 2026 brief 2d: the sign-in link opens the dashboards host, the one customer dashboard.
  const link = `${dashOrigin()}/auth?token=${token}`;
  const trial = trialEndsAt ? trialTerms({ endsAt: trialEndsAt, market, price: TRACKED_PRICE, billing: billingUrl(made.slug) }) : null;
  const clusterLimit = made.cluster_limit ?? CLUSTER_BASE;
  const welcomeOn = !tErr && (await lifecycleOn(db, trial ? "trial_started" : "welcome"));
  const sent =
    !tErr &&
    (welcomeOn
      ? await sendLifecycle({ memberEmail: o.email, mail: welcome({ tier: tier as TierKey, clusters, clusterLimit, domain, link, trial, market, startedOn }) })
      : await sendLoginLink({ memberEmail: o.email, link }));

  return {
    ok: true,
    clientId,
    outcome:
      `${scan ? (prefill ? "from the scan" : `from a ${scan.market} scan, tracked in ${market} as paid, nothing prefilled from it`) : "no scan, from the website on the order"}: ${domain} at ${tier}, first check ${startedOn}; ` +
      `cluster 1 "${clusterName}" with ${rows.length} prompt(s)${clusters > 1 ? `, ${clusters - 1} more "${NEEDS_A_KEYWORD}"` : ""}` +
      `; ${o.email} is owner; ${welcomeOn ? (trial ? "trial_started email" : "welcome email") : "login link"} ${sent ? "sent" : "NOT sent"}.`,
    // Starter clusters (22 Oct 2026): any cluster left with no keyword or no prompt is filled from the site, in the
    // market paid for, once the webhook has answered (onCheckoutCompleted). The scan's read of the site is used
    // when there is one, whichever market it was in: the category does not change with the market, the keyword does.
    starter: {
      clientId,
      domain,
      market,
      startedOn,
      topic: scan?.topic ?? null,
      positioning: scan?.positioning ?? null,
      ...siteFacts(scan?.site_facts),
      topicVariants: Array.isArray(scan?.topic_variants) ? scan!.topic_variants!.map(String) : [],
    },
  };
}

/**
 * When a trialing order's first charge is due (Danny, 8 Oct 2026): Stripe's own
 * trial_end, read off the subscription, so the date is the one Stripe charges
 * on. If the read fails the trial's length from now stands in, logged - the
 * signup is not held up for a date.
 */
async function trialEndOf(o: CompletedOrder): Promise<string | null> {
  if (!o.trialDays) return null;
  if (o.subscriptionId) {
    const sub = await readSubscription(o.subscriptionId);
    if (sub.ok && sub.trialEnd) return new Date(sub.trialEnd * 1000).toISOString();
    console.warn(`[stripe] trial end not read for ${o.subscriptionId}: ${sub.ok ? "no trial_end" : sub.reason}`);
  }
  return new Date(Date.now() + o.trialDays * 24 * 3600 * 1000).toISOString();
}

/**
 * `later` runs work after the webhook has answered (the route passes next/server's `after`); without it the work
 * is awaited here, as in the tests. The starter clusters and the order email go there: the reads take seconds and
 * Stripe should have its 200 first, and the order email reports what the starter made, or what it could not.
 */
export async function onCheckoutCompleted(db: SupabaseClient, o: CompletedOrder, eventId: string, later?: (task: () => Promise<void>) => void): Promise<boolean> {
  const trialEndsAt = await trialEndOf(o);
  const trial = trialEndsAt ? { firstCharge: trialMoment(trialEndsAt, o.market), amount: trialCharge(o.market, TRACKED_PRICE) } : null;
  const r = await clientFromOrder(db, o, trialEndsAt);
  if (!r.ok) {
    console.error(`[stripe] signup failed for ${eventId}: ${r.outcome}`);
    // A paid order whose signup keeps failing was silent: no order row, no
    // order email, only Stripe's retries (R148 pass 8, 1 Oct 2026). The first
    // failure for a Session writes its order row and tells Danny; a retry finds
    // the row and stays quiet. Still false, so Stripe retries the signup.
    const order = await writeOrder(db, o, r.clientId ?? null, trialEndsAt);
    if (order.inserted) {
      const mail = orderEmailText(o, `FAILED, Stripe will retry it: ${r.outcome} Order row: ${order.text}.`, siteUrl(), trial);
      await sendOrderEmail({ ...mail, subject: `SIGNUP FAILED - ${mail.subject}`, replyTo: o.email });
    }
    return false;
  }
  if (r.clientId) {
    const { error } = await db.from("stripe_events").update({ client_domain_id: r.clientId }).eq("id", eventId);
    if (error) console.warn(`[stripe] event ${eventId} not linked to its client: ${error.message}`);
    // The dashboard's "Free trial - ends <date>" reads this. Logged, not
    // retried: the client is made and the order row carries the date too.
    if (trialEndsAt) {
      const { error: tErr } = await db.from("client_domains").update({ trial_ends_at: trialEndsAt }).eq("id", r.clientId);
      if (tErr) console.error(`[stripe] trial_ends_at not set on client ${r.clientId}: ${tErr.message}`);
    }
  }
  const order = await writeOrder(db, o, r.clientId ?? null, trialEndsAt);
  const finish = async () => {
    let starter = "";
    if (r.starter) {
      try {
        starter = (await fillStarters(db, r.starter)).text;
      } catch (err) {
        starter = `Starter: NOT generated (${err instanceof Error ? err.message : String(err)}) - pick keywords and prompts in /admin/tracking.`;
      }
      if (starter) console.log(`[stripe] ${eventId}: ${starter}`);
    }
    const mail = orderEmailText(o, `${r.outcome}${starter ? ` ${starter}` : ""} Order row: ${order.text}.`, siteUrl(), trial);
    await sendOrderEmail({ ...mail, replyTo: o.email });
  };
  if (later) later(finish);
  else await finish();
  return true;
}

/** inserted is false when the Session's row was already there (a retry), or was not written. */
async function writeOrder(db: SupabaseClient, o: CompletedOrder, clientId: string | null, trialEndsAt: string | null = null): Promise<{ text: string; inserted: boolean }> {
  const built = orderRow(o, clientId, trialEndsAt);
  if (!built.row) {
    console.error(`[stripe] order row not written for ${o.sessionId}: ${built.reason}`);
    // No row means nothing marks a retry, so a failing signup mails on each one: noisy beats silent.
    return { text: `not written (${built.reason})`, inserted: true };
  }
  const { data, error } = await db.from("orders").upsert(built.row, { onConflict: "stripe_session_id", ignoreDuplicates: true }).select("stripe_session_id");
  if (error) {
    console.error(`[stripe] order row not written for ${o.sessionId}: ${error.message}`);
    return { text: `NOT written (${error.message})`, inserted: true };
  }
  if (data?.length) return { text: "written", inserted: true };
  // Written by an earlier, failed attempt: link the client this one made.
  if (clientId) {
    const { error: lErr } = await db.from("orders").update({ client_domain_id: clientId }).eq("stripe_session_id", o.sessionId).is("client_domain_id", null);
    if (lErr) console.warn(`[stripe] order ${o.sessionId} not linked to its client: ${lErr.message}`);
  }
  return { text: "already written by an earlier attempt", inserted: false };
}

/**
 * Packs become cluster_limit (limits.ts: 10 + 5 per pack), and trial_ends_at
 * follows Stripe's trial_end when the trial moves or ends (trialEndsAtAfter,
 * 8 Oct 2026, review of 7e133a7: a trial ended early kept reading as running,
 * and the cron's trial emails would have told a paying client nothing is
 * charged). No client for the subscription: nothing to do. A failed write is
 * false, so Stripe retries.
 *
 * BL-2 (9 Oct 2026): then the subscription's status (payment.ts). past_due is
 * recorded for the owner's banner; unpaid, paused and incomplete_expired end
 * the client; canceled ends it through endClient, as
 * customer.subscription.deleted does; a client ended for payment whose
 * subscription is paid again is made active. Only for a client an order row
 * ties to the subscription (subscription-events.ts, review of 2c6dc99).
 */
export async function onSubscriptionUpdated(db: SupabaseClient, sub: Record<string, unknown>, previous: Record<string, unknown> = {}, at: number = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const client = await clientOfSubscription(db, sub);
  if (client === false) return false;
  if (trialConverted(sub, previous)) console.info(`[stripe] trial converted to paid: ${String(sub.id)} client ${client?.id ?? "none"}`);
  if (!client) return true;
  const trialEndsAt = trialEndsAtAfter(sub, previous);
  // 17 Oct 2026: packs bought through Checkout are their own subscriptions (packs.ts); the limit counts both.
  const bought = await livePacks(db, client.id);
  if (typeof bought === "string") {
    console.error(`[stripe] ${bought}`);
    return false;
  }
  const { error } = await db
    .from("client_domains")
    .update({ cluster_limit: clusterLimitFor(packsOn(sub) + bought), ...(trialEndsAt === undefined ? {} : { trial_ends_at: trialEndsAt }) })
    .eq("id", client.id);
  if (error) {
    console.error(`[stripe] cluster_limit${trialEndsAt === undefined ? "" : " and trial_ends_at"} not set: ${error.message}`);
    return false;
  }
  // 12 Oct 2026 (email review H1): a trial cancelled in Stripe - by us on a client's email, or in the portal - is
  // recorded as the dashboard's Cancel trial records it, so no trial email tells that client it will be charged.
  if (!(await recordTrialCancel(db, client.id, sub, previous, at))) return false;
  return recordPayment(db, client, String(sub.id), at, (row) => afterSubscription(row, sub, at), () => endClient(db, client.id, sub));
}

/**
 * Cancelled: the client ends. Nothing is deleted. plan_ended goes to its live
 * owners only when this call ended it (not a client already ended) and its
 * flag is on (R159; off until Danny approves it). A failed send is logged, not retried.
 *
 * 8 Oct 2026 (audit copy-4): a subscription that ended inside its trial gets
 * the trial's version - not charged, no receipt, no second trial - and, as
 * the email now sends the owner to Billing to ask us to restart, it goes only
 * where Billing has Ask us: upsell mode nomada, as the ended banner decides
 * (planEndedOwners, lifecycle-sweep.ts). Which version is planEndedInTrial's:
 * Stripe's trial_end on this payload first, so a trial_ends_at that signup
 * failed to write cannot hand an uncharged trial the receipt line.
 *
 * BL-2 (9 Oct 2026): the subscription's canceled status is recorded too, so a
 * client ended for payment and then cancelled stays ended when it is read.
 * Review of 2c6dc99 (same day): a client guessed from the scan, because no
 * order row names the subscription, is still ended here as before BL-2, so a
 * subscription whose order row was refused does not track for ever; only the
 * payment step is withheld from it (subscription-events.ts).
 */
export async function onSubscriptionDeleted(db: SupabaseClient, sub: Record<string, unknown>, at: number = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const client = await clientOfSubscription(db, sub);
  if (client === false) return false;
  if (!client) return true;
  if (!(await endClient(db, client.id, sub))) return false;
  return recordPayment(db, client, String(sub.id), at, (row) => ({ ...afterSubscription(row, { ...sub, status: "canceled" }, at), cancel: false }), null);
}

/** The end of a subscription, for .deleted and an .updated that says canceled: false only when Stripe should retry. */
async function endClient(db: SupabaseClient, clientId: string, sub: Record<string, unknown>): Promise<boolean> {
  const { data: ended, error } = await db
    .from("client_domains")
    .update({ status: "ended" })
    .eq("id", clientId)
    .neq("status", "ended")
    .select("account_id, domain, tier, slug, trial_ends_at");
  if (error) {
    console.error(`[stripe] client not ended: ${error.message}`);
    return false;
  }
  const row = ended?.[0];
  if (row && (await lifecycleOn(db, "plan_ended"))) {
    const owners = await planEndedOwners(db, row.account_id as string);
    const trial = planEndedInTrial({ trialEndsAt: (row.trial_ends_at as string | null) ?? null, sub, now: Date.now() });
    const mail = planEnded({ tier: (TIERS.includes(row.tier as string) ? row.tier : "tracked") as TierKey, domain: row.domain as string, billing: billingUrl(row.slug as string), trial });
    for (const m of owners) {
      if (!(await sendLifecycle({ memberEmail: m.email as string, mail }))) console.warn(`[stripe] plan_ended not sent for ${clientId}`);
    }
  }
  return true;
}

/**
 * customer.subscription.trial_will_end (8 Oct 2026, audit activation-1):
 * trial_ending's fallback trigger, behind the same flag and the same
 * once-a-client record as the cron's (lifecycle-sweep.ts). A subscription no
 * longer trialing - a trial ended early - is left alone.
 */
export async function onTrialWillEnd(db: SupabaseClient, sub: Record<string, unknown>): Promise<boolean> {
  // 12 Oct 2026 (email review H1): nor one set to end before its first charge, whoever cancelled it and whether or
  // not the .updated that records it has landed yet - "From then it is $129 a month" would be false.
  if (!trialStillRunning(sub) || trialCancelPending(sub)) return true;
  const client = await clientOfSubscription(db, sub);
  if (client === false) return false;
  // An email goes only to a client an order row ties to the subscription, never one guessed from its scan (9 Oct 2026, review of 2c6dc99).
  if (!client?.exact) return true;
  const clientId = client.id;
  return mailTrialEnding(db, lifecycleIo(), clientId);
}
