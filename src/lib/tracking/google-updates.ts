/**
 * Google updates rolling out, so a position that swings in one is read with that in mind (Danny, 15 Nov 2026: the
 * November 2026 core update, 10 to about 24 Nov). The Search positions page notes the one rolling out today. Pure.
 */
export const GOOGLE_UPDATES: { from: string; to: string; note: string }[] = [
  { from: "2026-11-10", to: "2026-11-24", note: "Google core update rolling out - positions may swing" },
];

export function updateRolling(today: string): { from: string; to: string; note: string } | null {
  return GOOGLE_UPDATES.find((u) => u.from <= today && today <= u.to) ?? null;
}
