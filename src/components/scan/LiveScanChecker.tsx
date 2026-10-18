"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { D } from "@/components/home/dark";
import { T } from "@/config/tokens";
import { track } from "@/lib/analytics";
import { isPlausibleDomain, normalizeDomain } from "@/lib/scan/domain";

import ScanBox, { type ScanBoxCopy } from "./ScanBox";
import { DomainScreen } from "./screens";
import Turnstile from "./Turnstile";

/**
 * The domain field, and nothing else.
 *
 * Everything after it happens at /scan/[token]: confirming the category, the
 * run, the result and the report. That split is the flow boards - the confirm
 * step alone is a fourteen-row table, which was never going to live inside a
 * 400px column in the hero - and it means a reload, a second device or the
 * link in the email all land on the same scan rather than an empty form.
 *
 * A cached complete scan goes to the same place. The token is the scan.
 *
 * `box` draws it as a page's own scan card - /seo-agencies, /how-it-works and
 * the case study - in that card's wording, instead of the hero field (R181,
 * 2 Oct 2026). Those cards were GETs to /scan because a second instance of
 * this component would have duplicated its field's id; the ids now come from
 * useId, so the card starts the scan where it is and goes straight on to
 * /scan/[token]. The card is still a GET form to /scan, so with no JavaScript
 * it lands on /scan with the domain filled in, as before.
 */
export default function LiveScanChecker({
  initialDomain = "",
  autoStart = false,
  handoff,
  dark = false,
  onBusyChange,
  box,
}: {
  initialDomain?: string;
  /**
   * A scan handed over from a partner site (18 Oct 2026, /scan?domain=...): start it without a click, once per page
   * load, with a "Checking example.com..." panel in place of the form. Only when initialDomain is a plausible address;
   * any refusal brings the form back with its message, never a second automatic try.
   */
  autoStart?: boolean;
  /** The hand-off's ref and market, already checked (lib/scan/handoff.ts); sent to the start route as they are. */
  handoff?: { ref: string | null; market: "UK" | "US" | null };
  dark?: boolean;
  /** Told every time busy flips, so a parent can hide its own lines (R49). */
  onBusyChange?: (busy: boolean) => void;
  /** A page's scan card instead of the hero field. */
  box?: ScanBoxCopy;
}) {
  const id = "scan" + useId().replace(/[^\w-]/g, "");
  const router = useRouter();
  const [domain, setDomain] = useState(initialDomain);
  const [turnstileToken, setTurnstileTokenState] = useState<string | null>(null);
  // Mirrors of the token and the widget's failure, read by the wait in onDomain.
  const tokenRef = useRef<string | null>(null);
  const widgetFailed = useRef(false);
  function setTurnstileToken(t: string | null) {
    tokenRef.current = t;
    if (t) widgetFailed.current = false;
    setTurnstileTokenState(t);
  }
  function onWidgetError() {
    widgetFailed.current = true;
  }
  // An interactive Turnstile challenge on screen: the visitor is solving it, so the token wait does not time out.
  const challenging = useRef(false);
  function onChallenge(on: boolean) {
    challenging.current = on;
  }
  const willAuto = autoStart && isPlausibleDomain(normalizeDomain(initialDomain));
  const [auto, setAuto] = useState(willAuto);
  const autoFired = useRef(false);
  const [busy, setBusyState] = useState(false);
  function setBusy(next: boolean) {
    setBusyState(next);
    onBusyChange?.(next);
  }
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /**
   * What the start route is doing while the button says Checking, in its own
   * order (R32, 27 Sep 2026): the domain and the ceilings, then the market,
   * then the site read that names the brand. It holds on the last rather than
   * looping. Danny's third step was "Writing your questions", but nothing in
   * /api/scan/start writes them - they are written after the confirm step, by
   * /questions - so the third says what this call actually does.
   */
  const shown = normalizeDomain(domain);
  const steps = [`Checking ${shown}`, "Working out your market", "Reading your site"];

  function stopSteps() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }
  useEffect(() => stopSteps, []);

  /**
   * A Turnstile token verifies once. The start route spends it before it looks
   * at anything else, so every refused start - a bad domain, a slow or blocked
   * site, the daily ceiling - left the widget holding a dead token, and the
   * corrected retry failed with "We could not verify that request. Please
   * reload" (R151, 1 Oct 2026). A fresh widget after each refusal, by key, the
   * way CoverageForm remounts its own.
   */
  const [attempt, setAttempt] = useState(0);
  function freshToken() {
    setTurnstileToken(null);
    widgetFailed.current = false;
    setAttempt((a) => a + 1);
  }

  async function onDomain(e: React.FormEvent) {
    e.preventDefault();
    await start(domain);
  }

  // The hand-off: one automatic start per page load (the ref survives a re-render and React's double effect in dev).
  useEffect(() => {
    if (!willAuto || autoFired.current) return;
    autoFired.current = true;
    void start(initialDomain, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A refused or failed start: the step 1 form again, with its message, and a fresh bot check. */
  function refuse(message: string) {
    stopSteps();
    setError(message);
    setBusy(false);
    setAuto(false);
    freshToken();
  }

  async function start(domain: string, automatic = false) {
    /**
     * An address that cannot be one is answered here, in the start route's own
     * words, before anything is spent: no round trip, no token used, no
     * analytics event for an empty field. The route still checks it.
     */
    if (!isPlausibleDomain(normalizeDomain(domain))) {
      setAuto(false);
      setError("That does not look like a website address. Try example.com.");
      return;
    }
    setError("");
    setBusy(true);
    setStep(0);
    stopSteps();
    timers.current = [setTimeout(() => setStep(1), 1500), setTimeout(() => setStep(2), 3500)];

    /**
     * Wait for Turnstile rather than posting without it (4 Oct 2026). The
     * widget is invisible and issues its token a second or two after load, and
     * again after every refusal (freshToken remounts it). A paste-and-click, or
     * a retry straight after an error, posted turnstileToken: null and was told
     * "We could not verify that request. Please reload" - which reloading did
     * not fix. Up to 15s, then a message that names the likely cause.
     */
    const needsToken = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
    if (needsToken && !tokenRef.current) {
      // A challenge the visitor is solving holds the wait open (the hand-off submits the moment it passes), up to 5 minutes.
      let deadline = Date.now() + 15_000;
      const cap = Date.now() + 300_000;
      while (!tokenRef.current && !widgetFailed.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        if (challenging.current) deadline = Math.min(cap, Date.now() + 15_000);
      }
      if (!tokenRef.current) {
        refuse("Our bot check did not load. If you use a content or ad blocker, allow challenges.cloudflare.com, or try another browser.");
        return;
      }
    }

    try {
      const headers = new Headers();
      headers.set("content-type", "application/json");
      const res = await fetch("/api/scan/start", {
        method: "POST",
        headers,
        // No market: the start route picks it from the domain (market-pick.ts).
        // This used to send a hard-coded "UK", which meant every scan opened
        // on the UK whatever the domain said.
        // A hand-off's market and ref ride along when the page had them (lib/scan/handoff.ts); the route checks both again.
        body: JSON.stringify({
          domain,
          turnstileToken: tokenRef.current ?? turnstileToken,
          ...(handoff?.market ? { market: handoff.market } : {}),
          ...(handoff?.ref ? { ref: handoff.ref } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        refuse(data.message ?? "Something went wrong. Please try again.");
        return;
      }

      // Left busy on purpose: the navigation is the next thing that happens,
      // and a field that goes live again for half a second invites a second
      // submission of the same domain. The steps stop where they are.
      stopSteps();
      // Once the scan exists, not on the click (15 Oct 2026). The market the
      // route picked, and which field started it - never the domain, which can
      // name a business and is kept out of GA.
      track("free_scan_start", {
        market: typeof data.market === "string" ? data.market : undefined,
        cta_location: automatic ? "handoff" : box ? "card" : "hero",
      });
      router.push("/scan/" + data.token);
    } catch {
      refuse("We could not reach the checker. Please try again.");
    }
  }

  // The hand-off in progress: a status panel, not a form waiting for input. The bot check stays mounted below it, so an
  // interactive challenge shows here and the scan goes on as soon as it passes.
  if (auto) {
    return (
      <div>
        <div role="status" aria-live="polite" className="scan-handoff" style={{ display: "flex", alignItems: "center", gap: "12px", background: dark ? D.field : T.surface, border: `1px solid ${dark ? D.fieldLine : T.line}`, borderRadius: "14px", padding: "16px 18px", minHeight: "56px", color: dark ? T.surface : T.ink, fontSize: "15px", fontWeight: 600 }}>
          <span className="btn-spin" aria-hidden="true" style={{ color: T.accent, marginRight: 0, flex: "none" }} />
          <span>{step === 0 ? `Checking ${shown}\u2026` : `${steps[step]}\u2026`}</span>
        </div>
        <Turnstile key={attempt} onToken={setTurnstileToken} onError={onWidgetError} onChallenge={onChallenge} theme={dark ? "dark" : "light"} />
      </div>
    );
  }

  if (box) {
    return (
      <div>
        <ScanBox
          {...box}
          id={id}
          value={busy ? shown : domain}
          onChange={setDomain}
          onSubmit={onDomain}
          error={error}
          status={busy ? steps[step] : ""}
          busy={busy}
        />
        <Turnstile key={attempt} onToken={setTurnstileToken} onError={onWidgetError} onChallenge={onChallenge} />
      </div>
    );
  }

  return (
    <div>
      <DomainScreen
        id={id}
        value={busy ? shown : domain}
        onChange={setDomain}
        onSubmit={onDomain}
        error={error}
        status={busy ? steps[step] : ""}
        busy={busy}
        dark={dark}
      />
      <Turnstile key={attempt} onToken={setTurnstileToken} onError={onWidgetError} onChallenge={onChallenge} theme={dark ? "dark" : "light"} />
    </div>
  );
}
