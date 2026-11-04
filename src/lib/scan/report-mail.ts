import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type { ReportCluster } from "./email-render";
import { type CountableAnswer, reportCounts } from "./report-counts";
import { externalPartner } from "./handoff";
import { sendReportReadyEmail } from "./verify-email";

/**
 * Mailing the free result to somebody who asked for it and left - Danny's
 * item 5, and his own idea: everybody who gives up at ninety seconds is
 * currently lost silently.
 *
 * ## One door, two callers, one message
 *
 * The address is given while the scan is running, so the send has to happen
 * from whichever of two places notices the scan is finished:
 *
 * - `runScan`, the moment it writes the completed status. The ordinary case.
 * - the route itself, when the address arrives after the pass has already
 *   completed - which is a real race and not a curiosity, because the offer is
 *   on screen for the whole of the reading phase and a scan can finish while
 *   somebody is typing.
 *
 * Both call this. `claim` is what stops them both sending: a filtered update
 * that stamps `report_email_sent_at` and hands back the address it stamped, so
 * exactly one caller gets a row. That is the same compare-and-swap the confirm
 * route and both passes use, and it is here rather than in either caller for
 * the reason `knownEngines` is not beside either of its readers - it is a fact
 * about the column.
 *
 * ## What it must not promise
 *
 * The message links to `/scan/<token>`, which serves the free result and the
 * gate exactly as the screen would have. So the mail delivers what the visitor
 * was already looking at and nothing the gate withholds - `reportText` says
 * "Open your report" and names no placement list, and
 * `report-mail.test.mts` holds that.
 *
 * Never throws. Both callers are on a path that has already succeeded: one has
 * just completed a paid scan, the other has already answered the visitor.
 */

/** The columns a send needs, all of them already on the row. */
const SEND_COLUMNS = "id, domain, brand_name, public_token, report_email, cluster_keyword, cluster_keyword_status, ref";

/**
 * Take the send, or find there is nothing to take.
 *
 * Returns the row only to the caller that stamped it. `.select()` is what makes
 * that legible: PostgREST answers an UPDATE that matched nothing with a 2xx, so
 * without it a lost claim and a won one are the same result - the trap this
 * repo has now fixed in the unlock path, both passes and here.
 */
type SendRow = {
  domain: string;
  brand_name: string | null;
  public_token: string;
  report_email: string | null;
  cluster_keyword: string | null;
  cluster_keyword_status: string | null;
  ref: string | null;
};

async function claim(scanId: string): Promise<(SendRow & { report_email: string }) | null> {
  const { data, error } = await supabaseAdmin()
    .from("scans")
    .update({ report_email_sent_at: new Date().toISOString() })
    .eq("id", scanId)
    .not("report_email", "is", null)
    .is("report_email_sent_at", null)
    .select(SEND_COLUMNS);

  if (error) {
    console.warn(`[scan] could not claim the report email for ${scanId}: ${error.message}`);
    return null;
  }
  const row = data?.[0] as SendRow | undefined;
  // No row is the ordinary case: nobody asked, or the other caller got there
  // first. Neither is worth a log line on every completed scan.
  if (!row?.report_email) return null;
  return { ...row, report_email: row.report_email };
}

/**
 * The scan's cluster keyword as the message names it, by the rule the page's
 * `clusterState` draws with (R114 S1): no status is a scan from before C1 and
 * keeps its questions; a chosen, non-blank keyword is named; anything else is
 * a cluster with no keyword yet, and the message guesses none.
 */
function reportCluster(row: SendRow): ReportCluster | null {
  if (!row.cluster_keyword_status) return null;
  const keyword = row.cluster_keyword?.trim();
  return { keyword: row.cluster_keyword_status === "chosen" && keyword ? keyword : null };
}

/**
 * Send the free result to the address on this row, at most once, ever.
 *
 * Safe to call on every completed scan - the overwhelming majority have no
 * address on them and cost one filtered update that matches nothing.
 */
export async function sendRequestedReport(scanId: string): Promise<void> {
  try {
    const row = await claim(scanId);
    if (!row) return;

    const db = supabaseAdmin();
    const [{ data: qs, error: qsErr }, { data: rows, error: rowsErr }] = await Promise.all([
      db.from("scan_questions").select("id").eq("scan_id", scanId),
      db.from("scan_answers").select("question_id, answered, brand_named").eq("scan_id", scanId),
    ]);

    /**
     * No message rather than a message with an invented number in it.
     *
     * This is `completeUnlock`'s recorded defect, one sender over: it discarded
     * both of these errors, so a read that did not answer became an empty list
     * and the body told a lead "We put 0 buying-intent questions to the engines
     * your buyers use" about a scan that had just asked fourteen and charged us
     * for every one. A published number we cannot stand behind is the one thing
     * "ship it rough" does not cover.
     *
     * The cost of returning is the message, and the send is already claimed, so
     * it is not retried. Logged at error because nothing else records that
     * somebody who asked for this never got it.
     */
    if (qsErr || rowsErr) {
      console.error(
        `[scan] could not count ${scanId} for the report it was asked to email, so none was sent: ` +
          (qsErr?.message ?? "") + (qsErr && rowsErr ? "; " : "") + (rowsErr?.message ?? ""),
      );
      return;
    }

    const messageId = await sendReportReadyEmail({
      email: row.report_email,
      brand: row.brand_name ?? row.domain,
      publicToken: row.public_token,
      counts: reportCounts((qs ?? []) as Array<{ id: string }>, (rows ?? []) as CountableAnswer[]),
      // Danny's third condition: this send is the one nobody confirmed an
      // address for, so the message says in its first line why it arrived. The
      // domain rather than the brand, because the stranger it is written for
      // can only recognise what was typed into the form.
      requestedFor: row.domain,
      cluster: reportCluster(row),
      // An outside partner's prospect (handoff.ts EXTERNAL_PARTNERS): we do not follow up, so the message says nothing
      // about follow-ups and carries no unsubscribe from them (4 Nov 2026).
      partner: externalPartner(row.ref) !== null,
    });

    /**
     * Danny's fourth condition: "log bounces... record enough that the question
     * can be answered later without a migration."
     *
     * A bounce is not this call's return value and cannot be. `emails.send`
     * answers whether the provider *accepted* the message; the bounce lands
     * minutes later, at the provider, against this id. So the thing that has to
     * survive the request is the id - with it on the row, a bounce is
     * attributable to the scan that caused it by whatever reads it later, and
     * the column is already there. Without it, asking the question at all needs
     * a migration first, which is the state the condition exists to prevent.
     *
     * Stamped after the send rather than with the claim, because a claim is
     * about permission to send and this is about what was sent. A failed stamp
     * costs the join and nothing else, so it is a warning and not a return: the
     * message has gone, and the send must not read as failed because a second
     * write did.
     *
     * A null id means nothing was accepted - no key, a rejection, or a throw,
     * each already logged where it happened. It is logged again here because
     * this is the only place that knows somebody *asked* for the message: the
     * three logs inside `sendReportReadyEmail` record that a send failed, and
     * only this one records that a visitor left an address for it and will
     * never hear anything back.
     */
    if (!messageId) {
      console.error(`[scan] the report ${scanId} was asked to email was not accepted by the provider`);
      return;
    }

    const { error: idErr } = await db
      .from("scans")
      .update({ report_email_message_id: messageId })
      .eq("id", scanId);
    if (idErr) {
      console.warn(
        `[scan] sent the requested report for ${scanId} as ${messageId} but could not store the id, ` +
          `so a bounce on it cannot be joined back to this scan: ${idErr.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[scan] the requested report email for ${scanId} failed: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}
