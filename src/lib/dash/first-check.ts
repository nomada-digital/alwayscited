import { checkAt, clockIn, nextCheckAt, zoneDay } from "../tracking/check-time.ts";

/**
 * Day zero (18 Oct 2026): a client with prompts but no reading yet - every
 * new signup, and the comped profiles after the customer reset - drew a page
 * of dashes and zeros with nothing saying why. This is the one line that does,
 * on every page: when the first check runs, in the client's zone. The runner
 * skips a client before its started_on (decide.ts shouldTrack), so the first
 * check is the later of the next run and the run on the start day.
 *
 * Null once there is a reading, and while nothing is tracked (no prompt, so no
 * check to promise - check-time.ts NO_PROMPT_NO_CHECK). Pure: `now` is passed in.
 */
export function firstCheckLine(
  c: { market: string; started_on: string | null },
  state: { hasRun: boolean; tracking: boolean },
  now: number,
): string | null {
  if (state.hasRun || !state.tracking) return null;
  const at = Math.max(nextCheckAt(now), c.started_on ? checkAt(c.started_on) : 0);
  const day = zoneDay(at, c.market);
  const when = day === zoneDay(now, c.market) ? "today" : day === zoneDay(now + 86_400_000, c.market) ? "tomorrow" : `on ${dayName(day)}`;
  return `No readings yet. The first check runs ${when} at ${clockIn(at, c.market)}; AI answers and Google positions show here after it.`;
}

function dayName(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
