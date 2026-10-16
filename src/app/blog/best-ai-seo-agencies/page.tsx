import type { Metadata } from "next";
import Link from "next/link";

import PostShell, { H2, Method, OL, P, UL } from "@/components/PostShell";
import TierName from "@/components/TierName";
import { onlyIf } from "@/config/capabilities";
import { TRACKED_BASIS, TRACKED_PRICE } from "@/config/pricing";
import { blogPostingSchema, postMetadata, postUrl, requirePost, type PostCopy } from "@/config/posts";
import { FREE_ANSWERS, FREE_ENGINE_LABELS, QUESTIONS, listOf } from "@/config/scan-shape";
import { formatPrice } from "@/config/sector-pricing";
import { BRAND, ld, SITE_URL } from "@/config/schema";
import { T } from "@/config/tokens";

/**
 * The US agencies list, from docs/drafts/best-ai-seo-agencies-us.md (R66,
 * danny.md line 67).
 *
 * Every line about another agency was read on that agency's own site on
 * 28 Sep 2026 (docs/parity/r66-fetch.mjs). Lines the draft took from
 * third-party rankings and that the agency's own pages did not bear out were
 * cut, not flagged - Danny's instruction: "appears on more rankings than any
 * other", "does not publish fixed pricing", "research on how AI Overviews
 * choose sources", "topical depth and internal linking", "top five of several
 * rankings", "Google Premier Partner", "no-contract" (the site says
 * month-to-month), and the clause about what AI engines lean on, which is a
 * statement about what an engine does with no dated source. No agency's
 * price or score appears here.
 *
 * alwayscited's own figures are read from pricing.ts and scan-shape.ts.
 */

const post = requirePost("best-ai-seo-agencies");

const COPY: PostCopy = {
  description:
    "The best AI SEO agencies in the US for getting named in AI answers, ranked on what a buyer can check before signing: measurement, placements, published prices and reporting.",
  ogDescription:
    "Nine US AI SEO agencies, ranked on what you can check before you sign. We put ourselves first, and say where we are not the fit.",
};

export const metadata: Metadata = postMetadata(post, COPY);

const postSchema = blogPostingSchema(post, COPY);

const STANDFIRST =
  "Who to hire to get your brand named in AI answers, ranked on what you can check before you sign.";

type Agency = { id: string; name: string; url: string; heading: string; body: string; bestFor: string };

/** Positions 2-9. alwayscited is position 1 and is written out in full below. */
const OTHERS: Agency[] = [
  {
    id: "avenue-z",
    name: "Avenue Z",
    url: "https://avenuez.com",
    heading: "best for PR-led AI visibility",
    body: "Avenue Z positions itself at the point where PR and AI search meet: it sells winning AI search through PR and digital marketing, with PR and answer engine optimization run as one program.",
    bestFor: "brands whose AI visibility problem is really a reputation and media problem.",
  },
  {
    id: "go-fish-digital",
    name: "Go Fish Digital",
    url: "https://gofishdigital.com",
    heading: "best for search and AI search under one roof",
    body: "Go Fish Digital works on getting brands ranked in Google and cited in AI search, through GEO, SEO, digital PR and paid media, and publishes its GEO work as case studies.",
    bestFor: "teams that want AI search handled by the same agency as their classic SEO.",
  },
  {
    id: "siege-media",
    name: "Siege Media",
    url: "https://www.siegemedia.com",
    heading: "best for content and original research",
    body: "Siege Media calls itself a full-service GEO agency, built on content marketing, digital PR and design, and publishes its own research reports and data studies.",
    bestFor: "brands with strong technical foundations that need content worth citing.",
  },
  {
    id: "omniscient-digital",
    name: "Omniscient Digital",
    url: "https://beomniscient.com",
    heading: "best for B2B software",
    body: "Omniscient Digital is an organic growth agency in Austin, Texas, that helps B2B software businesses turn SEO, GEO and content into growth channels.",
    bestFor: "B2B software brands that want to own a topic through their own content.",
  },
  {
    id: "foundation",
    name: "Foundation",
    url: "https://foundationinc.co",
    heading: "best for B2B tech and SaaS",
    body: "Foundation describes itself as the AI visibility agency for B2B tech and SaaS, with demand generation alongside its SEO and GEO work.",
    bestFor: "SaaS marketing teams measured on pipeline.",
  },
  {
    id: "np-digital",
    name: "NP Digital",
    url: "https://npdigital.com",
    heading: "best for scale",
    body: "NP Digital is a full-funnel agency running SEO, content, digital PR, organic social and paid media side by side.",
    bestFor: "large brands that want one agency across every channel.",
  },
  {
    id: "thrive",
    name: "Thrive Internet Marketing Agency",
    url: "https://thriveagency.com",
    heading: "best for full-service on a monthly contract",
    body: "Thrive is headquartered in Arlington, Texas, and offers AI SEO services alongside technical SEO, PPC, social media and web design, on month-to-month contracts.",
    bestFor: "small and mid-size businesses that want AI SEO bundled with the rest of their marketing.",
  },
  {
    id: "searchbloom",
    name: "Searchbloom",
    url: "https://www.searchbloom.com",
    heading: "best for a published method",
    body: "Searchbloom publishes a chapter-by-chapter AI SEO playbook, covering AEO and GEO and built on its own MERIT framework, alongside SEO, paid search and digital PR services.",
    bestFor: "mid-market businesses that want to read the method before they buy it.",
  },
];

const itemListSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: post.title,
  url: postUrl(post),
  numberOfItems: OTHERS.length + 1,
  itemListElement: [
    { "@type": "ListItem", position: 1, name: BRAND, url: SITE_URL },
    ...OTHERS.map((a, i) => ({ "@type": "ListItem", position: i + 2, name: a.name, url: a.url })),
  ],
};

const SECTIONS = [
  { id: "how-we-ranked-them", label: "How we ranked them" },
  { id: "alwayscited", label: "1. Our own service" },
  ...OTHERS.map((a, i) => ({ id: a.id, label: `${i + 2}. ${a.name}` })),
  { id: "what-to-ask", label: "What to ask any AI SEO agency" },
];

const B = ({ children }: { children: React.ReactNode }) => <strong style={{ color: T.ink }}>{children}</strong>;

export default function Post() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(postSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(itemListSchema) }} />
      <PostShell post={post} standfirst={STANDFIRST} sections={SECTIONS}>
        <P>
          <B>Disclosure first.</B> We run <TierName tier="cited" />. We put it at number one, and below we say why, and
          where it is not the right fit. The useful lists say so. So do we.
        </P>

        <H2 id="how-we-ranked-them">How we ranked them</H2>
        <P>
          Every agency on this list says it can get you into AI answers. Few let you check that before you pay.
          We ranked on four things a buyer can verify:
        </P>
        <UL>
          <li>
            <B>It measures the answer, not a proxy.</B> Does it put your buyers&apos; prompts to the engines and
            report whether you were named, engine by engine?
          </li>
          <li>
            <B>It works where the answers come from.</B> Does the agency get you into the third-party pages the
            engines cite for your category, or does it only work on your own site?
          </li>
          <li>
            <B>The price is published.</B> Can you see what it costs without a sales call?
          </li>
          <li>
            <B>It reports on its own work.</B> Does every piece of work come back with whether it changed what the
            engines said?
          </li>
        </UL>
        <P>
          Where we describe another agency, it is from how the agency describes itself on its own site, read on{" "}
          28 September 2026. We do not score other agencies, and we do not quote their prices.
        </P>

        <H2 id="alwayscited">1. <TierName tier="cited" /> - best for being named in the answer, with the price on the page</H2>
        <P>
          It is an{" "}
          <Link href="/" style={{ color: T.accent, fontWeight: 600 }}>
            AI SEO agency
          </Link>{" "}
          service, built and run by the senior team at nomada digital, a search agency in York, in the UK.
        </P>
        <UL>
          <li>
            <B>It starts with the measurement.</B> The free scan writes {QUESTIONS} buyer prompts for your
            category, puts each to {listOf(FREE_ENGINE_LABELS)}, and shows all {FREE_ANSWERS} answers, with the
            pages each engine cited. No email needed to see it.
          </li>
          <li>
            <B>It places where the engines already read.</B> The placement tiers put your brand into the
            third-party pages the engines are already citing for your keyword cluster, so you are named inside the answer
            rather than ranked in the links under it.
          </li>
          <li>
            <B>Every placement is reported.</B> Each one comes back with whether the engines now cite it.
          </li>
          <li>
            <B>The prices are published.</B> <TierName tier="tracked" /> is from{" "}
            {formatPrice(TRACKED_PRICE.us, "us")} a month for {TRACKED_BASIS}. The placement tiers are priced by
            sector on the{" "}
            <Link href="/packages" style={{ color: T.accent, fontWeight: 600 }}>
              packages page
            </Link>
            . Monthly, no minimum term.
          </li>
          <li>
            <B>Agencies can resell it.</B>
            {/* "are white-label" waits on a dashboard in the agency's brand (LB1, 8 Oct 2026). */}
            {onlyIf("dashboardBranding", <> <TierName tier="tracked" /> to <TierName tier="cited" /> are white-label.</>)}
          </li>
        </UL>
        <P>
          <B>Not the fit if</B> you want one agency to run your paid media, social and site build as well. We do
          one job.
        </P>

        {OTHERS.map((a, i) => (
          <div key={a.id}>
            <H2 id={a.id}>
              {i + 2}. {a.name} - {a.heading}
            </H2>
            <P>{a.body}</P>
            <P>
              <B>Best for:</B> {a.bestFor}
            </P>
          </div>
        ))}

        <H2 id="what-to-ask">What to ask any AI SEO agency, including us</H2>
        <OL>
          <li>Which prompts will you track, and on which engines?</li>
          <li>Can I see the answers, not just a score?</li>
          <li>Which pages are the engines citing for my category today, and will you work on those?</li>
          <li>What does each piece of work cost, and what will you report back on it?</li>
          <li>What happens if nothing moves in three months?</li>
        </OL>
        <P>If an agency cannot answer the first three before you sign, it is guessing.</P>

        <P>
          The free{" "}
          <Link href="/llm-visibility-checker" style={{ color: T.accent, fontWeight: 600 }}>
            LLM visibility checker
          </Link>{" "}
          shows whether the engines name you today, who they name instead, and which pages they are reading.{" "}
          <Link href="/#scan" style={{ color: T.accent, fontWeight: 600 }}>
            Run it on your domain
          </Link>{" "}
          - it takes about two minutes.
        </P>

        <Method>
          How we researched this: each agency&apos;s description was read on its own site on 28 September 2026.
          Anything we could not confirm there was left out.
        </Method>
      </PostShell>
    </>
  );
}
