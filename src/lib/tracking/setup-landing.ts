/**
 * Where sign-in lands while a client's setup is unconfirmed (R166 part 3a,
 * Danny, danny.md line 175: "After auth, redirect to /setup until
 * confirmed"). /api/app/auth asks it since part 3c.
 *
 * Setup is confirmed once the client has a dashboard_events row named
 * SETUP_CONFIRMED_EVENT. The column has no database whitelist, so the event
 * needs no migration.
 *
 * Until then setup wins over a safe next: "until confirmed" is Danny's word,
 * and a bookmark into a dashboard with nothing set up lands on empty panels.
 * A next that is already that client's setup page is kept as it is.
 */
export const SETUP_CONFIRMED_EVENT = "setup_confirmed";

import { appPath } from "../app-host.ts";
import { NO_PROMPT_NO_CHECK, checkAt, checkTime, nextCheckAt, zoneDay } from "./check-time.ts";
import { addDays, formatDay } from "./figures.ts";

export const setupPath = (slug: string) => appPath(`/${slug}/setup`);

export function setupConfirmed(events: readonly { event: string }[]): boolean {
  return events.some((e) => e.event === SETUP_CONFIRMED_EVENT);
}

/**
 * R166 part 3c: the first started_on that goes through setup. The page went
 * live on 1 Oct 2026 at 19:16Z, and signup starts a client the day after
 * purchase (signup.ts), so every client bought from then on starts on
 * 2 Oct or later. Clients started before were set up by hand, have no
 * setup_confirmed row, and would otherwise be sent through a setup they
 * have already had. A missing start is one of those.
 */
export const SETUP_SINCE = "2026-10-02";

export function needsSetup(c: { started_on: string | null }): boolean {
  return c.started_on !== null && c.started_on >= SETUP_SINCE;
}

/**
 * DS10 (R172 pass 1 part 3, 2 Oct 2026): whether the Overview says setup is
 * still to confirm. Sign-in lands on setup, but a member who leaves it and
 * comes back through /app or a bookmark reached the Overview with no way
 * back. A failed read (null) says nothing. The fixture's dates are frozen
 * before SETUP_SINCE, so there its own confirmed flag is the whole answer.
 */
export function setupOutstanding(c: { started_on: string | null }, confirmed: boolean | null, fixture = false): boolean {
  return confirmed === false && (fixture || needsSetup(c));
}

/**
 * Which of a member's clients they land on (8 Oct 2026, review of 2379757):
 * the first, in the order /app lists them, that has not ended. An ended
 * client stays listed - its history is still theirs - but is never where a
 * member arrives. One rule for /app and for the email sign-in.
 */
export function landingIndex(clients: readonly { status?: string }[]): number {
  const i = clients.findIndex((c) => c.status !== "ended");
  return i === -1 ? 0 : i;
}

export function landingAfterAuth(o: {
  next: string | null;
  /** The member's clients in the order /app lists them; null when the read failed. */
  clients: readonly { slug: string; confirmed: boolean; status?: string }[] | null;
}): string {
  if (o.clients === null) return o.next ?? appPath("");
  if (!o.clients.length) return appPath("/login?access=none");
  const first = o.clients[landingIndex(o.clients)]!;
  if (!first.confirmed) return setupPath(first.slug);
  return o.next ?? appPath(`/${first.slug}`);
}

/** The prompts a setup card shows: the scan's five angles, one each (signup.ts PROMPTS_PER_CLUSTER). */
export const SETUP_PROMPTS = 5;

export type SetupCard = { id: string; name: string; keyword: string | null; prompts: { id: string; text: string; angle: string | null }[] };

/**
 * Step 2 of /app/[client]/setup (R166 part 3b): one card per live cluster
 * bought, in the order the dashboard lists them, with its keyword (null is
 * "Needs a keyword") and up to SETUP_PROMPTS of its live prompts.
 */
export function setupCards(d: {
  clusters: readonly { id: string; name: string; keyword_id: string | null; stopped_on: string | null }[];
  questions: readonly { id: string; text: string; cluster_id: string | null; stopped_on: string | null; angle: string | null }[];
  keywords: readonly { id: string; keyword: string }[];
}): SetupCard[] {
  return d.clusters
    .filter((c) => c.stopped_on === null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      keyword: d.keywords.find((k) => k.id === c.keyword_id)?.keyword ?? null,
      prompts: d.questions
        .filter((q) => q.cluster_id === c.id && q.stopped_on === null)
        .slice(0, SETUP_PROMPTS)
        .map((q) => ({ id: q.id, text: q.text, angle: q.angle })),
    }));
}

/** Step 3's button: Danny's words on the placement tiers, a tracking plan's plainer ones. */
export const confirmLabel = (placed: boolean) => (placed ? "Confirm - these are what you'll target" : "Confirm - start tracking these");

/**
 * R166 step 6: a client's setup state as /admin/tracking shows it. Confirmed
 * names the day and who pressed Confirm, from the earliest setup_confirmed
 * row; a client started before SETUP_SINCE was set up by hand and never
 * passes through the page; anyone else is still waiting on the client.
 */
export function setupState(c: { started_on: string | null }, rows: readonly { created_at: string; member_email: string | null }[]): string {
  const first = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (first) return `setup confirmed ${first.created_at.slice(0, 10)}${first.member_email ? ` by ${first.member_email}` : ""}`;
  return needsSetup(c) ? "setup not confirmed yet" : "set up by hand (before the setup page)";
}

/**
 * When a client's first check runs, by its start date alone, said from
 * `today` in the client's zone (9 Oct 2026, audit copy-2): "tomorrow at
 * 06:00 UK time", "on 12 Oct at 1:00am ET". Null once started_on is today or
 * past - the runner checks a live prompt whether or not setup was confirmed
 * (decide.ts shouldTrack), so there is no first check left to promise - or
 * when it is unset. It knows nothing of prompts, so copy goes through setupChecks.
 *
 * 12 Oct 2026 (email review H3): one path. With `now`, the first check is
 * still to come until its own moment (checkAt), not until London's day turns:
 * a client started today and confirming before that day's check - a US
 * evening, or a London small hour - was told checks had begun. Without
 * `now`, noon UTC on `today` stands in, which says exactly what the
 * London-day rule said: "tomorrow", or "on 12 Oct", in the client's zone.
 */
export function firstCheckWhen(startedOn: string | null, today: string, market: string, now: number | null = null): string | null {
  const at = now ?? noonOf(today);
  if (!startedOn || checkAt(startedOn) <= at) return null;
  return checkOn(startedOn, market, at);
}

/** Noon UTC on a tracking day: the same calendar day in London and New York, for a caller with no moment of its own. */
const noonOf = (day: string) => Date.parse(`${day}T12:00:00Z`);

/**
 * The daily check on `day`, said from `now` in the client's zone (ON-1
 * review, 9 Oct 2026): "today at 1:00am ET", "tomorrow at 06:00 UK time", "on
 * 11 Oct at 1:00am ET". The tracking day is London's, so "tomorrow" worked out
 * from it was a day early for a US client in its evening.
 */
export function checkOn(day: string, market: string, now: number): string {
  const local = zoneDay(checkAt(day), market);
  const here = zoneDay(now, market);
  const word = local === here ? "today" : local === addDays(here, 1) ? "tomorrow" : `on ${formatDay(local)}`;
  return `${word} at ${checkTime(day, market)}`;
}

/**
 * When prompts saved now are first asked (ON-1 review): they are added for
 * the next tracking day (stop.ts stopDay), and a client is checked only from
 * its start, so the later of the two, said from `now` in the client's zone.
 */
export function firstAsked(p: { today: string; startedOn: string | null; market: string; now: number }): string {
  const added = addDays(p.today, 1);
  return checkOn(p.startedOn && p.startedOn > added ? p.startedOn : added, p.market, p.now);
}

/**
 * What the setup page and the setup_confirmed mail say about the checks,
 * worded once (9 Oct 2026, review of 3eaa592). shouldTrack checks a client
 * only once it has a live prompt and its start has come, so: no live prompt
 * promises nothing, in the Overview's words; a start still to come names the
 * first check; otherwise checks have begun, and the line says when they run.
 * `livePrompts` counts prompts not stopped, as the Overview and Settings
 * count them. `first` is set only for a first check still to come, for the
 * mail's subject.
 */
export function setupChecks(c: { startedOn: string | null; today: string; market: string; livePrompts: number; now?: number }): { first: string | null; line: string } {
  if (c.livePrompts < 1) return { first: null, line: NO_PROMPT_NO_CHECK };
  // `now` (ON-1 review): the first check's day said in the client's zone (checkOn).
  const at = c.now ?? noonOf(c.today);
  const first = firstCheckWhen(c.startedOn, c.today, c.market, at);
  if (first) return { first, line: `The first check runs ${first}.` };
  // L2 (12 Oct 2026, email review): "Checks run every day at 06:00 UK time" stopped being true when the clocks went
  // back, and the setup_confirmed mail keeps saying it. One time is named: the next run's, worked out by check-time.ts.
  const next = new Date(nextCheckAt(at)).toISOString().slice(0, 10);
  return { first: null, line: `Checks run every day. The next one runs ${checkOn(next, c.market, at)}.` };
}
