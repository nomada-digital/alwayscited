import { appPath } from "../../app-host.ts";

/**
 * Where Opportunities' pages and forms go (13 Oct 2026, DIY P7). One place,
 * so the route-callers census can earn each route from the one line that
 * builds its action, and every link is built through appPath (the dashboard
 * host has no /app prefix, M1).
 */

/** The list page's own state a form carries to the route and back (section 3.5's keys). */
export type OppKeep = Partial<Record<"view" | "lens" | "cluster" | "engine" | "status" | "q" | "page", string>>;

const query = (q: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  return s ? `?${s}` : "";
};

/** The list page, with its state. */
export function oppPath(slug: string, keep: OppKeep = {}, hash = ""): string {
  return appPath(`/${encodeURIComponent(slug)}/opportunities${query(keep)}${hash}`);
}

/** One opportunity's page. */
export function oppDetailPath(slug: string, id: string, q: Record<string, string> = {}, hash = ""): string {
  return appPath(`/${encodeURIComponent(slug)}/opportunities/${encodeURIComponent(id)}${query(q)}${hash}`);
}

/**
 * Where every Opportunities form posts: the opportunity route, with the row
 * it is about (`id`), the list state it returns to, and `at=detail` from an
 * opportunity's own page. The button pressed carries `do`.
 */
export function oppAction(slug: string, q: OppKeep & { id?: string; at?: "detail" }): string {
  return `/api/app/${encodeURIComponent(slug)}/opportunity${query(q)}`;
}

/** Where the prompt step's forms post: the prompt-offer route, with the opportunity. The button pressed carries `do`. */
export function promptOfferAction(slug: string, id: string): string {
  return `/api/app/${encodeURIComponent(slug)}/prompt-offer${query({ id })}`;
}

/** "Suggest this to your account lead": the existing ask route, with the page's id and nothing else. */
export function oppAskAction(slug: string, id: string): string {
  return `/api/app/${encodeURIComponent(slug)}/ask${query({ kind: "opportunity", id })}`;
}
