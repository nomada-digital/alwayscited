"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare Turnstile, rendered explicitly so the token lands in React state
 * rather than a hidden form field. Renders nothing when no site key is set, so
 * local development works without a Cloudflare account; the server still
 * refuses unverified requests in production.
 */
export default function Turnstile({
  onToken,
  onError,
  onChallenge,
  theme = "light",
}: {
  onToken: (token: string | null) => void;
  /** The widget failed or its script could not load - no token is coming. */
  onError?: () => void;
  /** Cloudflare is showing an interactive challenge (true) or has finished with it (false): a token is coming, just later. */
  onChallenge?: (on: boolean) => void;
  theme?: "light" | "dark";
}) {
  const holder = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  const [challenge, setChallenge] = useState(false);

  // Kept in a ref so a changing callback does not tear down and re-render the
  // widget, which would drop a token the visitor has already solved for.
  const errCb = useRef(onError);
  const chCb = useRef(onChallenge);
  useEffect(() => {
    cb.current = onToken;
    errCb.current = onError;
    chCb.current = onChallenge;
  }, [onToken, onError, onChallenge]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !holder.current) return;
    let cancelled = false;

    function render() {
      if (cancelled || !holder.current || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(holder.current, {
        sitekey: siteKey,
        callback: (token: string) => cb.current(token),
        "expired-callback": () => cb.current(null),
        "error-callback": () => {
          cb.current(null);
          errCb.current?.();
        },
        // Invisible unless Cloudflare decides to challenge (Danny, 25 Sep). The
        // server check is unchanged: a token is still required to start a scan.
        appearance: "interaction-only",
        "before-interactive-callback": () => {
          setChallenge(true);
          chCb.current?.(true);
        },
        "after-interactive-callback": () => {
          setChallenge(false);
          chCb.current?.(false);
        },
        theme,
      });
    }

    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      const script = existing ?? document.createElement("script");
      if (!existing) {
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
      // A content blocker or a network that refuses challenges.cloudflare.com
      // never fires load, and the visitor's click used to post a null token.
      script.addEventListener("error", () => errCb.current?.());
    }

    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) {
        window.turnstile.remove(widget.current);
        widget.current = null;
      }
    };
  }, [siteKey, theme]);

  if (!siteKey) return null;
  // The gap above the box only while there is a box to space.
  return <div ref={holder} style={{ marginTop: challenge ? "0.875rem" : 0 }} />;
}
