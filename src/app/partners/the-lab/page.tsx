import type { Metadata } from "next";

import PageScanBox from "@/components/scan/PageScanBox";
import { CARD, SHELL, T } from "@/config/tokens";
import { DASH_HOST_DEFAULT, SAMPLE_DEMO_TOKEN, SAMPLE_SLUG } from "@/lib/dash/host";

/**
 * The LAB's own page (Danny, 29 Oct 2026). The LAB (TPL Jamaica, thelabjamaica.com) is an agency in Kingston; this
 * is where their clients run the free check, so every scan from here carries ref "thelab" (scans.ref) and is theirs
 * in the leads export. US results by default - Danny's call, until a test reading shows the engines answer
 * differently for Jamaica (market stays UK | US). Linked to directly, never from the site: not indexed, not in the
 * sitemap, and it says nothing about The LAB beyond its name.
 */
export const metadata: Metadata = {
  title: "AI visibility check, with The LAB",
  description: "See whether ChatGPT, Gemini, Perplexity and Google's AI name your business when people ask.",
  robots: { index: false, follow: false },
};

const PARTNER_REF = "thelab";

const SAMPLE_DASHBOARD = `https://${DASH_HOST_DEFAULT}/demo/${SAMPLE_DEMO_TOKEN}/${SAMPLE_SLUG}`;

export default function TheLabPage() {
  return (
    <div style={{ ...SHELL, padding: "56px 24px 80px" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>With The LAB</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "44px", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.05, maxWidth: "20ch", color: T.ink }}>
        When people ask AI where to go, is your business named?
      </h1>
      <p style={{ margin: "16px 0 0", fontSize: "17px", lineHeight: 1.6, color: T.soft, maxWidth: "58ch" }}>
        Travellers and buyers now ask ChatGPT, Gemini, Perplexity and Google&apos;s AI for recommendations, and each
        answer names a handful of businesses. Enter your website to see whether you are one of them, which businesses
        are named instead, and which pages the answers are built from. Results are read for searches made in the US.
      </p>

      <div style={{ marginTop: "28px", maxWidth: "620px" }}>
        <PageScanBox id="thelab-domain" label="Your website" placeholder="yourbusiness.com" handoff={{ ref: PARTNER_REF, market: "US" }} />
      </div>

      <section style={{ ...CARD, marginTop: "48px", padding: "24px 26px", maxWidth: "760px", borderRadius: "18px" }}>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: T.ink }}>What tracking looks like after a few months</h2>
        <p style={{ margin: "8px 0 16px", fontSize: "15px", lineHeight: 1.6, color: T.soft }}>
          The free check is one reading. Tracking asks the same questions every morning and shows what moves. This is a
          sample dashboard for a fictional Jamaican villa brand, with generated figures, so you can click through every
          page.
        </p>
        <a className="btn-primary" href={SAMPLE_DASHBOARD} target="_blank" rel="noopener noreferrer">
          Open the sample dashboard
        </a>
      </section>

      <p style={{ marginTop: "32px", fontSize: "13px", color: T.soft }}>
        Questions? Ask your contact at The LAB.
      </p>
    </div>
  );
}
