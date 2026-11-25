"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DELIVERABLE_LIMITS } from "@/config/contact";
import { type Block, type CustomerDeliverable, type Inline, type TrailEvent, byLabel, canTick, downloadName, parseMarkdown, statusLabel, trailLine } from "@/lib/deliverables/core";
import { formatDay } from "@/lib/tracking/figures";

import Icon from "./Icon";

/**
 * One deliverable on the customer's dashboard (25 Nov 2026): what we found, the Markdown to copy or download, the
 * evidence link, its status, and - when the change is theirs to make - the "Mark as done" tick. The tick posts to
 * api/dash/[client]/deliverables, which records who and when and tells the customer success manager. On a demo link
 * nothing is sent: the card changes in the browser only, as every other edit there does.
 */

const day = (iso: string) => formatDay(iso.slice(0, 10), true);

function Inl({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.t === "b" ? <b key={i}>{n.v}</b> : n.t === "code" ? <code key={i}>{n.v}</code> : n.t === "a" ? <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{n.v}</a> : <span key={i}>{n.v}</span>,
      )}
    </>
  );
}

function Md({ blocks }: { blocks: Block[] }) {
  return (
    <div className="dlv-md">
      {blocks.map((b, i) => {
        if (b.t === "p") return <p key={i}><Inl nodes={b.inl} /></p>;
        if (b.t === "h") return b.level === 3 ? <h3 key={i}><Inl nodes={b.inl} /></h3> : <h4 key={i}><Inl nodes={b.inl} /></h4>;
        if (b.t === "pre") return <pre key={i}><code>{b.v}</code></pre>;
        const Tag = b.t;
        return <Tag key={i}>{b.items.map((it, j) => <li key={j}><Inl nodes={it} /></li>)}</Tag>;
      })}
    </div>
  );
}

function Trail({ events }: { events: TrailEvent[] }) {
  if (!events.length) return null;
  return (
    <details className="dlv-trail">
      <summary>History</summary>
      <ol>
        {events.map((e, i) => (
          <li key={i}>
            <span>{trailLine(e)}</span>
            <time dateTime={e.at}>{day(e.at)}</time>
            {e.note ? <q>{e.note}</q> : null}
            {e.url && e.event === "status" ? <a href={e.url} target="_blank" rel="noopener noreferrer">Link</a> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function DeliverableCard({ d, slug, mayTick, demo }: { d: CustomerDeliverable; slug: string; mayTick: boolean; demo: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState<{ by: string; at: string; note: string | null; url: string | null } | null>(d.status === "completed" ? { by: d.completedBy ?? "", at: d.completedAt ?? "", note: d.completionNote, url: d.completionUrl } : null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const status = done ? "completed" : d.status;
  const tickable = canTick({ deliveredBy: d.deliveredBy, status, visible: true });

  const copy = async (f: { filename: string; body: string }) => {
    try {
      await navigator.clipboard.writeText(f.body);
      setCopied(f.filename);
      setTimeout(() => setCopied((c) => (c === f.filename ? null : c)), 1800);
    } catch {
      setErr("Your browser would not copy that. Use Download instead.");
    }
  };
  const download = (f: { filename: string; body: string; contentType: string }) => {
    const href = URL.createObjectURL(new Blob([f.body], { type: `${f.contentType};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = href;
    a.download = downloadName(f.filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const tick = async () => {
    setBusy(true);
    setErr(null);
    const cleanUrl = url.trim();
    if (cleanUrl && !/^https?:\/\/\S+$/i.test(cleanUrl)) {
      setErr("The page link must be a full address starting with https://");
      setBusy(false);
      return;
    }
    if (demo) {
      setDone({ by: "you", at: new Date().toISOString(), note: note.trim() || null, url: cleanUrl || null });
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/dash/${slug}/deliverables`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "tick", id: d.id, note: note.trim() || undefined, url: cleanUrl || undefined }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; by?: string; at?: string } | null;
      if (!res.ok || !body?.ok) {
        setErr(body?.message ?? "That did not save. Try again in a minute.");
        return;
      }
      setDone({ by: body.by ?? "you", at: body.at ?? new Date().toISOString(), note: note.trim() || null, url: cleanUrl || null });
      setOpen(false);
      // The groups and the sidebar's count are drawn on the server: ask for them again.
      router.refresh();
    } catch {
      setErr("That did not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const tone = status === "completed" ? "good" : status === "delivered" ? "accent" : "";
  return (
    <article className="dash-card dlv" id={`d-${d.id}`} aria-labelledby={`t-${d.id}`}>
      <header className="dlv-head">
        <div>
          <h2 id={`t-${d.id}`}>{d.title}</h2>
          <p className="dlv-meta">
            <span className={`pill ${tone}`}>{statusLabel(status, d.deliveredBy)}</span>
            <span className="pill">{byLabel(d.deliveredBy)}</span>
            {d.publishedAt ? <span className="faint">Shared {day(d.publishedAt)}</span> : null}
            {d.version > 1 ? <span className="faint">Version {d.version}</span> : null}
          </p>
        </div>
      </header>

      <Md blocks={parseMarkdown(d.findingsMd)} />

      {d.files.map((f, i) => (
        <div className="dlv-file" key={f.filename}>
          <div className="dlv-file-name">
            <Icon name="plan" />
            <span>{f.filename}</span>
            {i === 0 ? <span className="faint">{d.deliveredBy === "client" ? "Paste into your site's assistant or send to your developer" : "What we are making"}</span> : null}
          </div>
          <div className="dlv-file-btns">
            <button type="button" className="btn sm" onClick={() => copy(f)}>{copied === f.filename ? "Copied" : "Copy"}</button>
            <button type="button" className="btn sm" onClick={() => download(f)}>Download</button>
          </div>
        </div>
      ))}

      {d.evidenceUrl ? (
        <p className="dlv-evidence"><Icon name="ext" /> <a href={d.evidenceUrl} target="_blank" rel="noopener noreferrer">See the evidence</a></p>
      ) : null}

      {status === "completed" ? (
        <div className="dlv-done" role="status">
          <Icon name="check" />
          <div>
            <b>{d.deliveredBy === "client" ? "Marked as done" : "Completed by us"}</b>
            {done?.at ? <> · {day(done.at)}</> : null}
            {d.deliveredBy === "client" && done?.by ? <> · by {done.by}</> : null}
            {done?.note ? <p>{done.note}</p> : null}
            {done?.url ? <p><a href={done.url} target="_blank" rel="noopener noreferrer">{d.deliveredBy === "client" ? "The live page" : "The evidence"}</a></p> : null}
          </div>
        </div>
      ) : tickable ? (
        mayTick ? (
          <div className="dlv-tick">
            {!open ? (
              <button type="button" className="dlv-check" onClick={() => setOpen(true)} aria-expanded={false}>
                <span className="dlv-box" aria-hidden="true" />
                <span><b>Mark as done</b><small>Tick this once the change is live on your site</small></span>
              </button>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); void tick(); }} className="dlv-form">
                <label>
                  <span>A note for us <i>(optional)</i></span>
                  <textarea className="field" rows={2} maxLength={DELIVERABLE_LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know, or what you changed" />
                </label>
                <label>
                  <span>Link to the live page <i>(optional)</i></span>
                  <input className="field" type="url" inputMode="url" maxLength={DELIVERABLE_LIMITS.url} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
                </label>
                <div className="dlv-form-btns">
                  <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Confirm: it is done"}</button>
                  <button type="button" className="btn ghost" onClick={() => { setOpen(false); setErr(null); }} disabled={busy}>Cancel</button>
                </div>
              </form>
            )}
            {err ? <div className="field-err" role="alert">{err}</div> : null}
          </div>
        ) : (
          <p className="faint dlv-viewer">An owner or editor on your account can mark this as done.</p>
        )
      ) : d.deliveredBy === "nomada" ? (
        <p className="faint dlv-viewer">We are making this change, so there is nothing for you to do. It shows as completed here, with our evidence, when it is done.</p>
      ) : null}
      {err && !tickable ? <div className="field-err" role="alert">{err}</div> : null}

      <Trail events={done && !d.trail.some((e) => e.event === "status" && e.toStatus === "completed") ? [...d.trail, { at: done.at, actor: done.by, actorKind: "customer", event: "status", toStatus: "completed", version: null, note: done.note, url: done.url }] : d.trail} />
    </article>
  );
}
