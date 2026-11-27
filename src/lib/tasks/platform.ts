/**
 * "Let us do it for you" (27 Nov 2026, Danny): which platform a customer's site is on, and the simplest way to give us access to it.
 * Detection reads the page's HTML and response headers for each builder's own fingerprints; it is a best guess the customer can
 * correct. Pure module: no imports, so node --test loads it. Access is only ever an invitation the customer sends from their own
 * account: no password or key is asked for or stored.
 */
export type Platform = "shopify" | "wordpress" | "webflow" | "squarespace" | "wix" | "framer" | "custom";
export const PLATFORMS: Platform[] = ["shopify", "wordpress", "webflow", "squarespace", "wix", "framer", "custom"];
export const DATA_EMAIL = "data@nomadadigital.co.uk";

export const PLATFORM_NAME: Record<Platform, string> = {
  shopify: "Shopify", wordpress: "WordPress", webflow: "Webflow", squarespace: "Squarespace", wix: "Wix", framer: "Framer", custom: "A custom site (Vercel, GitHub or similar)",
};

export const isPlatform = (v: unknown): v is Platform => typeof v === "string" && (PLATFORMS as string[]).includes(v);

/** The platform a page's HTML and headers point at; "custom" when nothing matches. */
export function detectPlatform(html: string, headers: Record<string, string> = {}): Platform {
  const h = html.slice(0, 400_000).toLowerCase();
  const hdr = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h.includes("cdn.shopify.com") || h.includes("myshopify.com") || h.includes("shopify.theme") || "x-shopid" in hdr || "x-shopify-stage" in hdr) return "shopify";
  if (h.includes("/wp-content/") || h.includes("/wp-includes/") || /<meta[^>]+generator[^>]+wordpress/.test(h) || "x-pingback" in hdr) return "wordpress";
  if (h.includes("data-wf-site") || h.includes("webflow.com") || h.includes("website-files.com") || /<meta[^>]+generator[^>]+webflow/.test(h)) return "webflow";
  if (h.includes("static1.squarespace.com") || h.includes("squarespace-cdn.com") || /<meta[^>]+generator[^>]+squarespace/.test(h) || h.includes("this is squarespace")) return "squarespace";
  if (h.includes("wixstatic.com") || h.includes("parastorage.com") || Object.keys(hdr).some((k) => k.startsWith("x-wix-")) || /<meta[^>]+generator[^>]+wix\.com/.test(h)) return "wix";
  if (h.includes("framerusercontent.com") || /<meta[^>]+generator[^>]+framer/.test(h) || h.includes("data-framer-")) return "framer";
  return "custom";
}

export type AccessGuide = { label: string; steps: string[]; note?: string };

/** The simplest invitation for each platform, written as the customer would do it. Search Console and Analytics are the same everywhere. */
export const ACCESS: Record<Platform, AccessGuide> = {
  shopify: {
    label: "Shopify: a collaborator or staff request",
    steps: [
      "Reply to our email, or press the button below, and tell us your store address (it ends in .myshopify.com). We'll send a collaborator request.",
      "In your Shopify admin open Settings, then Users, and accept the collaborator request from alwayscited.",
      `Prefer to do it yourself? Add ${DATA_EMAIL} as a staff member with permission to edit content and the online store.`,
    ],
    note: "A collaborator can't see your payment details or customer data unless you choose to share them.",
  },
  wordpress: {
    label: "WordPress: an editor user",
    steps: [
      "In your WordPress admin open Users, then Add New.",
      `Enter ${DATA_EMAIL}, choose the role Editor and send the invitation.`,
      "Press the button below once it is sent.",
    ],
    note: "An Editor can change pages and posts but can't install plugins or change settings.",
  },
  webflow: {
    label: "Webflow: an editor on your site",
    steps: [
      "Open your Webflow workspace settings, then Members, and invite a new member.",
      `Enter ${DATA_EMAIL} and give them editor access to your site (or add them under the site's own access).`,
      "Press the button below once it is sent.",
    ],
  },
  squarespace: {
    label: "Squarespace: a contributor",
    steps: [
      "Open Settings, then Permissions, and choose Invite Contributor.",
      `Enter ${DATA_EMAIL} and give them a role that can edit pages (Contributor, or the closest content editing role).`,
      "Press the button below once it is sent.",
    ],
  },
  wix: {
    label: "Wix: a collaborator",
    steps: [
      "Open Settings, then Roles and permissions, and invite someone.",
      `Enter ${DATA_EMAIL} and give them a role that can edit your site's pages.`,
      "Press the button below once it is sent.",
    ],
  },
  framer: {
    label: "Framer: an editor on your project",
    steps: [
      "Open your Framer project and press Share.",
      `Invite ${DATA_EMAIL} as an editor.`,
      "Press the button below once it is sent.",
    ],
  },
  custom: {
    label: "A custom site: a repo or CMS invite",
    steps: [
      "Tell us where your site lives: the GitHub repository, or the CMS you edit it in (and your host, if it is Vercel or similar).",
      `Invite ${DATA_EMAIL} to the repository with write access, or to your CMS as an editor. Reply to our email if you'd rather send the invite to someone else.`,
      "Press the button below once it is sent.",
    ],
    note: "For a repository we work on a branch and send you a pull request, so nothing goes live without your say.",
  },
};

/** Search Console and Google Analytics: one way for everyone. */
export const GOOGLE_ACCESS = {
  gsc: [`Open Search Console, pick your property, and go to Settings, then Users and permissions.`, `Press Add user, enter ${DATA_EMAIL} and choose Full.`],
  ga4: [`Open Google Analytics and go to Admin, then Property access management.`, `Press the plus, choose Add users, enter ${DATA_EMAIL} and give them the Viewer role.`],
} as const;
