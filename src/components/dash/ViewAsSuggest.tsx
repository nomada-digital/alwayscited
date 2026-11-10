"use client";

import { useRef, useState } from "react";

import { SUGGEST_LIMITS } from "@/config/contact";

/**
 * The hub's floating "Suggest a change" (nomada-dashboards agency_tools.py ndSuggest), on the customer view only while
 * agency staff view it through the hub's view-as link: Shell draws it only with viewAs, so a customer never sees it.
 * The note, this page's heading and its URL go to /api/dash/<slug>/suggest (lib/dash/suggest.ts), which checks the
 * link and hands it to the hub's dashboard_suggestions. Real Settings or Plan pages behind it change nothing here.
 */
export default function ViewAsSuggest({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const section = () => (document.querySelector(".dash-main h1")?.textContent ?? document.title).replace(/\s+/g, " ").trim().slice(0, 60) || null;
  const send = async () => {
    const n = note.trim();
    if (n.length < 3) return setMsg("Add a few words first.");
    setBusy(true);
    setMsg("Sending...");
    const r = await fetch(`/api/dash/${slug}/suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: location.pathname, url: location.href, section: section(), note: n }) }).catch(() => null);
    const out = r ? ((await r.json().catch(() => ({}))) as { ok?: boolean; message?: string }) : {};
    setBusy(false);
    if (!r || !out.ok) return setMsg(out.message ?? "Not sent. Try again.");
    setNote("");
    setMsg("Sent - on Danny’s list now. Thanks.");
  };
  return (
    <div className="nd-sg">
      {open ? (
        <div className="nd-sg-box">
          <p className="nd-sg-t">What should change on this page? It goes straight onto Danny’s to-do list and into tomorrow’s Slack digest. Agency only: the customer never sees this.</p>
          <textarea ref={ta} value={note} onChange={(e) => setNote(e.target.value)} maxLength={SUGGEST_LIMITS.note} placeholder="e.g. Sources: let me filter by keyword cluster" aria-label="Your suggestion" />
          <div className="nd-sg-row">
            <button type="button" onClick={send} disabled={busy}>Send</button>
            <span className="nd-sg-m" role="status">{msg}</span>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="nd-sg-open"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setMsg(section() ? `On: ${section()}` : "");
            setTimeout(() => ta.current?.focus(), 0);
          }
        }}
      >
        Suggest a change
      </button>
    </div>
  );
}
