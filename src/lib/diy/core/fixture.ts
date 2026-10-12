import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fixtureMode } from "../../tracking/fixture-mode.ts";
import { fixtureWrites } from "../../tracking/fixture-writes.ts";

/**
 * The DIY fixture state (13 Oct 2026, DIY P1 milestone M1; spec 10 section
 * 7.0 item 6). The DIY pages run on the tracking fixture (`TRACKING_FIXTURE=1`,
 * fixture-mode.ts), which supplies the client, its tier and mode, its
 * readings and the session. `DIY_FIXTURE_STATE` picks what the DIY layer has
 * read on top of it. Each package serves its own
 * `src/lib/diy/fixtures/<pkg>.json` through `readDiyFixture`, keyed by state.
 *
 * Refused in production with the tracking fixture: every reader here asks
 * fixtureMode, which throws when `VERCEL_ENV=production`. The environment is
 * read as fixture-mode.ts reads it, through a parameter defaulting to the
 * process's, so the tests run every state without a server.
 */

type Env = Record<string, string | undefined>;

/** Every `DIY_FIXTURE_STATE`; unset is `full`. */
export const DIY_FIXTURE_STATES = ["full", "dark", "day0", "zero", "capped", "nofootprint", "nolinks", "fewcompetitors"] as const;
export type DiyFixtureState = (typeof DIY_FIXTURE_STATES)[number];

/** What each state stands for, for the package that builds its file. A package's file names only the states it draws differently. */
export const DIY_FIXTURE_MEANS: Record<DiyFixtureState, string> = {
  full: "every DIY read has run; the default",
  dark: "diy_enabled is off, so no paid read has run: paid-only sections are hidden and free data shows",
  day0: "the first night has not run, so nothing DIY has been read yet",
  zero: "read, and nothing to act on",
  capped: "this month's allowances and budgets are used",
  nofootprint: "the Google footprint pull came back empty",
  nolinks: "the latest Backlinks call failed with an access code",
  fewcompetitors: "fewer than 3 sites in the comparison set",
};

/**
 * The DIY fixture state. Unset is `full`; anything not in DIY_FIXTURE_STATES
 * throws, so a mistyped state in a spec fails rather than quietly serving
 * `full`. Null when the fixture is off.
 */
export function diyFixtureState(env: Env = process.env): DiyFixtureState | null {
  if (!fixtureMode(env)) return null;
  const want = env.DIY_FIXTURE_STATE;
  if (want === undefined || want === "") return "full";
  if ((DIY_FIXTURE_STATES as readonly string[]).includes(want)) return want as DiyFixtureState;
  throw new Error(`DIY_FIXTURE_STATE=${want}: not a DIY fixture state (${DIY_FIXTURE_STATES.join(", ")})`);
}

/** The DIY switch on the fixture: on in every state but `dark`. Null when the fixture is off, so the caller reads app_settings. */
export function fixtureDiyEnabled(env: Env = process.env): boolean | null {
  const state = diyFixtureState(env);
  return state === null ? null : state !== "dark";
}

/** A package's fixture file: `full` always, and any state it draws differently. */
export type DiyFixtureFile<T> = { full: T } & Partial<Record<DiyFixtureState, T>>;

/** The file's entry for a state, else its `full`. */
export function pickState<T>(file: DiyFixtureFile<T>, state: DiyFixtureState): T {
  if (!file || typeof file !== "object" || !("full" in file)) throw new Error("a DIY fixture file needs a full entry");
  return file[state] ?? file.full;
}

/** A fixture file's name: a package name, optionally with a dotted part (`plan`, `origins.p7`). */
export const FIXTURE_NAME = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)?$/;

/** Where the fixture files live, from the repo root. */
export const FIXTURE_DIR = join("src", "lib", "diy", "fixtures");

/**
 * The current state's entry of `src/lib/diy/fixtures/<name>.json`. Throws
 * when the fixture is off: a package's loader asks `diyFixtureState()` first
 * and reads Supabase when it is null.
 */
export function readDiyFixture<T>(name: string, env: Env = process.env, root: string = process.cwd()): T {
  const state = diyFixtureState(env);
  if (state === null) throw new Error("the DIY fixture is read only with TRACKING_FIXTURE=1");
  if (!FIXTURE_NAME.test(name)) throw new Error(`not a DIY fixture name: ${name}`);
  const file = JSON.parse(readFileSync(join(root, FIXTURE_DIR, `${name}.json`), "utf8")) as DiyFixtureFile<T>;
  return pickState(file, state);
}

/** Whether the DIY write twins may change the fixture: exactly when the tracking fixture is writable (`TRACKING_FIXTURE_WRITE=1`). */
export function diyFixtureWrites(env: Env = process.env): boolean {
  return fixtureWrites(env);
}

/**
 * One package's writable fixture, held in process memory on globalThis -
 * the route handlers and the pages are bundled apart and would otherwise
 * each hold their own copy - and gone on restart. `init` builds it the first
 * time it is asked for. Nothing reaches a database.
 */
export function diyFixtureStore<T>(pkg: string, init: () => T): { get(): T; set(next: T): void } {
  if (!FIXTURE_NAME.test(pkg)) throw new Error(`not a DIY fixture name: ${pkg}`);
  const key = Symbol.for(`alwayscited.diyFixture.${pkg}`);
  const g = globalThis as unknown as Record<symbol, { value: T } | undefined>;
  return {
    get() {
      g[key] ??= { value: init() };
      return g[key].value;
    },
    set(next: T) {
      g[key] = { value: next };
    },
  };
}
