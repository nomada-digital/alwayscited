import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { DEMO_HEADER, VIEW_HEADER, dashBase, demoLink, demoSlug } from "./host";
import { demoAs } from "./demo-state";

import { dashClients, dashEmail, dashRaw, demoRaw, viewAs } from "./access";
import { TRACKED_PRICE } from "@/config/pricing";
import { type PlanBanner, planBanner } from "@/lib/tracking/plan-banner";
import { loadUpgradeContext } from "@/lib/tracking/upgrade-context";

import { buildWorkspace } from "./model";
import { planShape } from "./plan";
import type { Raw, Workspace } from "./types";

/**
 * What every client page on the dashboards host starts with: the session (or
 * the sign-in page), the client (or a 404 for one outside the member's list),
 * its rows and the Workspace drawn from them. React `cache` holds each read
 * for the request, so the layout and the page share one.
 */
export type PageData = {
  email: string;
  raw: Raw;
  ws: Workspace;
  base: string;
  demo: boolean;
  /** The agency hub's "What the customer sees" (18 Oct 2026): who opened it and until when. Read-only, as `demo` is. */
  viewAs: { by: string; expiresAt: string } | null;
  banner: PlanBanner | null;
  others: { slug: string; domain: string }[];
  /** What the plan nudges weigh beyond the Workspace: markets on the member's sites, and days since the client started. */
  nudge: { markets: number; daysOnPlan: number | null };
};

const daysSince = (day: string | null, today: string) => (day ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000) : null);

export async function pageData(slug: string, opts: { sample?: boolean } = {}): Promise<PageData> {
  // A demo link: the proxy verified the token and set the header; it is checked again here against the slug it opens.
  const token = await demoToken();
  if (token) {
    if (demoSlug(token) !== slug) notFound();
    const found = await demoRaw(slug);
    if (!found) notFound();
    // A per-plan demo link shows the client as that plan, with sample delivery rows labelled as such (demo-state.ts).
    const raw = demoAs(found, demoLink(token)?.state ?? null);
    return { email: "demo", raw, demo: true, viewAs: null, base: `/demo/${token}`, banner: null, others: [], nudge: { markets: 1, daysOnPlan: daysSince(raw.client.started_on, raw.today) }, ws: buildWorkspace(raw, { plan: planShape(), sample: opts.sample }) };
  }
  // The hub's view-as link: the owner's own dashboard, exactly as they see it, with every write path off (demo: true)
  // and a banner on every page. The token is checked against the database on every request (access.ts viewAs).
  const view = await viewToken();
  if (view) {
    const v = await viewAs(view, slug);
    if (!v) notFound();
    const raw = await dashRaw(v.ownerEmail, slug);
    if (!raw) notFound();
    const clients = await dashClients(v.ownerEmail);
    const c = clients.find((x) => x.slug === slug) as (Parameters<typeof planBanner>[0]["client"] & { slug: string }) | undefined;
    const upsell = await loadUpgradeContext(raw.client.id, v.ownerEmail, raw.today).then((u) => u.mode === "nomada").catch(() => true);
    const base = `/view/${view}`;
    const banner = c ? planBanner({ client: { ...c, name: raw.client.brand ?? raw.client.domain, market: raw.client.market }, role: raw.role, upsell, billing: `${base}/${slug}/plan#billing`, price: TRACKED_PRICE }) : null;
    return {
      nudge: { markets: new Set(clients.map((x) => String((x as { market?: string }).market ?? ""))).size, daysOnPlan: daysSince(raw.client.started_on, raw.today) },
      banner,
      email: v.ownerEmail,
      base,
      demo: true,
      viewAs: { by: v.by, expiresAt: v.expiresAt },
      raw,
      ws: buildWorkspace(raw, { plan: planShape(), sample: opts.sample }),
      // One client per token: the site switcher would lead to pages this token does not open.
      others: [],
    };
  }
  const base = await requestBase();
  const email = await dashEmail();
  // Off the dashboards host there is no sign-in page of this tree's own to send anyone to: a stranger gets a 404.
  if (!email) {
    if (base) notFound();
    redirect("/login");
  }
  const raw = await dashRaw(email, slug);
  if (!raw) notFound();
  const clients = await dashClients(email);
  // The trial, a failed payment or an ended plan, said the way /app says it (plan-banner.ts), with Billing on Plan.
  const c = clients.find((x) => x.slug === slug) as (Parameters<typeof planBanner>[0]["client"] & { slug: string }) | undefined;
  const upsell = await loadUpgradeContext(raw.client.id, email, raw.today).then((u) => u.mode === "nomada").catch(() => true);
  const banner = c ? planBanner({ client: { ...c, name: raw.client.brand ?? raw.client.domain, market: raw.client.market }, role: raw.role, upsell, billing: `${base}/${slug}/plan#billing`, price: TRACKED_PRICE }) : null;
  return {
    nudge: { markets: new Set(clients.map((x) => String((x as { market?: string }).market ?? ""))).size, daysOnPlan: daysSince(raw.client.started_on, raw.today) },
    banner,
    email,
    base,
    demo: false,
    viewAs: null,
    raw,
    ws: buildWorkspace(raw, { plan: planShape(), sample: opts.sample }),
    others: clients.filter((c) => c.slug !== slug).map((c) => ({ slug: c.slug, domain: c.domain })),
  };
}

/** This request's link prefix (host.ts dashBase). */
export async function requestBase(): Promise<string> {
  return dashBase((await headers()).get("host"));
}

/** The demo token on this request, when the proxy verified one (host.ts demoSlug); null otherwise. */
export async function demoToken(): Promise<string | null> {
  const t = (await headers()).get(DEMO_HEADER);
  return t && demoSlug(t) ? t : null;
}

/** The view-as token on this request, as the proxy passed it (host.ts VIEW_HEADER); null otherwise. Checked by access.ts viewAs. */
export async function viewToken(): Promise<string | null> {
  const t = (await headers()).get(VIEW_HEADER);
  return t && /^[0-9a-f]{64}$/.test(t) ? t : null;
}
