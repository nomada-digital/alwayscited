import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import KeywordMoves from "@/components/charts/KeywordMoves";
import PositionBands from "@/components/charts/PositionBands";
import PromptThenNow from "@/components/charts/PromptThenNow";
import StartNowBars from "@/components/charts/StartNowBars";
import TrendLine from "@/components/charts/TrendLine";
import TwoWays from "@/components/home/TwoWays";
import { OG_IMAGE } from "@/config/og";
import { ORG_REF, ld } from "@/config/schema";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { caseStudy, longDate, publishedCaseStudies, windowOf, type CaseStudy } from "@/lib/case-studies";

/**
 * A case study published from the Nomada agency hub (see `lib/case-studies.ts`).
 *
 * Nothing on this page is typed here: headline, figures, chart and keywords
 * all come from the published study, which was frozen from the dashboards'
 * tracking, signed off by the client and published by Danny. The page's job
 * is to print every figure with its scope - the window it was measured over
 * and the method line - which is the rule `client-results.test.mts` holds the
 * attested figures to. The window opens the page and closes it, and the
 * JSON-LD description carries it too, because that string is read detached
 * from the body.
 *
 * ISR: a study published on the hub is here within `CASE_STUDY_REVALIDATE`
 * seconds without a deploy; one taken down 404s on the next re-read.
 * `/case-studies/vibe-retail` is a static folder and wins over this route.
 */

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await publishedCaseStudies()).map((s) => ({ id: s.id }));
}

const url = (id: string) => `https://alwayscited.com/case-studies/${id}`;

function standfirst(s: CaseStudy): string {
  const w = windowOf(s);
  return [s.intro, w ? `Measured ${w}.` : null].filter(Boolean).join(" ");
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const s = await caseStudy((await params).id);
  // No robots tag here: an unknown id renders not-found, which carries its own.
  if (!s) return { title: "Case study not found" };
  return {
    title: s.headline,
    description: standfirst(s).slice(0, 300),
    alternates: { canonical: url(s.id) },
    openGraph: { images: OG_IMAGE, title: `${s.headline} | alwayscited`, description: standfirst(s).slice(0, 300), url: url(s.id) },
  };
}

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 style={{ margin: "26px 0 0", fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: "10px 0 0", fontSize: "15px", lineHeight: 1.7, color: T.ink }}>{children}</p>
);

const bandCaption = (kw?: number | null) =>
  kw ? `How many of the ${kw} tracked keywords sit in the top 20, by band, one reading a week.` : "Tracked keywords in the top 20, by band, one reading a week.";

/** The weekly page-1 line or the monthly-searches line, through the shared TrendLine. */
function Line({ series, metric, caption }: { series: { d: string; p1: number; vol?: number }[]; metric: "p1" | "vol"; caption: string }) {
  const points = series.map((p) => ({ d: p.d, v: metric === "vol" ? p.vol ?? 0 : p.p1 }));
  const first = points[0]!, last = points[points.length - 1]!;
  return <TrendLine points={points} mode="count" caption={caption}
    ariaLabel={`${caption} ${first.v.toLocaleString("en-US")} on ${longDate(first.d)}, ${last.v.toLocaleString("en-US")} on ${longDate(last.d)}`} />;
}

/** A screenshot of the client's live dashboard for one section of the study. */
function Shot({ s, section, date }: { s: CaseStudy; section: "google" | "ai" | "prompts"; date?: string }) {
  const sh = s.shots?.find((x) => x.section === section);
  if (!sh) return null;
  return (
    <figure style={{ margin: "16px 0 0" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an embedded data: image, nothing for next/image to optimise */}
      <img src={sh.src} alt={sh.alt} width={sh.w} height={sh.h} loading="lazy"
        style={{ width: "100%", height: "auto", borderRadius: "12px", border: "1px solid " + T.line, display: "block" }} />
      <figcaption style={{ marginTop: "6px", fontSize: "12.5px", color: T.soft }}>
        From the client&rsquo;s live dashboard{date ? `, as at ${longDate(date)}` : ""}.
      </figcaption>
    </figure>
  );
}

export default async function PublishedCaseStudy({ params }: { params: Promise<{ id: string }> }) {
  const s = await caseStudy((await params).id);
  if (!s) notFound();
  const w = windowOf(s);

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: s.headline,
    description: standfirst(s),
    datePublished: s.published,
    url: url(s.id),
    author: ORG_REF,
    publisher: ORG_REF,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(articleSchema) }} />
      <div style={{ ...SHELL, paddingTop: "40px", paddingBottom: "56px", display: "flex", flexDirection: "column", gap: "26px", maxWidth: "860px" }}>
        <div>
          <div className="ac-row" style={{ ...MICRO, color: T.accent }}>
            {[s.named ? s.client : null, s.market, s.periodLabel].filter(Boolean).join(" - ")}
          </div>
          <h1 className="ac-row" style={{ margin: "10px 0 0", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: T.ink }}>
            {s.headline}
          </h1>
          {s.intro && <p className="ac-row" style={{ margin: "12px 0 0", fontSize: "16px", lineHeight: 1.65, color: T.soft }}>{s.intro}</p>}
          {w && <p className="ac-row" style={{ margin: "8px 0 0", fontSize: "13.5px", color: T.soft }}>Measured {w}.</p>}
        </div>

        {s.hero && (
          // the results image drawn on the hub: width and height set so the page does not shift
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.hero.src} alt={s.hero.alt} width={s.hero.width} height={s.hero.height} fetchPriority="high" decoding="async"
            style={{ display: "block", width: "100%", maxWidth: "520px", height: "auto", borderRadius: "14px", border: "1px solid " + T.line }} />
        )}

        {!!s.kpis?.length && (
          <div className="ac-row" style={{ display: "flex", flexWrap: "wrap", background: T.bg, border: "1px solid " + T.line, borderRadius: "14px", overflow: "hidden" }}>
            {s.kpis.map((k, i) => (
              <div key={k.l} style={{ flexGrow: 1, flexBasis: "170px", padding: "18px 20px", borderLeft: i ? "1px solid " + T.line : undefined }}>
                <div style={{ fontSize: "12.5px", color: T.soft }}>{k.l}</div>
                <div style={{ fontSize: "27px", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.15, marginTop: "2px", color: T.ink }}>{k.n}</div>
                {w && <div style={{ fontSize: "12px", color: T.soft, marginTop: "5px" }}>Over {s.periodLabel ?? "the window"}</div>}
              </div>
            ))}
          </div>
        )}

        {s.compare && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={{ ...MICRO, marginBottom: "14px" }}>Google positions, start against now{w ? `, ${w}` : ""}</div>
            <StartNowBars rows={s.compare.rows} of={s.compare.kw} unit="keywords" />
          </div>
        )}

        {s.series && s.series.length > 1 && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            {s.series.some((p) => p.b3 !== undefined)
              ? <PositionBands series={s.series} caption={bandCaption(s.compare?.kw ?? s.tracked?.kw)} />
              : <Line series={s.series} metric="p1" caption="Tracked keywords on Google page 1, one reading a week." />}
            <Shot s={s} section="google" date={s.to} />
          </div>
        )}

        {s.series && s.series.length > 1 && s.series.some((p) => (p.vol ?? 0) > 0) && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <Line series={s.series} metric="vol" caption="Monthly searches for the keywords on Google page 1, one reading a week." />
          </div>
        )}

        {s.ai && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={MICRO}>AI visibility</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
              <span style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.035em", color: T.ink }}>{s.ai.pc[0]}% to {s.ai.pc[1]}%</span>
              <span style={{ fontSize: "14px", color: T.soft }}>
                of AI answers naming {s.named ? s.client : "the brand"}, {longDate(s.ai.from)} to {longDate(s.ai.to)}, across {s.ai.prompts} tracked prompts{s.engines ? ` on ${s.engines.rows.length} engines` : ""}
              </span>
            </div>
            {s.aiRuns && s.aiRuns.length > 1 && <div style={{ marginTop: "16px" }}><TrendLine points={s.aiRuns.map((r) => ({ d: r.d, v: r.pc }))} mode="percent" caption="Share of ChatGPT, Perplexity, Gemini and Claude answers naming the brand, every full run." ariaLabel={`AI answers naming the brand: ${s.aiRuns[0]!.pc}% on ${longDate(s.aiRuns[0]!.d)}, ${s.aiRuns[s.aiRuns.length - 1]!.pc}% on ${longDate(s.aiRuns[s.aiRuns.length - 1]!.d)}`} /></div>}
            <Shot s={s} section="ai" date={s.ai.to} />
          </div>
        )}

        {!!s.prompts?.length && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={{ ...MICRO, marginBottom: "12px" }}>What the engines say now, {longDate(s.ai?.to ?? s.to ?? s.published)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {s.prompts.map((c) => <PromptThenNow key={c.q} prompt={c.q} engines={c.engines} />)}
            </div>
            <Shot s={s} section="prompts" date={s.ai?.to} />
          </div>
        )}

        {s.engines && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={{ ...MICRO, marginBottom: "14px" }}>
              AI answers naming {s.named ? s.client : "the brand"}, {longDate(s.engines.from)} against {longDate(s.engines.to)}
            </div>
            <StartNowBars rows={s.engines.rows.map((e) => ({ l: e.e, then: e.then, now: e.now, of: e.of }))}
              of={Math.max(...s.engines.rows.map((e) => e.of))} unit="answers" />
          </div>
        )}

        <div className="ac-row">
          {s.challenge && (<><H2>The starting point</H2><P>{s.challenge}</P></>)}
          {s.approach && (<><H2>What we did</H2><P>{s.approach}</P></>)}
          {s.results && (<><H2>What moved</H2><P>{s.results}</P></>)}
        </div>

        {/* How the work gets a brand into answers: the homepage's illustrative pair, its own heading and made-up brands. */}
        <div className="ac-row" style={{ margin: "0 -24px" }}>
          <TwoWays />
        </div>

        {!!s.keywords?.length && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={MICRO}>Keywords that reached page 1{w ? `, ${w}` : ""}</div>
            <KeywordMoves rows={s.keywords} />
          </div>
        )}

        {!!s.movers?.length && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={MICRO}>Biggest climbs{w ? `, ${w}` : ""}</div>
            <KeywordMoves rows={s.movers} />
          </div>
        )}

        <div className="ac-row">
          {s.method && <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.6, color: T.soft }}>How it was measured: {s.method}</p>}
          <p style={{ margin: "8px 0 0", fontSize: "13px", color: T.soft }}>
            Published {longDate(s.published)}. {s.named ? "Named with the client's agreement." : "The client is not named."}
          </p>
          <p style={{ margin: "14px 0 0", fontSize: "14px" }}>
            <Link href="/case-studies" style={{ color: T.accent, fontWeight: 600 }}>All case studies</Link>
          </p>
        </div>
      </div>
    </>
  );
}
