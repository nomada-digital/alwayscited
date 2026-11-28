"use client";

import { useEffect, useState } from "react";

import GoogleButton from "@/components/dash/GoogleButton";
import { CONTACT_EMAIL } from "@/config/contact";
import { CLIENT_ACCESS, PERMISSION, READ_ONLY_NOTE } from "@/lib/dash/google";
import type { RawConnection } from "@/lib/dash/types";

type Listed = { id: string; name: string; permission: string | null };
type Inspection = { url: string; verdict: string | null; coverage: string | null; last_crawl: string | null; inspected_at: string };

/** What came back from Google, as /api/google/callback reports it (?gsc=<word>). */
const BACK: Record<string, { text: string; bad?: boolean }> = {
  cancelled: { text: "You cancelled the Google sign-in. Nothing was connected." },
  failed: { text: "Google didn't complete the sign-in. Try again.", bad: true },
  noscope: { text: "Search Console access wasn't ticked on Google's screen. Connect again and leave it ticked.", bad: true },
  refused: { text: "Only an owner or editor can connect this.", bad: true },
  unavailable: { text: "Connecting Search Console isn't switched on yet. Try again later today.", bad: true },
};

/**
 * Connect Google Search Console in one click (16 Nov 2026, lib/dash/gsc-oauth.ts): sign in with Google, allow
 * read-only access, pick the property for this site. Connected, it says who connected it, which property and when
 * it last read, with Disconnect. On a view-as link, Nomada staff connect it on the client's behalf - signing in with
 * a Google account that can see the client's property - and get URL Inspection for key pages (staff only at first).
 */
export default function GoogleConnect({ slug, domain, conn, canWrite, demo, staff, keyPages = [], inspections = [] }: {
  slug: string;
  domain: string;
  conn: RawConnection | null;
  canWrite: boolean;
  demo: boolean;
  staff: boolean;
  keyPages?: string[];
  inspections?: Inspection[];
}) {
  const oauth = conn?.via === "google" && conn.auth === "oauth";
  const [state, setState] = useState<"none" | "pick" | "connected">(oauth && conn?.status === "connected" && conn.property ? "connected" : oauth && conn?.status === "pending" ? "pick" : "none");
  const [shown, setShown] = useState<{ property: string; email: string | null; permission: string | null } | null>(oauth && conn?.property ? { property: conn.property, email: conn.google_email ?? null, permission: conn.permission ?? null } : null);
  const [listed, setListed] = useState<Listed[] | null>(null);
  const [email, setEmail] = useState<string | null>(conn?.google_email ?? null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [setup, setSetup] = useState<{ platform: string | null; steps: string[] } | null>(null);
  const [helped, setHelped] = useState<string | null>(null);
  const may = (canWrite && !demo) || staff;

  const call = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/dash/${slug}/google`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: location.pathname, ...body }) }).catch(() => null);
    return ((await r?.json().catch(() => null)) ?? { ok: false, message: "We couldn't reach the server. Try again in a minute." }) as Record<string, unknown> & { ok?: boolean; message?: string };
  };
  const list = async () => {
    setBusy(true);
    const j = await call({ op: "list" });
    if (j.email) setEmail(String(j.email));
    const l = (j.listed as Listed[] | undefined) ?? [];
    if (j.ok && l.length) { setListed(l); setChoice(l[0].id); setNote(null); setSetup(null); }
    else if (j.ok) {
      // Signed in, no property for this site: set one up, guided (16 Nov 2026). Our link never reaches a Search Console sign-up.
      setListed([]);
      setNote(null);
      const h = await call({ op: "setup" });
      setSetup({ platform: (h.platform as string | null) ?? null, steps: (h.steps as string[] | undefined) ?? [] });
    } else setNote({ text: j.message ?? "We couldn't list your properties.", bad: true });
    setBusy(false);
  };
  useEffect(() => {
    const word = new URLSearchParams(location.search).get("gsc");
    if (word && BACK[word]) setNote(BACK[word]);
    if (word) history.replaceState(null, "", location.pathname);
    if ((word === "pick" || state === "pick") && may) { setState("pick"); void list(); }
    // Once, on arrival: the sign-in's outcome and, when waiting for a property, the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = () => {
    const href = `/api/google/connect?${new URLSearchParams({ client: slug, back: location.pathname })}`;
    // Inside the hub's frame Google refuses to show its sign-in, so it opens in a tab of its own.
    if (window.top !== window.self) window.open(href, "_blank", "noopener");
    else location.href = href;
  };
  const pick = async () => {
    setBusy(true);
    const j = await call({ op: "pick", property: choice });
    if (j.ok) {
      setShown({ property: String(j.property), email: (j.email as string | null) ?? email, permission: (j.permission as string | null) ?? null });
      setState("connected");
      setListed(null);
      setNote({ text: "Connected. Up to 16 months of history is on its way, then it refreshes every morning." });
    } else setNote({ text: j.message ?? "That did not save.", bad: true });
    setBusy(false);
  };
  const disconnect = async () => {
    setBusy(true);
    const j = await call({ op: "disconnect" });
    if (j.ok) { setState("none"); setShown(null); }
    setNote({ text: j.message ?? (j.ok ? "Disconnected." : "That didn't disconnect."), bad: !j.ok });
    setBusy(false);
  };
  const help = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Help connecting Search Console for ${domain}`)}`;
  const synced = conn?.last_synced_at ? new Date(conn.last_synced_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <div className="dash-card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Google Search Console</h2>
        {state === "connected" ? <span className="pill good">Connected</span> : state === "pick" ? <span className="pill warn">Pick a property</span> : <span className="pill">Not connected</span>}
      </div>
      <p className="intro">Clicks, impressions and average position for every search you appear in, straight from Google.</p>

      {state === "connected" && shown ? (
        <div style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.5 }}>
          {/* 27 Nov 2026 (Danny): a customer sees "Connected · Full access", never the Google account that connected it (often ours). The address is staff-only. */}
          <div><b>Connected</b>{shown.permission ? <> · {CLIENT_ACCESS[shown.permission] ?? "Access confirmed"}</> : null}{staff && shown.email ? <span className="faint"> · as {shown.email}</span> : null}</div>
          <div style={{ wordBreak: "break-all" }}>{shown.property}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{synced ? `Last sync ${synced}` : "First sync on its way"}</div>
          {may ? <button className="btn ghost sm" onClick={disconnect} disabled={busy} style={{ marginTop: 8, paddingLeft: 0 }}>{busy ? "Disconnecting..." : "Disconnect"}</button> : null}
        </div>
      ) : null}

      {state === "pick" && may ? (
        <div style={{ marginTop: 12, fontSize: 13.5 }}>
          <div>Signed in as <b>{email ?? "your Google account"}</b>.{listed && !listed.length ? "" : ` Pick the property for ${domain}:`}</div>
          {listed && !listed.length ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: 0 }}>That account has no Search Console property for {domain} yet. Set one up, about ten minutes{setup?.platform ? ` on ${setup.platform}` : ""}:</p>
              {setup ? (
                <ol style={{ margin: "8px 0 0", paddingLeft: 20, listStyle: "decimal", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, lineHeight: 1.45 }}>
                  {setup.steps.map((t) => <li key={t}>{t}</li>)}
                </ol>
              ) : <p className="muted" style={{ fontSize: 13 }}>Loading the steps...</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button className="btn primary sm" onClick={list} disabled={busy}>{busy ? "Checking..." : "Refresh"}</button>
                {setup ? <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(setup.steps.map((t, i) => `${i + 1}. ${t}`).join("\n")); setHelped("Steps copied."); } catch { /* the steps are on screen */ } }}>Copy the steps</button> : null}
                <button className="btn sm" disabled={helped === "sent"} onClick={async () => { const j = await call({ op: "help" }); setHelped(j.ok ? "sent" : "failed"); }}>Stuck? We&apos;ll do it for you</button>
              </div>
              {helped === "sent" ? <p role="status" style={{ fontSize: 13, margin: "8px 0 0", fontWeight: 600 }}>Thanks - we&apos;ll set it up and connect it for you.</p> : helped === "failed" ? <p role="status" style={{ fontSize: 13, margin: "8px 0 0", color: "var(--bad-fg)" }}>That didn&apos;t go through. Try again in a minute.</p> : helped ? <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>{helped}</p> : null}
            </div>
          ) : listed ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {listed.map((p, i) => (
                <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                  <input type="radio" id={`gc-prop-gsc-${i}`} name="prop-gsc" checked={choice === p.id} onChange={() => setChoice(p.id)} style={{ marginTop: 3 }} />
                  <span style={{ wordBreak: "break-all" }}>{p.name}{p.permission ? <span className="faint"> · {PERMISSION[p.permission] ?? p.permission}</span> : null}</span>
                </label>
              ))}
              <button className="btn primary" onClick={pick} disabled={busy || !choice} style={{ marginTop: 4, width: "100%", padding: "10px 13px" }}>{busy ? "Saving..." : "Use this property"}</button>
            </div>
          ) : busy ? <p className="muted" style={{ fontSize: 13 }}>Reading your properties...</p> : null}
          <button className="btn ghost sm" onClick={connect} style={{ marginTop: 6, paddingLeft: 0 }}>Use a different Google account</button>
        </div>
      ) : null}

      {state === "none" ? (
        may ? (
          <div style={{ marginTop: 14 }}><GoogleButton onClick={connect} /></div>
        ) : (
          <p className="faint" style={{ fontSize: 12.5, margin: "14px 0 0" }}>An owner or editor can connect this.</p>
        )
      ) : null}

      {note ? <p role="status" style={{ fontSize: 13, margin: "10px 0 0", fontWeight: 600, color: note.bad ? "var(--bad-fg)" : "var(--ink)" }}>{note.text}</p> : null}
      <p className="faint" style={{ fontSize: 12, margin: "14px 0 0", lineHeight: 1.45 }}>{READ_ONLY_NOTE}</p>
      <p style={{ fontSize: 12.5, margin: "6px 0 0" }}><a href={help} style={{ color: "var(--accent)", fontWeight: 600 }}>Need help? We&apos;ll do it on a call</a></p>

      {staff && state === "connected" ? <Inspect slug={slug} keyPages={keyPages} inspections={inspections} /> : null}
    </div>
  );
}

/** Staff only at first (Danny, 15 Nov 2026): URL Inspection for key pages - read-only, so a one-click grant is enough. */
function Inspect({ slug, keyPages, inspections }: { slug: string; keyPages: string[]; inspections: Inspection[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, Inspection>>(Object.fromEntries(inspections.map((i) => [i.url, i])));
  const inspect = async (url: string) => {
    setBusy(url);
    const r = await fetch(`/api/dash/${slug}/google`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "inspect", url, path: location.pathname }) }).catch(() => null);
    const j = ((await r?.json().catch(() => null)) ?? { ok: false, message: "No answer." }) as Record<string, unknown> & { ok?: boolean; message?: string };
    if (j.ok) setRows((x) => ({ ...x, [url]: j as unknown as Inspection }));
    else setMsg(j.message ?? "Not inspected.");
    setBusy(null);
  };
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      <h3 style={{ fontSize: 13.5, margin: 0 }}>Indexing <span className="pill" style={{ marginLeft: 6 }}>Staff only</span></h3>
      <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 6px" }}>Whether Google has indexed each key page (URL Inspection). Submit sitemaps in Search Console itself: this connection is read-only.</p>
      {msg ? <p role="status" style={{ fontSize: 12.5, margin: "0 0 6px", fontWeight: 600 }}>{msg}</p> : null}
      {keyPages.length ? (
        <table style={{ width: "100%", fontSize: 12.5 }}>
          <tbody>
            {keyPages.map((u) => {
              const r = rows[u];
              return (
                <tr key={u}>
                  <td style={{ wordBreak: "break-all", padding: "4px 6px 4px 0" }}>{u.replace(/^https?:\/\//, "")}</td>
                  <td style={{ padding: "4px 6px" }}>{r ? <><span className={r.verdict === "PASS" ? "pill good" : "pill warn"}>{r.verdict === "PASS" ? "Indexed" : "Not indexed"}</span><div className="faint">{r.coverage ?? ""}</div></> : <span className="faint">Not checked</span>}</td>
                  <td style={{ padding: "4px 0", textAlign: "right" }}><button className="btn ghost sm" onClick={() => inspect(u)} disabled={busy === u}>{busy === u ? "..." : "Inspect"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>No key pages set for this client yet.</p>}
    </div>
  );
}
