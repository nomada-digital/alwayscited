"use client";

import { useState } from "react";

import { CONTACT_EMAIL } from "@/config/contact";
import { GA4_ADMIN_LINK, GOOGLE_ACCESS_EMAIL, PERMISSION, READ_ONLY_NOTE, canSubmit, gscUsersLink, type GoogleProvider } from "@/lib/dash/google";
import type { RawConnection } from "@/lib/dash/types";

type Listed = { id: string; name: string; permission: string | null };
type Inspection = { url: string; verdict: string | null; coverage: string | null; last_crawl: string | null; inspected_at: string };

const NAME: Record<GoogleProvider, string> = { gsc: "Google Search Console", ga4: "Google Analytics 4" };
const WHAT: Record<GoogleProvider, string> = {
  gsc: "Clicks, impressions and average position for every search you appear in, straight from Google.",
  ga4: "Your visits by channel, the pages people land on from search, and the key events they lead to.",
};

/**
 * Connect Search Console or GA4 direct (15 Nov 2026, lib/dash/google.ts): our address to copy, a link to the
 * right page in Google, then Check connection lists the properties we can see for this site and the customer
 * picks one (api/dash/[client]/google). On a view-as link, agency staff can do it for the customer, and the Search
 * Console card adds the indexing helpers - sitemap submit and URL Inspection - which are staff only at first.
 */
export default function GoogleConnect({ slug, domain, provider, conn, canWrite, demo, staff, keyPages = [], inspections = [] }: {
  slug: string;
  domain: string;
  provider: GoogleProvider;
  conn: RawConnection | null;
  canWrite: boolean;
  demo: boolean;
  staff: boolean;
  keyPages?: string[];
  inspections?: Inspection[];
}) {
  const direct = conn?.via === "google" && conn.status === "connected";
  const [connected, setConnected] = useState<{ property: string; name: string; permission: string | null } | null>(direct && conn?.property ? { property: conn.property, name: conn.property_name ?? conn.property, permission: conn.permission ?? null } : null);
  const [listed, setListed] = useState<Listed[] | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [changing, setChanging] = useState(false);
  const may = (canWrite && !demo) || staff;

  const call = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/dash/${slug}/google`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, path: location.pathname, ...body }) }).catch(() => null);
    return ((await r?.json().catch(() => null)) ?? { ok: false, message: "We could not check just now. Try again in a minute." }) as Record<string, unknown> & { ok?: boolean; message?: string };
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_ACCESS_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the address is on screen to copy by hand */
    }
  };
  const check = async () => {
    setBusy(true);
    setNote(null);
    const j = await call({ op: "list" });
    const l = (j.listed as Listed[] | undefined) ?? [];
    if (j.ok && l.length) {
      setListed(l);
      setChoice(l[0].id);
    } else setNote({ text: j.message ?? "Not visible yet: it can take a few minutes.", bad: !j.ok });
    setBusy(false);
  };
  const pick = async () => {
    setBusy(true);
    setNote(null);
    const j = await call({ op: "pick", property: choice });
    if (j.ok) {
      setConnected({ property: String(j.property), name: String(j.name ?? j.property), permission: (j.permission as string | null) ?? null });
      setListed(null);
      setChanging(false);
      setNote({ text: "Connected. Your first numbers are on their way (up to 16 months of history) and refresh every morning." });
    } else setNote({ text: j.message ?? "That did not save. Try again in a minute.", bad: true });
    setBusy(false);
  };

  const steps = provider === "gsc"
    ? { link: gscUsersLink(connected?.property ?? null), linkText: "Open Search Console, Users and permissions", how: "Press Add user, paste the address, set Permission to Restricted and press Add." }
    : { link: GA4_ADMIN_LINK, linkText: "Open Google Analytics, Admin", how: "Go to Property access management, press the plus, choose Add users, paste the address, pick the Viewer role and press Add." };
  const help = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Help connecting ${NAME[provider]} for ${domain}`)}`;
  const showSteps = !connected || changing;

  return (
    <div className="dash-card" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ flex: 1 }}>{`Connect ${NAME[provider]}`}</h2>
        {connected ? <span className="pill good">Connected</span> : <span className="pill">Not connected</span>}
      </div>
      <p className="intro">{WHAT[provider]}</p>

      {connected && !changing ? (
        <div style={{ marginTop: 12, fontSize: 13.5 }}>
          <b style={{ wordBreak: "break-all" }}>{connected.name}</b>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {provider === "gsc" && connected.permission ? `Our access: ${PERMISSION[connected.permission] ?? connected.permission}. ` : ""}
            {conn?.last_synced_at ? `Last read ${conn.last_synced_at.slice(0, 10)}.` : "First read on its way."}
          </div>
          {may ? <button className="btn ghost sm" onClick={() => { setChanging(true); setNote(null); }} style={{ marginTop: 8, paddingLeft: 0 }}>Use a different property</button> : null}
        </div>
      ) : null}

      {showSteps && !may ? <p className="faint" style={{ fontSize: 12.5, margin: "14px 0 0" }}>An owner or editor can connect this.</p> : null}
      {showSteps && may ? (
        <ol style={{ margin: "14px 0 0", paddingLeft: 20, listStyle: "decimal", display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, lineHeight: 1.45 }}>
          <li>
            Copy our address.
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", borderRadius: 10, background: "var(--wash)", marginTop: 6 }}>
              <b style={{ fontSize: 12.5, wordBreak: "break-all", flex: "1 1 200px" }}>{GOOGLE_ACCESS_EMAIL}</b>
              <button className="btn sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            </div>
          </li>
          <li>
            <a href={steps.link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }}>{steps.linkText}</a>
            {provider === "gsc" && !connected ? ", and pick the property for your site." : "."} {steps.how}
          </li>
          <li>
            Come back and check.
            {listed ? (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{listed.length === 1 ? "We can see this property:" : "We can see these properties. Pick the one for your site:"}</span>
                {listed.map((p, i) => (
                  <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                    <input type="radio" id={`gc-prop-${provider}-${i}`} name={`prop-${provider}`} checked={choice === p.id} onChange={() => setChoice(p.id)} style={{ marginTop: 3 }} />
                    <span style={{ wordBreak: "break-all" }}>{p.name}{p.permission ? <span className="faint"> · {PERMISSION[p.permission] ?? p.permission}</span> : null}</span>
                  </label>
                ))}
                <button className="btn primary" onClick={pick} disabled={busy || !choice} style={{ marginTop: 4, width: "100%", padding: "10px 13px" }}>{busy ? "Saving..." : "Use this property"}</button>
              </div>
            ) : (
              <button className="btn primary" onClick={check} disabled={busy} style={{ marginTop: 8, width: "100%", padding: "10px 13px" }}>{busy ? "Checking..." : "Check connection"}</button>
            )}
          </li>
        </ol>
      ) : null}

      {note ? <p role="status" style={{ fontSize: 13, margin: "10px 0 0", fontWeight: 600, color: note.bad ? "var(--bad-fg)" : "var(--ink)" }}>{note.text}</p> : null}
      <p className="faint" style={{ fontSize: 12, margin: "14px 0 0", lineHeight: 1.45 }}>{READ_ONLY_NOTE}</p>
      <p style={{ fontSize: 12.5, margin: "6px 0 0" }}><a href={help} style={{ color: "var(--accent)", fontWeight: 600 }}>Need help? We&apos;ll do it on a call</a></p>

      {staff && provider === "gsc" && connected ? <IndexingHelpers slug={slug} permission={connected.permission} keyPages={keyPages} inspections={inspections} /> : null}
    </div>
  );
}

/** Staff only at first (Danny, 15 Nov 2026): sitemap submit, which needs Full user, and URL Inspection for key pages. */
function IndexingHelpers({ slug, permission, keyPages, inspections }: { slug: string; permission: string | null; keyPages: string[]; inspections: Inspection[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, Inspection>>(Object.fromEntries(inspections.map((i) => [i.url, i])));
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/dash/${slug}/google`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "gsc", path: location.pathname, ...body }) }).catch(() => null);
    return ((await r?.json().catch(() => null)) ?? { ok: false, message: "No answer." }) as Record<string, unknown> & { ok?: boolean; message?: string };
  };
  const submit = async () => {
    setBusy("submit");
    const j = await post({ op: "submit" });
    setMsg(j.message ?? (j.ok ? "Submitted." : "Not submitted."));
    setBusy(null);
  };
  const inspect = async (url: string) => {
    setBusy(url);
    const j = await post({ op: "inspect", url });
    if (j.ok) setRows((r) => ({ ...r, [url]: j as unknown as Inspection }));
    else setMsg(j.message ?? "Not inspected.");
    setBusy(null);
  };
  const full = canSubmit(permission);
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      <h3 style={{ fontSize: 13.5, margin: 0 }}>Indexing <span className="pill" style={{ marginLeft: 6 }}>Staff only</span></h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button className="btn sm" onClick={submit} disabled={!full || busy === "submit"}>{busy === "submit" ? "Submitting..." : "Submit sitemap"}</button>
        <span className="muted" style={{ fontSize: 12.5 }}>{full ? "Our access is Full, so Google accepts a sitemap from us." : "Needs Full access: submitting a sitemap is a change, and Restricted is read-only. Ask the customer to set our access to Full in Users and permissions."}</span>
      </div>
      {msg ? <p role="status" style={{ fontSize: 12.5, margin: "8px 0 0", fontWeight: 600 }}>{msg}</p> : null}
      <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 6px" }}>URL Inspection (read-only, works on Restricted): whether Google has indexed each key page.</p>
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
