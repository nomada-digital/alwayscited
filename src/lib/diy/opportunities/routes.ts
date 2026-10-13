import type { DomainType, Lens, PageType, Route } from "./types.ts";

/**
 * The route a page takes and the lens it is listed under (13 Oct 2026, DIY
 * P7; spec 10 section 6.2, "Route by page type and domain type"). Pure.
 *
 * | Page type / domain type                                     | Route            | Lens     |
 * |-------------------------------------------------------------|------------------|----------|
 * | reference, institutional, video                             | leave_it         | not listed |
 * | thread, or a community site                                 | answer_thread    | threads  |
 * | review_profile, or a review platform or directory           | get_listed       | profiles |
 * | comparison or alternatives that names you, while every answer citing it leaves you out | send_correction | cited |
 * | best_of, comparison, alternatives                           | ask_added        | cited    |
 * | how_to, article, and any other or unknown type              | offer_resource   | cited    |
 *
 * Video is not in the spec's table: a video is not a page anyone adds you to,
 * and no playbook says how to approach one, so it is left out of the lists
 * like an encyclopaedia (the shorter list is the safe direction).
 */

export type RouteInput = {
  pageType: PageType | null;
  domainType: DomainType | null;
  /** The page read's verdict: true names the client, false does not, null not known. */
  namesClient: boolean | null;
  /** Every answer citing it in the window left the client out. */
  leavesAll: boolean;
};

export function routeFor(r: RouteInput): Route {
  if (r.domainType === "reference" || r.domainType === "institutional" || r.domainType === "video") return "leave_it";
  if (r.pageType === "thread" || r.domainType === "community") return "answer_thread";
  if (r.pageType === "review_profile" || r.domainType === "review_platform" || r.domainType === "directory") return "get_listed";
  const list = r.pageType === "best_of" || r.pageType === "comparison" || r.pageType === "alternatives";
  if (r.namesClient === true && (r.pageType === "comparison" || r.pageType === "alternatives") && r.leavesAll) return "send_correction";
  if (list) return "ask_added";
  return "offer_resource";
}

/** The AI-cited lens a routed page is listed under, or null for one that is not listed. */
export function lensFor(route: Route): Lens | null {
  if (route === "leave_it") return null;
  if (route === "answer_thread") return "threads";
  if (route === "get_listed") return "profiles";
  return "cited";
}

/** What a Plan item for a pursued page is (types.ts PlanKind), by its route (section 4.7, Pursue). */
export function planKindFor(route: Route): "get_onto_page" | "claim_profile" | "answer_thread" | "publish_own" | "refresh_own" | "send_correction" | "earn_link" | "ask_for_link" {
  switch (route) {
    case "get_listed":
      return "claim_profile";
    case "answer_thread":
      return "answer_thread";
    case "publish_own":
      return "publish_own";
    case "refresh_own":
      return "refresh_own";
    case "send_correction":
      return "send_correction";
    case "earn_link":
      return "earn_link";
    case "ask_for_link":
      return "ask_for_link";
    default:
      return "get_onto_page";
  }
}

/**
 * The routes whose detail page carries a pitch outline (section 4.7), and
 * Earn a link (13 Oct 2026, DIY P10's review, outside P10's 7.11 edit list:
 * section 2.4 gives every route a pitch outline with blanks, and a gap domain
 * pursued from Links had none).
 */
export const PITCH_ROUTES: readonly Route[] = ["ask_added", "send_correction", "offer_resource", "ask_for_link", "earn_link"];

/** The routes U3 may show on (section 2.7). */
export const U3_ROUTES: readonly Route[] = ["ask_added", "send_correction", "offer_resource"];
