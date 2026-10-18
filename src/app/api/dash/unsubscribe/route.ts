import { CONTACT_EMAIL } from "@/config/contact";
import { T } from "@/config/tokens";
import { escapeHtml } from "@/lib/scan/email-render";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { missingColumn } from "@/lib/tracking/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * #7's unsubscribe (brief item 2e, 18 Oct 2026): the Monday summary's footer
 * link and its List-Unsubscribe header both point here with a signed token
 * (email/unsubscribe.ts) naming one member's address and the client.
 *
 * GET only shows a page with a button, because mail scanners and link
 * previews open every link in a message: a GET that unsubscribed would opt
 * people out who never asked. POST records it - the button, or a mail
 * client's RFC 8058 one-click POST (body "List-Unsubscribe=One-Click", the
 * token in the URL). The opt-out is dashboard_members.this_week_opt_out on
 * that member's live row on the client's account
 * (20261018040000_email_prefs.sql), which week-recipients.ts reads. Nothing
 * else is written, nothing is sent, and a token that does not verify changes
 * nothing.
 */

const SECRET = () => process.env.CRON_SECRET ?? "";

function pageHtml(title: string, body: string, status = 200): Response {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:40px 16px;background:${T.bg};font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:${T.ink}">` +
    `<main style="max-width:480px;margin:0 auto;background:${T.surface};border:1px solid ${T.line};border-radius:18px;padding:32px">` +
    `<p style="margin:0 0 16px;font-weight:700;letter-spacing:-0.03em">alwayscited</p><h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const p = (s: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${T.soft}">${s}</p>`;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  const claim = verifyUnsubscribe(SECRET(), token);
  if (!claim) return pageHtml("This link doesn't work", p(`It may have been cut short when it was copied. Change your emails from Email settings in your dashboard, or write to ${escapeHtml(CONTACT_EMAIL)}.`), 400);
  return pageHtml(
    "Stop the Monday summary?",
    p(`We'll stop sending the Monday summary to <b>${escapeHtml(claim.email)}</b>. Every other email stays as it is, and you can turn it back on in Email settings.`) +
      `<form method="post" action="/api/dash/unsubscribe?t=${encodeURIComponent(token!)}"><button type="submit" style="background:${T.accent};color:${T.surface};border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer">Stop the Monday summary</button></form>`,
  );
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  const claim = verifyUnsubscribe(SECRET(), token);
  if (!claim) return pageHtml("This link doesn't work", p(`Write to ${escapeHtml(CONTACT_EMAIL)} and we'll stop it by hand.`), 400);
  const db = supabaseAdmin();
  const { data: client, error: cErr } = await db.from("client_domains").select("account_id").eq("id", claim.clientId).maybeSingle();
  if (cErr || !client) {
    console.warn(`[mail] unsubscribe: client not read: ${cErr?.message ?? "none"}`);
    return pageHtml("That didn't go through", p(`Please try again, or write to ${escapeHtml(CONTACT_EMAIL)}.`), cErr ? 502 : 404);
  }
  const { data, error } = await db
    .from("dashboard_members")
    .update({ this_week_opt_out: true })
    .eq("account_id", client.account_id as string)
    .eq("email", claim.email)
    .is("removed_at", null)
    .select("id");
  if (error) {
    // Before 20261018040000_email_prefs.sql is applied there is nowhere to record it: said, not hidden.
    console.warn(`[mail] unsubscribe not recorded: ${missingColumn(error) ? "this_week_opt_out is not there yet" : error.message}`);
    return pageHtml("That didn't go through", p(`We couldn't record it just now. Write to ${escapeHtml(CONTACT_EMAIL)} and we'll stop it by hand.`), 503);
  }
  if (!data?.length) return pageHtml("Nothing to stop", p("That address isn't on this dashboard any more, so it gets no Monday summary."));
  return pageHtml("Done. No more Monday summaries.", p("You can turn it back on in Email settings in your dashboard."));
}
