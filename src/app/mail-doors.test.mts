import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * Every door in this tree that puts a message on Resend, and what bounds how
 * often a stranger can open it.
 *
 * ## Why this file exists rather than another entry in spend-gates
 *
 * `spend-gates.test.mts` opens by claiming to hold "every door in this tree
 * that can cause somebody to be billed". It then walks `src/app/api` for files
 * named `route.ts`. That claim is bigger than that walk, and the gap is not
 * hypothetical: **two of the three things in this repo that bill Resend are
 * `"use server"` actions, and neither is under `src/app/api` nor named
 * `route.ts`.** They are registered POST endpoints in production all the same -
 * Next builds an action id for every export of a `"use server"` module that a
 * client component imports, and both of these are imported by a mounted client
 * component. So there are two anonymous doors onto a vendor bill that passed
 * tsc, the build, every test and the deploy while being in nobody's list.
 *
 * This is the same species that file was written for and the same one
 * `readiness.ts` was before `d0898cf`: correct about every name it carries,
 * with the defect sitting outside its denominator. The fix is the same too -
 * the census goes in a test, and the census derives its own denominator by
 * walking rather than by being typed.
 *
 * The two files are deliberately not merged. `spend-gates` classifies a door by
 * whether it reaches `checkCeilings`, which is a scan-pipeline question and
 * says nothing at all about mail; this one classifies by what bounds the rate.
 * What keeps them from drifting into two lists that disagree is that neither
 * types its own set: each walks for its own vendor and fails when the walk
 * finds something it cannot name.
 *
 * ## What is asserted
 *
 * 1. **The set of modules that can send mail is derived, not typed.** A new
 *    sender fails this file until somebody says what bounds it.
 * 2. **The set of server actions is derived too**, because that is the half
 *    `spend-gates` structurally cannot see, and it is where both of the
 *    anonymous doors are.
 * 3. **Every bound is re-earned from the source that claims it**, the
 *    `evidence` pattern `spend-gates` uses - a written list that is merely a
 *    list rots into a blanket pass.
 * 4. **The rate gap is pinned as an assertion, not described in prose.** Two
 *    doors take an anonymous post and send a message with no per-caller
 *    identity of any kind. That is Danny's call (docs/blocked.md) and this
 *    means the answer arrives as a deliberate edit here rather than by drift.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "src");

/**
 * Comments stripped before anything is matched, lifted from `spend-gates`.
 *
 * Where it is load-bearing, measured rather than assumed: the sender walk. A
 * commented-out `from "resend"` line anywhere in `src` reads as a fourth mail
 * door without this, and the harness proves it by adding one and asserting the
 * sweep stays green.
 *
 * Where it is **not**, and the first version of this comment said it was:
 * `config/contact.ts` discusses `"use server"` twice in prose, but the action
 * walk anchors to the start of a line with only whitespace in front, and those
 * two sit behind a ` * ` inside a block comment. Stripping is belt and braces
 * there, not the thing doing the work. Recorded because the injection that was
 * written to prove it came back MISSED, and a comment claiming a guard that is
 * not guarding is the species this file is about.
 *
 * The `[^:]` guard keeps a `https://` inside a string from eating its line.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const files = sourceFiles(SRC).map((f) => ({
  path: relative(ROOT, f),
  code: code(readFileSync(f, "utf8")),
}));

/**
 * Every module that can put a message on the wire, and what bounds its rate.
 *
 * `reach` is who can open the door, which is the whole distinction this file
 * turns on: a door behind a scan row has already been counted by the ceilings,
 * and a door on the open web has not been counted by anything.
 *
 * The third value, 28 September 2026: a door on the open web that IS counted,
 * per hashed caller address, in its own route. The walkthrough ask from a
 * tier page (no scan, so not behind the ceilings) is the first; it is not
 * "anonymous" in this file's sense, because blocked.md's open question - no
 * per-caller identity - is answered for it by `clientIp` + `hashIp`.
 */
const SENDERS: Record<
  string,
  {
    reach: "anonymous" | "behind the ceilings" | "open, limited per caller" | "signed by Stripe" | "signed-in member, limited per member" | "signed-in owner, limited per owner" | "signed-in owner or editor, once a client" | "the tracking runner, once a client a Sunday" | "the tracking runner or the daily cron, once a day";
    bound: string;
    evidence: RegExp;
    where: string;
  }
> = {
  "src/lib/scan/verify-email.ts": {
    reach: "behind the ceilings",
    /**
     * This said "bounded twice over - a sixty-second cooldown read off
     * verify_sent_at in the resend route, and a volume ceiling counted in
     * note_verify_send" until 24 September 2026. Both bounds lived in routes
     * the email gate took with it, and `sendVerificationEmail` - the function
     * they bounded - went at the same time, because nothing called it any
     * more.
     *
     * What is left in this module is `sendReportReadyEmail`, and its bound is
     * a different one in a different file. Repointed rather than left naming a
     * route that is not in the tree: a recorded bound whose evidence has moved
     * is the stale-allowance shape this whole file is built to refuse.
     */
    bound:
      "Only ever sends to the address on a scan row, and that row passed checkCeilings at " +
      "/api/scan/start before it existed. One message per row, ever, claimed by stamping " +
      "report_email_sent_at in a filtered update that report-mail.ts owns.",
    evidence: /\.is\("report_email_sent_at", null\)/,
    where: "src/lib/scan/report-mail.ts",
  },
  /**
   * "behind the ceilings" until 28 September 2026, when the tier pages got the
   * same ask with no scan (/api/walkthrough, pricing spec section 6). Anyone
   * can open that door, so the reach moved; the bound is the same shape in
   * both routes, and `where` names the scanless one because it is the looser.
   */
  "src/lib/scan/walkthrough-mail.ts": {
    reach: "open, limited per caller",
    bound:
      "Mails only our own contact destination, never the caller. Two routes: the result page's " +
      "needs a scan token and dedupes on a unique (scan, email, kind) upsert; the tier pages' takes " +
      "no scan and dedupes on a same-day (email, kind) lookup. Both cap PER_IP_PER_DAY requests " +
      "from one hashed address.",
    evidence: /const PER_IP_PER_DAY = \d+/,
    where: "src/app/api/walkthrough/route.ts",
  },
  /**
   * 29 September 2026, T3: the dashboard login link. Anyone can post an
   * address, so the reach is open; the route mails only an address already in
   * dashboard_members (the stored one, not the typed one), and caps link
   * requests per address and per hashed IP an hour, counted off
   * dashboard_login_tokens - where every request, member or not, is recorded.
   */
  "src/lib/tracking/login-mail.ts": {
    reach: "open, limited per caller",
    bound:
      "Mails only an address found in dashboard_members, never one a stranger typed. At most " +
      "LOGIN_PER_EMAIL_PER_HOUR links an hour per address and LOGIN_PER_IP_PER_HOUR per hashed IP, " +
      "counted off dashboard_login_tokens before anything is sent.",
    evidence: /export const LOGIN_PER_IP_PER_HOUR = \d+/,
    where: "src/lib/tracking/session.ts",
  },
  /**
   * 30 Sep 2026, BRIEF-3 C4 / pricing spec section 5: the order email to
   * Danny. Its one caller is the Stripe webhook, which acts only on a body
   * whose Stripe-Signature verifies against STRIPE_WEBHOOK_SECRET, and records
   * the event id before acting, so one message per paid checkout.
   */
  "src/lib/checkout/order-mail.ts": {
    reach: "signed by Stripe",
    bound:
      "Mails only our own contact destination. Sent only from the Stripe webhook after the " +
      "signature verifies and the event id is newly recorded in stripe_events, so once per paid " +
      "checkout; a replay is a 200 that sends nothing.",
    evidence: /if \(!verifyStripeSignature\(raw, signature, secret, nowS\)\) return/,
    where: "src/lib/checkout/webhook.ts",
  },
  /**
   * 1 Oct 2026, R159 part 3: the lifecycle emails (welcome, plan_ended). Its
   * callers are signup.ts's checkout and subscription-deleted handlers, which
   * run only from the Stripe webhook once the signature verifies and the event
   * id is new, and each send first asks its app_settings flag, off by default.
   * 9 Oct 2026 (BL-2, review of 2c6dc99): plan_ended has a second caller, a
   * customer.subscription.updated whose status is canceled, through the same
   * endClient, which sends only when its own update ended the client - so
   * once, whichever of the two events lands first. Same webhook, same flag,
   * so the reach and bound below are unchanged; payment.test.mts follows the
   * calls and holds endClient's plan_ended to be the only send a payment
   * handler can reach.
   * Part 5, same day: first_reading from runTrackingDay, once per client ever
   * (only when the run is the client's one finished run), the runner being
   * started only by the cron's signed dispatch - see link-mail.ts's entry.
   * 8 Oct 2026 (audit activation-1): the trial's emails and the setup
   * reminder from lifecycle-sweep.ts, called by the CRON_SECRET-gated
   * /api/cron/track after its dispatch, and trial_ending also from Stripe's
   * trial_will_end. Each once per client, claimed in dashboard_events before
   * the send (a unique index in 20261008040000 makes the claim exact). The
   * reach stays "signed by Stripe" as first_reading's did: every caller is
   * behind a signature or the cron secret, and the evidence is the webhook's.
   * Same day, review of 7e133a7: the sweep now takes its sender as an
   * argument and lifecycle-cron.ts hands it sendLifecycle. And setup_confirmed
   * (R166, 2 Oct 2026) was missing from this bound and from the module's own
   * header, which said "only from the signed Stripe webhook": it goes from the
   * setup route, to the signed-in owner or editor who confirmed, once a
   * client. Both copies now name every caller.
   */
  "src/lib/email/lifecycle-mail.ts": {
    reach: "signed by Stripe",
    bound:
      "Mails only a dashboard owner the webhook stored or read back with removed_at null, or the signed-in " +
      "owner or editor who confirmed setup. Sent only from the Stripe webhook after the signature verifies " +
      "and the event id is newly recorded in stripe_events, from a claimed tracking run when it is the " +
      "client's first finished one, from the setup route after its one setup_confirmed row, or from " +
      "the daily cron behind CRON_SECRET once per client per email (a dashboard_events row claimed " +
      "before the send), and only when its email_<name>_enabled flag is true; every flag starts false.",
    evidence: /if \(!verifyStripeSignature\(raw, signature, secret, nowS\)\) return/,
    where: "src/lib/checkout/webhook.ts",
  },
  /**
   * 30 Sep 2026, BRIEF-2 T11 /ask: a member's ask. Only a signed-in member of
   * the client can post it; it mails us or the account's agency contact
   * (never an address the request carries), and is capped per member a day,
   * counted off cta_events `asked` rows before anything is sent.
   */
  /**
   * 1 Oct 2026, R142 part 2 (BRIEF-4 P2 Team): the team invite. The one
   * sender here whose recipient is typed by the caller - but only a signed-in
   * owner of the client can post it, and it is capped per owner a day.
   */
  "src/lib/tracking/invite-mail.ts": {
    reach: "signed-in owner, limited per owner",
    bound:
      "Needs a dashboard session and the owner role on the client. Mails the address the owner invited, " +
      "with no login token, owner as reply-to. At most INVITES_PER_OWNER_PER_DAY invites an owner a day, " +
      "counted off dashboard_events member_invite rows before the write, and MEMBERS_PER_CLIENT live members who see " +
      "each client the invite adds them to (MEMBERS_PER_ACCOUNT an account until 9 Oct 2026, AG-1; an invite to every " +
      "client counted on every client from the same day, team.ts refuseEveryClient).",
    evidence: /export const INVITES_PER_OWNER_PER_DAY = \d+/,
    where: "src/lib/tracking/team.ts",
  },
  "src/lib/tracking/ask-mail.ts": {
    reach: "signed-in member, limited per member",
    bound:
      "Needs a dashboard session and membership of the client. Mails only our contact destination " +
      "or accounts.upsell_contact_email (written only in /admin/tracking), member as reply-to. At most " +
      "ASKS_PER_MEMBER_PER_DAY asks a member a day, counted off cta_events before the send; off mode sends none.",
    evidence: /export const ASKS_PER_MEMBER_PER_DAY = \d+/,
    where: "src/lib/tracking/ask.ts",
  },
  /**
   * 30 Sep 2026, BRIEF-2 T12 (R96): the Sunday link check's alert to Danny.
   * Called only from runTrackingDay, which runs a claimed tracking_runs row
   * (one per client a day, started by the cron's signed dispatch), and only
   * when isLinkCheckDay says Sunday. One message per client per Sunday, to our
   * own contact destination, nothing when no row alerts.
   */
  /**
   * 9 Oct 2026 (audit reliability-4): a run can be claimed again, after "Run
   * now" asks to re-run a failed, partial or stalled one (rerun.ts claimRerun,
   * a compare-and-swap on the ask; the queued claim is unchanged). A re-run
   * does not repeat the link check (runner.ts, `if (rerun)` inside the Sunday
   * branch), so the bound below still holds: one check per client a Sunday.
   */
  "src/lib/tracking/link-mail.ts": {
    reach: "the tracking runner, once a client a Sunday",
    bound:
      "Mails only our own contact destination. One call per claimed Sunday tracking run, a run " +
      "being one per client a day and claimed by a compare-and-swap on status queued, and a " +
      "re-run of the day not checking again; no alert lines, no message.",
    evidence: /if \(isLinkCheckDay\(day\)\) \{\s*if \(rerun\) \{/,
    where: "src/lib/tracking/runner.ts",
  },
  /**
   * 9 Oct 2026, audit reliability-6 and spec OP-1: the daily run-health
   * summary to Danny. Called from run-health.ts reportRunHealth, through
   * health-io.ts, by a claimed tracking run as it closes and by the
   * CRON_SECRET-gated /api/cron/track after its dispatch. Sent only when the
   * day has settled with a client not complete, and once a day: the claim is
   * a dashboard_events run_health_mail row keyed on props.day, read and then
   * written before the send, and made exact by 20261009000000's unique index.
   * /api/health/runs reads the same health and sends nothing.
   *
   * Later on 9 Oct 2026 (review of 50013ab): a claim is made sent=false and
   * marked sent after the send, and one still unsent ten minutes on - its
   * function stopped before the send - is released by a compare-and-swap and
   * sent by the next reading. So a day's summary is no longer lost to a
   * function stopped mid-send, and a function stopped after the send and
   * before the mark can send it a second time. The bound below moved with it.
   *
   * 13 Oct 2026, DIY P1 (spec 10 section 5.6; review of the P1 build): the
   * summary carries one DIY line, and a day every run was complete sends it
   * too when the DIY night needs a look (paused at a cap, jobs carried, or
   * unreadable), asked for today only. Same claim, same one message a day,
   * same destination; the bound below says so.
   */
  "src/lib/tracking/health-mail.ts": {
    reach: "the tracking runner or the daily cron, once a day",
    bound:
      "Mails only our own contact destination. One message per tracking day: reportRunHealth " +
      "reads the day's run_health_mail claim and writes it before the send (unique per day with " +
      "20261009000000), and sends nothing while a run is in flight or when every run is complete, unless the " +
      "DIY night needs a look that day (13 Oct 2026, DIY P1). A claim " +
      "left unsent for ten minutes by a function stopped before its send is released and sent once more. " +
      "Its callers are a claimed tracking run and the cron behind CRON_SECRET; the health JSON does not send.",
    evidence: /if \(!claimAbandoned\(prior\.props, p\.now\)\) return "taken";[\s\S]*?\.eq\("props->>sent", "false"\)[\s\S]*?\.insert\(\{[^}]*event: RUN_HEALTH_EVENT[\s\S]*?await io\.send\(/,
    where: "src/lib/tracking/run-health.ts",
  },
  /**
   * 2 Oct 2026, R166 step 4 (Danny, danny.md line 175): setup confirmed, to
   * us. Sent only after the setup route writes the one setup_confirmed row;
   * a client already confirmed returns before the write, so it is once a
   * client, whoever presses it again.
   */
  "src/lib/tracking/setup-mail.ts": {
    reach: "signed-in owner or editor, once a client",
    bound:
      "Needs a dashboard session and an owner or editor role on the client (refuseRole). Mails only our own " +
      "contact destination, member as reply-to. Sent after the setup_confirmed insert, which is reached only " +
      "when loadSetupConfirmed found none, so one message a client.",
    evidence: /if \(already\) return done;[\s\S]*?\.insert\(\{[^}]*event: SETUP_CONFIRMED_EVENT[\s\S]*?await sendSetupConfirmed\(/,
    where: "src/app/api/app/[client]/setup/route.ts",
  },
  "src/app/contact/actions.ts": {
    reach: "anonymous",
    bound:
      "Field clamps and a honeypot, and nothing else. The clamps bound the SIZE of one " +
      "message; they do not bound how many. The honeypot stops a bot that fills every " +
      "field it finds and does nothing at all about a post straight to the action id.",
    evidence: /if \(website\) \{/,
    where: "src/app/contact/actions.ts",
  },
  "src/app/actions/waitlist.ts": {
    reach: "anonymous",
    bound:
      "Field clamps and a honeypot, same as the contact action and for the same reason - " +
      "it had neither until the clamps landed on 20 September and the honeypot the day " +
      "after. Same limit: it bounds one message's size, not the count of them.",
    evidence: /if \(website\) \{/,
    where: "src/app/actions/waitlist.ts",
  },
};

/**
 * Every `"use server"` module, and every action it exports.
 *
 * Derived because this is the exact set `spend-gates` cannot see, and a typed
 * list of the invisible things is worth nothing. An export added to either of
 * these files is a new public POST endpoint, and it fails here until it is
 * named.
 */
const ACTIONS: Record<string, string[]> = {
  "src/app/contact/actions.ts": ["submitContactForm"],
  "src/app/actions/waitlist.ts": ["requestScan"],
  // 29 Sep 2026, T2 /admin/tracking. Sends no mail. Each checks the admin's
  // Basic auth itself (refuseUnlessAdmin) before anything, because an action
  // id is answered on any path and the /admin proxy covers only /admin.
  // setUpsell, 29 Sep 2026 (R94): writes accounts.upsell_mode and the agency
  // contact, sends nothing, same admin check first.
  // groupCluster, 30 Sep 2026 (BRIEF-3 C3, R111): makes a cluster or adds to
  // one, moving ungrouped prompts and keywords in through limits.ts. Sends
  // nothing, spends nothing, same admin check first.
  // editTracked and stopTracked, 30 Sep 2026 (R102): fix one prompt's or
  // keyword's text before its first reading, or stop it from tomorrow
  // (admin-edit.ts). Send nothing, spend nothing, delete nothing, same admin check first.
  // logPlacement and updatePlacement, 30 Sep 2026 (R96 part 3, BRIEF-2 T12):
  // write placements rows from /admin/tracking/[client]/placements, fields
  // judged by placements.ts. Send nothing, spend nothing, delete nothing,
  // never touch the link-check columns, same admin check first.
  "src/app/admin/tracking/actions.ts": ["addTracked", "createClientFromScan", "editTracked", "groupCluster", "logPlacement", "runNow", "setMember", "setUpsell", "stopTracked", "updatePlacement"],
};

// --------------------------------------------------------------- the tests

test("the walk read the tree, so a zero here cannot pass as a clean sweep", () => {
  assert.ok(files.length >= 60, `only ${files.length} source files found; the walk is reading the wrong tree`);
  for (const p of [...Object.keys(SENDERS), ...Object.keys(ACTIONS)]) {
    assert.ok(files.some((f) => f.path === p), `${p} is on a list here and is not in the tree any more`);
  }
});

test("exactly the expected modules can send mail", () => {
  const senders = files
    .filter((f) => /from "resend"/.test(f.code))
    .map((f) => f.path)
    .sort();

  assert.deepEqual(
    senders,
    Object.keys(SENDERS).sort(),
    "a module started or stopped being able to send mail. Classify it: say who can reach it " +
      "and what bounds how often, with something in its own source that proves the bound.",
  );
});

test("exactly the expected modules are server actions", () => {
  const actions = files
    .filter((f) => /^\s*["']use server["']/m.test(f.code))
    .map((f) => f.path)
    .sort();

  assert.deepEqual(
    actions,
    Object.keys(ACTIONS).sort(),
    'a "use server" module appeared or moved. Every export of one is a public POST endpoint ' +
      "that no route walk can see - which is the whole reason this file exists.",
  );
});

test("every server action is named, so a new export cannot be a door nobody listed", () => {
  for (const [path, named] of Object.entries(ACTIONS)) {
    const src = files.find((f) => f.path === path)!.code;
    const found = [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]).sort();
    assert.deepEqual(
      found,
      named.slice().sort(),
      `${path} exports a different set of actions. Each one is its own POST endpoint on the ` +
        "open web; say what it does and what bounds it before adding it here.",
    );
  }
});

/**
 * ## The layer this file did not have, found by opening a door it could not see
 *
 * `SENDERS` above is keyed on the modules that import Resend, and on
 * 20 September 2026 a new route was added that mails a scan result. It did not
 * change that set and it did not fail a single test, because it reaches the
 * vendor one hop away - through `report-mail.ts`, which imports `verify-email`,
 * which imports Resend. **A new door onto the bill, green everywhere.**
 *
 * That is this file's own founding species, one layer down: `spend-gates`
 * claimed every billing door and walked `src/app/api` for `route.ts`, so the
 * two server actions were invisible; this claimed every mail door and walked
 * for `from "resend"`, so anything reaching a sender indirectly is invisible.
 * The import-graph fix is the one `spenders.mts` records as discarded for good
 * reason - an import is not a call, and the transitive version reported two
 * routes that only read rows already paid for.
 *
 * So the denominator here is **call sites of the two send functions**, which is
 * neither the importing module nor the import graph. It is the thing the
 * question is actually about: who can cause a message to go.
 *
 * `verify-email.ts` is excluded because it *is* the sender - it declares these
 * functions, and a file's own declaration is not a call. Everything else that
 * names one has to say what bounds it.
 */
const SEND_CALLERS: Record<string, { reach: "anonymous" | "behind the ceilings"; bound: string; evidence: RegExp }> = {
  "src/lib/scan/report-mail.ts": {
    reach: "behind the ceilings",
    bound:
      "One message per scan row, ever. The send is claimed by stamping report_email_sent_at " +
      "with a filtered update that reads the address back out of what it stamped, so the two " +
      "callers - the pipeline at the end of a pass, and the route when the address arrives " +
      "after one - cannot both mail. The count of messages is the count of scans that asked, " +
      "and scans are bounded by the four ceilings in front of every door that starts one.",
    evidence: /\.is\("report_email_sent_at", null\)/,
  },
};

test("exactly the expected files can cause a message to be sent", () => {
  const callers = files
    .filter(
      (f) =>
        !f.path.endsWith("src/lib/scan/verify-email.ts") &&
        /\bsend(?:VerificationEmail|ReportReadyEmail)\s*\(/.test(f.code),
    )
    .map((f) => f.path)
    .sort();

  // Four until 24 September 2026. Three of them were the email gate's - the
  // unlock route, the resend route, and `unlock.ts` itself sending the report
  // - and all three went with it. The floor follows what is there rather than
  // standing at a number nothing can reach, which would fail every run and so
  // be read by nobody.
  assert.ok(callers.length >= 1, `only ${callers.length} call site(s) found - this walk has gone blind`);
  assert.deepEqual(
    callers,
    Object.keys(SEND_CALLERS).sort(),
    "a file started or stopped being able to cause a message to be sent. This is the walk that " +
      "the module-level one above cannot do: a caller reaching a sender indirectly changes no " +
      "import of Resend. Classify it - who can reach it, and what bounds how often.",
  );
});

test("every call site still has the bound it claims, in its own source", () => {
  for (const [path, { evidence, bound }] of Object.entries(SEND_CALLERS)) {
    const src = files.find((f) => f.path === path);
    assert.ok(src, `${path} is on this list and is not in the tree any more`);
    assert.match(
      src.code,
      evidence,
      `${path} claims to be bounded by "${bound}" and the thing proving it is gone from its own ` +
        "source. It is now a door onto a vendor bill with nothing in front of it.",
    );
  }
});

test("every sender still has the bound it claims", () => {
  for (const [path, { evidence, where }] of Object.entries(SENDERS)) {
    const src = readFileSync(join(ROOT, where), "utf8");
    assert.match(
      src,
      evidence,
      `${path} is bounded by something in ${where}, and that is no longer there. It is now a ` +
        "door onto a vendor bill with nothing in front of it.",
    );
  }
});

/**
 * The gap, as an assertion rather than a paragraph.
 *
 * Neither anonymous door takes a per-caller identity, so neither can be rate
 * limited today even in principle: `clientIp` is the only thing in this tree
 * that says who a caller is, and it takes a `Request`, which a server action
 * signature does not have. That is the shape of the question in blocked.md, and
 * it is asserted in both directions - the day one of them grows an identity,
 * this fails and somebody updates the list on purpose.
 */
test("the anonymous mail doors have no per-caller identity, which is the open question", () => {
  const anonymous = Object.entries(SENDERS)
    .filter(([, s]) => s.reach === "anonymous")
    .map(([path]) => path);

  assert.equal(
    anonymous.length,
    2,
    "the number of anonymous mail doors has changed - see docs/blocked.md before editing this",
  );

  for (const path of anonymous) {
    const src = files.find((f) => f.path === path)!.code;
    assert.doesNotMatch(
      src,
      /\bclientIp\s*\(|\bcheckCeilings\s*\(/,
      `${path} now identifies or counts its caller. That is the answer to blocked.md landing: ` +
        "move it off the anonymous list and write down what it is bounded to.",
    );
    assert.ok(
      !/src\/app\/api\//.test(path),
      `${path} moved under src/app/api, where spend-gates.test.mts can see it. Reconcile the ` +
        "two files rather than leaving one door counted twice.",
    );
  }
});

/**
 * The honeypot, on both public forms rather than one.
 *
 * The contact action has read a `website` field since `a22129b`; the waitlist
 * action did not, and the two were the same form facing the same web. That is
 * the species this repo keeps paying for - two copies of one thing where the
 * untested copy is the one missing the guard, same as the date formatter - and
 * it is asserted here because it is the only bound either door has that is
 * about the sender rather than the message.
 */
/**
 * The source census, checked against what the build actually registers.
 *
 * Everything above this reads source. Source is what somebody *wrote*, and the
 * claim being made - that these two exports are live POST endpoints on the open
 * web - is about what Next *ships*. Those are two different questions, and the
 * repo's own rule is that a thing reasoned about is not a thing verified. So
 * this reads `server-reference-manifest.json` out of the build: one entry per
 * action id Next will dispatch, with the pages each is reachable from.
 *
 * Measured 20 September 2026 at `e07c9d5`: two ids, one on `app/contact/page`
 * and one on both `app/page` and `app/scan/page`. **That second pair is the
 * finding worth keeping** - `RequestScanForm` only renders when `scanReady()`
 * is false, so the form is usually invisible, and the action id is registered
 * either way. The door does not close when the form stops being drawn.
 *
 * It is also the two-way street on this file itself. Everything above proves
 * the source names two actions; only this proves the build does not register a
 * third from somewhere neither walk looked.
 */
test("the build registers exactly the actions the source census found", (t) => {
  const MANIFEST = join(ROOT, ".next", "server", "server-reference-manifest.json");
  if (!existsSync(MANIFEST)) {
    t.skip("no build to read - run `npm run build` first");
    return;
  }

  type Entry = { filename?: string; exportedName?: string; workers?: Record<string, unknown> };
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    node?: Record<string, Entry>;
    edge?: Record<string, Entry>;
  };
  /**
   * Both runtimes, not just `node`. `edge` is empty today and a check that read
   * only the populated half would be a denominator chosen by what happened to
   * be there - the error this whole file is about.
   */
  const entries = Object.entries({ ...(manifest.node ?? {}), ...(manifest.edge ?? {}) });

  /**
   * Compared by name, not by count. The manifest carries the source file and
   * the export for every id it registers, so this can assert the *same* two
   * exports rather than merely two of something - a count matches just as well
   * when one action is deleted and an unrelated one is added.
   */
  const registered = entries
    .map(([, e]) => `${e.filename} # ${e.exportedName}`)
    .sort();
  const censused = Object.entries(ACTIONS)
    .flatMap(([path, names]) => names.map((n) => `${path} # ${n}`))
    .sort();

  assert.deepEqual(
    registered,
    censused,
    "the build registers a different set of server actions from the one the source walk found. " +
      "Every one is a POST endpoint anybody can reach; reconcile the two before shipping.",
  );

});

/**
 * Every registered action is reachable from at least one page.
 *
 * An id with no worker is one nothing can dispatch, and a census counting it
 * would report a door that is not there - the opposite error, and just as
 * wrong. It is **its own test** rather than a second assertion in the one
 * above, and that is not tidiness: the injection harness reports which named
 * subtest fired, so two assertions under one name make a case landing in the
 * wrong branch indistinguishable from one landing in the right one. Three
 * manifest injections all reported the same name until this was split.
 */
test("every registered action is reachable from at least one page", (t) => {
  const MANIFEST = join(ROOT, ".next", "server", "server-reference-manifest.json");
  if (!existsSync(MANIFEST)) {
    t.skip("no build to read - run `npm run build` first");
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    node?: Record<string, { filename?: string; exportedName?: string; workers?: Record<string, unknown> }>;
    edge?: Record<string, { filename?: string; exportedName?: string; workers?: Record<string, unknown> }>;
  };
  for (const [id, e] of Object.entries({ ...(manifest.node ?? {}), ...(manifest.edge ?? {}) })) {
    assert.ok(
      Object.keys(e.workers ?? {}).length > 0,
      `${e.filename} # ${e.exportedName} (${id.slice(0, 12)}) is registered and reachable from no page`,
    );
  }
});

test("both public forms carry the honeypot, and both answer a filled one with a success", () => {
  /**
   * The answer is matched from inside the branch, not anywhere in the file.
   *
   * The first draft of this asserted that a success return existed *somewhere*
   * in the module, which both of these have anyway on the ordinary path - so it
   * would have passed with the honeypot returning an error, which is the one
   * thing it is here to forbid. That is this repo's blind-tripwire recipe
   * exactly: an assertion that cannot fail is a pass that means nothing.
   */
  const ANSWER: Record<string, RegExp> = {
    "src/app/contact/actions.ts": /if \(website\) \{[\s\S]{0,600}?return \{ status: "success" \};/,
    "src/app/actions/waitlist.ts": /if \(website\) \{[\s\S]{0,600}?return \{ ok: true \};/,
  };

  for (const [path, s] of Object.entries(SENDERS)) {
    if (s.reach !== "anonymous") continue;
    const src = files.find((f) => f.path === path)!.code;
    assert.match(src, ANSWER[path], `${path} must answer a filled honeypot with a success, or the refusal ` +
      "tells whoever is probing which field gave them away");
  }
});
