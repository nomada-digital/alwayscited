import type { Metadata } from "next";
import { CookieSettingsButton } from "@/components/ConsentBanner";
import TierName, { TierText } from "@/components/TierName";
import { OG_IMAGE } from "@/config/og";

import { COMPANY_LINE, CONTACT_EMAIL } from "@/config/contact";
import { CARD, GRID12, MICRO, SHELL, T } from "@/config/tokens";
import { TRIAL, TRIAL_TERMS } from "@/config/trial";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What alwayscited collects when you run a scan, why, how long it is kept, and who processes it. Written plainly, with the gaps marked rather than filled in.",
  openGraph: { url: "https://alwayscited.com/legal", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/legal" },
};

/**
 * The privacy policy - Legal.dc.html.
 *
 * Every factual claim here is one I checked in the code rather than one the
 * board asserted:
 *  - raw IPs are never stored, they are salted SHA-256 (lib/scan/ip.ts)
 *  - nothing is purged: what each engine said is kept for as long as the scan
 *    is, and the nightly job clears nothing (api/cron/purge-responses).
 *    Danny's decision, 24 September 2026. The response_retention_days row is
 *    still in app_settings and nothing reads it
 *  - the third-party scripts the browser can load are Cloudflare Turnstile and,
 *    only after a yes on the cookie banner, Google Analytics (15 Oct 2026,
 *    Danny approved GA4 with a consent banner in chat; it was "the only
 *    third-party script is Turnstile" and "no analytics of any kind" before)
 *  - apart from GA's own cookies, set only after that yes, the site sets one
 *    cookie, the dashboard's login: document.cookie is touched by
 *    lib/analytics.ts alone, and cookies() by the dashboard session alone
 *  - GA never loads on the dashboard, nothing is sent before consent, and
 *    neither a scanned domain nor anything typed into a form is sent to it
 *
 * All five are executable now, and a claim on this page that is not executable
 * is a claim that rots: `analytics-claim.test.mts` holds the analytics one,
 * `privacy-claims.test.mts` holds the other four. Read those before rewording
 * anything below - they fail on the wording as well as on the code,
 * deliberately, so a reworded promise cannot quietly outrun what enforces it.
 *
 * The board's processor list omits Anthropic, which the scan sends crawled
 * site text and the generated questions to. It is listed here. It also omitted
 * Cloudflare, and that one was found by executing the claim above rather than
 * by reading: `verifyTurnstile` posts `remoteip: ip` to Cloudflare's siteverify
 * endpoint on all three scan doors, so the raw address - the thing "What we
 * collect" promises is never written down - does leave this server, to a
 * processor the page did not name. Never stored and never disclosed are
 * different promises and the page was only keeping the first.
 *
 * Where a clause needs a fact nobody has given me, it is left out rather than
 * guessed. The company name and number are Danny's (26 Sep 2026, R31,
 * COMPANY_LINE; the address came off on 28 Sep, R81); the ICO number is
 * still open. The page carries no
 * drafting markers (Q22, 26 Sep 2026); every open gap is in
 * docs/blocked.md instead.
 */


/**
 * The five documents the board's sidebar switches between. Four are not
 * drafted anywhere - terms of service, a standalone cookie policy, a data
 * processing agreement and a sub-processor list - and Danny's answer on
 * 19 Sep was that the legal facts wait. They are listed as unpublished
 * rather than linked or hidden, because a reader looking for terms should
 * find out they do not exist rather than assume they missed them.
 */
const DOCUMENTS: { label: string; here?: boolean }[] = [
  { label: "Privacy policy", here: true },
  { label: "Cookies" },
  { label: "Terms of service" },
  { label: "Data processing" },
  { label: "Sub-processors" },
];

type Section = { id: string; title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    id: "what",
    title: "What we collect",
    body: (
      <>
        When you run a scan we store the domain you entered. If you ask us to email the result to you while the scan is
        still running, we store the email address you gave, and nothing else about you. If you ask for a walkthrough or
        a demo, we store the name, work email, business category and market you gave, and nothing else about you. For a
        scan we do not ask for a name, a company, a phone number or a card. If you buy a plan, you pay through Stripe: Stripe takes your
        card and billing details, and we keep your email address and the Stripe references for your order, never the card
        number. The contact form collects what you type into it. We also
        store a salted one-way hash of your IP address, to stop one visitor running the scan hundreds of times - the
        address itself is never written down, and the hash cannot be turned back into it. If you accept analytics,
        Google Analytics also records how you use the site - see cookies and tracking below.
      </>
    ),
  },
  {
    id: "why",
    title: "Why we collect it",
    body: (
      <>
        The email address exists so we can send you the link back to your report, and so a scan can be reclaimed if
        nobody opens it. An address given to have the result emailed is used for that one message and creates no
        account. What you give for a walkthrough or a demo is passed to Danny at nomada digital, who uses it to send
        you the video or arrange the call. Our lawful basis is legitimate interest in responding to a request you made. We do not add you to a
        mailing list, because there is not one.
      </>
    ),
  },
  {
    id: "how-long",
    title: "How long we keep it",
    body: (
      <>
        Scan results are kept indefinitely, so you can come back to the link, and so is what each engine said. We used
        to delete the text after seven days on a scan nobody claimed; we do not any more. It is the evidence behind every figure in
        your report, and a number you cannot read back to the words that produced it is not evidence. On a tracked account, every daily
        answer is kept for the life of the account; you can read it in the dashboard, and ask us for a copy. The dashboard also records which of
        its features are used - which page was opened, which control was pressed - to improve it; it stores ids and counts, never what you type.
      </>
    ),
  },
  {
    id: "who",
    title: "Who else sees it",
    body: (
      <>
        The scan runs through DataForSEO, which queries the engines on our behalf - your domain and the generated
        questions pass through it, your email address does not. Anthropic reads the text of the site being scanned and
        writes the questions. Cloudflare runs the robot check in front of a scan, and we pass it your IP address so it
        can do that. Email is sent through Resend. Hosting is Vercel, and the database is Supabase, in London. To
        say how hard each placement on a report would be to land, we look up the cited sites&apos; domains on a
        link marketplace - only those domains, nothing about you. If you accept analytics, Google runs Google
        Analytics for us, as described under cookies and tracking.
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and tracking",
    body: (
      <>
        The site loads two third-party scripts, and one of them only if you say yes. Cloudflare Turnstile checks you are
        not a robot before a scan runs - usually without showing anything - and it sets storage of its own to do that.
        Google Analytics shows us how the site is used, and it is not loaded at all until you accept the cookie banner;
        decline and it never is. With your yes it records the pages you view, where your visit came from, your approximate
        location and device, and actions such as scans started, plans selected and checkouts begun. It never sees what you
        type into a form or the domains you scan, and it is never loaded on the client dashboard. It sets two cookies, _ga
        and _ga_ followed by our property&apos;s id, which last two years. When a plan is bought, our server also tells
        Google Analytics the plan and the amount, joined to your visit only if you accepted, and nothing else about you.
        Our basis for analytics is your consent. Its advertising signals are switched off, and there is no advertising
        pixel. You can change your choice at any time with <CookieSettingsButton style={{ fontWeight: 600, color: T.accent }} />
        , here or at the foot of every page; declining after accepting deletes those cookies. Apart from those, this site
        sets no cookies of its own, with one exception: when a client signs in to their <TierName tier="tracked" />{" "}
        dashboard, we set one login cookie so they stay signed in. It holds a random key and nothing else, lasts 30
        days, is cleared when they log out, and is never set on any other visit. The dashboard's feature counts, described
        above, are our own and go to no third party.
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        You can ask what we hold, have it corrected, have it deleted, or object to us holding it at all. We will do it
        within a month and usually the same week. Deleting your email address deletes the link to your report with it.
      </>
    ),
  },
  // The alwaystracked trial clause (Danny, 8 Oct 2026), only while
  // config/trial.ts has the trial on. A draft for Danny to read first.
  ...(TRIAL.enabled
    ? [
        {
          id: "free-trial",
          title: "The free trial",
          body: (
            <>
              <TierText>{TRIAL_TERMS.join(" ")}</TierText> Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
                {CONTACT_EMAIL}
              </a>{" "}
              with any question about a charge.
            </>
          ),
        },
      ]
    : []),
];

export default function LegalPage() {
  return (
    <div style={{ ...SHELL, paddingTop: "44px", paddingBottom: "44px" }}>
      <div className="board-head" style={{ ...GRID12, alignItems: "start" }}>
        {/* The beat, from globals.css. The document switcher animates as one
            list rather than five items - the four unpublished entries are one
            fact, not four arrivals. */}
        <aside className="legal-nav" style={{ gridColumn: "span 3" }}>
          <div className="ac-row" style={MICRO}>Legal</div>
          {/* The board's sidebar is a switcher between five documents, not a
              contents list for this one. Only the privacy policy is written,
              so the other four say so rather than linking somewhere empty or
              being quietly dropped. */}
          <ul className="ac-row" style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
            {DOCUMENTS.map((d) => (
              <li key={d.label}>
                {d.here ? (
                  <span
                    style={{
                      display: "block",
                      fontSize: "13.5px",
                      fontWeight: 600,
                      color: T.ink,
                      padding: "7px 11px",
                      borderRadius: "8px",
                      background: T.surface,
                      border: `1px solid ${T.line}`,
                    }}
                  >
                    {d.label}
                  </span>
                ) : (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "8px",
                      fontSize: "13.5px",
                      color: T.soft,
                      padding: "7px 11px",
                    }}
                  >
                    {d.label}
                    <span style={{ fontSize: "11.5px", color: T.soft }}>not yet published</span>
                  </span>
                )}
              </li>
            ))}
          </ul>

          <p className="ac-row" style={{ margin: "16px 0 0", fontSize: "12.5px", lineHeight: 1.6, color: T.soft }}>
            On this page:{" "}
            {SECTIONS.map((sec, i) => (
              <span key={sec.id}>
                {i ? ", " : ""}
                <a href={`#${sec.id}`} style={{ color: T.soft, textDecoration: "none" }}>
                  {sec.title.toLowerCase()}
                </a>
              </span>
            ))}
            .
          </p>
          {/* The board's [DRAFTED BY CLAUDE ... solicitor] note, and the plain
              "Drafted as a structure" line that stood in for it, are off the
              public page (queue Q22, 26 Sep 2026: no drafting markers). The
              solicitor check is still owed; it is tracked in docs/blocked.md,
              not published. */}
        </aside>

        <div style={{ gridColumn: "span 9" }}>
          <div className="ac-row" style={MICRO}>Privacy policy</div>
          <h1 className="ac-row" style={{ margin: "8px 0 0", fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>
            What we collect, and what we do with it
          </h1>
          <p className="ac-row" style={{ margin: "10px 0 0", fontSize: "13px", color: T.soft, lineHeight: 1.7 }}>
            {COMPANY_LINE}
          </p>

          <div style={{ ...CARD, marginTop: "26px", overflow: "hidden" }}>
            {SECTIONS.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className="ac-row"
                style={{ padding: "22px 28px", borderTop: i ? `1px solid ${T.hair}` : undefined, scrollMarginTop: "2rem" }}
              >
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
                  {s.title}
                </h2>
                <p style={{ margin: "9px 0 0", fontSize: "14.5px", lineHeight: 1.75, color: T.soft, maxWidth: "76ch" }}>
                  {s.body}
                </p>
              </section>
            ))}
          </div>

          <p style={{ margin: "18px 0 0", fontSize: "13.5px", lineHeight: 1.7, color: T.soft, maxWidth: "76ch" }}>
            To ask what we hold about you, to have it corrected, or to have it deleted, email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
              {CONTACT_EMAIL}
            </a>
            . If you are not satisfied with how we handle it you can complain to the Information Commissioner&apos;s
            Office at{" "}
            <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
              ico.org.uk
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
