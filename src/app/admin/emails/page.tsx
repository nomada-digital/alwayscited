import type { Metadata } from "next";

import { TRACKED_PRICE } from "@/config/pricing";
import { T } from "@/config/tokens";
import { CUSTOMER_EMAILS, type CustomerEmail, flagFor, LIFECYCLE_EMAILS, type Preview, previewSets } from "@/lib/email/lifecycle";
import { customerEmailsFor } from "@/lib/email/preview-source";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";

import { sendTestEmail } from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Emails",
  robots: { index: false, follow: false },
};

/** The two widths Danny reads each preview at (R159). */
const WIDTHS = [
  { label: "Desktop", px: 640 },
  { label: "Phone", px: 390 },
];

const flagged = (n: CustomerEmail) => (LIFECYCLE_EMAILS as readonly string[]).includes(n);

/**
 * /admin/emails - R159 part 2 (Danny, 1 Oct 2026), rebuilt for brief item 2e
 * (18 Oct 2026). Behind the /admin Basic auth in proxy.ts. All twelve
 * customer emails, each with its subject, its plain text and the flag that
 * turns it on, at desktop and phone width.
 *
 * With no client chosen, every case each flag would send is drawn on made-up
 * fixture data (lifecycle.ts previewSets). With `?client=<slug or domain>`,
 * each email is rendered once on that client's real rows, through the same
 * readers the send sites use (preview-source.ts). "Send test to me" sends the
 * email as drawn to the one fixed test address (actions.ts) and nobody else.
 * Nothing here flips a flag.
 */
export default async function EmailsAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const client = typeof sp.client === "string" ? sp.client.trim().slice(0, 253) : "";
  const sent = typeof sp.sent === "string" ? sp.sent : null;
  const { data: clients, error: clientsErr } = await supabaseAdmin().from("client_domains").select("slug, domain").not("slug", "is", null).order("domain").limit(300);
  const real = client ? await customerEmailsFor(client) : null;
  const fixtures = previewSets(TRACKED_PRICE);
  const sets: Record<CustomerEmail, Preview[]> = real
    ? (Object.fromEntries(CUSTOMER_EMAILS.map((n) => [n, [{ label: `${real.domain}, real data`, mail: real.mails[n] }]])) as Record<CustomerEmail, Preview[]>)
    : fixtures;
  return (
    <div style={{ padding: "32px 24px 80px", maxWidth: "1180px", margin: "0 auto", color: T.ink }}>
      <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700 }}>Customer emails</h1>
      <p style={{ margin: "8px 0 0", fontSize: "15px", color: T.soft, maxWidth: "70ch" }}>
        {real ? `Rendered on ${real.domain}'s real rows.` : "Previews on made-up data. Pick a client to render them on its real rows."} None of the eleven with a flag is sent until its flag is on; the login link
        has no flag. &quot;Send test to me&quot; sends that one email to Danny only.
      </p>
      <form method="get" style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <label htmlFor="client" style={{ fontSize: "14px" }}>
          Client
        </label>
        <select id="client" name="client" defaultValue={real?.slug ?? ""} style={{ padding: "6px 8px", fontSize: "14px", borderRadius: "8px", border: `1px solid ${T.line}` }}>
          <option value="">Made-up fixture data</option>
          {(clients ?? []).map((c) => (
            <option key={String(c.slug)} value={String(c.slug)}>
              {String(c.domain)}
            </option>
          ))}
        </select>
        <button type="submit" style={{ padding: "6px 12px", fontSize: "14px", borderRadius: "8px", border: `1px solid ${T.line}`, background: T.surface, cursor: "pointer" }}>
          Render
        </button>
      </form>
      {clientsErr ? <p style={{ marginTop: "12px", color: T.badFg, fontSize: "14px" }}>The client list could not be read: {clientsErr.message}</p> : null}
      {client && !real ? <p style={{ marginTop: "12px", color: T.badFg, fontSize: "14px" }}>No client found for {client}, or its rows could not be read. Showing the fixtures.</p> : null}
      {real?.notes.length ? (
        <ul style={{ marginTop: "12px", fontSize: "14px", color: T.soft }}>
          {real.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {sent ? (
        <p role="status" style={{ marginTop: "12px", fontSize: "14px", color: sent === "failed" || sent === "refused" ? T.badFg : T.goodFg }}>
          {sent === "failed" ? "The test was not sent (Resend refused it or is not configured)." : sent === "refused" ? "Not authorised, or not an email this page knows." : `Sent ${sent} to Danny.`}
        </p>
      ) : null}
      {CUSTOMER_EMAILS.map((name, i) => (
        <section key={name} id={name} style={{ marginTop: "40px", paddingTop: "24px", borderTop: `1px solid ${T.line}` }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
            {i + 1}. {name}
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: "14px", color: T.soft }}>
            {flagged(name) ? (
              <>
                Flag <code>{flagFor(name as (typeof LIFECYCLE_EMAILS)[number])}</code>, off until you turn it on
              </>
            ) : (
              "Always on: no flag"
            )}
            {sets[name].length > 1 ? ` - ${sets[name].length} cases below, all sent under this one flag` : ""}
          </p>
          <form action={sendTestEmail} style={{ marginTop: "8px" }}>
            <input type="hidden" name="email" value={name} maxLength={ADMIN_LIMITS.id} />
            <input type="hidden" name="client" value={real?.slug ?? ""} maxLength={ADMIN_LIMITS.scan} />
            <button type="submit" style={{ padding: "6px 12px", fontSize: "14px", borderRadius: "8px", border: `1px solid ${T.line}`, background: T.surface, cursor: "pointer" }}>
              Send test to me
            </button>
          </form>
          {sets[name].map(({ label, mail: m }) => (
            <div key={label} style={{ marginTop: "20px" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>{label}</h3>
              <p style={{ margin: "4px 0 0", fontSize: "14px", color: T.soft }}>
                Subject: <strong style={{ color: T.ink }}>{m.subject}</strong>
                {m.sender === "danny" ? " - from Danny at alwayscited" : ""}
                {m.headers ? " - with List-Unsubscribe" : ""}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", marginTop: "12px", alignItems: "flex-start" }}>
                {WIDTHS.map((w) => (
                  <figure key={w.px} style={{ margin: 0, maxWidth: "100%" }}>
                    <figcaption style={{ fontSize: "13px", color: T.soft, marginBottom: "6px" }}>
                      {w.label}, {w.px}px
                    </figcaption>
                    <iframe
                      title={`${name}, ${label}, at ${w.px}px`}
                      srcDoc={m.html}
                      sandbox=""
                      style={{ width: `${w.px}px`, maxWidth: "100%", height: "820px", border: `1px solid ${T.line}`, borderRadius: "8px", background: T.surface }}
                    />
                  </figure>
                ))}
              </div>
              <details style={{ marginTop: "12px" }}>
                <summary style={{ cursor: "pointer", fontSize: "14px" }}>Plain text</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.55, background: T.chip, padding: "12px", borderRadius: "8px" }}>{m.text}</pre>
              </details>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
