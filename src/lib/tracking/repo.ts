import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { trackingDay } from "./decide.ts";
import type { Day, Range } from "./figures.ts";
import { expandFixture, fixtureClients, fixtureMode, fixtureSettings, fixtureSetupConfirmed, fixtureSignedOut, fixtureState, fixtureUnreadable, type Fixture } from "./fixture-mode.ts";
import { type FixtureWritten, fixtureWrites } from "./fixture-writes.ts";
import { type MemberClient, clientsFor, sessionEmail } from "./member.ts";
import type { LatestAnswers } from "./latest-answers.ts";
import { loadLinkState } from "./login-link.ts";
import { type LinkState, fixtureLinkState } from "./login-link-state.ts";
import type { PlacementRow } from "./placement-figures.ts";
import { urlKey } from "./placements.ts";
import { loadPlacements } from "./placements-data.ts";
import { type SettingsData, loadSettings } from "./settings-data.ts";
import { orderKeyword } from "./order-keyword.ts";
import { loadOrderKeyword, loadReportOpened, loadSetupConfirmed } from "./setup-data.ts";
import { type UpgradeContext, loadUpgradeContext } from "./upgrade-context.ts";
import { type ClusterNote, type Compare, type OverviewData, loadAnswerDay, loadClusterNotes, loadOverview, loadStructure } from "./overview-data.ts";
import { type DayPlan, type ReadOpts, type StoredAnswer, type Structure, shapeAnswerDay, shapeRead } from "./read-shape.ts";

/**
 * The dashboard's data layer (R93, 29 Sep 2026; BRIEF-2 T9): one interface,
 * two implementations. Supabase in production; the committed fixture when
 * `TRACKING_FIXTURE=1` (fixture-mode.ts), which production refuses. Every
 * /app page reads through `trackingRepo()`, never a table directly, so specs
 * run the real pages on the fixture.
 */
export interface TrackingRepo {
  /** The signed-in email, or null. */
  sessionEmail(): Promise<string | null>;
  /** Every client this email may see, oldest first, with the member's role. */
  clientsFor(email: string): Promise<(MemberClient & { role: string })[]>;
  /** Everything the overview reads for one client and range, or the part of it `opts` names (read-shape.ts). */
  loadOverview(clientId: string, range: Range, compare: Compare, opts?: ReadOpts): Promise<OverviewData>;
  /** The clusters, prompts and keywords, with no answer read (8 Oct 2026, audit perf-4). */
  structure(clientId: string): Promise<Structure>;
  /** One prompt's answers, with their words, at the check the plan names: `?day=`'s, or the latest on or before the range's end (T7 part 3b; DB-2). */
  answerDay(clientId: string, plan: DayPlan): Promise<LatestAnswers>;
  /** Notes on these prompts, any date, newest first (T7 part 4a). */
  clusterNotes(clientId: string, questionIds: string[]): Promise<ClusterNote[]>;
  /** The upsell mode and this member's hidden prompts (T11 part 4). */
  upgradeContext(clientId: string, email: string, today: Day): Promise<UpgradeContext>;
  /** The client's placements, removed ones included (T13, R97 part 2). */
  placements(clientId: string): Promise<(PlacementRow & { cluster_id: string })[]>;
  /** Settings (R142, BRIEF-4 P2): the names we match and the account's live members. */
  settings(clientId: string): Promise<SettingsData>;
  /** The tracking day the dashboard treats as today. */
  today(): Day;
  /**
   * The moment the dashboard treats as now, epoch ms (ON-1 review, 9 Oct 2026): the clock in production; on the
   * fixture, noon UTC on its own frozen today, so a check time said from now is the same on every run.
   */
  now(): number;
  /** A login link's state, read without spending it (R163); null when the read failed. */
  linkState(token: string): Promise<LinkState | null>;
  /** Whether the client's setup is confirmed (R166); null when the read failed. */
  setupConfirmed(clientId: string): Promise<boolean | null>;
  /** The keyword typed at checkout on an order with no scan behind it (R180); null otherwise or on a failed read. */
  orderKeyword(clientId: string): Promise<string | null>;
  /** ON-3: whether a CSV was downloaded or Reports opened on this client (usage events); null on a failed read. */
  reportOpened(clientId: string): Promise<boolean | null>;
}

const supabaseRepo: TrackingRepo = { sessionEmail, clientsFor, linkState: loadLinkState, setupConfirmed: loadSetupConfirmed, orderKeyword: loadOrderKeyword, reportOpened: loadReportOpened, loadOverview, structure: loadStructure, answerDay: loadAnswerDay, clusterNotes: loadClusterNotes, upgradeContext: loadUpgradeContext, placements: loadPlacements, settings: loadSettings, today: () => trackingDay(), now: () => Date.now() };

/**
 * The fixture as served, and as R168's writes leave it. On globalThis, because
 * the route handlers and the pages are bundled apart and would otherwise each
 * hold their own copy; a restart reads the file again.
 */
type FixtureStore = { fixture: Fixture; setupConfirmed: boolean };
const STORE = Symbol.for("alwayscited.trackingFixture");
function store(): FixtureStore {
  const g = globalThis as { [STORE]?: FixtureStore };
  // A constant path, so the build traces this one file.
  g[STORE] ??= { fixture: fixtureState(expandFixture(JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "tracking", "fixture.json"), "utf8")))), setupConfirmed: fixtureSetupConfirmed() };
  return g[STORE];
}
function fixture(): Fixture {
  return store().fixture;
}

/**
 * R168: apply one write to the fixture held in memory. Null when the fixture
 * is read-only (TRACKING_FIXTURE_WRITE unset), so the route answers as before.
 */
export function writeFixture<W extends FixtureWritten>(apply: (f: Fixture) => W): W | null {
  if (!fixtureWrites()) return null;
  const s = store();
  const r = apply(s.fixture);
  if (r.ok) s.fixture = r.fixture;
  return r;
}

/** R168: the fixture as the writes have left it, for a route that reads before it answers; null when it is read-only. */
export function writableFixture(): Fixture | null {
  return fixtureWrites() ? fixture() : null;
}

/** R168: setup confirm on the fixture; false when it is read-only. */
export function confirmFixtureSetup(): boolean {
  if (!fixtureWrites()) return false;
  store().setupConfirmed = true;
  return true;
}

const fixtureRepo: TrackingRepo = {
  async sessionEmail() {
    if (fixtureSignedOut()) return null;
    return fixture().member.email;
  },
  async clientsFor(email) {
    // AG-1 (9 Oct 2026): the session's scope applies here as clientsFor applies it (fixtureClients).
    return fixtureClients(fixture(), email);
  },
  async loadOverview(clientId, _range, _compare, opts) {
    fixtureUnreadable();
    // The fixture holds both periods whole; the figures cut the range. The shape is the Supabase read's (read-shape.ts).
    return clientId === fixture().client.id ? shapeRead(fixture().data, opts) : { clusters: [], questions: [], keywords: [], answers: [], serp: [], lastRun: null, runs: [], notes: [] };
  },
  async structure(clientId) {
    fixtureUnreadable();
    const d = fixture().data;
    return clientId === fixture().client.id ? { clusters: d.clusters, questions: d.questions, keywords: d.keywords } : { clusters: [], questions: [], keywords: [] };
  },
  async answerDay(clientId, plan) {
    const f = fixture();
    if (clientId !== f.client.id) return { day: null, rows: [] };
    // The fixture's rows as tracking_answers holds them; the day is picked, and the rows cut, by read-shape.ts shapeAnswerDay.
    // The words exist for one check only (today's, or textsOn); an earlier day shows its verdicts without them.
    const at = ["05:10", "05:11", "05:12", "05:12"];
    const nth = new Map<Day, number>();
    const stored: StoredAnswer[] = f.data.answers
      .filter((a) => a.question_id === plan.question)
      .map((a) => {
        const i = nth.get(a.run_date) ?? 0;
        nth.set(a.run_date, i + 1);
        return { ...a, response_text: a.run_date === (f.textsOn ?? f.today) ? (f.texts[`${plan.question} ${a.engine}`] ?? null) : null, created_at: `${a.run_date}T${at[i % 4]}:00Z` };
      });
    return shapeAnswerDay(stored, plan);
  },
  async clusterNotes(clientId, questionIds) {
    const f = fixture();
    if (clientId !== f.client.id) return [];
    return f.clusterNotes.filter((n) => questionIds.includes(n.question_id)).sort((a, b) => b.note_date.localeCompare(a.note_date));
  },
  async upgradeContext() {
    // The fixture's account is ours, and nobody has hidden a prompt. 13 Oct 2026, DIY P2: placed-agency's is an agency's.
    return { mode: fixture().mode ?? "nomada", hidden: new Set() };
  },
  async placements(clientId) {
    const f = fixture();
    return clientId === f.client.id ? f.placements.map((p) => ({ ...p, url_key: urlKey(p.url) ?? "" })) : [];
  },
  async settings(clientId) {
    return fixtureSettings(fixture(), clientId);
  },
  today() {
    return fixture().today;
  },
  now() {
    return Date.parse(`${fixture().today}T12:00:00Z`);
  },
  async linkState(token) {
    return fixtureLinkState(token, fixture().member.email);
  },
  async setupConfirmed() {
    return store().setupConfirmed;
  },
  async orderKeyword(clientId) {
    const f = fixture();
    return clientId === f.client.id ? orderKeyword(f.order) : null;
  },
  async reportOpened() {
    // The fixture records no usage events (the event and report routes write nothing on it), so none was ever opened.
    return false;
  },
};

export function trackingRepo(): TrackingRepo {
  return fixtureMode() ? fixtureRepo : supabaseRepo;
}
