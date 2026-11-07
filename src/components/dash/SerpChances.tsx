"use client";

import Link from "next/link";
import { useMemo } from "react";

import type { PlanShape } from "@/lib/dash/allowance";
import { buildWorkspace } from "@/lib/dash/model";
import { NAME_MAX, addedClusterTier } from "@/lib/dash/ops";
import { type SerpChance, serpChances } from "@/lib/dash/plan-change";
import type { Raw } from "@/lib/dash/types";
import TierName from "@/components/TierName";

import { Pos, longDay } from "./Figures";
import { Toasts, tempId, useOps } from "./useOps";

/**
 * "Also on page 1" and "Close to page 1" (Danny, 7 Nov 2026): the searches the site already ranks for in the top 10,
 * and at 11 to 20, that it does not track yet - from the ranking snapshot, so free to draw. Each can be tracked as a
 * cluster at once, and on a paid plan added to the plan or swapped in on the plan page, which states the price and
 * the date first.
 */
export default function SerpChances({ slug, base, initial, plan, demo = false }: { slug: string; base: string; initial: Raw; plan: PlanShape; demo?: boolean }) {
  const { shown, run, toasts, dismiss, undo } = useOps(slug, initial, plan, demo);
  const ws = useMemo(() => buildWorkspace(shown, { plan }), [shown, plan]);
  const { page1, close } = useMemo(() => serpChances(shown), [shown]);
  const paid = ws.client.tier !== "tracked";
  const owner = ws.role === "owner" && !demo;
  const full = ws.allowances.clusters.used >= ws.allowances.clusters.limit;
  const trackTier = addedClusterTier(shown);
  const track = (k: SerpChance) =>
    run(
      { op: "cluster.add", tempId: tempId("c"), name: k.keyword.slice(0, NAME_MAX), keyword: k.keyword, pair: null },
      paid && trackTier === "tracked" ? `Tracking “${k.keyword}” from tomorrow, as a tracking-only cluster.` : `Tracking “${k.keyword}” from tomorrow.`,
    );
  const list = (rows: SerpChance[], empty: string) =>
    rows.length ? (
      <div className="tbl-wrap">
        <table className="tbl stack">
          <thead><tr><th>Keyword</th><th className="r">Position</th><th className="r">Searches a month</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.keyword}>
                <td>{k.keyword}{k.url ? <div className="sub">{k.url}</div> : null}</td>
                <td className="num" data-l="Position"><Pos pos={k.pos} /></td>
                <td className="num" data-l="Searches a month">{k.volume?.toLocaleString("en-GB") ?? "-"}</td>
                <td data-l={ws.canWrite ? "Do" : undefined} style={{ whiteSpace: "nowrap" }}>
                  {ws.canWrite ? (
                    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn sm" disabled={full} title={full ? "Every cluster on your plan is in use" : "Track it as a cluster, checked every morning"} onClick={() => track(k)}>Track</button>
                      {paid && owner ? (
                        <>
                          <Link className="btn sm" href={`${base}/${slug}/managed?${new URLSearchParams({ addKeyword: k.keyword })}#plan-add`}>Add to my plan</Link>
                          <Link className="btn sm ghost" href={`${base}/${slug}/managed?${new URLSearchParams({ swapKeyword: k.keyword })}#swap`}>Use in a swap</Link>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="faint" style={{ margin: 0 }}>{empty}</p>
    );
  const when = ws.footprintOn ? `From the ranking snapshot of ${longDay(ws.footprintOn)}.` : "From your monthly ranking snapshot.";
  return (
    <>
      <div className="dash-card" id="page-1">
          <h2>Also on page 1</h2>
          <p className="intro">{when} Searches you already rank in the top 10 for, not tracked yet. Track one to see it every morning{paid ? <>, or have us work on it as part of your <TierName tier={ws.client.tier} /> plan</> : ""}.</p>
          <div style={{ marginTop: 10 }}>{list(page1, ws.footprintOn ? "Nothing else on page 1 yet: every search you rank in the top 10 for is tracked, or there are none." : "Your first ranking snapshot arrives within the week.")}</div>
      </div>
      <div className="dash-card" id="close-to-page-1">
          <h2>Close to page 1</h2>
          <p className="intro">{when} Searches you rank 11 to 20 for: a little work moves these onto the first page.</p>
          <div style={{ marginTop: 10 }}>{list(close, ws.footprintOn ? "Nothing at 11 to 20 in the latest snapshot." : "Your first ranking snapshot arrives within the week.")}</div>
      </div>
      <Toasts toasts={toasts} dismiss={dismiss} undo={undo} />
    </>
  );
}
