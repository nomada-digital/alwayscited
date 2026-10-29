/**
 * Which plans see which links (Danny, 29 Oct 2026): placements on alwaysmentioned and up, link insertions on the
 * alwayscited plan and up - what each plan delivers (lib/dash/plan.ts deliverables). alwaystracked sees neither.
 *
 * Loadable by node --test: no imports.
 */
export const showsPlacements = (tier: string): boolean => tier === "mentioned" || tier === "cited" || tier === "everywhere";
export const showsInsertions = (tier: string): boolean => tier === "cited" || tier === "everywhere";
