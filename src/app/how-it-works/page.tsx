import type { Metadata } from "next";
import PageScanBox from "@/components/scan/PageScanBox";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";
import SectionHead from "@/components/SectionHead";

import DarkClosing from "@/components/DarkClosing";
import { D, LIFT } from "@/components/home/dark";
import { word } from "@/components/home/EngineDemo";
import { FREE_ENGINE_COUNT, QUESTIONS } from "@/config/scan-shape";
import { TIERS, TRACKED_BASIS } from "@/config/pricing";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { ORG_REF, SITE_URL, ld } from "@/config/schema";
import { LAUNCH_VIDEO, LAUNCH_VIDEO_SUMMARY } from "@/config/video";

/**
 * How it works - the mechanism page, built to HowItWorks.dc.html (R18,
 * 26 Sep 2026). Until then it had no board and was judged against the built
 * pages; the board arrived after Q24 and is the newer word.
 *
 * Order, as the board draws it: the hero beside a scan box, the launch video
 * (the page's one beat, Q23 - kept as the real `<video>`, its poster standing
 * in for the board's placeholder frame; off 28 Sep for its stale prices, back
 * 29 Sep as the price-free re-cut, R118), a static three-step diagram of why
 * engines cite what they cite, one placement / two jobs, the three pieces of
 * work, and the dark closing scan.
 *
 * Gone with the board: the "What we will not put on this page" section. It
 * explained why an unsourced comparison table was removed; the board does not
 * carry it, and nothing it said was a claim that needs to stay live.
 *
 * Kept from before, for the reasons recorded in git at `1cc49b1`: no client
 * result without a dated source, no superlative about link value, and no
 * claim about what other agencies sell. The diagram's brands are the boards'
 * made-up ones and say so under it. The entry price is pricing.ts's, as on
 * /seo-agencies.
 */

export const metadata: Metadata = {
  title: "How AI search citations are engineered",
  description:
    "How we get brands named in AI answers: placement on the pages the engines already read, the on-site work that backs it up, and what we measure.",
  alternates: { canonical: "https://alwayscited.com/how-it-works" },
  openGraph: {
    images: OG_IMAGE,
    title: "How AI search citations are engineered | alwayscited",
    description:
      "The mechanism alwayscited uses to get brands named in AI answers - placement on the pages the engines already read.",
    url: "https://alwayscited.com/how-it-works",
  },
};

const articleSchema = ld({
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "How AI search citations are engineered",
  description:
    "How alwayscited gets brands named inside AI answers: placement on the third-party pages an engine already reads for a category, plus the on-site work that backs it up.",
  url: "https://alwayscited.com/how-it-works",
  author: ORG_REF,
  publisher: ORG_REF,
});

/** The launch video, from the one record in config/video.ts; video.test.mts
 *  holds this node against it and against the file. */
const videoSchema = ld({
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: LAUNCH_VIDEO.name,
  description: LAUNCH_VIDEO.description,
  thumbnailUrl: SITE_URL + LAUNCH_VIDEO.poster,
  contentUrl: SITE_URL + LAUNCH_VIDEO.src,
  uploadDate: LAUNCH_VIDEO.uploadDate,
  duration: LAUNCH_VIDEO.duration,
  width: LAUNCH_VIDEO.width,
  height: LAUNCH_VIDEO.height,
  inLanguage: "en",
  publisher: ORG_REF,
});

const tracked = TIERS.find((t) => t.id === "tracked");

const WORK: { heading: string; body: string }[] = [
  {
    heading: "Placement on pages the engines already read",
    body: "Placements on the third-party pages behind the answers in your category - best-of lists, comparisons and round-ups - with the brand where a ranked list gets quoted from. Not paid promotion dressed up as independent coverage.",
  },
  {
    heading: "On-site pages built for the prompt",
    body: "The prompts closest to a buying decision get pages of their own: question-format headings, comparison tables, FAQ schema, and an opening line in the buyer's phrasing.",
  },
  {
    heading: "Links that land where you want them",
    body: "Every placement carries at least a link to the brand. Some also carry a contextual link to the page you want ranked, and that is the link that moves the Google position most. A placement can win the citation without it, so we report the two separately.",
  },
];

/** Step 2 of the diagram: the pages the engine reads. The first is the
 *  placement, so it takes the wash. Made-up domains, as the board's are. */
const SOURCES: { title: string; domain: string; placed?: boolean }[] = [
  { title: "The 9 best invoicing apps for freelancers", domain: "solodesk.io", placed: true },
  { title: "Billing tools compared for sole traders", domain: "quillandcoin.co" },
  { title: "Ledgerbird review", domain: "ledgerbird.com" },
];

const H2_BIG: React.CSSProperties = { margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink };
const LEDE: React.CSSProperties = { margin: 0, fontSize: "15px", lineHeight: 1.6, color: T.soft };

function Head({ title, lede }: { title: string; lede: string }) {
  return (
    <SectionHead style={{ marginTop: "80px" }} title={title} titleStyle={H2_BIG} intro={lede} introStyle={LEDE} />
  );
}

function Arrow({ stroke }: { stroke: string }) {
  return (
    <svg className="guide-flow__arrow" width="56" height="16" viewBox="0 0 56 16" fill="none" aria-hidden="true">
      <path d="M8 8h36M38 3l6 5-6 5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleSchema }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: videoSchema }} />

      <div style={{ ...SHELL, paddingTop: "64px", paddingBottom: "64px" }}>
        <div className="guide-top">
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>How it works</div>
            <h1 className="guide-h1" style={{ margin: "12px 0 0", fontSize: "50px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.04, color: T.ink }}>
              How AI search citations are engineered.
            </h1>
            <p style={{ margin: "18px 0 0", fontSize: "17px", lineHeight: 1.55, color: T.soft, maxWidth: "54ch" }}>
              An answer is assembled from pages. Get onto those pages and you get named in the answer. That is the
              whole mechanism, and the rest of this page is how we do it.
            </p>
          </div>

          <div style={{ ...CARD, borderRadius: "18px", padding: "20px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: T.ink }}>Start with the evidence</div>
            <div style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, marginTop: "4px" }}>
              A free scan records every page behind the answers in your category, so the target list is something you
              can read.{" "}
              <Link href="/llm-visibility-checker" style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>Check your AI visibility</Link> first.
            </div>
            <PageScanBox id="hiw-domain" label="Domain" placeholder="yourdomain.com" />
          </div>
        </div>

        {/* The page's one beat (Q23, 26 Sep 2026; re-cut R118, 29 Sep): the
            launch video. Click to play: no autoplay and preload="none" - most
            visitors read instead. The summary is visually hidden so a crawler
            and a screen reader get the argument without playing it. */}
        <section id="video" style={{ scrollMarginTop: "2rem", marginTop: "72px" }}>
          <SectionHead
            title="The 60-second version"
            titleStyle={H2_BIG}
            intro="One buyer prompt, the brands the engines name instead, and the four tiers that get a brand into the answer."
            introStyle={LEDE}
          />
          <video
            controls
            playsInline
            preload="none"
            poster={LAUNCH_VIDEO.poster}
            width={LAUNCH_VIDEO.width}
            height={LAUNCH_VIDEO.height}
            aria-label={LAUNCH_VIDEO.name}
            aria-describedby="video-summary"
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              aspectRatio: "16 / 9",
              marginTop: "24px",
              borderRadius: "18px",
              background: D.ground,
              boxShadow: LIFT,
            }}
          >
            <source src={LAUNCH_VIDEO.src} type="video/mp4" />
          </video>
          <div id="video-summary" className="sr-only">
            <p>What the video shows:</p>
            <ul>
              {LAUNCH_VIDEO_SUMMARY.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <Head
            title="Why engines cite what they cite"
            lede={
              'The answer to "which tool is best" reads like a ranked list restated from pages the engine treats as sources. Every scan records those pages beside the answer, so this is something we read rather than infer.'
            }
          />
          <div className="guide-flow">
            <div style={{ ...CARD, borderRadius: "18px", padding: "20px 22px" }}>
              <div style={MICRO}>1 · A buyer asks</div>
              <div style={{ marginTop: "10px", fontSize: "17px", fontWeight: 600, lineHeight: 1.35, color: T.ink }}>
                What is the best invoicing software for freelancers?
              </div>
            </div>
            <Arrow stroke={T.faint} />
            <div style={{ ...CARD, borderRadius: "18px", padding: "20px 22px" }}>
              <div style={MICRO}>2 · The engine reads its sources</div>
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                {SOURCES.map((s) => (
                  <li
                    key={s.domain}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      background: s.placed ? T.wash : undefined,
                      border: s.placed ? "1px solid " + T.wash : "1px solid " + T.hair,
                    }}
                  >
                    <span style={{ fontSize: "13.5px", fontWeight: 600, flexGrow: 1, color: s.placed ? T.accentHover : T.ink }}>{s.title}</span>
                    <span style={{ fontSize: "12px", color: s.placed ? T.accentHover : T.soft }}>{s.domain}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Arrow stroke={T.accent} />
            <div style={{ background: D.ground, borderRadius: "18px", padding: "20px 22px", color: T.surface, boxShadow: LIFT }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: D.muted }}>3 · The answer names who those pages name</div>
              <div style={{ marginTop: "12px", fontSize: "14px", lineHeight: 2.05 }}>
                <div>1. Ledgerbird</div>
                <div style={{ background: D.card, border: "1px solid " + D.accent, borderRadius: "6px", margin: "0 -8px", padding: "0 8px", fontWeight: 700 }}>
                  2. Tallyroo
                </div>
                <div>3. Stackbill</div>
              </div>
              <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "11.5px", fontWeight: 600, color: D.caret, background: D.card, border: "1px solid " + D.accent, borderRadius: "999px", padding: "1px 10px", lineHeight: 1.8 }}>
                  solodesk.io
                </span>
                <span style={{ fontSize: "11.5px", fontWeight: 600, color: D.cardHead, background: D.card, border: "1px solid " + D.cardLine, borderRadius: "999px", padding: "1px 10px", lineHeight: 1.8 }}>
                  quillandcoin.co
                </span>
              </div>
            </div>
          </div>
          <div className="guide-notes" style={{ color: T.soft }}>
            <span>
              Get onto step 2 and step 3 follows.{" "}
              <Link href="/what-is-aeo" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
                The longer version, with what we can and cannot claim
              </Link>
            </span>
            <span>Illustrative. Tallyroo and every brand shown are made up.</span>
          </div>
        </section>

        <section>
          <Head
            title="One placement, two jobs"
            lede="This is why it is not a second service to staff. The same article does both pieces of work, and we measure them separately."
          />
          <div className="two-up" style={{ gap: "16px", marginTop: "24px" }}>
            {[
              { label: "Google reads a link", body: "Authority passes to the page the anchor points at, and the article itself ranks for the term.", foot: "Measured as a position, with a note when an AI Overview sits above it", accent: false },
              { label: "The engines read a source", body: "The article becomes one of the pages an answer is assembled from, so the brand gets named.", foot: "Measured across each cluster of prompts, on every engine", accent: true },
            ].map((c) => (
              <div key={c.label} style={{ ...CARD, borderRadius: "18px", padding: "24px 26px", border: "1px solid " + (c.accent ? T.accent : T.line) }}>
                <div style={{ ...MICRO, color: c.accent ? T.accent : T.soft }}>{c.label}</div>
                <p style={{ margin: "10px 0 0", fontSize: "15px", lineHeight: 1.6, color: T.ink }}>{c.body}</p>
                <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid " + T.hair, fontSize: "13px", color: T.soft }}>{c.foot}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <Head title="What we actually do" lede="Three pieces of work, all aimed at the pages the scan found." />
          <ol className="three-up" style={{ listStyle: "none", margin: "24px 0 0", padding: 0, gap: "16px" }}>
            {WORK.map((w, i) => (
              <li key={w.heading} style={{ ...CARD, borderRadius: "18px", padding: "24px" }}>
                <div
                  aria-hidden="true"
                  style={{ width: "32px", height: "32px", borderRadius: "999px", background: T.wash, color: T.accentHover, fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {i + 1}
                </div>
                <h3 style={{ margin: "16px 0 0", fontSize: "16px", fontWeight: 700, lineHeight: 1.35, color: T.ink }}>{w.heading}</h3>
                <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>{w.body}</p>
              </li>
            ))}
          </ol>
          <p style={{ margin: "20px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
            <Link href="/packages" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
              See all packages
            </Link>
            {tracked
              ? ` - ${tracked.priceLabel} for tracking alone, at ${TRACKED_BASIS}. What each includes is on its own page, not behind a call.`
              : "."}
          </p>
        </section>

        <DarkClosing id="hiw-close" title="See which pages sit behind your answers.">
          {word(QUESTIONS)} buyer prompts, {word(FREE_ENGINE_COUNT).toLowerCase()} engines, every answer and every
          source it cited. Around two minutes, or we email you the result.
        </DarkClosing>
      </div>
    </>
  );
}
