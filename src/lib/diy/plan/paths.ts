import { appPath } from "../../app-host.ts";

/**
 * Where the Actions page and its forms go (13 Oct 2026, DIY P3). One place,
 * so the route-callers census can earn the plan route from the one line that
 * builds its action, and every link is built through appPath (the dashboard
 * host has no /app prefix, M1).
 */

/** The page's own state a form carries to the route and back: the view, the filters, and where to land. */
export type PlanKeep = Partial<Record<"view" | "status" | "kind" | "cluster", string>>;

const query = (q: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  return s ? `?${s}` : "";
};

/** The Actions page, with its view and filters. */
export function planPath(slug: string, keep: PlanKeep = {}, hash = ""): string {
  return appPath(`/${encodeURIComponent(slug)}/plan${query(keep)}${hash}`);
}

/**
 * One item's card on the Actions page (review, 13 Oct 2026). The list draws only
 * the DONE_RECENT newest Done items and folds Dropped away, so a link to an item
 * that is done or dropped carries its status - the list then draws every Done
 * item, or opens Dropped - and its `#item-` anchor always lands. Your pages'
 * History and This week's "Open in Actions" link through here.
 */
export function itemPath(slug: string, item: { id: string; status: string }, keep: PlanKeep = {}): string {
  const closed = item.status === "done" || item.status === "dropped";
  return planPath(slug, { ...keep, ...(closed ? { status: item.status } : {}) }, `#item-${encodeURIComponent(item.id)}`);
}

/**
 * Where every Actions form posts: the plan route, with the item it is about
 * (`id`) and the page state it returns to. `back` is "overview" from the
 * Overview's This week; `at` lands back on This week. The button pressed
 * carries `do`, so no form needs a hidden field.
 */
export function planAction(slug: string, keep: PlanKeep & { id?: string; back?: "plan" | "overview"; at?: "week" }): string {
  return `/api/app/${encodeURIComponent(slug)}/plan${query(keep)}`;
}

/** A stored client path (types.ts clientPath) as a link on this host. */
export function clientHref(slug: string, path: string): string {
  return appPath(`/${encodeURIComponent(slug)}${path}`);
}
