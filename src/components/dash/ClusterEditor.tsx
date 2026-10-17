"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PlanShape } from "@/lib/dash/allowance";
import { buildWorkspace } from "@/lib/dash/model";
import { KEYWORD_MAX, NAME_MAX, NOTE_MAX, TERM_MAX, refuseKeywordText, refusePromptText, type Op } from "@/lib/dash/ops";
import { PROMPT_MAX } from "@/lib/tracking/prompt-text";
import type { ClusterView, ConsoleFig, Engine, GroupView, KeywordView, PromptView, Raw } from "@/lib/dash/types";

import { Cells, Change, Pos, Rate, Spark, pct } from "./Figures";
import Icon from "./Icon";
import PackButton from "./PackButton";
import { Toasts, tempId, useOps } from "./useOps";

/**
 * One cluster, editable (17 Oct 2026): its keyword groups, each group's
 * keywords and the prompts that ask the same thing, Search Console and Bing
 * figures beside them once connected, and every change a customer can make -
 * add, rename, remove, move between groups and clusters, edit in place - drawn
 * at once and saved behind (useOps).
 */

type Source = "off" | "gsc" | "bing";
type Drag = { kind: "keyword" | "prompt"; id: string } | null;
type Props = {
  slug: string;
  /** The link prefix on this host (host.ts dashBase). */
  base: string;
  /** A shared demo link: edits are kept in the browser (useOps). */
  demo?: boolean;
  clusterId: string;
  initial: Raw;
  plan: PlanShape;
  consoleLive: { gsc: boolean; bing: boolean };
  integrationsHref: string;
};

export default function ClusterEditor({ slug, base, demo = false, clusterId, initial, plan, consoleLive, integrationsHref }: Props) {
  const { shown, run, toasts, dismiss, undo } = useOps(slug, initial, plan, demo);
  const anyLive = consoleLive.gsc || consoleLive.bing;
  const [source, setSource] = useState<Source>(consoleLive.gsc ? "gsc" : consoleLive.bing ? "bing" : "off");
  const [sample, setSample] = useState(false);
  const ws = useMemo(() => buildWorkspace(shown, { plan, sample: sample && !anyLive }), [shown, plan, sample, anyLive]);
  const cluster = ws.clusters.find((c) => c.id === clusterId) ?? null;
  const [drag, setDrag] = useState<Drag>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const showConsole = source !== "off" && (anyLive || sample);

  if (!cluster) {
    return (
      <div className="dash-card empty">
        <b>This cluster has been removed</b>
        It stops being checked from tomorrow. Undo from the message below, or go back to your clusters.
        <Toasts toasts={toasts} dismiss={dismiss} undo={undo} />
      </div>
    );
  }

  const others = ws.clusters.filter((c) => c.id !== cluster.id);
  const ctx: Ctx = { base, demo, run, ws, cluster, others, engines: ws.engines, canWrite: ws.canWrite, drag, setDrag, source: showConsole ? source : "off", sample: sample && !anyLive, groupsReady: ws.groupsReady };

  return (
    <>
      <div className="dash-card" style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 className="dash-h2">Keyword groups</h2>
            <p className="intro" style={{ margin: "2px 0 0", color: "var(--soft)", fontSize: 13 }}>
              The searches in this cluster that mean the same thing, with the prompts that ask it of AI. Move a keyword or prompt by dragging it, or from its ⋯ menu.
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg" role="group" aria-label="Search console figures">
              <button aria-pressed={source === "off"} onClick={() => setSource("off")}>Positions</button>
              <button aria-pressed={source === "gsc"} onClick={() => setSource("gsc")}>Search Console</button>
              <button aria-pressed={source === "bing"} onClick={() => setSource("bing")}>Bing</button>
            </div>
            {ws.canWrite && ws.groupsReady ? (
              <button className="btn primary" onClick={() => setAddingGroup(true)}><Icon name="plus" size={14} />Add group</button>
            ) : null}
          </div>
        </div>
        {source !== "off" && !anyLive ? (
          <div className="banner warn" style={{ marginTop: 12 }}>
            <span>
              <b>{source === "gsc" ? "Search Console" : "Bing Webmaster Tools"} is not connected.</b>{" "}
              {sample ? "These are sample figures, to show what the columns hold. They are not your data." : "Connect it to see clicks and impressions for every keyword, sorted into these groups."}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn sm" onClick={() => setSample((s) => !s)}>{sample ? "Hide sample" : "Preview with sample data"}</button>
              <a className="btn sm primary" href={integrationsHref}>Connect</a>
            </span>
          </div>
        ) : null}
        {!ws.groupsReady ? (
          <div className="banner" style={{ marginTop: 12 }}>Keyword groups switch on shortly. Until then, keywords and prompts can be added to the cluster itself.</div>
        ) : null}
      </div>

      <div style={{ marginTop: 14 }}>
        {addingGroup ? <NewGroup ctx={ctx} onDone={() => setAddingGroup(false)} /> : null}
        {cluster.groups.length === 0 && !addingGroup ? (
          <div className="dash-card empty" style={{ marginBottom: 12 }}>
            <b>Split this cluster into groups</b>
            <span style={{ display: "block", maxWidth: 520, margin: "0 auto" }}>
              A group is one way of searching for the same thing - &ldquo;staffing agencies&rdquo; beside &ldquo;recruitment agencies&rdquo;. Give it a few words and the keywords you rank for that contain them sort themselves into it.
            </span>
            {ws.canWrite && ws.groupsReady ? <button className="btn primary" style={{ marginTop: 14 }} onClick={() => setAddingGroup(true)}><Icon name="plus" size={14} />Add your first group</button> : null}
          </div>
        ) : null}
        {cluster.groups.map((g) => <Group key={g.id} g={g} ctx={ctx} />)}
        <Group g={cluster.own} ctx={ctx} own />
      </div>
      <Toasts toasts={toasts} dismiss={dismiss} undo={undo} />
    </>
  );
}

type Ctx = {
  base: string;
  demo: boolean;
  run: (op: Op, label?: string | null, opts?: { undoable?: boolean }) => string | null;
  ws: ReturnType<typeof buildWorkspace>;
  cluster: ClusterView;
  others: ClusterView[];
  engines: Engine[];
  canWrite: boolean;
  drag: Drag;
  setDrag: (d: Drag) => void;
  source: Source;
  sample: boolean;
  groupsReady: boolean;
};

// ---------------------------------------------------------------- a group

function Group({ g, ctx, own = false }: { g: GroupView; ctx: Ctx; own?: boolean }) {
  const { run, cluster, canWrite, drag, setDrag } = ctx;
  const [over, setOver] = useState(false);
  const [editName, setEditName] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const tracked = g.keywords.filter((k) => k.src === "tracked");
  const footprint = g.keywords.filter((k) => k.src === "footprint");
  const named = g.prompts.filter((p) => p.rate !== null);
  const rate = named.length ? named.reduce((s, p) => s + (p.rate ?? 0), 0) / named.length : null;
  const empty = own && !g.keywords.length && !g.prompts.length;
  if (empty && !drag && cluster.groups.length) return null;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!drag) return;
    const op: Op = drag.kind === "keyword" ? { op: "keyword.move", id: drag.id, clusterId: cluster.id, groupId: g.id } : { op: "prompt.move", id: drag.id, clusterId: cluster.id, groupId: g.id };
    run(op, `Moved to ${own ? "the cluster" : g.name}.`);
    setDrag(null);
  };
  const dropProps = canWrite && ctx.groupsReady
    ? {
        onDragOver: (e: React.DragEvent) => { if (drag) { e.preventDefault(); setOver(true); } },
        onDragLeave: () => setOver(false),
        onDrop,
      }
    : {};

  return (
    <section className={`grp${own ? " own" : ""}${over ? " drop" : ""}`} aria-label={own ? "Not in a group" : `Group: ${g.name}`} {...dropProps}>
      <div className="grp-head">
        {own ? (
          <h3 className="muted">{cluster.groups.length ? "Not in a group" : "This cluster"}</h3>
        ) : editName ? (
          <InlineText initial={g.name} label="Group name" max={NAME_MAX} onSave={(v) => { setEditName(false); if (v.trim() && v.trim() !== g.name) run({ op: "group.edit", id: g.id!, name: v }, "Group renamed."); }} onCancel={() => setEditName(false)} />
        ) : (
          <h3>{canWrite ? <button className="txt" style={{ all: "unset", cursor: "text" }} onClick={() => setEditName(true)} title="Rename">{g.name}</button> : g.name}</h3>
        )}
        <span className="pill">{tracked.length} tracked</span>
        {g.prompts.length ? <span className="pill accent" title="Answers naming you, average of this group's prompts on the latest reading">AI {pct(rate)}</span> : null}
        {!own ? <Terms g={g} ctx={ctx} /> : null}
        {!own && canWrite ? (
          <span className="acts">
            <Menu label={`Options for ${g.name}`}>
              {(close) => (
                <>
                  <button onClick={() => { close(); setEditName(true); }}>Rename</button>
                  <button onClick={() => { close(); setEditNote(true); }}>{g.note ? "Edit note" : "Add a note"}</button>
                  <hr />
                  <button onClick={() => { close(); run({ op: "group.remove", id: g.id! }, `Removed ${g.name}. Its keywords and prompts stay tracked.`); }} style={{ color: "var(--bad-fg)" }}>Remove group</button>
                </>
              )}
            </Menu>
          </span>
        ) : null}
        {editNote ? (
          <div className="note" style={{ marginTop: 0 }}>
            <InlineText initial={g.note ?? ""} label="Note" max={NOTE_MAX} placeholder="Who searches this way, and why it matters" onSave={(v) => { setEditNote(false); if (v.trim() !== (g.note ?? "")) run({ op: "group.edit", id: g.id!, note: v }, "Note saved."); }} onCancel={() => setEditNote(false)} />
          </div>
        ) : g.note ? <div className="note">{g.note}</div> : null}
      </div>
      <div className="grp-body">
        <div className="grp-col">
          <h4>Keywords {ctx.source !== "off" ? <ConsoleHead source={ctx.source} sample={ctx.sample} /> : <span className="faint" style={{ fontWeight: 600, marginLeft: "auto" }}>Google</span>}</h4>
          {tracked.map((k) => <KeywordRow key={k.id} k={k} g={g} ctx={ctx} />)}
          {footprint.map((k) => <KeywordRow key={`fp-${k.keyword}`} k={k} g={g} ctx={ctx} />)}
          {!g.keywords.length ? <div className="empty-sm">{own ? "Keywords in no group show here." : g.terms.length ? "Nothing you rank for contains these words yet. Add a keyword to track it daily." : "Add words to match, or a keyword to track."}</div> : null}
          {ctx.source !== "off" ? <Discovered g={g} ctx={ctx} /> : null}
          {canWrite ? <Adder kind="keyword" g={g} ctx={ctx} /> : null}
        </div>
        <div className="grp-col">
          <h4>Prompts <span style={{ marginLeft: "auto" }}><EngineHeadsMini engines={ctx.engines} /></span></h4>
          {g.prompts.map((p) => <PromptRow key={p.id} p={p} g={g} ctx={ctx} />)}
          {!g.prompts.length ? <Suggest g={g} ctx={ctx} /> : null}
          {canWrite ? <Adder kind="prompt" g={g} ctx={ctx} /> : null}
        </div>
      </div>
    </section>
  );
}

function EngineHeadsMini({ engines }: { engines: Engine[] }) {
  return <span className="faint" style={{ fontWeight: 600 }}>{engines.length} engines · latest</span>;
}

function ConsoleHead({ source, sample }: { source: Source; sample: boolean }) {
  return (
    <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }} className="faint">
      {sample ? <span className="pill sample">Sample</span> : null}
      <span style={{ fontWeight: 600 }}>{source === "gsc" ? "Search Console" : "Bing"} · clicks / impr. / pos.</span>
    </span>
  );
}

function ConsoleCells({ f }: { f: ConsoleFig | null }) {
  if (!f) return <span className="faint num" style={{ fontSize: 12 }}>no data</span>;
  return (
    <span className="num" style={{ fontSize: 12, display: "inline-flex", gap: 8 }} title={`${f.clicks} clicks, ${f.impr} impressions, ${(f.ctr * 100).toFixed(1)}% CTR, average position ${f.pos ?? "-"}`}>
      <b>{f.clicks.toLocaleString("en-GB")}</b>
      <span className="muted">{f.impr.toLocaleString("en-GB")}</span>
      <span className="muted">{f.pos ?? "-"}</span>
    </span>
  );
}

// ---------------------------------------------------------------- rows

function KeywordRow({ k, g, ctx }: { k: KeywordView; g: GroupView; ctx: Ctx }) {
  const { run, canWrite, cluster, setDrag, drag } = ctx;
  const tracked = k.src === "tracked";
  const fig = ctx.source === "gsc" ? k.console.gsc : ctx.source === "bing" ? k.console.bing : null;
  const pendingId = !!k.id && k.id.startsWith("t");
  return (
    <div
      className={`item${tracked ? "" : " fp"}${pendingId ? " pending" : ""}${drag?.id === k.id ? " dragging" : ""}`}
      draggable={canWrite && tracked && ctx.groupsReady}
      onDragStart={(e) => { if (k.id) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k.keyword); setDrag({ kind: "keyword", id: k.id }); } }}
      onDragEnd={() => setDrag(null)}
    >
      {canWrite && tracked && ctx.groupsReady ? <span className="grip"><Icon name="grip" size={12} /></span> : null}
      <div className="t">
        <div style={{ fontWeight: tracked ? 600 : 500 }}>{k.keyword}</div>
        <div className="meta">
          {tracked ? <span title="Checked on Google every day">Tracked daily</span> : <span title="From your ranking snapshot; not checked daily">Ranking snapshot</span>}
          {k.volume ? <span>{k.volume.toLocaleString("en-GB")}/mo</span> : null}
          {k.addedOn && k.addedOn > ctx.ws.today ? <span className="pill accent" style={{ padding: "0 7px" }}>First check tomorrow</span> : null}
          {k.pageChange ? <span className="pill warn" style={{ padding: "0 7px" }} title={`Google now ranks ${k.pageChange.to} instead of ${k.pageChange.from}`}>Ranking page changed</span> : null}
        </div>
      </div>
      <div className="side">
        {fig !== null || ctx.source !== "off" ? <ConsoleCells f={fig} /> : (
          <>
            {k.hist.length > 2 ? <Spark values={k.hist.map(([, p]) => p)} invert width={56} height={20} /> : null}
            <Change n={k.change} />
            <Pos pos={k.pos} />
          </>
        )}
        {canWrite ? (
          <span className="acts">
            {tracked ? (
              <Menu label={`Options for ${k.keyword}`}>
                {(close) => (
                  <>
                    <a href={`${ctx.base}/${ctx.ws.client.slug}/google/${k.id}`} style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "inherit", textDecoration: "none" }}>Every Google reading</a>
                    <MoveTargets ctx={ctx} current={g.id} onPick={(cid, gid, name) => { close(); run({ op: "keyword.move", id: k.id!, clusterId: cid, groupId: gid }, `Moved to ${name}.`); }} />
                    <hr />
                    <button onClick={() => { close(); run({ op: "keyword.remove", id: k.id! }, `Stopped tracking “${k.keyword}”.`); }} style={{ color: "var(--bad-fg)" }}>Stop tracking</button>
                  </>
                )}
              </Menu>
            ) : (
              <button className="btn sm" title="Check it on Google every day" onClick={() => run({ op: "keyword.add", tempId: tempId(), clusterId: cluster.id, groupId: g.id, keyword: k.keyword }, `Tracking “${k.keyword}” from tomorrow.`)}>Track</button>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PromptRow({ p, g, ctx }: { p: PromptView; g: GroupView; ctx: Ctx }) {
  const { run, canWrite, setDrag, drag } = ctx;
  const [editing, setEditing] = useState(false);
  const pendingId = p.id.startsWith("t");
  if (editing) {
    return (
      <div className="item" style={{ display: "block" }}>
        <InlineText
          initial={p.text}
          label="Prompt"
          max={PROMPT_MAX}
          multiline
          validate={(v) => refusePromptText(v, ctx.cluster.groups.flatMap((x) => x.prompts).concat(ctx.cluster.own.prompts).filter((x) => x.id !== p.id).map((x) => x.text))}
          hint={p.measured ? "This prompt has readings, so saving starts a new prompt in its place. The old one's history is kept." : undefined}
          onSave={(v) => { setEditing(false); if (v.trim() !== p.text) run({ op: "prompt.edit", id: p.id, text: v, tempId: tempId() }, p.measured ? "Saved as a new prompt. First reading tomorrow." : "Prompt saved."); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <div
      className={`item${pendingId ? " pending" : ""}${drag?.id === p.id ? " dragging" : ""}`}
      draggable={canWrite && ctx.groupsReady}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.text); setDrag({ kind: "prompt", id: p.id }); }}
      onDragEnd={() => setDrag(null)}
    >
      {canWrite && ctx.groupsReady ? <span className="grip"><Icon name="grip" size={12} /></span> : null}
      <div className="t">
        {canWrite ? <button className="txt" onClick={() => setEditing(true)} title="Edit">{p.text}</button> : <span>{p.text}</span>}
        <div className="meta">
          {p.measured ? <Cells engines={ctx.engines} cells={p.cells} /> : <span className="pill accent" style={{ padding: "0 7px" }}>{p.addedOn > ctx.ws.today ? "First reading tomorrow" : "Not read yet"}</span>}
        </div>
      </div>
      <div className="side">
        {p.measured ? <Rate r={p.rate} /> : null}
        {canWrite ? (
          <span className="acts">
            <Menu label="Prompt options">
              {(close) => (
                <>
                  <a href={`${ctx.base}/${ctx.ws.client.slug}/ai/${p.id}`} style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "inherit", textDecoration: "none" }}>Open every answer</a>
                  <button onClick={() => { close(); setEditing(true); }}>Edit</button>
                  <MoveTargets ctx={ctx} current={g.id} onPick={(cid, gid, name) => { close(); run({ op: "prompt.move", id: p.id, clusterId: cid, groupId: gid }, `Moved to ${name}.`); }} />
                  <hr />
                  <button onClick={() => { close(); run({ op: "prompt.remove", id: p.id }, "Prompt stopped. It is not read from tomorrow."); }} style={{ color: "var(--bad-fg)" }}>Stop tracking</button>
                </>
              )}
            </Menu>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MoveTargets({ ctx, current, onPick }: { ctx: Ctx; current: string | null; onPick: (clusterId: string, groupId: string | null, name: string) => void }) {
  const { cluster, others, groupsReady } = ctx;
  if (!groupsReady) return null;
  const here = [...cluster.groups.map((g) => ({ id: g.id, name: g.name })), ...(cluster.groups.length ? [{ id: null, name: "Not in a group" }] : [])].filter((x) => x.id !== current);
  return (
    <>
      {here.length ? <div className="lbl">Move to group</div> : null}
      {here.map((x) => <button key={x.id ?? "own"} onClick={() => onPick(cluster.id, x.id, x.name)}>{x.name}</button>)}
      {others.length ? <div className="lbl">Move to cluster</div> : null}
      {others.map((c) => <button key={c.id} onClick={() => onPick(c.id, null, c.name)}>{c.name}</button>)}
    </>
  );
}

// ---------------------------------------------------------------- group parts

function Terms({ g, ctx }: { g: GroupView; ctx: Ctx }) {
  const [adding, setAdding] = useState(false);
  const save = (terms: string[], label: string) => ctx.run({ op: "group.edit", id: g.id!, terms }, label);
  return (
    <span className="terms" style={{ flexBasis: "100%", order: 5 }} aria-label="Words this group matches">
      <span className="faint" style={{ fontSize: 11.5, fontWeight: 600, marginRight: 2 }}>Matches</span>
      {g.terms.map((t) => (
        <span key={t} className="term">
          {t}
          {ctx.canWrite ? <button aria-label={`Stop matching ${t}`} onClick={() => save(g.terms.filter((x) => x !== t), `No longer matching “${t}”.`)}>×</button> : null}
        </span>
      ))}
      {!g.terms.length ? <span className="faint" style={{ fontSize: 11.5 }}>no words yet</span> : null}
      {ctx.canWrite ? (
        adding ? (
          <InlineText initial="" label="Word to match" max={TERM_MAX} placeholder="e.g. staffing" small onSave={(v) => { setAdding(false); const t = v.toLowerCase().trim(); if (t.length >= 2 && !g.terms.includes(t)) save([...g.terms, t], `Matching “${t}”.`); }} onCancel={() => setAdding(false)} />
        ) : (
          <button className="btn ghost sm" onClick={() => setAdding(true)} style={{ padding: "1px 6px" }}><Icon name="plus" size={12} />word</button>
        )
      ) : null}
    </span>
  );
}

function Discovered({ g, ctx }: { g: GroupView; ctx: Ctx }) {
  const list = ctx.source === "gsc" ? g.discovered.gsc : ctx.source === "bing" ? g.discovered.bing : [];
  if (!list.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <h4>Searches you are found for, not yet tracked</h4>
      {list.map((q) => (
        <div key={q.q} className="item fp">
          <div className="t">{q.q}</div>
          <div className="side">
            <ConsoleCells f={q} />
            {ctx.canWrite ? <span className="acts"><button className="btn sm" onClick={() => ctx.run({ op: "keyword.add", tempId: tempId(), clusterId: ctx.cluster.id, groupId: g.id, keyword: q.q }, `Tracking “${q.q}” from tomorrow.`)}>Track</button></span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Starting prompts for an empty group - offered, never added without a click.
 * Built from the group's own words in the cluster's context: a tracked keyword
 * first, else the most-searched keyword in the group that shares most words
 * with the cluster keyword ("life sciences staffing agencies" in a life
 * sciences cluster), so a suggestion never drops the market the cluster is
 * about ("Who is the best staffing agency?" asks about every staffing agency).
 */
export function suggestionKeyword(g: GroupView, clusterKeyword: string | null): string | null {
  const tracked = g.keywords.find((k) => k.src === "tracked");
  if (tracked) return tracked.keyword.toLowerCase();
  const stem = (w: string) => w.toLowerCase().replace(/(ies|s)$/, "");
  const head = new Set((clusterKeyword ?? "").split(/\s+/).filter(Boolean).map(stem));
  const scored = g.keywords
    // Job-seeker searches bring applicants, not buyers: never a prompt to track.
    .filter((k) => k.src === "footprint" && k.keyword.split(/\s+/).length >= 2 && !/\b(jobs?|careers?|salar(y|ies)|near me|vacanc(y|ies))\b/i.test(k.keyword))
    .map((k) => ({ k: k.keyword.toLowerCase(), shared: k.keyword.split(/\s+/).filter((w) => head.has(stem(w))).length, v: k.volume ?? 0 }))
    .filter((x) => x.shared > 0)
    .sort((x, y) => y.shared - x.shared || y.v - x.v);
  return scored[0]?.k ?? (g.id ? null : clusterKeyword?.toLowerCase() ?? null);
}

function Suggest({ g, ctx }: { g: GroupView; ctx: Ctx }) {
  const kw = suggestionKeyword(g, ctx.cluster.headKeyword);
  if (!kw || !ctx.canWrite) return <div className="empty-sm">No prompts in {g.id ? "this group" : "the cluster"} yet. Add one the way a buyer would ask it.</div>;
  // Phrasings that read right around any noun phrase, singular, plural or uncountable ("executive recruitment").
  const ideas = [`Who would you recommend for ${kw}?`, `What are the best options for ${kw}?`];
  return (
    <div className="empty-sm">
      No prompts yet. Try:
      {ideas.map((q) => (
        <button key={q} className="btn ghost sm" style={{ display: "flex", textAlign: "left", whiteSpace: "normal", marginTop: 4 }} onClick={() => ctx.run({ op: "prompt.add", tempId: tempId(), clusterId: ctx.cluster.id, groupId: g.id, text: q }, "Prompt added. First reading tomorrow.")}>
          <Icon name="plus" size={12} />{q}
        </button>
      ))}
    </div>
  );
}

function Adder({ kind, g, ctx }: { kind: "keyword" | "prompt"; g: GroupView; ctx: Ctx }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const a = ctx.ws.allowances[kind === "keyword" ? "keywords" : "prompts"];
  const full = a.used >= a.limit;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = v.trim();
    if (!text) return;
    const local = kind === "keyword"
      ? refuseKeywordText(text, ctx.ws.clusters.flatMap((c) => [...c.groups.flatMap((x) => x.keywords), ...c.own.keywords]).filter((k) => k.src === "tracked").map((k) => k.keyword))
      : refusePromptText(text, [...ctx.cluster.groups.flatMap((x) => x.prompts), ...ctx.cluster.own.prompts].map((p) => p.text));
    if (local) { setErr(local); return; }
    const refused = kind === "keyword"
      ? ctx.run({ op: "keyword.add", tempId: tempId(), clusterId: ctx.cluster.id, groupId: g.id, keyword: text }, `Tracking “${text}” from tomorrow.`)
      : ctx.run({ op: "prompt.add", tempId: tempId(), clusterId: ctx.cluster.id, groupId: g.id, text }, "Prompt added. First reading tomorrow.");
    if (!refused) { setV(""); setErr(null); } else setErr(refused);
  };
  if (full) {
    return (
      <div className="empty-sm" style={{ marginTop: 6 }}>
        All {a.limit} {kind}s on your plan are in use. <PackButton slug={ctx.ws.client.slug} owner={ctx.ws.role === "owner"} demo={ctx.demo} label="Add more" small />
      </div>
    );
  }
  return (
    <form onSubmit={submit}>
      <div className="adder">
        <input className={`field${err ? " err" : ""}`} value={v} onChange={(e) => { setV(e.target.value); setErr(null); }} placeholder={kind === "keyword" ? "Add a keyword to track" : "Add a prompt, as a buyer would ask it"} aria-label={kind === "keyword" ? `Add a keyword${g.id ? ` to ${g.name}` : ""}` : `Add a prompt${g.id ? ` to ${g.name}` : ""}`} maxLength={kind === "keyword" ? KEYWORD_MAX : PROMPT_MAX} />
        <button className="btn" type="submit" disabled={!v.trim()} aria-label="Add"><Icon name="plus" size={14} /></button>
      </div>
      {err ? <div className="field-err" role="alert">{err}</div> : null}
    </form>
  );
}

function NewGroup({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const [name, setName] = useState("");
  const [terms, setTerms] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = terms.split(",").map((x) => x.trim()).filter(Boolean);
    const refused = ctx.run({ op: "group.add", tempId: tempId("g"), clusterId: ctx.cluster.id, name, terms: t.length ? t : [name.toLowerCase()] }, `Added ${name.trim()}.`);
    if (!refused) onDone();
  };
  return (
    <form className="grp" onSubmit={submit} style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) auto", gap: 8, alignItems: "end" }} className="newgrp">
        <label>
          <span className="dash-micro" style={{ marginBottom: 4 }}>Group name</span>
          <input ref={ref} className="field" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Staffing agencies" maxLength={NAME_MAX} onKeyDown={(e) => e.key === "Escape" && onDone()} />
        </label>
        <label>
          <span className="dash-micro" style={{ marginBottom: 4 }}>Words to match, comma separated</span>
          <input className="field" style={{ width: "100%" }} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={TERM_MAX * 5} placeholder="staffing, staffing agency" onKeyDown={(e) => e.key === "Escape" && onDone()} />
        </label>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>Add group</button>
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- primitives

export function InlineText({ initial, label, onSave, onCancel, placeholder, multiline, small, validate, hint, max }: {
  initial: string;
  /** The field's bound, from the constant its server enforces (ops.ts, prompt-text.ts). */
  max: number;
  label: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  placeholder?: string;
  multiline?: boolean;
  small?: boolean;
  validate?: (v: string) => string | null;
  hint?: string;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => {
    const e = validate ? validate(v) : null;
    if (e && v.trim() !== initial.trim()) { setErr(e); return; }
    onSave(v);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
  };
  const common = { ref, value: v, "aria-label": label, placeholder, className: `field${err ? " err" : ""}`, onKeyDown: keys, onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => { setV(e.target.value); setErr(null); } };
  return (
    <span style={{ display: "block", width: small ? 160 : "100%" }}>
      {multiline ? <textarea {...common} maxLength={max} rows={2} style={{ width: "100%", resize: "vertical" }} /> : <input {...common} maxLength={max} style={{ width: "100%", ...(small ? { padding: "2px 8px", fontSize: 12 } : {}) }} onBlur={() => (v.trim() === initial.trim() ? onCancel() : commit())} />}
      {err ? <span className="field-err" role="alert" style={{ display: "block" }}>{err}</span> : null}
      {hint && !small ? <span className="faint" style={{ display: "block", fontSize: 12, marginTop: 4 }}>{hint}</span> : null}
      {multiline ? (
        <span style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button className="btn sm primary" onClick={commit} type="button">Save</button>
          <button className="btn sm ghost" onClick={onCancel} type="button">Cancel</button>
          <span className="faint" style={{ fontSize: 11.5, alignSelf: "center" }}>Enter saves · Esc cancels</span>
        </span>
      ) : null}
    </span>
  );
}

export function Menu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="menu" ref={ref}>
      <button className="btn ghost sm" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="more" /></button>
      {open ? <div className="menu-pop" role="menu">{children(() => setOpen(false))}</div> : null}
    </span>
  );
}
