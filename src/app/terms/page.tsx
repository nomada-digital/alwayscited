import type { Metadata } from "next";
import Link from "next/link";

import TierName from "@/components/TierName";
import { OG_IMAGE } from "@/config/og";
import { COMPANY_LINE, CONTACT_EMAIL } from "@/config/contact";
import { MONTHLY_INSERTIONS_MIN, MONTHLY_PLACEMENTS, PACK_CLUSTERS, TRACKED_CLUSTERS, TRACKED_KEYWORDS, TRACKED_PROMPTS } from "@/config/pricing";
import { REGISTERED_OFFICE, TERMS_UPDATED, TERMS_VERSION } from "@/config/terms";
import { CARD, GRID12, MICRO, SHELL, T } from "@/config/tokens";
import { TRIAL } from "@/config/trial";
import { MEMBERS_PER_CLIENT } from "@/lib/tracking/team";
import { RETENTION_DAYS } from "@/lib/tracking/retention";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement between alwayscited and the businesses that subscribe: what each plan includes, billing, cancelling, plan changes, and what we can and cannot promise.",
  openGraph: { url: "https://alwayscited.com/terms", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/terms" },
};

/**
 * Terms of service (Danny, 8 Nov 2026), version and date in config/terms.ts. Written to how the product works, and
 * every figure read from where the product keeps it: the allowance from pricing.ts, team size from team.ts, the kept
 * period from retention.ts, the trial from trial.ts, the monthly delivery from pricing.ts. A clause that needs a
 * fact the code does not hold says less rather than guessing. A solicitor's review is still owed (Danny knows);
 * as on /legal, no drafting marker goes on the public page.
 */

const a: React.CSSProperties = { fontWeight: 600, textDecoration: "none", color: T.accent };

type Section = { id: string; title: string; body: React.ReactNode[] };

const SECTIONS: Section[] = [
  {
    id: "who",
    title: "Who we are, and who these terms are for",
    body: [
      <>alwayscited is run by {COMPANY_LINE}, registered in England and Wales{REGISTERED_OFFICE ? `, at ${REGISTERED_OFFICE}` : ""}. In these terms &ldquo;we&rdquo; and &ldquo;us&rdquo; means Nomada Digital Ltd, and &ldquo;you&rdquo; means the business that subscribes.</>,
      <>These terms are the agreement between us when you subscribe on alwayscited.com. alwayscited is a service for businesses: by subscribing you confirm you are doing so for a business, and that you can agree to these terms on its behalf.</>,
    ],
  },
  {
    id: "service",
    title: "The service, plan by plan",
    body: [
      <>Every plan includes a dashboard that tracks, each day, the prompts you choose across AI engines and your keywords on Google. What each plan adds is described on its plan page at the time you subscribe, and the summary here is that description in short:</>,
      <>
        <TierName tier="tracked" />: daily tracking of whether AI answers name you, the sources they cite, and your Google positions. No placements or on-site work.
        <br />
        <TierName tier="mentioned" />: tracking, plus each month we work on the keyword clusters on your plan, placing you in sources the engines already cite ({MONTHLY_PLACEMENTS} placements a month on each cluster on the plan).
        <br />
        <TierName tier="cited" />: everything in <TierName tier="mentioned" />, plus link insertions ({MONTHLY_INSERTIONS_MIN} or more a month on each cluster on the plan) and schema work on your pages.
        <br />
        <TierName tier="everywhere" />: scoped with you on a call and set out in a written agreement.
      </>,
      <>Placements and link insertions are articles and mentions on other people&rsquo;s sites. We find and agree them, and the content is written for the publisher; see &ldquo;Placements on other sites&rdquo; below for what that means.</>,
    ],
  },
  {
    id: "accounts",
    title: "Accounts and users",
    body: [
      <>Your dashboard has an owner, who can invite up to {MEMBERS_PER_CLIENT} people for each site as editors or viewers. Everyone signs in with a link sent to their own email address. You are responsible for who you invite, for keeping their email accounts secure, and for removing people who should no longer have access. Only an owner can manage billing, the team and plan changes.</>,
    ],
  },
  {
    id: "fees",
    title: "Fees and billing",
    body: [
      <>Prices are as shown at checkout. <TierName tier="mentioned" /> and <TierName tier="cited" /> are priced per keyword cluster on the plan; <TierName tier="tracked" /> is priced per website. Prices exclude VAT and other sales taxes, which are added at checkout where they apply.</>,
      <>You pay monthly in advance, by card through Stripe, until you cancel. Each website is its own subscription. {TRIAL.enabled ? <>Where a free trial is offered ({TRIAL.days} days, on <TierName tier="tracked" /> for a first-time customer), nothing is charged until it ends, and the order form says so before you pay.</> : null}</>,
    ],
  },
  {
    id: "cancel",
    title: "Cancelling",
    body: [
      <>You can cancel at any time. Cancelling takes effect at the end of the billing period you have already paid for: the service carries on until then, and there is no further charge. We do not refund part months. An owner cancels from Billing on the dashboard&rsquo;s Plan page, or by emailing <a href={`mailto:${CONTACT_EMAIL}`} style={a}>{CONTACT_EMAIL}</a>.</>,
    ],
  },
  {
    id: "changes-to-plan",
    title: "Your plan's allowance and changing what we work on",
    body: [
      <>A plan allows {TRACKED_CLUSTERS} keyword clusters, {TRACKED_PROMPTS} prompts and {TRACKED_KEYWORDS} keywords, shared across your clusters, unless your order or agreement says otherwise. A tracking pack adds {PACK_CLUSTERS} clusters with their prompts and keywords.</>,
      <>On <TierName tier="mentioned" /> and <TierName tier="cited" />, the clusters we work on each month are the ones your plan pays for. Any further cluster you add is tracking only: it is measured every day at no extra cost within the allowance, and we do not place for it.</>,
      <>To add a cluster to the plan, you ask from the dashboard and we confirm the price with you. Your fee changes only once you have confirmed, from the billing date after that. Nothing is charged automatically.</>,
      <>You can swap a cluster we work on for another. A swap takes effect on the 1st of the following month, so the month&rsquo;s work in progress is finished first; it does not change your fee, and you can cancel it until it takes effect.</>,
    ],
  },
  {
    id: "wip",
    title: "Work in progress",
    body: [
      <>Placements and link insertions we have already commissioned when you cancel, or when a swap takes effect, are completed. Once published, they stay up for as long as the publisher keeps them.</>,
    ],
  },
  {
    id: "no-guarantee",
    title: "What we cannot promise",
    body: [
      <>AI engines and search engines belong to other companies, which change how they answer, what they cite and how they rank without notice. We do the work each plan describes, but we cannot guarantee any ranking, any mention or citation in an AI answer, or any amount of traffic or sales. The figures on your dashboard are what the engines returned when we asked them, and the same question asked another time can be answered differently.</>,
    ],
  },
  {
    id: "yours",
    title: "What we need from you",
    body: [
      <>You give us accurate information about your business, its website and its market, and keep it up to date. Where a plan includes work on your own pages, you give us the access we need or make the changes we recommend. Where we ask you to approve something, such as a keyword, an anchor or a piece of content, you answer within a reasonable time; work that waits for an approval may move to a later month. You tell us about anything we should not say about your business.</>,
    ],
  },
  {
    id: "publishers",
    title: "Placements on other sites",
    body: [
      <>The sites we place you on are run by independent publishers. They decide whether to publish, may edit what is published, decide how it is labelled, and may change or remove it later. We do not control them, and we are not responsible for what they do with their own sites. We choose them, and check that a placement is live when it is published.</>,
    ],
  },
  {
    id: "use",
    title: "Acceptable use",
    body: [
      <>You may not use alwayscited to break the law or anyone&rsquo;s rights; to give us content that is false, misleading, defamatory or infringing; to try to get round its security, its limits or another customer&rsquo;s data; to copy, resell or reverse engineer the service, other than as a written agreement with us allows; or to send automated traffic to it. We may suspend an account that does, after telling you why where we can.</>,
    ],
  },
  {
    id: "ip",
    title: "Who owns what",
    body: [
      <>You own your brand, your website, your content and the data you give us, and you allow us to use them to provide the service. We own the alwayscited platform, its software and its design, and give you the right to use the service, and the reports and data it shows you, for your business while you subscribe and afterwards. We may use data from the service in anonymised, aggregated form, where neither you nor anyone else can be identified, to run and improve it and to publish general findings.</>,
    ],
  },
  {
    id: "data",
    title: "Your data and privacy",
    body: [
      <>How we handle personal data is set out in our <Link href="/legal" style={a}>privacy policy</Link>. When a plan ends, its dashboard and everything in it stay available, read-only, for {RETENTION_DAYS} days. After that we delete that site&rsquo;s tracking data. The order and billing records we need for our accounts are kept.</>,
    ],
  },
  {
    id: "suspension",
    title: "If a payment fails",
    body: [
      <>If a payment fails, Stripe tries it again. If it stays unpaid, we may suspend the service, or end the plan, until it is paid; your dashboard says so. When the payment is made, we restore it.</>,
    ],
  },
  {
    id: "liability",
    title: "Our liability",
    body: [
      <>Our total liability to you under or in connection with these terms is limited to the fees you paid us in the 12 months before the claim arose. Nothing in these terms limits or excludes any liability that cannot be limited or excluded by law.</>,
    ],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: [
      <>We may change these terms. We will email account owners and post the new version here at least 30 days before it takes effect. If you do not agree to the change, you can cancel before then.</>,
    ],
  },
  {
    id: "agreements",
    title: "Private agreements",
    body: [
      <>Some customers subscribe under an agreement signed with us, through a private checkout link that says so. Where that agreement says its terms apply in place of these, they do, to the extent it says; anything it does not cover is governed by these terms.</>,
    ],
  },
  {
    id: "law",
    title: "Law",
    body: [<>These terms are governed by the law of England and Wales, and the courts of England and Wales have jurisdiction over any dispute about them.</>],
  },
];

export default function TermsPage() {
  return (
    <div style={{ ...SHELL, paddingTop: "44px", paddingBottom: "44px" }}>
      <div className="board-head" style={{ ...GRID12, alignItems: "start" }}>
        <aside className="legal-nav" style={{ gridColumn: "span 3" }}>
          <div className="ac-row" style={MICRO}>Legal</div>
          <ul className="ac-row" style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
            <li><Link href="/legal" style={{ display: "block", fontSize: "13.5px", color: T.soft, padding: "7px 11px", textDecoration: "none" }}>Privacy policy</Link></li>
            <li><span style={{ display: "block", fontSize: "13.5px", fontWeight: 600, color: T.ink, padding: "7px 11px", borderRadius: "8px", background: T.surface, border: `1px solid ${T.line}` }}>Terms of service</span></li>
          </ul>
          <p className="ac-row" style={{ margin: "16px 0 0", fontSize: "12.5px", lineHeight: 1.6, color: T.soft }}>
            On this page:{" "}
            {SECTIONS.map((s, i) => (
              <span key={s.id}>
                {i ? ", " : ""}
                <a href={`#${s.id}`} style={{ color: T.soft, textDecoration: "none" }}>{s.title.toLowerCase()}</a>
              </span>
            ))}
            .
          </p>
        </aside>

        <div style={{ gridColumn: "span 9" }}>
          <div className="ac-row" style={MICRO}>Terms of service</div>
          <h1 className="ac-row" style={{ margin: "8px 0 0", fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>
            The agreement when you subscribe
          </h1>
          <p className="ac-row" style={{ margin: "10px 0 0", fontSize: "13px", color: T.soft, lineHeight: 1.7 }}>
            Version {TERMS_VERSION} · Last updated {TERMS_UPDATED} · {COMPANY_LINE}
          </p>

          <div style={{ ...CARD, marginTop: "26px", overflow: "hidden" }}>
            {SECTIONS.map((s, i) => (
              <section key={s.id} id={s.id} className="ac-row" style={{ padding: "22px 28px", borderTop: i ? `1px solid ${T.hair}` : undefined, scrollMarginTop: "2rem" }}>
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>{s.title}</h2>
                {s.body.map((p, j) => (
                  <p key={j} style={{ margin: "9px 0 0", fontSize: "14.5px", lineHeight: 1.75, color: T.soft, maxWidth: "76ch" }}>{p}</p>
                ))}
              </section>
            ))}
          </div>

          <p style={{ margin: "18px 0 0", fontSize: "13.5px", lineHeight: 1.7, color: T.soft, maxWidth: "76ch" }}>
            Questions about these terms:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={a}>{CONTACT_EMAIL}</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
