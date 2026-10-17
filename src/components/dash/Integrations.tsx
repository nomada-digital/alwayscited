"use client";

import { useState } from "react";

import type { Provider, RawConnection } from "@/lib/dash/types";

const INFO: Record<Provider, { name: string; what: string; gives: string[] }> = {
  gsc: {
    name: "Google Search Console",
    what: "Clicks, impressions and average position for every search you appear in, straight from Google.",
    gives: ["Clicks and impressions beside every tracked keyword", "Searches you are found for, sorted into your keyword groups", "Pages that rank, per group"],
  },
  bing: {
    name: "Bing Webmaster Tools",
    what: "Clicks, impressions and average position on Bing, straight from Bing.",
    gives: ["Bing clicks and impressions per keyword", "Searches found on Bing, sorted into your groups"],
  },
  ga4: {
    name: "Google Analytics 4",
    what: "Visits that arrive from AI assistants and from the pages your placements are on.",
    gives: ["Sessions referred by ChatGPT, Perplexity, Gemini and Copilot", "Traffic from each placement's page", "Conversions from both"],
  },
};

/**
 * One integration (17 Oct 2026). The connect flows need app registrations with
 * Google and Microsoft that are not made yet, so "Connect" records a request
 * (integration_connections) and the card says it is queued; the data model
 * behind it - connections and search_console_queries - is in place.
 */
export default function IntegrationCard({ slug, provider, conn, canWrite }: { slug: string; provider: Provider; conn: RawConnection | null; canWrite: boolean }) {
  const [state, setState] = useState<string | null>(conn?.status ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const i = INFO[provider];
  const ask = async () => {
    setBusy(true);
    setErr(null);
    const was = state;
    setState("requested");
    const r = await fetch(`/api/dash/${slug}/integrations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    if (!j?.ok) { setState(was); setErr(j?.message ?? "That did not save. Try again."); }
    setBusy(false);
  };
  const pill = state === "connected" ? <span className="pill good">Connected</span> : state === "requested" || state === "pending" ? <span className="pill warn">Requested</span> : state === "error" ? <span className="pill bad">Needs attention</span> : <span className="pill">Not connected</span>;
  return (
    <div className="dash-card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ flex: 1 }}>{i.name}</h2>
        {pill}
      </div>
      <p className="intro">{i.what}</p>
      <ul style={{ margin: "12px 0 16px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5, fontSize: 13 }}>
        {i.gives.map((g) => <li key={g}><span style={{ color: "var(--accent)", fontWeight: 700, marginRight: 6 }}>✓</span>{g}</li>)}
      </ul>
      <div style={{ marginTop: "auto" }}>
        {state === "connected" ? (
          <span className="muted" style={{ fontSize: 12.5 }}>{conn?.property ?? "Connected"}{conn?.last_synced_at ? ` · synced ${conn.last_synced_at.slice(0, 10)}` : ""}</span>
        ) : state === "requested" || state === "pending" ? (
          <span className="muted" style={{ fontSize: 13 }}>We have your request. We will be in touch when the connection opens - nothing to do until then.</span>
        ) : canWrite ? (
          <button className="btn primary" onClick={ask} disabled={busy}>Connect</button>
        ) : (
          <span className="faint" style={{ fontSize: 12.5 }}>An owner or editor can connect this.</span>
        )}
        {err ? <div className="field-err" role="alert">{err}</div> : null}
      </div>
    </div>
  );
}
