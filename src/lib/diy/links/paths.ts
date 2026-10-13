import { appPath } from "../../app-host.ts";

import type { LinkView } from "./types.ts";

/**
 * Where Links' links and forms go (13 Oct 2026, DIY P10; spec 10 sections 3.5
 * and 3.6). The page's state is `view` alone; the route's answer adds `done`
 * and `why`. Plain module, so nav and the censuses can read it.
 */

export type LinksKeep = { view?: LinkView };

const query = (q: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  return s ? `?${s}` : "";
};

/** The page, on one view, with a toast's codes and an anchor. */
export function linksPath(slug: string, q: { view?: LinkView; done?: string; why?: string } = {}, hash = ""): string {
  return appPath(`/${encodeURIComponent(slug)}/links${query({ view: q.view && q.view !== "profile" ? q.view : undefined, done: q.done, why: q.why })}${hash}`);
}

/** Every Links form's action: the route, carrying the view to come back to. */
export function linksAction(slug: string, keep: LinksKeep): string {
  return `/api/app/${encodeURIComponent(slug)}/links${query({ view: keep.view })}`;
}
