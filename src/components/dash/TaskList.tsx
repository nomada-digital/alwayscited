"use client";

import { useState } from "react";

import type { TaskRow } from "@/lib/tasks/store";

const LABEL = { todo: "To do", done: "Done", checked: "Checked by us" } as const;
const AUTO = new Set(["connect_gsc", "connect_ga4", "connect_bing", "page_check"]);

/** Your tasks (27 Nov 2026): each with why it matters, plain steps, and a status. Ticking is the customer's; "Checked by us" is ours. */
export default function TaskList({ slug, initial, canWrite }: { slug: string; initial: TaskRow[]; canWrite: boolean }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const act = async (id: string, op: "done" | "undo" | "check") => {
    setBusy(id);
    const r = await fetch(`/api/dash/${slug}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, op }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; message?: string; tasks?: TaskRow[] } | null;
    if (j?.ok && j.tasks) { setRows(j.tasks); setNote((n) => ({ ...n, [id]: "" })); }
    else setNote((n) => ({ ...n, [id]: j?.message ?? "We couldn't reach the server. Try again in a minute." }));
    setBusy(null);
  };

  if (!rows.length) return <div className="dash-card"><p className="intro" style={{ margin: 0 }}>Nothing to do right now. When we have something that will help, it appears here.</p></div>;
  const open = rows.filter((t) => t.status !== "checked");
  const closed = rows.filter((t) => t.status === "checked");

  const card = (t: TaskRow) => (
    <div className={`dash-card task task-${t.status}`} key={t.id} id={`task-${t.id}`}>
      <div className="task__head">
        <h2 style={{ margin: 0 }}>{t.title}</h2>
        <span className={`pill ${t.status === "checked" ? "good" : t.status === "done" ? "warn" : ""}`}>{t.status === "done" && AUTO.has(t.kind) ? "Done, we'll check" : LABEL[t.status]}</span>
      </div>
      {t.why ? <p className="intro" style={{ margin: "4px 0 0" }}>{t.why}</p> : null}
      <ol className="task__steps">
        {t.steps.map((s, i) => (
          <li key={i}>
            {s.href ? <a href={s.href} {...(s.href.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{s.text}</a> : s.text}
            {s.img ? <img src={s.img} alt="" className="task__img" loading="lazy" /> : null}
          </li>
        ))}
      </ol>
      {t.checkNote && t.status !== "todo" ? <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>{t.checkNote}</p> : null}
      {t.kind === "page_check" && t.status !== "checked" && t.checkNote && t.status === "todo" && t.lastCheckAt ? <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Last check: {t.checkNote}</p> : null}
      {canWrite && t.status !== "checked" ? (
        <div className="task__actions">
          {t.status === "todo" ? <button className="btn primary sm" onClick={() => act(t.id, "done")} disabled={busy === t.id}>{busy === t.id ? "Saving..." : "Mark as done"}</button> : <button className="btn ghost sm" onClick={() => act(t.id, "undo")} disabled={busy === t.id}>Not done yet</button>}
          {AUTO.has(t.kind) ? <button className="btn sm" onClick={() => act(t.id, "check")} disabled={busy === t.id}>Check now</button> : null}
          {AUTO.has(t.kind) ? <span className="faint" style={{ fontSize: 12.5 }}>We also check this every morning.</span> : <span className="faint" style={{ fontSize: 12.5 }}>Tick it and we&apos;ll confirm.</span>}
        </div>
      ) : null}
      {note[t.id] ? <p role="status" style={{ fontSize: 13, margin: "8px 0 0", fontWeight: 600, color: "var(--bad-fg)" }}>{note[t.id]}</p> : null}
    </div>
  );

  return (
    <div className="dash-stack">
      {open.length ? open.map(card) : <div className="dash-card"><p className="intro" style={{ margin: 0 }}>Nothing left to do. Thank you.</p></div>}
      {closed.length ? <><h2 style={{ fontSize: 15, margin: "20px 0 0" }}>Checked by us</h2>{closed.map(card)}</> : null}
    </div>
  );
}
