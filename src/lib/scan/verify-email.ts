import "server-only";

import { Resend } from "resend";

import { unsubscribeLinks } from "./unsubscribe";

import { mailFrom } from "@/config/mail-from";
import { SITE_URL } from "@/config/schema";
import { T } from "@/config/tokens";
import { headerSafe } from "@/lib/email-header";
import {
  type Palette,
  type ReportCluster,
  type ReportCounts,
  reportHtml,
  reportSubject,
  reportText,
  verifyHtml,
  verifyText,
} from "@/lib/scan/email-render";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The scan transactional email: proving an address, and telling someone the
 * report they asked for is ready.
 *
 * Sent through Resend rather than Supabase auth: the built-in SMTP is rate
 * limited to a handful of messages an hour and Supabase say plainly it is not
 * for production. Resend is already wired up with alwayscited.com verified,
 * which also means the copy and the branding are ours.
 *
 * Both messages share one shell. They were two hand-copied blobs of table
 * markup until 19 Sep 2026, and that is how they came to carry colours that
 * are not in the palette - #f6f6f8 where the ground is #f6f6f7, #eceef2 where
 * the rule is #ececee - straight through a sweep that moved all 21 pages onto
 * the tokens. A hex in a template literal in a server module is invisible to
 * a sweep of the rendered site, so the fix is to stop writing one.
 */

/**
 * The origin every email link is built on.
 *
 * The fallback is `SITE_URL` rather than a third copy of the literal. The site
 * used to write its own origin out as three named constants - this one,
 * `SITE_URL` in config/schema.ts and `BASE_URL` in app/sitemap.ts - so a domain
 * change would update two and miss one, and the one it missed sends email.
 */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL;
}

function verifyUrl(verifyToken: string): string {
  return `${siteUrl()}/api/verify/${verifyToken}`;
}

/**
 * A subject line is a mail header.
 *
 * The brand is read off a crawled third-party site, so it is arbitrary text
 * rather than something we chose: a carriage return in it is header
 * injection, and a 400-character one is a subject no client shows the end
 * of. Resend builds the MIME and most likely rejects the first case itself,
 * but the string is ours to hand over clean and it costs one pass.
 * Collapsing all whitespace takes CR and LF with it.
 */

/**
 * The email palette, taken from the design tokens rather than retyped.
 *
 * Two deliberate departures, both toward more contrast rather than less:
 *
 * - `body` is darker than `T.soft`. An email is read in clients that recolour
 *   text, at sizes we do not set, on grounds we do not control, with no
 *   stylesheet to correct any of it. #3d4451 measures 9.79 on white where
 *   `T.soft` is 5.18; on a page that headroom is waste, in an inbox it is
 *   cover.
 * - nothing here uses `T.faint`. It is 2.54 on white, and the rule written
 *   beside it in tokens.ts is that light-ground text does not use it.
 */
const E: Palette = {
  ground: T.bg,
  card: T.surface,
  ink: T.ink,
  body: "#3d4451",
  quiet: T.soft,
  line: T.line,
  accent: T.accent,
  onAccent: T.surface,
};

/** No webfont. Fontsource ships Hanken as woff2 and no mail client loads it. */
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";

// --------------------------------------------------------- report ready

/**
 * Tells someone their report is ready, and gives them a way back to it.
 *
 * Without this, closing the tab loses the report: the result is assembled
 * once, for the tab that asked, and there was nothing in the visitor inbox
 * pointing back at it. It also puts the sharpest number this product produces
 * - how many answers did not name them - in front of a buyer a second time.
 *
 * Never throws. A failed send must not affect an unlock that has already
 * happened, so the caller is not given anything to handle.
 *
 * ## What it returns, and why that is not the same as "sent"
 *
 * The provider's id for the message it accepted, or null. **Accepted is not
 * delivered**: a bounce happens minutes later and is reported through a
 * different channel entirely, so the `error` branch below and a bounce are two
 * different events and only the first one is visible from inside this call.
 * The id is what lets the second be joined back to the row that caused it, and
 * `sendRequestedReport` stores it for exactly that - Danny's fourth condition
 * on item 5. A caller that does not care may ignore it; `completeUnlock` does.
 *
 * ## `requestedFor`
 *
 * The domain, passed only by the requested send, which is the one nobody
 * confirmed an address for. It puts `requestedReason` at the top of both parts
 * of the message. See `email-render.ts` for why the unlock's send does not
 * carry it.
 */
export async function sendReportReadyEmail(input: {
  email: string;
  brand: string;
  publicToken: string;
  counts: ReportCounts;
  requestedFor?: string;
  /** The scan's cluster keyword from C1 on; null before it. See `ReportCluster`. */
  cluster?: ReportCluster | null;
  /** An outside partner's scan: no follow-up line and no unsubscribe from follow-ups, which it will not get. */
  partner?: boolean;
}): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[scan] RESEND_API_KEY is not set, report email not sent");
    return null;
  }

  const link = `${siteUrl()}/scan/${input.publicToken}`;
  const subject = headerSafe(reportSubject(input.brand, input.counts));
  // 3 Nov 2026: a way out of follow-ups on every report email - a footer link, and one-click for mail clients (RFC 8058).
  const unsub = unsubscribeLinks(siteUrl(), input.publicToken);

  try {
    const { data, error } = await new Resend(key).emails.send({
      from: mailFrom(),
      to: input.email,
      subject,
      html: reportHtml(E, FONT, input.brand, link, input.counts, input.requestedFor, input.cluster, input.partner ? undefined : unsub.page),
      text: reportText(input.brand, link, input.counts, input.requestedFor, input.cluster, input.partner ? undefined : unsub.page),
      ...(input.partner ? {} : { headers: { "List-Unsubscribe": `<${unsub.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
    });
    if (error) {
      console.error("[scan] report email rejected", error);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[scan] report email failed", err instanceof Error ? err.message : err);
    return null;
  }
}
