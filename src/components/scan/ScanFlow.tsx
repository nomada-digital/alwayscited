"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { SCAN_LIMITS } from "@/config/contact";
import { MICRO, SHELL, T } from "@/config/tokens";
import { track } from "@/lib/analytics";
import type {
  EngineBreakdown,
  Market,
  RunScanResponse,
  ScanOpportunity,
  ScanQuestion,
} from "@/lib/scan";
import { type FullInput, type FullPayload, asFull } from "@/lib/scan/full-payload";
import { OFFER_AFTER_MS, OFFER_COPY, OFFER_STEP, offerReady } from "@/lib/scan/email-offer";
import type { MarketReason } from "@/lib/scan/market-pick";
import { type EngineResult, parseEngineResults } from "@/lib/scan/engine-results";
import { ENGINE_SPECS, isEngine, knownEngines } from "@/lib/scan/engines";
// The words the pipeline writes into `scans.step`, mapped back to a position.
// Derived from the same list the captions and the bar come from, because this
// map used to be a hand-typed second copy of that vocabulary: a step renamed
// in the pipeline read as `undefined` here and silently froze the progress bar
// for the rest of the run. See lib/scan/run-steps.ts.
import { ANSWERS_STEP, RUN_STEPS, STEP_INDEX, stepCaption } from "@/lib/scan/run-steps";

import ProcessSequence, { WAITING_TEMPO } from "@/components/ProcessSequence";

import ConfirmScreen from "./ConfirmScreen";
import ScanProgress from "./ScanProgress";
import { MAIL_OUTCOMES, type MailOutcome } from "@/lib/scan/mail-outcome";
import type { WalkthroughOutcome } from "@/lib/scan/walkthrough-outcome";
import { isWorkEmail } from "@/lib/work-email";

import ResultView from "./ResultView";
import { field } from "./screens";

/**
 * The scan, on its own page, from confirm to report.
 *
 * Four screens rather than one panel that changes, which is what the flow
 * boards describe: a confirm step wide enough to show fourteen questions, the
 * run, the free result, and the report an address unlocks. The token is in the
 * URL, so a reload, a second device or the link in the email all land on the
 * same scan rather than an empty form.
 *
 * The gated half is genuinely absent, not hidden: the rows behind the blur are
 * never sent until the address is given, and the unlock response is the first
 * time the placement list crosses the wire.
 *
 * Since 20260919000000 the leaderboard and the whole source list come down in
 * the teaser, so they are free. The email buys the placement list - the pages
 * feeding answers the brand is missing from - and nothing else.
 */

type Phase = "confirm" | "running" | "result";

type ByEngine = { engine: string; asked: number; answered: number; named: number };

type TeaserSource = {
  source: string;
  mentions: number;
  is_own_domain: boolean;
  kind?: string | null;
  note?: string | null;
};

/**
 * A question row as the teaser actually sends it.
 *
 * `google_rank` is optional here and required on `ScanQuestion`, and that gap
 * is the whole defect: the RPC did not select the column until 20260919210000,
 * so every teaser said the key was there and none of them carried it. Declaring
 * the teaser's own shape means a deploy reading an older RPC typechecks as what
 * it is - a row with no rank - rather than borrowing the contract's promise.
 *
 * `answers` is absent for the same kind of reason: the verbatim answers are
 * what the address buys and never reach a teaser.
 */
type TeaserQuestion = Omit<ScanQuestion, "google_rank" | "answers"> & {
  google_rank?: number | null;
};

type Teaser = {
  brand: string | null;
  topic: string | null;
  market: Market | null;
  status: string;
  step: string | null;
  read_at: string | null;
  named: number;
  of: number;
  engines: string[] | null;
  engines_answered: string[] | null;
  by_engine: ByEngine[] | null;
  rank: number | null;
  brand_count: number;
  /**
   * A model batch failed while this leaderboard was built, so names are missing
   * from it. Optional: a teaser read from a deploy older than 20260919130000
   * does not carry the key, and undefined has to mean "not partial" there -
   * which is the same answer that deploy gives today.
   */
  leaderboard_partial?: boolean;
  /** The whole leaderboard, summed across engines. Free since 20260919000000. */
  brands: { brand: string; mentions: number; is_subject: boolean }[] | null;
  /** The four most-cited. Kept so a teaser read before that migration still renders. */
  top_sources: TeaserSource[] | null;
  /** Every cited source. Free since 20260919000000. */
  all_sources: TeaserSource[] | null;
  total_sources: number;
  /** The questions asked, with tallies. Free - see Prompts in ResultDashboard. */
  questions: TeaserQuestion[] | null;
};

/**
 * The gated engine list, in prose: "ChatGPT, Gemini and Perplexity".
 *
 * `knownEngines` rather than a bare filter. The only caller passes
 * `gatedEngines`, which is the `scans.gated_engines` jsonb column - straight
 * off the row on first render, and off the poll response after that. A
 * repeated name read back as "Gemini and Gemini" in the sentence that tells a
 * visitor what their email bought, while the pass that name belongs to asked
 * it once: `pipeline.ts` takes the same column through a Set.
 *
 * Found by `engine-list-readers.test.mts` while that sweep was being written,
 * against an exemption claiming this list was `Object.keys` and could not
 * repeat. It was not; the exemption was wrong and is gone.
 */
function engineLabels(keys: string[]): string {
  const names = knownEngines(keys).map((k) => ENGINE_SPECS[k].label);
  if (names.length <= 1) return names[0] ?? "";
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function toBreakdown(rows: ByEngine[] | null): EngineBreakdown[] {
  return (rows ?? [])
    .filter((r) => isEngine(r.engine))
    .map((r) => ({
      engine: r.engine,
      label: ENGINE_SPECS[r.engine as keyof typeof ENGINE_SPECS].label,
      kind: ENGINE_SPECS[r.engine as keyof typeof ENGINE_SPECS].kind,
      asked: r.asked,
      answered: r.answered,
      named: r.named,
    }));
}

const POLL_MS = 2500;
/**
 * When to admit this is running long. It has to sit above a normal finish or
 * it cries wolf on every scan - at 45s it fired about a minute before the
 * average run completed, which taught people the message means nothing.
 */
const SLOW_MS = 150_000;
/**
 * When to stop waiting altogether.
 *
 * Nothing on the server can move a scan after this. Every route that runs a
 * pass declares maxDuration = 300, and the pipeline now gives up at 270 and
 * writes status failed - both held by `src/app/api/run-duration.test.mts`,
 * which also pins this constant above the reaper's. So a scan still reading at six minutes is not slow -
 * it is a function that was killed with the row left at running, and the row
 * will stay that way for ever. This poll had no end, so that visitor sat on a
 * progress bar for as long as they were willing to, and the one message they
 * got said it was taking a while.
 *
 * Landing them back on confirm is the honest end, and a second run works now
 * that a retried pass can store its answers over the ones the failed pass
 * left. The copy does not promise their edits survived, because the screen is
 * unmounted on the way to running and comes back written afresh - see
 * worklog.md, which is a separate job on the same path.
 */
const STUCK_MS = 6 * 60 * 1000;

/**
 * What a visitor is told about a pass that did not finish.
 *
 * One constant because it is now said on two paths that have to agree. The poll
 * said it and the server render did not: `status` arrives here as "failed" -
 * from the pipeline's own catch, or from `isFreePassDead` on a row the platform
 * killed - and "failed" falls through the phase test below to "confirm", with
 * `error` still empty. So a visitor who reloaded, or came back to a stalled scan
 * on the link in their email, was put back on step 1 with a fresh question
 * preview and no indication that anything had happened, while the visitor who
 * happened to still have the tab open was told plainly.
 *
 * Landing on confirm is the right screen either way - the confirm route accepts
 * a re-run for both kinds of failure. What was missing is the sentence saying
 * why they are looking at it.
 */
/**
 * The second sentence is a promise the code now keeps rather than reassurance.
 * Danny decided on 20 September 2026 that a pass we failed is ours and must not
 * be charged against the visitor's allowance, and /api/scan/start no longer
 * counts rows at status 'failed' towards the per-IP limit. Saying it here is
 * the half of that decision the visitor can see: the retry link is in front of
 * somebody who has just watched a scan die, and "you can run it again" reads as
 * a suggestion they may have already paid for unless the cost is named.
 */
const RUN_FAILED =
  "We could not finish that check. You can run it again - a run that fails on our side does not count against your free scans.";

/** Teaser plus whatever has been unlocked, in the shape the screens render. */
function toResult(t: Teaser, domain: string, full: FullPayload | null): RunScanResponse {
  const top = t.top_sources?.[0];
  /* The teaser carries the whole leaderboard and every source now, so both are
     free. The unlock payload is preferred only because it also carries the URLs
     behind each source; where it is absent the teaser is not a lesser copy. */
  const leaderboard = full?.brands ?? t.brands ?? [];
  const sourceRows: {
    source: string;
    mentions: number;
    kind?: string | null;
    note?: string | null;
  }[] = full?.sources ?? t.all_sources ?? t.top_sources ?? [];
  const subject = leaderboard.find((b) => b.is_subject);
  const totalMentions = leaderboard.reduce((a, b) => a + b.mentions, 0);
  /**
   * Three of the figures below are counted *against* the leaderboard rather
   * than read off it, so a leaderboard short of a batch makes all three wrong
   * in the flattering direction: a better rank, a smaller field, a larger share
   * of a smaller total. They are nulled here rather than in the view so the
   * wrong number never reaches a renderer at all - the counts themselves are
   * measured and stay.
   */
  const partial = t.leaderboard_partial === true;
  /**
   * Every engine answered nothing. That is a real finding and the report says
   * so out loud, which is why the length guard matters: by_engine comes back
   * null from the teaser when there are no answer rows to aggregate over, and
   * [].every() is true - so an absent breakdown published the same sentence as
   * a measured silence. Not measured and measured zero are different findings,
   * which is the rule the rest of this file already keeps.
   */
  const byEngine = t.by_engine ?? [];
  const silent = t.of > 0 && byEngine.length > 0 && byEngine.every((e) => e.answered === 0);

  return {
    scan_id: "",
    platform: "google",
    read_at: (t.read_at ?? new Date().toISOString()).slice(0, 10),
    topic: t.topic ?? "",
    market: t.market ?? "US",
    brand: {
      name: t.brand ?? domain,
      named_in: t.named,
      of: t.of,
      rank: partial ? null : t.rank,
      of_brands: partial ? null : t.brand_count || null,
      // Needs the whole leaderboard, which the teaser now sends. Still null on a
      // scan whose brand extraction found nobody, which is absent, not zero.
      share_of_voice:
        !partial && subject && totalMentions > 0
          ? Math.round((subject.mentions / totalMentions) * 100)
          : null,
    },
    engines: toBreakdown(t.by_engine),
    top_source: top ? { domain: top.source, brand_present: top.is_own_domain } : null,
    // is_subject is carried rather than dropped: the view used to re-derive it
    // by comparing spellings against brand.name, which is a second judge of a
    // fact the server already settled. See LeaderboardEntry.
    leaderboard: leaderboard.map((b) => ({
      brand: b.brand,
      mentions: b.mentions,
      is_subject: b.is_subject,
    })),
    sources: sourceRows.map((s) => ({
      domain: s.source,
      mentions: s.mentions,
      kind: s.kind ?? null,
      note: s.note ?? null,
    })),
    history: [],
    /**
     * The rank comes from whichever side of the gate carried it.
     *
     * Tested for the key rather than for a value, because null here is a
     * measurement - "not in Google's top twenty" - and folding it into the
     * fallback with `??` would let an older teaser's silence overwrite it. Only
     * a key that is genuinely absent falls through to the unlock payload, and
     * when neither has one the field stays null, which both renderers read as
     * nothing to show.
     */
    questions: (t.questions ?? []).map((q) => {
      const detail = full?.questions?.find((d) => d.idx === q.idx);
      const google_rank = "google_rank" in q ? (q.google_rank ?? null) : (detail?.google_rank ?? null);
      // The keyword trio (R43) by the same rule: the teaser's key when the RPC
      // carries it, else the unlock payload's, else absent - the old line. A
      // scan with a cluster keyword (BRIEF-3 C1) is the exception: the teaser
      // reads the rows, which carry no keyword on those scans, so the payload's
      // cluster keyword wins.
      const keyword = "target_keyword" in q && !(full?.cluster_keyword && detail)
        ? {}
        : detail && "target_keyword" in detail
          ? { target_keyword: detail.target_keyword, search_volume: detail.search_volume, keyword_rank: detail.keyword_rank }
          : {};
      return detail ? { ...q, ...keyword, google_rank, answers: detail.engines } : { ...q, ...keyword, google_rank };
    }),
    opportunities: full?.opportunities ?? undefined,
    cluster_keyword: full?.cluster ?? null,
    gated: !full,
    leaderboard_partial: partial,
    // Every engine answering nothing is a real finding, not an error.
    empty: silent,
    reason: silent ? "None of the engines produced an answer for these prompts yet." : null,
  };
}

export default function ScanFlow(p: {
  token: string;
  domain: string;
  brand: string | null;
  positioning: string | null;
  topic: string;
  market: Market;
  /** Why the market was picked, for the line under the toggle. See market-pick.ts. */
  marketReason?: MarketReason | null;
  variants: string[];
  /** The scan status as the server read it, which decides where we open. */
  status: string;
  /** The engines this scan reads, frozen onto the row at start. */
  engines: string[];
  gatedEngines: string[];
  /** The result, read on the server for a scan that has already finished. */
  initialTeaser?: Teaser | null;
  /**
   * Whether the server found this scan unlocked. Distinct from initialFull
   * being present: the report can fail to build for a scan that is unlocked,
   * and the two used to be indistinguishable from in here.
   */
  unlocked?: boolean;
  /** The unlocked half, read on the server for a scan that has been unlocked. */
  initialFull?: FullInput | null;
  /**
   * How many placements are behind the gate, counted on the server for a
   * finished scan that is still locked.
   *
   * Same reason initialTeaser exists: the gate leads on this number, and
   * fetching it from the browser meant the first paint drew a blurred table
   * and generic copy which then changed under the reader. Null is "not
   * counted", which the client still resolves for itself; 0 is a counted
   * zero and is not the same thing.
   */
  initialOppCount?: number | null;
  /** R151: the walkthrough ask's outcome, after it posted without script. */
  walkthrough?: WalkthroughOutcome | null;
  /** R151: the report-email offer's outcome, after it posted without script. */
  mail?: MailOutcome | null;
  /**
   * The gated pass as the server found it on the row.
   *
   * This defaulted to "none" and was only ever corrected by the /full fetch -
   * which a server-rendered report never makes, because `full` is already in
   * the page. So the primary unlock path was the broken one: the verify link
   * queues the gated pass, redirects here, and the first thing the reader was
   * told is that those engines "have not run for this scan". The poll below
   * only starts on queued or running, so nothing corrected it either; the pass
   * finished, the answers landed in the database, and the page kept saying it
   * had not happened until somebody reloaded.
   */
  initialGatedStatus?: string;
}) {
  const [phase, setPhase] = useState<Phase>(
    p.status === "complete" ? "result" : p.status === "queued" || p.status === "running" ? "running" : "confirm",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(p.status === "failed" ? RUN_FAILED : "");
  /** An unlocked scan whose report would not load. Not the same thing as a gate. */
  const [fullError, setFullError] = useState("");

  const [progress, setProgress] = useState(0);
  const [slow, setSlow] = useState(false);
  /**
   * The engines that have already finished, with what each one found.
   *
   * Danny's item 4: the screen showed nothing until every read was in, so the
   * visitor waited out the slowest engine to learn the first fact. These arrive
   * on the ordinary status poll and the waiting screen reveals them one at a
   * time.
   */
  const [landed, setLanded] = useState<EngineResult[]>([]);
  /**
   * The result is on screen and the run is still finishing (Danny, 2 Oct
   * 2026). Set when the answers are stored (`ANSWERS_STEP`): the prompts and
   * every answer are final, and the sections that wait on the brand and source
   * work say they are still loading until the scan completes.
   */
  const [partial, setPartial] = useState(false);
  /** The rest of a partial result did not arrive. Said in the sections that were waiting. */
  const [restError, setRestError] = useState("");
  /** How many questions this run asks. Known once confirmed on this page; not on a reload mid-run. */
  const [runCount, setRunCount] = useState<number | null>(null);

  /**
   * The offer to email the result, and everything it needs - Danny's item 5.
   *
   * `mailAt` is a ref rather than state on purpose: it holds the moment the
   * reads began, and the offer's clock must not restart when the step advances
   * from `reading` to `sources`. As state it would re-run the effect below and
   * push the offer back by nine seconds every time the bar moved, which is
   * exactly the stretch of the run it exists to cover.
   */
  const mailAt = useRef<number | null>(null);
  const [offer, setOffer] = useState(false);
  const [mailTo, setMailTo] = useState("");
  // R151: seeded from ?mail= when the form posted without script.
  const [mailErr, setMailErr] = useState(p.mail && !MAIL_OUTCOMES[p.mail].ok ? MAIL_OUTCOMES[p.mail].message : "");
  const [mailNote, setMailNote] = useState(p.mail && MAIL_OUTCOMES[p.mail].ok ? MAIL_OUTCOMES[p.mail].message : "");
  const [mailBusy, setMailBusy] = useState(false);

  /** The answers are stored and the result is on its way: say so while it loads. */
  const [drawing, setDrawing] = useState(false);

  const [teaser, setTeaser] = useState<Teaser | null>(p.initialTeaser ?? null);
  const [full, setFull] = useState<FullPayload | null>(p.initialFull ? asFull(p.initialFull) : null);
  const [gatedEngines, setGatedEngines] = useState<string[]>(p.gatedEngines);
  const [gatedStatus, setGatedStatus] = useState<string>(p.initialGatedStatus ?? "none");
  /**
   * How many placement opportunities are waiting behind the gate. Fetched on
   * its own, from a route that returns counts and nothing else, so a locked
   * screen can say what it is holding without the domains ever reaching it.
   */
  const [oppCount, setOppCount] = useState<number | null>(p.initialOppCount ?? null);


  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  const loadTeaser = useCallback(async (): Promise<Teaser> => {
    const res = await fetch("/api/scan/" + p.token, { cache: "no-store" });
    if (!res.ok) throw new Error("could not load the result");
    return (await res.json()) as Teaser;
  }, [p.token]);

  // ---- arriving at a finished scan ----
  // Only what the server did not already supply. A 403 on the report is still
  // treated as the ordinary case rather than a failure, because the server can
  // report a scan as unlocked that the route then disagrees about.
  useEffect(() => {
    if (phase !== "result") return;
    /**
     * Both halves are normally rendered into the page on the server, so this
     * is the recovery path for the two ways that can come up short: a teaser
     * the RPC would not return, and - on a scan the server has told us is
     * unlocked - a report whose build threw.
     *
     * The second condition is the one that was missing. The guard read "or
     * teaser", so a server-rendered teaser short-circuited the whole effect
     * and the report was never asked for again: a visitor who had given their
     * address was shown the gate as though they never had.
     */
    const needTeaser = !teaser;
    // Always, once finished: nothing is gated any more.
    const needFull = !full;
    if (!needTeaser && !needFull) return;
    let stop = false;

    (async () => {
      if (needTeaser) {
        try {
          const t = await loadTeaser();
          if (stop) return;
          setTeaser(t);
        } catch {
          if (!stop) setError("We could not load that result.");
          return;
        }
      }
      if (!needFull) return;

      try {
        const res = await fetch("/api/scan/" + p.token + "/full", { cache: "no-store" });
        if (stop) return;
        if (!res.ok) {
          /**
           * 403 is the gate doing its job - this scan was never unlocked, and
           * the gated view is the right screen for it.
           *
           * Anything else is a scan that IS unlocked whose report would not
           * load. Falling through to the gate there shows a visitor who has
           * already given an address the wall again, as though they had never
           * given one, which reads as losing the report rather than as a
           * failure to fetch it.
           */
          if (res.status !== 403) {
            setFullError("We could not load your full report just now. Refresh the page, or open the link in your email again.");
          }
          return;
        }
        const data = await res.json();
        setFull(asFull(data));
        setGatedEngines(data.gated_engines ?? p.gatedEngines);
        setGatedStatus(data.gated_status ?? "none");
      } catch {
        // A dropped request is not a failed unlock. The gated view renders,
        // and a refresh asks again.
      }
    })();

    return () => {
      stop = true;
    };
  }, [phase, teaser, full, p.unlocked, loadTeaser, p.token, p.gatedEngines]);

  // ---- the run: poll the real status, never a fake timer ----
  useEffect(() => {
    if (phase !== "running") return;
    let stop = false;
    setDrawing(false);

    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
    const stuckTimer = setTimeout(() => {
      stop = true;
      setError("That check stopped before it finished. You can run it again.");
      setPhase("confirm");
    }, STUCK_MS);

    async function poll() {
      if (stop) return;
      try {
        const res = await fetch("/api/scan/" + p.token + "/status", { cache: "no-store" });
        const data = await res.json();

        const step = typeof data.step === "string" ? STEP_INDEX.get(data.step) : undefined;
        if (step !== undefined) setProgress(step);

        /**
         * An engine that has landed never un-lands.
         *
         * The list only grows within a pass, so the longer answer is always the
         * newer one - and taking only the longer one is what makes a stale read
         * harmless. Two engines finishing within a few milliseconds issue two
         * writes of one column, and `readAndStore` chains them for exactly this
         * reason; this is the same guarantee at the other end, where it costs a
         * comparison. A chip that appears and then disappears reads as a
         * measurement being withdrawn, on the screen this feature exists to put
         * a fact on.
         */
        const rows = parseEngineResults(data.engine_results);
        setLanded((prev) => (rows.length > prev.length ? rows : prev));

        /**
         * The answers are stored: draw the result now and let the rest land
         * into it. Both reads have to succeed, or this stays on the waiting
         * screen and asks again next tick - a half-drawn result with no
         * answers would be worse than the wait.
         */
        if (data.status === "running" && step !== undefined && step >= ANSWERS_STEP) {
          setDrawing(true);
          try {
            const [t, res] = await Promise.all([loadTeaser(), fetch("/api/scan/" + p.token + "/full", { cache: "no-store" })]);
            if (stop) return;
            if (res.ok) {
              const body = await res.json();
              /**
               * In a transition, so the waiting screen keeps animating while
               * React builds the result and swaps it in when it is ready.
               * Drawn as one blocking render, the 130 KB result froze the
               * tier sequence for as long as the render took.
               */
              startTransition(() => {
                setTeaser(t);
                setFull(asFull(body));
                setPartial(body.partial === true);
                setPhase("result");
              });
              return;
            }
          } catch {
            // Not yet. The waiting screen stays and the next tick tries again.
          }
          setDrawing(false);
        }

        if (data.status === "complete") {
          /**
           * `RUN_STEPS.length`, not a typed 3.
           *
           * This said `setProgress(3)` and it meant "one past the last rung",
           * which `stepPct` answers with `DONE_PCT`. That was true while the
           * ladder had three rungs and stopped being true the moment it gained
           * two more on 20 September 2026: step 3 became a real rung at 91%, so
           * a completed scan would have finished its run by moving the bar to
           * 91% and then swapping the panel out.
           *
           * **This repo's own named defect species** - a fixed rung picked by
           * index against a list that can grow - arriving in the same push that
           * grew the list, in the one file the change did not otherwise touch.
           * The fixed-index census was run and declared exhausted on 20 Sep;
           * this line was inside it and correct at the time, which is the point.
           * Derived now, so the next rung costs nothing here.
           */
          setProgress(RUN_STEPS.length);
          setTeaser(await loadTeaser());
          setPhase("result");
          track("free_scan_complete", { cached: false });
          return;
        }
        if (data.status === "failed") {
          // Our own sentence, not the one the pipeline threw. That text is
          // written for whoever is fixing it and can name a table, a constraint
          // or a vendor; the status route no longer sends it, and this is what
          // it is replaced by. The action is the same either way, and it is on
          // the screen they land back on.
          setError(RUN_FAILED);
          setPhase("confirm");
          return;
        }
      } catch {
        // A dropped poll is not a failed scan. Try again on the next tick.
      }
      if (!stop) setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      stop = true;
      clearTimeout(slowTimer);
      clearTimeout(stuckTimer);
    };
  }, [phase, p.token, loadTeaser]);

  // ---- a partial result: keep polling until the run finishes ----
  useEffect(() => {
    if (phase !== "result" || !partial) return;
    let stop = false;
    const stuckTimer = setTimeout(() => {
      stop = true;
      setRestError("The rest of this scan stopped before it finished. Refresh the page to check again.");
    }, STUCK_MS);

    async function poll() {
      if (stop) return;
      try {
        const res = await fetch("/api/scan/" + p.token + "/status", { cache: "no-store" });
        const data = await res.json();
        const step = typeof data.step === "string" ? STEP_INDEX.get(data.step) : undefined;
        if (step !== undefined) setProgress(step);

        if (data.status === "complete") {
          const [t, res] = await Promise.all([loadTeaser(), fetch("/api/scan/" + p.token + "/full", { cache: "no-store" })]);
          if (stop) return;
          if (res.ok) {
            setTeaser(t);
            setFull(asFull(await res.json()));
            setPartial(false);
            track("free_scan_complete", { cached: false });
            return;
          }
        }
        if (data.status === "failed") {
          setRestError("The rest of this scan did not finish. The answers above are complete; you can run it again from the start.");
          return;
        }
      } catch {
        // A dropped poll is not a failed scan. Try again on the next tick.
      }
      if (!stop) setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      stop = true;
      clearTimeout(stuckTimer);
    };
  }, [phase, partial, p.token, loadTeaser]);

  /**
   * When to offer to email it - tied to the run, not to page load.
   *
   * The clock starts when the engine reads start, because that is the phase
   * that takes the time: a scan four seconds into question generation has
   * nothing to email, and an offer there reads as an apology for a wait that
   * has not happened. `offerReady` holds both conditions and is executable;
   * this effect is only the clock.
   *
   * The remaining wait is computed from the stored moment rather than being a
   * fresh `OFFER_AFTER_MS` each time, so a step change mid-countdown does not
   * extend it.
   */
  useEffect(() => {
    if (phase !== "running") {
      mailAt.current = null;
      return;
    }
    if (progress < OFFER_STEP) return;
    if (mailAt.current === null) mailAt.current = Date.now();
    const since = Date.now() - mailAt.current;
    if (offerReady(progress, since)) {
      setOffer(true);
      return;
    }
    const t = setTimeout(() => setOffer(true), OFFER_AFTER_MS - since);
    return () => clearTimeout(t);
  }, [phase, progress]);

  // ---- what the gate is holding: the count, never the rows ----
  useEffect(() => {
    if (phase !== "result" || full || oppCount !== null) return;
    let stop = false;
    (async () => {
      try {
        const res = await fetch("/api/scan/" + p.token + "/opportunities", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number; ready?: boolean };
        if (!stop && data.ready) setOppCount(data.count ?? 0);
      } catch {
        // The gate reads fine without a number. Falling back to the generic
        // copy is better than blocking the screen on a count.
      }
    })();
    return () => {
      stop = true;
    };
  }, [p.token, phase, full, oppCount]);

  // ---- after unlock: the engines the email bought are still running ----
  useEffect(() => {
    if (!full) return;
    if (gatedStatus !== "queued" && gatedStatus !== "running") return;
    let stop = false;

    async function poll() {
      if (stop) return;
      try {
        const res = await fetch("/api/scan/" + p.token + "/status", { cache: "no-store" });
        const data = await res.json();
        setGatedStatus(data.gated_status ?? "none");

        if (data.gated_status === "complete") {
          // Re-read the teaser so the per-engine breakdown now includes them.
          setTeaser(await loadTeaser());
          return;
        }
        if (data.gated_status === "failed") return;
      } catch {
        // A dropped poll is not a failure. Try again on the next tick.
      }
      if (!stop) setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      stop = true;
    };
  }, [p.token, full, gatedStatus, loadTeaser]);

  // ---- step 1: the confirmed category, market and question set ----
  async function onRun(input: {
    topic: string;
    market: Market;
    questions: { question: string; kind: string }[];
  }): Promise<string | null> {
    setBusy(true);
    setError("");
    try {
      const headers = new Headers();
      headers.set("content-type", "application/json");
      const res = await fetch("/api/scan/" + p.token + "/confirm", {
        method: "POST",
        headers,
        body: JSON.stringify({
          topic: input.topic,
          market: input.market,
          topic_variants: p.variants,
          questions: input.questions,
        }),
      });
      const data = await res.json();
      if (!res.ok) return data.message ?? "We could not start that check.";

      if (data.status === "complete") {
        /**
         * The confirm route answering "complete" is the domain cache handing
         * back a scan for this (domain, market) that has already run. It is a
         * completed scan like any other and the poll's counterpart event
         * already carries `cached: false`, so this one was simply missing -
         * every cache hit finished the funnel without firing scan_completed at
         * all, which understates completions by exactly the scans that cost
         * nothing to serve.
         */
        setPhase("result");
        track("free_scan_complete", { cached: true });
        return null;
      }
      setProgress(0);
      setSlow(false);
      // A re-run measures again from nothing. Carrying the previous attempt's
      // verdicts into it would show the visitor figures from the pass that
      // failed, under a bar that has just gone back to the start.
      setLanded([]);
      setRunCount(input.questions.length);
      // The offer earns its place again on the new run. The address is not
      // cleared: it is on the row already and the same person is still waiting,
      // so a re-run that finishes mails them exactly as the first would have.
      setOffer(false);
      mailAt.current = null;
      setPhase("running");
      // No topic: a category in the visitor's own words can identify them (15 Oct 2026).
      track("scan_confirmed", { market: input.market, questions: input.questions.length });
      return null;
    } catch {
      return "We could not reach the checker. Please try again.";
    } finally {
      setBusy(false);
    }
  }

  /**
   * Take an address for the result, while the scan is still running.
   *
   * The route only writes it to the row - the message is sent by whichever of
   * the pipeline or the route notices the pass is finished - so there is
   * nothing here that a closed tab can interrupt. That is the promise this
   * panel makes and it is kept by where the address lives, not by this handler.
   *
   * On success the form is replaced by its own confirmation rather than being
   * cleared: the one thing this visitor needs to be told is that they may now
   * leave.
   */
  async function onMailRequest(e: React.FormEvent) {
    e.preventDefault();
    if (mailTo.trim() && !isWorkEmail(mailTo)) {
      setMailErr(MAIL_OUTCOMES.personal.message);
      return;
    }
    setMailErr("");
    setMailBusy(true);
    try {
      const headers = new Headers();
      headers.set("content-type", "application/json");
      const res = await fetch("/api/scan/" + p.token + "/email-report", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: mailTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMailErr(data.message ?? "We could not save that address. Please try again.");
        return;
      }
      setMailNote(data.message ?? OFFER_COPY.queued);
      // A lead: mark free_scan_email as a key event in GA4. Never the address.
      track("free_scan_email", { lead_type: "scan_email" });
    } catch {
      setMailErr("We could not reach the checker. Please try again.");
    } finally {
      setMailBusy(false);
    }
  }

  const result = teaser ? toResult(teaser, p.domain, full) : null;
  const sourceCount = teaser?.total_sources ?? 0;
  /**
   * The gated list, narrowed once, and then both named and counted off the same
   * value.
   *
   * `gatedEngines` is the `scans.gated_engines` jsonb column - a hand-editable
   * array, straight off the row on first render and off the poll after that.
   * `engineLabels` puts it through `knownEngines`, so the SENTENCE drops a name
   * this build does not know. Every gate below used to count the raw array, so
   * the BRANCH did not.
   *
   * They disagree exactly when the column holds a name that is not an engine,
   * which is an ordinary state for that column and one this repo has already
   * typed once (`google_ai` for `google_aio`). The length was 1, so the branch
   * fired; the names were "", so the clause it fired rendered as "plus the same
   * questions put through ." - a sentence stopping mid-clause on the gate that
   * takes the visitor's email address.
   *
   * Derived here rather than filtered at the three places that set the state:
   * three entry points is three places for the next change to miss one. One
   * value, so the count and the sentence cannot come apart.
   * `engine-count-doors.test.mts` holds it.
   */
  const gatedKnown = knownEngines(gatedEngines);
  const engineNames = engineLabels(gatedKnown);

  const stepLabel =
    phase === "confirm"
      ? "Step 1 of 3 · Confirm"
      : phase === "running"
        ? "Step 2 of 3 · Running"
        : "Step 3 of 3 · Result";

  /**
   * Nothing to place them into, and we knew it before the address was asked
   * for.
   *
   * oppCount is 0 once the count route has answered and null until it has, and
   * 0 is falsy - so a scan with no derivable placements fell through to the
   * copy below and promised a list the unlock then renders as "none this
   * time". The gate and the report disagreed, and the gate was the one taking
   * the email address.
   *
   * This is the ordinary case rather than an edge. Of the five completed scans
   * in production that have never been unlocked, three derive zero
   * opportunities - including one whose brand is named in every answer, which
   * is the best possible result and the emptiest possible list.
   *
   * The report still holds something real: what each engine said word for
   * word, and the per-question breakdown. So the gate stays and sells that.
   */
  const noPlacements = oppCount === 0;

  return (
    <div>
      <div style={{ borderBottom: "1px solid " + T.line }}>
        <div style={{ ...SHELL, padding: "14px 24px", display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={MICRO}>{p.brand ?? p.domain}</span>
          <div style={{ flexGrow: 1 }} />
          <span style={MICRO}>{stepLabel}</span>
        </div>
      </div>

      <div style={{ ...SHELL, padding: "40px 24px 0" }}>
        <p aria-live="polite" className="sr-only">
          {phase === "running" ? "Checking. " + OFFER_COPY.wait : ""}
        </p>

        {phase === "confirm" ? (
          <ConfirmScreen
            token={p.token}
            domain={p.domain}
            brand={p.brand}
            positioning={p.positioning}
            initialTopic={p.topic}
            initialMarket={p.market}
            marketReason={p.marketReason ?? null}
            variants={p.variants}
            onRun={onRun}
            running={busy}
          />
        ) : null}

        {phase === "confirm" && error ? (
          <p role="alert" style={{ fontSize: "13px", color: T.badFg, marginTop: "16px" }}>
            {error}
          </p>
        ) : null}

        {/* HeroSequence.dc.html: the scan on the left, the offer to email it
            in a card beside it, then the four tiers under a line saying what
            they are. The offer belongs to neither the measurement nor the
            explanation, so it is its own card rather than part of either.

            Every word of the offer lives in email-offer.ts so that a test can
            execute it. What it must not do is promise the placement list,
            which is what the gate further down sells. */}
        {phase === "running" ? (
          <div className="run-top">
            <ScanProgress
              domain={p.domain}
              engines={p.engines}
              questions={runCount}
              landed={landed}
              step={progress}
              slow={slow}
              drawing={drawing}
              headingRef={headingRef}
            />
          <div
            style={{
              background: T.surface,
              border: "1px solid " + T.line,
              borderRadius: 16,
              padding: "18px 20px",
            }}
          >
            {mailNote ? (
              <p aria-live="polite" style={{ fontSize: "14px", color: T.ink, margin: 0, lineHeight: 1.6 }}>
                {mailNote}
              </p>
            ) : (
              <form action={"/api/scan/" + p.token + "/email-report"} method="post" onSubmit={onMailRequest} noValidate>
                <p style={{ fontSize: "14px", fontWeight: 700, color: T.ink, margin: 0 }}>{OFFER_COPY.heading}</p>
                <p style={{ fontSize: "13px", color: T.soft, margin: "3px 0 0", lineHeight: 1.5 }}>
                  {OFFER_COPY.body}
                </p>
                <label htmlFor="scan-mail-to" className="sr-only">
                  {OFFER_COPY.label}
                </label>
                <div className="run-mail">
                <input
                  id="scan-mail-to"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder={OFFER_COPY.placeholder}
                  maxLength={SCAN_LIMITS.email}
                  required
                  value={mailTo}
                  onChange={(e) => setMailTo(e.target.value)}
                  style={{ ...field, flexGrow: 1, minWidth: 0, width: "auto", fontSize: "14px", border: "1px solid " + T.line, borderRadius: "10px", padding: "0 12px", minHeight: "44px" }}
                  aria-invalid={Boolean(mailErr)}
                  aria-describedby={mailErr ? "scan-mail-error" : undefined}
                />
                <button
                  type="submit"
                  className="btn-primary run-mail-btn"
                  disabled={mailBusy}
                >
                  {mailBusy ? OFFER_COPY.sending : OFFER_COPY.submit}
                </button>
                </div>
                {/* Announced, for the reason the gate's own error is: a refused
                    address on a form somebody is about to walk away from is a
                    button that appears to do nothing. */}
                {mailErr ? (
                  <p
                    id="scan-mail-error"
                    role="alert"
                    style={{ fontSize: "0.8125rem", color: T.badFg, marginTop: "0.5rem" }}
                  >
                    {mailErr}
                  </p>
                ) : null}
                {/* Not on the board. The address is collected here, so the
                    line saying what it is for ships with it. */}
                <p style={{ fontSize: "12px", color: T.soft, margin: "10px 0 0", lineHeight: 1.5 }}>
                  {OFFER_COPY.privacy} <a href="/legal">What we collect</a>.
                </p>
              </form>
            )}
          </div>
          </div>
        ) : null}

        {/* ProcessSequence is the same four beats the homepage runs, which is
            the point of it - a visitor who sees both is told one thing, not
            two. */}
        {phase === "running" ? (
          <>
            <p style={{ margin: "40px 0 0", fontSize: "13px", fontWeight: 600, color: T.soft, textAlign: "center" }}>
              While you wait: what happens after the scan
            </p>
            <div style={{ marginTop: "20px" }}>
              <ProcessSequence tempo={WAITING_TEMPO} pinOnHover={false} />
            </div>
          </>
        ) : null}

        {phase === "result" && result && fullError ? (
          <p
            role="alert"
            style={{
              fontSize: "0.8125rem",
              color: T.badFg,
              border: "1px solid " + T.line,
              borderRadius: 12,
              padding: "0.75rem 1rem",
              margin: "0 0 1rem",
              lineHeight: 1.6,
            }}
          >
            {fullError}
          </p>
        ) : null}

        {phase === "result" && result ? (
          <ResultView
            r={result}
            domain={p.domain}
            token={p.token}
            walkthrough={p.walkthrough}
            noPlacements={noPlacements}
            pending={partial ? { caption: stepCaption(progress), error: restError || null } : null}
          />
        ) : null}

        {phase === "result" && !result && error ? (
          <p role="alert" style={{ fontSize: "13px", color: T.badFg }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
