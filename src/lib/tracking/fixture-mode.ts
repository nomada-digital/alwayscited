import { brandKey, subjectKeys } from "../scan/brand-name.ts";
import type { UpsellMode } from "./ask.ts";
import { failureSummary } from "./decide.ts";
import { addDays, type Day } from "./figures.ts";
import { PROMPTS_PER_CLUSTER } from "./limits.ts";
import type { OrderPick } from "./order-keyword.ts";
import type { ClusterNote, OverviewData } from "./overview-data.ts";
import type { PlacementRow } from "./placement-figures.ts";
import { sees } from "./scope.ts";
import type { SettingsData } from "./settings-data.ts";

/**
 * The T9 fixture switch (R93, 29 Sep 2026; BRIEF-2 T9). `TRACKING_FIXTURE=1`
 * runs the whole of /app on `fixture.json` - made-up Tallyroo, built from
 * boards-3/dataset.py by docs/parity/T9/make-fixture.py - with a fixture
 * session, so specs and parity need no login and no database.
 *
 * Never in production: with `VERCEL_ENV=production` the switch throws instead
 * of answering, and the /app layout asks it on every request, so a production
 * deploy with the variable set serves an error rather than a made-up client.
 * Pure, so the refusal is tested without a server.
 */
export function fixtureMode(env: Record<string, string | undefined> = process.env): boolean {
  if (env.TRACKING_FIXTURE !== "1") return false;
  if (env.VERCEL_ENV === "production") {
    throw new Error("TRACKING_FIXTURE=1 is set in production - /app refuses to start on the fixture");
  }
  return true;
}

export type Fixture = {
  client: {
    id: string;
    slug: string;
    brand: string;
    domain: string;
    market: string;
    tier: string;
    started_on: string;
    question_limit: number;
    keyword_limit: number;
    cluster_limit: number;
    status?: string;
    trial_ends_at?: string | null;
    trial_cancelled_at?: string | null;
    /** BL-2 (9 Oct 2026): the payment state the webhook records; only the past-due and unpaid states set it. */
    payment_status?: string | null;
    payment_retry_at?: string | null;
    payment_invoice_url?: string | null;
    payment_ended_at?: string | null;
  };
  member: { email: string; role: string };
  today: Day;
  data: OverviewData;
  /** T7 part 3b: the answer text of each prompt on each engine at today's check, keyed "promptId engine" (docs/parity/T7/add-texts.py). */
  texts: Record<string, string>;
  /** The check `texts` are from when it is not today's: the failed state's last good day (8 Oct 2026, audit data-3). */
  textsOn?: Day;
  /** T7 part 4a: notes on prompts, as the board's "Notes on this cluster" draws them. */
  clusterNotes: ClusterNote[];
  /** T13 (R97 part 3): placements on cluster c1, after boards-3/Placements.dc.html (docs/parity/T13/add-placements.py). */
  placements: FixturePlacement[];
  /** R142 (BRIEF-4 P2): the names we match, and the team - owner, editor, viewer and one removed. */
  aliases: string[];
  members: FixtureMember[];
  /** R180: the newest order's typed keyword and scan, as orders stores them; only the signup-typed state has one. */
  order?: OrderPick | null;
  /** AG-1 (9 Oct 2026): the account's other clients, beside `client`; only the two-clients state has one. They have no readings. */
  others?: Fixture["client"][];
  /**
   * AG-1 review (9 Oct 2026): false is production between the deploy and
   * 20261009010000 being applied (TRACKING_FIXTURE_SCOPING=0) - the scope
   * table is not there, so nobody is limited and no invite can be to one
   * client. Absent is the table being there.
   */
  scoping?: false;
  /**
   * 13 Oct 2026, DIY P2: the account's upsell_mode, as upgradeContext reads it
   * (repo.ts). Absent is nomada; only the placed-agency state sets agency.
   */
  mode?: UpsellMode;
};

/**
 * A prompt row as the fixture can hold it (13 Oct 2026, DIY P2): the overview's
 * columns, plus the origin columns tracked_questions has from 20261013010000.
 * Only the placed states' placement prompts carry them; every other fixture
 * prompt's origin is in src/lib/diy/fixtures/origins.json, because fixture.json
 * is never edited. loadPromptOrigins reads both.
 */
export type FixtureQuestion = OverviewData["questions"][number] & { source?: string; origin_kind?: string | null; origin_ref?: string | null; allowance?: string | null };

/** Whether a fixture prompt is in the placement allowance, outside the angle slots (limits.ts, DIY P2). */
export const placementAllowance = (q: object): boolean => (q as FixtureQuestion).allowance === "placement";

/** `clients` (AG-1, 9 Oct 2026): the client ids a member is limited to, as dashboard_member_clients lists them; absent is every client. */
export type FixtureMember = { email: string; name: string | null; role: string; last_login_at: string | null; removed_at?: string | null; clients?: string[] };

/** A placement as fixture.json stores it; url_key is computed on read, as the admin writer computes it. */
export type FixturePlacement = Omit<PlacementRow, "url_key"> & { cluster_id: string };

/**
 * R164 (1 Oct 2026): `TRACKING_FIXTURE_SESSION=none` is the signed-out
 * visitor, so e2e can follow a bookmark through the login page.
 */
export function fixtureSignedOut(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRACKING_FIXTURE_SESSION === "none";
}

/**
 * R151 (1 Oct 2026): `TRACKING_FIXTURE_STATE=unreadable` makes the fixture's
 * overview read throw, as overview-data.ts throws when Supabase refuses a
 * read, so the /app error boundary can be swept without breaking a database.
 */
/**
 * R166 part 3b (1 Oct 2026): the signup state is the webhook's fresh client,
 * so its setup is still to do; every other state is a client already set up.
 */
export function fixtureSetupConfirmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRACKING_FIXTURE_STATE !== "signup" && env.TRACKING_FIXTURE_STATE !== "signup-typed";
}

export function fixtureUnreadable(env: Record<string, string | undefined> = process.env): void {
  if (env.TRACKING_FIXTURE_STATE === "unreadable") throw new Error("could not read the runs: fixture state unreadable");
}

/**
 * R138 (30 Sep 2026): `TRACKING_FIXTURE_STATE=ungrouped` serves the same
 * client with no cluster rows and no prompt in a cluster - the Overview's
 * "Ungrouped prompts" state. Placements hang off clusters, so they go too.
 */
/**
 * DS19 (2 Oct 2026): `TRACKING_FIXTURE_STATE=uncited` keeps every reading but
 * no answer cites a page - an engine answering without linking anything - so
 * the Overview's empty "Pages the engines cite most" card can be swept.
 */
/**
 * DS44 (2 Oct 2026, R173 pass 5): `TRACKING_FIXTURE_STATE=long` keeps every
 * reading and adds rivals, cited pages and placements past ten of each, so the
 * benchmark "lists over 10 rows have search/sort/filter with counts" can be
 * swept - the default names 5 brands, cites 6 pages and has 6 placements.
 */
/**
 * Every TRACKING_FIXTURE_STATE, unset being `default`. Anything else serves the default.
 *
 * 13 Oct 2026, DIY P2 (spec 10 section 7.0 item 6): `placed` and
 * `placed-agency` added. The tier and the mode are tracking-fixture facts, so
 * the placed states are here, not in DIY_FIXTURE_STATE: `placed` is the client
 * on alwaysmentioned with three placement prompts on c1 (placedState), and
 * `placed-agency` is the same on an agency-mode account, so no page may name
 * Nomada.
 */
export const FIXTURE_STATES = ["default", "signup", "signup-typed", "new", "young", "partial", "failed", "unreadable", "stopped", "ungrouped", "pilot-mixed", "uncited", "long", "trial", "trial-ending", "trial-cancelled", "ended", "brands-unread", "two-clients", "past-due", "unpaid", "placed", "placed-agency"] as const;

/**
 * The placed states' placement prompts (13 Oct 2026, DIY P2): each one the
 * title rule's prompt from a made-up title of a fixture placement on c1
 * (fixture-mode.test.mts holds each text equal to promptFromTitle of its
 * title). The first two were added the morning after their placement went
 * live and have been read since; the third is a link insertion the admin
 * ticked and retried after the switch went on, so it is first asked tomorrow
 * (spec 6.7: earlier live placements get their prompt through the retry, one
 * at a time). `like` is the c1 prompt whose readings each one's copy, so the
 * fixture stays one made-up world.
 */
export const PLACED_PROMPTS = [
  { id: "q1-pl1", placement: "p1", like: "q1-2", title: "The 12 Best Accounting Apps for Small Businesses in 2026 | The Small Biz Stack", text: "best accounting apps for small businesses" },
  { id: "q1-pl2", placement: "p4", like: "q1-4", title: "Best Bookkeeping Tools for Freelancers: Our Top Picks - Freelance Field Notes", text: "best bookkeeping tools for freelancers" },
  { id: "q1-pl3", placement: "p3", like: null, title: "The Best Accounting Software to Switch To in 2026 - Owner Ledger", text: "best accounting software to switch to" },
] as const;

/** The placement prompt switch on the fixture: on in the placed states, which carry placement prompts; off in every other. */
export function fixturePlacementPromptsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRACKING_FIXTURE_STATE === "placed" || env.TRACKING_FIXTURE_STATE === "placed-agency";
}

/**
 * `placed` and `placed-agency` (13 Oct 2026, DIY P2). The tier is mentioned,
 * which reads five engines, so every answer the fixture has on Perplexity is
 * also given to Claude, words and all: fixture.json predates the fifth engine
 * and is never edited. Then the three placement prompts on c1, outside its
 * five angle slots, each with allowance 'placement', source nomada and its
 * placement's id as origin_ref, as addPlacementPrompt writes them.
 */
function placedState(f: Fixture, agency: boolean): Fixture {
  const tomorrow = addDays(f.today, 1);
  const withClaude = (answers: OverviewData["answers"]) => [...answers, ...answers.filter((a) => a.engine === "perplexity").map((a) => ({ ...a, engine: "claude" }))];
  const rows: FixtureQuestion[] = [];
  const answers: OverviewData["answers"] = [];
  const texts: Record<string, string> = {};
  for (const p of PLACED_PROMPTS) {
    const placement = f.placements.find((x) => x.id === p.placement);
    const added = p.like && placement?.live_on ? addDays(placement.live_on, 1) : tomorrow;
    rows.push({ id: p.id, text: p.text, added_on: added, stopped_on: null, cluster_id: "c1", angle: null, source: "nomada", origin_kind: "placement", origin_ref: p.placement, allowance: "placement" });
    if (!p.like) continue;
    answers.push(...f.data.answers.filter((a) => a.question_id === p.like && a.run_date >= added).map((a) => ({ ...a, question_id: p.id })));
    for (const [k, v] of Object.entries(f.texts)) if (k.startsWith(`${p.like} `)) texts[k.replace(`${p.like} `, `${p.id} `)] = v;
  }
  const all = { ...f.texts, ...texts };
  const claude = Object.fromEntries(Object.entries(all).flatMap(([k, v]) => (k.endsWith(" perplexity") ? [[k.replace(/ perplexity$/, " claude"), v]] : [])));
  return {
    ...f,
    client: { ...f.client, tier: "mentioned" },
    ...(agency ? { mode: "agency" as const } : {}),
    texts: { ...all, ...claude },
    data: { ...f.data, questions: [...f.data.questions, ...rows], answers: withClaude([...f.data.answers, ...answers]) },
  };
}

/**
 * AG-1 (audit security-2, 9 Oct 2026; also what M7's Home needs): an account
 * with two clients. `TRACKING_FIXTURE_STATE=two-clients` adds Ledgerline, a
 * made-up UK client on the same account with no readings, and two members
 * limited to one client each: lead@example.com, a viewer who sees Tallyroo
 * only (`TRACKING_FIXTURE_ROLE=scoped` signs in as them), and
 * books@example.com, an editor who sees Ledgerline only. The owner, editor
 * and viewer see both.
 */
export const FIXTURE_SECOND_CLIENT = { id: "fixture-2", slug: "ledgerline", brand: "Ledgerline", domain: "ledgerline.example", market: "UK", tier: "tracked" } as const;

function twoClients(f: Fixture): Fixture {
  const second = { ...f.client, ...FIXTURE_SECOND_CLIENT };
  const scoped: FixtureMember[] = [
    { email: "lead@example.com", name: null, role: "viewer", last_login_at: null, clients: [f.client.id] },
    { email: "books@example.com", name: null, role: "editor", last_login_at: null, clients: [second.id] },
  ];
  return { ...f, others: [second], members: [...f.members, ...scoped] };
}

/**
 * AG-1 review (9 Oct 2026): `TRACKING_FIXTURE_SCOPING=0` is the deploy landing
 * before its migration. With no scope table nobody is limited - readScopes
 * answers no rows - so every member's list goes, and Settings offers an
 * invite to every client only. Applied after the role, so `scoped` still
 * signs in as lead@, who then sees both clients, as they would.
 */
function beforeScoping(f: Fixture): Fixture {
  const unlimited = (m: FixtureMember): FixtureMember => {
    const out = { ...m };
    delete out.clients;
    return out;
  };
  return { ...f, scoping: false, members: f.members.map(unlimited) };
}

/** Every client on the fixture's account, the main one first, as clientsFor orders them (oldest first). */
export function fixtureAccount(f: Fixture): Fixture["client"][] {
  return [f.client, ...(f.others ?? [])];
}

/**
 * Settings' read on the fixture, as loadSettings answers it: removed members
 * stay in the file, as the table keeps them, and are skipped as every read
 * skips them; so is a member limited to the account's other clients (AG-1).
 */
export function fixtureSettings(f: Fixture, clientId: string): SettingsData {
  const account = fixtureAccount(f);
  const scoping = f.scoping !== false;
  if (!account.some((c) => c.id === clientId)) return { aliases: [], members: [], accountClients: 1, scoping };
  return {
    accountClients: account.length,
    scoping,
    aliases: clientId === f.client.id ? f.aliases : [],
    members: f.members
      .filter((m) => !m.removed_at && sees(m.clients, clientId))
      .map((m) => ({ email: m.email, name: m.name, role: m.role, last_login_at: m.last_login_at, clients: m.clients?.length ?? null })),
  };
}

/** The clients this email sees on the fixture, with its role: none unless it is the live session, and only its scope's when it has one. */
export function fixtureClients(f: Fixture, email: string): (Fixture["client"] & { role: string })[] {
  if (!fixtureLive(f, email)) return [];
  const scope = f.members.find((m) => m.email === email && !m.removed_at)?.clients;
  return fixtureAccount(f)
    .filter((c) => sees(scope, c.id))
    .map((c) => ({ ...c, role: f.member.role }));
}

/**
 * The alwaystracked trial and its end (8 Oct 2026, audit activation-14): the
 * trial UI went live with no state that drew it. `trial` ends in 9 days,
 * `trial-ending` in 2, `trial-cancelled` in 9 with the owner's cancel stamped
 * yesterday, and `ended` is a client whose subscription has gone (status
 * ended, as onSubscriptionDeleted leaves it). The trial end is real time, not
 * the fixture's day, because the dashboard compares it with the clock.
 */
function trialState(f: Fixture, state: string, now: number): Fixture {
  const at = (days: number) => new Date(Math.floor((now + days * 86_400_000) / 60_000) * 60_000).toISOString();
  if (state === "ended") return { ...f, client: { ...f.client, status: "ended" } };
  const ends = at(state === "trial-ending" ? 2 : 9);
  return { ...f, client: { ...f.client, trial_ends_at: ends, trial_cancelled_at: state === "trial-cancelled" ? at(-1) : null } };
}

/**
 * BL-2 (9 Oct 2026): a failed payment, as the Stripe webhook records it
 * (lib/checkout/payment.ts). `past-due` is the first failure: Stripe tries
 * the card again in three days, and the invoice has its own page - a made-up
 * URL of Stripe's shape, which goes nowhere. `unpaid` is the end of the
 * retries: the client ended yesterday because Stripe stopped charging. The
 * times are real time, as the trial's are, because the banner compares them
 * with the clock.
 */
export const FIXTURE_INVOICE_URL = "https://invoice.stripe.com/i/acct_fixture/test_fixture_invoice";

function paymentState(f: Fixture, state: "past-due" | "unpaid", now: number): Fixture {
  const at = (days: number) => new Date(Math.floor((now + days * 86_400_000) / 60_000) * 60_000).toISOString();
  if (state === "unpaid") return { ...f, client: { ...f.client, status: "ended", payment_status: "unpaid", payment_retry_at: null, payment_invoice_url: FIXTURE_INVOICE_URL, payment_ended_at: at(-1) } };
  return { ...f, client: { ...f.client, payment_status: "past_due", payment_retry_at: at(3), payment_invoice_url: FIXTURE_INVOICE_URL, payment_ended_at: null } };
}

const LONG_RIVALS = 18;
const LONG_PAGES = 16;
const LONG_PLACEMENTS = 12;

function longLists(f: Fixture): Fixture {
  const kinds = ["guest_post", "link_insertion", "on_site"] as const;
  const extra: FixturePlacement[] = Array.from({ length: LONG_PLACEMENTS }, (_, i) => ({
    id: `pl${i + 1}`,
    cluster_id: "c1",
    kind: kinds[i % kinds.length]!,
    url: `https://trade-site-${i + 1}.example/accounting-apps-${i + 1}`,
    status: "live",
    scheduled_on: null,
    live_on: addDays(f.today, -(i * 3 + 2)),
  }));
  return {
    ...f,
    placements: [...f.placements, ...extra],
    data: {
      ...f.data,
      answers: f.data.answers.map((a, i) =>
        a.answered
          ? {
              ...a,
              brands: [...a.brands, `Rival ${String((i % LONG_RIVALS) + 1).padStart(2, "0")}`],
              citations: [...a.citations, { source_domain: `rival-guide-${(i % LONG_PAGES) + 1}.example`, url: `https://rival-guide-${(i % LONG_PAGES) + 1}.example/best-apps` }],
            }
          : a,
      ),
    },
  };
}

/**
 * R180 (2 Oct 2026): `signup-typed` is the webhook's client from an order with
 * no scan behind it (signup.ts clientFromOrder): one "Needs a keyword" cluster,
 * no prompts, and the keyword the buyer typed at checkout kept on the order.
 */
export const FIXTURE_ORDER_KEYWORD = "invoicing app for freelancers";

export function fixtureState(f: Fixture, env: Record<string, string | undefined> = process.env): Fixture {
  // two-clients first: its limited members are who TRACKING_FIXTURE_ROLE=scoped signs in as.
  const who = fixtureAs(env.TRACKING_FIXTURE_STATE === "two-clients" ? twoClients(f) : f, env);
  const as = env.TRACKING_FIXTURE_SCOPING === "0" ? beforeScoping(who) : who;
  if (env.TRACKING_FIXTURE_STATE === "pilot-mixed") return pilotMixed(as);
  if (env.TRACKING_FIXTURE_STATE === "new") return dayZero(as);
  if (env.TRACKING_FIXTURE_STATE === "young") return young(as);
  if (env.TRACKING_FIXTURE_STATE === "signup") return signupNoKeyword(dayZero(as));
  if (env.TRACKING_FIXTURE_STATE === "signup-typed") {
    const s = signupNoKeyword(dayZero(as));
    return { ...s, order: { keyword: FIXTURE_ORDER_KEYWORD, scan_token: null }, data: { ...s.data, questions: [] } };
  }
  if (env.TRACKING_FIXTURE_STATE === "partial") return failedReads(as, "partial");
  if (env.TRACKING_FIXTURE_STATE === "failed") return failedReads(as, "failed");
  if (env.TRACKING_FIXTURE_STATE === "stopped") return stoppedPrompt(as);
  if (env.TRACKING_FIXTURE_STATE === "uncited") return { ...as, data: { ...as.data, answers: as.data.answers.map((a) => ({ ...a, citations: [] })) } };
  if (env.TRACKING_FIXTURE_STATE === "long") return longLists(as);
  if (env.TRACKING_FIXTURE_STATE === "brands-unread") return brandsUnread(as);
  if (env.TRACKING_FIXTURE_STATE === "placed" || env.TRACKING_FIXTURE_STATE === "placed-agency") return placedState(as, env.TRACKING_FIXTURE_STATE === "placed-agency");
  const st = env.TRACKING_FIXTURE_STATE ?? "";
  if (st === "trial" || st === "trial-ending" || st === "trial-cancelled" || st === "ended") return trialState(as, st, Date.now());
  if (st === "past-due" || st === "unpaid") return paymentState(as, st, Date.now());
  if (env.TRACKING_FIXTURE_STATE !== "ungrouped") return as;
  return { ...as, placements: [], data: { ...as.data, clusters: [], questions: as.data.questions.map((q) => ({ ...q, cluster_id: null })) } };
}

/**
 * R148 pass 7 (1 Oct 2026): `TRACKING_FIXTURE_STATE=new` is the first
 * dashboard view after checkout - the money path's last step. Signup starts
 * tracking tomorrow, so every live cluster, prompt and keyword begins then,
 * stopped rows are gone, and nothing has been read: no answers, no SERP, no
 * run, no notes, no placements.
 */
function dayZero(f: Fixture): Fixture {
  const tomorrow = addDays(f.today, 1);
  const live = <T extends { stopped_on: Day | null }>(rows: T[]) => rows.filter((r) => r.stopped_on === null);
  return {
    ...f,
    client: { ...f.client, started_on: tomorrow },
    texts: {},
    clusterNotes: [],
    placements: [],
    data: {
      clusters: live(f.data.clusters).map((c) => ({ ...c, started_on: tomorrow })),
      questions: live(f.data.questions).map((q) => ({ ...q, added_on: tomorrow })),
      keywords: live(f.data.keywords).map((k) => ({ ...k, added_on: tomorrow })),
      answers: [],
      serp: [],
      lastRun: null,
      runs: [],
      notes: [],
    },
  };
}

/**
 * 8 Oct 2026 (audit data-10): `TRACKING_FIXTURE_STATE=young` is a client
 * that began tracking nine days ago - inside the 14-day trial - with every
 * day since read, ten checks.
 * The previous period reaches back before tracking began, so its changes are
 * against its first week. Everything live began on its start day (or later),
 * nothing stopped earlier is kept, and only readings from that day on remain.
 */
export const YOUNG_DAYS = 9;

function young(f: Fixture): Fixture {
  const start = addDays(f.today, -YOUNG_DAYS);
  const kept = <T extends { stopped_on: Day | null }>(rows: T[]) => rows.filter((r) => r.stopped_on === null || r.stopped_on > start);
  const from = (d: Day) => (d < start ? start : d);
  return {
    ...f,
    client: { ...f.client, started_on: start },
    clusterNotes: f.clusterNotes.filter((n) => n.note_date >= start),
    placements: f.placements.filter((p) => !p.live_on || p.live_on >= start),
    data: {
      ...f.data,
      clusters: kept(f.data.clusters).map((c) => ({ ...c, started_on: from(c.started_on) })),
      questions: kept(f.data.questions).map((q) => ({ ...q, added_on: from(q.added_on) })),
      keywords: kept(f.data.keywords).map((k) => ({ ...k, added_on: from(k.added_on) })),
      answers: f.data.answers.filter((a) => a.run_date >= start),
      serp: f.data.serp.filter((x) => x.run_date >= start),
      runs: f.data.runs?.filter((r) => r.run_date >= start),
      notes: f.data.notes.filter((n) => n.note_date >= start),
    },
  };
}

/**
 * R148 pass 10 (1 Oct 2026): `TRACKING_FIXTURE_STATE=signup` is day zero as
 * the webhook really builds it from a scan that chose no keyword (signup.ts):
 * one cluster named "Needs a keyword" with no keyword and the scan's prompts
 * (PROMPTS_PER_CLUSTER), nothing else.
 */
function signupNoKeyword(f: Fixture): Fixture {
  const first = f.data.clusters[0]!;
  return {
    ...f,
    data: {
      ...f.data,
      // signup.ts's NEEDS_A_KEYWORD; a literal because that file resolves "@/" imports (the test holds them equal).
      clusters: [{ ...first, name: "Needs a keyword", keyword_id: null }],
      questions: f.data.questions.filter((q) => q.cluster_id === first.id).slice(0, PROMPTS_PER_CLUSTER),
      keywords: [],
    },
  };
}

/**
 * R169 (Danny, 2 Oct 2026, danny.md line 179): `TRACKING_FIXTURE_STATE=pilot-mixed`
 * is a pilot as they really stand - prompts from the scan tracked ungrouped
 * for weeks, and one cluster just added and not yet read. The first cluster is
 * pending (its prompts and keyword start tomorrow, no readings); the second
 * cluster's five prompts are ungrouped and keep their readings, four of them
 * rewritten to name the brand (branded is the client's choice, danny.md line
 * 118) and named on every engine that answered, as a branded prompt nearly
 * always is. Nothing else: other clusters, keywords, notes, placements go.
 */
export const PILOT_BRANDED = (brand: string) => [
  `Is ${brand} worth it for freelancers?`,
  `Does ${brand} handle sales tax for small businesses?`,
  `What do accountants think of ${brand}?`,
  `Is ${brand} or a spreadsheet better for invoicing?`,
];

function pilotMixed(f: Fixture): Fixture {
  const [pending, read] = f.data.clusters.filter((c) => c.stopped_on === null);
  const tomorrow = addDays(f.today, 1);
  const live = f.data.questions.filter((q) => q.stopped_on === null);
  const drafts = live.filter((q) => q.cluster_id === pending!.id).slice(0, PROMPTS_PER_CLUSTER);
  const ungrouped = live.filter((q) => q.cluster_id === read!.id).slice(0, PROMPTS_PER_CLUSTER);
  const branded = PILOT_BRANDED(f.client.brand);
  const text = new Map(ungrouped.slice(0, branded.length).map((q, i) => [q.id, branded[i]!]));
  const draftIds = new Set(drafts.map((q) => q.id));
  const keep = new Set(ungrouped.map((q) => q.id));
  return {
    ...f,
    placements: [],
    clusterNotes: [],
    texts: Object.fromEntries(Object.entries(f.texts).filter(([k]) => { const id = k.split(" ")[0]!; return keep.has(id) && !text.has(id); })),
    data: {
      ...f.data,
      clusters: [{ ...pending!, started_on: tomorrow }],
      keywords: f.data.keywords.filter((k) => k.id === pending!.keyword_id).map((k) => ({ ...k, added_on: tomorrow })),
      questions: [
        ...drafts.map((q) => ({ ...q, added_on: tomorrow })),
        ...ungrouped.map((q) => ({ ...q, cluster_id: null, text: text.get(q.id) ?? q.text })),
      ],
      answers: f.data.answers
        .filter((a) => keep.has(a.question_id) && !draftIds.has(a.question_id))
        .map((a) => (text.has(a.question_id) && a.answered ? { ...a, named: true } : a)),
      // The one keyword left is the pending cluster's, so nothing has ranked it yet.
      serp: [],
      notes: [],
    },
  };
}

/**
 * R151 (1 Oct 2026): `TRACKING_FIXTURE_STATE=stopped` is the first cluster
 * with its first prompt stopped today, as admin-edit.ts and the owner's Stop
 * write it (stopped_on tomorrow, so today's check still reads it). Its slot is
 * free at once, so Clusters draws "Track this prompt" there - the one posted
 * form no other state reaches.
 */
function stoppedPrompt(f: Fixture): Fixture {
  const first = f.data.clusters[0]!;
  const id = f.data.questions.find((q) => q.cluster_id === first.id && q.stopped_on === null)?.id;
  const tomorrow = addDays(f.today, 1);
  return { ...f, data: { ...f.data, questions: f.data.questions.map((q) => (q.id === id ? { ...q, stopped_on: tomorrow } : q)) } };
}

/**
 * R151 (1 Oct 2026): the error states of a daily check, as the runner records
 * them (decide.ts runOutcome). `partial` is today's run with every Google AI
 * Overview read failed - how both pilots' first real runs came back on 30 Sep -
 * so those rows are answered=false with nothing named or cited, and the run is
 * `partial`. `failed` is a run where no read landed: every row today is
 * unanswered, and since overview-data.ts reads only complete or partial runs,
 * the last check shown is the day before's.
 *
 * 8 Oct 2026 (audit data-3 / reliability-3): each state now has its run rows
 * as the runner leaves them, error line included. `partial` also loses the
 * Google AI Overview reads of one earlier day in the range
 * (PARTIAL_EARLIER_DAYS back), so the range note's list is swept; `failed`'s
 * today is a failed run, and its last good day carries the answer words
 * (textsOn) - that day's verdicts are the default's today's, so the words and
 * the verdicts agree.
 */
const FAILED_ENGINE = "google_aio";
export const PARTIAL_EARLIER_DAYS = 9;

function failedReads(f: Fixture, outcome: "partial" | "failed"): Fixture {
  const yesterday = addDays(f.today, -1);
  const earlier = addDays(f.today, -PARTIAL_EARLIER_DAYS);
  const lostDays = outcome === "partial" ? [f.today, earlier] : [f.today];
  const hit = (a: OverviewData["answers"][number]) => lostDays.includes(a.run_date) && (outcome === "failed" || a.engine === FAILED_ENGINE);
  const lastRun = outcome === "partial" ? { run_date: f.today, status: "partial", finished_at: `${f.today}T06:10:00Z` } : { run_date: yesterday, status: "complete", finished_at: `${yesterday}T06:10:00Z` };
  const texts = Object.fromEntries(Object.entries(f.texts).filter(([k]) => outcome === "failed" || !k.endsWith(` ${FAILED_ENGINE}`)));
  // failed: yesterday reads what the default reads today, so the words kept for it match its verdicts.
  const todays = new Map(f.data.answers.filter((a) => a.run_date === f.today).map((a) => [`${a.question_id} ${a.engine}`, a]));
  const moved = (a: OverviewData["answers"][number]) => {
    const t = outcome === "failed" && a.run_date === yesterday ? todays.get(`${a.question_id} ${a.engine}`) : undefined;
    return t ? { ...t, run_date: yesterday } : a;
  };
  const answers = f.data.answers.map(moved).map((a) => (hit(a) ? { ...a, answered: false, named: false, brands: [], citations: [] } : a));
  const reads = (day: Day) => f.data.answers.filter((a) => a.run_date === day).length;
  const lost = (day: Day) => answers.filter((a) => a.run_date === day && !a.answered).length;
  const error = (day: Day) => `${lost(day)} of ${reads(day)} reads failed - ${FAILED_ENGINE}: ${lost(day)} x HTTP 500`;
  const runs = (f.data.runs ?? []).map((r) => (lostDays.includes(r.run_date) ? { ...r, status: outcome, error: error(r.run_date) } : r));
  return {
    ...f,
    texts,
    textsOn: outcome === "failed" ? yesterday : undefined,
    data: { ...f.data, lastRun, runs, answers },
  };
}

/**
 * 8 Oct 2026 (audit reliability-1 / data-6): `TRACKING_FIXTURE_STATE=brands-unread`
 * is today's run with ChatGPT's brand extraction failed, as the runner now
 * records it. Every read landed, so today's ChatGPT answers keep their words,
 * named flag and citations, but are stored brands_ok=false with no other
 * brands; the run is partial with only a brand gap on its error line.
 */
const UNREAD_ENGINE = "chatgpt";

function brandsUnread(f: Fixture): Fixture {
  const hit = (a: OverviewData["answers"][number]) => a.run_date === f.today && a.engine === UNREAD_ENGINE && a.answered;
  const n = f.data.answers.filter(hit).length;
  const reads = f.data.answers.filter((a) => a.run_date === f.today).length;
  const error = failureSummary(reads, [], [{ engine: UNREAD_ENGINE, unread: n, answered: n, reason: "language model error 529: Overloaded" }]);
  const lastRun = { run_date: f.today, status: "partial", finished_at: `${f.today}T06:10:00Z`, error };
  // Merge of audit packages A and B (8 Oct 2026): today's run row says the same as lastRun, as tracking_runs would.
  const runs = f.data.runs?.map((r) => (r.run_date === f.today ? { ...r, status: "partial", error } : r));
  return { ...f, data: { ...f.data, lastRun, runs, answers: f.data.answers.map((a) => (hit(a) ? { ...a, brands: [], brands_ok: false } : a)) } };
}

/**
 * R146 (1 Oct 2026, BRIEF-4 P6): `TRACKING_FIXTURE_ROLE=editor|viewer|removed`
 * signs the fixture session in as that member of the team, so the role
 * journeys run on the real pages. `removed` is the removed member, whom
 * fixtureLive refuses, so every client page 404s for them. `scoped` (AG-1,
 * 9 Oct 2026) is the first live member limited to some clients, which only
 * the two-clients state has. Unset is the owner; anything else throws rather
 * than silently running as the owner.
 */
function fixtureAs(f: Fixture, env: Record<string, string | undefined>): Fixture {
  const want = env.TRACKING_FIXTURE_ROLE;
  if (!want || want === "owner") return f;
  const m =
    want === "removed"
      ? f.members.find((x) => x.removed_at)
      : want === "scoped"
        ? f.members.find((x) => x.clients?.length && !x.removed_at)
        : want === "editor" || want === "viewer"
          ? f.members.find((x) => x.role === want && !x.removed_at && !x.clients)
          : undefined;
  if (!m) throw new Error(`TRACKING_FIXTURE_ROLE=${want}: the fixture has no such member (owner, editor, viewer, scoped or removed)`);
  return { ...f, member: { email: m.email, role: m.role } };
}

/** Whether this email is a live member of the fixture's team. */
export function fixtureLive(f: Fixture, email: string): boolean {
  return email === f.member.email && f.members.some((m) => m.email === email && !m.removed_at);
}

type RawAnswer = [Day, string, string, 0 | 1, string[], string[]];

/** The committed file stores answers as tuples to stay small; this restores the rows the overview reads. */
export function expandFixture(raw: {
  client: Omit<Fixture["client"], "id">;
  member: Fixture["member"];
  today: Day;
  data: Omit<OverviewData, "answers"> & { answers: RawAnswer[] };
  texts?: Record<string, string>;
  clusterNotes?: ClusterNote[];
  placements?: FixturePlacement[];
  aliases?: string[];
  members?: FixtureMember[];
}): Fixture {
  const subject = subjectKeys(raw.client.brand, raw.client.domain);
  // 8 Oct 2026 (audit data-3): one complete run per day read, newest first, as tracking_runs holds them; the states break some.
  const runDays = [...new Set(raw.data.answers.map(([d]) => d))].sort().reverse();
  return {
    client: { ...raw.client, id: "fixture" },
    member: raw.member,
    today: raw.today,
    texts: raw.texts ?? {},
    clusterNotes: raw.clusterNotes ?? [],
    placements: raw.placements ?? [],
    aliases: raw.aliases ?? [],
    members: raw.members ?? [{ ...raw.member, name: null, last_login_at: null }],
    data: {
      ...raw.data,
      runs: raw.data.runs ?? runDays.map((run_date) => ({ run_date, status: "complete", error: null })),
      answers: raw.data.answers.map(([run_date, question_id, engine, named, brands, urls]) => ({
        run_date,
        question_id,
        engine,
        answered: true,
        named: named === 1,
        // R143 (1 Oct 2026): the runner never stores the client among the
        // other brands (runner.ts drops every subjectKeys spelling), but the
        // dataset lists Tallyroo there whenever it is named, which counted
        // the client twice on Who is named. Restored as the runner writes it.
        brands: brands.filter((b) => !subject.has(brandKey(b))),
        citations: urls.map((url) => ({ source_domain: new URL(url).hostname, url })),
      })),
    },
  };
}
