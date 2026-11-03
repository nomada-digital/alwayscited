import type { Metadata } from "next";

import { CONTACT_EMAIL } from "@/config/contact";
import { T } from "@/config/tokens";
import { addressFor, isSuppressed, maskEmail } from "@/lib/scan/unsubscribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

/**
 * Where the unsubscribe link in a report email or follow-up lands (3 Nov 2026), under /scan/ so the noindex header
 * and the robots.txt disallow that close a scan link close this too. A button, not an automatic
 * unsubscribe on open, so a mail scanner that follows every link does not unsubscribe anybody; it posts to
 * /api/unsubscribe/<token> with no script needed.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const q = await searchParams;
  let found: { email: string } | null = null;
  try {
    found = await addressFor(token);
  } catch {
    found = null;
  }
  const done = q.done === "1" || (found ? await isSuppressed(found.email) : false);
  const failed = q.failed === "1";

  const wrap: React.CSSProperties = { maxWidth: 560, margin: "0 auto", padding: "64px 16px 96px" };
  const h1: React.CSSProperties = { fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink, margin: 0 };
  const p: React.CSSProperties = { fontSize: "16px", lineHeight: 1.6, color: T.soft, margin: "14px 0 0" };
  const mail = <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: T.accent, fontWeight: 600 }}>{CONTACT_EMAIL}</a>;

  if (!found) {
    return (
      <div style={wrap}>
        <h1 style={h1}>Unsubscribe</h1>
        <p style={p}>We could not find an address for this link. To stop our emails, write to {mail} and we will take you off.</p>
      </div>
    );
  }
  if (done) {
    return (
      <div style={wrap}>
        <h1 style={h1}>You are unsubscribed</h1>
        <p style={p}>{maskEmail(found.email)} will get no more follow-ups or tips from alwayscited. Your report link keeps working.</p>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <h1 style={h1}>Unsubscribe</h1>
      <p style={p}>Stop follow-ups and tips from alwayscited to {maskEmail(found.email)}. Your report link keeps working.</p>
      {failed ? <p role="alert" style={{ ...p, color: T.badFg }}>That did not go through. Try again, or write to {mail}.</p> : null}
      <form action={`/api/unsubscribe/${token}`} method="post" style={{ marginTop: "24px" }}>
        <button type="submit" className="btn-primary" style={{ fontFamily: "inherit", fontSize: "15px", fontWeight: 600, border: 0, borderRadius: "10px", padding: "13px 22px", cursor: "pointer" }}>
          Unsubscribe
        </button>
      </form>
    </div>
  );
}
