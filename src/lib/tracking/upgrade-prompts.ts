import type { TierKey } from "../tier-text.ts";

import type { UpsellMode } from "./ask.ts";

/**
 * The upgrade prompts' rules (BRIEF-2 T11 as amended by BRIEF-3, 30 Sep 2026;
 * boards-3/CTAs.dc.html). Pure and unwired: the screens gather the facts, this
 * decides which one prompt, if any, a screen draws, and writes its words.
 *
 * - At most one prompt per screen; the highest tier gap wins.
 * - None in a client's first 14 days, or on an empty, error or partial state.
 * - Never for a tier already held.
 * - None when `upsell_mode = 'off'`; in `agency` mode no tier name is written
 *   and there is no tier-page button, only the ask (which goes to the agency).
 * - Hidden stays hidden for 30 days for that member (`cta_events` `hidden`).
 *
 * The unit is a cluster (BRIEF-3 T11): `tier` is the tier of the cluster the
 * screen is about, or the client's when the screen is the whole client.
 */

export type PromptCta = "mentioned" | "cited" | "everywhere" | "pack" | "cluster";
/** "dark" (13 Oct 2026, DIY P4): a section that exists only for a paid read that is switched off draws no prompt (spec 10 section 2.7). */
export type ScreenState = "ok" | "empty" | "error" | "partial" | "dark";

export const QUIET_DAYS = 14;
export const HIDE_DAYS = 30;

/** Thresholds, as the brief's table. */
export const NEVER_NAMED_MIN = 3;
export const OFF_PAGE_ONE_MIN = 2;
export const TRADE_CITATIONS_MIN = 10;
export const TRADE_CITATIONS_RATIO = 5;

/**
 * alwaysmentioned's placements, as pricing.ts's own include line says it
 * ("3 placements a month on one topic"). Typed here because pricing.ts cannot
 * load under node --test; upgrade-prompts.test.mts pins the two together.
 */
export const MENTIONED_PLACEMENTS = "3 placements a month";

/**
 * The DIY upgrade rows (13 Oct 2026, DIY P4; spec 10 section 2.7). U1 and U2
 * are the T11 prompts above (never named; just off page 1). U3-U8 are built
 * here as rules and words in wave 1 and drawn by the pages that gather their
 * facts, in their own waves. Each sells an existing `cta`; the T11 mechanics
 * - one per screen, the highest tier gap winning, the 14-day quiet, hide for
 * 30 days, none for a tier held, agency and off - are pickPrompt's, unchanged.
 */
export type UpgradeRow = "U1" | "U2" | "U3" | "U4" | "U5" | "U6" | "U7" | "U8";
export const ROW_CTA: Record<UpgradeRow, PromptCta> = { U1: "mentioned", U2: "cited", U3: "mentioned", U4: "mentioned", U5: "cited", U6: "cited", U7: "pack", U8: "mentioned" };
/** Within one cta, the row drawn when more than one holds: U8 then U3 on Opportunities (section 2.7); each other screen gathers one row's facts. */
export const ROW_ORDER: readonly UpgradeRow[] = ["U8", "U3", "U4", "U1", "U5", "U6", "U2", "U7"];

/** U3: a page naming at least this many competitors and not the client. */
export const LEAVES_OUT_MIN = 2;
/** U3: or a cluster with at least this many open opportunities. */
export const CLUSTER_OPEN_MIN = 3;
/** U4: opportunity items in Doing with no status change for STALLED_DAYS or more. */
export const STALLED_MIN = 3;
export const STALLED_DAYS = 21;
/** U5: once this month's reveals are used, at least this many more pages counted. */
export const REVEALS_MORE_MIN = 5;
/** U6: the cluster keyword read #11-#20 on at least this many of its last FIT_READINGS readings. */
export const FIT_OFF_PAGE_ONE_MIN = 20;
export const FIT_READINGS = 28;

/**
 * The two service lines (section 2.7), never retyped: every U3-U8 body is one
 * of them, and U2's existing lead and tail share CITED_SERVICE's words. Agency
 * mode ends each "... is the next step." with no tier name.
 */
export const MENTIONED_SERVICE = {
  lead: "Getting placed in the sources the engines already cite is what ",
  tier: "mentioned",
  tail: ` does, ${MENTIONED_PLACEMENTS} per cluster.`,
  agency: "Getting placed in the sources the engines already cite is the next step.",
} as const;
export const CITED_SERVICE = {
  /** U2 adds "for them" after this, as it always has. */
  rank: "Link insertions on pages that already rank",
  work: ", plus on-site work on your own pages, ",
  /** 13 Oct 2026, DIY P4: the tail names "the alwayscited plan", the plan and not the company (CLAUDE.md; spec section 2.7). */
  lead: "is what the ",
  tier: "cited",
  tail: " plan adds to placements.",
  agency: "is the next step.",
} as const;

/** A service line as PromptCopy carries it: lead, the tier the component renders, tail; agency mode has no tier. */
export function serviceLine(which: "mentioned" | "cited", agency: boolean, before = ""): Pick<PromptCopy, "lead" | "tier" | "tail"> {
  if (which === "mentioned") return agency ? { lead: `${before}${MENTIONED_SERVICE.agency}`, tier: null, tail: "" } : { lead: `${before}${MENTIONED_SERVICE.lead}`, tier: MENTIONED_SERVICE.tier, tail: MENTIONED_SERVICE.tail };
  const head = `${before}${CITED_SERVICE.rank}${CITED_SERVICE.work}`;
  return agency ? { lead: `${head}${CITED_SERVICE.agency}`, tier: null, tail: "" } : { lead: `${head}${CITED_SERVICE.lead}`, tier: CITED_SERVICE.tier, tail: CITED_SERVICE.tail };
}

/**
 * Where a prompt was shown, for `cta_events.trigger` (section 2.7
 * "Recording": the surface and facts go in the jsonb, no DDL). Ids only: a
 * fact that is not id-shaped, or not one of the recorded keys, is dropped,
 * never stored - nothing a member typed reaches the row.
 */
export const SURFACES = ["ai", "clusters", "google", "opportunity", "opportunities", "plan", "links", "pages"] as const;
export type Surface = (typeof SURFACES)[number];
export const TRIGGER_KEYS = ["row", "route", "cluster", "items"] as const;
const TRIGGER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const readSurface = (raw: unknown): Surface | null => ((SURFACES as readonly string[]).includes(String(raw)) ? (raw as Surface) : null);

export function upgradeTrigger(surface: Surface, facts: Partial<Record<(typeof TRIGGER_KEYS)[number], string>> = {}): Record<string, string> {
  const out: Record<string, string> = { surface };
  for (const k of TRIGGER_KEYS) {
    const v = facts[k];
    if (typeof v === "string" && TRIGGER_ID.test(v)) out[k] = v;
  }
  return out;
}

const RANK: Record<TierKey, number> = { tracked: 0, mentioned: 1, cited: 2, everywhere: 3 };

export type Facts = {
  tier: TierKey;
  mode: UpsellMode;
  state: ScreenState;
  startedOn: string;
  today: string;
  /** ctas this member hid in the last HIDE_DAYS days (see hiddenCtas). */
  hidden: ReadonlySet<PromptCta>;
  /** alwaysmentioned: prompts that named the client in no answer this period. */
  neverNamed?: { prompts: number; of: number; answers: number; hosts: string[]; /** the prompts, for "Ask about these". */ ids?: string[] };
  /** alwayscited: keywords at #11-#20 today. */
  offPageOne?: { keywords: number; of: number; best: number; worst: number; /** the keywords, for "Ask about these". */ ids?: string[] };
  /** alwayseverywhere: the top competitor's news/trade citations against the client's. */
  trade?: { brand: string; share: number; theirs: number; ours: number; subject: string };
  /** Tracking pack: at the prompt or keyword limit. */
  atLimit?: boolean;
  /** Second cluster: a prompt or keyword outside any cluster ranking #11-#20. */
  outsideCluster?: boolean;
  /** U3, one opportunity: the competitors the page names (not the client), its citations in `days` days, its status and its cluster's open opportunities. */
  leavesOut?: { names: string[]; answers: number; days: number; status: string; clusterOpen: number };
  /** U4, Actions: opportunity items in Doing with no status change, and the day the latest of them got there. */
  stalled?: { items: number; since: string };
  /** U5, Links: this month's page-level reveals used, of the allowance, the pages still counted, and the reset day. */
  reveals?: { used: number; of: number; more: number; resetsOn: string };
  /** U6, one page's fit: the verdict, and the cluster keyword's readings at #11-#20 of its last readings. */
  fit?: { keyword: string; fits: boolean; offPage1: number; readings: number };
  /** U7, Google and Clusters: a gaining-ground keyword waiting, all clusters in use (with atLimit), and the pack line from pricing.ts. */
  gaining?: { keyword: string; clusters: number; packLine: string };
  /** U8, Opportunities: pages in Pursuing or Pitched, and the most at once. */
  pursuits?: { active: number; cap: number };
};

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The first day a prompt may show: QUIET_DAYS after tracking began. */
export const firstPromptDay = (startedOn: string) => addDays(startedOn, QUIET_DAYS);

/** The earliest `created_at` a `hidden` row still counts from. */
export const hiddenSince = (today: string) => `${addDays(today, -HIDE_DAYS)}T00:00:00Z`;

/** DS29: the last day a prompt hidden today stays hidden - hiddenCtas still counts today's row on that day, not the next. */
export const hiddenUntil = (today: string) => addDays(today, HIDE_DAYS);

/** The ctas a member hid within HIDE_DAYS of today, from their cta_events rows. */
export function hiddenCtas(rows: { cta: string; action: string; created_at: string }[], today: string): Set<PromptCta> {
  const since = hiddenSince(today);
  const out = new Set<PromptCta>();
  for (const r of rows) if (r.action === "hidden" && r.created_at >= since && isCta(r.cta)) out.add(r.cta);
  return out;
}

const isCta = (v: string): v is PromptCta => v === "mentioned" || v === "cited" || v === "everywhere" || v === "pack" || v === "cluster";

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The DIY rows whose facts hold (U3-U8; U1 and U2 are the T11 triggers below), none for a tier held. */
export function triggeredRows(f: Facts): UpgradeRow[] {
  const r = RANK[f.tier];
  const out: UpgradeRow[] = [];
  if (r < RANK.mentioned && (f.neverNamed?.prompts ?? 0) >= NEVER_NAMED_MIN) out.push("U1");
  if (r < RANK.cited && (f.offPageOne?.keywords ?? 0) >= OFF_PAGE_ONE_MIN) out.push("U2");
  const l = f.leavesOut;
  if (r < RANK.mentioned && l && l.names.length >= LEAVES_OUT_MIN && (l.status === "pursuing" || l.status === "pitched" || l.clusterOpen >= CLUSTER_OPEN_MIN)) out.push("U3");
  if (r < RANK.mentioned && f.stalled && f.stalled.items >= STALLED_MIN && daysBetween(f.stalled.since, f.today) >= STALLED_DAYS) out.push("U4");
  if (r < RANK.cited && f.reveals && f.reveals.used >= f.reveals.of && f.reveals.more >= REVEALS_MORE_MIN) out.push("U5");
  if (r < RANK.cited && f.fit && f.fit.fits && f.fit.offPage1 >= FIT_OFF_PAGE_ONE_MIN) out.push("U6");
  if (f.atLimit && f.gaining) out.push("U7");
  if (r < RANK.mentioned && f.pursuits && f.pursuits.active >= f.pursuits.cap) out.push("U8");
  return out;
}

/** Every prompt whose trigger holds, before the one-per-screen pick. */
export function triggered(f: Facts): PromptCta[] {
  const out: PromptCta[] = [];
  const r = RANK[f.tier];
  const rows = triggeredRows(f);
  if (rows.some((row) => ROW_CTA[row] === "mentioned")) out.push("mentioned");
  if (rows.some((row) => ROW_CTA[row] === "cited")) out.push("cited");
  if (r < RANK.everywhere && f.trade && f.trade.theirs >= TRADE_CITATIONS_MIN && f.trade.theirs >= TRADE_CITATIONS_RATIO * f.trade.ours) out.push("everywhere");
  if (f.atLimit) out.push("pack");
  if ((f.tier === "mentioned" || f.tier === "cited") && f.outsideCluster) out.push("cluster");
  return out;
}

/** The tier gap a prompt closes; the pack and a second cluster change no tier. */
const gap = (cta: PromptCta, tier: TierKey) => (cta === "pack" || cta === "cluster" ? 0 : RANK[cta] - RANK[tier]);

/** The one prompt this screen draws, or null. */
export function pickPrompt(f: Facts): PromptCta | null {
  if (f.mode === "off") return null;
  if (f.state !== "ok") return null;
  if (f.today < firstPromptDay(f.startedOn)) return null;
  const live = triggered(f).filter((c) => !f.hidden.has(c));
  if (!live.length) return null;
  // Highest gap first; a tie (pack against a second cluster) goes to the pack,
  // the one the member has just run into.
  const order: PromptCta[] = ["everywhere", "cited", "mentioned", "pack", "cluster"];
  return live.sort((a, b) => gap(b, f.tier) - gap(a, f.tier) || order.indexOf(a) - order.indexOf(b))[0];
}

/** The row a cta draws on this screen: the first in ROW_ORDER whose facts hold; null for a cta no row sells (everywhere, a second cluster, a pack with no keyword waiting). */
export function rowFor(cta: PromptCta, f: Facts): UpgradeRow | null {
  const held = triggeredRows(f);
  return ROW_ORDER.find((row) => ROW_CTA[row] === cta && held.includes(row)) ?? null;
}

/** The one row this screen draws, by pickPrompt's rules: the cta it picks, then that cta's row. */
export function pickRow(f: Facts): UpgradeRow | null {
  const cta = pickPrompt(f);
  return cta ? rowFor(cta, f) : null;
}

/**
 * The prompt's words, the board's where it has them. `tier` is the tier the
 * body's last sentence names (the component renders it with TierName), null in
 * agency mode, where no Nomada tier name is written. `button` is whether the
 * tier-page button draws (never in agency mode). `ask` is the secondary
 * button's words.
 */
export type PromptCopy = { title: string; lead: string; tier: TierKey | null; tail: string; why: string; button: boolean; ask: string; dark: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function promptCopy(cta: PromptCta, f: Facts): PromptCopy | null {
  const agency = f.mode === "agency";
  // The DIY rows first, when their facts hold; with none gathered every screen reads as before.
  const row = rowFor(cta, f);
  if (row && row !== "U1" && row !== "U2") return rowCopy(row, f);
  if (cta === "mentioned" && f.neverNamed) {
    const n = f.neverNamed;
    const hosts = n.hosts.slice(0, 2);
    const from = hosts.length ? `Engines answer them from pages like ${hosts.join(" and ")}. ` : "";
    return {
      title: `${plural(n.prompts, "prompt never names", "prompts never name")} you`,
      lead: agency ? `${from}Getting placed on the pages they cite is the next step.` : `${from}Getting placed on the pages they cite is what `,
      tier: agency ? null : "mentioned",
      tail: agency ? "" : ` does, ${MENTIONED_PLACEMENTS} per cluster.`,
      why: `Shown because ${n.prompts} of your ${n.of} prompts named you in none of their ${n.answers} answers this period.`,
      button: !agency,
      ask: `Ask about these ${n.prompts}`,
      dark: false,
    };
  }
  if (cta === "cited" && f.offPageOne) {
    const k = f.offPageOne;
    const range = k.best === k.worst ? `Position ${k.best}.` : `Positions ${k.best} to ${k.worst}.`;
    // 13 Oct 2026, DIY P4: CITED_SERVICE's words with U2's own "for them", and the tail fixed to "the alwayscited plan" (spec 10 section 2.7).
    const head = `${range} ${CITED_SERVICE.rank} for them${CITED_SERVICE.work}`;
    return {
      title: `${plural(k.keywords, "keyword sits", "keywords sit")} just off page 1`,
      lead: agency ? `${head}${CITED_SERVICE.agency}` : `${head}${CITED_SERVICE.lead}`,
      tier: agency ? null : CITED_SERVICE.tier,
      tail: agency ? "" : CITED_SERVICE.tail,
      why: `Shown because ${k.keywords} of your ${k.of} cluster keywords rank #11 to #20 today.`,
      button: !agency,
      ask: `Ask about these ${k.keywords}`,
      dark: false,
    };
  }
  if (cta === "everywhere" && f.trade) {
    const t = f.trade;
    return {
      title: `${t.brand} has ${t.share}% of brand mentions`,
      lead: `Engines cite news and trade coverage of ${t.brand} ${t.theirs} times this period, and of ${t.subject} ${t.ours} ${t.ours === 1 ? "time" : "times"}. ${agency ? "Earned media across every engine is the next step." : "Earned media across every engine is "}`,
      tier: agency ? null : "everywhere",
      tail: agency ? "" : ".",
      why: "Shown because a competitor out-cites you in news and trade coverage.",
      button: !agency,
      ask: agency ? "Ask about this" : "Book a call",
      dark: true,
    };
  }
  // The pack and second-cluster prompts have no board of their own yet; the
  // Add panel's pack offer stands in for the first.
  return null;
}

const formatDay = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(day)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}`;
};
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

/**
 * The words of the DIY rows U3-U8 (section 2.7's table). Each body is a
 * service line (serviceLine), never a deliverable of its own; U6 sets one
 * sentence of its fit before it. Every prompt says why it is shown.
 */
export function rowCopy(row: UpgradeRow, f: Facts): PromptCopy | null {
  const agency = f.mode === "agency";
  const card = (title: string, body: Pick<PromptCopy, "lead" | "tier" | "tail">, why: string, ask: string): PromptCopy => ({ title, ...body, why, button: !agency && body.tier !== null, ask, dark: false });
  if (row === "U3" && f.leavesOut) {
    const l = f.leavesOut;
    const named = l.names.length > 2 ? `${l.names.slice(0, 2).join(", ")} and ${plural(l.names.length - 2, "other", "others")}` : and(l.names);
    return card("Pages like this one leave you out", serviceLine("mentioned", agency), `Shown because this page names ${named}, not you, and was cited in ${plural(l.answers, "answer", "answers")} to your prompts in the last ${l.days} days.`, "Ask about this page");
  }
  if (row === "U4" && f.stalled) {
    const s = f.stalled;
    const weeks = Math.floor(daysBetween(s.since, f.today) / 7);
    return card(`${s.items} items have been in Doing for ${plural(weeks, "week", "weeks")}`, serviceLine("mentioned", agency), `Shown because ${s.items} opportunity items have been in Doing since ${formatDay(s.since)} with no change.`, `Ask about these ${s.items}`);
  }
  if (row === "U5" && f.reveals) {
    const v = f.reveals;
    return card("This month's link targets are used", serviceLine("cited", agency), `Shown because you revealed this month's ${v.of} link targets. They reset on ${formatDay(v.resetsOn)}.`, "Ask about this");
  }
  if (row === "U6" && f.fit) {
    const k = f.fit;
    return card(`'${k.keyword}' read #11-#20 on ${k.offPage1} of its last ${k.readings} readings`, serviceLine("cited", agency, `Your page matches what Google shows for '${k.keyword}'. `), `Shown because '${k.keyword}' read #11 to #20 on ${k.offPage1} of its last ${k.readings} readings, and your page fits what Google shows for it.`, "Ask about this");
  }
  if (row === "U7" && f.gaining) {
    const g = f.gaining;
    // No price in agency mode: the pack is ours to price, and the agency's to sell.
    const lead = `'${g.keyword}' is gaining ground and all ${g.clusters} clusters are in use. ${agency ? "More clusters is the next step." : g.packLine}`;
    return { title: `All ${g.clusters} clusters are in use`, lead, tier: null, tail: "", why: `Shown because '${g.keyword}' is gaining ground and every cluster is in use.`, button: false, ask: agency ? "Ask about this" : "Ask us", dark: false };
  }
  if (row === "U8" && f.pursuits) {
    const p = f.pursuits;
    return card(`You're working ${p.active} pages at once`, serviceLine("mentioned", agency), `Shown because ${p.active} pages are in Pursuing or Pitched, the most at once.`, "Ask about these");
  }
  return null;
}
