import { NextResponse } from "next/server";

import { SCAN_LIMITS } from "@/config/contact";
import { isPlausibleEmail, normalizeEmail } from "@/lib/email-address";
import { clientIp, hashIp } from "@/lib/scan/ip";
import { MAIL_OUTCOMES, type MailOutcome } from "@/lib/scan/mail-outcome";
import { sendRequestedReport } from "@/lib/scan/report-mail";
import { reportMailWaitMessage, reportMailWaitMs } from "@/lib/scan/report-mail-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkLeadEmail } from "@/lib/scan/lead-email";
import { domainTakesMail } from "@/lib/scan/lead-email-mx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Do not have time to wait? We will email it to you." - Danny, item 5, and his
 * own idea.
 *
 * Offered while a scan is reading. It is not a speed fix: **it converts a
 * bounce into a captured address.** Everybody who gives up at ninety seconds is
 * lost silently today, and the visitor who takes this offer is the one already
 * on their way out.
 *
 * All this route does is put the address on the scan row. The message is sent
 * by `sendRequestedReport`, from whichever of two places notices the pass is
 * finished - normally the pipeline, at the moment it writes the completed
 * status. **That is what makes leaving safe**: the pass is server-side and has
 * never cared about the tab, so the address only needed somewhere to live that
 * outlives the browser.
 *
 * ## POST only, and why that matters here
 *
 * This route puts a message on Resend's bill, so it is one of the doors
 * `spenders.mts` walks for and `paid-get.test.mts` asks about. `robots.txt`
 * closes `/scan/` and not every query shape, so a spending GET is every crawler
 * on the internet spending. There is no GET export.
 *
 * ## What bounds it
 *
 * **One message per scan, ever**, and the bound is not here - it is the
 * compare-and-swap inside `sendRequestedReport`, which stamps
 * `report_email_sent_at` and reads the address back out of what it stamped. So
 * this route can be posted a hundred times and the hundred posts write one
 * column; the number of messages is the number of scans that asked, and scans
 * are bounded by the four ceilings in front of every door that starts one.
 *
 * **And a cooldown per caller**, added 20 September 2026 with Danny's decision
 * that this send needs no verification step. His words: "an unverified address
 * is a send endpoint anybody can point at a stranger... without it this is a
 * form that mails arbitrary people on request." One address per scan was
 * already true; what was missing was anything at all across scans, and the
 * per-scan bound does nothing against a caller holding several tokens.
 *
 * The caller is hashed with `hashIp`, the same function `ip_scans_per_day`
 * counts under, and stamped on the row as `report_email_ip_hash` in the same
 * write that takes the address. **Not read back off `scans.ip_hash`**, which is
 * whoever started the scan: the 30-day domain cache hands one visitor another
 * visitor's completed scan and token without inserting a row, so the caller
 * this limit most wants to find has no `ip_hash` row of their own anywhere.
 * Stamping it here is what makes the count follow whoever asked for a message.
 *
 * The refusal is a 429 and it fails **closed** - a cooldown read that errors
 * refuses. `ceilings.ts` records why in its own header: a guard whose read did
 * not answer used to be a guard that was simply off. The cost of the wrong
 * refusal here is a visitor waiting fifteen minutes for a copy of a page that
 * is already on their screen.
 *
 * ## Why a disposable address is accepted here and refused by the unlock
 *
 * The unlock refuses them, and should: there the address is the *price* of the
 * gated report, and a throwaway address buys it with nothing. Here the address
 * is not a price. The free result is free, it is already on the visitor's
 * screen, and they are asking for a copy of what they can see - so refusing
 * would deny somebody the thing they asked for, for a lead-quality reason that
 * does not apply to this door. Deliberate; do not "tidy" the two into
 * agreement, and do not copy that list into this file to do it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  // R151 (3 Oct 2026): the form posts here without script too. The answer is
  // the same; a form post gets it as a 303 back to the scan carrying only the
  // outcome's code (mail-outcome.ts), never the address.
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "bad_request" }, { status: 400 });
    const res = await answer(req, token, { email: String(form.get("email") ?? "") });
    const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    const code =
      json.error === "too_soon" ? "soon"
      : (Object.keys(MAIL_OUTCOMES) as MailOutcome[]).find((k) => MAIL_OUTCOMES[k].message === json.message) ?? "failed";
    return NextResponse.redirect(new URL(`/scan/${encodeURIComponent(token)}?mail=${code}`, req.url), 303);
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  return answer(req, token, body);
}

async function answer(req: Request, token: string, body: { email?: string }): Promise<Response> {

  const email = normalizeEmail(body.email ?? "");

  /**
   * The bound the server reads, not the one the input carries.
   *
   * `SCAN_LIMITS.email` is 254, the longest an address may be over SMTP, and it
   * is the same constant the field's `maxLength` uses - which stops a visitor
   * typing and stops nothing at all about a post that never rendered the page.
   * What is unbounded without this is the `to:` header of a message we pay to
   * send and a `text` column that will take whatever arrives.
   */
  if (email.length > SCAN_LIMITS.email) {
    return Response.json(
      { error: "bad_email", message: MAIL_OUTCOMES.long.message },
      { status: 400 },
    );
  }
  /**
   * And the shape, through the one validator.
   *
   * It is also the half of header safety that `headerSafe` does not cover:
   * neither side of the address may hold whitespace, so a newline cannot reach
   * the `to:` header by construction. `headerSafe` guards the subject, inside
   * `sendReportReadyEmail`.
   */
  if (!isPlausibleEmail(email)) {
    return Response.json(
      { error: "bad_email", message: MAIL_OUTCOMES.bad.message },
      { status: 400 },
    );
  }
  // 4 Nov 2026 (UX audit, Danny): a personal address is accepted and flagged, as the report gate does; a disposable
  // inbox or a domain with no mail server is refused (lib/scan/lead-email.ts).
  const lead = checkLeadEmail(email);
  if (!lead.ok) {
    return Response.json({ error: "bad_email", message: MAIL_OUTCOMES.disposable.message }, { status: 400 });
  }
  if (!lead.internal && !(await domainTakesMail(lead.domain))) {
    return Response.json({ error: "bad_email", message: MAIL_OUTCOMES.nomail.message }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: scan, error: readErr } = await db
    .from("scans")
    .select("id, status, report_email_sent_at")
    .eq("public_token", token)
    .maybeSingle();

  // A read that failed is not a token that does not exist - the same
  // distinction the status route draws, and for the same reason: a database
  // fault reported as a 404 sends whoever debugs this looking for a bad token.
  if (readErr) {
    console.warn(`[scan] could not read a scan to email its report: ${readErr.message}`);
    return Response.json(
      { error: "read_failed", message: "We could not reach the checker. Please try again." },
      { status: 502 },
    );
  }
  if (!scan) return Response.json({ error: "not_found" }, { status: 404 });

  /**
   * A pass that failed has no report to mail.
   *
   * The screen sends that visitor back to confirm with the offer to run it
   * again, so there is a real path for them - and taking an address to send a
   * measurement that does not exist is a promise this route cannot keep.
   */
  if (scan.status === "failed") {
    return Response.json(
      { error: "run_failed", message: MAIL_OUTCOMES.unfinished.message },
      { status: 409 },
    );
  }

  // Already sent. Saying so is better than silently taking the address again:
  // the message is claimed and no second one will go, and the commonest reason
  // somebody re-submits is that they think the first attempt did nothing.
  if (scan.report_email_sent_at) {
    return Response.json({ sent: true, email, message: MAIL_OUTCOMES.already.message });
  }

  /**
   * The per-caller cooldown, and the one read it costs.
   *
   * After the not-found and the already-sent branches on purpose: a caller
   * posting a token that does not exist has caused no message and should not
   * spend somebody's window, and a scan whose message has already gone answers
   * truthfully without sending anything. Before the write, because the write is
   * what a later send reads.
   *
   * `.neq("id", scan.id)` is what makes this a limit across scans rather than a
   * second copy of the per-scan bound. Posting the same token twice is already
   * handled above; what this asks is whether this caller has recently caused a
   * message on a *different* scan.
   */
  const ip = clientIp(req);
  let ipHash: string;
  try {
    ipHash = hashIp(ip);
  } catch (err) {
    // hashIp throws without IP_HASH_SALT, which is the state in which no
    // per-caller limit on this site works at all. Refusing is the only honest
    // answer from a door whose whole justification is that it is limited.
    console.error(
      "[scan] cannot rate limit a report email send: " + (err instanceof Error ? err.message : String(err)),
    );
    return Response.json(
      { error: "limit_unavailable", message: "We could not send that just now. Please try again." },
      { status: 503 },
    );
  }

  const { data: recent, error: recentErr } = await db
    .from("scans")
    .select("report_email_at")
    .eq("report_email_ip_hash", ipHash)
    .neq("id", scan.id)
    .not("report_email_at", "is", null)
    .order("report_email_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentErr) {
    console.warn(`[scan] could not read the report email cooldown: ${recentErr.message}`);
    return Response.json(
      { error: "limit_unavailable", message: "We could not send that just now. Please try again." },
      { status: 503 },
    );
  }

  const waitMs = reportMailWaitMs(recent?.report_email_at as string | null, Date.now());
  if (waitMs > 0) {
    return Response.json(
      { error: "too_soon", message: reportMailWaitMessage(waitMs) },
      { status: 429, headers: { "retry-after": String(Math.ceil(waitMs / 1000)) } },
    );
  }

  const { error: writeErr } = await db
    .from("scans")
    .update({ report_email: email, report_email_at: new Date().toISOString(), report_email_ip_hash: ipHash, email_free_domain: lead.free })
    .eq("id", scan.id)
    // Not over a message that has already gone. The read above is a tick old
    // and the pipeline can complete between the two, so the filter is the thing
    // that actually holds it rather than the branch above.
    .is("report_email_sent_at", null);

  if (writeErr) {
    console.warn(`[scan] could not record a report email address for ${scan.id}: ${writeErr.message}`);
    return Response.json(
      { error: "write_failed", message: "We could not save that address. Please try again." },
      { status: 502 },
    );
  }

  /**
   * The scan has already finished, so nothing is coming to send it.
   *
   * A real case rather than a tidy one: the offer is on screen for the whole of
   * the reading phase, which is the longest part of the run, and a pass can
   * complete while somebody is typing their address. Without this the visitor
   * who took the offer a second too late is the only one it never reaches.
   *
   * Awaited rather than deferred: `sendRequestedReport` claims before it sends,
   * so this cannot double up with the pipeline's own call, and the response is
   * worth being honest in.
   */
  if (scan.status === "complete") {
    await sendRequestedReport(scan.id);
    return Response.json({ sent: true, email, message: MAIL_OUTCOMES.sent.message });
  }

  return Response.json({
    queued: true,
    email,
    message: MAIL_OUTCOMES.queued.message,
  });
}
