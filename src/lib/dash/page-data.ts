import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { DEMO_HEADER, dashBase, demoSlug } from "./host";

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
export type PageData = { email: string; raw: Raw; ws: Workspace; base: string; demo: boolean; banner: PlanBanner | null; others: { slug: string; domain: string }[] };

export async function pageData(slug: string, opts: { sample?: boolean } = {}): Promise<PageData> {
  // A demo link: the proxy verified the token and set the header; it is checked again here against the slug it opens.
  const token = await demoToken();
  if (token) {
    if (demoSlug(token) !== slug) notFound();
    const raw = await demoRaw(slug);
    if (!raw) notFound();
    return { email: "demo", raw, demo: true, base: `/demo/${token}`, banner: null, others: [], ws: buildWorkspace(raw, { plan: planShape(), sample: opts.sample }) };
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
