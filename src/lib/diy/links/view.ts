import { type Day, formatDay } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import { allowanceFor, allowanceMonth } from "../core/allowances.ts";
import type { Opportunity } from "../opportunities/types.ts";
import { pursuingLine } from "../opportunities/verify.ts";

import type { Access } from "./access.ts";
import { checkLine } from "./check-link.ts";
import { basisLine } from "./comparison-set.ts";
import { gapCount, gapRead, shownGap } from "./gap.ts";
import { type Placed, excludePlacedDomains } from "./nomada-placements.ts";
import { pageKeyOf, targetCount, targetRead } from "./targets.ts";
import { type BacklinksSummary, type Bulk, type ComparisonSet, type DomainGap, ESTIMATE, type Hedge, type LinkCheck, type LinkLens, type Mentions, type NewLost, type PageGap, type Series, type Stored } from "./types.ts";

/**
 * What the Links page draws (13 Oct 2026, DIY P10; spec 10 section 4.8),
 * built from what the loaders read. Pure, so node --test holds every state.
 *
 * **Nomada's placements are subtracted here again, on every read**, from
 * every list and every count: the gap, the targets and their reveals, the
 * mentions, the week's new and lost, and the pursued wins. A placement made
 * after the night's read is therefore gone from the page the next time it
 * is opened, and nothing about it is said.
 *
 * **Each section stands on its own read** (13 Oct 2026, review of DIY P10:
 * the whole page was one read of fourteen, so one failure - the new tables
 * not there yet, the placements unreadable - hid every view, Check a link
 * and the wins with it). A read that failed is named in `unread`, and each
 * section that needs it says it could not be read (`errors`), never "none";
 * a list that needs the placements is not drawn without them. Check a link
 * needs none of these reads.
 *
 * States, in order:
 *
 * - **error**: whether DIY is on, or whether Backlinks access is active,
 *   could not be read - the paid sections say so, and nothing paid is drawn;
 * - **dark** (`diy_enabled` off): sections 1-5 are hidden - they exist only
 *   because of paid reads - and the page shows the pursued link wins, the
 *   method strip and Check a link (our own fetch, which is free);
 * - **inactive** (the latest paid Backlinks call failed with an access
 *   code): the same, under "Your link profile isn't available yet.";
 * - **not read yet**: "Your link profile is read weekly. First read <date>."
 *   - the date only when a weekly job is actually queued;
 * - **ready**: every section that has a read; each labelled "DataForSEO
 *   estimate, read <date>".
 */

/** The reads the world is made of, each of which can fail on its own. */
export const WORLD_PARTS = ["enabled", "access", "summary", "new_lost", "timeseries", "bulk", "domain_gap", "page_gap", "mentions", "set", "placed", "link_rows", "reveals", "checks", "jobs"] as const;
export type WorldPart = (typeof WORLD_PARTS)[number];

export type LinksWorld = {
  enabled: boolean;
  access: Access;
  summary: Stored<BacklinksSummary> | null;
  newLost: Stored<NewLost> | null;
  series: Stored<Series> | null;
  bulk: Stored<Bulk> | null;
  gap: Stored<DomainGap> | null;
  pages: Stored<PageGap> | null;
  mentions: Stored<Mentions> | null;
  set: ComparisonSet | null;
  placed: Placed;
  /** The client's opportunities rows in the link lenses. */
  linkRows: Opportunity[];
  /**
   * This month's reveals, counted from the table as the allowance is (spec 10
   * section 2.5, usage-meter.ts `link_targets`) - before any subtraction, so a
   * reveal whose domain later became another client's placement still counts
   * against the month (13 Oct 2026, review of DIY P10). Null when unread.
   */
  revealsThisMonth: number | null;
  checks: LinkCheck[];
  firstRead: Day | null;
  jobFailed: boolean;
  /** The reads that failed: each section needing one says it could not be read. */
  unread: ReadonlySet<WorldPart>;
  /**
   * The ids that have an opportunity page. Undefined: every row does (Supabase, where each is an opportunities
   * row). The fixture's seeded wins are not in P7's fixture world, so they draw without a link there.
   */
  opened?: ReadonlySet<string>;
};

/** The sections that can say they could not be read. */
export type LinksSection = "profile" | "weeks" | "moved" | "compare" | "gap" | "targets" | "mentions" | "wins" | "checks";

/** Which reads each section needs; the lists all need the placements, to subtract them. */
const NEEDS: Record<LinksSection, readonly WorldPart[]> = {
  profile: ["summary"],
  weeks: ["timeseries"],
  moved: ["new_lost", "placed"],
  compare: ["bulk", "set", "placed"],
  gap: ["domain_gap", "set", "placed", "link_rows"],
  targets: ["page_gap", "set", "placed", "link_rows", "reveals"],
  mentions: ["mentions", "placed", "link_rows"],
  wins: ["link_rows", "placed"],
  checks: ["checks"],
};

export type LinksState = "error" | "dark" | "inactive" | "not_read" | "ready";

export function stateOf(w: Pick<LinksWorld, "enabled" | "access" | "summary"> & { unread?: ReadonlySet<WorldPart> }): LinksState {
  if (w.unread?.has("enabled") || w.unread?.has("access")) return "error";
  if (!w.enabled) return "dark";
  if (w.access.state === "inactive") return "inactive";
  if (!w.summary && w.access.state === "not_read" && !w.unread?.has("summary")) return "not_read";
  return "ready";
}

/** "DataForSEO estimate, read 3 Nov." */
export const estimateRead = (d: Day) => `${ESTIMATE}, read ${formatDay(d)}`;

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
/** The page of the client's a link points at, in words: its path, or "your homepage". */
const pathOf = (url: string | null) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return !u.pathname || u.pathname === "/" ? "your homepage" : u.pathname;
  } catch {
    return null;
  }
};

export type ProfileView = {
  readOn: Day;
  notIndexed: boolean;
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  /** Followed and not followed (marked nofollow), as shares of the links (an estimate). Never names another attribute. */
  follow: { followed: number; notFollowed: number; of: number } | null;
};

export type WeekBar = { week: Day; newDomains: number; lostDomains: number };
export type MovedRow = { domain: string; page: string | null; from: string | null; on: Day | null };
export type CompareRow = { domain: string; you: boolean; rank: number | null; referringDomains: number | null; newDomains: number | null; lostDomains: number | null };
/** A row already in Opportunities: its id, its status, and whether it has a page to open. */
export type Pursued = { id: string; status: string; open: boolean };
export type GapRowView = { key: string; domain: string; linksTo: number; of: number; names: string[]; firstSeen: Day | null; pursued: Pursued | null };
export type TargetRowView = { key: string; url: string; title: string | null; domain: string; links: { target: string; anchor: string | null }[]; firstSeen: Day | null; revealedOn: Day | null; pursued: Pursued | null };
export type MentionRowView = { key: string; url: string; title: string | null; domain: string; published: Day | null; snippet: string | null; readOn: Day; pursued: Pursued | null };
export type WinRow = { id: string; title: string; lens: LinkLens; status: string; since: Day | null; line: string; open: boolean };

export type LinksPage = {
  state: LinksState;
  /** The sections whose read failed: each says so in its own card. */
  errors: LinksSection[];
  firstRead: Day | null;
  jobFailed: boolean;
  profile: ProfileView | null;
  weeks: { readOn: Day; bars: WeekBar[] } | null;
  moved: { readOn: Day; since: Day; added: MovedRow[]; lost: MovedRow[] } | null;
  compare: { readOn: Day; line: string; rows: CompareRow[] } | null;
  /** Fewer than 3 compared sites: the gap and targets say so instead. */
  few: boolean;
  /**
   * The gap: the rows shown, and the count beside them - exact when every
   * row was read, else DataForSEO's estimate (`hedge`, gap.ts gapCount).
   * `read` and `capped`: how many rows met the rule in the read, and whether
   * more were left unread, for the header's words.
   */
  gap: { readOn: Day; rows: GapRowView[]; more: number; hedge: Hedge; limit: number; of: number; read: number; capped: boolean } | null;
  targets: {
    readOn: Day | null;
    thisMonth: TargetRowView[];
    earlier: TargetRowView[];
    /** The "N more pages" count, as `hedge` words it (targets.ts targetCount). */
    more: number;
    hedge: Hedge;
    /** The pages read and not revealed: what "Show the next 5" can reveal, and what U5 counts. */
    unrevealedRead: number;
    used: number;
    limit: number;
    left: number;
    resetsOn: Day;
    resetsLabel: string;
  } | null;
  mentions: { readOn: Day; rows: MentionRowView[]; candidates: number } | null;
  wins: WinRow[];
  checks: { id: string; url: string; line: string }[];
};

const LINK_LENS_SET = new Set<string>(["link_domain", "link_page", "mention"]);

/** The client's rows in one link lens, by page key, with the stored row (pursued or revealed). */
function byKey(rows: readonly Opportunity[], lens: LinkLens): Map<string, Opportunity> {
  return new Map(rows.filter((o) => o.lens === lens).map((o) => [o.urlKey, o]));
}

const pursuedOf = (o: Opportunity | undefined, opened?: ReadonlySet<string>): Pursued | null => (o && o.status !== "new" ? { id: o.id, status: o.status, open: !opened || opened.has(o.id) } : null);

export function linksPage(w: LinksWorld, p: { client: { domain: string; trial: boolean; market: string }; now: number; today: Day }): LinksPage {
  const state = stateOf(w);
  const placed = w.placed;
  const errors = (Object.keys(NEEDS) as LinksSection[]).filter((k) => NEEDS[k].some((part) => w.unread.has(part)));
  const failed = new Set(errors);
  const rows = excludePlacedDomains(
    w.linkRows.filter((o) => LINK_LENS_SET.has(o.lens)),
    placed,
  );
  const month = allowanceMonth(p.client.market, p.now);
  const wins: WinRow[] = failed.has("wins")
    ? []
    : rows
        .filter((o) => o.status === "pursuing" || o.status === "pitched" || o.status === "won")
        .sort((a, b) => (b.statusAt ?? "").localeCompare(a.statusAt ?? "") || a.id.localeCompare(b.id))
        .map((o) => ({ id: o.id, title: o.title ?? o.domain, lens: o.lens as LinkLens, status: o.status, since: o.statusAt ? o.statusAt.slice(0, 10) : null, line: o.lens === "link_domain" ? "Not checked automatically: a site has no one page to check. Use Check a link on the page that should link to you." : pursuingLine(o.verified, p.client.domain), open: !w.opened || w.opened.has(o.id) }));
  const checks = w.checks.map((c) => ({ id: c.id, url: c.url, line: checkLine(c, p.client.domain) }));
  const base: LinksPage = { state, errors, firstRead: w.firstRead, jobFailed: w.jobFailed, profile: null, weeks: null, moved: null, compare: null, few: false, gap: null, targets: null, mentions: null, wins, checks };
  if (state !== "ready") return base;

  const s = failed.has("profile") ? null : w.summary;
  const profile: ProfileView | null = s
    ? {
        readOn: s.readOn,
        notIndexed: (s.value.backlinks ?? 0) === 0 && (s.value.referringDomains ?? 0) === 0,
        rank: s.value.rank,
        backlinks: s.value.backlinks,
        referringDomains: s.value.referringDomains,
        follow: s.value.follow && s.value.backlinks ? { followed: pct(s.value.follow.followed, s.value.backlinks), notFollowed: pct(s.value.follow.notFollowed, s.value.backlinks), of: s.value.backlinks } : null,
      }
    : null;
  const keep = <R extends { domain: string; urlFrom: string | null }>(xs: readonly R[]) => excludePlacedDomains(xs, placed, (r) => ({ domain: r.domain, url: r.urlFrom }));
  const moved =
    w.newLost && !failed.has("moved")
      ? {
          readOn: w.newLost.readOn,
          since: w.newLost.value.since,
          added: keep(w.newLost.value.added).map((r) => ({ domain: r.domain, page: pathOf(r.urlTo), from: r.urlFrom, on: r.firstSeen })),
          lost: keep(w.newLost.value.lost).map((r) => ({ domain: r.domain, page: pathOf(r.urlTo), from: r.urlFrom, on: r.lastSeen })),
        }
      : null;
  const weeks = w.series && !failed.has("weeks") ? { readOn: w.series.readOn, bars: w.series.value.weeks.slice(-13) } : null;
  const setOk = !w.unread.has("set") && !w.unread.has("placed");
  const kept = setOk && w.set ? excludePlacedDomains(w.set.domains.map((domain) => ({ domain })), placed).map((d) => d.domain) : [];
  const set = w.set && kept.length ? { ...w.set, domains: kept } : null;
  const compare =
    set && w.bulk && !failed.has("compare")
      ? {
          readOn: w.bulk.readOn,
          line: basisLine(set),
          rows: w.bulk.value.rows.filter((r) => r.domain === p.client.domain || set.domains.includes(r.domain)).map((r) => ({ ...r, you: r.domain === p.client.domain })),
        }
      : null;
  const few = setOk && (!set || set.domains.length < 3);

  const domainRows = byKey(rows, "link_domain");
  let gap: LinksPage["gap"] = null;
  if (!few && set && w.gap && !failed.has("gap")) {
    const all = gapRead([w.gap.value.rows], { client: p.client.domain, targets: set.domains, placed }).rows;
    const { shown, limit } = shownGap(all, p.client);
    const count = gapCount({ kept: all.length, shown: shown.length, count: w.gap.value.count, via: w.gap.value.via });
    gap = {
      readOn: w.gap.readOn,
      of: set.domains.length,
      limit,
      more: count.more,
      hedge: count.hedge,
      read: w.gap.value.count.read,
      capped: w.gap.value.count.capped,
      rows: shown.map((r) => {
        const key = urlKey(`https://${r.domain}/`) ?? r.domain;
        return { key, domain: r.domain, linksTo: r.linksTo.length, of: set.domains.length, names: r.linksTo, firstSeen: r.firstSeen, pursued: pursuedOf(domainRows.get(key), w.opened) };
      }),
    };
  }

  const pageRows = byKey(rows, "link_page");
  let targets: LinksPage["targets"] = null;
  if (!few && set && !failed.has("targets")) {
    const revealed = rows.filter((o) => o.lens === "link_page" && o.revealedAt).sort((a, b) => (a.revealedAt ?? "").localeCompare(b.revealedAt ?? ""));
    const revealedKeys = new Set(revealed.map((o) => o.urlKey));
    const read = w.pages ? targetRead(w.pages.value.rows, { client: p.client.domain, targets: set.domains, placed }).rows : [];
    const byPage = new Map(read.map((r) => [pageKeyOf(r), r]));
    const view = (o: Opportunity): TargetRowView => {
      const r = byPage.get(o.urlKey);
      return { key: o.urlKey, url: o.url, title: r?.title ?? o.title, domain: o.domain, links: (r?.links ?? []).map((l) => ({ target: l.target, anchor: l.anchor })), firstSeen: r?.firstSeen ?? null, revealedOn: o.revealedAt!.slice(0, 10), pursued: pursuedOf(pageRows.get(o.urlKey), w.opened) };
    };
    const inMonth = (o: Opportunity) => Date.parse(o.revealedAt!) >= Date.parse(month.start);
    // The allowance counts the table, before any subtraction (spec 10 section 2.5); only the rows drawn are subtracted.
    const used = w.revealsThisMonth ?? revealed.filter(inMonth).length;
    const limit = allowanceFor("link_targets", p.client);
    const unrevealedRead = read.filter((r) => !revealedKeys.has(pageKeyOf(r))).length;
    const count = w.pages ? targetCount({ kept: read.length, unrevealedRead, count: w.pages.value.count }) : { more: 0, hedge: "exact" as const };
    targets = {
      readOn: w.pages?.readOn ?? null,
      thisMonth: revealed.filter(inMonth).map(view),
      earlier: revealed.filter((o) => !inMonth(o)).map(view),
      more: count.more,
      hedge: count.hedge,
      unrevealedRead,
      used,
      limit,
      left: Math.max(0, limit - used),
      resetsOn: month.resetsOn,
      resetsLabel: month.resetsLabel,
    };
  }

  const mentionRows = byKey(rows, "mention");
  const mentions =
    w.mentions && !failed.has("mentions")
      ? {
          readOn: w.mentions.readOn,
          candidates: w.mentions.value.candidates,
          rows: excludePlacedDomains(w.mentions.value.confirmed, placed).map((m) => ({ key: m.urlKey, url: m.url, title: m.title, domain: m.domain, published: m.published, snippet: m.snippet, readOn: m.readOn, pursued: pursuedOf(mentionRows.get(m.urlKey), w.opened) })),
        }
      : null;

  return { ...base, profile, weeks, moved, compare, few, gap, targets, mentions };
}

/** U5's facts (spec 10 section 2.7): this month's reveals used, of the allowance, the pages read and not revealed (after the subtraction - never an estimate), the reset day. */
export function revealFacts(t: LinksPage["targets"]): { used: number; of: number; more: number; resetsOn: string } | undefined {
  return t ? { used: t.used, of: t.limit, more: t.unrevealedRead, resetsOn: t.resetsOn } : undefined;
}
