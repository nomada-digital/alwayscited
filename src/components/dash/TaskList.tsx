"use client";

import { useState } from "react";

import { PromptBox } from "@/components/dash/PromptBox";
import { CONTACT_EMAIL } from "@/config/contact";
import { ACCESS, GOOGLE_ACCESS, PLATFORMS, PLATFORM_NAME, type Platform } from "@/lib/tasks/platform";
import type { AccessState, TaskRow } from "@/lib/tasks/store";

const LABEL = { todo: "To do", done: "Done", checked: "Checked by us" } as const;
const AUTO = new Set(["connect_gsc", "connect_ga4", "connect_bing", "page_check", "access"]);
type Way = "ours" | "diy" | "ai";
const WAY_LABEL: Record<Way, string> = { ours: "Let us do it for you", diy: "Do it yourself", ai: "Ask your AI" };

/**
 * Your tasks (27 Nov 2026): each with why it matters and up to three ways to do it. "Let us do it for you" (we're given access) is
 * first wherever we can do the job; "Do it yourself" is the plain steps; "Ask your AI" is a copy-ready prompt, only where an AI can
 * realistically do it. Once site access is granted, on-site tasks say "We'll handle this". Ticking is the customer's; "Checked by us" is ours.
 */
export default function TaskList({ slug, domain, initial, canWrite, platform: platform0, siteAccess: access0 }: { slug: string; domain: string; initial: TaskRow[]; canWrite: boolean; platform: Platform | null; siteAccess: AccessState }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [platform, setPlatform] = useState<Platform>(platform0 ?? "custom");
  const [access, setAccess] = useState<AccessState>(access0);
  const [way, setWay] = useState<Record<string, Way>>({});

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/dash/${slug}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    return (await r?.json().catch(() => null)) as { ok?: boolean; message?: string; tasks?: TaskRow[] } | null;
  };
  const act = async (id: string, op: "done" | "undo" | "check") => {
    setBusy(id);
    const j = await post({ id, op });
    if (j?.ok && j.tasks) { setRows(j.tasks); setNote((n) => ({ ...n, [id]: "" })); }
    else setNote((n) => ({ ...n, [id]: j?.message ?? "We couldn't reach the server. Try again in a minute." }));
    setBusy(null);
  };
  const given = async (id: string) => {
    setBusy(id);
    const j = await post({ op: "access", platform });
    if (j?.ok && j.tasks) { setRows(j.tasks); setAccess("requested"); setNote((n) => ({ ...n, [id]: "" })); }
    else setNote((n) => ({ ...n, [id]: j?.message ?? "We couldn't reach the server. Try again in a minute." }));
    setBusy(null);
  };
  const changePlatform = async (p: Platform) => { setPlatform(p); await post({ op: "platform", platform: p }); };

  const help = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Book a quick call to set up access for ${domain}`)}`;

  const accessPanel = (t: TaskRow) => {
    const g = ACCESS[platform];
    return (
      <div className="task__way">
        <label className="task__plat">Your site looks like it is on
          <select className="field" value={platform} onChange={(e) => changePlatform(e.target.value as Platform)} disabled={!canWrite}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_NAME[p]}</option>)}
          </select>
        </label>
        <p className="task__plat-note"><b>{g.label}</b></p>
        <ol className="task__steps">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {g.note ? <p className="faint" style={{ fontSize: 12.5, margin: "0 0 10px" }}>{g.note}</p> : null}
        <p className="faint" style={{ fontSize: 12.5, margin: "0 0 10px" }}>We never ask for a password: you send an invitation from your own account and can remove us whenever you like.</p>
        <div className="task__actions">
          {canWrite && access === "none" && t.status === "todo" ? <button className="btn primary sm" onClick={() => given(t.id)} disabled={busy === t.id}>{busy === t.id ? "Saving..." : "I've given you access"}</button> : null}
          {access === "requested" ? <span className="pill warn">Access sent, we&apos;re confirming it</span> : null}
          <a className="btn sm" href={help}>Book a quick call to set it up</a>
        </div>
      </div>
    );
  };

  const googlePanel = (t: TaskRow) => {
    const steps = t.kind === "connect_gsc" ? GOOGLE_ACCESS.gsc : GOOGLE_ACCESS.ga4;
    return (
      <div className="task__way">
        <ol className="task__steps">{steps.map((s, i) => <li key={i}>{s}</li>)}<li>Press Mark as done below and we&apos;ll confirm it.</li></ol>
        <a className="btn sm" href={help}>Book a quick call to set it up</a>
      </div>
    );
  };

  const stepsPanel = (t: TaskRow) => (
    <ol className="task__steps">
      {t.steps.map((s, i) => (
        <li key={i}>
          {s.href ? <a href={s.href} {...(s.href.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{s.text}</a> : s.text}
          {s.img ? <img src={s.img} alt="" className="task__img" loading="lazy" /> : null}
        </li>
      ))}
    </ol>
  );

  if (!rows.length) return <div className="dash-card"><p className="intro" style={{ margin: 0 }}>Nothing to do right now. When we have something that will help, it appears here.</p></div>;
  const ours = (t: TaskRow) => t.onsite && access === "granted" && t.status !== "checked";
  const open = rows.filter((t) => t.status !== "checked");
  const closed = rows.filter((t) => t.status === "checked");

  const card = (t: TaskRow) => {
    const handled = ours(t);
    const ways: Way[] = [];
    if (!handled && t.kind !== "access" && (t.onsite || t.kind === "connect_gsc" || t.kind === "connect_ga4")) ways.push("ours");
    if (!handled && t.kind !== "access") ways.push("diy");
    if (!handled && t.aiPrompt) ways.push("ai");
    const current: Way = way[t.id] && ways.includes(way[t.id]!) ? way[t.id]! : ways[0] ?? "diy";
    return (
      <div className={`dash-card task task-${t.status}`} key={t.id} id={`task-${t.id}`}>
        <div className="task__head">
          <h2 style={{ margin: 0 }}>{t.title}</h2>
          <span className={`pill ${t.status === "checked" || handled ? "good" : t.status === "done" ? "warn" : ""}`}>{handled ? "We'll handle this" : t.status === "done" && AUTO.has(t.kind) ? "Done, we'll check" : LABEL[t.status]}</span>
        </div>
        {t.why ? <p className="intro" style={{ margin: "4px 0 0" }}>{t.why}</p> : null}
        {handled ? (
          <p style={{ margin: "12px 0 4px", fontSize: 14 }}>You've given us access, so there is nothing for you to do. We'll make this change and send it to you for approval before it goes live.</p>
        ) : t.status === "checked" ? (
          <div style={{ marginTop: 10 }}>{t.kind === "access" ? null : stepsPanel(t)}</div>
        ) : t.kind === "access" ? (
          <div style={{ marginTop: 10 }}>{accessPanel(t)}</div>
        ) : (
          <>
            {ways.length > 1 ? (
              <div className="task__ways" role="tablist" aria-label="Ways to do this">
                {ways.map((w) => <button key={w} role="tab" aria-selected={current === w} className={`task__tab${current === w ? " is-on" : ""}`} onClick={() => setWay((m) => ({ ...m, [t.id]: w }))}>{WAY_LABEL[w]}</button>)}
              </div>
            ) : null}
            {current === "ours" ? (t.onsite ? accessPanel(t) : googlePanel(t)) : current === "ai" && t.aiPrompt ? (
              <div className="task__way">
                <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Copy this into ChatGPT, Claude, or your site builder&apos;s own AI, then check what it changes before you publish.</p>
                <PromptBox n={1} title="Prompt for your AI" body={t.aiPrompt} />
              </div>
            ) : stepsPanel(t)}
          </>
        )}
        {t.checkNote && t.status !== "todo" ? <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>{t.checkNote}</p> : null}
        {t.kind === "page_check" && t.status === "todo" && t.lastCheckAt && t.checkNote ? <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Last check: {t.checkNote}</p> : null}
        {canWrite && t.status !== "checked" && !handled && t.kind !== "access" ? (
          <div className="task__actions">
            {t.status === "todo" ? <button className="btn primary sm" onClick={() => act(t.id, "done")} disabled={busy === t.id}>{busy === t.id ? "Saving..." : "Mark as done"}</button> : <button className="btn ghost sm" onClick={() => act(t.id, "undo")} disabled={busy === t.id}>Not done yet</button>}
            {AUTO.has(t.kind) ? <button className="btn sm" onClick={() => act(t.id, "check")} disabled={busy === t.id}>Check now</button> : null}
            {AUTO.has(t.kind) ? <span className="faint" style={{ fontSize: 12.5 }}>We also check this every morning.</span> : <span className="faint" style={{ fontSize: 12.5 }}>Tick it and we&apos;ll confirm.</span>}
          </div>
        ) : null}
        {note[t.id] ? <p role="status" style={{ fontSize: 13, margin: "8px 0 0", fontWeight: 600, color: "var(--bad-fg)" }}>{note[t.id]}</p> : null}
      </div>
    );
  };

  return (
    <div className="dash-stack">
      {open.length ? open.map(card) : <div className="dash-card"><p className="intro" style={{ margin: 0 }}>Nothing left to do. Thank you.</p></div>}
      {closed.length ? <><h2 style={{ fontSize: 15, margin: "20px 0 0" }}>Checked by us</h2>{closed.map(card)}</> : null}
    </div>
  );
}
