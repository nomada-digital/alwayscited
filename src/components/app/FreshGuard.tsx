"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { dashPath, usageSlug } from "@/lib/tracking/usage";

import { FRESH_SECONDS } from "./fresh";

const MAX_AGE = FRESH_SECONDS * 1000;

/**
 * Caps how old a dashboard page drawn from memory can be (13 Oct 2026,
 * dashboard speed work; fresh.ts has the design). router.refresh() empties
 * the router's whole cache - prefetched sidebar pages and visited pages alike
 * (refresh-reducer.js 39-49; segment-cache/cache.js 240-244) - and redraws
 * this page from the server. It is called:
 *
 *  - when the browser restores this document from its own back-forward cache
 *    (pageshow, persisted). Next only restores there and invalidates nothing
 *    (app-router.js 154-176), so Back past a form's 303 would otherwise show
 *    the page as it stood before the change;
 *  - when the tab comes back into view, and
 *  - when the member moves to another page,
 *
 * those two only once FRESH_SECONDS have passed since the last purge. The
 * clock starts at mount, which is a fresh document from the server.
 *
 * Only on a client's dashboard (the slug test UsageBeacon uses); the sign-in
 * pages hold nothing from a member's data. Renders nothing; with JS off there
 * is no router cache to purge.
 */
export function FreshGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const on = Boolean(pathname && usageSlug(dashPath(pathname)));
  const purged = useRef(0);
  const purge = useCallback(() => {
    purged.current = Date.now();
    router.refresh();
  }, [router]);

  useEffect(() => {
    purged.current = Date.now();
  }, []);

  useEffect(() => {
    if (!on) return;
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) purge();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - purged.current > MAX_AGE) purge();
    };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [on, purge]);

  useEffect(() => {
    if (on && Date.now() - purged.current > MAX_AGE) purge();
  }, [on, pathname, purge]);

  return null;
}
