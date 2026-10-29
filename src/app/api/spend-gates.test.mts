import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { PAID, apiRoutes, code, mailSenders, missingEntryPoints, spendingRoutes, spends, vendors } from "./spenders.mts";

/**
 * Every **route** in this tree that can cause somebody to be billed, and what
 * stands in front of each one.
 *
 * That word is load-bearing and it was not here originally. This file said
 * "every door in this tree" and then walked `src/app/api` for `route.ts`,
 * which is a claim wider than its own denominator - the defect it was written
 * to catch, in itself. **Two `"use server"` actions bill Resend on an
 * anonymous post and are neither under `src/app/api` nor named `route.ts`**, so
 * this walk cannot see either of them however the lists below are edited.
 * `src/app/mail-doors.test.mts` is that half, and it derives its own set by
 * walking for `"use server"` rather than by naming the two.
 *
 * `ceilings.test.mts` now executes the ceilings themselves. That is one way
 * down a two-way street: it proves the guard decides correctly and says nothing
 * about which doors have it. Three routes call `checkCeilings`; **eight can
 * cause a paid call**, and the five that do not are each bounded by something
 * else entirely - a per-scan reservation, a compare-and-swap, a dollar cap read
 * somewhere else, a send ceiling counted in a database function. Not one of
 * those pairings was written down anywhere, so the
 * denominator was invisible: a new route that spends would have been in nobody's
 * list, passed tsc, passed the build, passed every test and passed the deploy.
 *
 * This is the same shape as `readiness.ts` before `d0898cf` - correct about
 * every key it named, while `SCAN_FROM_EMAIL` was read by four senders and on
 * no list at all. A census belongs in a test, not a comment.
 *
 * ## What is asserted, and why each part has to be here
 *
 * 1. **The set of spending routes is pinned.** A route that starts calling a
 *    paid entry point fails this file until somebody classifies it. That is the
 *    whole point: the failure is meant to be a question, not a bug report.
 * 2. **Every spending route is guarded or exempt, and every exemption names its
 *    own bound in its own source.** A written list that is merely a list rots
 *    into a blanket pass - `public-routes.test.mts` learned that. So each
 *    exemption is re-earned here by finding the thing it claims bounds it.
 * 3. **The kill switch's reach is measured, not assumed.** `scans_enabled` is
 *    documented in `settings-merge.ts` as the switch thrown in a hurry "by
 *    someone who will not then go and check that it took". It reaches three of
 *    the eight doors. That gap is real, it is Danny's call rather than mine
 *    (docs/blocked.md), and pinning it here means it cannot widen silently
 *    while the question is open.
 *
 * ## The honest limit of reading this as source
 *
 * A route "spends" if its own source calls one of the paid entry points below,
 * or imports a vendor client directly. That cannot see a paid call reached
 * through a module the route imports for another reason - which is exactly why
 * the import-graph version of this check was discarded: it reported `/full` and
 * `/opportunities` as spenders because something in their graph imports
 * `anthropic.ts`, when both only read rows that were already paid for. An
 * import is not a call. The named-entry-point list is narrower and true, and
 * the direct-import assertion below is what stops a route routing around it.
 *
 * ## The third vendor, and why the denominator left this file
 *
 * `VENDORS` was typed here, and its own comment called them "the two clients
 * that actually put a request on the wire to a vendor". There are three.
 * **Resend bills per message**, which is the premise `mail-doors.test.mts` is
 * built on and which blocked.md 24 states in as many words, and the module
 * that sends was not on this list because whoever wrote it was thinking about
 * the scan pipeline. So `/api/scan/[token]/resend` - under `src/app/api`,
 * named `route.ts`, squarely inside this walk, and existing only to put a
 * second message on a vendor's bill - passed tsc, the build, this file and the
 * deploy while appearing in neither list here.
 *
 * That is this file's own species caught in this file for the second time. The
 * first was the header, which claimed "every door" over a walk that could only
 * see routes; this was a typed denominator *inside* a rule, written from the
 * instances in front of whoever wrote it.
 *
 * The fix is not a longer list. `paid-get.test.mts` was answering the same
 * question two files away with a denominator of its own, derived off the two
 * *guard* names, and could see five of the eight - it missed
 * `scan/[token]/confirm`, which runs the whole free pass. **Two copies of one
 * denominator, each blind somewhere the other was not.** So the set moved to
 * `spenders.mts`, a helper both import, and its header carries the whole
 * measurement. What stays here is the question this file asks: what stands in
 * front of each door.
 *
 * `mail-doors.test.mts` still does not merge in, for the reason it gives: it
 * asks what bounds the *rate* a stranger can open a door, this asks whether a
 * door reaches `checkCeilings`. A route appearing in both is correct. What
 * would be wrong is a door appearing in neither, which is what just happened.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const API = join(ROOT, "src", "app", "api");

const MAIL_SENDERS = mailSenders(ROOT);
const VENDORS = vendors(ROOT);

/** Routes that pass through `checkCeilings` - the kill switch and four ceilings. */
const GUARDED = [
  "scan/start",
  "coverage-check",
  "coverage-check/[token]/rerun",
  // 1 Oct 2026, R140: step 2's draft - one model call over the placed pieces,
  // no engine read. Behind Turnstile, checkCeilings and DRAFTS_PER_IP_PER_DAY.
  "coverage-check/draft",
  // 29 Oct 2026: "Run a new check" on a finished report. It makes no paid call
  // itself - the new scan is paid at /confirm - but it imports anthropic.ts for
  // TOPIC_VARIANT_COUNT, and it does go through checkCeilings and a per-domain
  // daily count (domain_reruns_per_day), so it is classified here honestly.
  "scan/[token]/rerun",
];

/**
 * Routes that spend and do not call `checkCeilings`, each with the bound that
 * stands in its place and a string that must still be findable in its source.
 *
 * `evidence` is not decoration. Without it this is a list of names, and a list
 * of names is satisfied by a route whose bound was deleted last week.
 */
const EXEMPT: Record<string, { why: string; evidence: RegExp; where: string }> = {
  "scan/[token]/confirm": {
    why:
      "Runs the free pass for a row that already passed the ceilings at /api/scan/start. " +
      "Its own bound is the compare-and-swap on status: the update matches only a row that " +
      "is not already queued, running or complete, so one row can start one pass however " +
      "many times it is confirmed.",
    evidence: /\.not\("status", "in", "\(queued,running,complete\)"\)/,
    where: "src/app/api/scan/[token]/confirm/route.ts",
  },
  "scan/[token]/questions": {
    why:
      "Rewrites one question at a time. Bounded per scan by a reservation taken inside a " +
      "database function against a fixed ceiling, rather than by the day's caps - a rewrite " +
      "is a fraction of a pass and the row it belongs to was already counted. Since 30 Sep 2026 " +
      "(BRIEF-3 C1) it also picks the cluster keyword: one candidates call and two DataForSEO " +
      "reads (volume, intent), a few cents, taken after the same reservation, skipped on a " +
      "rewrite with the same topic and market, and billed onto dfs_cost so the next start's " +
      "daily_cost_cap_usd sees them.",
    evidence: /p_ceiling: CALL_CEILING/,
    where: "src/app/api/scan/[token]/questions/route.ts",
  },
  /**
   * The door the typed vendor list could not see. It spends on Resend rather
   * than on a model, which is why no ceiling is the right bound for it: the
   * scan behind it was already counted at `/api/scan/start`, and what this
   * route adds is a second copy of one message.
   *
   * Two bounds, and the evidence is the volume one rather than the cooldown.
   * Sixty seconds is a bound on a double click; `note_verify_send` is the
   * bound on somebody holding the public token - which is in every shared scan
   * link - and calling this on a timer. Without it the route had none, and
   * sixty seconds apart forever is about fourteen hundred messages a day to
   * one address past a cap that reads five.
   */
  /**
   * The door that reached a vendor one hop away, and so was invisible to the
   * derived denominator as well as to the typed one it replaced.
   *
   * `/api/scan/[token]/email-report` takes an address while a scan is running
   * and mails the free result when the pass ends. It imports `report-mail.ts`,
   * which imports `verify-email`, which imports Resend - so `mailSenders` never
   * listed it and `importsModule` could not match it. It passed this sweep and
   * `paid-get` green on the day it was written. `sendRequestedReport` is a
   * named paid entry point now, which is what makes it visible here.
   *
   * No ceiling, and that is right rather than an omission: the scan behind it
   * was counted at `/api/scan/start`, and what this route adds is one message
   * per scan row for the whole life of that row. The bound is not a rate at
   * all - it is a compare-and-swap, so posting this a thousand times writes one
   * column and sends one message.
   */
  "scan/[token]/email-report": {
    why:
      "Records an address on a scan row that passed checkCeilings at /api/scan/start, and " +
      "mails that row's free result once. Bounded by the claim inside sendRequestedReport: " +
      "report_email_sent_at is stamped by a filtered update that hands the address back only " +
      "to the caller that stamped it, so the pipeline and this route cannot both send and " +
      "neither can send twice. One message per scan, ever.",
    evidence: /\.is\("report_email_sent_at", null\)/,
    where: "src/lib/scan/report-mail.ts",
  },
  /**
   * 24 September 2026. The walkthrough request mails us, never the caller,
   * and starts no scan: the only spend is one Resend message to our own inbox.
   * Bounded twice - a unique (scan, email, kind) row, so a repeat alerts
   * nobody, and a per-IP ceiling on requests a day.
   */
  "scan/[token]/walkthrough": {
    why:
      "Sends one internal alert per new (scan, email, kind) request, to our own inbox, and starts " +
      "no scan. Bounded by the unique upsert - a duplicate inserts nothing and sends nothing - and " +
      "by PER_IP_PER_DAY requests from one hashed address.",
    evidence: /const PER_IP_PER_DAY = \d+/,
    where: "src/app/api/scan/[token]/walkthrough/route.ts",
  },
  /**
   * 28 September 2026 (pricing spec section 6). The same ask from a tier page,
   * with no scan. Same single spend - one Resend message to our own inbox -
   * but the unique index cannot dedupe a null scan_id, so the route looks up
   * a same-address, same-kind ask from the last day itself before alerting.
   */
  walkthrough: {
    why:
      "Sends one internal alert per new (email, kind) ask with no scan in a rolling day, to our own " +
      "inbox, and starts no scan. Bounded by the repeat lookup - a same-day repeat inserts nothing " +
      "and sends nothing - and by PER_IP_PER_DAY requests from one hashed address.",
    evidence: /const PER_IP_PER_DAY = \d+/,
    where: "src/app/api/walkthrough/route.ts",
  },
  /**
   * 29 September 2026, T1 of docs/tracked-dashboard-2026-09-29/BRIEF.md. The
   * daily tracking runner is not a visitor's scan, so `checkCeilings` - an
   * allowance per hashed IP and a count of free scans - is the wrong guard.
   * It has its own pair, both read before a single request goes out.
   *
   * 8 Oct 2026 (audit activation-1): after the dispatch it also sends the
   * lifecycle emails that go by the calendar (lib/email/lifecycle-sweep.ts) -
   * Resend messages, not model or SERP spend - each behind its own flag, off
   * by default, and once per client per email.
   *
   * 9 Oct 2026 (audit reliability-6, OP-1): and the run-health summary to our
   * own inbox (lib/tracking/run-health.ts) - one Resend message a tracking
   * day at most, claimed in dashboard_events before the send.
   */
  "cron/track": {
    why:
      "Opens one tracking run per active client with a live question and hands each to /api/track/run. " +
      "Behind CRON_SECRET; refused outright by refuseRun when tracking_enabled is off or today's tracking " +
      "dfs_cost has reached tracking_daily_cost_cap_usd; and the unique (client, day) row means a second " +
      "call the same day dispatches nothing. Its lifecycle emails go only with their email_<name>_enabled " +
      "flag on, to live owners, once per client per email, claimed in dashboard_events before the send. " +
      "Its run-health summary goes to our own inbox at most once a tracking day, claimed the same way.",
    evidence: /refuseRun\(await trackingSettings\(\), await trackingSpentOn\(day\)\)/,
    where: "src/lib/tracking/runner.ts",
  },
  /**
   * 9 Oct 2026 (audit reliability-4): /admin/tracking's "Run now" can ask to
   * re-run today's failed, partial or stalled run (rerun.ts), behind the
   * admin's Basic auth and the same switch and cap. Later that day (review of
   * b2e0019) the ask stopped moving the run back to queued: it writes a
   * marker, and the run route claims it by a compare-and-swap on that marker
   * (claimRerun) only when the queued claim below took nothing - once an ask.
   */
  "track/run": {
    why:
      "Runs one client's day. Only a body signed with CRON_SECRET is accepted; the claim moves only a " +
      "queued row to running, so one run reads once however often it is posted; and the same " +
      "tracking_enabled / daily cost cap refusal is re-read at the claim. A run the admin asked to re-run " +
      "is claimed once an ask by a compare-and-swap on its marker and read again the same way, only for the " +
      "reads that did not come back, its spend added to the run's.",
    evidence: /\.eq\("status", "queued"\)/,
    where: "src/lib/tracking/runner.ts",
  },
  /**
   * 29 September 2026, T3: the dashboard login link - one Resend message, to a
   * member's stored address, and no scan.
   */
  "app/login": {
    why:
      "Sends one login link to an address already in dashboard_members, never a typed one, and starts " +
      "no scan. Bounded by LOGIN_PER_EMAIL_PER_HOUR per address and LOGIN_PER_IP_PER_HOUR per hashed IP, " +
      "counted off dashboard_login_tokens, where every request is recorded whether or not it mails.",
    evidence: /export const LOGIN_PER_EMAIL_PER_HOUR = \d+/,
    where: "src/lib/tracking/session.ts",
  },
  /**
   * 1 October 2026, R142 part 2 (BRIEF-4 P2 Team): an owner's invite - one
   * Resend message to the address invited, and no scan.
   */
  "app/[client]/member": {
    why:
      "Sends one invite mail when a signed-in owner of the client adds someone to its team, and starts " +
      "no scan. At most INVITES_PER_OWNER_PER_DAY an owner a day, counted off dashboard_events " +
      "member_invite rows before the write, and MEMBERS_PER_CLIENT live members who see each client the " +
      "invite adds them to (MEMBERS_PER_ACCOUNT an account until 9 Oct 2026, AG-1; an invite to every client " +
      "counted on every client from the same day, team.ts refuseEveryClient).",
    evidence: /export const INVITES_PER_OWNER_PER_DAY = \d+/,
    where: "src/lib/tracking/team.ts",
  },
  /**
   * 2 October 2026, R166 step 4: setup confirmed - one Resend message to our
   * own contact destination, and no scan.
   */
  "app/[client]/setup": {
    why:
      "Sends one internal mail when a signed-in owner or editor confirms the client's setup, and starts " +
      "no scan. Once a client: the send follows the setup_confirmed insert, which a client already " +
      "confirmed never reaches.",
    evidence: /if \(already\) return done;[\s\S]*?await sendSetupConfirmed\(/,
    where: "src/app/api/app/[client]/setup/route.ts",
  },
  /**
   * 18 October 2026, brief 2d: setup's Confirm on the dashboards host - the
   * same once-only internal mail as app/[client]/setup, as JSON.
   */
  "dash/[client]/setup/finish": {
    why:
      "Sends one internal mail when a signed-in owner or editor confirms the client's setup on the " +
      "dashboards host, and starts no scan. Once a client: the send follows the setup_confirmed insert, " +
      "which a client already confirmed never reaches, and setupGaps refuses before either.",
    evidence: /if \(already\) return Response\.json\(\{ ok: true, already: true \}\);[\s\S]*?await sendSetupConfirmed\(/,
    where: "src/app/api/dash/[client]/setup/finish/route.ts",
  },
  /**
   * 18 October 2026, brief 2b / 2c: setup's keyword step on the dashboards
   * host - Check keyword, plus where the site and the chosen page rank and
   * the plural's volume.
   */
  "dash/[client]/setup/keyword": {
    why:
      "Runs the same check-keyword.ts check as app/[client]/check for a signed-in owner or editor - " +
      "nothing paid until the free prechecks pass, CHECKS_PER_CLIENT_PER_DAY a client a day counted off " +
      "keyword_checked rows written before any read - and only after a passing check two Google position " +
      "reads and one volume read (a few cents), so the same daily count bounds them.",
    evidence: /if \(!check\.ok\) return Response\.json\(\{ ok: true, check \}\);[\s\S]*?readKeywordPosition\(/,
    where: "src/app/api/dash/[client]/setup/keyword/route.ts",
  },
  /**
   * 30 September 2026, BRIEF-2 T11 /ask: a member's ask - one Resend message,
   * to us or the account's agency contact, and no scan.
   */
  "app/[client]/ask": {
    why:
      "Sends one ask for a signed-in member of the client, to our contact destination or the account's " +
      "agency contact, and starts no scan. At most ASKS_PER_MEMBER_PER_DAY a member a day, counted off " +
      "cta_events asked rows before the send; off mode sends none.",
    evidence: /export const ASKS_PER_MEMBER_PER_DAY = \d+/,
    where: "src/lib/tracking/ask.ts",
  },
  /**
   * 30 September 2026, BRIEF-3 T6 part 3b: "Check keyword" on the Clusters
   * page. Not a visitor's scan, so checkCeilings is the wrong guard.
   */
  "app/[client]/check": {
    why:
      "Reads one typed keyword's volume and intent (two DataForSEO reads, a few cents) for a signed-in " +
      "owner or editor. Nothing is read until the free prechecks pass, and a client may make " +
      "CHECKS_PER_CLIENT_PER_DAY paid checks a day, counted off keyword_checked rows in dashboard_events, " +
      "written before the reads; an unread count refuses.",
    evidence: /export const CHECKS_PER_CLIENT_PER_DAY = \d+/,
    where: "src/lib/tracking/check-keyword.ts",
  },
  /**
   * 13 October 2026, DIY P1 (spec 10 sections 5.6 and 5.7): the DIY night.
   * Not a visitor's scan, so checkCeilings is the wrong guard; the DIY ledger
   * is its own, and it is read before every paid read rather than at the
   * door. The worker route is held by its HMAC; both night crons by
   * CRON_SECRET (paid-get, cron-schedule) and by the dispatcher queuing no
   * paid kind while diy_enabled is off. "the DIY ledger holds the caps" below
   * holds the reservation order every one of the three depends on.
   */
  "diy/run": {
    why:
      "Runs one DIY night worker. Only a body signed with CRON_SECRET (HMAC-SHA256, x-diy-signature) is accepted, " +
      "and since 13 Oct 2026 (DIY P1 review) only on its own night: its day today's UTC day, posted 03:25-04:20 UTC. " +
      "Every paid read inside is reserved in diy_reads first and refused while diy_enabled is off, past the global " +
      "daily caps, past the client's per-door daily count or past its month budget.",
    evidence: /if \(!verifyRun\(body, req\.headers\.get\(DIY_SIGNATURE_HEADER\), secret\)\)/,
    where: "src/app/api/diy/run/route.ts",
  },
  /**
   * 13 October 2026, DIY P9 (P7's and P8's handoffs, spec 10 sections 3.6 and
   * 5.6): wave 2's two on-demand doors. A member's button, not a visitor's
   * scan, so checkCeilings is the wrong guard; each paid read goes through
   * runOnDemand, which refuses an inactive client, refuses while a tracking run
   * is reading, counts the allowance and preflights the DIY caps before
   * anything is reserved, and the DIY ledger reserves and caps every read as
   * it goes out ("the DIY ledger holds the caps" below).
   */
  "app/[client]/opportunity": {
    why:
      "Verify now and Log a site, for a signed-in owner or editor (writeRole). Each reads the page with our own fetch " +
      "first, which is free; only the content_parsing fallback is paid, and it goes through runOnDemand: refused for an " +
      "inactive client, while a tracking run is reading, past the month's 30 link checks (10 in trial; a logged site " +
      "counts as one) or past the DIY caps, and refused while diy_enabled is off.",
    evidence: /await runOnDemand\(\{ db, client: diy, member: email!, action: "verify" \}/,
    where: "src/app/api/app/[client]/opportunity/route.ts",
  },
  "app/[client]/pages": {
    why:
      "Check this page now (an inline instant_pages read) and Draft an example (one model call in after()), for a " +
      "signed-in owner or editor (writeRole). Both go through runOnDemand: refused for an inactive client, while a " +
      "tracking run is reading, past the month's 30 page checks or 10 drafted examples (10 and 3 in trial) or past the " +
      "DIY caps, and refused while diy_enabled is off; each read is reserved in diy_reads before it goes out.",
    evidence: /await runOnDemand\(\{ db, client: diy, member: email, action: "page_check", now: \(\) => nowMs \}/,
    where: "src/app/api/app/[client]/pages/route.ts",
  },
  /**
   * 13 October 2026, DIY P10 (spec 10 sections 3.6 and 4.8): Links' one
   * on-demand door, Check a link. A member's button, not a visitor's scan, so
   * checkCeilings is the wrong guard. Show the next 5 and Pursue read stored
   * rows only and spend nothing.
   */
  "app/[client]/links": {
    why:
      "Check a link, for a signed-in owner or editor (writeRole). It reads the page with our own fetch first, which is " +
      "free; only the content_parsing fallback is paid, and it goes through runOnDemand: refused for an inactive client, " +
      "while a tracking run is reading, past the month's 30 link checks (10 in trial, shared with Verify now and Log a " +
      "site and counted before anything is read) or past the DIY caps, and refused while diy_enabled is off. Reveal and " +
      "Pursue read stored rows only.",
    evidence: /await runOnDemand\(\{ db, client: diy, member: email!, action: "link_check" \}/,
    where: "src/app/api/app/[client]/links/route.ts",
  },
  "cron/purge-responses": {
    why:
      "DIY night pass 1 at 03:30 UTC, behind CRON_SECRET. Makes the two free vendor reads (cost 0) once a UTC day, " +
      "queues paid kinds only for confirmed clients while diy_enabled is on, and posts two signed workers; every " +
      "paid read they make is reserved and capped by the DIY ledger.",
    evidence: /dueJobs\(deps\.handlers, client, \{ enabled: out\.enabled/,
    where: "src/lib/diy/core/dispatch.ts",
  },
  "cron/reap-stalled-scans": {
    why:
      "DIY night pass 2 at 03:45 UTC, behind CRON_SECRET: the same dispatch, posting its two workers only while " +
      "claimable due jobs remain. Every paid read is reserved and capped by the DIY ledger before it goes out.",
    evidence: /if \(out\.pending === 0\) return out;/,
    where: "src/lib/diy/core/dispatch.ts",
  },
};

/**
 * Doors the kill switch actually reaches, measured on 20 September 2026.
 *
 * `scans_enabled` is read in exactly one place - `decideCeilings` - so a route
 * honours it if and only if it calls `checkCeilings`. The five exempt routes
 * above therefore do not, and the two most expensive things this system does
 * are both among them: a confirm runs the whole free pass, and an unlock runs
 * the gated one, which `spend.ts` calls the biggest single spender here.
 *
 * The fifth joined the list on 20 September, when the vendor denominator was
 * derived rather than typed. It does not change the shape of the question -
 * `scan/[token]/resend` spends pennies on mail rather than dollars on models -
 * but it changes the count blocked.md 22 is written around, and the count is
 * there precisely so a door cannot join quietly.
 *
 * Pinned rather than fixed, because which way it should go is a product call
 * and not a bug: closing it turns the switch into something that strands a
 * visitor who has already typed their domain or already given their address.
 * docs/blocked.md carries the question. This assertion means the answer arrives
 * as a deliberate edit to this list.
 */
const KILL_SWITCH_REACHES = GUARDED;

// --------------------------------------------------------------- the walk

/**
 * The walk, the comment strip and the spend test all live in `spenders.mts`
 * now. What is left here is this file's own question.
 */
const routes = apiRoutes(ROOT);

// --------------------------------------------------------------- the tests

test("the walk found the routes, so a zero here cannot pass as a clean sweep", () => {
  // 15 until 24 September 2026, when the email gate took three routes with it:
  // scan/[token]/unlock, scan/[token]/resend and verify/[vtoken]. Their EXEMPT
  // entries went at the same time rather than being left behind - an exemption
  // whose route no longer exists is an allowance the next route inherits under
  // that name, which is the failure this file is built to catch.
  assert.ok(routes.length >= 14, `only ${routes.length} routes found; the walk is reading the wrong tree`);
  for (const name of [...GUARDED, ...Object.keys(EXEMPT)]) {
    assert.ok(
      routes.some((r) => r.name === name),
      `${name} is on a list here and is not a route any more`,
    );
  }
});

/**
 * The floor under the derived half, without which an empty walk reads as a
 * clean sweep.
 *
 * A `MAIL_SENDERS` that came back empty - a renamed package, a changed import
 * idiom, a walk pointed at the wrong directory - would silently restore the
 * exact blindness this was written to remove, and every assertion below would
 * still pass. So the walk is made to prove it can still find the module it is
 * about before its emptiness is believed.
 */
test("the derived vendor walk still finds the mail senders", () => {
  assert.ok(
    MAIL_SENDERS.length >= 3,
    `only ${MAIL_SENDERS.length} mail senders found; the walk has stopped seeing Resend: ${MAIL_SENDERS.join(", ")}`,
  );
  assert.ok(
    MAIL_SENDERS.includes("@/lib/scan/verify-email"),
    "verify-email is no longer read as a mail sender, and it is the one a route imports",
  );
  for (const v of VENDORS) {
    const file = join(ROOT, "src", v.replace(/^@\//, "") + ".ts");
    assert.ok(
      readFileSync(file, "utf8").length > 0,
      `${v} is on the vendor list and is not a module any more`,
    );
  }
});

/**
 * The detector shown finding what it is for, on text written here.
 *
 * A clean tree makes the set below correct and so does a detector that has
 * stopped matching - the state every sweep in this repo has been caught in at
 * least once. These three shapes are the ones the first version of `spends`
 * could not see, and two of them were invisible *by construction* rather than
 * by an oversight in a list:
 *
 *  - a route importing the vendor package itself, which `mailSenders` would
 *    list under the route's own specifier - and no file's source contains its
 *    own import path, so the set grew and the answer stayed `false`;
 *  - a route importing a vendor by a relative path, which this tree uses on
 *    purpose in two places and tells you not to tidy back.
 *
 * Found by asking the refill question of this file's own helper on the day it
 * was written, which is the practice that has paid twelve times here.
 */
test("the spend detector sees a vendor reached three different ways", () => {
  const v = vendors(ROOT);

  assert.ok(
    spends('import { Resend } from "resend";\nexport async function POST() {}', v),
    "a route importing Resend itself does not read as a spender - the most direct spend there is",
  );
  assert.ok(
    spends('import { readBrand } from "../../../lib/scan/anthropic";\nexport async function POST() {}', v),
    "a vendor imported by a relative path does not read as a spender",
  );
  assert.ok(
    spends('import { readBrand } from "@/lib/scan/anthropic";\nexport async function POST() {}', v),
    "a vendor imported by its @/ specifier does not read as a spender",
  );
});

/**
 * And the other way, which is what makes the three above mean anything: a
 * detector that answered `true` for everything would satisfy all of them.
 *
 * Its own test, not a fourth assertion above - the injection harness reports
 * which named subtest fired, so a case landing in the wrong branch is
 * indistinguishable from one landing in the right branch otherwise.
 */
test("the spend detector still refuses a route that only reads rows", () => {
  const v = vendors(ROOT);

  assert.ok(
    !spends('import { supabaseAdmin } from "@/lib/supabase/admin";\nexport async function GET() {}', v),
    "a route that only reads rows reads as a spender, so the detector answers true for everything",
  );
  // The comment strip, on the shape that is not a call. `start/route.ts`
  // discusses runScan and completeUnlock in prose without calling either.
  assert.ok(
    !spends('// import { Resend } from "resend";\n/* runScan( */\nexport async function GET() {}', v),
    "prose describing a paid call reads as one",
  );
});

test("every paid entry point still exists under the name this file matches on", () => {
  assert.deepEqual(
    missingEntryPoints(ROOT),
    [],
    "a paid entry point was renamed, so the spend walk is matching a name nothing answers to",
  );
  assert.ok(Object.keys(PAID).length >= 5, "the paid entry points emptied out");
});

test("exactly the expected routes can cause a paid call", () => {
  const spenders = spendingRoutes(ROOT).map((r) => r.name).sort();

  assert.deepEqual(
    spenders,
    [...GUARDED, ...Object.keys(EXEMPT)].sort(),
    "a route started or stopped being able to spend. Classify it: either it goes through " +
      "checkCeilings, or it goes on EXEMPT with the bound that stands in its place.",
  );
});

test("a guarded route really calls checkCeilings, and an exempt one really does not", () => {
  for (const name of GUARDED) {
    const r = routes.find((x) => x.name === name)!;
    assert.match(code(r.src), /\bcheckCeilings\s*\(/, `${name} is listed as guarded and does not call it`);
  }
  for (const name of Object.keys(EXEMPT)) {
    const r = routes.find((x) => x.name === name)!;
    assert.doesNotMatch(
      code(r.src),
      /\bcheckCeilings\s*\(/,
      `${name} is on the exempt list and now calls checkCeilings - move it to GUARDED`,
    );
  }
});

test("every exemption still has the bound it claims", () => {
  for (const [name, { evidence, where }] of Object.entries(EXEMPT)) {
    const src = readFileSync(join(ROOT, where), "utf8");
    assert.match(
      src,
      evidence,
      `${name} is exempt from the ceilings because of something in ${where}, and that is no ` +
        "longer there. It is now a door onto real spend with nothing in front of it.",
    );
  }
});

test("the kill switch is read in one place, so its reach is exactly the guarded set", () => {
  // If `scans_enabled` were read anywhere else, the reach below would be a
  // guess rather than a measurement - which is the failure this whole file is
  // about. Checked rather than asserted in prose.
  // Measured, not assumed - and the first version of this list was wrong in
  // both directions, which is the argument for the assertion existing. It named
  // `start/route.ts`, which only discusses the switch in a comment, and missed
  // the admin page, which renders it. One of the three acts on it.
  const readers = [
    // Defines it and refuses a value of the wrong type.
    "src/lib/scan/settings-merge.ts",
    // The only thing that ACTS on it. This is what makes the reach below a
    // measurement: a route honours the switch exactly when it calls into here.
    "src/lib/scan/ceilings-decide.ts",
    // Renders it on /admin/scans so somebody can see whether it is thrown.
    // A display, so it changes nothing about the reach - but it belongs on the
    // list, because a reader who found it and assumed otherwise would conclude
    // the switch was enforced somewhere it is not.
    "src/app/admin/scans/page.tsx",
  ];
  const found: string[] = [];
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) scan(p);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.mts")) {
        if (code(readFileSync(p, "utf8")).includes("scans_enabled")) found.push(relative(ROOT, p));
      }
    }
  };
  scan(join(ROOT, "src"));
  assert.deepEqual(
    found.sort(),
    readers.sort(),
    "scans_enabled is read somewhere new. The kill switch's reach is measured off the set of " +
      "routes that call checkCeilings, and that is only true while decideCeilings is the only " +
      "thing acting on it.",
  );

  assert.deepEqual(
    KILL_SWITCH_REACHES.slice().sort(),
    GUARDED.slice().sort(),
    "the kill switch reaches the routes that call checkCeilings and no others",
  );

  /**
   * Said as an assertion so it is not mistaken for an oversight: six doors onto
   * real spend do not honour the kill switch, and that is the open question.
   *
   * **Six since 20 September 2026, and the sixth does not move the decision.**
   * `scan/[token]/email-report` records an address for a scan that is already
   * running and paid for, and sends one message per row for the life of that
   * row. `scans_enabled` stops new scans; refusing this one would strand a
   * visitor mid-scan to save nothing, which is the same reading the resend door
   * got when it joined this list a few hours earlier.
   *
   * What the count is for is that a door cannot join quietly, and this one
   * tried: it reached its vendor one hop away and was green in this sweep and
   * in `paid-get` until `sendRequestedReport` was named in `spenders.mts`.
   */
  assert.equal(
    Object.keys(EXEMPT).length,
    /**
     * Seven earlier on 24 Sep 2026 - the walkthrough alert, which mails only
     * us - and four by the end of it.
     *
     * The three that went are the email gate's: `scan/[token]/unlock`,
     * `verify/[vtoken]` and `scan/[token]/resend`. Their routes were deleted,
     * so these are not doors that were closed, they are doors that stopped
     * existing. The open question shrinks with them, and the biggest single
     * spender on the whole list - the gated pass behind `completeUnlock` -
     * is the one that went.
     *
     * Five on 28 Sep 2026: `walkthrough`, the tier pages' ask with no scan -
     * one Resend message to our own inbox, like its scan-keyed sibling above.
     * `scans_enabled` stops new scans; this starts none, so the switch has
     * nothing to refuse here and the decision is not moved.
     *
     * Seven on 29 Sep 2026: `cron/track` and `track/run`, the daily tracking
     * runner (T1). Deliberately outside `scans_enabled`: that switch stops
     * visitors' scans, and a client's paid tracking has its own switch,
     * `tracking_enabled`, plus its own dollar cap - both in refuseRun.
     *
     * Eight the same day: `app/login`, the dashboard login link (T3). One
     * message to a member we already hold; `scans_enabled` stops scans and
     * this starts none.
     *
     * Nine on 30 Sep 2026: `app/[client]/check`, Check keyword in Add a
     * cluster (BRIEF-3 T6 part 3b). Two DataForSEO reads for a signed-in
     * member, bounded per client per day; it starts no scan, so
     * `scans_enabled` has nothing to refuse.
     *
     * Ten the same day: `app/[client]/ask`, a member's ask (BRIEF-2 T11). One
     * Resend message to us or the account's agency contact, three a member a
     * day; it starts no scan, so the decision is not moved.
     *
     * Eleven on 1 Oct 2026: `app/[client]/member`, an owner's team invite
     * (R142 part 2, BRIEF-4 P2). One Resend message to the address invited,
     * twenty an owner a day; it starts no scan, so the decision is not moved.
     *
     * Twelve on 2 Oct 2026: `app/[client]/setup`, setup confirmed (R166 step
     * 4). One Resend message to us, once a client; it starts no scan, so the
     * decision is not moved.
     *
     * Fifteen on 13 Oct 2026 (DIY P1): `diy/run` and the two night crons that
     * carry the DIY dispatch, `cron/purge-responses` and
     * `cron/reap-stalled-scans`. They start no scan; the DIY platform has its
     * own switch, `diy_enabled`, and its own caps in the DIY ledger, so
     * `scans_enabled` has nothing to refuse and the decision is not moved.
     *
     * Seventeen on 13 Oct 2026 (DIY P9, wave 2): `app/[client]/opportunity`
     * and `app/[client]/pages`, a member's on-demand DIY buttons. They start
     * no scan; runOnDemand and the DIY ledger hold them behind `diy_enabled`,
     * the allowances and the DIY caps, so `scans_enabled` has nothing to
     * refuse and the decision is not moved.
     *
     * Eighteen on 13 Oct 2026 (DIY P10, wave 3): `app/[client]/links`, Check
     * a link. It starts no scan; runOnDemand and the DIY ledger hold its paid
     * fallback behind `diy_enabled`, the link-check allowance and the DIY
     * caps, so `scans_enabled` has nothing to refuse and the decision is not
     * moved.
     *
     * Twenty on 18 Oct 2026 (brief 2d): `dash/[client]/setup/keyword` and
     * `dash/[client]/setup/finish`, setup on the dashboards host - the same
     * keyword check (per-client daily cap) and once-only internal mail as
     * `app/[client]/check` and `app/[client]/setup`. They start no scan, so
     * `scans_enabled` has nothing to refuse and the decision is not moved.
     */
    20,
    "the number of spending doors the kill switch does not reach has changed - see docs/blocked.md",
  );
});

test("the DIY ledger holds the caps: decided before the reservation, reserved before the read (13 Oct 2026, DIY P1)", () => {
  const ledger = code(readFileSync(join(ROOT, "src/lib/diy/core/ledger.ts"), "utf8"));
  const reserve = ledger.slice(ledger.indexOf("async function reserve("));
  const decide = reserve.indexOf("refusal = decideReservation(");
  const write = reserve.indexOf("await reserveRead(");
  assert.ok(decide > 0 && write > decide, "the caps are decided before the reservation is written");
  assert.match(reserve, /const settings = await readDiySettings\(rt\.db\);/, "the switch and caps are read on every reservation");
  const paid = ledger.slice(ledger.indexOf("export async function paidRead"));
  assert.ok(paid.indexOf("await reserve(") < paid.indexOf("await send("), "the read goes out after its reservation");
  const doors = code(readFileSync(join(ROOT, "src/lib/diy/core/doors.ts"), "utf8"));
  assert.match(doors, /return paidRead\(ctx, \{ door, endpoint, estimate: dfsEstimate\(endpoint, request\.rows\)/, "diyRead reserves at the request's maximum");
});
