import type { CustomerDeliverable } from "./core.ts";

/**
 * The generated sample client's deliverables (25 Nov 2026): Blue Mahoe Retreats, bluemahoeretreats.com, the fictional
 * brand sample-world.ts draws. Made up here, never stored, so the demo link and the screenshots show every state -
 * one for the customer to do, one they have done, one we made with its evidence, one we are working on - without a
 * real customer's findings in a public repository. Pure, so node --test loads it.
 */

const PROMPTS = `# Add FAQ schema to the retreat pages

Paste each prompt into your site's AI assistant (or your developer's), one at a time, and check the result on a
staging copy before you publish.

## 1. The FAQ block

\`\`\`
Add an FAQ section to the bottom of /retreats/yoga-week with these four questions and answers, as visible text on
the page. Use the exact wording below. Do not shorten the answers.

Q: How many people join a retreat week?
A: Between 6 and 12 guests, so there is always time with the teacher.
Q: Is it suitable for beginners?
A: Yes. Every session has a gentler option, and no experience is needed.
\`\`\`

## 2. The structured data

\`\`\`
Add FAQPage JSON-LD to /retreats/yoga-week that matches the FAQ block on the page exactly. Put it in a
<script type="application/ld+json"> tag in the head. Validate it with Google's Rich Results Test.
\`\`\`
`;

const SCHEMA_MD = `# Organization schema

Already added by us when we built the page. Evidence is in the sheet.
`;

export function sampleDeliverables(): CustomerDeliverable[] {
  return [
    {
      id: "sample-faq",
      title: "Add FAQ answers and schema to the yoga week page",
      findingsMd: `The AI engines answer "how many people join a yoga retreat" for your competitors but not for you, because your page has **no visible answers** to that question.

- Several engines quote a competitor's FAQ for it.
- Your page has the facts but not in question-and-answer form.
- Adding the block below, with matching schema, gives them something to quote.

Takes about 20 minutes with the prompts in the file.`,
      evidenceUrl: "https://docs.google.com/spreadsheets/d/sample-evidence-1",
      deliveredBy: "client",
      status: "delivered",
      version: 2,
      visible: true,
      createdAt: "2026-11-17T09:00:00Z",
      publishedAt: "2026-11-18T10:30:00Z",
      deliveredAt: "2026-11-18T10:45:00Z",
      completedAt: null,
      completedBy: null,
      completedByKind: null,
      completionNote: null,
      completionUrl: null,
      files: [{ filename: "yoga-week-faq-prompts.md", contentType: "text/markdown", body: PROMPTS }],
      trail: [
        { at: "2026-11-18T10:30:00Z", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "published", toStatus: null, version: null, note: null, url: null },
        { at: "2026-11-18T10:45:00Z", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "status", toStatus: "delivered", version: null, note: null, url: null },
        { at: "2026-11-20T14:05:00Z", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "edited", toStatus: null, version: 2, note: "Added the beginners answer", url: null },
      ],
    },
    {
      id: "sample-title",
      title: "Put the retreat's location in the page title",
      findingsMd: "Your page title said **Retreats** and nothing else. The engines could not tell it was Jamaica. Done: the title now names the place.",
      evidenceUrl: null,
      deliveredBy: "client",
      status: "completed",
      version: 1,
      visible: true,
      createdAt: "2026-11-10T09:00:00Z",
      publishedAt: "2026-11-10T11:00:00Z",
      deliveredAt: "2026-11-10T11:05:00Z",
      completedAt: "2026-11-12T16:20:00Z",
      completedBy: "amara@bluemahoeretreats.com",
      completedByKind: "customer",
      completionNote: "Changed in the SEO plugin.",
      completionUrl: "https://bluemahoeretreats.com/retreats",
      files: [{ filename: "page-title-prompt.md", contentType: "text/markdown", body: "# Page title\n\n```\nChange the title of /retreats to: Yoga retreats in Jamaica | Blue Mahoe Retreats\n```\n" }],
      trail: [
        { at: "2026-11-10T11:00:00Z", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "published", toStatus: null, version: null, note: null, url: null },
        { at: "2026-11-10T11:05:00Z", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "status", toStatus: "delivered", version: null, note: null, url: null },
        { at: "2026-11-12T16:20:00Z", actor: "amara@bluemahoeretreats.com", actorKind: "customer", event: "status", toStatus: "completed", version: null, note: "Changed in the SEO plugin.", url: "https://bluemahoeretreats.com/retreats" },
      ],
    },
    {
      id: "sample-org",
      title: "Organization schema on the homepage",
      findingsMd: "We added your Organization schema, with your name, logo and profiles, so the engines tie the brand to the site. Checked live; the evidence is in the sheet.",
      evidenceUrl: null,
      deliveredBy: "nomada",
      status: "completed",
      version: 1,
      visible: true,
      createdAt: "2026-11-05T09:00:00Z",
      publishedAt: "2026-11-05T09:30:00Z",
      deliveredAt: "2026-11-06T09:00:00Z",
      completedAt: "2026-11-07T12:00:00Z",
      completedBy: "naz@nomadadigital.co.uk",
      completedByKind: "nomada",
      completionNote: null,
      completionUrl: "https://docs.google.com/spreadsheets/d/sample-evidence-2",
      files: [{ filename: "organization-schema.md", contentType: "text/markdown", body: SCHEMA_MD }],
      trail: [
        { at: "2026-11-05T09:30:00Z", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "published", toStatus: null, version: null, note: null, url: null },
        { at: "2026-11-07T12:00:00Z", actor: "naz@nomadadigital.co.uk", actorKind: "nomada", event: "status", toStatus: "completed", version: null, note: null, url: "https://docs.google.com/spreadsheets/d/sample-evidence-2" },
      ],
    },
    {
      id: "sample-listing",
      title: "Add the retreat to three travel directories",
      findingsMd: "These directories are cited in the answers for your keywords and you are not on them. We are preparing the listings now.",
      evidenceUrl: null,
      deliveredBy: "nomada",
      status: "proposed",
      version: 1,
      visible: true,
      createdAt: "2026-11-21T09:00:00Z",
      publishedAt: "2026-11-22T09:30:00Z",
      deliveredAt: null,
      completedAt: null,
      completedBy: null,
      completedByKind: null,
      completionNote: null,
      completionUrl: null,
      files: [{ filename: "directory-listings.md", contentType: "text/markdown", body: "# Directory listings\n\n1. Retreat Guru\n2. BookYogaRetreats\n3. Jamaica Tourist Board\n" }],
      trail: [{ at: "2026-11-22T09:30:00Z", actor: "kev@nomadadigital.co.uk", actorKind: "nomada", event: "published", toStatus: null, version: null, note: null, url: null }],
    },
  ];
}
