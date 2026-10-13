import type { Metadata } from "next";
import { loginHref } from "@/lib/tracking/next-path";
import { notFound, redirect } from "next/navigation";

import { trackingRepo } from "@/lib/tracking/repo";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Not found - alwaystracked dashboard",
  robots: { index: false, follow: false },
};
export const runtime = "nodejs";

/**
 * Any /app/[client] address no page matches (R173 pass 3, DS36, 2 Oct 2026).
 * Without it Next's router skipped the segment and drew the site 404 - free
 * scan, packages, the site chrome - for a signed-in client. Same session and
 * membership rule as every page here; then notFound() draws the dashboard's
 * own, ../not-found.tsx.
 */
export default async function UnknownDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ client: string; rest: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/${(await params).rest.map(encodeURIComponent).join("/")}`), await searchParams));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  // A member too: no page here has this address.
  notFound();
}
