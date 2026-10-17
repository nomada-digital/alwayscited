"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { GA_MEASUREMENT_ID, isDashboardPath } from "@/config/analytics";
import { T } from "@/config/tokens";
import { denyConsent, grantConsent, initConsent, onDashboard, readConsent, track } from "@/lib/analytics";

/**
 * The cookie banner, and the only thing on the site that loads Google
 * Analytics (Danny, 15 Oct 2026, in chat).
 *
 * Mounted from the root layout inside SiteChrome, so it is not drawn on /app;
 * on the app host, where the path carries no /app, `onDashboard()` reads the
 * /app layout's marker and nothing is initialised. It renders nothing on the
 * server: the banner appears after mount and only to a visitor who has not
 * chosen yet, fixed to the bottom of the window and gone the moment they
 * answer, so it covers nothing for good and moves no layout.
 *
 * The decision itself is in lib/analytics.ts, which owns the data layer, the
 * stored choice and the GA cookies. This file draws the question, loads
 * gtag.js after a yes, and sends the three link events from one delegated
 * listener.
 */

/** gtag.js. Requested only after a yes and only with a real measurement id (config/analytics.ts). */
const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

/**
 * Where gtag.js sends hits and fetches its pixel once it is loaded - not
 * requested by this file directly, but by the script it loads, and so on the
 * marketing CSP in next.config.ts beside GTAG_SRC's origin. Named here because
 * route-closure.test.mts holds that every CSP origin is one client code reaches,
 * and these are reached through this file and nothing else.
 */
export const GA_CONNECTS = ["https://www.google-analytics.com", "https://region1.google-analytics.com"] as const;

function loadGtag() {
  if (document.querySelector(`script[src^="${GTAG_SRC}"]`)) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `${GTAG_SRC}?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  document.head.appendChild(s);
}

/** The footer's "Cookie settings" asks the banner to open again through this event. */
const REOPEN = "ac-consent-open";

/** Where on the page a link was, for the link events: no URL, no text. */
function area(el: Element): string {
  return el.closest("header") ? "header" : el.closest("footer") ? "footer" : el.closest("main") ? "main" : "other";
}

/**
 * book_call_click, email_click and nomada_click, from one listener rather than
 * an onClick on every link: the links are in server components all over the
 * site. Capture phase, so it runs before a Link starts a client navigation.
 * track() is a no-op until the visitor has said yes.
 */
function onLinkClick(e: MouseEvent) {
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a) return;
  const href = a.getAttribute("href") ?? "";
  if (/^mailto:/i.test(href)) {
    track("email_click", { link_area: area(a) });
    return;
  }
  let u: URL;
  try {
    u = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (u.hostname === "nomadadigital.co.uk" || u.hostname.endsWith(".nomadadigital.co.uk")) {
    track("nomada_click", { link_area: area(a) });
  } else if (u.origin === window.location.origin && (u.pathname === "/contact" || u.pathname.startsWith("/contact/"))) {
    track("book_call_click", { link_area: area(a) });
  }
}

export default function ConsentBanner() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const accept = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);

  useEffect(() => {
    if (!initConsent()) return;
    const choice = readConsent();
    if (choice === "accepted") {
      if (grantConsent(false)) loadGtag();
    } else if (choice === null) {
      setOpen(true);
    }
    const reopen = () => {
      focusOnOpen.current = true;
      setOpen(true);
    };
    document.addEventListener("click", onLinkClick, true);
    window.addEventListener(REOPEN, reopen);
    return () => {
      document.removeEventListener("click", onLinkClick, true);
      window.removeEventListener(REOPEN, reopen);
    };
  }, []);

  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      accept.current?.focus();
    }
  }, [open]);

  const onAccept = useCallback(() => {
    setOpen(false);
    if (grantConsent(true)) loadGtag();
  }, []);

  const onDecline = useCallback(() => {
    setOpen(false);
    if (denyConsent()) window.location.reload();
  }, []);

  if (!open || isDashboardPath(pathname) || (typeof window !== "undefined" && onDashboard())) return null;

  return (
    <section
      aria-label="Cookie choice"
      style={{
        position: "fixed",
        left: "16px",
        right: "16px",
        bottom: "16px",
        zIndex: 90,
        maxWidth: "720px",
        margin: "0 auto",
        boxSizing: "border-box",
        background: T.surface,
        border: `1px solid ${T.line}`,
        borderRadius: "14px",
        padding: "16px 18px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px 18px",
      }}
    >
      <p style={{ margin: 0, flex: "1 1 320px", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
        <span style={{ fontWeight: 600, color: T.ink }}>Can we use Google Analytics?</span> It shows us which pages and
        features get used. It sets cookies only if you accept, and never sees what you type into a form or the domains
        you scan.{" "}
        <a href="/legal#cookies" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
          Cookie details
        </a>
      </p>
      <div style={{ display: "flex", gap: "10px", flex: "0 0 auto" }}>
        <button
          type="button"
          onClick={onDecline}
          style={{
            fontFamily: "inherit",
            fontSize: "14px",
            fontWeight: 600,
            lineHeight: "normal",
            color: T.ink,
            background: T.surface,
            border: `1px solid ${T.line}`,
            borderRadius: "10px",
            padding: "10px 18px",
            cursor: "pointer",
          }}
        >
          Decline
        </button>
        <button
          ref={accept}
          type="button"
          className="btn-primary"
          onClick={onAccept}
          style={{
            fontFamily: "inherit",
            fontSize: "14px",
            fontWeight: 600,
            lineHeight: "normal",
            background: T.accent,
            color: T.surface,
            boxShadow: "none",
            border: 0,
            borderRadius: "10px",
            padding: "10px 18px",
            cursor: "pointer",
          }}
        >
          Accept
        </button>
      </div>
    </section>
  );
}

/**
 * The footer's "Cookie settings": opens the banner again so a choice can be
 * changed either way. A button, because it acts on this page rather than going
 * anywhere.
 */
export function CookieSettingsButton({ style }: { style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(REOPEN))}
      style={{ font: "inherit", background: "none", border: 0, padding: 0, cursor: "pointer", ...style }}
    >
      Cookie settings
    </button>
  );
}
