/**
 * The schema examples library (13 Oct 2026, DIY P8; spec 10 section 4.9,
 * Examples view): good and bad JSON-LD pairs, static and dated. Each pair's
 * requirement is an advice line (schema.advice.ts `pages.examples.*`), graded
 * and sourced, and dated by its source's own updated date; nothing here says
 * what Google does in its own words.
 *
 * Every brand is made up: Tallyroo, Ledgerline and Brightbook are the
 * tracking fixture's world, and the page says so ("Illustrative. Tallyroo and
 * every brand shown are made up.").
 *
 * Not here yet: SoftwareApplication. Google's software-app requirements are
 * [VERIFY] (pages.sources.ts V-SOFTWAREAPP) and the pair does not ship until
 * they are read from Google's own page.
 */

export type ExamplePair = {
  id: string;
  type: string;
  /** The requirement this pair shows, as an advice line. */
  adviceId: string;
  good: Record<string, unknown>;
  bad: Record<string, unknown> | null;
  /** What is wrong with the bad one, in plain words; null when there is no bad one. */
  badWhy: string | null;
};

export const ILLUSTRATIVE = "Illustrative. Tallyroo and every brand shown are made up.";

const CTX = "https://schema.org";

export const EXAMPLES: readonly ExamplePair[] = [
  {
    id: "organization",
    type: "Organization",
    adviceId: "pages.examples.organization",
    good: {
      "@context": CTX,
      "@type": "Organization",
      name: "Tallyroo",
      url: "https://tallyroo.com/",
      logo: "https://tallyroo.com/img/tallyroo-logo.png",
      sameAs: ["https://linkedin.com/company/tallyroo", "https://x.com/tallyroo"],
    },
    bad: { "@context": CTX, "@type": "Organization", name: "Tallyroo - accounting software for freelancers", url: "http://tallyroo.com" },
    badWhy: "The name carries a tagline, the url is not https, and there is no logo and no sameAs.",
  },
  {
    id: "website",
    type: "WebSite",
    adviceId: "pages.examples.website",
    good: { "@context": CTX, "@type": "WebSite", name: "Tallyroo", url: "https://tallyroo.com/" },
    bad: { "@context": CTX, "@type": "WebSite", name: "Home", url: "https://tallyroo.com/index.html" },
    badWhy: "\"Home\" is not the site's name, and the url is one page rather than the site.",
  },
  {
    id: "local",
    type: "LocalBusiness",
    adviceId: "pages.examples.local",
    good: {
      "@context": CTX,
      "@type": "LocalBusiness",
      name: "Brightbook Bookkeeping",
      url: "https://brightbook.example/",
      telephone: "+1 555 010 0199",
      address: { "@type": "PostalAddress", streetAddress: "12 Harbor Street", addressLocality: "Portland", addressRegion: "OR", postalCode: "97201", addressCountry: "US" },
    },
    bad: { "@context": CTX, "@type": "LocalBusiness", name: "Brightbook Bookkeeping", address: "Portland" },
    badWhy: "The address is a town, not the address the page shows, and it is not split into its parts.",
  },
  {
    id: "product",
    type: "Product",
    adviceId: "pages.examples.product",
    good: {
      "@context": CTX,
      "@type": "Product",
      name: "Tallyroo Pro",
      description: "Invoicing and bookkeeping for small businesses.",
      offers: { "@type": "Offer", price: "29.00", priceCurrency: "USD", url: "https://tallyroo.com/pricing" },
    },
    bad: {
      "@context": CTX,
      "@type": "Product",
      name: "Tallyroo Pro",
      offers: { "@type": "Offer", price: "0" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "2000" },
    },
    badWhy: "The price is not the one the page shows, its currency is missing, and the rating is marked up on a page that shows no reviews.",
  },
  {
    id: "breadcrumbs",
    type: "BreadcrumbList",
    adviceId: "pages.examples.breadcrumbs",
    good: {
      "@context": CTX,
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://tallyroo.com/" },
        { "@type": "ListItem", position: 2, name: "Features", item: "https://tallyroo.com/features" },
        { "@type": "ListItem", position: 3, name: "Invoicing", item: "https://tallyroo.com/features/invoicing" },
      ],
    },
    bad: { "@context": CTX, "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", name: "Invoicing" }] },
    badWhy: "One item with no position and no address, where the page shows three steps.",
  },
  {
    id: "article",
    type: "Article",
    adviceId: "pages.examples.article",
    good: {
      "@context": CTX,
      "@type": "Article",
      headline: "How to send your first invoice",
      author: { "@type": "Person", name: "Sam Rivera", url: "https://tallyroo.com/team/sam-rivera" },
      datePublished: "2026-03-02",
      dateModified: "2026-09-14",
    },
    bad: { "@context": CTX, "@type": "Article", headline: "How to send your first invoice", author: "Tallyroo" },
    badWhy: "The author is the company as plain text, not a Person, and there are no dates.",
  },
  {
    id: "profile",
    type: "ProfilePage",
    adviceId: "pages.examples.profile",
    good: {
      "@context": CTX,
      "@type": "ProfilePage",
      mainEntity: { "@type": "Person", name: "Sam Rivera", jobTitle: "Head of Product", sameAs: ["https://linkedin.com/in/sam-rivera-tallyroo"] },
    },
    bad: { "@context": CTX, "@type": "ProfilePage", name: "Our team" },
    badWhy: "A page about many people, with no mainEntity: ProfilePage is for one.",
  },
  {
    id: "faq",
    type: "FAQPage",
    adviceId: "pages.schema.faq",
    good: {
      "@context": CTX,
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Can I invoice in two currencies?", acceptedAnswer: { "@type": "Answer", text: "Yes. Each invoice has its own currency." } }],
    },
    bad: null,
    badWhy: null,
  },
  {
    id: "howto",
    type: "HowTo",
    adviceId: "pages.examples.howto",
    good: {
      "@context": CTX,
      "@type": "HowTo",
      name: "Send your first invoice",
      step: [
        { "@type": "HowToStep", text: "Add your customer." },
        { "@type": "HowToStep", text: "Add what you sold and its price." },
        { "@type": "HowToStep", text: "Press Send." },
      ],
    },
    bad: null,
    badWhy: null,
  },
];
