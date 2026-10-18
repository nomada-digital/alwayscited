"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { PlanShape } from "@/lib/dash/allowance";
import { setupClusters, setupGaps, stepOf, worked, type SetupCluster } from "@/lib/dash/setup";
import { targetLabel } from "@/lib/dash/target";
import type { Raw } from "@/lib/dash/types";
import { draftPrompts } from "@/lib/tracking/add-cluster";
import { otherForm } from "@/lib/tracking/plural";

import { Toasts, tempId, useOps } from "./useOps";

/**
 * Setup on the dashboards host (18 Oct 2026 brief 2b / 2c / 2d): one card per
 * cluster, in the order the brief sets - the Google keyword checked, its
 * plural ticked (free), the target page with where it ranks now, then five
 * drafted prompts the customer edits and saves. Every save is an op through
 * /api/dash/[client]/ops, judged in the browser and again on the server, so
 * this page writes nothing the rest of the dashboard could not. Confirm is
 * the setup_confirmed row, refused while setupGaps names anything.
 */

type Checked = {
  ok: boolean;
  message?: string;
  check?: { ok: boolean; keyword?: string; volume?: number; message: string };
  pair?: { keyword: string; form: "plural" | "singular"; volume: number | null; rank: number | null; oneSearch: boolean } | null;
  rank?: number | null;
  rankingUrl?: string | null;
  urlRank?: number | null;
};

export default function SetupWizard({ slug, base, initial, plan, demo, homepage }: { slug: string; base: string; initial: Raw; plan: PlanShape; demo: boolean; homepage: string }) {
  const { shown, run, toasts, dismiss, undo, busy } = useOps(slug, initial, plan, demo);
  const clusters = useMemo(() => setupClusters(shown), [shown]);
  const gaps = setupGaps(clusters);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const canWrite = shown.role !== "viewer" && !demo;

  const confirm = async () => {
    setConfirming(true);
    setConfirmErr(null);
    const r = await fetch(`/api/dash/${slug}/setup/confirm`, { method: "POST" }).catch(() => null);
    const a = (await r?.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    setConfirming(false);
    if (a?.ok) router.push(`${base}/${slug}?setup=confirmed`);
    else setConfirmErr(a?.message ?? "That did not save. Try again.");
  };

  return (
    <>
      {clusters.map((c, i) => (
        <ClusterSetup key={c.id} n={i + 1} c={c} slug={slug} homepage={homepage} canWrite={canWrite} run={run} prompts={shown.prompts.filter((p) => p.cluster_id === c.id && p.stopped_on === null).map((p) => p.text)} />
      ))}
      <div className="dash-card" id="confirm">
        <h2>Confirm</h2>
        {gaps.length ? (
          <>
            <p className="intro">Still to do before the first reading:</p>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
          </>
        ) : (
          <p className="intro">Everything is set. Confirm and the first reading runs at the next morning check.</p>
        )}
        {confirmErr ? <div className="field-err" role="alert">{confirmErr}</div> : null}
        {canWrite ? <button className="btn primary" style={{ marginTop: 12 }} disabled={!!gaps.length || busy || confirming} onClick={confirm}>{confirming ? "Confirming…" : "Confirm and start tracking"}</button> : null}
      </div>
      <Toasts toasts={toasts} dismiss={dismiss} undo={undo} />
    </>
  );
}

type Run = ReturnType<typeof useOps>["run"];

function ClusterSetup({ n, c, slug, homepage, canWrite, run, prompts }: { n: number; c: SetupCluster; slug: string; homepage: string; canWrite: boolean; run: Run; prompts: string[] }) {
  const step = stepOf(c);
  const [kw, setKw] = useState(c.keyword ?? (c.name.toLowerCase().startsWith("needs a keyword") ? "" : c.name));
  const [checked, setChecked] = useState<Checked | null>(null);
  const [checking, setChecking] = useState(false);
  const [withPair, setWithPair] = useState(true);
  const [pairText, setPairText] = useState<string | null>(null);
  const [url, setUrl] = useState(c.target ?? "");
  const [drafts, setDrafts] = useState<string[] | null>(null);

  const check = async (keyword: string, forUrl: string | null = null) => {
    setChecking(true);
    const r = await fetch(`/api/dash/${slug}/setup/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keyword, url: forUrl }) }).catch(() => null);
    const a = ((await r?.json().catch(() => null)) as Checked | null) ?? { ok: false, message: "No connection. Try again." };
    setChecking(false);
    setChecked(a);
    if (a.pair) setPairText(a.pair.keyword);
    if (!url && a.rankingUrl) setUrl(a.rankingUrl);
  };

  const saveKeyword = () => {
    const k = checked?.check?.keyword ?? kw.trim();
    const pair = withPair ? (pairText ?? otherForm(k)?.keyword ?? null) : null;
    if (c.keyword && c.keyword.toLowerCase() === k.toLowerCase()) {
      if (pair && !c.pair && c.keywordId) run({ op: "keyword.pair", tempId: tempId(), id: c.keywordId, keyword: pair }, `Also tracking “${pair}”, free.`);
      return;
    }
    const refused = run({ op: "keyword.add", tempId: tempId(), clusterId: c.id, groupId: null, keyword: k, volume: checked?.check?.volume ?? null, pair }, `Keyword set: “${k}”${pair ? ` and “${pair}”` : ""}.`);
    if (!refused && c.name.toLowerCase().startsWith("needs a keyword")) run({ op: "cluster.rename", id: c.id, name: k }, null);
  };

  const keywordDone = !!c.keyword;
  const ranks = checked?.check?.ok ? checked : null;
  return (
    <div className="dash-card">
      <div className="dash-micro">Cluster {n}{worked(c.tier) ? " · worked on" : " · tracked"}</div>
      <h2 style={{ marginTop: 2 }}>
        {c.keyword ?? c.name}
        {c.target ? <span className="muted" style={{ fontWeight: 400 }}> → {targetLabel(c.target)}</span> : null}
      </h2>

      <section style={{ marginTop: 12 }}>
        <div className="dash-micro">1 · Google keyword</div>
        {keywordDone ? (
          <p style={{ margin: "4px 0" }}>
            <b>{c.keyword}</b>
            {c.pair ? <> and <b>{c.pair}</b> <span className="pill" style={{ padding: "0 7px" }}>free</span></> : null}
          </p>
        ) : null}
        {canWrite && (!keywordDone || !c.pair) ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            {!keywordDone ? <input className="field" style={{ flex: "1 1 260px" }} value={kw} onChange={(e) => { setKw(e.target.value); setChecked(null); }} placeholder="b2b seo agency" aria-label={`Keyword for cluster ${n}`} maxLength={120} /> : null}
            <button className="btn" disabled={checking || !(keywordDone ? (c.keyword ?? "") : kw).trim()} onClick={() => void check(keywordDone ? c.keyword! : kw, url.trim() || null)}>{checking ? "Checking…" : "Check on Google"}</button>
          </div>
        ) : null}
        {checked && !checked.ok ? <div className="field-err">{checked.message}</div> : null}
        {checked?.check ? <div className={checked.check.ok ? "muted" : "field-err"} style={{ marginTop: 6, fontSize: 13.5 }}>{checked.check.message}{ranks && ranks.rank ? ` You rank #${ranks.rank} now${ranks.rankingUrl ? ` with ${targetLabel(ranks.rankingUrl)}` : ""}.` : ranks ? " You are not in Google's top results for it yet." : ""}</div> : null}
        {ranks?.pair && canWrite ? (
          <div style={{ marginTop: 8 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
              <input type="checkbox" checked={withPair} onChange={(e) => setWithPair(e.target.checked)} />
              <span>
                Also target <input className="field" style={{ width: 240, display: "inline-block" }} value={pairText ?? ""} onChange={(e) => setPairText(e.target.value)} aria-label="The other form of the keyword" />
                {ranks.pair.volume ? ` (${ranks.pair.volume.toLocaleString("en-GB")}/mo)` : ""}, no extra charge.
              </span>
            </label>
            {ranks.pair.oneSearch ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Google treats these as one search; one page may rank for both. Tracking both still shows each position on its own.</div> : null}
          </div>
        ) : null}
        {ranks && canWrite && (!keywordDone || (withPair && !c.pair)) ? <button className="btn primary" style={{ marginTop: 10 }} onClick={saveKeyword}>{keywordDone ? "Add the other form" : "Use this keyword"}</button> : null}
      </section>

      {keywordDone && worked(c.tier) || (keywordDone && c.target) ? (
        <section style={{ marginTop: 16 }}>
          <div className="dash-micro">2 · Target page{worked(c.tier) ? "" : " (optional on a tracked cluster)"}</div>
          <p className="intro" style={{ margin: "4px 0" }}>The one page this cluster should rank and be cited with. Every placement and link insertion for it links here.</p>
          {canWrite ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input className="field" style={{ flex: "1 1 320px" }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={homepage} aria-label={`Target page for cluster ${n}`} maxLength={500} />
              <button className="btn" disabled={checking || !url.trim()} onClick={() => void check(c.keyword!, url.trim())}>Where does it rank?</button>
              <button className="btn primary" disabled={!url.trim() || (!!c.target && c.target === url.trim())} onClick={() => run({ op: "cluster.target", id: c.id, url: url.trim() }, `Target page set: ${targetLabel(url.trim())}.`)}>{c.target ? "Change target page" : "Set target page"}</button>
            </div>
          ) : null}
          {ranks && url.trim() ? (
            <div className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
              {ranks.urlRank ? `${targetLabel(url.trim())} ranks #${ranks.urlRank} for “${c.keyword}”.` : `${targetLabel(url.trim())} is not in Google's top results for “${c.keyword}” yet.`}
              {ranks.rankingUrl && ranks.rank && (!ranks.urlRank || ranks.rank < ranks.urlRank) && targetLabel(ranks.rankingUrl) !== targetLabel(url.trim()) ? (
                <> A different page of yours ranks better: <b>{targetLabel(ranks.rankingUrl)}</b> at #{ranks.rank}. <button className="btn sm" onClick={() => setUrl(ranks.rankingUrl!)}>Use it</button></>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {keywordDone && step !== "target" ? (
        <section style={{ marginTop: 16 }}>
          <div className="dash-micro">3 · Prompts</div>
          {prompts.length ? (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{prompts.map((p) => <li key={p}>{p}</li>)}</ul>
          ) : canWrite ? (
            <>
              <p className="intro" style={{ margin: "4px 0" }}>Five questions buyers ask, drafted from your keyword. Edit any of them; nothing is tracked until you save.</p>
              {(drafts ?? draftPrompts(c.keyword!)).map((d, i) => (
                <input key={i} className="field" style={{ width: "100%", marginTop: 6 }} value={d} maxLength={300} aria-label={`Prompt ${i + 1}`} onChange={(e) => { const next = [...(drafts ?? draftPrompts(c.keyword!))]; next[i] = e.target.value; setDrafts(next); }} />
              ))}
              <button className="btn primary" style={{ marginTop: 10 }} onClick={() => { for (const t of drafts ?? draftPrompts(c.keyword!)) run({ op: "prompt.add", tempId: tempId(), clusterId: c.id, groupId: null, text: t }, null); }}>Save these prompts</button>
            </>
          ) : (
            <p className="faint">No prompts yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
