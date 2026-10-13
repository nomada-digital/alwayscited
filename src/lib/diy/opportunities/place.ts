/**
 * One page, one row (13 Oct 2026, review of DIY P7): which stored row a row
 * the night derives is, across lenses. Plain module, no imports, so the night
 * job (refresh.job.ts) and the fixture (data.ts fixtureWorld) share the rule.
 */

/** The lenses the night derives; a row of another lens (logged, P10's) is never made or retired by it. */
export const DERIVED_LENSES: ReadonlySet<string> = new Set(["cited", "threads", "profiles", "lists", "own"]);

/** The lenses one page is matched across: every lens but P10's link lenses, which are about a domain or a link, not the page's place in a list. */
export const PAGE_LENSES: ReadonlySet<string> = new Set(["cited", "lists", "threads", "profiles", "own", "logged"]);

/**
 * Which stored row a derived row is (13 Oct 2026, review of DIY P7). Rows are
 * unique per page and lens, but a page's lens can change from one night to
 * the next - a best-of list on Google starts being cited (lists to cited),
 * or the model types its domain a night later (cited to threads or profiles).
 * Without this the night inserted a fresh `new` row beside the old one, so a
 * page the member had marked "Not for us" came back, and a pursued one was
 * offered again and counted twice against the cap.
 *
 * - `same`: the row of this page and lens.
 * - `kept`: the page's row in another lens that a member has moved (any
 *   status but new) or logged. It stays where it is with its status; only its
 *   evidence is refreshed, and no second row is made.
 * - `relens`: the page's `new` row in another derived lens: moved to the new
 *   lens and route rather than doubled.
 * - `none`: no row of this page yet.
 *
 * Generic over the stored shape, so the fixture's overlays (data.ts
 * fixtureWorld) are matched by the same rule as the table's rows. Pure.
 */
export function placeDerived<R extends { lens: string; urlKey: string; status: string }>(d: { lens: string; urlKey: string }, stored: readonly R[]): { kind: "same" | "kept" | "relens"; row: R } | { kind: "none" } {
  const same = stored.find((r) => r.lens === d.lens && r.urlKey === d.urlKey);
  if (same && same.status !== "new") return { kind: "same", row: same };
  const others = stored.filter((r) => r.urlKey === d.urlKey && r.lens !== d.lens && PAGE_LENSES.has(r.lens));
  // A member's decision on the page wins over a new row of it in this lens, which then goes not live.
  const kept = others.find((r) => r.status !== "new" || r.lens === "logged");
  if (kept) return { kind: "kept", row: kept };
  if (same) return { kind: "same", row: same };
  const fresh = others.find((r) => r.status === "new" && DERIVED_LENSES.has(r.lens));
  if (fresh) return { kind: "relens", row: fresh };
  return { kind: "none" };
}
