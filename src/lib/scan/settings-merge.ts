/**
 * Folding the `app_settings` rows onto the defaults - the whole of it, pure.
 *
 * This lived inside `settings.ts` beside the Supabase read, which meant it
 * could not be executed by a test: that module is `server-only` and imports
 * `@/lib/supabase/admin`, so Node's own runner cannot load it. The only way to
 * check the merge from there was to retype it in the test, which is the blind
 * tripwire this repo has now found four of - a test that validates a copy of
 * the thing against the copy it rendered with.
 *
 * Same move `brand-name.ts` made out of `engines.ts`, for the same reason. The
 * network half stays in `settings.ts`; everything that decides what a stored
 * value is worth is here, and `settings-merge.test.mts` runs it.
 */

import { parseBlockedExtra } from "../work-email.ts";
import { FREE_ENGINES, GATED_ENGINES, type Engine, isEngine } from "./engines.ts";

export type Settings = {
  scans_enabled: boolean;
  daily_scan_cap: number;
  ip_scans_per_day: number;
  domain_cache_days: number;
  /** Engines the free scan reads, before any email is given. */
  scan_engines_free: Engine[];
  /** Engines the email unlocks. Run once, after the address is captured. */
  scan_engines_gated: Engine[];
  /** Spend ceiling for a rolling day, checked before any paid call. */
  daily_cost_cap_usd: number;
  /**
   * Gone from this table on 24 September 2026, with the nightly purge that was
   * its only reader. Transcripts are kept indefinitely, so there is no window
   * to configure. **Its `app_settings` row is deliberately still there** - it
   * is data, and deleting live rows is not ours - so a number in that cell now
   * reaches no code at all, which `reading-retention.test.mts` asserts rather
   * than leaves to be discovered by somebody turning the knob.
   */
  /**
   * How many times one scan link may put mail in somebody inbox in a rolling
   * day. The unlock route takes an address from the caller and sends to it, so
   * without a ceiling one token is an open relay for our own branding.
   */
  unlock_emails_per_day: number;
  /**
   * Model calls the whole site may bill in a rolling day.
   *
   * daily_cost_cap_usd sums DataForSEO spend and cannot see an Anthropic
   * call, so until this existed the model bill had no ceiling at all - only
   * per-scan ones, which bound a scan and not a day. Counted in calls rather
   * than dollars because a price per call typed into this repo goes stale
   * without anybody noticing, and a call count is what the column holds.
   */
  anthropic_calls_per_day: number;
  /**
   * Domains the coverage check's once-per-FREE_RUN_DAYS ceiling does not
   * apply to (Danny, 1 Oct 2026, danny.md line 174). The IP ceiling still
   * does. Lowercased and de-duplicated on the way in; a domain is never typed
   * into this repo, only into the row.
   */
  coverage_ceiling_exempt_domains: string[];
  /**
   * Domains the free scan's domain cache does not apply to (Danny, 15 Oct
   * 2026), so a prospect's domain can be re-run with a different category,
   * prompts or market instead of being handed the last reading of it. Every
   * other ceiling still applies - the daily count, the dollar cap, the model
   * call cap and the IP allowance - so this can only cost what those allow.
   * Lowercased and de-duplicated on the way in; a domain is never typed into
   * this repo, only into the row.
   */
  scan_cache_exempt_domains: string[];
  /**
   * New checks one domain may start in a rolling day from "Run a new check" on
   * a finished report (29 Oct 2026, /api/scan/[token]/rerun). The domain cache
   * hands every visitor the last reading for 30 days whatever category or
   * prompts they wanted; this is what bounds stepping round it. Every ceiling
   * in ceilings.ts still applies on top.
   */
  domain_reruns_per_day: number;
  /**
   * Domains refused on public forms on top of `work-email.ts`'s built-in list
   * (Danny, 8 Oct 2026), so one can be added without a deploy. Stored as
   * comma-separated text, empty by default; split by `parseBlockedExtra`.
   */
  work_email_blocked_extra: string[];
};

export const SETTINGS_FALLBACK: Settings = {
  scans_enabled: true,
  daily_scan_cap: 200,
  ip_scans_per_day: 3,
  domain_cache_days: 30,
  scan_engines_free: [...FREE_ENGINES],
  scan_engines_gated: [...GATED_ENGINES],
  daily_cost_cap_usd: 60,
  unlock_emails_per_day: 5,
  // Roughly eight calls per free pass, against a daily_scan_cap of 200. Set
  // above what a full day of scanning costs rather than at it: this is a
  // runaway guard, and a ceiling that trips on an ordinary busy day would be
  // turned off the first time it did.
  anthropic_calls_per_day: 2500,
  coverage_ceiling_exempt_domains: [],
  scan_cache_exempt_domains: [],
  domain_reruns_per_day: 5,
  work_email_blocked_extra: [],
};

/** The two keys whose value is a list of engine names rather than a scalar. */
const ENGINE_KEYS = ["scan_engines_free", "scan_engines_gated"] as const;
type EngineKey = (typeof ENGINE_KEYS)[number];

function isEngineKey(key: string): key is EngineKey {
  return (ENGINE_KEYS as readonly string[]).includes(key);
}

/**
 * The widest a number setting may be.
 *
 * Every number setting here is a count of days, scans, emails, model calls or
 * dollars, and none of them is meaningfully negative. The count is not typed:
 * it said "the nine numbers" while there were seven of them and two booleans,
 * which is the arithmetic of a sentence written when the two kinds were one
 * list. `settings-merge.test.mts` walks
 * `Object.keys(SETTINGS_FALLBACK).filter(k => typeof ... === "number")`, so a
 * new number setting is under this rule the day it is added. The ceilings fail
 * closed
 * on a negative - `spentToday >= -5` refuses everything - but
 * `domain_cache_days` fails the other way, putting the cache window in the
 * future so every scan misses it and runs for real.
 *
 * The upper bound is not tidiness. `start/route.ts` builds the cache window as
 * `new Date(Date.now() - domain_cache_days * 86_400_000).toISOString()`, and a
 * value large enough to overflow that multiplication makes an Invalid Date,
 * whose `toISOString()` throws `RangeError` - uncaught, in the route that
 * starts every scan on the site. A typo with too many zeroes in a jsonb cell
 * should not be able to take the scan path down.
 */
const NUMBER_MAX = 1_000_000;

/**
 * A stored value only replaces its default when it is the same kind of thing.
 *
 * jsonb holds whatever was typed into it, and the row is edited by hand in the
 * Supabase table editor. `false` is a boolean there and `"false"` is a string,
 * and the two look identical in the cell. Every number here survived that
 * confusion by coercion - comparing against "200" compares as 200 - but the two
 * booleans did not, and they are the two that matter:
 *
 * - `scans_enabled` as the string "false" is truthy, so the kill switch reads
 *   as on and scans keep running. That switch exists to be thrown in a hurry,
 *   by someone who will not then go and check that it took.
 *
 * `require_email_verification` was the second of the pair and is gone from
 * this table as of 24 September 2026, with the verify route and the email
 * gate. **Its `app_settings` row is deliberately still there** - it is data,
 * and deleting live rows is not ours to do - so a value of the wrong type in
 * that cell now reaches nothing rather than turning a gate on.
 *
 * A wrong-typed value fails silently and in the expensive direction, so it is
 * refused and logged rather than trusted. The engine lists never reach
 * this - `mergeEngineList` is their equivalent.
 */
export function sameShape(value: unknown, fallback: unknown): boolean {
  if (typeof fallback === "boolean") return typeof value === "boolean";
  if (typeof fallback === "number") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= NUMBER_MAX;
  }
  return false;
}

/**
 * One engine list, from whatever the cell holds.
 *
 * Three things a hand-edited jsonb array does that a per-element `isEngine`
 * filter alone does not catch:
 *
 * - **It is not an array at all.** `"chatgpt"` is valid jsonb and was read as
 *   an empty list with nothing logged, so `scan_engines_gated` silently emptied
 *   and the unlock pass became a no-op. Refused and logged now, like every
 *   scalar of the wrong type.
 * - **It repeats a name.** `["chatgpt", "chatgpt"]` passes `isEngine` twice,
 *   and the pipeline builds its job list as
 *   `questions.flatMap(q => engines.map(...))` - so every question is asked of
 *   that engine twice, at twice the price, for one answer. Pasting a line twice
 *   in a table editor is the ordinary way that row gets edited.
 * - **A name appears in both lists.** Handled by the caller, once both are
 *   known, because it is a fact about the pair rather than about either list.
 */
function mergeEngineList(key: EngineKey, value: unknown, warn: (message: string) => void): Engine[] {
  if (!Array.isArray(value)) {
    warn(`app_settings.${key} is ${JSON.stringify(value)}, not an array; using the default`);
    return [...SETTINGS_FALLBACK[key]];
  }

  // An unrecognised engine name is dropped rather than trusted: a typo in this
  // row must not send a request to an endpoint that does not exist.
  const known = value.filter(isEngine);
  const dropped = value.length - known.length;
  if (dropped) warn(`app_settings.${key} names ${dropped} engine(s) that do not exist; dropping them`);

  const list = [...new Set(known)];
  if (list.length !== known.length) {
    warn(`app_settings.${key} repeats an engine name; each one is read once`);
  }

  // The gated set may legitimately be empty; the free set may not.
  if (!list.length && key === "scan_engines_free") {
    warn("app_settings.scan_engines_free is empty; using the default");
    return [...SETTINGS_FALLBACK.scan_engines_free];
  }
  return list;
}

/**
 * The exempt-domain list, from whatever the cell holds.
 *
 * Not an array is refused and logged, like an engine list. A non-string or
 * blank entry is dropped and logged. Entries are trimmed and lowercased so a
 * capital typed into the table editor still matches the normalised domain the
 * route checks, and read once each.
 */
function mergeDomainList(key: string, value: unknown, warn: (message: string) => void): string[] {
  if (!Array.isArray(value)) {
    warn(`app_settings.${key} is ${JSON.stringify(value)}, not an array; using the default`);
    return [];
  }
  const strings = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (strings.length !== value.length) {
    warn(`app_settings.${key} holds ${value.length - strings.length} entry(s) that are not domains; dropping them`);
  }
  return [...new Set(strings)];
}

/**
 * Fold the stored rows onto the defaults.
 *
 * `warn` is `console.warn` in production and an array push in the test, which
 * is the only reason it is a parameter: a refusal that is not logged is a
 * setting that silently is not what the table says it is, and the test has to
 * be able to see that it happened.
 */
export function mergeSettings(
  rows: ReadonlyArray<{ key: string; value: unknown }>,
  warn: (message: string) => void = () => {},
): Settings {
  /**
   * Both lists copied, not shared.
   *
   * `{ ...SETTINGS_FALLBACK }` is shallow, so every call that took the default
   * handed back the module constant's own array. Nothing mutates one today, but
   * one `.sort()` or `.push()` in a caller would edit the defaults for the rest
   * of the process - a bug that survives the request that caused it and shows
   * up somewhere else entirely.
   */
  const out: Settings = {
    ...SETTINGS_FALLBACK,
    scan_engines_free: [...SETTINGS_FALLBACK.scan_engines_free],
    scan_engines_gated: [...SETTINGS_FALLBACK.scan_engines_gated],
    coverage_ceiling_exempt_domains: [...SETTINGS_FALLBACK.coverage_ceiling_exempt_domains],
    scan_cache_exempt_domains: [...SETTINGS_FALLBACK.scan_cache_exempt_domains],
    work_email_blocked_extra: [...SETTINGS_FALLBACK.work_email_blocked_extra],
  };

  for (const row of rows) {
    const key = row.key;
    /**
     * hasOwn, not `in`. `in` answers for the whole prototype chain, so a row
     * keyed `constructor`, `toString` or `valueOf` passed this test and went on
     * to be compared against `SETTINGS_FALLBACK[key]` - an inherited function
     * rather than a setting - and, where the shapes had agreed, would have been
     * written onto `out` as a real own property under a name no reader of this
     * file would expect to find there.
     *
     * Nothing outside writes app_settings, so this is the pattern rather than a
     * live hole. It is the same pattern as the `/scan?verify=` fix: a plain
     * object indexed by a string that came from somewhere else, guarded by a
     * test that does not do what it looks like it does.
     */
    if (!Object.hasOwn(SETTINGS_FALLBACK, key)) continue;

    if (isEngineKey(key)) {
      out[key] = mergeEngineList(key, row.value, warn);
      continue;
    }

    if (key === "coverage_ceiling_exempt_domains" || key === "scan_cache_exempt_domains") {
      out[key] = mergeDomainList(key, row.value, warn);
      continue;
    }

    if (key === "work_email_blocked_extra") {
      out[key] = parseBlockedExtra(row.value);
      continue;
    }

    const fallback = SETTINGS_FALLBACK[key as keyof Settings];
    // jsonb comes back already parsed: true, 200, and so on. Parsed is not the
    // same as the right kind of thing, which is what sameShape is for.
    if (!sameShape(row.value, fallback)) {
      warn(
        `app_settings.${key} is ${JSON.stringify(row.value)}, not a ${typeof fallback}` +
          ` in range; using the default`,
      );
      continue;
    }
    (out as Record<string, unknown>)[key] = row.value;
  }

  /**
   * An engine in both lists is paid for twice and answers once.
   *
   * The free pass reads it, the row freezes it into `engines`, and then the
   * gated pass re-asks every question on it at full price. `engines_answered`
   * is unioned and every citation reader keys on
   * `(source_domain, question_id, engine)`, so nothing on the report moves -
   * the address bought a second copy of an answer it already had.
   *
   * Dropped from the gated side rather than the free one: the free pass has
   * already run by the time the overlap costs anything, and taking an engine
   * out of the free scan would change what an anonymous visitor is shown.
   */
  const free = new Set<string>(out.scan_engines_free);
  const overlap = out.scan_engines_gated.filter((e) => free.has(e));
  if (overlap.length) {
    warn(
      `app_settings.scan_engines_gated repeats ${overlap.join(", ")} from scan_engines_free;` +
        " the unlock pass would re-ask them at full price, so they are dropped",
    );
    out.scan_engines_gated = out.scan_engines_gated.filter((e) => !free.has(e));
  }

  return out;
}
