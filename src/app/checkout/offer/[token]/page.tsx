import type { Metadata } from "next";

import TierName from "@/components/TierName";
import { CHECKOUT_LIMITS, CONTACT_EMAIL } from "@/config/contact";
import { MICRO, SHELL, T } from "@/config/tokens";
import { offerState, offerTerms } from "@/lib/checkout/contract-offer";
import { readContractOffer } from "@/lib/checkout/contract-offer-read";
import { dashOrigin } from "@/lib/dash/host";

export const dynamic = "force-dynamic";

/** A client's own offer - noindex here, in the /checkout header rule and in robots.txt. */
export const metadata: Metadata = {
  title: "Your plan",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string | string[] }> };

const P = { margin: "14px 0 0", fontSize: "15px", lineHeight: 1.7, color: T.soft } as const;
const H1 = { margin: "10px 0 0", fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: T.ink } as const;
const FIELD = { display: "block", width: "100%", boxSizing: "border-box", marginTop: "6px", padding: "10px 12px", fontFamily: "inherit", fontSize: "15px", color: T.ink, background: T.surface, border: `1px solid ${T.line}`, borderRadius: "10px" } as const;
const BUTTON = { fontFamily: "inherit", fontSize: "15px", fontWeight: 600, borderRadius: "999px", padding: "12px 22px", cursor: "pointer", marginTop: "16px", background: T.accent, color: T.surface, border: `1px solid ${T.accent}` } as const;

/**
 * A contract offer (31 Oct 2026, lib/checkout/contract-offer.ts): the terms of a client's signed agreement, and one
 * field - the email they will sign in with - before Stripe. Plain HTML: the form posts to /api/checkout/offer/<token>,
 * which reads the price from the offer row, never from this page. A used offer points to sign-in; an expired or
 * unknown one to the contact address.
 */
export default async function ContractOfferPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const error = (Array.isArray(sp.error) ? sp.error[0] : sp.error) ?? "";
  const offer = await readContractOffer(token).catch((e) => {
    console.error("[offer] could not read the offer: " + (e instanceof Error ? e.message : String(e)));
    return null;
  });
  const state = offer ? offerState(offer) : "expired";
  const mail = <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: T.accent }}>{CONTACT_EMAIL}</a>;

  if (!offer || state !== "open") {
    return (
      <section style={{ ...SHELL, maxWidth: "640px", paddingTop: "48px", paddingBottom: "96px" }}>
        <div style={MICRO}>Your plan</div>
        <h1 style={H1}>{state === "used" ? "This offer has been taken." : "This link has expired."}</h1>
        {state === "used" ? (
          <p style={P}>
            Your dashboard is set up. <a href={`${dashOrigin()}/login`} style={{ color: T.accent }}>Sign in</a> with the email you paid with. Anything else: {mail}.
          </p>
        ) : (
          <p style={P}>Email {mail} and we will send you a new one.</p>
        )}
      </section>
    );
  }

  const t = offerTerms(offer);
  return (
    <section style={{ ...SHELL, maxWidth: "640px", paddingTop: "48px", paddingBottom: "96px" }}>
      <div style={MICRO}>Prepared for {offer.client_name}</div>
      <h1 style={H1}>
        The <TierName tier={offer.tier} /> plan for {offer.website}
      </h1>
      <div style={{ marginTop: "20px", fontSize: "26px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>{t.price}</div>
      <p style={{ ...P, marginTop: "6px", color: T.ink }}>
        {t.payments}.{t.first ? ` ${t.first}` : ""}
      </p>
      <p style={P}>{t.agreement}</p>

      <form method="post" action={`/api/checkout/offer/${token}`} style={{ marginTop: "28px", maxWidth: "420px" }}>
        <label style={MICRO}>
          Email
          <input
            type="email"
            name="email"
            required
            maxLength={CHECKOUT_LIMITS.email}
            autoComplete="email"
            defaultValue={offer.email ?? ""}
            aria-invalid={error === "email" || undefined}
            style={FIELD}
          />
        </label>
        <p style={{ ...P, fontSize: "13px", marginTop: "8px" }}>The email you will sign in to your dashboard with.</p>
        {error === "email" ? (
          <p role="alert" style={{ ...P, color: T.badFg, marginTop: "8px" }}>Enter a valid email address.</p>
        ) : error ? (
          <p role="alert" style={{ ...P, color: T.badFg, marginTop: "8px" }}>The payment page did not open. Please try again, or email {mail}.</p>
        ) : null}
        <button type="submit" style={BUTTON}>Continue to payment</button>
      </form>
      <p style={{ ...P, fontSize: "14px", marginTop: "24px" }}>
        Payment is taken on Stripe&apos;s secure page. Once it goes through, we set up your dashboard and email you a sign-in link.
      </p>
    </section>
  );
}
