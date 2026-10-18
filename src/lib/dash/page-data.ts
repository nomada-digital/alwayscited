import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { DEMO_HEADER, dashBase, demoLink, demoSlug } from "./host";
import { demoAs } from "./demo-state";

import { dashClients, dashEmail, dashRaw, demoRaw } from "./access";
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
    return { email: "demo", raw, demo: true, base: `/demo/${token}`, banner: null, others: [], nudge: { markets: 1, daysOnPlan: daysSince(raw.client.started_on, raw.today) }, ws: buildWorkspace(raw, { plan: planShape(), sample: opts.sample }) };
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
