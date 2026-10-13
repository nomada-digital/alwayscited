"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import BrandMark from "@/components/BrandMark";
import { firstRenderDone } from "@/components/app/FreshGuard";
import { NAV, navHref } from "@/components/app/nav";
import TierName from "@/components/TierName";
import { CARD, MICRO, T } from "@/config/tokens";
import { appPath, siteHrefAt } from "@/lib/app-host";

/**
 * The dashboard's error boundary (R151, 1 Oct 2026). Before it, a read that
 * threw anywhere under /app/[client] - overview-data.ts's "could not read the
 * runs" - fell through to src/app/error.tsx, which drops the dashboard and
 * offers only "Back to the homepage": a dead end for a signed-in client.
 *
 * Here the reader stays in the dashboard: the alwaystracked lockup, Try again
 * (Next 16's retry, which re-fetches - see src/app/error.tsx), the Overview,
 * and every other dashboard page, since a read that fails on one screen
 * usually leaves the rest standing. The full Sidebar needs the client row,
 * which is exactly what may not have loaded, so this draws a top bar built
 * from the slug in the URL alone.
 *
 * Swept on TRACKING_FIXTURE_STATE=unreadable (fixture-mode.ts).
 *
 * Speed review (13 Oct 2026, fresh.ts): the router now holds pages for 300 s,
 * and a render that failed is held like one that did not - the sidebar's
 * Full prefetch of it answers 200 with the error inside, and Next rejects a
 * prefetch only when the response is not ok (segment-cache/cache.js
 * 1981-1986). So this boundary calls router.refresh() as it is drawn, which
 * empties the router's memory: the next click on any page asks the server
 * again rather than drawing the same failure, as every click did before the
 * window. It does not reset the boundary, so this stays on screen through the
 * refresh and cannot draw itself again; it has no prefetched links, so the
 * cost is one render of this page. Not when it is drawn in the document's
 * first render (firstRenderDone): the router holds nothing yet, and a refresh
 * answered not-ok makes Next reload the document (fetch-server-response.js
 * 143-148), which would draw this and refresh again, round and round. And not
 * when Try again drew it: retry() has just refreshed, and a page that fails
 * again draws a new one of these (measured: two renders a click without
 * this, one with it).
 */
let retried = false;

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { client } = useParams<{ client: string }>();
  const router = useRouter();
  const [purge] = useState(() => firstRenderDone() && !retried);
  useEffect(() => {
    if (purge) router.refresh();
    return () => {
      retried = false;
    };
  }, [purge, router]);
  // Audit ia-2 (8 Oct 2026): /contact is the marketing site's. On the app host a relative
  // /contact is rewritten into the dashboard and 404s; this client component cannot read
  // APP_HOST, so the address it was served at decides, after hydration.
  const [contact, setContact] = useState("/contact");
  useEffect(() => setContact(siteHrefAt("/contact", window.location)), []);
  const overview = navHref("Overview", client) ?? appPath("");
  const others = NAV.filter((n) => n !== "Overview").flatMap((item) => {
    const href = navHref(item, client);
    return href ? [{ item, href }] : [];
  });

  return (
    <div className="app-shell" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", color: T.ink, background: T.bg }}>
      <header style={{ display: "flex", alignItems: "center", height: "60px", padding: "0 24px", background: T.surface, borderBottom: `1px solid ${T.line}` }}>
        {/* Not a link, as the Sidebar's lockup is not: the site logo is the one tier lockup in a link (result-copy.test.mts). */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em" }}>
          <BrandMark id="app-error" size={15} />
          <TierName tier="tracked" />
        </div>
      </header>

      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 auto", padding: "36px 40px 48px", maxWidth: "720px" }}>
        <div style={MICRO}>Error</div>
        <h1 style={{ margin: "10px 0 0", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2 }}>This page of your dashboard did not load.</h1>
        <p style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.7, color: T.soft, maxWidth: "56ch" }}>
          Trying again is worth doing first - most of what fails here is a read that timed out rather than anything saved wrongly. The other pages below may still open.
        </p>

        <div style={{ marginTop: "24px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              retried = true;
              retry();
            }}
            style={{ fontSize: "15px", fontWeight: 600, color: "#ffffff", background: T.accent, border: "none", borderRadius: "10px", padding: "13px 26px", cursor: "pointer", fontFamily: "inherit" }}
          >
            Try again
          </button>
          <Link href={overview} style={{ display: "inline-flex", alignItems: "center", fontSize: "15px", fontWeight: 600, color: T.ink, background: T.surface, border: `1px solid ${T.line}`, borderRadius: "10px", padding: "12px 25px", textDecoration: "none" }}>
            Back to the Overview
          </Link>
        </div>

        <nav aria-label="Other dashboard pages" style={{ marginTop: "28px" }}>
          <div style={MICRO}>Or go to</div>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
            {others.map((n) => (
              <li key={n.item}>
                <Link href={n.href} style={{ display: "inline-flex", alignItems: "center", fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                  {n.item}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {error.digest ? (
          <div style={{ ...CARD, borderRadius: "14px", padding: "16px 20px", marginTop: "28px" }}>
            <div style={MICRO}>If you tell us about this, quote this reference</div>
            <p style={{ margin: "7px 0 0", fontSize: "14px", lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", overflowWrap: "anywhere" }}>{error.digest}</p>
            <p style={{ margin: "7px 0 0", fontSize: "13px", lineHeight: 1.6, color: T.soft }}>
              It is a hash of the error itself, so it matches our server log and contains nothing you typed. <a href={contact} style={{ color: T.accent }}>Tell us here</a>.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
