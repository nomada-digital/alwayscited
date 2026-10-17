import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { notFound } from "next/navigation";

import { dashClients, dashEmail } from "@/lib/dash/access";
import { requestBase } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The host's root: the member's first site, or the sign-in page. */
export default async function DashHome() {
  const base = await requestBase();
  const email = await dashEmail();
  if (!email) {
    // Off the dashboards host (the /dashboards preview) a stranger gets a 404, as on every page here.
    if (base) notFound();
    redirect("/login");
  }
  const clients = await dashClients(email);
  if (!clients.length) redirect(`${base}/login?none=1`);
  redirect(`${base}/${clients[0]!.slug}`);
}
