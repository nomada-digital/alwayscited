import Link from "@/components/app/AppLink";
import SubmitButton from "@/components/app/SubmitButton";
import { rangeLabel } from "@/lib/tracking/date-range";

import DatePicker from "./DatePicker";
import DraftPrompts from "./DraftPrompts";

import EngineLogo from "@/components/EngineLogo";
import { APP_LIMITS } from "@/config/contact";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";
import { PROMPT_MIN, SLOT_WHY, fullLine } from "@/lib/tracking/slot";
import { CONTACT_URL, PACK_CLUSTERS, PACK_KEYWORDS, PACK_PROMPTS, contactUrlFor } from "@/config/pricing";
import { T } from "@/config/tokens";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import { type ClusterCard, type ClusterFilter as Filter, clusterCards, daysOfLine, filterClusters, namedCount, neverCount, pendingBasis, searchPrompts } from "@/lib/tracking/cluster-figures";
import { checkTime } from "@/lib/tracking/check-time";
import { type Range, addDays, basis as basisLine, comparisonLabel, daysIn, firstCheckDay, formatDay, firstReadComplete, resolveComparison } from "@/lib/tracking/figures";
import { type KeywordCheck, draftPrompts } from "@/lib/tracking/add-cluster";
import { ANGLES, BRANDED_CHIP, BRANDED_NOTE, PROMPTS_PER_CLUSTER, type Subject, namesBrandIn, refuseEdit } from "@/lib/tracking/limits";
import type { Compare, OverviewData } from "@/lib/tracking/overview-data";
import { prefillCard } from "@/lib/tracking/order-keyword";
import { firstAsked } from "@/lib/tracking/setup-landing";
import { KEYWORD_FIXED_NOTE } from "@/lib/tracking/rekey";
import { lostReads, runNote, todayRun } from "@/lib/tracking/run-note";
import { BULK_ID, type BulkCount } from "@/lib/tracking/stop";

import type { TierKey } from "@/components/TierName";
import type { UpsellMode } from "@/lib/tracking/ask";
import { neverNamedFacts, offPageOneFacts } from "@/lib/tracking/upgrade-facts";
import { type Facts, type PromptCta, pickPrompt, promptCopy, rowFor } from "@/lib/tracking/upgrade-prompts";

import { Chip, PositionChip, noChange } from "./Overview";
import UpgradePrompt from "./UpgradePrompt";
import { ClearSearch } from "./ClearLinks";
import { appPath, siteHref } from "@/lib/app-host";
import { type PromptOrigin, isPlacementPrompt } from "@/lib/diy/prompts/origins";
import { includesLine, placementBasis, placementBasisLine } from "@/lib/diy/prompts/basis";

import OriginChip from "./prompts/OriginChip";
import PackPrompt from "./google/PackPrompt";
import SuggestedClusters from "./google/SuggestedClusters";
import type { Suggestion } from "@/lib/diy/keywords/setup-suggestions";

/**
 * The Clusters page (BRIEF-3 T6 part 1, 30 Sep 2026; boards-3/Questions.dc.html):
 * "What we track", the filters and search, the usage bar and the accordion -
 * one row per cluster, one open at a time. A closed row is the keyword, its
 * meta, a dot per prompt naming you, the AI rate and the Google position with
 * their changes; the open row lists its 5 prompts with each engine's days
 * named of days checked, joined to the keyword card.
 *
 * Opening, filtering and searching are links and a GET form
 * (`?open=&filter=&q=`), so all of it works with JS off. Stop and Undo (part
 * 2b) are plain POST forms to /api/app/[client]/stop?kind=&id=, which answers with a 303
 * back here carrying `?done=&kind=&id=`; the toast is drawn from those, never
 * from free text in the URL. Owners and editors see the controls, viewers do
 * not. The free slot (part 2c) posts to /prompt and the pending editor (part
 * 2d) to /edit. "Add a cluster" (part 3b) is a link to `?add=1`, and its
 * "Check keyword" form posts to /check, which 303s back with the verdict.
 */

export type StopToast = { done: "stopped" | "undone" | "added" | "saved" | "moved" | "refused" | "unselected" | "rekeyed"; kind: "prompt" | "cluster"; id: string; count?: BulkCount; /** R151: a refusal's fixed words (slot.ts slotRefusal), or null. */ why?: string | null };

const short = (t: string) => (t.length > 52 ? `${t.slice(0, 50)}…` : t);

/** R133: the warning on a prompt that names the client's brand. It warns only; tracking one is the client's choice. */
function BrandedChip() {
  return (
    <span title={BRANDED_NOTE} style={{ flexShrink: 0, padding: "2px 8px", borderRadius: "999px", background: T.warnBg, color: T.warnFg, fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
      {BRANDED_CHIP}
    </span>
  );
}


const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pctText = (p: number | null) => (p === null ? "-" : `${p}%`);
const ROW_H = 64;
const PITCH = ROW_H + 4;
const BLOCK_H = 5 * PITCH - 4;
const GRID = "28px minmax(0, 1fr) 168px 132px 132px";

export default function Clusters({
  brand,
  market,
  engines,
  today,
  range,
  compareMode,
  startedOn,
  now = null,
  data,
  clusterLimit,
  open,
  filter,
  q,
  slug,
  canWrite,
  toast,
  adding = null,
  rekey = null,
  redraft = null,
  typed = null,
  asked = null,
  askSent = false,
  packPrice = "",
  upgrade = null,
  subject = null,
  origins = NO_ORIGINS,
  src = null,
  suggested = [],
  gaining = null,
  packLine = "",
}: {
  brand: string;
  /**
   * 13 Oct 2026, DIY P6 (spec 10 sections 3.5, 4.10 and 6.6): `?src=gaining` - the Add panel was opened from a
   * gaining-ground keyword (Google's Track, or Suggested clusters below) - rides through Check keyword as a hidden
   * field and on to the add, so the new cluster's prompts carry the Momentum origin.
   */
  src?: "gaining" | null;
  /** DIY P6: up to 5 keywords to track while a slot is free (setup-suggestions.ts suggestedClusters). */
  suggested?: readonly Suggestion[];
  /** DIY P6: the top gaining-ground keyword, for U7 when every cluster is in use. */
  gaining?: string | null;
  /** DIY P6: trackingPackLine(trackingPackPrice(market)), U7's words from pricing.ts. */
  packLine?: string;
  /** 13 Oct 2026, DIY P2: each prompt's origin (loadPromptOrigins), for its chip and the "From placements" sub-list. */
  origins?: ReadonlyMap<string, PromptOrigin>;
  /** R133: the client's brand and domain, so a prompt that names them carries the "Names the brand" chip. */
  subject?: Subject | null;
  /** client_domains.market: the check times are said in its zone (check-time.ts, 9 Oct 2026). */
  market: string;
  engines: readonly Engine[];
  today: string;
  range: Range;
  compareMode: Compare;
  /** The client's started_on, the date picker's first pickable day (T5). */
  startedOn?: string | null;
  /** The moment the page treats as now (repo.now): when drafts saved now are first asked, said in the client's zone (ON-1 review). */
  now?: number | null;
  data: OverviewData;
  clusterLimit: number;
  open: string | null;
  filter: Filter;
  q: string;
  slug: string;
  canWrite: boolean;
  toast: StopToast | null;
  adding?: Adding | null;
  /** R179: a pending card's Change keyword verdict, for the card it names. */
  rekey?: Rekeying | null;
  /** R179: the card whose prompt inputs open with fresh drafts from its keyword. */
  redraft?: string | null;
  /** R180: the keyword typed at checkout on an order with no scan, prefilled on the first keywordless card. */
  typed?: string | null;
  /** The /ask confirmation or refusal, built by the page from the 303's one word. */
  asked?: string | null;
  /** Whether that line says the ask went (the board's dark pill) or not. */
  askSent?: boolean;
  packPrice?: string;
  /** T11: what the never filter's alwaysmentioned prompt is judged on beyond the cards. */
  upgrade?: { tier: TierKey; mode: UpsellMode; hidden: ReadonlySet<PromptCta>; startedOn: string; domain: string } | null;
}) {
  // 8 Oct 2026 (audit data-10): the comparison the Overview reads - the first week for a young client.
  // The first week's first day, from started_on and the prompts - the date picker is handed the same day.
  const firstCheck = firstCheckDay(startedOn ?? null, data.questions);
  // ON-3 review (9 Oct 2026): a first reading only when its check was complete.
  const firstComplete = firstReadComplete(data.runs, firstCheck);
  const cmp = resolveComparison(range, compareMode, startedOn ?? null, firstCheck, firstComplete);
  const before = cmp.range;
  // 9 Oct 2026 (audit copy-2): tomorrow's check time in the client's zone, from the cron (check-time.ts).
  const next = checkTime(addDays(today, 1), market);
  // ON-1 review (9 Oct 2026): drafts saved now are first asked at the next tracking day's check, said from now in the client's zone.
  const firstAsk = firstAsked({ today, startedOn: startedOn ?? null, market, now: now ?? Date.parse(`${today}T12:00:00Z`) });
  // Audit data-3 (8 Oct 2026): every partial or failed check in the range, not only the last.
  const partial = runNote(data, range, today);
  const cards = clusterCards({ clusters: data.clusters ?? [], questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before, today, engines });
  const shown = filterClusters(cards, filter, q);
  const prefill = prefillCard(cards.filter((c) => c.stoppedOn === null), typed);
  // The board opens on the first cluster; `?open=` with no id closes them all.
  const openId = open ?? cards[0]?.id ?? null;
  const base: Record<string, string> = { from: range.from, to: range.to, ...(compareMode === "prev" ? {} : { compare: compareMode }) };
  const href = (extra: Record<string, string>) => `?${new URLSearchParams({ ...base, ...(filter === "all" ? {} : { filter }), ...(q ? { q } : {}), ...extra })}`;
  // A stopped cluster frees its slot at once, though today's reading still shows (limits.ts).
  const used = cards.filter((c) => c.stoppedOn === null).length;
  const keep = { ...base, ...(filter === "all" ? {} : { filter }), ...(q ? { q } : {}), ...(open !== null ? { open } : {}) };
  const act = canWrite ? { action: `/api/app/${encodeURIComponent(slug)}/stop`, keep, today } : null;
  const full = used >= clusterLimit;
  // DIY P2: the chips name Nomada only when the account's mode says nomada (origins.ts originLabel).
  const mode: UpsellMode = upgrade?.mode ?? "off";
  // DIY P2: the angle slots leave placement prompts out, as limits.ts counts them.
  const slotCards = cards.map((c) => ({ ...c, prompts: c.prompts.filter((p) => !isPlacementPrompt(origins, p.id)) }));
  const ungrouped = ungroupedShown(data.questions, today);
  const live = cards.filter((c) => c.status !== "pending");
  const filters: [Filter, string][] = [
    ["all", `All ${cards.length}`],
    ["named", `Naming you ${live.filter((c) => namedCount(c) > 0).length}`],
    ["never", `With prompts that never name you ${live.filter((c) => neverCount(c) > 0).length}`],
  ];
  const engineNames = engines.map((e) => ENGINE_SPECS[e].label);
  // The comparison's last day, whose Google reading the column compares with: the day before the range for
  // the previous period, the first week's last for a young client (audit data-10), the month before's last.
  const since = before ? formatDay(before.to) : null;
  // ON-3 (9 Oct 2026): what every change is against, on each chip (Overview.tsx Chip's `vs`).
  const vs = before ? comparisonLabel(before, cmp.kind) : null;
  // T11: the never filter carries the alwaysmentioned prompt; the unfiltered list, which is the
  // cluster layout's Google keywords panel (each row's position), carries alwayscited. Each only
  // when its rules allow (upgrade-prompts.ts), and each screen is judged on its own panel's facts.
  // 8 Oct 2026 (audit reliability-1 / data-6): partial is lost reads (run-note.ts lostReads). A run
  // partial only for a brand gap lost none, and neither prompt is judged on other brands. A failed check
  // today (audit data-3) lost every read, so it is partial too (merge of audit packages A and B, 8 Oct 2026).
  const state = shown.length === 0 ? "empty" : lostReads(data.lastRun) || todayRun(data.runs, today)?.status === "failed" ? "partial" : "ok";
  const facts: Facts | null =
    upgrade && filter === "never"
      ? { ...upgrade, today, state, neverNamed: neverNamedFacts({ cards, answers: data.answers, range, domain: upgrade.domain }) }
      : upgrade && filter === "all" && !q.trim()
        ? { ...upgrade, today, state, offPageOne: offPageOneFacts(cards), ...(full && gaining ? { atLimit: true, gaining: { keyword: gaining, clusters: clusterLimit, packLine } } : {}) }
        : null;
  const cta = facts ? pickPrompt(facts) : null;
  const prompt = facts && (cta === "mentioned" || cta === "cited") ? promptCopy(cta, facts) : null;
  // DIY P6 (spec 10 section 2.7): U7, at the limit with a gaining-ground keyword waiting - the pack, with "Ask us".
  const pack = facts && cta === "pack" && rowFor("pack", facts) === "U7" ? promptCopy("pack", facts) : null;
  const items = cta === "mentioned" ? (facts?.neverNamed?.ids ?? []) : cta === "cited" ? (facts?.offPageOne?.ids ?? []) : [];

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>What we track</h1>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>
            Each cluster is one Google keyword and 5 prompts about it. Every prompt is asked on {engineNames.length > 1 ? `${engineNames.slice(0, -1).join(", ")} and ${engineNames[engineNames.length - 1]}` : engineNames[0]} each morning, and every keyword is checked on Google. Changes start at the next daily check.
          </p>
          {partial ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{partial}</p> : null}
        </div>
        {/* T5 (30 Sep 2026): the server-drawn face opens boards/DatePicker.dc.html; JS off still shows the range. */}
        <DatePicker range={range} compare={compareMode} today={today} startedOn={startedOn ?? null} firstCheck={firstCheck} firstComplete={firstComplete} grow={false}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, startedOn ?? null)}</span>
            <span style={{ fontSize: "12px", color: T.soft }}>
              {formatDay(range.from)} - {formatDay(range.to, true)}
              {before ? `, ${comparisonLabel(before, cmp.kind)}` : ""}
            </span>
          </span>
        </DatePicker>
      </header>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <nav aria-label="Filter clusters" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {filters.map(([key, label]) => {
              const on = filter === key;
              const params = { ...base, ...(key === "all" ? {} : { filter: key }), ...(q ? { q } : {}) };
              return (
                <Link key={key} href={`?${new URLSearchParams(params)}`} aria-current={on ? "true" : undefined} style={{ display: "inline-flex", alignItems: "center", height: "36px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>
                  {label}
                </Link>
              );
            })}
          </nav>
          <form method="get" role="search" className="app-search" style={{ display: "flex", alignItems: "center", gap: "8px", width: "280px", maxWidth: "100%", height: "40px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface }}>
            <input id="cl-from" type="hidden" name="from" value={range.from} />
            <input id="cl-to" type="hidden" name="to" value={range.to} />
            {compareMode === "prev" ? null : <input id="cl-compare" type="hidden" name="compare" value={compareMode} />}
            {filter === "all" ? null : <input id="cl-filter" type="hidden" name="filter" value={filter} />}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <label htmlFor="q-search" className="sr-only">
              Search clusters and prompts
            </label>
            {/* Audit mobile-6 (8 Oct 2026): a search key on the phone's keyboard, and keywords left as typed rather than autocorrected. */}
            <input id="q-search" type="search" name="q" defaultValue={q} maxLength={APP_LIMITS.search} placeholder="Search keywords and prompts" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 0, fontFamily: "inherit", fontSize: "14px", color: T.ink, background: "transparent" }} />
            {q ? <ClearSearch href={`?${new URLSearchParams({ ...base, ...(filter === "all" ? {} : { filter }) })}`} /> : null}
          </form>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "200px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: T.ink }}>{`${used} of ${clusterLimit} clusters in use`}</span>
            <span aria-hidden="true" style={{ height: "6px", borderRadius: "3px", background: T.hair, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.min(100, Math.round((100 * used) / clusterLimit))}%`, background: full ? T.warnFg : T.accent, borderRadius: "3px" }} />
            </span>
          </div>
          {canWrite ? (
            <Link href={href({ add: "1" })} scroll={false} data-usage="add_open" style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", padding: "0 16px", borderRadius: "12px", background: T.accent, color: T.surface, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.surface} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add a cluster
            </Link>
          ) : used ? (
            // DS61 (2 Oct 2026, R173 pass 6): a viewer saw no Add, Stop or Change and nothing saying why. The empty state says it already.
            <p style={{ margin: 0, maxWidth: "360px", fontSize: "13px", lineHeight: 1.5, color: T.soft }}>Only owners and editors can add, change or stop clusters and prompts - ask one of them to make a change.</p>
          ) : null}
        </div>
      </div>

      {asked ? (
        askSent ? (
          // CTAs.dc.html's "After Ask about these": a dark pill with a tick. The tick is the palette's good pair, not the board's light green.
          <p role="status" style={{ margin: 0, display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, alignSelf: "flex-start", maxWidth: "100%", boxSizing: "border-box" }}>
            <span aria-hidden="true" style={{ flexShrink: 0, width: "22px", height: "22px", borderRadius: "50%", background: T.goodBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.goodFg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5 9-10" />
              </svg>
            </span>
            {asked}
          </p>
        ) : (
          <p role="status" style={{ margin: 0, padding: "12px 16px", borderRadius: "12px", background: T.wash, border: `1px solid ${T.washLine}`, fontSize: "14px", color: T.ink }}>
            {asked}
          </p>
        )
      ) : null}

      {canWrite && adding ? <AddPanel slug={slug} adding={adding} full={full} clusterLimit={clusterLimit} packPrice={packPrice} packHref={siteHref(upgrade ? contactUrlFor(upgrade.tier) : CONTACT_URL)} close={href({})} keep={keep} src={src} /> : null}

      {!full && suggested.length ? <SuggestedClusters items={suggested} canWrite={canWrite} free={clusterLimit - used} hrefFor={(kw) => href({ add: "1", kw, src: "gaining" })} /> : null}

      <section aria-label="Clusters" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", overflow: "hidden" }}>
        <div className="app-cl-grid app-hide-sm" style={{ display: "grid", gridTemplateColumns: GRID, gap: "16px", padding: "14px 24px 12px" }}>
          <span />
          <span style={HEAD}>Keyword and its prompts</span>
          <span style={HEAD}>Prompts naming you</span>
          <span style={{ ...HEAD, textAlign: "right" }}>{cmp.kind === "start" ? "Named, vs first week" : cmp.kind === "first" ? "Named, vs first reading" : "Named, vs last period"}</span>
          <span style={{ ...HEAD, textAlign: "right" }}>{since ? `Position, vs ${since}` : "Position"}</span>
        </div>
        {shown.map((c) => (
          <ClusterRow key={c.id} c={c} origins={origins} mode={mode} slug={slug} brand={brand} subject={subject} open={c.id === openId} toggle={href({ open: c.id === openId ? "" : c.id })} since={since} act={act} refill={toast?.done === "stopped" && toast.kind === "prompt" ? toast.id : null} rekey={rekey?.card === c.id ? rekey : null} redraft={redraft === c.id} rekeyed={toast?.done === "rekeyed" && toast.id === c.id} typed={prefill === c.id ? typed : null} next={next} openHref={appPath(`/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(c.id)}?${new URLSearchParams(base)}`)} vs={vs} firstAsk={firstAsk} />
        ))}
        {shown.length === 0 ? (
          <div style={{ padding: "32px 24px", borderTop: `1px solid ${T.line}`, fontSize: "14px", color: T.soft }}>
            {/* DS27: a filter pill can read 0 and still be picked, so its empty line names the filter and links back to All. */}
            {q.trim() ? (
              `Nothing matches “${q.trim()}”. Clear the search to see every cluster.`
            ) : cards.length ? (
              <>
                {filter === "named" ? "No cluster is naming you in this range. " : "No cluster has a prompt that never names you in this range. "}
                <Link href={`?${new URLSearchParams(base)}`} style={{ display: "inline-flex", alignItems: "center", color: T.accent, fontWeight: 600 }}>
                  {cards.length === 1 ? "Show the 1 cluster" : `Show all ${cards.length} clusters`}
                </Link>
              </>
            ) : ungrouped.length ? (
              // DS54 (R173 pass 6, 2 Oct 2026): a client tracking ungrouped prompts for months read "sets up your first one when tracking starts".
              canWrite ? (
                `No clusters yet. Add a cluster to track a Google keyword beside its ${PROMPTS_PER_CLUSTER} prompts, then move ungrouped prompts into it.`
              ) : (
                "No clusters yet. Only owners and editors can add one."
              )
            ) : (
              "No clusters yet. nomada digital sets up your first one when tracking starts."
            )}
          </div>
        ) : null}
        {prompt && cta ? <UpgradePrompt copy={prompt} cta={cta} slug={slug} items={items} keep={keep} /> : null}
        {pack && upgrade ? <PackPrompt copy={pack} slug={slug} tier={upgrade.tier} agency={upgrade.mode === "agency"} keep={keep} surface="clusters" /> : null}
      </section>
      {ungrouped.length ? <Ungrouped rows={searchPrompts(ungrouped, q)} all={ungrouped} term={q.trim()} act={act} subject={subject} targets={moveTargets(cards, data.questions, origins)} clusters={cards.filter((c) => c.stoppedOn === null).length} today={today} market={market} origins={origins} mode={mode} slug={slug} /> : null}
      <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft, maxWidth: "820px" }}>
        {/* DS72 (R173 pass 10, 2 Oct 2026): with no cluster read yet there is no number beside any engine to explain. */}
        {cards.some((c) => c.now.den > 0) ? `The number beside each engine is the days it named ${brand} for that prompt, out of the days checked. ` : ""}Stopping a prompt or a cluster keeps its history in your reports. A new prompt or cluster starts at the next daily check.
      </p>
      {toast ? <Toast t={toast} cards={slotCards} ungrouped={ungrouped} act={act} next={next} dismiss={`?${new URLSearchParams(keep)}`} /> : null}
    </div>
  );
}

const HEAD: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: T.soft };
const NO_ORIGINS: ReadonlyMap<string, PromptOrigin> = new Map();

type PromptRow = OverviewData extends { questions: readonly (infer R)[] } ? R : never;

/**
 * R170 part 1 (Danny, 2 Oct 2026, danny.md line 180): the client's ungrouped
 * prompts, each with Stop, and Undo while its stop is still pending - the same
 * stop route and rules as a prompt in a cluster. Owners and editors only;
 * viewers see the list and why there is no control. Gone once stopped and
 * read. Part 2: "Move into a cluster", a plain POST to /group with the
 * cluster picked from those that are live and have room (refuseGrouping).
 */
export function ungroupedShown(rows: readonly PromptRow[], today: string): PromptRow[] {
  return rows.filter((q) => q.cluster_id === null && (q.stopped_on === null || q.stopped_on > today));
}

type Target = { id: string; label: string };

/** The clusters a prompt can move into: live, with fewer than PROMPTS_PER_CLUSTER live prompts in their angle slots (placement prompts are not in one, DIY P2). */
export function moveTargets(cards: readonly ClusterCard[], rows: readonly PromptRow[], origins: ReadonlyMap<string, PromptOrigin> = NO_ORIGINS): Target[] {
  return cards
    .filter((c) => c.stoppedOn === null && rows.filter((q) => q.cluster_id === c.id && q.stopped_on === null && !isPlacementPrompt(origins, q.id)).length < PROMPTS_PER_CLUSTER)
    .map((c) => ({ id: c.id, label: c.keyword ?? c.name }));
}

function Ungrouped({ rows, all, term, act, subject, targets, clusters, today, market, origins, mode, slug }: { rows: PromptRow[]; all: PromptRow[]; term: string; act: Act; subject: Subject | null; targets: Target[]; clusters: number; today: string; market: string; origins: ReadonlyMap<string, PromptOrigin>; mode: UpsellMode; slug: string }) {
  // DS13: ticks and a bulk bar once two or more live rows can be changed together.
  const bulk = !!act && rows.filter((q) => q.stopped_on === null).length >= 2;
  // DS55: the page's search narrows this list too, and the heading counts the matches, as Who is named does.
  const liveCount = (r: PromptRow[]) => r.filter((q) => q.stopped_on === null).length;
  const heading = term ? `Ungrouped prompts, ${liveCount(rows)} of ${liveCount(all)} match “${term}”` : `Ungrouped prompts ${liveCount(all)}`;
  return (
    <section aria-labelledby="ungrouped-h" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", overflow: "hidden" }}>
      <div style={{ padding: "18px 24px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 id="ungrouped-h" style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: T.ink }}>{heading}</h2>
        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>
          {act
            ? `Asked every morning like the rest, but in no cluster yet. Stopping one keeps its history in your reports.${targets.length ? "" : clusters ? ` Every cluster has ${PROMPTS_PER_CLUSTER} live prompts, so there is nowhere to move one - stop a prompt in a cluster to make room.` : " Add a cluster to move one into."}`
            : "Asked every morning like the rest, but in no cluster yet. Only owners and editors can stop these prompts or move them into a cluster - ask one of them to make a change."}
        </p>
      </div>
      {bulk ? <BulkBar act={act!} targets={targets} /> : null}
      {rows.length === 0 ? (
        <p style={{ margin: 0, padding: "14px 24px 18px", borderTop: `1px solid ${T.line}`, fontSize: "14px", color: T.soft }}>No ungrouped prompt matches. Clear the search to see all of them.</p>
      ) : null}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((q) => {
          const stopping = q.stopped_on !== null;
          return (
            <li key={q.id} style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: bulk ? "10px 24px 10px 12px" : "10px 24px", borderTop: `1px solid ${T.line}`, minHeight: "44px", boxSizing: "border-box" }}>
              {bulk ? (
                stopping ? (
                  <span aria-hidden="true" style={{ width: "44px", flexShrink: 0 }} />
                ) : (
                  <label style={{ width: "44px", height: "44px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <input id={`ug-tick-${q.id}`} type="checkbox" name="ids" value={q.id} form={BULK_FORM} style={{ width: "18px", height: "18px", margin: 0, accentColor: T.accent, cursor: "pointer" }} />
                    <span className="sr-only">{`Tick “${short(q.text)}”`}</span>
                  </label>
                )
              ) : null}
              <span style={{ flex: "1 1 260px", minWidth: 0, fontSize: "14px", color: stopping ? T.soft : T.ink, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {q.text}
                {subject && namesBrandIn(q.text, subject) ? <BrandedChip /> : null}
                <OriginChip origin={origins.get(q.id)} slug={slug} mode={mode} />
                {stopping ? <span style={{ fontSize: "12px", color: T.soft }}>Stops after today’s check</span> : null}
                {/* DS76 (2 Oct 2026): a prompt added for tomorrow is listed here but not yet asked, which the Overview's count leaves out. */}
                {!stopping && q.added_on > today ? <span style={{ fontSize: "12px", color: T.accent, fontWeight: 600 }}>{`First check ${q.added_on === addDays(today, 1) ? "tomorrow" : formatDay(q.added_on)} at ${checkTime(q.added_on, market)}`}</span> : null}
              </span>
              {act && !stopping && targets.length ? <MoveForm act={act} id={q.id} text={q.text} targets={targets} /> : null}
              {act ? (
                <StopForm act={act} kind="prompt" id={q.id} undo={stopping} label={stopping ? `Undo stopping “${short(q.text)}”` : `Stop “${short(q.text)}”`} style={{ ...BTN, height: "44px" }}>
                  {stopping ? "Undo" : (<>{STOP_ICON}Stop</>)}
                </StopForm>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type Adding = { kw: string; check: KeywordCheck | null; sig: string };
export type Rekeying = Adding & { card: string };

/**
 * The board's Add a cluster panel (part 3b): the keyword and "Check keyword",
 * a plain POST to /check that 303s back with the verdict, rebuilt from fixed
 * words (add-cluster.ts). At the limit it is the +5 clusters offer instead.
 * On a signed pass, step 2 (part 3c): the five drafted prompts, editable, and
 * "Start tracking this cluster", a POST to /cluster. On a refusal that
 * allows it, "Ask us to pick one", a POST to T11's /ask (ask.ts).
 */
function AddPanel({ slug, adding, full, clusterLimit, packPrice, packHref, close, keep, src = null }: { slug: string; adding: Adding; full: boolean; clusterLimit: number; packPrice: string; packHref: string; close: string; keep: Record<string, string>; src?: "gaining" | null }) {
  // The page's range, filter and search ride on the Check and Start actions, as the stop forms' do (DS15).
  const view = new URLSearchParams(keep).toString();
  const ck = adding.check;
  const msg = ck ? ck.message : "It needs Google search volume and a buying intent, because it is the term placements link on. We check both before anything is tracked.";
  return (
    <section aria-label="Add a cluster" style={{ padding: "22px 24px", borderRadius: "18px", background: T.surface, border: `1px solid ${T.washLine}`, boxShadow: `0 0 0 4px ${T.wash}`, display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: T.ink }}>Add a cluster</h2>
          <span style={{ fontSize: "13px", color: T.soft }}>One Google keyword buyers search, and 5 prompts about it.</span>
        </div>
        <Link href={close} scroll={false} aria-label="Close" data-usage="add_abandon" style={{ width: "40px", height: "40px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
      </div>
      {full ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", flexWrap: "wrap", padding: "16px 18px", borderRadius: "12px", background: T.warnBg }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: T.warnFg }}>{`All ${clusterLimit} clusters are in use`}</span>
            <span style={{ fontSize: "14px", color: T.ink }}>Stop tracking one below to make room. Its history stays in your reports.</span>
          </div>
          {/* R151 (3 Oct 2026): the +5 offer was bare /contact; it carries the client's plan now, as the sidebar's does. */}
          <Link href={packHref} style={{ flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", height: "52px", padding: "0 16px", borderRadius: "12px", background: T.ink, color: T.surface, textDecoration: "none" }}>
            <span style={{ fontSize: "14px", fontWeight: 600 }}>{`Add ${PACK_CLUSTERS} clusters for ${packPrice} a month`}</span>
            <span style={{ fontSize: "12px", color: T.line }}>{`${PACK_PROMPTS} prompts and ${PACK_KEYWORDS} keywords, checked daily`}</span>
          </Link>
        </div>
      ) : (
        <form method="post" action={`/api/app/${encodeURIComponent(slug)}/check${view ? `?${view}` : ""}`} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* DIY P6: from a gaining-ground keyword, the check carries `src` back (check/route.ts back()). */}
          {src ? <input id="kw-src" type="hidden" name="src" value={src} /> : null}
          <label htmlFor="kw-draft" style={{ fontSize: "13px", fontWeight: 600, color: T.ink }}>
            1. The keyword
          </label>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {/* R151 (3 Oct 2026): a refusal comes back on a 303 - the field is marked, described by the line under it, and focused, as /checkout's are. */}
            <input id="kw-draft" name="keyword" defaultValue={adding.kw} required maxLength={ADMIN_LIMITS.question} placeholder="e.g. accounting software for dentists" aria-describedby="kw-draft-note" aria-invalid={ck?.ok === false ? true : undefined} autoFocus={ck?.ok === false} style={{ flex: "1 1 240px", minWidth: 0, height: "48px", boxSizing: "border-box", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "12px", fontFamily: "inherit", fontSize: "15px", color: T.ink, background: T.surface }} />
            <SubmitButton busy="Checking..." style={{ height: "48px", padding: "0 18px", border: `1px solid ${T.ink}`, borderRadius: "12px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "14px", fontWeight: 600 }}>
              Check keyword
            </SubmitButton>
          </div>
          <p id="kw-draft-note" role={ck ? (ck.ok ? "status" : "alert") : undefined} style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: ck ? (ck.ok ? T.goodFg : T.badFg) : T.soft }}>
            {msg}
          </p>
        </form>
      )}
      {!full && ck && !ck.ok && ck.ask && adding.kw ? (
        <form method="post" action={`/api/app/${encodeURIComponent(slug)}/ask${view ? `?${view}` : ""}`}>
          <input id="ask-keyword" type="hidden" name="keyword" value={adding.kw} />
          <SubmitButton busy="Sending..." style={{ height: "40px", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "13px", fontWeight: 600 }}>
            Ask us to pick one
          </SubmitButton>
        </form>
      ) : null}
      {!full && ck?.ok && adding.sig ? (
        <form method="post" action={`/api/app/${encodeURIComponent(slug)}/cluster${view ? `?${view}` : ""}`} style={{ display: "flex", flexDirection: "column", gap: "10px", borderTop: `1px solid ${T.line}` }}>
          <input id="nc-keyword" type="hidden" name="keyword" value={ck.keyword} />
          <input id="nc-vol" type="hidden" name="vol" value={String(ck.volume)} />
          <input id="nc-intent" type="hidden" name="intent" value={ck.intent} />
          <input id="nc-sig" type="hidden" name="sig" value={adding.sig} />
          {/* DIY P6: the add's prompts get the Momentum origin (cluster/route.ts, new-cluster.ts momentumOrigin). */}
          {src ? <input id="nc-src" type="hidden" name="src" value={src} /> : null}
          <span style={{ fontSize: "13px", fontWeight: 600, color: T.ink, paddingTop: "16px" }}>2. Five prompts about it, one per angle</span>
          <span style={{ fontSize: "13px", color: T.soft }}>Each asks for a recommendation, the way a buyer would, so it shows whether engines name you. We’ve drafted them from the keyword. Edit any of them.</span>
          {draftPrompts(ck.keyword).map((text, i) => (
            <div key={ANGLES[i]} className="app-cl-edit" style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", alignItems: "center", gap: "12px" }}>
              <label htmlFor={`new-p-${i}`} style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: T.soft }}>
                {ANGLES[i]}
              </label>
              <input id={`new-p-${i}`} name={`p-${i}`} defaultValue={text} required minLength={PROMPT_MIN} maxLength={ADMIN_LIMITS.question} style={{ height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "10px", fontFamily: "inherit", fontSize: "14px", color: T.ink, background: T.surface, minWidth: 0 }} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <SubmitButton busy="Starting tracking..." style={{ height: "48px", padding: "0 20px", border: 0, borderRadius: "12px", background: T.accent, color: T.surface, fontFamily: "inherit", fontSize: "14px", fontWeight: 600 }}>
              Start tracking this cluster
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}

type Act = { action: string; keep: Record<string, string>; today: string } | null;

/**
 * A stop or undo is a form, so it posts with JS off. What to stop and the page
 * state to come back to ride in the action's query string rather than hidden
 * fields, so a list of forms repeats no field ids; the route re-reads every one.
 */
function StopForm({ act, kind, id, undo, label, children, style }: { act: NonNullable<Act>; kind: "prompt" | "cluster"; id: string; undo?: boolean; label?: string; children: React.ReactNode; style: React.CSSProperties }) {
  const q = new URLSearchParams({ ...act.keep, kind, id, ...(undo ? { undo: "1" } : {}) });
  return (
    <form method="post" action={`${act.action}?${q}`} style={{ display: "contents" }}>
      <button type="submit" aria-label={label} title={label} style={{ cursor: "pointer", fontFamily: "inherit", ...style }}>
        {children}
      </button>
    </form>
  );
}

const BULK_FORM = "ungrouped-bulk";

/**
 * DS13 (R173 pass 2, benchmark "bulk select on prompts (stop, move)"): one
 * form for the ticked ungrouped prompts. The ticks sit in the rows and join it
 * by `form=`, so the rows' own Stop and Move forms are not nested. Stop posts
 * to /stop, Move to /group by formAction, both with id=selected; it all works
 * with JS off.
 */
function BulkBar({ act, targets }: { act: NonNullable<Act>; targets: Target[] }) {
  const q = new URLSearchParams({ ...act.keep, kind: "prompt", id: BULK_ID });
  return (
    <form id={BULK_FORM} method="post" action={`${act.action}?${q}`} aria-label="Change the ticked prompts" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "0 24px 14px" }}>
      <span style={{ fontSize: "13px", fontWeight: 600, color: T.ink, marginRight: "4px" }}>Ticked prompts:</span>
      <button type="submit" style={{ ...BTN, height: "44px", cursor: "pointer", fontFamily: "inherit" }}>
        {STOP_ICON}Stop ticked
      </button>
      {targets.length ? (
        <>
          <label htmlFor="bulk-cluster" className="sr-only">Cluster to move the ticked prompts into</label>
          <select id="bulk-cluster" name="cluster" defaultValue="" style={{ height: "44px", maxWidth: "220px", padding: "0 10px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontSize: "13px", fontFamily: "inherit" }}>
            <option value="" disabled>
              Pick a cluster
            </option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="submit" formAction={`${act.action.replace(/\/stop$/, "/group")}?${q}`} style={{ ...BTN, height: "44px", cursor: "pointer", fontFamily: "inherit" }}>
            Move ticked
          </button>
        </>
      ) : null}
    </form>
  );
}

/** Move into a cluster: the prompt and page state in the action's query string as StopForm's, the picked cluster in the body. */
function MoveForm({ act, id, text, targets }: { act: NonNullable<Act>; id: string; text: string; targets: Target[] }) {
  const q = new URLSearchParams({ ...act.keep, kind: "prompt", id });
  const field = `move-${id}`;
  return (
    <form method="post" action={`${act.action.replace(/\/stop$/, "/group")}?${q}`} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <label htmlFor={field} className="sr-only">{`Cluster to move “${short(text)}” into`}</label>
      <select id={field} name="cluster" required defaultValue="" style={{ height: "44px", maxWidth: "220px", padding: "0 10px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontSize: "13px", fontFamily: "inherit" }}>
        <option value="" disabled>
          Pick a cluster
        </option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <button type="submit" aria-label={`Move “${short(text)}” into the picked cluster`} style={{ ...BTN, height: "44px", cursor: "pointer", fontFamily: "inherit" }}>
        Move
      </button>
    </form>
  );
}

const STOP_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const CHEVRON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const BTN: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", height: "40px", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontSize: "13px", fontWeight: 600 };
const SQUARE: React.CSSProperties = { width: "36px", height: "36px", padding: 0, border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, display: "flex", alignItems: "center", justifyContent: "center" };
// DS4 (2 Oct 2026, R172 defect 3): a prompt's Stop and Undo say so in text at 44px, as the ungrouped rows and the pending editor's fixed row do.
const STOP_BTN: React.CSSProperties = { ...SQUARE, width: "auto", height: "44px", gap: "6px", padding: "0 12px", fontSize: "13px", fontWeight: 600, justifySelf: "start" };

/**
 * DS13: the toast after a bulk stop or move - how many of those ticked went
 * through. No toast Undo for a batch: each stopped row keeps its own Undo
 * until the next check.
 */
export function bulkToast(t: Pick<StopToast, "done" | "count" | "why">): string {
  if (t.done === "unselected") return "Nothing changed. Tick the prompts first, and pick a cluster before Move.";
  const c = t.count;
  // R151 (3 Oct 2026): a batch where none went through carries the rule's words (slot.ts SLOT_WHY) when it has one.
  if (t.done === "refused" && t.why) return t.why;
  if (t.done === "refused" || !c || c.n === 0) return "That change did not go through. Reload the page and try again.";
  const what = c.n === c.of ? `${c.n} ${c.n === 1 ? "prompt" : "prompts"}` : `${c.n} of the ${c.of} ticked prompts`;
  const rest = c.n === c.of ? "" : t.done === "moved" ? ` The rest stay ungrouped - a cluster holds ${PROMPTS_PER_CLUSTER} live prompts.` : " The rest were not changed.";
  if (t.done === "moved") return `Moved ${what} into the cluster you picked. Each is asked every morning as before.${rest}`;
  return `Stopped ${what}. Their history stays in your reports, and each has Undo on its row until the next check.${rest}`;
}

/** The board's toast: what the stop did, and Undo while it can still be undone. */
function Toast({ t, cards, ungrouped = [], act, next, dismiss }: { t: StopToast; cards: ClusterCard[]; ungrouped?: PromptRow[]; act: Act; next: string; dismiss: string }) {
  const cluster = t.kind === "cluster" ? cards.find((c) => c.id === t.id) : cards.find((c) => c.prompts.some((p) => p.id === t.id));
  const loose = t.kind === "prompt" && !cluster ? ungrouped.find((q) => q.id === t.id) : undefined;
  const prompt = t.kind === "prompt" ? (cluster?.prompts.find((p) => p.id === t.id) ?? (loose ? { text: loose.text, stoppedOn: loose.stopped_on } : undefined)) : undefined;
  const name = t.kind === "cluster" ? (cluster?.keyword ?? cluster?.name) : prompt?.text;
  const stoppedOn = t.kind === "cluster" ? cluster?.stoppedOn : prompt?.stoppedOn;
  const canUndo = t.id !== BULK_ID && t.done === "stopped" && !!act && !!stoppedOn && stoppedOn > act.today;
  // ON-1 review (9 Oct 2026): a refused save of five drafts on a cluster with one to four live prompts says the real count.
  const live = cluster ? cluster.prompts.filter((p) => p.stoppedOn === null).length : 0;
  const text = t.id === BULK_ID ? bulkToast(t) : t.done === "refused" && t.why === SLOT_WHY.full && t.kind === "cluster" && cluster
      ? fullLine(live, PROMPTS_PER_CLUSTER)
      : t.done === "refused" && t.why
      ? t.why
      : t.done === "refused" || !name
      ? "That change did not go through. Reload the page and try again."
      : t.done === "added" && t.kind === "cluster"
        ? `Now tracking “${short(name)}” and 5 prompts. First results after tomorrow’s check, at ${next}.`
      : t.done === "added"
        ? `Now tracking “${short(name)}”. First results after tomorrow’s check, at ${next}.`
        : t.done === "moved" && t.kind === "prompt" && cluster
        ? `Moved “${short(name)}” into ${cluster.keyword ?? cluster.name}. It is asked every morning as before.`
        : t.done === "rekeyed"
        ? `Keyword changed to “${short(name)}”. Its prompts are kept, and the first check uses it tomorrow at ${next}.`
        : t.done === "saved"
        ? `Saved. The first check uses these prompts tomorrow at ${next}.`
        : t.done === "undone"
        ? `Undone. “${short(name)}” is still tracked.`
        : t.kind === "cluster" && cluster?.status === "pending"
          ? `Removed “${short(name)}” before its first check.`
          : t.kind === "cluster"
          ? `Stopped tracking “${short(name)}” and its prompts. Their history stays in your reports.`
          : `Stopped “${short(name)}”. Its history stays in your reports, and the slot is free for a new prompt.`;
  return (
    <div role="status" className="app-toast" style={{ position: "fixed", left: "50%", bottom: "32px", transform: "translateX(-50%)", zIndex: 20, display: "flex", alignItems: "center", gap: "16px", padding: "12px 12px 12px 18px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, boxShadow: "0 24px 60px -28px rgba(15,17,21,.6)", width: "max-content", maxWidth: "min(720px, calc(100vw - 32px))", boxSizing: "border-box" }}>
      <span>{text}</span>
      {canUndo && act ? (
        <StopForm act={act} kind={t.kind} id={t.id} undo style={{ flexShrink: 0, height: "36px", padding: "0 14px", border: 0, borderRadius: "10px", background: "rgba(255,255,255,.12)", color: T.surface, fontSize: "14px", fontWeight: 600 }}>
          Undo
        </StopForm>
      ) : null}
      <Link href={dismiss} scroll={false} aria-label="Dismiss" style={{ flexShrink: 0, width: "36px", height: "36px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.surface} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </Link>
    </div>
  );
}

/**
 * The pending cluster (part 2d): before its first check every live prompt is an
 * input, posted as `p-<id>` to /api/app/[client]/edit, which refuses any prompt
 * that has a reading. "Remove this cluster" is the stop form; a pending cluster
 * stopped today is never read. Two sibling forms, the Save button joined to its
 * form by `form=`, so neither nests and both post with JS off.
 *
 * DS3 (2 Oct 2026): a prompt moved in from ungrouped already has readings, so
 * the route would refuse its edit. It shows as text with refuseEdit's reason and
 * its own Stop, never as an input. The inputs join the edit form by `form=` too,
 * so a fixed row's stop form sits among them without nesting.
 */
function PendingEditor({
  c,
  kw,
  lead,
  act,
  subject,
  rekey = null,
  redraft = false,
  rekeyed = false,
  typed = null,
  next,
  firstAsk,
  origins = NO_ORIGINS,
  slug = "",
  mode = "off",
}: {
  c: ClusterCard;
  /**
   * 13 Oct 2026, DIY P6: each prompt's origin chip beside its angle, as the read rows draw it (P2's OriginChip,
   * unchanged), so a cluster just added from gaining ground says Momentum before its first check.
   */
  origins?: ReadonlyMap<string, PromptOrigin>;
  slug?: string;
  mode?: UpsellMode;
  kw: string;
  lead: string;
  act: NonNullable<Act>;
  /** Tomorrow's check time in the client's zone (check-time.ts). */
  next: string;
  /** When drafts saved now are first asked, said in the client's zone (setup-landing.ts firstAsked). */
  firstAsk: string;
  subject: Subject | null;
  rekey?: Rekeying | null;
  redraft?: boolean;
  rekeyed?: boolean;
  typed?: string | null;
}) {
  const formId = `edit-${c.id}`;
  const live = c.prompts.filter((p) => p.stoppedOn === null);
  const slots = c.prompts.filter((p) => p.stoppedOn !== null).slice(0, Math.max(0, 5 - live.length));
  // R179: "Redraft" fills the unread prompts' inputs with fresh drafts from the keyword, by angle; nothing changes until Save changes.
  const drafts = redraft && c.keyword ? draftPrompts(c.keyword) : null;
  // ON-1: no prompt at all yet, so nothing to edit or refill - the five drafts instead.
  const drafted = c.keyword && !c.prompts.length ? draftPrompts(c.keyword) : null;
  const draftFor = (p: { angle: string | null; text: string }, i: number) => (drafts ? (drafts[p.angle ? ANGLES.indexOf(p.angle as (typeof ANGLES)[number]) : i] ?? p.text) : p.text);
  const ck = rekey?.check ?? null;
  const route = (to: string) => act.action.replace(/\/stop$/, to);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "4px 24px 22px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "12px", background: T.wash }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }}>
          <path d="M4 20h4L19 9l-4-4L4 16v4z" />
          <path d="M13.5 6.5l4 4" />
        </svg>
        <span style={{ fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
          {/* ON-1 (9 Oct 2026): a started cluster with no keyword opens here too; its read prompts are fixed already. */}
          {c.status === "pending"
            ? `Edit freely until the first check, tomorrow at ${next}. After that a prompt can be stopped and replaced, not rewritten, so its history stays true to what was asked.`
            : `A keyword set now is checked from the next daily check, tomorrow at ${next}. A prompt with readings can be stopped and replaced, not rewritten, so its history stays true to what was asked.`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>Keyword</span>
        <span style={{ fontSize: "15px", fontWeight: 700, color: T.ink }}>{kw}</span>
        {lead ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 9px", borderRadius: "999px", background: T.goodBg, color: T.goodFg, fontSize: "12px", fontWeight: 600 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.goodFg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5L20 7" />
            </svg>
            {lead}
          </span>
        ) : null}
      </div>
      {/* R179: Change keyword runs the same Check keyword; a signed pass offers "Use" on its own form. Both siblings, JS off. */}
      <form method="post" action={`${route("/check")}?${new URLSearchParams(act.keep)}`} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <input id={`rk-card-${c.id}`} type="hidden" name="card" value={c.id} />
        <input id={`rk-own-${c.id}`} type="hidden" name="own" value={c.keyword ?? ""} />
        <input id={`rk-on-${c.id}`} type="hidden" name="on" value="clusters" />
        <label htmlFor={`rk-kw-${c.id}`} style={{ fontSize: "13px", fontWeight: 600, color: T.ink }}>
          {c.keyword ? "Change keyword" : "Add its keyword"}
        </label>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <input id={`rk-kw-${c.id}`} name="keyword" defaultValue={rekey?.kw || (c.keyword ?? typed ?? "")} required maxLength={ADMIN_LIMITS.question} placeholder="e.g. accounting software for dentists" aria-describedby={`rk-kw-${c.id}-note`} aria-invalid={ck?.ok === false ? true : undefined} autoFocus={ck?.ok === false} style={{ flex: "1 1 240px", minWidth: 0, height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "10px", fontFamily: "inherit", fontSize: "14px", color: T.ink, background: T.surface }} />
          <SubmitButton busy="Checking..." style={{ height: "44px", padding: "0 16px", border: `1px solid ${T.ink}`, borderRadius: "10px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "13px", fontWeight: 600 }}>
            Check keyword
          </SubmitButton>
        </div>
        <p id={`rk-kw-${c.id}-note`} role={ck ? (ck.ok ? "status" : "alert") : undefined} style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: ck ? (ck.ok ? T.goodFg : T.badFg) : T.soft }}>
          {/* DS59 (2 Oct 2026, R173 pass 6): a cluster with no keyword read "Until the first check you can change it" - there was nothing to change. */}
          {/* DS62 (2 Oct 2026, R173 pass 6): owners read "Give this cluster the keyword" while viewers and /setup read "We add its Google keyword for you" - both now say it. */}
          {/* ON-1 (9 Oct 2026, LB8): "or leave it and we add one for you" promised a person; a cluster with no prompt gets five drafted from the keyword set here. */}
          {ck ? ck.message : typed && !c.keyword ? "This is the keyword you gave at checkout. Check it, or type another; we check it has Google search volume and a buying intent." : !c.keyword ? `Give this cluster the Google keyword its ${PROMPTS_PER_CLUSTER} prompts are about. We check it has Google search volume and a buying intent; ${live.length ? "the prompts stay as they are" : `${PROMPTS_PER_CLUSTER} prompts are then drafted from it for you to edit`}.` : "Until the first check you can change it. We check it has Google search volume and a buying intent; the prompts stay as they are."}
        </p>
      </form>
      {ck?.ok && rekey?.sig ? (
        <form method="post" action={`${route("/keyword")}?${new URLSearchParams({ ...act.keep, kind: "cluster", id: c.id })}`}>
          <input id={`rk-use-kw-${c.id}`} type="hidden" name="keyword" value={ck.keyword} />
          <input id={`rk-use-vol-${c.id}`} type="hidden" name="vol" value={String(ck.volume)} />
          <input id={`rk-use-intent-${c.id}`} type="hidden" name="intent" value={ck.intent} />
          <input id={`rk-use-sig-${c.id}`} type="hidden" name="sig" value={rekey.sig} />
          <SubmitButton busy="Saving..." style={{ height: "44px", padding: "0 16px", border: 0, borderRadius: "10px", background: T.accent, color: T.surface, fontFamily: "inherit", fontSize: "13px", fontWeight: 600 }}>
            {`Use “${short(ck.keyword)}” for this cluster`}
          </SubmitButton>
        </form>
      ) : null}
      {rekeyed && c.keyword && live.some((p) => !p.fixed) ? (
        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.ink }}>
          {"Its prompts are kept. "}
          <Link href={`?${new URLSearchParams({ ...act.keep, open: c.id, redraft: c.id })}`} scroll={false} style={{ color: T.accent, fontWeight: 600 }}>
            {`Redraft them from “${short(c.keyword)}”`}
          </Link>
        </p>
      ) : null}
      {drafts ? (
        <p role="status" style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.ink }}>
          Fresh drafts are in the boxes below. Save changes to keep them, or leave the page to keep the old prompts.
        </p>
      ) : null}
      {/* ON-1 (9 Oct 2026, LB8): a keyword and no prompt - a signup with no scan - gets the five drafted from the keyword, saved through /prompt. */}
      {drafted ? <DraftPrompts id={`cl-draft-${c.id}`} action={`${route("/prompt")}?${new URLSearchParams({ ...act.keep, kind: "cluster", id: c.id })}`} keyword={c.keyword!} drafts={drafted} note={`Nothing in this cluster is checked until they are saved. Saved now, they are first asked ${firstAsk}.`} /> : null}
      <form id={formId} method="post" action={`${act.action.replace(/\/stop$/, "/edit")}?${new URLSearchParams({ ...act.keep, kind: "cluster", id: c.id })}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {live.map((p, i) => (
          <div key={p.id} className="app-cl-edit" style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", alignItems: "center", gap: "12px" }}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
              {p.fixed ? (
                <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: T.soft }}>{p.angle ?? "Prompt"}</span>
              ) : (
                <label htmlFor={`${formId}-${p.id}`} style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: T.soft }}>
                  {p.angle ?? "Prompt"}
                </label>
              )}
              <OriginChip origin={origins.get(p.id)} slug={slug} mode={mode} />
              {subject && namesBrandIn(p.text, subject) ? <BrandedChip /> : null}
            </span>
            {p.fixed ? (
              <span style={{ display: "flex", alignItems: "center", gap: "12px", minHeight: "44px", boxSizing: "border-box", padding: "6px 6px 6px 12px", border: `1px solid ${T.hair}`, borderRadius: "10px", background: T.bg, minWidth: 0 }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{p.text}</span>
                  <span style={{ fontSize: "12px", color: T.soft }}>{refuseEdit(1)}</span>
                </span>
                <StopForm act={act} kind="prompt" id={p.id} label={`Stop and add a new one: ${p.text}`} style={{ ...STOP_BTN, flexShrink: 0 }}>
                  {STOP_ICON}
                  Stop
                </StopForm>
              </span>
            ) : (
              <input key={drafts ? "draft" : "kept"} id={`${formId}-${p.id}`} form={formId} name={`p-${p.id}`} defaultValue={draftFor(p, i)} required minLength={PROMPT_MIN} maxLength={ADMIN_LIMITS.question} style={{ height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "10px", fontFamily: "inherit", fontSize: "14px", color: T.ink, background: T.surface, minWidth: 0 }} />
            )}
          </div>
        ))}
        {/* DS3: stopping a fixed prompt frees its place here too, so "add a new one" works before the first check. */}
        {slots.map((p) => (
          <div key={p.id} className="app-cl-edit" style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", alignItems: "center", gap: "12px" }}>
            <label htmlFor={`slot-${p.id}`} style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: T.soft }}>
              {p.angle ?? "Prompt"}
            </label>
            <form method="post" action={`${act.action.replace(/\/stop$/, "/prompt")}?${new URLSearchParams({ ...act.keep, kind: "cluster", id: c.id, ...(p.angle ? { angle: p.angle } : {}) })}`} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", minWidth: 0 }}>
              <input id={`slot-${p.id}`} name="text" required minLength={PROMPT_MIN} maxLength={ADMIN_LIMITS.question} placeholder={`A new ${p.angle ? `${p.angle} ` : ""}prompt about “${kw}”`} style={{ flex: "1 1 200px", minWidth: 0, height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px dashed ${T.washLine}`, borderRadius: "10px", fontFamily: "inherit", fontSize: "14px", color: T.ink, background: T.surface }} />
              <SubmitButton busy="Adding..." style={{ flexShrink: 0, height: "44px", padding: "0 14px", border: 0, borderRadius: "10px", background: T.accent, color: T.surface, fontFamily: "inherit", fontSize: "13px", fontWeight: 600 }}>
                Track this prompt
              </SubmitButton>
            </form>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}>
        <StopForm act={act} kind="cluster" id={c.id} style={{ height: "44px", padding: "0 16px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface, color: T.ink, fontSize: "14px", fontWeight: 600 }}>
          Remove this cluster
        </StopForm>
        {live.some((p) => !p.fixed) ? (
          <SubmitButton form={formId} busy="Saving..." style={{ height: "44px", padding: "0 18px", border: 0, borderRadius: "12px", background: T.accent, color: T.surface, fontFamily: "inherit", fontSize: "14px", fontWeight: 600 }}>
            Save changes
          </SubmitButton>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 13 Oct 2026, DIY P2 (spec 10 section 4.10): the prompts added from live
 * placements, under the 5 angle slots and outside them. Nomada adds and stops
 * these from its own placement log (placement-prompt.ts), so the rows carry no
 * Stop: a placement prompt ends when its placement is removed. Each row reads
 * as an angle prompt's does - the engines' days, the rate, the change - and a
 * first reading is shown, not scored.
 */
function FromPlacements({ prompts, origins, mode, slug, brand, pending, next, since, vs, basis }: { prompts: ClusterCard["prompts"]; origins: ReadonlyMap<string, PromptOrigin>; mode: UpsellMode; slug: string; brand: string; pending: boolean; next: string; since: string | null; vs: string | null; basis: string | null }) {
  const id = `fp-${prompts[0]!.id}`;
  return (
    <section aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
        <span id={id} style={{ fontSize: "14px", fontWeight: 700, color: T.ink }}>
          From placements
        </span>
        <span style={{ fontSize: "12px", color: T.soft }}>These don&apos;t use your 5 prompt slots.</span>
      </div>
      {/* 13 Oct 2026 review: the card's figures count these, so the like-for-like figure without them is beside them. */}
      {basis ? (
        <p data-basis="placements" style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: T.soft }}>
          {basis}
        </p>
      ) : null}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        {prompts.map((p) => (
          <li key={p.id} className="app-cl-prompt" data-placement-prompt={p.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 52px 76px", alignItems: "center", gap: "12px", minHeight: `${ROW_H}px`, boxSizing: "border-box", padding: "8px 12px 8px 14px", borderRadius: "12px", background: T.surface, border: `1px solid ${T.hair}`, opacity: p.stoppedOn !== null ? 0.6 : 1 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px", minWidth: 0 }}>
              <div className="app-cl-text-row" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <OriginChip origin={origins.get(p.id)} slug={slug} mode={mode} />
                <span title={p.text} className="app-cl-text" style={{ fontSize: "14px", fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.text}
                </span>
              </div>
              {p.stoppedOn !== null ? (
                <span style={{ fontSize: "12px", color: T.soft, fontWeight: 600 }}>{`Stopped from ${formatDay(p.stoppedOn)}. Its history stays in your reports.`}</span>
              ) : p.pending || (pending && !p.fixed) ? (
                <span style={{ fontSize: "12px", color: T.accent, fontWeight: 600 }}>{`First check tomorrow at ${next}`}</span>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  {p.daysNamed.map((d) => (
                    <span key={d.engine} title={`${ENGINE_SPECS[d.engine as Engine]?.label ?? d.engine}: named ${brand} on ${d.days} of ${d.of} days`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", opacity: d.days ? 1 : 0.4 }}>
                      <EngineLogo engine={d.engine as Engine} size={16} />
                      <span style={{ fontSize: "12px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{d.days}</span>
                    </span>
                  ))}
                  <span style={{ fontSize: "12px", color: T.soft }}>{daysOfLine(p)}</span>
                </div>
              )}
            </div>
            <span style={{ fontSize: "16px", fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={p.pending ? undefined : basisLine(p.now, "answers")}>
              {pctText(p.now.pct)}
            </span>
            <span style={{ display: "flex", justifyContent: "flex-end" }}>
              <Chip value={p.before && p.now.pct !== null && p.before.pct !== null ? p.now.pct - p.before.pct : null} unit=" pts" none={p.pending ? "Tomorrow" : since ? "New" : ""} vs={vs} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * `refill` (R103, 30 Sep 2026): the prompt just stopped. Once a prompt has a
 * reading its text is fixed, so a rewording is "Stop and add a new one": the
 * stop frees its slot at once, and that slot opens with the old text in it to
 * edit, as a new row with its own history.
 */
function ClusterRow({
  c: card,
  origins,
  mode,
  slug,
  brand,
  subject,
  open,
  toggle,
  since,
  act,
  refill,
  rekey = null,
  redraft = false,
  rekeyed = false,
  typed = null,
  next,
  openHref,
  vs = null,
  firstAsk,
}: {
  c: ClusterCard;
  /** DIY P2: each prompt's origin; placement prompts are drawn under the angle slots, not in them. */
  origins: ReadonlyMap<string, PromptOrigin>;
  mode: UpsellMode;
  slug: string;
  brand: string;
  subject: Subject | null;
  open: boolean;
  toggle: string;
  since: string | null;
  act: Act;
  refill: string | null;
  rekey?: Rekeying | null;
  redraft?: boolean;
  rekeyed?: boolean;
  typed?: string | null;
  /** Tomorrow's check time in the client's zone (check-time.ts). */
  next: string;
  openHref: string;
  /** ON-3: what every change is against (Overview.tsx Chip's `vs`). */
  vs?: string | null;
  /** When drafts saved now are first asked (setup-landing.ts firstAsked). */
  firstAsk: string;
}) {
  // 13 Oct 2026, DIY P2: the card's prompts in its angle slots, and the placement prompts beside them (spec 4.10).
  // Every figure on the card still counts them all, as the Overview's do; the slots, the list and its editor take the
  // angle prompts only. 13 Oct 2026 review: so the card says it counts them, and gives the figure without them (basis.ts).
  const c: ClusterCard = { ...card, prompts: card.prompts.filter((p) => !isPlacementPrompt(origins, p.id)) };
  const fromPlacements = card.prompts.filter((p) => isPlacementPrompt(origins, p.id));
  const pending = card.status === "pending";
  const placed = pending ? null : placementBasis(card.prompts, origins);
  // A stop made today shows until tomorrow's check, with Undo; the slot is already free.
  const stopped = c.stoppedOn !== null;
  // ON-1: no prompt in it at all - a signup with no scan - so nothing in it is checked yet.
  const bare = !stopped && c.prompts.length === 0;
  const undoable = !!act && stopped && c.stoppedOn! > act.today;
  // The free slot (part 2c): a live cluster with fewer than 5 live prompts offers
  // the place of a stopped one, at its angle, to owners and editors.
  const free = Math.max(0, 5 - c.prompts.filter((p) => p.stoppedOn === null).length);
  const slots = new Set(act && !stopped && !pending ? c.prompts.filter((p) => p.stoppedOn !== null).slice(0, free).map((p) => p.id) : []);
  const kw = c.keyword ?? c.name;
  const basis = pendingBasis(c);
  const vol = c.volume !== null ? `${c.volume.toLocaleString("en-GB")} searches a month` : null;
  const lead = [c.intent ? cap(c.intent) : null, vol].filter(Boolean).join(", ");
  const meta = stopped
    ? `${lead ? `${lead}. ` : ""}Stopped from ${formatDay(c.stoppedOn!)}. Its history stays in your reports`
    : pending
      ? `${lead ? `${lead}. ` : ""}Added today, first check tomorrow at ${next}${basis ? `. ${basis}` : ""}`
      : `${lead ? `${lead}. ` : ""}Since ${formatDay(c.started_on)}${placed ? `. ${includesLine(placed.count).slice(0, -1)}` : ""}`;
  const named = namedCount(card);
  const mid = BLOCK_H / 2;
  return (
    <div style={{ borderTop: `1px solid ${T.line}`, background: open ? T.bg : T.surface }}>
      <Link href={toggle} scroll={false} aria-expanded={open} className="app-cl-grid" style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", gap: "16px", padding: "16px 24px", color: T.ink, textDecoration: "none" }}>
        <span aria-hidden="true" style={{ display: "flex", width: "28px", height: "28px", alignItems: "center", justifyContent: "center", borderRadius: "8px", background: T.chip, transform: `rotate(${open ? 90 : 0}deg)` }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
          <span style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "-0.01em" }}>{kw}</span>
          <span style={{ fontSize: "12px", color: T.soft }}>{meta}</span>
        </span>
        <span className="app-hide-sm" style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <span style={{ fontSize: "12px", color: T.soft }}>{pending ? "Checked from tomorrow" : `${named} of ${card.prompts.length} name you`}</span>
          <span style={{ display: "flex", gap: "4px" }}>
            {card.prompts.map((p) => {
              const fill = pending && !p.fixed ? T.wash : p.now.num > 0 ? T.accent : T.line;
              return <span key={p.id} style={{ width: "22px", height: "8px", borderRadius: "4px", background: fill }} />;
            })}
          </span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          <span style={{ fontSize: "12px", color: T.soft }}>AI answers</span>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "17px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title={pending ? (basis ?? undefined) : basisLine(c.now, "answers")}>
              {pctText(c.now.pct)}
            </span>
            <Chip value={c.delta} unit=" pts" none={noChange(c)} vs={vs} />
          </span>
        </span>
        <span className="app-hide-sm" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          <span style={{ fontSize: "12px", color: T.soft }}>Google</span>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "17px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c.position === null ? "-" : `#${c.position}`}</span>
            <PositionChip c={c} vs={vs} />
          </span>
        </span>
      </Link>

      {/* ON-1 (9 Oct 2026, LB8): a cluster with no keyword and nothing read is edited as a pending one - its first keyword can be set at any time (rekey.ts keywordless). */}
      {open && (pending || (c.keyword === null && !c.prompts.some((p) => p.fixed))) && act && !stopped ? (
        <PendingEditor c={c} kw={kw} lead={lead} act={act} subject={subject} rekey={rekey} redraft={redraft} rekeyed={rekeyed} typed={typed} next={next} firstAsk={firstAsk} origins={origins} slug={slug} mode={mode} />
      ) : open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "4px 24px 22px" }}>
          {act && bare && c.keyword ? (
            <DraftPrompts id={`cl-draft-${c.id}`} action={`${act.action.replace(/\/stop$/, "/prompt")}?${new URLSearchParams({ ...act.keep, kind: "cluster", id: c.id })}`} keyword={c.keyword} drafts={draftPrompts(c.keyword)} note={`Nothing in this cluster is checked until they are saved. Saved now, they are first asked ${firstAsk}.`} />
          ) : null}
          <div className="app-cl-body" style={{ display: "flex", alignItems: "center" }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px", flexGrow: 1, minWidth: 0 }}>
              {c.prompts.map((p) => act && slots.has(p.id) ? (
                <li key={p.id} className="app-cl-prompt" style={{ minHeight: `${ROW_H}px`, boxSizing: "border-box", padding: "8px 12px 8px 14px", borderRadius: "12px", background: T.surface, border: `1px dashed ${T.washLine}`, display: "flex", alignItems: "center" }}>
                  <form method="post" action={`${act.action.replace(/\/stop$/, "/prompt")}?${new URLSearchParams({ ...act.keep, kind: "cluster", id: c.id, ...(p.angle ? { angle: p.angle } : {}) })}`} style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", flexWrap: "wrap" }}>
                    {/* DS70: a viewer reads the stopped prompt in this row; an owner or editor read only the empty slot. */}
                    {p.stoppedOn !== null && p.id !== refill ? (
                      // Wraps, never an ellipsis: cut at 1280 it lost "Its history stays in your reports." (R151, 3 Oct 2026).
                      <span style={{ flexBasis: "100%", minWidth: 0, fontSize: "12px", lineHeight: 1.4, color: T.soft, fontWeight: 600, overflowWrap: "anywhere" }}>{`“${p.text}” stopped from ${formatDay(p.stoppedOn)}. Its history stays in your reports.`}</span>
                    ) : null}
                    <span style={{ flexShrink: 0, padding: "2px 8px", borderRadius: "6px", background: T.chip, color: T.soft, fontSize: "11px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase" }}>{p.angle ?? "Prompt"}</span>
                    <label htmlFor={`slot-${p.id}`} className="sr-only">{`A new ${p.angle ? `${p.angle} ` : ""}prompt about ${kw}`}</label>
                    <input id={`slot-${p.id}`} name="text" defaultValue={p.id === refill ? p.text : undefined} required minLength={PROMPT_MIN} maxLength={ADMIN_LIMITS.question} placeholder={`A new ${p.angle ? `${p.angle} ` : ""}prompt about “${kw}”`} style={{ flex: "1 1 200px", minWidth: 0, height: "40px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "10px", fontFamily: "inherit", fontSize: "14px", color: T.ink, background: T.surface }} />
                    <SubmitButton busy="Adding..." style={{ flexShrink: 0, height: "40px", padding: "0 14px", border: 0, borderRadius: "10px", background: T.accent, color: T.surface, fontFamily: "inherit", fontSize: "13px", fontWeight: 600 }}>
                      {/* The board's word here is the alwaystracked CTA's label, which only pricing.ts may type (tier-action.test.mts); a slot is not a sign-up. */}
                      Track this prompt
                    </SubmitButton>
                  </form>
                </li>
              ) : (
                <li key={p.id} className="app-cl-prompt" style={{ display: "grid", gridTemplateColumns: act ? "minmax(0, 1fr) 52px 76px auto" : "minmax(0, 1fr) 52px 76px", alignItems: "center", gap: "12px", minHeight: `${ROW_H}px`, boxSizing: "border-box", padding: "8px 12px 8px 14px", borderRadius: "12px", background: T.surface, border: `1px solid ${T.hair}`, opacity: p.stoppedOn !== null && !stopped ? 0.6 : 1 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "7px", minWidth: 0 }}>
                    <div className="app-cl-text-row" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <span style={{ flexShrink: 0, padding: "2px 8px", borderRadius: "6px", background: T.chip, color: T.soft, fontSize: "11px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase" }}>{p.angle ?? "Prompt"}</span>
                      <OriginChip origin={origins.get(p.id)} slug={slug} mode={mode} />
                      <span title={p.text} className="app-cl-text" style={{ fontSize: "14px", fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.text}
                      </span>
                      {subject && namesBrandIn(p.text, subject) ? <BrandedChip /> : null}
                    </div>
                    {p.stoppedOn !== null && !stopped ? (
                      <span style={{ fontSize: "12px", color: T.soft, fontWeight: 600 }}>{`Stopped from ${formatDay(p.stoppedOn)}. Its history stays in your reports.`}</span>
                    ) : pending && !p.fixed ? (
                      <span style={{ fontSize: "12px", color: T.accent, fontWeight: 600 }}>{`First check tomorrow at ${next}`}</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                        {p.daysNamed.map((d) => (
                          <span key={d.engine} title={`${ENGINE_SPECS[d.engine as Engine]?.label ?? d.engine}: named ${brand} on ${d.days} of ${d.of} days`} style={{ display: "inline-flex", alignItems: "center", gap: "4px", opacity: d.days ? 1 : 0.4 }}>
                            <EngineLogo engine={d.engine as Engine} size={16} />
                            <span style={{ fontSize: "12px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{d.days}</span>
                          </span>
                        ))}
                        <span style={{ fontSize: "12px", color: T.soft }}>{daysOfLine(p)}</span>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: "16px", fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={pending ? undefined : basisLine(p.now, "answers")}>
                    {pctText(p.now.pct)}
                  </span>
                  <span style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Chip value={p.before && p.now.pct !== null && p.before.pct !== null ? p.now.pct - p.before.pct : null} unit=" pts" none={pending ? "Tomorrow" : since ? "New" : ""} vs={vs} />
                  </span>
                  {act ? (
                    !stopped && p.stoppedOn === null ? (
                      <StopForm act={act} kind="prompt" id={p.id} label={p.now.den > 0 ? `Stop and add a new one: ${p.text}` : `Stop tracking: ${p.text}`} style={STOP_BTN}>
                        {STOP_ICON}
                        Stop
                      </StopForm>
                    ) : !stopped && p.stoppedOn !== null && p.stoppedOn > act.today ? (
                      <StopForm act={act} kind="prompt" id={p.id} undo label={`Undo stop: ${p.text}`} style={STOP_BTN}>
                        Undo
                      </StopForm>
                    ) : (
                      <span />
                    )
                  ) : null}
                </li>
              ))}
            </ul>
            <svg className="app-hide-sm" width="64" height={BLOCK_H} viewBox={`0 0 64 ${BLOCK_H}`} aria-hidden="true" style={{ flexShrink: 0 }}>
              {c.prompts.map((p, i) => {
                const y = ROW_H / 2 + i * PITCH;
                const on = !pending && p.now.num > 0;
                return <path key={p.id} d={`M0,${y} C35,${y} 29,${mid} 64,${mid}`} fill="none" stroke={pending ? T.washLine : on ? T.accent : T.line} strokeWidth={1.8} strokeDasharray={on ? undefined : "3 4"} strokeLinecap="round" />;
              })}
              <circle cx={61} cy={mid} r={4} fill={T.accent} />
            </svg>
            <div className="app-cl-kw" style={{ width: "256px", flexShrink: 0, boxSizing: "border-box", padding: "18px", borderRadius: "14px", border: `1px solid ${T.washLine}`, background: T.surface, display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>Google keyword</span>
              <span style={{ fontSize: "16px", fontWeight: 700, lineHeight: 1.3 }}>{c.keyword ?? "Needs a keyword"}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                <span style={{ fontSize: "36px", fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{c.position === null ? "-" : `#${c.position}`}</span>
                <PositionChip c={c} vs={vs} />
              </span>
              <span style={{ fontSize: "13px", color: T.soft }}>
                {/* R148 pass 9 (1 Oct 2026): a signup whose scan chose no keyword left "-" with no next step; nomada picks it (signup.ts order email). */}
                {/* ON-1 (9 Oct 2026): "We add its Google keyword for you" promised a person. */}
                {/* ON-1 review (9 Oct 2026): its prompts have readings, so it keeps no keyword it never had (rekey.ts keywordless). */}
                {c.keyword === null ? (act ? "No keyword yet. Its prompts are already read, so for a keyword, stop this cluster and add a new one with it." : "No keyword yet.") : c.positionBefore !== null && since ? `was #${c.positionBefore} on ${since}` : pending ? `First check tomorrow at ${next}` : `Tracked since ${formatDay(c.started_on)}`}
              </span>
              {c.intent || vol ? (
                <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {c.intent ? <span style={{ padding: "3px 9px", borderRadius: "999px", background: T.wash, color: T.accent, fontSize: "12px", fontWeight: 600 }}>{cap(c.intent)}</span> : null}
                  {c.volume !== null ? <span style={{ padding: "3px 9px", borderRadius: "999px", background: T.chip, color: T.ink, fontSize: "12px", fontWeight: 600 }}>{`${c.volume.toLocaleString("en-GB")} a month`}</span> : null}
                </span>
              ) : null}
              {/* R179: after the first reading the keyword is fixed; the way to a new one is a new cluster, and the stop has Undo until the next check. */}
              {act && !pending && !stopped ? (
                <span style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: `1px solid ${T.line}`, paddingTop: "10px" }}>
                  <span style={{ fontSize: "12px", lineHeight: 1.5, color: T.soft }}>{KEYWORD_FIXED_NOTE}</span>
                  <StopForm act={act} kind="cluster" id={c.id} style={{ ...STOP_BTN, width: "100%", justifyContent: "center" }}>
                    Stop this cluster and add a new one
                  </StopForm>
                </span>
              ) : null}
              {/* R90 sweep: Questions.dc.html closes the card on the ranking page, as OneCluster does. */}
              {!pending && subject ? (
                <span style={{ display: "flex", flexDirection: "column", gap: "2px", borderTop: `1px solid ${T.line}` }}>
                  <span style={{ fontSize: "12px", color: T.soft, paddingTop: "10px" }}>Your ranking page</span>
                  <span style={{ fontSize: "13px", fontWeight: 500 }}>{c.keyword === null ? "Once its keyword is added" : c.position === null ? "None in the top 20" : subject.domain}</span>
                </span>
              ) : null}
            </div>
          </div>
          {fromPlacements.length ? <FromPlacements prompts={fromPlacements} origins={origins} mode={mode} slug={slug} brand={brand} pending={pending} next={next} since={since} vs={vs} basis={placed ? placementBasisLine(placed) : null} /> : null}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "13px", color: T.soft }}>
              {c.status === "added" ? `Added ${formatDay(c.started_on)}, so there is no earlier period to compare against yet.` : pending ? `Its prompts are asked from tomorrow's check, at ${next}.` : "Dates and comparisons apply to the prompts and the keyword alike."}
            </span>
            <span style={{ display: "flex", gap: "10px" }}>
              {/* T7: the board's "Open cluster" goes to QuestionDetail, the one-cluster page, for every role. */}
              <Link href={openHref} data-usage="detail_open" style={{ ...BTN, textDecoration: "none" }}>
                Open cluster
                {CHEVRON}
              </Link>
              {act && (!stopped || undoable) ? (
                <StopForm act={act} kind="cluster" id={c.id} undo={stopped} style={BTN}>
                  {stopped ? null : STOP_ICON}
                  {stopped ? "Undo stop" : "Stop tracking this cluster"}
                </StopForm>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
