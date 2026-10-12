/**
 * The few word helpers the Plan's rule-written lines share (13 Oct 2026, DIY
 * P3). Pure. Every sentence on the Actions page is written by a rule (spec 10
 * section 2.1 item 7); these keep the rules saying positions and lists the
 * same way.
 */

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * A Google reading in words. A row with no position was measured and is not
 * in the top 20; a day with no row was not measured at all. The two are
 * never said the same way (spec 10 section 2.6 rule 2).
 */
export function positionWords(position: number | null): string {
  return position === null ? "not in the top 20" : ordinal(position);
}

/** "a", "a and b", "a, b and c". */
export function listWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
