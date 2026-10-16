import type { Metadata } from "next";
import Link from "next/link";
import SectionHead from "@/components/SectionHead";

import DarkClosing from "@/components/DarkClosing";
import HeroScanArea from "@/components/home/HeroScanArea";
import { D, WASH, WASH_SIZE } from "@/components/home/dark";
import { word } from "@/components/home/EngineDemo";
import WalkthroughForm from "@/components/scan/WalkthroughForm";
import TierName from "@/components/TierName";
import { OG_IMAGE } from "@/config/og";
import { PLAN_ENGINES, TIERS, TRACKED_BASIS } from "@/config/pricing";
import { FREE_ANSWERS, FREE_ENGINE_COUNT, FREE_ENGINE_LABELS, QUESTIONS, listOf } from "@/config/scan-shape";
import { ld, ORG_REF, SITE_REF } from "@/config/schema";
import { CARD, H2, MICRO, SHELL, T } from "@/config/tokens";
import { ENGINE_SPECS, FREE_ENGINES } from "@/lib/scan/engines";
import { scanReady } from "@/lib/scan/readiness";

/**
 * /llm-visibility-checker (R67, danny.md line 68). A landing page for the
 * search "llm visibility checker" around the scan the homepage already runs:
 * the same HeroScanArea, so no new scan code and no new paid path.
 *
 * Every count and engine name is read - QUESTIONS and the free engine set from
 * scan-shape.ts / engines.ts, and the engines the free check leaves out are
 * derived as PLAN_ENGINES minus FREE_ENGINES rather than typed, so the Claude
 * answer below moves if either set does.
 *
 * No animated beat: the page's argument is the scan itself, and the homepage
 * already carries the engine demo.
 */

const URL = "https://alwayscited.com/llm-visibility-checker";

export const metadata: Metadata = {
  title: { absolute: "LLM visibility checker - free, four AI engines | alwayscited" },
  description: `See whether ${listOf(FREE_ENGINE_LABELS.filter((l) => l !== ENGINE_SPECS.google_aio.label))} and ${ENGINE_SPECS.google_aio.label} name your brand, free and with no email.`,
  alternates: { canonical: URL },
  openGraph: { url: URL, images: OG_IMAGE },
};

const PLAN_ONLY = PLAN_ENGINES.filter((e) => !(FREE_ENGINES as readonly string[]).includes(e)).map((e) => ENGINE_SPECS[e].label);
const TRACKED_HREF = TIERS.find((t) => t.key === "tracked")!.href;

const CHECKS: { t: string; b: string }[] = [
  {
    t: `${word(QUESTIONS)} buyer prompts`,
    b: "Written for your category from your own site, and shown to you to confirm before anything runs.",
  },
  {
    t: `${word(FREE_ENGINE_COUNT)} engines`,
    b: `${listOf(FREE_ENGINE_LABELS)}. Each prompt goes to each one, so you get ${FREE_ANSWERS} answers.`,
  },
  { t: "Every answer, and its sources", b: "The full text of each answer and the pages each engine cited to build it." },
  { t: "Your Google position", b: "Where your site ranks on Google for the keyword behind the prompts, beside what the AI answers said." },
  { t: "Who is named instead", b: "The brands the engines recommend when they do not name you." },
  { t: "Placement pages, scored", b: "The cited pages you could be placed on, each scored for how hard it is to get onto." },
];

const STEPS = [
  { t: "Enter your domain", b: "The field above. No card and no email." },
  { t: "Confirm the cluster and prompts", b: "We read your site and propose the category, the keyword and the prompts. Change them if they are wrong." },
  { t: "Read the answers", b: "About two minutes later, every answer from every engine, with the pages behind it." },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Is the LLM visibility checker free?",
    a: "Yes. The whole result is free and there is no email to give. You only pay if you want the check run for you every day, or want us to get you named.",
  },
  {
    q: "Which LLMs does it check?",
    a: `${listOf(FREE_ENGINE_LABELS)}: ${word(QUESTIONS).toLowerCase()} prompts on each, ${FREE_ANSWERS} answers in all.`,
  },
  {
    q: `Why is ${listOf(PLAN_ONLY)} not in the free check?`,
    a: `The free check reads the ${word(FREE_ENGINE_COUNT).toLowerCase()} engines above. ${listOf(PLAN_ONLY)} is added on the placement tiers.`,
  },
  {
    q: "How does this differ from the tracking plan?",
    a: `This is one reading, today. The tracking plan runs the check for you: ${TRACKED_BASIS}, so you see the answers move over time.`,
  },
  {
    // Not "yes, kept": reading-retention.test.mts holds that the purge clears
    // the answer text on unclaimed scans, so how long is the privacy policy's
    // to say, not this page's.
    q: "What happens to my result?",
    a: "It opens on its own link, which you can come back to. How long each part of a scan is held, and why, is set out in the privacy policy.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  isPartOf: SITE_REF,
  publisher: ORG_REF,
  mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
};

export default function LlmVisibilityChecker() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(faqSchema) }} />

      <section
        id="scan"
        className="home-hero"
        style={{
          backgroundColor: D.ground,
          backgroundImage: WASH,
          backgroundSize: WASH_SIZE,
          backgroundRepeat: "no-repeat",
          color: T.surface,
        }}
      >
        <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "72px 24px 60px", boxSizing: "border-box", textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: "clamp(34px, 5vw, 60px)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.04, color: T.surface }}>
            LLM visibility checker
          </h1>
          <p style={{ margin: "20px auto 0", fontSize: "18px", lineHeight: 1.55, color: D.muted, maxWidth: "52ch" }}>
            Free, no email, about two minutes. See whether the AI engines name your brand when your buyers ask.
          </p>
          <HeroScanArea
            ready={scanReady()}
            questionsLine={`${word(QUESTIONS)} buyer prompts, ${word(FREE_ENGINE_COUNT).toLowerCase()} engines, around two minutes. No card, no email.`}
          />
        </div>
      </section>

      <div style={{ ...SHELL, paddingTop: "44px", paddingBottom: "44px", display: "flex", flexDirection: "column", gap: "40px" }}>
        <section>
          <SectionHead
            style={{ marginBottom: "16px" }}
            title="What it checks"
            intro={
              <>
              An AI visibility checker should show you the answers, not a score. This one puts the prompts your buyers
              use to the engines and shows you what came back - your LLM brand visibility, prompt by prompt.
              </>
            }
          />
          <div className="three-up">
            {CHECKS.map((c) => (
              <div key={c.t} style={{ ...CARD, padding: "22px" }}>
                <div style={{ fontSize: "15.5px", fontWeight: 600, lineHeight: 1.35, color: T.ink }}>{c.t}</div>
                <p style={{ margin: "8px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>{c.b}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionHead
            style={{ marginBottom: "16px" }}
            title="How it works"
            intro={
              <>
              Three steps, and nothing runs until you have seen the prompts.
              </>
            }
          />
          <div className="three-up">
            {STEPS.map((s, i) => (
              <div key={s.t} style={{ ...CARD, padding: "22px" }}>
                <div style={{ ...MICRO, color: T.accent }}>Step {i + 1}</div>
                <div style={{ fontSize: "15.5px", fontWeight: 600, marginTop: "8px", lineHeight: 1.35, color: T.ink }}>{s.t}</div>
                <p style={{ margin: "8px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>{s.b}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ ...CARD, padding: "26px" }}>
          <h2 style={{ ...H2, margin: 0 }}>What it is not</h2>
          <p style={{ margin: "10px 0 0", fontSize: "14.5px", lineHeight: 1.65, color: T.soft, maxWidth: "70ch" }}>
            It is not a crawler, and it is not a check of whether your HTML is readable by a model. Those tell you
            whether an engine could read your site. This puts the prompts a buyer actually uses to the engines, and
            tells you whether you were the answer.
          </p>
        </section>

        <section className="see-first" style={{ ...CARD, padding: "24px" }}>
          <div>
            <h2 style={{ ...H2, margin: 0 }}>
              The same check, every day: <TierName tier="tracked" />
            </h2>
            <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft, maxWidth: "46ch" }}>
              {TRACKED_BASIS}, on the same engines, so you see the answers move rather than one reading.{" "}
              <Link href={TRACKED_HREF} style={{ fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                See the plan
              </Link>
              . Or ask for a walkthrough first.
            </p>
          </div>
          <WalkthroughForm from={TRACKED_HREF} />
        </section>

        <section id="faq">
          <SectionHead
            style={{ marginBottom: "16px" }}
            title="Questions"
          />
          <div style={{ ...CARD, overflow: "hidden" }}>
            {FAQS.map((f, i) => (
              <div key={f.q} style={{ padding: "18px 26px", borderTop: i ? `1px solid ${T.hair}` : undefined }}>
                <h3 style={{ margin: 0, fontSize: "15.5px", fontWeight: 600, color: T.ink }}>{f.q}</h3>
                <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.65, color: T.soft, maxWidth: "72ch" }}>{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The page ended on its FAQ - "Is it free? Yes" - with the hero's
            field some 2,000px up (R151, 3 Oct 2026). The closing the other
            explainer pages use, so the answer has its action under it. */}
        <DarkClosing id="checker-close" marginTop="0" title="See whether the answers name you.">
          {word(QUESTIONS)} buyer prompts, {word(FREE_ENGINE_COUNT).toLowerCase()} engines, every answer and its
          sources. No card, no email.
        </DarkClosing>
      </div>
    </>
  );
}
