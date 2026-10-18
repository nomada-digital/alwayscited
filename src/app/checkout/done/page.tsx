import type { Metadata } from "next";

import SendNewLink from "@/components/SendNewLink";
import { CONTACT_EMAIL } from "@/config/contact";
import { MICRO, SHELL, T } from "@/config/tokens";
import { doneEmail } from "@/lib/checkout/done-email";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { dashOrigin } from "@/lib/dash/host";

export const dynamic = "force-dynamic";

/** After Stripe - noindex here, in the /checkout header rule and in robots.txt. */
export const metadata: Metadata = {
  title: "Next step after checkout",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ plan?: string | string[]; from?: string | string[]; session?: string | string[] }> };

async function readOrderEmail(sessionId: string): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const { data, error } = await supabaseAdmin().from("orders").select("email").eq("stripe_session_id", sessionId).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.email as string | undefined) ?? null;
}

const P = { margin: "14px 0 0", fontSize: "15px", lineHeight: 1.7, color: T.soft } as const;

/**
 * Where Stripe returns a buyer (R91, pricing spec section 5). It reads
 * nothing: the Session id in the URL is not looked up, so the page does not
 * claim the payment went through - Stripe's receipt does that. The
 * onboarding call is booked by reply until a booking flow exists (pricing.ts:
 * one destination for every CTA), so the page says who writes and where.
 *
 * R148 pass 8 (1 Oct 2026): an order carrying a scan (from=scan, set in
 * session.ts) has its dashboard built by the webhook, which emails the owner
 * a sign-in link (signup.ts). The page said only "the onboarding call", so a
 * buyer had no sign it existed and no way to it. Those orders now name the
 * link and get one way on, /app/login, which sends a fresh one. plan and from
 * only choose copy; anyone can type them, and nothing is written.
 *
 * R166 (1 Oct 2026, danny.md line 175): the one read. A dashboard order's
 * Session id is looked up in orders for its email, so the page can say
 * "Check <email>" and offer "Send it again". Still not a payment claim, and a
 * missing row (webhook not landed yet) keeps the old wording.
 */
export default async function CheckoutDone({ searchParams }: Props) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const fromScan = one(sp.from) === "scan";
  // R158 (1 Oct 2026): an order with no scan now gets its dashboard too, built for the website it carried.
  const fromSite = one(sp.from) === "site";
  const dashboard = fromScan || fromSite;
  const tracked = one(sp.plan) === "tracked";
  // R166: the order's address, from its row, never from the URL.
  const email = dashboard ? await doneEmail(one(sp.session), readOrderEmail) : null;

  return (
    <section style={{ ...SHELL, maxWidth: "640px", paddingTop: "48px", paddingBottom: "96px" }}>
      <div style={MICRO}>Checkout</div>
      <h1 style={{ margin: "10px 0 0", fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: T.ink }}>
        {dashboard ? "Thank you. Your dashboard is being set up." : "Thank you. Next, the onboarding call."}
      </h1>
      {dashboard ? (
        <>
          {email ? (
            <p style={{ ...P, fontSize: "17px", color: T.ink, overflowWrap: "anywhere" }}>
              Check <strong>{email}</strong> for your sign-in link.
            </p>
          ) : null}
          {fromScan ? (
            <p style={P}>
              Stripe emails your receipt. We are setting up your dashboard from your scan
              {email ? "" : " and sending a sign-in link to your email"}. The first check runs tomorrow.
            </p>
          ) : (
            // ON-1 (9 Oct 2026, LB8): "We add each cluster's keyword and prompts" promised a person; setup is the buyer's own, and nothing waits on us.
            <p style={P}>
              Stripe emails your receipt. We are setting up your dashboard for your website
              {email ? "" : " and sending a sign-in link to your email"}. When you sign in, check a keyword for each
              cluster and edit the five prompts drafted from it. The daily checks begin once a cluster has its prompts.
            </p>
          )}
          {!tracked && (
            <p style={P}>We will also email you to book the onboarding call, where we go through the keyword and prompts you set for each cluster.</p>
          )}
          {email ? (
            // R166: one click for a fresh link to the order's address, through
            // /api/app/login and its hourly cap. Without script it posts and
            // lands on /app/login saying the link is sent (R151, 3 Oct 2026).
            // R151 (3 Oct 2026): the next step is the inbox, so the resend is
            // outlined and sits under the question it answers, not above it
            // as the page's one filled button (NN/g, primary and secondary
            // actions). Without an address, Go to sign in waits the same way.
            <>
              <p style={{ ...P, margin: "24px 0 0", fontSize: "14px" }}>No email after a few minutes?</p>
              <div style={{ margin: "10px 0 0", maxWidth: "320px" }}>
                <SendNewLink email={email} label="Send it again" secondary />
              </div>
            </>
          ) : (
            <>
              <p style={{ ...P, margin: "24px 0 0", fontSize: "14px" }}>No email after a few minutes? Sign in asks for a new link.</p>
              <p style={{ margin: "10px 0 0" }}>
                <a
                  href={`${dashOrigin()}/login`}
                  style={{ display: "inline-block", padding: "12px 16px", borderRadius: "10px", border: `1px solid ${T.line}`, background: T.surface, color: T.ink, fontWeight: 600, fontSize: "15px", textDecoration: "none" }}
                >
                  Go to sign in
                </a>
              </p>
            </>
          )}
        </>
      ) : (
        // ON-1 review (9 Oct 2026): prompts are no longer agreed on the call - each cluster's five are drafted from its keyword for the buyer to edit.
        <p style={P}>
          Stripe emails your receipt. We will email you to book the onboarding call. Each cluster&apos;s five prompts are
          drafted from its keyword for you to edit, and nothing runs until a cluster has them.
        </p>
      )}
      <p style={P}>
        Anything before then: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: T.accent }}>{CONTACT_EMAIL}</a>.
      </p>
    </section>
  );
}
