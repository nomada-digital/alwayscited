"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

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
  dark = false,
  onBusyChange,
  box,
}: {
  initialDomain?: string;
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
    /**
     * An address that cannot be one is answered here, in the start route's own
     * words, before anything is spent: no round trip, no token used, no
     * analytics event for an empty field. The route still checks it.
     */
    if (!isPlausibleDomain(normalizeDomain(domain))) {
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
      const deadline = Date.now() + 15_000;
      while (!tokenRef.current && !widgetFailed.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!tokenRef.current) {
        stopSteps();
        setError(
          "Our bot check did not load. If you use a content or ad blocker, allow challenges.cloudflare.com, or try another browser.",
        );
        setBusy(false);
        freshToken();
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
        body: JSON.stringify({ domain, turnstileToken: tokenRef.current ?? turnstileToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        stopSteps();
        setError(data.message ?? "Something went wrong. Please try again.");
        setBusy(false);
        freshToken();
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
        cta_location: box ? "card" : "hero",
      });
      router.push("/scan/" + data.token);
    } catch {
      stopSteps();
      setError("We could not reach the checker. Please try again.");
      setBusy(false);
      freshToken();
    }
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
        <Turnstile key={attempt} onToken={setTurnstileToken} onError={onWidgetError} />
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
      <Turnstile key={attempt} onToken={setTurnstileToken} onError={onWidgetError} theme={dark ? "dark" : "light"} />
    </div>
  );
}
