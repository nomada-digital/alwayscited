import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { code, sendCalls } from "../lib/source-read.mts";
import { MAIL_FROM_FALLBACK, mailFrom } from "./mail-from.ts";

/**
 * The address on the envelope of every message this product sends.
 *
 * `email-header.test.mts` already walks every `emails.send` in the tree - it
 * was written for exactly this denominator, after `contact.test.mts` was found
 * to be right about every assertion while reading one file. It reads **one of
 * the five fields**: the subject. `replyTo` is guarded by `isPlausibleEmail`,
 * whose `[^\s@]` idiom makes a header terminator unreachable, so wrapping it
 * would be a guard with no effect and this repo deletes those. `from` and
 * `to` were read by nothing at all.
 *
 * Take a check that is right about everything it names and ask what it is not
 * looking at. It was looking at four subjects and not at four From lines -
 * and not at four recipients, which is the refill at the bottom of this file
 * and the more serious of the two.
 *
 * **What it found.** `process.env.SCAN_FROM_EMAIL ?? "alwayscited
 * <onboarding@resend.dev>"`, typed verbatim four times in three files - the
 * contact action, the waitlist action, and both sends in `verify-email.ts`.
 * `config/mail-from.ts` holds it once now, for the reasons in its own header.
 *
 * **What was watching it, and why that was not reading it.**
 * `readiness.test.mts` asserted `senders.length >= 3` over files containing
 * the string `SCAN_FROM_EMAIL`. Every word of that was true and it justified
 * the variable's place on the readiness list. It could not notice a sender
 * dropping off - a floor of three over four - and it never looked at the
 * value. That assertion is narrowed to "exactly one module reads it" in the
 * same push, because the other half is here.
 *
 * **Two directions, because a one-way check is this repo's recurring defect.**
 * Nothing else may type the literal or read the variable; and every send in
 * the tree must take its `from` from the one reader. The first alone passes a
 * tree where a fifth sender hardcodes a different address; the second alone
 * passes a tree where the module exists and three copies remain beside it.
 *
 * **What this cannot see.** Whether the address is one we own, or whether
 * mail from it is delivered. That is blocked.md 20 and a statement about a
 * vendor, and no source inside this repo settles it. What it does do is make
 * the absence executable: the fallback domain is asserted to still be
 * `resend.dev`, so the day it moves to a domain we own this fails and the
 * blocked item has to be closed rather than quietly outliving its answer -
 * the same device `organization-entity.test.mts` uses for the missing
 * `sameAs`.
 *
 * Proved against twelve injections (`docs/inject-mail-from.mjs`), 12/12, two
 * of them green-expected. The green cases are not decoration: the first of them
 * caught this push's own defect, a `readiness.test.mts` census reading raw
 * source and reporting a doc comment as a reader. The fifth-send case is what
 * earns the list below over a floor, and it had to be injected as an ADDED
 * send rather than a removed one - removing a call means removing a block,
 * and a half-removed call is a build failure, which is not a caught defect.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(child));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(child);
  }
  return out;
}

function posix(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

const FILES = sourceFiles(SRC);

/** The one file allowed to decide the address. */
const HOME = "src/config/mail-from.ts";

/**
 * One named field of a send, read to the end of its line.
 *
 * Same reasoning as `subjectOf` one file over: to the end of the line rather
 * than to the next comma, because a comma-terminated read cuts a call
 * expression in half and would report `mailFrom()` as something else the day
 * it takes an argument. It also keeps the whole of
 * `process.env.CONTACT_EMAIL_DESTINATION ?? CONTACT_EMAIL`, which a
 * comma-terminated read would not, and that expression is the thing the
 * recipient rule has to judge rather than half of it.
 */
function fieldOf(call: string, name: string): string | null {
  const m = new RegExp(`\\n\\s*${name}:\\s*(.+?),?\\s*\\n`).exec(call);
  return m ? m[1]!.trim() : null;
}

const fromOf = (call: string) => fieldOf(call, "from");
const toOf = (call: string) => fieldOf(call, "to");

// ------------------------------------------------------------- the reader

test("an unset variable falls back, and a set one wins", () => {
  const before = process.env.SCAN_FROM_EMAIL;
  try {
    delete process.env.SCAN_FROM_EMAIL;
    assert.equal(mailFrom(), MAIL_FROM_FALLBACK);

    process.env.SCAN_FROM_EMAIL = "alwayscited <hello@alwayscited.com>";
    assert.equal(mailFrom(), "alwayscited <hello@alwayscited.com>");
  } finally {
    if (before === undefined) delete process.env.SCAN_FROM_EMAIL;
    else process.env.SCAN_FROM_EMAIL = before;
  }
});

test("a bare address is given the name, and a named one is left alone (22 Oct 2026)", () => {
  // Production's value is bare, and inboxes showed the sender as "hello".
  const before = process.env.SCAN_FROM_EMAIL;
  try {
    process.env.SCAN_FROM_EMAIL = "hello@alwayscited.com";
    assert.equal(mailFrom(), "alwayscited <hello@alwayscited.com>");
    process.env.SCAN_FROM_EMAIL = "  hello@alwayscited.com ";
    assert.equal(mailFrom(), "alwayscited <hello@alwayscited.com>");
    process.env.SCAN_FROM_EMAIL = "Danny at alwayscited <danny@alwayscited.com>";
    assert.equal(mailFrom(), "Danny at alwayscited <danny@alwayscited.com>");
    process.env.SCAN_FROM_EMAIL = '"alwayscited" <hello@alwayscited.com>';
    assert.equal(mailFrom(), '"alwayscited" <hello@alwayscited.com>');
  } finally {
    if (before === undefined) delete process.env.SCAN_FROM_EMAIL;
    else process.env.SCAN_FROM_EMAIL = before;
  }
});

test("a variable set to nothing falls back rather than sending from nowhere", () => {
  /**
   * The one behavioural change in this push, and the reason the four call
   * sites' `??` became `||`.
   *
   * An environment variable created and left blank stores an empty string,
   * not an absent one, and `??` passes that straight through: all four sends
   * go out with `from: ""`, Resend refuses every one, and three of the four
   * paths log it and return, so what a visitor sees is mail that silently
   * stops. The unlock mail is one of those three. An empty string is not an
   * address, and the fallback exists for the case where the variable cannot
   * be used.
   */
  const before = process.env.SCAN_FROM_EMAIL;
  try {
    process.env.SCAN_FROM_EMAIL = "";
    assert.equal(mailFrom(), MAIL_FROM_FALLBACK);
  } finally {
    if (before === undefined) delete process.env.SCAN_FROM_EMAIL;
    else process.env.SCAN_FROM_EMAIL = before;
  }
});

// ------------------------------------------------- direction one: one copy

test("the literal address is typed in exactly one file", () => {
  const typed = FILES.filter((f) => code(readFileSync(f, "utf8")).includes("onboarding@resend.dev"));
  assert.deepEqual(
    typed.map(posix),
    [HOME],
    "the From address is typed outside its one module - four copies is how this started",
  );
});

test("the environment variable is read in exactly one file", () => {
  const readers = FILES.filter((f) => code(readFileSync(f, "utf8")).includes("process.env.SCAN_FROM_EMAIL"));
  assert.deepEqual(
    readers.map(posix),
    [HOME],
    "a sender reads SCAN_FROM_EMAIL directly, so it has its own fallback",
  );
});

// ------------------------------------------- direction two: every send uses it

/**
 * The sends, derived by walking rather than named.
 *
 * `sendCalls` is shared with `email-header.test.mts` through
 * `lib/source-read.mts` rather than copied, so the two sweeps cannot come to
 * disagree about what a send is. If that reader narrows, both narrow together
 * - and both carry a floor, which is what makes a narrowing fail rather than
 * read as a clean tree.
 *
 * It lives in a helper rather than in either test because the first draft
 * imported it straight out of `email-header.test.mts`, which works and
 * silently makes node run that entire suite a second time.
 */
function sends(): { file: string; from: string | null; to: string | null }[] {
  const out: { file: string; from: string | null; to: string | null }[] = [];
  for (const f of FILES) {
    for (const call of sendCalls(readFileSync(f, "utf8"))) {
      out.push({ file: posix(f), from: fromOf(call), to: toOf(call) });
    }
  }
  return out;
}

/**
 * Every place this product puts a message on Resend, and why each is here.
 *
 * A floor alone would not do. `input-bounds.test.mts` records the reason: a
 * count cannot notice one whole KIND going missing, and these are sends of
 * three kinds - two anonymous public forms, one piece of funnel mail, and one
 * alert to us. The per-file count is what catches a kind disappearing inside a
 * file that still sends something, which is exactly what happened on 24 Sep
 * 2026 when `verify-email.ts` went from two sends to one.
 */
const SENDERS: { file: string; sends: number; why: string }[] = [
  {
    file: "src/app/contact/actions.ts",
    sends: 1,
    why: "the contact form - anonymous, no captcha, mails CONTACT_EMAIL_DESTINATION (mail-doors.test.mts)",
  },
  {
    file: "src/app/actions/waitlist.ts",
    sends: 1,
    why: "the waitlist form - the other anonymous door, reachable by its action id whether or not the form renders",
  },
  {
    file: "src/lib/scan/verify-email.ts",
    sends: 1,
    why: "the report mail - the one that goes to a visitor rather than to us. Two until 24 Sep 2026: `sendVerificationEmail` went with the email gate, having lost its last caller when the unlock, resend and verify routes were deleted",
  },
  {
    file: "src/lib/scan/walkthrough-mail.ts",
    sends: 1,
    why: "the walkthrough alert, 24 Sep 2026 - to us, at the contact destination, with the visitor as reply-to only",
  },
  {
    file: "src/lib/tracking/login-mail.ts",
    sends: 1,
    why: "the dashboard login link, 29 Sep 2026 (T3) - to a stored dashboard member, capped per address and per IP an hour",
  },
  {
    file: "src/lib/checkout/order-mail.ts",
    sends: 1,
    why: "the order email, 30 Sep 2026 (BRIEF-3 C4, pricing spec section 5) - to us at the contact destination, only from the signed Stripe webhook, once per event id",
  },
  {
    file: "src/lib/tracking/ask-mail.ts",
    sends: 1,
    why: "a signed-in member's ask, 30 Sep 2026 (BRIEF-2 T11 /ask) - to us, or to the account's agency contact in agency mode, member as reply-to, 3 per member a day",
  },
  {
    file: "src/lib/tracking/invite-mail.ts",
    sends: 1,
    why: "the team invite, 1 Oct 2026 (R142 part 2, BRIEF-4 P2) - to the address a signed-in owner invited, owner as reply-to, no login token, 20 per owner a day",
  },
  {
    file: "src/lib/tracking/link-mail.ts",
    sends: 1,
    why: "the Sunday placement link check's alert, 30 Sep 2026 (BRIEF-2 T12, R96) - to us at the contact destination, from the tracking runner, one per client a Sunday when a link has gone",
  },
  {
    file: "src/lib/tracking/setup-mail.ts",
    sends: 1,
    why: "setup confirmed, 2 Oct 2026 (R166 step 4) - to us at the contact destination, member as reply-to, once a client after the setup_confirmed row is written",
  },
  {
    file: "src/lib/tracking/health-mail.ts",
    sends: 1,
    why: "the daily run-health summary, 9 Oct 2026 (audit reliability-6, spec OP-1) - to us at the contact destination, from a closing tracking run or the daily cron, once a tracking day when a client's run is not complete",
  },
  {
    file: "src/lib/email/lifecycle-mail.ts",
    sends: 1,
    // "only from the signed Stripe webhook" until 8 Oct 2026 (review of 7e133a7): the runner,
    // the setup route and the daily cron call it too; lifecycle-mail.ts's header names each.
    why: "the lifecycle emails, 1 Oct 2026 (R159 part 3) - to a dashboard owner or the member who confirmed setup, from the signed Stripe webhook, the tracking runner, the setup route and the CRON_SECRET-gated daily cron, each behind its email_<name>_enabled flag, all false",
  },
];

test("the send census still finds every sender, and the right number in each", () => {
  const counted = new Map<string, number>();
  for (const s of sends()) counted.set(s.file, (counted.get(s.file) ?? 0) + 1);

  assert.deepEqual(
    [...counted.entries()].sort(),
    SENDERS.map((s) => [s.file, s.sends] as [string, number]).sort(),
    "the set of senders has moved - add it above with a reason, or the sweep below is narrower than it reads",
  );
  for (const s of SENDERS) assert.ok(s.why.length > 20, `${s.file} is listed with no reason`);
});

test("every send takes its From from the one reader", () => {
  const all = sends();
  // A reader that has stopped matching returns a clean list, which is the
  // state every sweep in this tree has been caught in at least once.
  // 5 since 29 Sep 2026: the dashboard login link (T3). 6 since 30 Sep 2026:
  // the order email from the Stripe webhook (C4). 7 since 30 Sep 2026: a
  // member's ask from the dashboard (T11 /ask). 8 since 30 Sep 2026: the
  // Sunday link check's alert (T12, R96). 9 since 1 Oct 2026: the team
  // invite (R142 part 2, BRIEF-4 P2). 10 since 1 Oct 2026: the lifecycle
  // emails (R159 part 3), flag-gated. 11 since 2 Oct 2026: setup confirmed
  // (R166 step 4). 12 since 9 Oct 2026: the run-health summary (audit
  // reliability-6, OP-1).
  assert.equal(all.length, 12, `expected 12 sends, the walk found ${all.length}`);

  for (const s of all) {
    assert.equal(s.from, "mailFrom()", `${s.file} sets its own From: ${s.from}`);
  }
});

// ------------------------------------------ the refill: the field beside it

/**
 * Who each send is addressed to, and why that is somebody we may write to.
 *
 * Asked of the sweep above the moment it went green, which is the rule this
 * tree keeps paying for: every test you write creates the next candidate.
 * That one reads the `from` of every send. The field beside it decides
 * whether this product mails a stranger, and **AGENTS.md puts contacting
 * anyone on the absolute list** - above "ship it rough", alongside
 * credentials and destructive DDL.
 *
 * It was asserted nowhere. The property is written down three times in prose
 * - blocked.md 24 ("Both anonymous doors send to `CONTACT_EMAIL_DESTINATION`,
 * so neither can be used to mail somebody else from us"), the queue, and
 * `mail-doors.test.mts`'s own header - and `mail-doors` walks modules,
 * bounds, honeypots and the action manifest without ever reading a
 * recipient. A stated reason for a safety property is a claim about the tree
 * and it costs a `holds` now; that is the lesson `349dcda` left.
 *
 * **The defect it refuses is one word.** `waitlist.ts` has a stranger's
 * address in scope on the line above its send, as `replyTo: email`. Typing
 * it into `to` instead turns an anonymous, captcha-free, unrate-limited POST
 * into something that mails an arbitrary address from our domain. Nothing in
 * this tree noticed that before.
 *
 * Per call, not per file, for the reason `email-header.test.mts` records
 * about this exact file: `verify-email.ts` has two sends, so a rule satisfied
 * by "the right recipient appears somewhere in this module" is satisfied by
 * the correct send while the one beside it addresses somebody else.
 */
const RECIPIENTS: { to: string; why: string }[] = [
  {
    to: "process.env.CONTACT_EMAIL_DESTINATION ?? CONTACT_EMAIL",
    // 9 Oct 2026: the run-health summary (health-mail.ts) is addressed the same way, as the
    // order email, the link alert and setup confirmed already were.
    why: "us - the waitlist door, whose destination a deployment may repoint but which is never a value a caller supplies",
  },
  {
    to: "CONTACT_EMAIL_DESTINATION",
    why: "us - the contact door, the same constant read once at the top of that module",
  },
  {
    to: "input.email",
    why: "the visitor's own address, for their own scan - the verification mail proves it and the report mail is sent after it was proved. Not a third party's under any branch: nothing else writes that field",
  },
  {
    to: "input.agencyContact ?? process.env.CONTACT_EMAIL_DESTINATION ?? CONTACT_EMAIL",
    why: "us, or the account's agency contact (T11 /ask, 30 Sep 2026) - accounts.upsell_contact_email, which only Nomada writes through /admin/tracking setUpsell; the /ask route reads it from the member's own account, never from the request",
  },
  {
    to: "input.to",
    why: "the address a signed-in owner invited to their own client's dashboard (R142 part 2, 1 Oct 2026; BRIEF-4 P2) - typed by the owner, not a stranger: the member route checks session, membership and the owner role, writes the member row first, and caps it at INVITES_PER_OWNER_PER_DAY",
  },
  {
    to: "input.memberEmail",
    why: "a dashboard member's stored address (T3, 29 Sep 2026) - the login route reads it back from dashboard_members, which only Nomada writes through /admin/tracking, and passes that rather than the typed one. Since 1 Oct 2026 (R159 part 3) also the lifecycle sender's: the owner the Stripe webhook just stored from the paid Session's email, or the client's live owners read back with removed_at null",
  },
];

test("every send is addressed to somebody we are allowed to write to", () => {
  const all = sends();
  // 5 since 29 Sep 2026: the dashboard login link (T3). 6 since 30 Sep 2026:
  // the order email from the Stripe webhook (C4). 7 since 30 Sep 2026: a
  // member's ask from the dashboard (T11 /ask). 8 since 30 Sep 2026: the
  // Sunday link check's alert (T12, R96), to the contact destination. 9 since
  // 1 Oct 2026: the team invite (R142 part 2), to the address an owner invited.
  // 10 since 1 Oct 2026: the lifecycle emails (R159 part 3), to a stored owner.
  // 11 since 2 Oct 2026: setup confirmed (R166 step 4), to the contact destination.
  // 12 since 9 Oct 2026: the run-health summary (audit reliability-6, OP-1), to the contact destination.
  assert.equal(all.length, 12, `expected 12 sends, the walk found ${all.length}`);

  const allowed = new Map(RECIPIENTS.map((r) => [r.to, r.why]));
  for (const s of all) {
    assert.ok(
      s.to !== null && allowed.has(s.to),
      `${s.file} mails ${s.to} - an unlisted recipient. If it is legitimate, add it to RECIPIENTS with the reason it is not a stranger`,
    );
  }
  for (const r of RECIPIENTS) assert.ok(r.why.length > 20, `${r.to} is allowed with no reason`);
});

test("the recipient reader can still see a send addressed to a caller's string", () => {
  const bad = sendCalls("emails.send({\n  from: mailFrom(),\n  to: email,\n  subject: x,\n})");
  assert.equal(toOf(bad[0]!), "email", "the recipient reader no longer sees a bare identifier");
  assert.equal(toOf(sendCalls("emails.send({\n  from: mailFrom(),\n  to: input.email,\n})")[0]!), "input.email");
});

test("the From reader can still see a send that sets its own address", () => {
  /**
   * The guard the sweeps here learned at `75ff8d6`. A clean tree and a broken
   * `fromOf` produce the same empty result, so the reader is shown finding a
   * bad From and shown accepting a good one before an empty result from it is
   * believed.
   */
  const bad = sendCalls('emails.send({\n  from: "someone@example.test",\n  subject: x,\n})');
  assert.equal(bad.length, 1, "sendCalls no longer slices a send");
  assert.equal(fromOf(bad[0]!), '"someone@example.test"');

  const good = sendCalls("emails.send({\n  from: mailFrom(),\n  subject: x,\n})");
  assert.equal(fromOf(good[0]!), "mailFrom()");
});

// --------------------------------------------------------- the open question

test("the fallback still points at a domain we do not own", () => {
  /**
   * blocked.md 20, made executable rather than left as prose.
   *
   * This is not an assertion that `resend.dev` is correct - it is the opposite.
   * The item is open because our own transactional mail should not default to
   * somebody else's domain, and an open item nothing measures is one that
   * outlives its answer. The day the fallback moves to a domain we control,
   * this fails, and closing it means closing blocked.md 20 in the same edit.
   *
   * What is deliberately not claimed: whether mail from this address is
   * delivered, refused or filtered. That is a statement about a vendor, vendor
   * docs are unreachable from this session (blocked.md 21), and nothing on the
   * site says one.
   */
  assert.ok(
    MAIL_FROM_FALLBACK.endsWith("@resend.dev>"),
    "the fallback has moved off resend.dev - settle blocked.md 20 and delete this test",
  );
});
