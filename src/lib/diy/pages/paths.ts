import { appPath } from "../../app-host.ts";
import { ISSUES, type Issue } from "./view.ts";

/**
 * Your pages' addresses and query keys (13 Oct 2026, DIY P8; spec 10 section
 * 3.5), each key to its own whitelist. The page checks `cluster` against the
 * client's own clusters and `url` against its own domain; here only the
 * shape is held.
 *
 * - `/pages`: `view` (pages, bots, examples), `issue` (schema, fit, access,
 *   status), `cluster`, `url` (a page address on the client's domain, to
 *   focus or offer "add as key page"), `done`, `why`.
 * - `/pages/[page]`: `tab` (schema, fit, basics, history), `cluster`, `done`,
 *   `why`.
 */

export const VIEWS = ["pages", "bots", "examples"] as const;
/** The Add a page form's anchor, which the "+ Add" menu links to (spec 10 section 3.1: /pages#add). */
export const ADD_ANCHOR = "add";
export type PagesView = (typeof VIEWS)[number];
export const TABS = ["schema", "fit", "basics", "history"] as const;
export type PageTab = (typeof TABS)[number];

export const TAB_LABEL: Record<PageTab, string> = { schema: "Schema", fit: "Fit and examples", basics: "Basics", history: "History" };
export const VIEW_LABEL: Record<PagesView, string> = { pages: "Pages", bots: "Crawlers", examples: "Schema examples" };

const ID = /^[0-9A-Za-z_-]{1,64}$/;

export const pickView = (v: string | null): PagesView => (VIEWS as readonly string[]).includes(v ?? "") ? (v as PagesView) : "pages";
export const pickTab = (v: string | null): PageTab => (TABS as readonly string[]).includes(v ?? "") ? (v as PageTab) : "schema";
export const pickIssue = (v: string | null): Issue | null => ((ISSUES as readonly string[]).includes(v ?? "") ? (v as Issue) : null);
/** A cluster id of this client's, else null. */
export const pickCluster = (v: string | null, ids: readonly string[]): string | null => (v && ID.test(v) && ids.includes(v) ? v : null);
/** A key page id's shape (the page holds it to this client's live pages). */
export const isPageId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
export const isClusterId = isPageId;

export type ListKeep = { view?: PagesView; issue?: Issue; cluster?: string };
export type PageKeep = { tab?: PageTab; cluster?: string };

const q = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")).toString();
  return s ? `?${s}` : "";
};

/** The list, with its view and filters (the default view and no filter written as nothing). */
export function pagesPath(slug: string, keep: ListKeep & { done?: string; why?: string; url?: string } = {}, hash = ""): string {
  return appPath(`/${encodeURIComponent(slug)}/pages${q({ view: keep.view === "pages" ? undefined : keep.view, issue: keep.issue, cluster: keep.cluster, url: keep.url, done: keep.done, why: keep.why })}${hash}`);
}

/** One page's detail, with its tab and cluster (Schema, the default, written as nothing). */
export function pagePath(slug: string, id: string, keep: PageKeep & { done?: string; why?: string } = {}, hash = ""): string {
  return appPath(`/${encodeURIComponent(slug)}/pages/${encodeURIComponent(id)}${q({ tab: keep.tab === "schema" ? undefined : keep.tab, cluster: keep.cluster, done: keep.done, why: keep.why })}${hash}`);
}

/** The route's action, with where to come back to in its query. */
export function pagesAction(slug: string, back: { page: string; tab?: PageTab; cluster?: string } | ListKeep = {}, target: Target = {}): string {
  const base = `/api/app/${encodeURIComponent(slug)}/pages`;
  const t = { id: target.id, of: target.of, item: target.item };
  if ("page" in back) return `${base}${q({ back: "page", page: back.page, tab: back.tab, cluster: back.cluster, ...t })}`;
  return `${base}${q({ view: back.view, issue: back.issue, cluster: back.cluster, ...t })}`;
}

/**
 * What a form acts on, carried in its action's query as the Actions forms
 * carry theirs, so no form needs a hidden field: `id` the key page, `of` the
 * cluster an example is for, `item` what Add to Actions adds. The button
 * pressed carries `do`.
 */
export type Target = { id?: string; of?: string; item?: string };

const ITEM = /^(schema:[A-Za-z]{2,40}|rework:[0-9A-Za-z_-]{1,64})$/;

/** The route's reading of a form's target: each to its own shape, else absent. */
export function readTarget(sp: URLSearchParams): { id: string | null; of: string | null; item: string | null } {
  const id = sp.get("id");
  const of = sp.get("of");
  const item = sp.get("item");
  return { id: isPageId(id) ? id : null, of: isClusterId(of) ? of : null, item: item && ITEM.test(item) ? item : null };
}

/** The route's reading of where to go back to: each key to its whitelist, the cluster's shape only (the page re-checks it). */
export function readBack(sp: URLSearchParams): { page: string; tab: PageTab; cluster?: string } | ListKeep {
  const cluster = sp.get("cluster");
  const c = cluster && ID.test(cluster) ? cluster : undefined;
  const page = sp.get("page");
  if (sp.get("back") === "page" && isPageId(page)) return { page: page!, tab: pickTab(sp.get("tab")), ...(c ? { cluster: c } : {}) };
  const view = pickView(sp.get("view"));
  const issue = pickIssue(sp.get("issue"));
  return { ...(view !== "pages" ? { view } : {}), ...(issue ? { issue } : {}), ...(c ? { cluster: c } : {}) };
}

/** The route's action from one page's detail, coming back to its tab and cluster. */
export function pageAction(slug: string, pageId: string, tab: PageTab, cluster: string | null = null, target: Omit<Target, "id"> = {}): string {
  return pagesAction(slug, { page: pageId, tab, ...(cluster ? { cluster } : {}) }, { id: pageId, ...target });
}
