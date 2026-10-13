import type { AdviceLine } from "../core/evidence.ts";

/**
 * Every advice line Your pages draws (13 Oct 2026, DIY P8; spec 10 sections
 * 4.9, 6.4 and 6.5), each with its evidence grade, and each line that leans
 * on a document naming its register entry: advice-grades.test.mts (P1) holds
 * every line here to the register, and a line that fails it does not render
 * (evidence.ts gradeChip answers null).
 *
 * The sources are Google's own pages, read 12 Oct 2026 (core.sources.ts):
 * G2 (general structured data guidelines, updated 10 Jul 2026), G3 (the
 * search gallery, updated 15 Jun 2026), G4 (FAQPage, FAQ rich results gone
 * from 7 May 2026) and S41 (AI features and your website, updated 10 Dec
 * 2025). Nothing here says schema helps an engine cite a page, and no study
 * is named or quoted (section 2.3; S43 is internal for exactly that reason).
 *
 * `{keyword}`, `{n}` and the like are filled by the code that draws a line;
 * the words around them are fixed here.
 */
export const ADVICE: AdviceLine[] = [
  // ---- The schema rule table (section 6.4). ----
  { id: "pages.schema.organization", text: "Add Organization markup to your homepage with name, url, logo and sameAs.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.organization_props", text: "Your Organization markup is missing {props}.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.website", text: "Add WebSite markup with your site name to your homepage.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.breadcrumbs", text: "This page shows breadcrumbs. Mark them up as a BreadcrumbList.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.product", text: "A price shows on this page. Product markup with an Offer (price and currency) describes it.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.product_hidden", text: "The markup states a price this page does not show. Marked-up content must be visible on the page.", grade: "documented", sourceId: "G2" },
  { id: "pages.schema.rating_hidden", text: "Ratings or reviews are marked up, but none show on the page. Remove the markup, or show the reviews.", grade: "documented", sourceId: "G2" },
  { id: "pages.schema.rating_unseen", text: "Ratings or reviews are marked up, but we didn't see any in the page's HTML. If they show only once JavaScript runs, check they're on the page; if they don't show at all, remove the markup. Marked-up content must be visible on the page.", grade: "documented", sourceId: "G2" },
  { id: "pages.schema.local", text: "An address shows on this page. LocalBusiness markup with that address describes it.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.article", text: "Article markup with an author (a Person) and its dates describes this post.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.article_props", text: "Your Article markup is missing {props}.", grade: "documented", sourceId: "G3" },
  { id: "pages.schema.validator", text: "The validator found {n} in the structured data we found.", grade: "your_data" },
  { id: "pages.schema.conflict", text: "Two {type} blocks name different things. Keep one.", grade: "your_data" },
  { id: "pages.schema.js_only", text: "This markup appears only after JavaScript runs.", grade: "your_data" },
  { id: "pages.schema.facts_text", text: "Your {fact} is in the markup but not in the page text. Add it to the page text.", grade: "documented", sourceId: "G2" },
  { id: "pages.schema.faq", text: "No longer produces a Google rich result (from 7 May 2026). Keep it if it describes visible Q&A; no need to add it.", grade: "documented", sourceId: "G4" },
  { id: "pages.schema.unparsed", text: "{n} of the JSON-LD blocks on this page did not parse.", grade: "your_data" },

  // ---- The Schema tab's evidence box, always shown (section 4.9). ----
  { id: "pages.evidence.eligible", text: "Structured data makes a page eligible for Google's rich results; correct markup doesn't guarantee one (Google, updated 10 Jul 2026).", grade: "documented", sourceId: "G2" },
  { id: "pages.evidence.ai_features", text: "Google says no special schema is needed to appear in AI Overviews or AI Mode (Google Search Central, updated 10 Dec 2025).", grade: "documented", sourceId: "S41" },
  { id: "pages.evidence.faq", text: "FAQ rich results are no longer shown, from 7 May 2026 (Google).", grade: "documented", sourceId: "G4" },

  // ---- The fix (section 6.4, the fix generator). ----
  { id: "pages.fix.placeholders", text: "This block won't validate until the [ADD] fields are filled.", grade: "documented", sourceId: "G3" },
  { id: "pages.fix.found", text: "Every value comes from your own page, and says where it came from.", grade: "your_data" },

  // ---- How to add it: generic steps, no outcome promised. ----
  { id: "pages.howto.wordpress", text: "WordPress: paste the block into your SEO plugin's custom schema field, or into a Custom HTML block on that page.", grade: "practice" },
  { id: "pages.howto.shopify", text: "Shopify: add the block to the page's theme template, inside a script tag of type application/ld+json.", grade: "practice" },
  { id: "pages.howto.webflow", text: "Webflow: paste it into the page's custom code, in the head, inside a script tag of type application/ld+json.", grade: "practice" },
  { id: "pages.howto.squarespace", text: "Squarespace: paste it into the page's header code injection, inside a script tag of type application/ld+json.", grade: "practice" },
  { id: "pages.howto.wix", text: "Wix: paste it into the page's structured data markup in its SEO settings.", grade: "practice" },
  { id: "pages.howto.other", text: "Anything else: put it in the page's HTML, inside a script tag of type application/ld+json, then check it with the test linked above.", grade: "practice" },
  { id: "pages.howto.tag_manager", text: "Added through a tag manager, the block is only in the page once JavaScript runs. Putting it in the page's HTML is the surer route.", grade: "practice" },

  // ---- Crawler access (section 6.4; Bots view, section 4.9). ----
  { id: "pages.bots.googlebot", text: "Google says crawling must be allowed for a page to appear in its AI features (Search Central, updated 10 Dec 2025).", grade: "documented", sourceId: "S41" },
  { id: "pages.bots.extended", text: "Blocking Google-Extended is a choice, not an error. We don't count it as a problem.", grade: "practice" },
  { id: "pages.bots.llms", text: "Optional. Google says no AI text files are needed (Search Central, updated 10 Dec 2025).", grade: "documented", sourceId: "S41" },
  { id: "pages.bots.lines", text: "Change these lines in your robots.txt, then check this page again.", grade: "your_data" },

  // ---- Basics (section 4.9, the Basics tab). ----
  { id: "pages.basics.js_only", text: "This page shows little without JavaScript: {static} words in its HTML, {rendered} once JavaScript runs.", grade: "your_data" },
  { id: "pages.basics.text_form", text: "Keep important content in text form (Google Search Central, updated 10 Dec 2025).", grade: "documented", sourceId: "S41" },
  { id: "pages.basics.status", text: "This page answered HTTP {status} when we read it.", grade: "your_data" },
  { id: "pages.basics.noindex", text: "This page tells search engines not to index it ({where}).", grade: "your_data" },
  { id: "pages.basics.canonical", text: "This page's canonical points to another address: {canonical}.", grade: "your_data" },

  // ---- Page fit (section 6.4, the four verdicts). ----
  { id: "pages.fit.no_page", text: "None of your pages ranks in the top 20 for '{keyword}' yet. Pick the page you want to rank.", grade: "your_data" },
  { id: "pages.fit.homepage", text: "Your homepage is what ranks for '{keyword}'. Pick the page you want to rank.", grade: "your_data" },
  { id: "pages.fit.different", text: "Google answers '{keyword}' with {kind}: {n} of the {of} we could type. {yours} Two routes: get onto those {kind} ({opps}), or publish {own}.", grade: "your_data" },
  { id: "pages.fit.elsewhere", text: "Another of your pages is the one that ranks for '{keyword}', so this page's fit isn't read for it. Open that page's fit, or add it as a key page.", grade: "your_data" },
  { id: "pages.fit.split", text: "Pick one, point internal links at it, and merge or differentiate the other.", grade: "practice" },
  { id: "pages.fit.fits", text: "The page matches what ranks. The page is probably not the problem.", grade: "your_data" },
  { id: "pages.fit.out", text: "None of your pages was in the top 20 for '{keyword}' on {n} of its {of} readings so far.", grade: "your_data" },
  { id: "pages.fit.fix_first", text: "Fix this page's {what} first. Its fit is read once that is done.", grade: "your_data" },

  // ---- The examples library (section 4.9, Examples view): each pair's requirement. ----
  { id: "pages.examples.organization", text: "Organization, on your homepage: name, url, logo and sameAs (your profile links).", grade: "documented", sourceId: "G3" },
  { id: "pages.examples.website", text: "WebSite, on your homepage: your site's name and its url.", grade: "documented", sourceId: "G3" },
  { id: "pages.examples.local", text: "LocalBusiness, for a business whose address shows on the page: its name and that full address.", grade: "documented", sourceId: "G3" },
  { id: "pages.examples.product", text: "Product with an Offer, only where the price shows on the page: marked-up content must be visible.", grade: "documented", sourceId: "G2" },
  { id: "pages.examples.breadcrumbs", text: "BreadcrumbList, matching the breadcrumbs the page shows.", grade: "documented", sourceId: "G3" },
  { id: "pages.examples.article", text: "Article, with an author who is a Person, and the dates it was published and last changed.", grade: "documented", sourceId: "G3" },
  { id: "pages.examples.profile", text: "ProfilePage, for a page about one person or organisation, naming it as the mainEntity.", grade: "documented", sourceId: "G3" },
  { id: "pages.examples.howto", text: "HowTo is not among the results Google's search gallery lists (updated 15 Jun 2026). Mark up a how-to only where it describes the page; expect no rich result.", grade: "documented", sourceId: "G3" },

  // ---- Re-optimisation diagnostics (section 6.5): every row a fact. ----
  { id: "pages.diag.table", text: "You against the top 3 for '{keyword}', from our own reads.", grade: "your_data" },
  { id: "pages.diag.engines", text: "What the engines say, from a stored answer to one of your prompts.", grade: "your_data" },
];
