"use client";

import { useEffect, useState } from "react";

import TierName from "@/components/TierName";
import { stillDismissed, type Nudge } from "@/lib/dash/nudges";
import type { TierKey } from "@/lib/dash/types";

/**
 * One plan suggestion, from the client's own readings (lib/dash/nudges.ts).
 * Quiet by design: a card in the page's own palette, the figures it was
 * decided on, what the next plan adds in the site's own words, and "Not now",
 * which hides it for 30 days in this browser.
 */
export default function NudgeCard({ slug, nudge, includes, href, label }: { slug: string; nudge: Nudge; includes: string[]; href: string; label: string }) {
  const key = `ac-nudge:${slug}:${nudge.id}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      const at = Number(window.localStorage.getItem(key));
      setHidden(stillDismissed(at || null, Date.now()));
    } catch {
      setHidden(false);
    }
  }, [key]);
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(key, String(Date.now()));
    } catch {
      /* private window: hidden for this visit only */
    }
  };
  return (
    <aside className="nudge" aria-label="A suggestion for your plan">
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div className="dash-micro">{nudge.to ? <>From your readings · <TierName tier={nudge.to as TierKey} /></> : "From your allowance"}</div>
        <h2 style={{ margin: "4px 0 6px", fontSize: 16 }}>{nudge.headline}</h2>
        <ul className="nudge-ev">{nudge.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        {includes.length ? <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>{nudge.to ? <><TierName tier={nudge.to as TierKey} /> adds: </> : null}{includes.join(" · ")}.</p> : null}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <a className="btn primary" href={href}>{label}</a>
        <button className="btn ghost" onClick={dismiss}>Not now</button>
      </div>
    </aside>
  );
}
