"use client";

import { useState } from "react";

import { CONNECT_LIMITS } from "@/config/contact";
import { ACCESS_EMAIL, STALE_MS } from "@/lib/dash/connect";
import type { Provider, RawConnection } from "@/lib/dash/types";

const INFO: Record<Provider, { name: string; what: string; steps: (d: string) => string[] }> = {
  gsc: {
    name: "Google Search Console",
    what: "Clicks, impressions and average position for every search you appear in, straight from Google.",
    steps: (d) => [
      `Open Search Console and pick the property for ${d}.`,
      "Go to Settings, then Users and permissions.",
      `Press Add user and enter ${ACCESS_EMAIL}.`,
      "Set the permission to Restricted and press Add.",
      "Come back here and press Check connection.",
    ],
  },
  ga4: {
    name: "Google Analytics 4",
    what: "Visits that arrive from AI assistants and from the pages your placements are on.",
    steps: (d) => [
      `Open Google Analytics and pick the property for ${d}.`,
      "Go to Admin (the cog at the bottom left), then Property access management.",
      `Press the plus, choose Add users and enter ${ACCESS_EMAIL}.`,
      "Choose the Viewer role and press Add.",
      "Still in Admin, open Property details and copy the property ID (numbers only).",
      "Paste it below and press Check connection.",
    ],
  },
  bing: {
    name: "Bing Webmaster Tools",
    what: "Clicks and impressions on Bing, straight from Bing.",
    steps: (d) => [
      `Open Bing Webmaster Tools and pick ${d}.`,
      "Go to Settings, then User management.",
      `Press Add user, enter ${ACCESS_EMAIL} and choose Read only.`,
      "Press Add, then come back here and press Check connection.",
    ],
  },
};

/**
 * One data connection (2 Nov 2026, sg-37). The customer adds our access
 * address in the platform, then Check connection asks our backend whether the
 * property is visible to us yet (api/dash/[client]/integrations, lib/dash/connect-io.ts).
 * Connected starts the daily pull. Not yet says what to double check; a
 * customer still waiting a day after their first check is flagged to us
 * (the run-health mail), and the card says so rather than asking them to chase.
 */
export default function IntegrationCard({ slug, domain, provider, conn, canWrite, demo = false }: { slug: string; domain: string; provider: Provider; conn: RawConnection | null; canWrite: boolean; demo?: boolean }) {
  const [state, setState] = useState<string | null>(conn?.status ?? null);
  const [prop, setProp] = useState<string | null>(conn?.property ?? null);
  const [gaId, setGaId] = useState<string>(provider === "ga4" && conn?.status !== "connected" ? (conn?.property ?? "") : "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; hint?: string; bad?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const i = INFO[provider];
  const connected = state === "connected";
  const since = conn?.requested_at ?? null;
  const longWait = !connected && since ? Date.now() - Date.parse(since) >= STALE_MS : false;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ACCESS_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the address is on screen to copy by hand */
    }
  };
  const check = async () => {
    setBusy(true);
    setNote(null);
    if (demo) {
      setNote({ text: "Not visible yet: it can take a few minutes.", hint: "This is a demo link, so nothing is checked." });
      setBusy(false);
      return;
    }
    const r = await fetch(`/api/dash/${slug}/integrations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, property: gaId }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; connected?: boolean; property?: string; message?: string; hint?: string } | null;
    if (j?.ok && j.connected) {
      setState("connected");
      setProp(j.property ?? null);
      setNote({ text: "Connected. Your first numbers are on their way and refresh every morning." });
    } else if (j?.ok) {
      if (state !== "connected") setState("pending");
      setNote({ text: j.message ?? "Not visible yet: it can take a few minutes.", hint: j.hint });
    } else {
      setNote({ text: j?.message ?? "We could not check just now. Try again in a minute.", bad: true });
    }
    setBusy(false);
  };

  const pill = connected ? <span className="pill good">Connected</span> : state === "pending" || state === "requested" ? <span className="pill warn">Waiting</span> : state === "error" ? <span className="pill bad">Needs attention</span> : <span className="pill">Not connected</span>;
  return (
    <div className="dash-card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ flex: 1 }}>{i.name}</h2>
        {pill}
      </div>
      <p className="intro">{i.what}</p>
      {connected ? (
        <>
          <p className="muted" style={{ fontSize: 13, margin: "14px 0 0" }}>
            {prop ?? "Connected"}
            {conn?.last_synced_at ? `, last read ${conn.last_synced_at.slice(0, 10)}` : ", first read on its way"}
          </p>
          {note ? <p role="status" style={{ fontSize: 13, margin: "8px 0 0", fontWeight: 600 }}>{note.text}</p> : null}
        </>
      ) : !canWrite ? (
        <p className="faint" style={{ fontSize: 12.5, margin: "14px 0 0" }}>An owner or editor can connect this.</p>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 12, background: "var(--wash)" }}>
            <span style={{ fontSize: 12.5, color: "var(--soft)", flexBasis: "100%" }}>Our access address</span>
            <b style={{ fontSize: 14, wordBreak: "break-all", flex: "1 1 auto" }}>{ACCESS_EMAIL}</b>
            <button className="btn sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <button className="btn ghost" onClick={() => setOpen(!open)} aria-expanded={open} style={{ marginTop: 8, paddingLeft: 0 }}>
            {open ? "Hide the steps" : `How to add it, ${i.steps(domain).length} steps`}
          </button>
          {open ? (
            <>
              <ol style={{ margin: "6px 0 0", paddingLeft: 20, listStyle: "decimal", display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5, lineHeight: 1.45 }}>
                {i.steps(domain).map((s) => <li key={s}>{s}</li>)}
              </ol>
            </>
          ) : null}
          {provider === "ga4" ? (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12, fontSize: 12.5, color: "var(--soft)" }}>
              GA4 property ID
              <input className="field" inputMode="numeric" maxLength={CONNECT_LIMITS.gaProperty} placeholder="For example 312345678" value={gaId} onChange={(e) => setGaId(e.target.value)} style={{ fontSize: 16 }} />
            </label>
          ) : null}
          <button className="btn primary" onClick={check} disabled={busy} style={{ marginTop: 12, width: "100%", padding: "10px 13px" }}>
            {busy ? "Checking..." : "Check connection"}
          </button>
          {note ? (
            <div role="status" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45 }}>
              <b style={{ color: note.bad ? "var(--bad-fg)" : "var(--ink)" }}>{note.text}</b>
              {note.hint ? <div className="muted" style={{ marginTop: 3 }}>{note.hint}</div> : null}
            </div>
          ) : longWait ? (
            <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>Still not showing after a day? We have been told and will sort it out with you. You can keep checking here in the meantime.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
