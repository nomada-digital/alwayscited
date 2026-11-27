/**
 * The task library (27 Nov 2026, Danny): what staff pick from to add "Your tasks" to a customer's dashboard.
 * Plain steps, UK English, no vendor names beyond the tools the customer must use. A step can carry a link (and a same-origin
 * screenshot path); a task is manual (the customer ticks it, we confirm), or auto-checked:
 *   connect_gsc / connect_ga4  complete when the integration connects
 *   page_check                 a live page check matches the "after" text
 * Pure module: no imports of server code, so node --test loads it.
 */
export type Step = { text: string; href?: string; img?: string };
export type TaskKind = "manual" | "connect_gsc" | "connect_ga4" | "connect_bing" | "page_check" | "access";
export type PageCheck = { url: string; target: "h1" | "title"; before: string; after: string };
/** onsite: a change on their own site, which we do ourselves once they have given us access. aiPrompt: what to paste into their AI, only where an LLM can realistically do it. */
export type TaskDraft = { template: string | null; kind: TaskKind; title: string; why: string; steps: Step[]; check: PageCheck | null; onsite: boolean; aiPrompt: string | null };
/** accessEmail is the address customers add in Google (connect.ts ACCESS_EMAIL), passed in so this module stays dependency-free. */
export type Ctx = { slug: string; domain: string; dashboard: string; accessEmail: string };
export type Field = { key: string; label: string; placeholder?: string; long?: boolean; options?: string[] };

const TEXT_MAX = 400;
const clean = (v: unknown, max = TEXT_MAX) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** An https address on the customer's own site (the bare domain or www), or null. Page checks only ever fetch these. */
export function ownPageUrl(raw: string, domain: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (h !== d && h !== `www.${d}`) return null;
  u.hash = "";
  return u.toString();
}

const pathOf = (url: string) => { try { const p = new URL(url).pathname; return p === "/" ? "your homepage" : p.replace(/\/$/, ""); } catch { return url; } };

const NO: Pick<TaskDraft, "onsite" | "aiPrompt" | "check"> = { onsite: false, aiPrompt: null, check: null };

export const TEMPLATES: { id: string; label: string; fields: Field[]; build: (p: Record<string, string>, ctx: Ctx) => TaskDraft | string }[] = [
  {
    id: "direct_access",
    label: "Let us do it for you: give us access",
    fields: [],
    build: (_p, ctx) => ({
      template: "direct_access", kind: "access", ...NO,
      title: "Let us do it for you: give us access",
      why: "The simplest option: give us access to your site and we make the changes for you, with nothing for you to do each time and your approval before anything goes live.",
      steps: [
        { text: `Pick your platform below. We've guessed it from ${ctx.domain}, and you can change it.` },
        { text: "Send the invitation from your own account. You never share a password." },
        { text: "Press I've given you access. We confirm it and take it from there." },
      ],
    }),
  },
  {
    id: "connect_gsc",
    label: "Connect Search Console",
    fields: [],
    build: (_p, ctx) => ({
      template: "connect_gsc", kind: "connect_gsc", ...NO,
      title: "Connect Search Console",
      why: "It shows which page Google puts in front of people for each search, so we can see what is working.",
      steps: [
        { text: "Open Integrations in your dashboard.", href: `${ctx.dashboard}/integrations#connect-gsc` },
        { text: "On the Google Search Console card, press Continue with Google and sign in with the Google account that owns your Search Console property." },
        { text: "Allow read-only access when Google asks. We can't change anything." },
        { text: `Pick the property for ${ctx.domain} and press Use this property.` },
        { text: "No property yet, or stuck? The card walks you through it, or press \"Stuck? We'll do it for you\"." },
      ],
    }),
  },
  {
    id: "connect_ga4",
    label: "Set up and connect Google Analytics 4",
    fields: [],
    build: (_p, ctx) => ({
      template: "connect_ga4", kind: "connect_ga4", check: null, onsite: false,
      aiPrompt:
        "Add Google Analytics 4 to my website. My Measurement ID is G-XXXXXXXXXX (I will replace this with mine).\n\nRules:\n- Add the standard Google tag (gtag.js) once, in the head of every page, using the site's own analytics or tracking setting where there is one.\n- Do not add it twice if it is already there.\n- Change nothing else on the site.\n\nWhen you are done, tell me exactly where you added it and how to publish.",
      title: "Set up and connect Google Analytics 4",
      why: "It shows the visits that follow a citation or a placement, so we can show you what the work is worth.",
      steps: [
        { text: "Already have Google Analytics 4 on your site? Skip to step 4." },
        { text: "Create a GA4 property for your site. Google asks a few questions about your business." },
        { text: "Add the tag: copy the Measurement ID (it starts with G-) into your site builder's analytics or tracking setting, then publish." },
        { text: "In Google Analytics open Admin, then Property access management." },
        { text: `Press the plus, choose Add users, enter ${ctx.accessEmail} and give it the Viewer role.` },
        { text: "Still in Admin, open Property details and copy the property ID (numbers only)." },
        { text: "Open Integrations in your dashboard, paste the ID on the Google Analytics 4 card and press Check connection.", href: `${ctx.dashboard}/integrations#connect-ga4` },
      ],
    }),
  },
  {
    id: "connect_bing",
    label: "Connect Bing Webmaster Tools",
    fields: [],
    build: (_p, ctx) => ({
      template: "connect_bing", kind: "connect_bing", ...NO,
      title: "Connect Bing Webmaster Tools",
      why: "Bing is where Microsoft Copilot looks, so its numbers show how you appear there.",
      steps: [
        { text: "Open Bing Webmaster Tools and sign in.", href: "https://www.bing.com/webmasters" },
        { text: `Not listed yet? Either choose Import and pick Google Search Console (sign in with Google and select ${ctx.domain}), or add the site by hand.` },
        { text: "Open your site, then go to Settings, then User management." },
        { text: `Press Add user, enter ${ctx.accessEmail} and choose Read only.` },
        { text: "Open Integrations in your dashboard and press Check connection on the Bing Webmaster Tools card.", href: `${ctx.dashboard}/integrations#connect-bing` },
      ],
    }),
  },
  {
    id: "chatgpt_listing",
    label: "Claim your ChatGPT business listing",
    fields: [{ key: "business", label: "Business name", placeholder: "As it should appear, e.g. MOR Talent Boutique" }],
    build: (p, ctx) => {
      const name = clean(p.business, 120) || ctx.domain;
      return {
        template: "chatgpt_listing", kind: "manual", ...NO,
        title: "Claim your ChatGPT business listing",
        why: "An unclaimed listing can be claimed by someone else. Claimed, you can see how often ChatGPT mentions you and how many clicks come to your site.",
        steps: [
          { text: "Go to Business Hub in ChatGPT and find " + name + "." },
          { text: `Verify it by a text or call to your main business number, or by adding a DNS record to ${ctx.domain}. We can send the record to whoever manages your DNS.` },
          { text: "Check the details and edit anything that is wrong." },
          { text: "Tick this task as done and we'll confirm it." },
        ],
      };
    },
  },
  {
    id: "page_heading",
    label: "Update a page heading or title",
    fields: [
      { key: "url", label: "Page address", placeholder: "https://www.example.com/page" },
      { key: "target", label: "Which text", options: ["h1", "title"] },
      { key: "before", label: "Before (exact text now)", long: true },
      { key: "after", label: "After (exact new text)", long: true },
    ],
    build: (p, ctx) => {
      const url = ownPageUrl(clean(p.url, 300), ctx.domain);
      if (!url) return `The page address must be an https address on ${ctx.domain}.`;
      const target = p.target === "title" ? "title" : "h1";
      const before = clean(p.before), after = clean(p.after);
      if (!before || !after) return "Give the exact before and after text.";
      if (before === after) return "The before and after text are the same.";
      const what = target === "title" ? "page title" : "main heading (H1)";
      return {
        template: "page_heading", kind: "page_check", check: { url, target, before, after }, onsite: true,
        aiPrompt:
          `You are editing my website. Make one small change and leave everything else exactly as it is.\n\nPage: ${url}\n\nChange the ${what} from:\n"${before}"\n\nto exactly:\n"${after}"\n\nRules:\n- Change only that text. Do not touch other headings, copy, links, styling or layout.\n` +
          (target === "h1" ? "- The page must still have exactly one H1.\n" : "- This is the page's title tag (the SEO title), not a heading on the page.\n") +
          "\nWhen you are done, show me the exact change you made and tell me how to publish it.",
        title: `Change the ${what} on ${pathOf(url)}`,
        why: target === "title" ? "The title is what Google and AI read first, so it should say exactly what the page is about." : "The main heading tells Google and AI what the page is about, so it should say exactly that.",
        steps: [
          { text: "Open the page in your site builder or CMS.", href: url },
          { text: `Find the ${what}. It currently reads: "${before}"` },
          { text: `Change it to exactly: "${after}"` },
          { text: "Publish the change. We check the live page for you, so this ticks itself off once it is live. You can also tick it done yourself." },
        ],
      };
    },
  },
  {
    id: "internal_links",
    label: "Add internal links",
    fields: [{ key: "note", label: "What to link (optional)", placeholder: "e.g. link to the household staff page from the blog posts", long: true }],
    build: (p, ctx) => {
      const note = clean(p.note, 300);
      return {
        template: "internal_links", kind: "manual", check: null, onsite: true,
        aiPrompt:
          `You are editing my website (${ctx.domain}). Add internal links, and change nothing else.\n\n${note ? `What to link: ${note}\n\n` : "Link from the pages where it reads naturally to the page that matters most for my main service.\n\n"}Rules:\n- Add links only inside existing body copy, using natural anchor text that describes the page being linked to.\n- At most 3 links on any one page, and none where it would read awkwardly.\n- Do not change any other wording, headings, styling or layout.\n- Do not add site-wide boxes, footers or menus.\n\nWhen you are done, list every page you changed, the sentence and the link you added, and tell me how to publish.\n\n(Our prompts for your site are at ${ctx.dashboard}/prompts if you want the full list.)`,
        title: "Add internal links",
        why: "Links between your own pages tell Google which page matters most for each search.",
        steps: [
          { text: "Open Prompts for your site in your dashboard and find the internal links prompt.", href: `${ctx.dashboard}/prompts` },
          { text: "Copy it into your AI assistant (or follow it by hand in your site builder)." + (note ? ` ${note}` : "") },
          { text: "Check the changes it proposes, then publish." },
          { text: "Tick this task as done and we'll confirm the links are in place." },
        ],
      };
    },
  },
];

/** A custom task as staff typed it: steps one per line, an optional " | https://link" after the text. A string is the reason it was refused. */
export function buildCustom(p: { title?: unknown; why?: unknown; steps?: unknown }): TaskDraft | string {
  const title = clean(p.title, 200);
  if (title.length < 3) return "Give the task a title (3 to 200 characters).";
  const why = clean(p.why, 400);
  const lines = (typeof p.steps === "string" ? p.steps.split(/\r?\n/) : Array.isArray(p.steps) ? p.steps.map(String) : []).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "Add at least one step.";
  if (lines.length > 20) return "At most 20 steps.";
  const steps: Step[] = [];
  for (const l of lines) {
    const [text, link] = l.split(/\s+\|\s+/, 2);
    const t = clean(text, 500);
    if (!t) return "A step is empty.";
    const s: Step = { text: t };
    if (link) {
      let ok = false;
      try { ok = new URL(link.trim()).protocol === "https:"; } catch { /* not a link */ }
      if (!ok) return `The link after "${t.slice(0, 40)}" must start with https://.`;
      s.href = link.trim();
    }
    steps.push(s);
  }
  return { template: null, kind: "manual", title, why, steps, check: null, onsite: false, aiPrompt: null };
}

export function buildFromTemplate(id: string, params: Record<string, string>, ctx: Ctx): TaskDraft | string {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? t.build(params, ctx) : "That template does not exist.";
}

/** Stored steps, read defensively: only text, an https href and a same-origin /path image survive. */
export function readSteps(v: unknown): Step[] {
  return (Array.isArray(v) ? v : []).flatMap((s) => {
    const o = s as { text?: unknown; href?: unknown; img?: unknown } | null;
    if (!o || typeof o.text !== "string" || !o.text) return [];
    const step: Step = { text: o.text };
    if (typeof o.href === "string" && /^https:\/\//.test(o.href)) step.href = o.href;
    else if (typeof o.href === "string" && /^\/[A-Za-z0-9/_-]*$/.test(o.href)) step.href = o.href;
    if (typeof o.img === "string" && /^\/[A-Za-z0-9/_.-]+$/.test(o.img) && !o.img.startsWith("//")) step.img = o.img;
    return [step];
  });
}
