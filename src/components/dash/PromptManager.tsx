"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import EngineLogo from "@/components/EngineLogo";
import type { PlanShape } from "@/lib/dash/allowance";
import { ownNames } from "@/lib/dash/highlight";
import { buildWorkspace } from "@/lib/dash/model";
import { refusePromptText } from "@/lib/dash/ops";
import type { ClusterView, Engine, GroupView, PromptView, Raw } from "@/lib/dash/types";
import { PROMPT_MAX } from "@/lib/tracking/prompt-text";

import AnswerPanel from "./AnswerPanel";
import { InlineText, Menu } from "./ClusterEditor";
import { LimitsLine, Rate, Strip, engineLabel } from "./Figures";
import Icon from "./Icon";
import PackButton from "./PackButton";
import { Toasts, tempId, useOps } from "./useOps";

type Row = { p: PromptView; c: ClusterView; g: GroupView };

/**
 * Every prompt, managed where it is read (Danny, 17 Oct 2026): add one to any
 * cluster and group, rewrite it in place, move it, stop it - with the same
 * optimistic save, undo and refusals as the cluster editor (useOps, ops.ts).
 * Each prompt opens its detail: every answer, every day. Each engine's mark opens that engine's latest answer
 * in a side panel (7 Nov 2026), and on a phone each prompt is a card rather than a table row.
 */
export default function PromptManager({ slug, base, initial, plan, demo = false }: { slug: string; base: string; initial: Raw; plan: PlanShape; demo?: boolean }) {
  const { shown, run, toasts, dismiss, undo } = useOps(slug, initial, plan, demo);
  const ws = useMemo(() => buildWorkspace(shown, { plan }), [shown, plan]);
  const rows: Row[] = ws.clusters.flatMap((c) => [...c.groups, c.own].flatMap((g) => g.prompts.map((p) => ({ p, c, g }))));
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const a = ws.allowances.prompts;
  const detail = (id: string) => `${base}/${slug}/ai/${id}`;
  const [open, setOpen] = useState<{ p: PromptView; e: Engine } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const you = useMemo(() => ownNames(initial.client), [initial.client]);

  return (
    <>
      <div className="dash-card-head">
        <div><h2>Prompts</h2><p className="intro">Latest reading by engine: tap an engine to read its answer. Then the last {ws.dates.length} readings; open a prompt for every answer, on any day.</p><p style={{ margin: "4px 0 0" }}><LimitsLine a={ws.allowances} /></p></div>
        {ws.canWrite ? (a.used < a.limit ? <button className="btn primary" onClick={() => setAdding((x) => !x)}><Icon name="plus" size={14} />Add a prompt</button> : <PackButton slug={slug} owner={ws.role === "owner"} demo={demo} label="All prompts in use - add more" />) : null}
      </div>
      {adding ? <AddPrompt ws={ws} run={run} onDone={() => setAdding(false)} /> : null}
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl stack">
            <thead><tr><th>Prompt</th><th>Latest</th><th>Named you</th><th>Readings</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {rows.map(({ p, c, g }) => (
                <tr key={p.id} className={p.id.startsWith("t") ? "item pending" : undefined}>
                  <td style={{ maxWidth: 440 }}>
                    {editing === p.id ? (
                      <InlineText
                        initial={p.text}
                        label="Prompt"
                        max={PROMPT_MAX}
                        multiline
                        validate={(v) => refusePromptText(v, rows.filter((r) => r.c.id === c.id && r.p.id !== p.id).map((r) => r.p.text))}
                        hint={p.measured ? "This prompt has readings, so saving starts a new prompt in its place. Its history is kept." : undefined}
                        onCancel={() => setEditing(null)}
                        onSave={(v) => { setEditing(null); if (v.trim() !== p.text) run({ op: "prompt.edit", id: p.id, text: v, tempId: tempId() }, p.measured ? "Saved as a new prompt. First reading tomorrow." : "Prompt saved."); }}
                      />
                    ) : (
                      <Link href={detail(p.id)} style={{ fontWeight: 500 }}>{p.text}</Link>
                    )}
                    <div className="sub"><Link href={`${base}/${slug}/clusters/${c.id}`}>{c.name}</Link>{g.id ? ` · ${g.name}` : ""}</div>
                  </td>
                  <td data-l="Latest answer, by engine">{p.measured ? <EngineButtons engines={ws.engines} p={p} onOpen={(e) => setOpen({ p, e })} /> : <span className="pill accent">{p.addedOn > ws.today ? "First reading tomorrow" : "Not read yet"}</span>}</td>
                  <td data-l={p.measured ? "Named you" : undefined}>{p.measured ? <Rate r={p.rate} /> : null}</td>
                  <td data-l="Readings">
                    <Link href={detail(p.id)} style={{ display: "inline-flex", flexDirection: "column", gap: 2 }} aria-label={`Every reading of: ${p.text}`}>
                      {ws.engines.map((e) => <span key={e} style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={engineLabel(e)}><EngineLogo engine={e} size={10} /><Strip days={p.days[e] ?? []} /></span>)}
                    </Link>
                  </td>
                  <td className="r">
                    {ws.canWrite && !p.id.startsWith("t") ? (
                      <Menu label="Prompt options">
                        {(close) => (
                          <>
                            <Link href={detail(p.id)} style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "inherit", textDecoration: "none" }}>Open every answer</Link>
                            <button onClick={() => { close(); setEditing(p.id); }}>Edit</button>
                            <div className="lbl">Move to</div>
                            {ws.clusters.flatMap((cc) => [...cc.groups.map((gg) => ({ cc, gg: gg.id, name: `${cc.name} · ${gg.name}` })), { cc, gg: null, name: cc.groups.length ? `${cc.name} · no group` : cc.name }])
                              .filter((t) => !(t.cc.id === c.id && t.gg === g.id))
                              .map((t) => <button key={`${t.cc.id}-${t.gg ?? "own"}`} onClick={() => { close(); run({ op: "prompt.move", id: p.id, clusterId: t.cc.id, groupId: t.gg }, `Moved to ${t.name}.`); }}>{t.name}</button>)}
                            <hr />
                            <button style={{ color: "var(--bad-fg)" }} onClick={() => { close(); run({ op: "prompt.remove", id: p.id }, "Prompt stopped. It is not read from tomorrow."); }}>Stop tracking</button>
                          </>
                        )}
                      </Menu>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty"><b>No prompts yet</b>Add one the way a buyer would ask an AI assistant, and its first reading comes the next morning.</div>}
      {open ? <AnswerPanel slug={slug} prompt={open.p} engine={open.e} you={you} domain={initial.client.domain} detail={detail(open.p.id)} onClose={close} /> : null}
      <Toasts toasts={toasts} dismiss={dismiss} undo={undo} />
    </>
  );
}

const VERDICT = { named: "names you", missed: "answers without you", none: "gave no answer" } as const;

/** The latest reading's marks (Figures.tsx Cells), each a button that opens that engine's answer. */
function EngineButtons({ engines, p, onOpen }: { engines: readonly Engine[]; p: PromptView; onOpen: (e: Engine) => void }) {
  return (
    <span className="cells">
      {engines.map((e) => {
        const v = p.cells[e] ?? null;
        const what = `${engineLabel(e)}: ${v ? VERDICT[v] : "not read yet"}. Read the answer`;
        return (
          <button key={e} type="button" className={`cell ${v ?? ""}`} title={what} aria-label={what} onClick={() => onOpen(e)}>
            <EngineLogo engine={e} size={12} />
          </button>
        );
      })}
    </span>
  );
}

function AddPrompt({ ws, run, onDone }: { ws: ReturnType<typeof buildWorkspace>; run: ReturnType<typeof useOps>["run"]; onDone: () => void }) {
  const [cluster, setCluster] = useState(ws.clusters[0]?.id ?? "");
  const [group, setGroup] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const c = ws.clusters.find((x) => x.id === cluster);
  if (!ws.clusters.length) return <p className="muted">Add a cluster first, then its prompts.</p>;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const live = c ? [...c.groups.flatMap((g) => g.prompts), ...c.own.prompts].map((p) => p.text) : [];
    const local = refusePromptText(text, live);
    if (local) return setErr(local);
    const refused = run({ op: "prompt.add", tempId: tempId(), clusterId: cluster, groupId: group || null, text }, "Prompt added. First reading tomorrow.");
    if (refused) setErr(refused);
    else onDone();
  };
  return (
    <form onSubmit={submit} className="grp" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }} className="addprompt">
        <label><span className="dash-micro" style={{ marginBottom: 4 }}>Cluster</span>
          <select className="field" style={{ width: "100%" }} value={cluster} onChange={(e) => { setCluster(e.target.value); setGroup(""); }}>{ws.clusters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
        <label><span className="dash-micro" style={{ marginBottom: 4 }}>Group</span>
          <select className="field" style={{ width: "100%" }} value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">No group</option>
            {(c?.groups ?? []).map((g) => <option key={g.id ?? ""} value={g.id ?? ""}>{g.name}</option>)}
          </select>
        </label>
      </div>
      <label style={{ display: "block", marginTop: 8 }}><span className="dash-micro" style={{ marginBottom: 4 }}>Prompt, as a buyer would ask it</span>
        <input className={`field${err ? " err" : ""}`} style={{ width: "100%" }} value={text} maxLength={PROMPT_MAX} onChange={(e) => { setText(e.target.value); setErr(null); }} placeholder="Which … do people recommend for …?" autoFocus />
      </label>
      {err ? <div className="field-err" role="alert">{err}</div> : null}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="submit" className="btn primary" disabled={!text.trim()}>Add prompt</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
