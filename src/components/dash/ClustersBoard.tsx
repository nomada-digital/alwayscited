"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PlanShape } from "@/lib/dash/allowance";
import { buildWorkspace } from "@/lib/dash/model";
import { KEYWORD_MAX, NAME_MAX, addedClusterTier } from "@/lib/dash/ops";
import type { Raw } from "@/lib/dash/types";
import TierName from "@/components/TierName";
import { otherForm } from "@/lib/tracking/plural";

import { InlineText, Menu } from "./ClusterEditor";
import { Change, LimitsLine, Pos, Rate, Spark, TargetPage } from "./Figures";
import Icon from "./Icon";
import PackButton from "./PackButton";
import { Toasts, tempId, useOps } from "./useOps";

/**
 * Every cluster, with add, rename and remove in place (17 Oct 2026). On a paid plan, a cluster we do not work on is
 * labelled tracking only, with its way onto the plan - a swap or an add - one click away (7 Nov 2026).
 */
export default function ClustersBoard({ slug, base, initial, plan, demo = false }: { slug: string; base: string; initial: Raw; plan: PlanShape; demo?: boolean }) {
  const { shown, run, toasts, dismiss, undo } = useOps(slug, initial, plan, demo);
  const ws = useMemo(() => buildWorkspace(shown, { plan }), [shown, plan]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const a = ws.allowances;
  const full = a.clusters.used >= a.clusters.limit;
  const paid = ws.client.tier !== "tracked";
  const planName = <TierName tier={ws.client.tier} />;
  const owner = ws.role === "owner" && !demo;
  // What a cluster added now becomes: a paid slot not yet used, or tracking only.
  const nextIsPlan = paid && addedClusterTier(shown) !== "tracked";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <LimitsLine a={a} />
        {ws.canWrite ? (
          full ? (
            <span style={{ marginLeft: "auto" }}><PackButton slug={slug} owner={ws.role === "owner"} demo={demo} label="Add 5 more clusters" /></span>
          ) : (
            <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}><Icon name="plus" size={14} />New cluster</button>
          )
        ) : null}
      </div>
      {adding ? <NewCluster onDone={() => setAdding(false)} run={run} keywordsFull={a.keywords.used >= a.keywords.limit} note={!paid ? null : nextIsPlan ? <>This one goes on your {planName} plan: it has a cluster not yet set up, so we work on it every month.</> : <>Tracking only, not part of your {planName} plan: free within your allowance. Add it to your plan or swap it in afterwards.</>} /> : null}
      {ws.clusters.length === 0 && !adding ? (
        <div className="dash-card empty">
          <b>No clusters yet</b>
          A cluster is one keyword your buyers search for, and the prompts they ask AI about it. Start with the search you most want to win.
          {ws.canWrite ? <div><button className="btn primary" style={{ marginTop: 14 }} onClick={() => setAdding(true)}><Icon name="plus" size={14} />Add your first cluster</button></div> : null}
        </div>
      ) : null}
      <div className="dash-grid k2">
        {ws.clusters.map((c) => {
          const pending = c.id.startsWith("t");
          return (
            <div key={c.id} className={`dash-card cl-card${pending ? " item pending" : ""}`} style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renaming === c.id ? (
                    <InlineText initial={c.name} label="Cluster name" max={NAME_MAX} onSave={(v) => { setRenaming(null); if (v.trim() && v.trim() !== c.name) run({ op: "cluster.rename", id: c.id, name: v }, "Cluster renamed."); }} onCancel={() => setRenaming(null)} />
                  ) : (
                    <Link href={pending ? "#" : `${base}/${slug}/clusters/${c.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>{c.name}<Icon name="arrow" size={14} /></h2>
                    </Link>
                  )}
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {c.headKeyword ? <>Keyword <b style={{ color: "var(--ink)" }}>{c.headKeyword}</b>{c.headVolume ? ` · ${c.headVolume.toLocaleString("en-GB")}/mo` : ""}</> : "No keyword yet"} · <TargetPage url={c.target} prefix="Target" />
                  </div>
                  {paid && !c.managed && !pending ? <div style={{ marginTop: 6 }}><span className="pill" style={{ whiteSpace: "normal" }} title="Measured every day, free within your allowance. We do not place for it.">Tracking only, not part of your {planName} plan</span></div> : null}
                </div>
                {c.suggested ? <span className="pill" title="We picked this keyword and its five prompts from your site when you signed up, so tracking could start straight away. Change any of them whenever you like.">Suggested - yours to edit</span> : null}
                {c.managed ? <span className="pill accent" title="We work on this cluster each month. Swap it from the plan page; the swap takes effect on the 1st of next month.">Managed by us</span> : null}
                {ws.canWrite && !pending && !c.managed ? (
                  <Menu label={`Options for ${c.name}`}>
                    {(close) => (
                      <>
                        {paid && owner ? (
                          <>
                            <Link href={`${base}/${slug}/managed?${new URLSearchParams({ add: c.id })}#plan-add`} style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "inherit", textDecoration: "none" }} onClick={close}>Add to my plan…</Link>
                            <Link href={`${base}/${slug}/managed?${new URLSearchParams({ swap: c.id })}#swap`} style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "inherit", textDecoration: "none" }} onClick={close}>Use in a swap…</Link>
                            <hr />
                          </>
                        ) : null}
                        <button onClick={() => { close(); setRenaming(c.id); }}>Rename</button>
                        <hr />
                        <button style={{ color: "var(--bad-fg)" }} onClick={() => { close(); run({ op: "cluster.remove", id: c.id }, `Stopped ${c.name} from tomorrow, with its keywords and prompts.`); }}>Stop tracking this cluster</button>
                      </>
                    )}
                  </Menu>
                ) : null}
              </div>
              <div className="cl-stats">
                <div><span className="l">Google</span><span className="v" style={{ display: "flex", gap: 6, alignItems: "center" }}><Pos pos={c.headPos} /><Change n={c.headChange} /></span></div>
                <div><span className="l">AI names you</span><span className="v"><Rate r={c.rate} /></span></div>
                <div><span className="l">Groups</span><span className="v">{c.groups.length}</span></div>
                <div><span className="l">Tracking</span><span className="v" style={{ fontSize: 13, fontWeight: 600 }}>{c.trackedKeywords} kw · {c.prompts} prompts</span></div>
                <div style={{ marginLeft: "auto", justifyContent: "flex-end" }}><Spark values={c.rateTrend} /></div>
              </div>
            </div>
          );
        })}
      </div>
      <Toasts toasts={toasts} dismiss={dismiss} undo={undo} />
    </>
  );
}

function NewCluster({ onDone, run, keywordsFull, note }: { onDone: () => void; run: ReturnType<typeof useOps>["run"]; keywordsFull: boolean; note: React.ReactNode }) {
  const [kw, setKw] = useState("");
  const [name, setName] = useState("");
  // 18 Oct 2026 (brief 2c): the keyword's plural (or singular), ticked by default, free, same cluster and target page.
  const other = otherForm(kw);
  const [withPair, setWithPair] = useState(true);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const keyword = keywordsFull ? null : kw.trim() || null;
    const pair = keyword && withPair && other ? other.keyword : null;
    const refused = run({ op: "cluster.add", tempId: tempId("c"), name: name.trim() || kw.trim(), keyword, pair }, `Added ${name.trim() || kw.trim()}${pair ? ` and “${pair}”` : ""}. First check tomorrow.`);
    if (!refused) onDone();
  };
  return (
    <form className="dash-card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <h2>New cluster</h2>
      <p className="intro">Start from the search you want to win. Split it into groups and add prompts on the next screen.</p>
      {note ? <p style={{ margin: "6px 0 0", fontSize: 13 }}>{note}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 8, alignItems: "end", marginTop: 12 }}>
        <label>
          <span className="dash-micro" style={{ marginBottom: 4 }}>Keyword</span>
          <input className="field" autoFocus style={{ width: "100%" }} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="life sciences recruitment agency" maxLength={KEYWORD_MAX} disabled={keywordsFull} />
        </label>
        <label>
          <span className="dash-micro" style={{ marginBottom: 4 }}>Name (optional)</span>
          <input className="field" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Same as the keyword" maxLength={NAME_MAX} />
        </label>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!kw.trim() && !name.trim()}>Add cluster</button>
        </span>
      </div>
      {!keywordsFull && kw.trim() && other ? (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13.5 }}>
          <input type="checkbox" checked={withPair} onChange={(e) => setWithPair(e.target.checked)} maxLength={KEYWORD_MAX} />
          <span>Also target “{other.keyword}”, no extra charge. Same cluster, same target page; tracked on Google beside it.</span>
        </label>
      ) : null}
      {keywordsFull ? <div className="field-err">Every keyword on your plan is in use, so this cluster starts with prompts only.</div> : null}
    </form>
  );
}
