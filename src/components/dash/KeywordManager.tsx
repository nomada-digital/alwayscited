"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PlanShape } from "@/lib/dash/allowance";
import { buildWorkspace, clusterKeywords, pathOf } from "@/lib/dash/model";
import { keywordKey } from "@/lib/dash/ops";
import { RESEARCH_SEED_MAX } from "@/lib/scan/dataforseo-request";
import type { Raw } from "@/lib/dash/types";
import type { ResearchedKeyword } from "@/lib/scan/dataforseo-request";

import { Menu } from "./ClusterEditor";
import { Change, Pos, Spark, longDay } from "./Figures";
import Icon from "./Icon";
import PackButton from "./PackButton";
import { Toasts, tempId, useOps } from "./useOps";

type Metrics = Record<string, Pick<ResearchedKeyword, "kd" | "volume" | "cpc" | "intent">>;

/** Keyword difficulty as a word as well as a number, so it reads without a legend. */
function Kd({ kd }: { kd: number | null | undefined }) {
  if (kd == null) return <span className="muted">-</span>;
  const band = kd < 30 ? ["Easy", "good"] : kd < 60 ? ["Medium", "warn"] : ["Hard", "bad"];
  return <span className={`pill ${band[1]}`} title={`Keyword difficulty ${kd} of 100 (DataForSEO estimate)`}>{kd} · {band[0]}</span>;
}

/**
 * Search positions' keyword workspace (Danny, 17 Oct 2026, "like Ahrefs Rank
 * Tracker / Keywords Explorer"): the keywords tracked daily, with volume and
 * difficulty, moved or stopped in place; and keyword research - a seed's
 * matching or related searches with volume, difficulty, CPC and intent - with
 * one click to track any of them into a chosen cluster and group. Research
 * goes through /api/dash/[client]/keywords, capped per client per day.
 */
export default function KeywordManager({ slug, base, initial, plan, demo, metrics: known }: { slug: string; base: string; initial: Raw; plan: PlanShape; demo: boolean; metrics: Metrics }) {
  const { shown, run, toasts, dismiss, undo } = useOps(slug, initial, plan, demo);
  const ws = useMemo(() => buildWorkspace(shown, { plan }), [shown, plan]);
  const [metrics, setMetrics] = useState<Metrics>(known);
  const tracked = ws.clusters.flatMap((c) => clusterKeywords(c).map((k) => ({ ...k, cluster: c }))).filter((k) => k.src === "tracked").sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));
  const trackedKeys = new Set(tracked.map((k) => keywordKey(k.keyword)));
  const a = ws.allowances.keywords;
  const full = a.used >= a.limit;
  const missingKd = tracked.filter((k) => metrics[keywordKey(k.keyword)]?.kd == null).length;
  const [filling, setFilling] = useState(false);
  const [fillMsg, setFillMsg] = useState<string | null>(null);
  const targets = ws.clusters.flatMap((c) => [...c.groups.map((g) => ({ c, g: g.id, label: `${c.name} · ${g.name}` })), { c, g: null as string | null, label: c.groups.length ? `${c.name} · no group` : c.name }]);
  const [target, setTarget] = useState(targets[0] ? `${targets[0].c.id}|${targets[0].g ?? ""}` : "");
  const [seed, setSeed] = useState("");
  const [kind, setKind] = useState<"suggestions" | "related">("suggestions");
  const [rows, setRows] = useState<ResearchedKeyword[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async (k: "suggestions" | "related" = kind) => {
    if (seed.trim().length < 2) return setErr("Type a keyword of 2 characters or more.");
    if (demo) return setErr("Keyword research is not available on a demo.");
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/dash/${slug}/keywords`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seed, kind: k }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; rows?: ResearchedKeyword[]; message?: string } | null;
    setBusy(false);
    if (!j?.ok) return setErr(j?.message ?? "That search did not go through. Try again.");
    setRows(j.rows ?? []);
    setMetrics((m) => ({ ...m, ...Object.fromEntries((j.rows ?? []).map((x) => [keywordKey(x.keyword), x])) }));
  };
  const fill = async () => {
    if (demo) return setFillMsg("Not available on a demo.");
    setFilling(true);
    const r = await fetch(`/api/dash/${slug}/keywords`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ difficulty: true }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; filled?: number; message?: string } | null;
    setFilling(false);
    setFillMsg(j?.ok ? "Difficulty added. Reload to see it." : (j?.message ?? "That did not go through."));
  };
  const track = (x: ResearchedKeyword) => {
    const [cid, gid] = target.split("|");
    if (!cid) return setErr("Add a cluster first, then track keywords into it.");
    run({ op: "keyword.add", tempId: tempId(), clusterId: cid, groupId: gid || null, keyword: x.keyword, volume: x.volume, intent: x.intent }, `Tracking “${x.keyword}” from tomorrow.`);
  };

  return (
    <>
      <div className="dash-card">
        <div className="dash-card-head">
          <div><h2>Tracked daily</h2><p className="intro">{a.used} of {a.limit} keywords. Change is against 7 days ago; a page switch is marked so a jump is not read as a gain or a loss. Open one for every reading and Google&rsquo;s top 20.</p></div>
          {missingKd && ws.canWrite ? <span style={{ display: "flex", gap: 8, alignItems: "center" }}><button className="btn sm" onClick={fill} disabled={filling}>{filling ? "Looking up…" : `Add difficulty for ${missingKd}`}</button>{fillMsg ? <span className="muted" style={{ fontSize: 12.5 }}>{fillMsg}</span> : null}</span> : null}
        </div>
        {tracked.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Keyword</th><th className="r">Volume</th><th>Difficulty</th><th className="r">Position</th><th className="r">7 days</th><th>Trend</th><th>Ranking page</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {tracked.map((k) => {
                  const m = metrics[keywordKey(k.keyword)];
                  const pending = !!k.id && k.id.startsWith("t");
                  return (
                    <tr key={k.id ?? k.keyword} className={pending ? "item pending" : undefined}>
                      <td>{k.id && !pending ? <Link href={`${base}/${slug}/google/${k.id}`} style={{ fontWeight: 600 }}>{k.keyword}</Link> : k.keyword}<div className="sub"><Link href={`${base}/${slug}/clusters/${k.cluster.id}`}>{k.cluster.name}</Link>{k.group ? ` · ${k.group}` : ""}</div></td>
                      <td className="r num">{(k.volume ?? m?.volume)?.toLocaleString("en-GB") ?? "-"}</td>
                      <td><Kd kd={m?.kd} /></td>
                      <td className="r">{k.addedOn && k.addedOn > ws.today ? <span className="pill accent">Tomorrow</span> : <Pos pos={k.pos} />}</td>
                      <td className="r"><Change n={k.change} /></td>
                      <td><Spark values={k.hist.map(([, p]) => p)} invert width={80} height={22} /></td>
                      <td className="muted" style={{ fontSize: 12.5, maxWidth: 240, overflowWrap: "anywhere" }}>{pathOf(k.url) ?? "-"}{k.pageChange ? <div className="sub"><span className="pill warn">Page changed {longDay(k.pageChange.on)}</span></div> : null}</td>
                      <td className="r">
                        {ws.canWrite && k.id && !pending ? (
                          <Menu label={`Options for ${k.keyword}`}>
                            {(close) => (
                              <>
                                <Link href={`${base}/${slug}/google/${k.id}`} style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "inherit", textDecoration: "none" }}>Every reading</Link>
                                <div className="lbl">Move to</div>
                                {targets.filter((t) => !(t.c.id === k.cluster.id && (t.g ?? "") === (ws.clusters.find((c) => c.id === k.cluster.id)?.groups.find((g) => g.name === k.group)?.id ?? ""))).map((t) => (
                                  <button key={`${t.c.id}|${t.g ?? ""}`} onClick={() => { close(); run({ op: "keyword.move", id: k.id!, clusterId: t.c.id, groupId: t.g }, `Moved to ${t.label}.`); }}>{t.label}</button>
                                ))}
                                <hr />
                                <button style={{ color: "var(--bad-fg)" }} onClick={() => { close(); run({ op: "keyword.remove", id: k.id! }, `Stopped tracking “${k.keyword}”.`); }}>Stop tracking</button>
                              </>
                            )}
                          </Menu>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty"><b>No keywords tracked yet</b>Find some below and track them with one click.</div>}
      </div>

      <div className="dash-card" id="find">
        <div className="dash-card-head">
          <div><h2>Find keywords</h2><p className="intro">Start from a word your buyers use. Volume is monthly searches in your market; difficulty is how hard page 1 is to reach, 0 to 100. Both are DataForSEO estimates.</p></div>
        </div>
        {ws.canWrite ? (
          <>
            <form onSubmit={(e) => { e.preventDefault(); void ask(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input className={`field${err ? " err" : ""}`} style={{ flex: "1 1 240px" }} value={seed} maxLength={RESEARCH_SEED_MAX} onChange={(e) => { setSeed(e.target.value); setErr(null); }} placeholder="e.g. life sciences recruitment" aria-label="Seed keyword" />
              <div className="seg" role="group" aria-label="Kind of search">
                <button type="button" aria-pressed={kind === "suggestions"} onClick={() => { setKind("suggestions"); if (rows) void ask("suggestions"); }}>Matching terms</button>
                <button type="button" aria-pressed={kind === "related"} onClick={() => { setKind("related"); if (rows) void ask("related"); }}>Related</button>
              </div>
              <button type="submit" className="btn primary" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
            </form>
            {err ? <div className="field-err" role="alert">{err}</div> : null}
            {rows ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>{rows.length} keywords · track into</span>
                  <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Cluster and group to track into" style={{ padding: "5px 8px", fontSize: 13 }}>
                    {targets.map((t) => <option key={`${t.c.id}|${t.g ?? ""}`} value={`${t.c.id}|${t.g ?? ""}`}>{t.label}</option>)}
                  </select>
                  {full ? <PackButton slug={slug} owner={ws.role === "owner"} demo={demo} label="Keywords full - add more" small /> : null}
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th>Keyword</th><th className="r">Volume</th><th>Difficulty</th><th className="r">CPC</th><th>Intent</th><th aria-label="Track" /></tr></thead>
                    <tbody>
                      {rows.map((x) => (
                        <tr key={x.keyword}>
                          <td>{x.keyword}</td>
                          <td className="r num">{x.volume?.toLocaleString("en-GB") ?? "-"}</td>
                          <td><Kd kd={x.kd} /></td>
                          <td className="r num">{x.cpc != null ? x.cpc.toFixed(2) : "-"}</td>
                          <td className="muted" style={{ fontSize: 12.5 }}>{x.intent ?? "-"}</td>
                          <td className="r">{trackedKeys.has(keywordKey(x.keyword)) ? <span className="pill good">Tracked</span> : <button className="btn sm" disabled={full} onClick={() => track(x)}><Icon name="plus" size={12} />Track</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length ? <p className="muted">No keywords found for that. Try a broader word.</p> : null}
              </div>
            ) : null}
          </>
        ) : <p className="muted">An owner or editor can search for and track keywords.</p>}
      </div>
      <Toasts toasts={toasts} dismiss={dismiss} undo={undo} />
    </>
  );
}
