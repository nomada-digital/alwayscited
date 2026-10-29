import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ScanFlow from "@/components/scan/ScanFlow";
import { isScanMarket, type Market } from "@/lib/scan/domain";
import { PARTNER_MARKETS } from "@/lib/scan/handoff";
import { readMailOutcome } from "@/lib/scan/mail-outcome";
import type { MarketReason } from "@/lib/scan/market-pick";
import { publicTeaser } from "@/lib/scan/opportunities";
import { isFreePassDead, isGatedPassDead } from "@/lib/scan/stall";
import { readWalkthroughOutcome } from "@/lib/scan/walkthrough-outcome";
import { buildUnlockPayload, opportunityShape, type UnlockPayload } from "@/lib/scan/unlock";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * A scan, by its link.
 *
 * The whole flow lives here now: confirm what we read off the site, the run,
 * the free result, and the report an address unlocks. The email link and the
 * magic link both land here too, so a visitor coming back on another device
 * gets their scan rather than an empty form.
 *
 * Not indexed. Every one of these is somebody's own result.
 */
export const metadata: Metadata = {
  title: "Your AI visibility report",
  robots: { index: false, follow: false },
};

export default async function ScanTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  // R151 (3 Oct 2026): the walkthrough ask posted without script comes back here with only its outcome.
  const query = await searchParams;
  const walkthrough = readWalkthroughOutcome(query.walkthrough);
  const mail = readMailOutcome(query.mail);

  const db = supabaseAdmin();
  const { data: scan, error: scanErr } = await db
    .from("scans")
    .select(
      "id, brand_name, domain, positioning, topic, topic_variants, market, ref, status, engines, gated_engines, gated_status, unlocked_at, started_at, queued_at",
    )
    .eq("public_token", token)
    .maybeSingle();

  /**
   * A read that failed is not a scan that does not exist.
   *
   * The error was discarded, so a database that did not answer rendered the 404
   * page - "this is not a page we have" - to somebody following the link to
   * their own report from their own inbox. It is a false statement and a
   * terminal one: nothing on that page suggests the link is worth clicking
   * again, and the scan is sitting there intact.
   *
   * Thrown rather than handled here, because error.tsx is already written for
   * exactly this: it leads on "trying again is worth doing first - most of what
   * fails here is a read that timed out", offers the retry, and prints the
   * digest that ties the visitor's screen to the line in the log. notFound()
   * stays for a token that genuinely matches nothing.
   */
  if (scanErr) throw new Error("could not read the scan behind a report link: " + scanErr.message);
  if (!scan) notFound();

  /**
   * A finished scan arrives with its result already in the page.
   *
   * It used to render an empty shell and fetch the teaser from the browser,
   * which meant the person who followed a link from their inbox watched a
   * blank page decide what to show them. The same two calls the API routes
   * make, made here instead, and the client only polls for what is still
   * moving.
   */
  const complete = scan.status === "complete";

  /**
   * A read that failed is not a result with nothing in it.
   *
   * This was the one read on this page that discarded its own error, in a file
   * where the three around it each carry a comment about exactly that defect.
   * It was written `(await db.rpc(...)).data`, so the result was consumed
   * inline and bound to nothing - which is why neither sweep next door could
   * see it. The route that makes this same call separates the two outcomes and
   * answers 500 against 404; here they collapsed into one null.
   *
   * Logged and degraded to the client fetch rather than thrown, which is the
   * argument `full` makes twenty lines down and it holds harder here: the
   * teaser is the free result screen, ScanFlow already re-asks for it through
   * `needTeaser`, and /api/scan/[token] reports the failure with a message and
   * a refresh behind it. Throwing would take the whole page down for a fault
   * the client recovers from on its own.
   *
   * What changes is that the failure is now visible in the log. A silent null
   * here looked identical to a scan the RPC had no rows for, so a `scan_teaser`
   * failing in production left no trace at all - only a visitor being told, by
   * the client, that we could not load their result.
   */
  let teaser = null;
  if (complete) {
    const { data: teaserData, error: teaserErr } = await db.rpc("scan_teaser", { p_token: token });
    if (teaserErr) {
      console.error(`[scan] could not read the teaser for ${scan.id}:`, teaserErr.message);
    } else {
      teaser = publicTeaser(teaserData);
    }
  }

  // Every finished scan is open - the email gate came off on 24 Sep 2026.
  const unlocked = complete;

  /**
   * A read that fails is not a report with nothing in it.
   *
   * /full wraps this same call for exactly that reason, so a database fault
   * reaches the screen as a failure rather than as an empty report. Rendering
   * it here bypassed the wrapper: an unlocked visitor following the link in
   * their email got a 500 instead of their report, on the one path that link
   * actually takes. It degrades to the client fetch now, which has the message
   * for it and a refresh behind it.
   */
  let full: UnlockPayload | null = null;
  if (unlocked) {
    try {
      full = await buildUnlockPayload(scan.id as string);
    } catch (err) {
      console.error(`[scan] could not render the report for ${scan.id}:`, err);
    }
  }

  /**
   * What the gate is holding, counted here rather than from the browser.
   *
   * The gate leads on this number, and a zero is as much a finding as a
   * fourteen: a scan with nothing to place into must not blur a table and ask
   * for an address for rows that are not there. Counting it on the client meant
   * the first paint always drew the blur and the promise, then corrected
   * itself - so the reader saw the wrong version first, and a reader who never
   * ran the script saw only the wrong version.
   *
   * Only for a finished scan that is still locked. Unlocked scans have the
   * rows themselves in `full`, and an unfinished one has nothing to count.
   *
   * Never fatal. The gate reads perfectly well without a number - it falls
   * back to the copy that does not name one - so a failure here degrades to
   * the client fetch rather than taking the page down.
   */
  let oppCount: number | null = null;
  if (complete && !unlocked) {
    try {
      oppCount = (await opportunityShape(scan.id as string)).count;
    } catch (err) {
      console.error(`[scan] could not count opportunities for ${scan.id}:`, err);
    }
  }

  const brand = (scan.brand_name as string | null) ?? null;
  const positioning = (scan.positioning as string | null) ?? null;
  const topic = (scan.topic as string | null) ?? "";
  const variants = (scan.topic_variants as string[] | null) ?? [];
  const engines = (scan.engines as string[] | null) ?? [];
  const gated = (scan.gated_engines as string[] | null) ?? [];
  /**
   * How far the gated pass has got, read here rather than defaulted in the
   * browser.
   *
   * The verify link calls completeUnlock, which stamps gated_status 'queued'
   * and starts the pass in after(), then redirects straight here - so this
   * page renders, every time, while that pass is queued or running. The client
   * assumed "none" and only learned otherwise from the /full fetch, which a
   * server-rendered report does not make. The banner therefore told the reader
   * the gated engines had not run, on the one screen the email exists to
   * deliver, and never took it back.
   */
  const gatedStatus = isGatedPassDead(scan) ? "failed" : ((scan.gated_status as string | null) ?? "none");
  const market = isScanMarket(scan.market) ? scan.market : "US";
  // The confirm screen's two markets: US and Jamaica on a scan from a partner that offers Jamaica (29 Oct 2026), else UK and US.
  const markets: Market[] = (PARTNER_MARKETS.get((scan.ref as string | null) ?? "") ?? []).includes("JM") ? ["US", "JM"] : ["UK", "US"];

  /**
   * Why that market, for the line under the confirm screen's toggle. Read on
   * its own so a database without the 20260925000000 column still renders the
   * report - it only loses the sentence.
   */
  let marketReason: MarketReason | null = null;
  if (scan.status === "pending_topic") {
    const { data: reasonRow, error: reasonErr } = await db.from("scans").select("market_reason").eq("id", scan.id).maybeSingle();
    // Logged, not thrown: a missing column costs the sentence, never the page.
    if (reasonErr) console.warn(`[scan] could not read the market reason for ${token}: ${reasonErr.message}`);
    const r = (reasonRow as { market_reason?: string | null } | null)?.market_reason;
    if (r === "chosen" || r === "domain ending" || r === "rankings" || r === "default") marketReason = r;
  }

  /**
   * A pass the platform killed renders as failed, not as still running.
   *
   * ScanFlow picks its opening phase from this prop: queued or running puts the
   * visitor straight onto the progress screen. Passing the column verbatim
   * meant a row left at `running` by a killed function did that on first load
   * and again on every reload - a fresh six-minute wait each time, on a row
   * nothing server-side would ever move, with the six-minute timer the only
   * thing that ever ended it.
   *
   * `failed` opens on confirm with the offer to run it again, which the confirm
   * route now accepts. Same judgement, same helper, same answer as the status
   * poll - they disagreed about a stalled scan otherwise, and the one a visitor
   * saw depended on whether they had loaded the page or polled it.
   */
  const status = isFreePassDead(scan) ? "failed" : (scan.status as string);

  return (
    <ScanFlow
      token={token}
      walkthrough={walkthrough}
      mail={mail}
      domain={scan.domain as string}
      brand={brand}
      positioning={positioning}
      topic={topic}
      market={market}
      markets={markets}
      marketReason={marketReason}
      variants={variants}
      status={status}
      engines={engines}
      initialTeaser={teaser}
      initialFull={full}
      unlocked={unlocked}
      gatedEngines={gated}
      initialGatedStatus={gatedStatus}
      initialOppCount={oppCount}
    />
  );
}
