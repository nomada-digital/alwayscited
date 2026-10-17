import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { dashBase } from "./host";

import { dashClients, dashEmail, dashRaw } from "./access";
import { buildWorkspace } from "./model";
import { planShape } from "./plan";
import type { Raw, Workspace } from "./types";

/**
 * What every client page on the dashboards host starts with: the session (or
 * the sign-in page), the client (or a 404 for one outside the member's list),
 * its rows and the Workspace drawn from them. React `cache` holds each read
 * for the request, so the layout and the page share one.
 */
export async function pageData(slug: string, opts: { sample?: boolean } = {}): Promise<{ email: string; raw: Raw; ws: Workspace; base: string; others: { slug: string; domain: string }[] }> {
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
  return {
    email,
    base,
    raw,
    ws: buildWorkspace(raw, { plan: planShape(), sample: opts.sample }),
    others: clients.filter((c) => c.slug !== slug).map((c) => ({ slug: c.slug, domain: c.domain })),
  };
}

/** This request's link prefix (host.ts dashBase). */
export async function requestBase(): Promise<string> {
  return dashBase((await headers()).get("host"));
}
