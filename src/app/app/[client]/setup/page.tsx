import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import BrandMark from "@/components/BrandMark";
import TierName, { type TierKey } from "@/components/TierName";
import { ungroupedShown } from "@/components/app/Clusters";
import DraftPrompts from "@/components/app/DraftPrompts";
import SubmitButton from "@/components/app/SubmitButton";
import { CONTACT_EMAIL } from "@/config/contact";
import { nextSteps } from "@/config/onboarding";
import { contactUrlFor } from "@/config/pricing";
import { CARD, MICRO, T } from "@/config/tokens";
import { keywordForm } from "@/lib/scan/dataforseo-request";
import { MARKETS, isMarket } from "@/lib/scan/domain";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";
import { verdictFromQuery } from "@/lib/tracking/add-cluster";
import { checkTime } from "@/lib/tracking/check-time";
import { addDays } from "@/lib/tracking/figures";
import { prefillCard } from "@/lib/tracking/order-keyword";
import { loginHref } from "@/lib/tracking/next-path";
import { placedTier } from "@/lib/tracking/placement-figures";
import { writeRole } from "@/lib/tracking/member";
import { trackingRepo } from "@/lib/tracking/repo";
import { confirmLabel, firstAsked, setupCards, setupChecks } from "@/lib/tracking/setup-landing";
import { draftAt, draftsFor, draftsLine } from "@/lib/tracking/setup-drafts";
import { refuseRole } from "@/lib/tracking/stop";
import { appPath, siteHref } from "@/lib/app-host";
import SetupSuggestions from "@/components/app/google/SetupSuggestions";
import { loadFootprint } from "@/lib/diy/keywords/data";
import { trackedSet } from "@/lib/diy/keywords/momentum";
import { footprintFacts, setupSuggestions } from "@/lib/diy/keywords/setup-suggestions";
import { readOnlyReason } from "@/lib/diy/keywords/write";
import { fixtureMode } from "@/lib/tracking/fixture-mode";

export const dynamic = "force-dynamic";
// Drawn again from the router's memory for 300 s after a visit (13 Oct 2026, src/components/app/fresh.ts).
// A literal, because Next reads it at build; prefetch.test.mts holds it equal to FRESH_SECONDS.
export const unstable_dynamicStaleTime = 300;
export const runtime = "nodejs";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Set up your clusters - alwaystracked dashboard",
  robots: { index: false, follow: false },
};

const ANGLE: Record<string, string> = { category: "Category", positioning: "Positioning", sector: "Sector", outcome: "Outcome", comparison: "Comparison" };

const BUTTON = { display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "48px", padding: "12px 18px", borderRadius: "10px", border: "none", background: T.accent, color: "#ffffff", fontWeight: 600, fontSize: "15px" } as const;

/** 44px tall at any width: the help block is the page's way out. */
const HELP_LINK = { display: "inline-flex", alignItems: "center", minHeight: "44px", color: T.accent, fontWeight: 600 } as const;

const KW_INPUT = { flex: "1 1 240px", minWidth: 0, height: "48px", boxSizing: "border-box", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "12px", fontFamily: "inherit", fontSize: "15px", color: T.ink, background: T.surface } as const;

const CHECK_BUTTON = { height: "48px", padding: "0 18px", border: `1px solid ${T.ink}`, borderRadius: "12px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "14px", fontWeight: 600 } as const;

const STEP ={ ...MICRO, display: "block", marginBottom: "8px" } as const;

/**
 * A new client's setup (R166 part 3b, Danny, danny.md line 175): step 1
 * welcome, step 2 one card per cluster bought with its keyword and the scan's
 * prompts, step 3 review and confirm. One page, so it works without script.
 * Confirm posts to /api/app/[client]/setup, which writes setup_confirmed.
 * Since part 3c it is the sign-in landing for a client bought from 2 Oct.
 *
 * Part 5 (2 Oct 2026): each card has Check keyword, the Clusters page's
 * check (a POST to /check carrying the card's id), which 303s back here at
 * that card with the verdict. A pass rides into Confirm as hidden fields
 * and is named in our setup mail; nothing changes on the cluster itself.
 *
 * ON-1 (9 Oct 2026, launch blocker LB8): a card with a keyword and no
 * prompt - a signup with no scan, once "Use this keyword" has set one - shows
 * the five prompts drafted from that keyword in editable fields (DraftPrompts),
 * and Save writes them through the free slot's route as the Clusters page
 * writes prompts. Nothing waits on a person: the cluster is read from the next
 * daily check. Owners and editors only; viewers and an ended client read.
 *
 * 13 Oct 2026, DIY P6 (spec 10 section 4.12): step 2 gains "Suggested
 * keywords" when a Google footprint exists - up to 10 the site already ranks
 * for, with gaining ground and the checkout keyword - each running the same
 * Check keyword on the card that needs one. Once confirmed, the page says the
 * site and Google reads happen overnight, only while diy_enabled is on (the
 * confirm route queues them: enqueueOnboarding). Both read the stored
 * footprint only; neither shows while it is switched off.
 */
export default async function ClientSetup({
  params,
  searchParams,
}: {
  params: Promise<{ client: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const repo = trackingRepo();
  const email = await repo.sessionEmail();
  const sp = await searchParams;
  if (!email) redirect(loginHref(appPath(`/${(await params).client}/setup`), sp));
  const { client: slug } = await params;
  const clients = await repo.clientsFor(email);
  const client = clients.find((c) => c.slug === slug);
  if (!client) notFound();
  const tier = (client.tier as TierKey) ?? "tracked";
  const today = repo.today();
  // ON-1 review (9 Oct 2026): first checks are said from now in the client's zone, not from London's tracking day.
  const now = repo.now();
  // perf-4 (8 Oct 2026): setup draws the clusters, prompts and keywords only, so no answer is read.
  const [structure, confirmed, typed, footprint, aliases] = await Promise.all([
    repo.structure(client.id),
    repo.setupConfirmed(client.id),
    repo.orderKeyword(client.id),
    loadFootprint(client.id),
    // DIY P6: the brand's aliases for the brand rule; the footprint read carries them in production.
    fixtureMode() ? repo.settings(client.id).then((s) => s.aliases).catch(() => [] as string[]) : Promise.resolve(null),
  ]);
  const cards = setupCards(structure);
  const ungrouped = ungroupedShown(structure.questions, today).length;
  // 9 Oct 2026 (review of 3eaa592): no live prompt, no check promised - the runner skips that client, as the Overview says.
  const checks = setupChecks({ startedOn: client.started_on, today, market: client.market, livePrompts: structure.questions.filter((q) => q.stopped_on === null).length, now });
  // R180: the keyword typed at checkout, with no scan behind the order, prefills the first keywordless card's field.
  const prefill = prefillCard(cards, typed);
  const canWrite = refuseRole(writeRole(client)) === null;
  const failed = sp.confirm === "failed";
  // Part 5: the check's 303 names its card; a card that is not one of these shows nothing.
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const at = cards.find((c) => c.id === one("card")) ?? null;
  const kw = (one("kw") ?? "").slice(0, 200);
  const market = MARKETS[isMarket(client.market) ? client.market : "US"].label;
  const check = at ? verdictFromQuery(one, keywordForm(kw), `the ${market}`) : null;
  const sig = (one("sig") ?? "").slice(0, 64);
  // R179: the keyword route's 303 after "Use this keyword" names the card and what happened.
  const rekey = at ? one("rekey") : null;
  const rekeyLine = rekey === "rekeyed" ? "Keyword set on this cluster. Its prompts are kept." : rekey === "refused" ? "That change did not go through. Check the keyword again, or tell us before you confirm." : null;
  const brand = client.brand ?? client.domain;
  // ON-3 (9 Oct 2026): the strip's check time in the client's zone, for tomorrow - the first a prompt saved today is asked.
  const daily = checkTime(addDays(today, 1), client.market);
  // ON-1: prompts saved now are first asked at the next tracking day's check, or the client's start if later -
  // said from now in its zone (review, 9 Oct 2026: at 21:30 ET "tomorrow" was a day early).
  const asked = firstAsked({ today, startedOn: client.started_on, market: client.market, now });
  // ON-1 review: a refused Save names its field (0-4), never its text.
  const refusedAt = one("drafts") === "refused" ? draftAt(one("at")) : null;
  // ON-1 review: a started client's prompts are being read, so a cluster that has some keeps no keyword it never had (rekey.ts keywordless).
  const reading = client.started_on !== null && client.started_on <= today;
  // DIY P6: suggestions from the stored footprint, and the card that needs a keyword for "Use this keyword".
  const subject = { brand: client.brand ?? null, domain: client.domain, aliases: aliases ?? footprint.aliases };
  const { latest, gaining } = footprintFacts(footprint, { tracked: structure.keywords, subject, today });
  const suggestions = setupSuggestions({ latest, gaining, tracked: trackedSet(structure.keywords, today), subject, typed });
  const needs = canWrite ? (cards.find((c) => c.keyword === null && (!c.prompts.length || !reading))?.id ?? null) : null;

  return (
    <section style={{ maxWidth: "720px", margin: "0 auto", padding: "56px 24px 96px", color: T.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "40px" }}>
        <BrandMark id="app-setup" size={15} />
        <TierName tier="tracked" />
      </div>

      <span style={STEP}>Step 1 of 3</span>
      <h1 style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2, margin: "0 0 12px" }}>Welcome. Set up your clusters for {brand}.</h1>
      <p style={{ margin: "0 0 20px", fontSize: "15px", lineHeight: 1.7, color: T.soft }}>
        You are on <TierName tier={tier} />. A cluster is one Google keyword and the prompts we ask the AI engines about it. Check them below, then confirm.
      </p>
      <ol style={{ margin: "0 0 40px", paddingLeft: "20px", listStyle: "decimal", fontSize: "15px", lineHeight: 1.7, color: T.soft }}>
        {nextSteps(daily).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <span style={STEP}>Step 2 of 3</span>
      <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 16px" }}>
        Your {cards.length === 1 ? "cluster" : cards.length ? `${cards.length} clusters` : "clusters"}
      </h2>
      {cards.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "40px" }}>
          {cards.map((c, i) => {
            const drafts = draftsFor(c);
            // The card's Save comes back here with what happened, in fixed words; a "full" refusal in its real count.
            const saved = at?.id === c.id ? draftsLine(one("drafts"), one("why"), asked, c.prompts.length) : null;
            // A keyword can be given here only to a cluster none of whose prompts has been read.
            const keyable = c.keyword === null && (!c.prompts.length || !reading);
            return (
            <div key={c.id} id={`card-${c.id}`} style={{ ...CARD, borderRadius: "14px", padding: "20px 22px", scrollMarginTop: "24px" }}>
              <div style={MICRO}>Cluster {i + 1}</div>
              <div style={{ marginTop: "6px", fontSize: "17px", fontWeight: 700 }}>{c.keyword ?? "Needs a keyword"}</div>
              <p style={{ margin: "4px 0 14px", fontSize: "14px", color: T.soft }}>
                {/* ON-1 (9 Oct 2026): "We add its Google keyword for you" promised a person; the member sets it here, at any time (rekey.ts keywordless). */}
                {c.keyword !== null
                  ? `The keyword we check on Google every day at ${daily}.`
                  : !keyable
                    ? "No keyword yet. Its prompts are already being read, so none is added to it now: for a keyword, add a cluster with it on Clusters."
                    : canWrite
                      ? c.prompts.length
                        ? "Check a keyword below to give it one."
                        : "Check a keyword below. Once it is set, five prompts are drafted from it for you to edit."
                      : `An owner or editor gives it a keyword${c.prompts.length ? "" : ", and five prompts are then drafted from it"}.`}
              </p>
              {saved?.ok ? (
                <p role="status" style={{ margin: "0 0 12px", fontSize: "13px", lineHeight: 1.5, color: T.goodFg }}>
                  {saved.text}
                </p>
              ) : saved && !(drafts && canWrite) ? (
                // Refused, and no drafts to show it under: the cluster has prompts now (another tab, or a second click).
                <p role="alert" style={{ margin: "0 0 12px", fontSize: "13px", lineHeight: 1.5, color: T.badFg }}>
                  {saved.text}
                </p>
              ) : null}
              {c.prompts.length ? (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {c.prompts.map((p) => (
                    <li key={p.id} style={{ fontSize: "14px", lineHeight: 1.5 }}>
                      {p.angle && ANGLE[p.angle] ? <span style={{ ...MICRO, marginRight: "8px" }}>{ANGLE[p.angle]}</span> : null}
                      {p.text}
                    </li>
                  ))}
                </ul>
              ) : drafts && canWrite ? (
                <DraftPrompts
                  id={`setup-draft-${i}`}
                  action={`/api/app/${encodeURIComponent(slug)}/prompt?${new URLSearchParams({ kind: "cluster", id: c.id, to: "setup" })}`}
                  keyword={c.keyword!}
                  drafts={drafts}
                  note={saved && !saved.ok ? saved.text : `Nothing is checked until they are saved. Saved now, they are first asked ${asked}.`}
                  noteTone={saved && !saved.ok ? "bad" : "soft"}
                  invalidAt={saved && !saved.ok ? refusedAt : null}
                />
              ) : drafts ? (
                <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>No prompts yet. An owner or editor saves the five drafted from its keyword.</p>
              ) : null /* No keyword: the line under its name already says the prompts come from it. */}
              {/* ON-1 (9 Oct 2026): a card with no keyword and nothing read keeps its check after confirm - it is where that cluster is given its first one (rekey.ts keywordless). */}
              {canWrite && (c.keyword === null ? keyable : !confirmed) ? (
                <form method="post" action={`/api/app/${encodeURIComponent(slug)}/check`} style={{ marginTop: "16px", paddingTop: "16px", borderTop: `1px solid ${T.line}`, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <input id={`setup-card-${i}`} type="hidden" name="card" value={c.id} />
                  <input id={`setup-own-${i}`} type="hidden" name="own" value={c.keyword ?? ""} />
                  <label htmlFor={`setup-kw-${i}`} style={{ fontSize: "13px", fontWeight: 600 }}>
                    {c.keyword === null ? "Got a keyword in mind?" : "Its keyword"}
                  </label>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {/* R151 (3 Oct 2026): a refused keyword or rekey comes back on a 303; the field says so, is described by the line under it, and takes focus (Baymard inline errors, WCAG 2.2 3.3.1). */}
                    <input id={`setup-kw-${i}`} name="keyword" defaultValue={at?.id === c.id && kw ? kw : (c.keyword ?? (prefill === c.id ? typed! : ""))} required maxLength={ADMIN_LIMITS.question} placeholder="e.g. accounting software for dentists" aria-describedby={`setup-kw-${i}-note`} aria-invalid={at?.id === c.id && (check?.ok === false || rekey === "refused") ? true : undefined} autoFocus={at?.id === c.id && (check?.ok === false || rekey === "refused")} style={KW_INPUT} />
                    <SubmitButton busy="Checking..." style={CHECK_BUTTON}>
                      Check keyword
                    </SubmitButton>
                  </div>
                  <p id={`setup-kw-${i}-note`} role={at?.id === c.id && (check || rekeyLine) ? (check ? check.ok : rekey === "rekeyed") ? "status" : "alert" : undefined} style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: at?.id === c.id && check ? (check.ok ? T.goodFg : T.badFg) : T.soft }}>
                    {at?.id === c.id && check
                      ? check.ok
                        ? `${check.message} Use it to set it on this cluster now; ${c.prompts.length ? "its prompts are kept" : "five prompts are then drafted from it"}.`
                        : check.message
                      : at?.id === c.id && rekeyLine
                        ? rekey === "rekeyed" && !c.prompts.length
                          ? "Keyword set on this cluster. Edit the five prompts drafted from it above, then save them."
                          : rekeyLine
                        : prefill === c.id
                        ? "This is the keyword you gave at checkout. Check it, or type another; we check it has Google search volume and a buying intent."
                        : "We check it has Google search volume and a buying intent."}
                  </p>
                </form>
              ) : null}
              {canWrite && (c.keyword === null ? keyable : !confirmed) && at?.id === c.id && check?.ok && sig ? (
                <form method="post" action={`/api/app/${encodeURIComponent(slug)}/keyword?${new URLSearchParams({ kind: "cluster", id: c.id, to: "setup" })}`} style={{ marginTop: "10px" }}>
                  <input id={`setup-use-kw-${i}`} type="hidden" name="keyword" value={check.keyword} />
                  <input id={`setup-use-vol-${i}`} type="hidden" name="vol" value={String(check.volume)} />
                  <input id={`setup-use-intent-${i}`} type="hidden" name="intent" value={check.intent} />
                  <input id={`setup-use-sig-${i}`} type="hidden" name="sig" value={sig} />
                  <SubmitButton busy="Saving..." style={CHECK_BUTTON}>
                    {`Use “${check.keyword}” for this cluster`}
                  </SubmitButton>
                </form>
              ) : null}
            </div>
            );
          })}
        </div>
      ) : (
        // DS67 (2 Oct 2026, R173 pass 7): a client tracking prompts in no cluster read "We set them up for you" with no word of its prompts; Clusters' DS54 says how to group them.
        <p style={{ margin: "0 0 40px", fontSize: "15px", lineHeight: 1.7, color: T.soft }}>
          {ungrouped ? (
            <>
              {`No clusters yet. Your ${ungrouped} prompt${ungrouped === 1 ? " is" : "s are"} asked every morning, in no cluster. `}
              <a href={appPath(`/${encodeURIComponent(slug)}/clusters`)} style={{ color: T.accent, fontWeight: 600 }}>
                Group them on Clusters
              </a>
            </>
          ) : (
            // ON-1 (9 Oct 2026): "We set them up for you" promised a person; a cluster is added on Clusters, its prompts drafted from its keyword.
            <>
              {canWrite ? "No clusters yet. Add one on Clusters: check a keyword, then edit the five prompts drafted from it. " : "No clusters yet. An owner or editor adds them on Clusters. "}
              <a href={appPath(`/${encodeURIComponent(slug)}/clusters`)} style={{ color: T.accent, fontWeight: 600 }}>
                Go to Clusters
              </a>
            </>
          )}
        </p>
      )}

      <SetupSuggestions items={suggestions} slug={slug} card={needs} canWrite={canWrite} reason={readOnlyReason(client)} addHref={(s) => appPath(`/${encodeURIComponent(slug)}/clusters?${new URLSearchParams({ add: "1", kw: s.keyword, ...(s.source === "gaining" ? { src: "gaining" } : {}) })}`)} />

      <span id="confirm" style={{ ...STEP, scrollMarginTop: "24px" }}>
        Step 3 of 3
      </span>
      <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 12px" }}>Review and confirm</h2>
      {confirmed ? (
        <p style={{ margin: "0 0 40px", fontSize: "15px", lineHeight: 1.7, color: T.soft }}>
          {/* DIY P6 (spec 10 section 4.12): the confirm queued the onboarding reads; they are said only while they will run. */}
          {`Setup is confirmed. ${checks.line}${footprint.enabled ? " Your site and Google reads happen overnight." : ""} `}
          <a href={appPath(`/${encodeURIComponent(slug)}`)} style={{ color: T.accent, fontWeight: 600 }}>Go to your dashboard</a>
        </p>
      ) : canWrite ? (
        <form method="post" action={`/api/app/${encodeURIComponent(slug)}/setup`} style={{ marginBottom: "40px" }}>
          <p style={{ margin: "0 0 16px", fontSize: "15px", lineHeight: 1.7, color: T.soft }}>
            {/* R151 (3 Oct 2026): "Tell us" named no channel until the help block below; it now leads there. */}
            Want a change?{" "}
            <a href="#help" style={{ color: T.accent, fontWeight: 600 }}>
              Tell us
            </a>{" "}
            {/* 9 Oct 2026 (audit copy-2): the time in the client's zone, no "first" check once checks have begun, none at all with no live prompt. */}
            {`before you confirm, and we make it. ${checks.line}`}
          </p>
          {failed ? (
            <p role="alert" style={{ margin: "0 0 12px", fontSize: "14px", color: T.badFg }}>
              That did not save. Try again.
            </p>
          ) : null}
          {at && check?.ok && sig ? (
            <>
              <input id="sc-card" type="hidden" name="card" value={at.id} />
              <input id="sc-keyword" type="hidden" name="keyword" value={check.keyword} />
              <input id="sc-vol" type="hidden" name="vol" value={String(check.volume)} />
              <input id="sc-intent" type="hidden" name="intent" value={check.intent} />
              <input id="sc-sig" type="hidden" name="sig" value={sig} />
            </>
          ) : null}
          <SubmitButton busy="Confirming..." style={BUTTON}>
            {confirmLabel(placedTier(tier))}
          </SubmitButton>
        </form>
      ) : (
        <p style={{ margin: "0 0 40px", fontSize: "15px", color: T.soft }}>The account owner confirms setup.</p>
      )}

      <div id="help" style={{ ...CARD, borderRadius: "14px", padding: "18px 22px", scrollMarginTop: "24px" }}>
        <div style={MICRO}>Need a hand?</div>
        <p style={{ margin: "4px 0 0", fontSize: "14px", lineHeight: 1.8, display: "flex", flexWrap: "wrap", columnGap: "16px" }}>
          <a href={siteHref(contactUrlFor(tier))} style={{ ...HELP_LINK }}>
            Book a call
          </a>
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ ...HELP_LINK }}>
            Email us: {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}
