"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import TierName from "@/components/TierName";
import { KEYWORD_MAX } from "@/lib/dash/ops";
import type { TierKey } from "@/lib/dash/types";

/**
 * Swapping a plan cluster and adding one to the plan, on "Your plan's clusters" (Danny, 7 Nov 2026; rules in
 * lib/dash/plan-change.ts, writes through api/dash/[client]/plan). Owners act; everyone else reads what is booked.
 * Every step says what happens and when before it is taken, and the answer comes back on the page.
 *
 * Other pages hand a choice over by link (?swap=<cluster id>, ?swapKeyword=, ?add=<cluster id>, ?addKeyword=), so
 * the price and the date are only ever stated here.
 */

type Named = { id: string; name: string };
export type PlanControlsProps = {
  slug: string;
  owner: boolean;
  readOnly: boolean;
  plan: TierKey;
  managed: Named[];
  trackingOnly: Named[];
  /** "1 December 2026": when a swap booked today takes effect. */
  effective: string;
  /** "£995", or null when the price is agreed on a call. */
  price: string | null;
  swap: { id: string; from: string; to: string; on: string } | null;
  upgrades: { id: string; what: string; price: string | null; on: string }[];
  start: { swap?: string; swapKeyword?: string; add?: string; addKeyword?: string };
};

type Answer = { ok: true; slack?: boolean; onPlan?: boolean } | { ok: false; message: string };

async function post(slug: string, body: Record<string, unknown>): Promise<Answer> {
  try {
    const r = await fetch(`/api/dash/${slug}/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const a = (await r.json().catch(() => null)) as Answer | null;
    if (r.status === 401) return { ok: false, message: "Your session has ended. Sign in again." };
    return a ?? { ok: false, message: `The server answered ${r.status}.` };
  } catch {
    return { ok: false, message: "No connection. Nothing was changed." };
  }
}

export default function PlanControls(p: PlanControlsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, done: (a: Extract<Answer, { ok: true }>) => string) => {
    setBusy(true);
    setMsg(null);
    const a = await post(p.slug, body);
    setBusy(false);
    if (a.ok) {
      setMsg({ tone: "ok", text: done(a) });
      router.refresh();
    } else setMsg({ tone: "err", text: a.message });
  };
  const can = p.owner && !p.readOnly;
  return (
    <>
      {msg ? (
        <div className={msg.tone === "ok" ? "banner" : "field-err"} role={msg.tone === "ok" ? "status" : "alert"} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      ) : null}
      <div className="dash-card" id="swap">
        <h2>Swap a cluster we work on</h2>
        <p className="intro" style={{ maxWidth: 720 }}>
          Bring one of your tracked clusters onto the plan in place of one we work on now. It takes effect on the 1st of next month, so this month&rsquo;s work in progress is finished first. Your plan keeps the same number of clusters, so your bill does not change. You can cancel until then.
        </p>
        {p.swap ? (
          <div className="plan-box" style={{ marginTop: 12 }}>
            <b>Booked for {p.swap.on}:</b> we work on <b>{p.swap.to}</b> in place of <b>{p.swap.from}</b>. {p.swap.from} stays tracked.
            {can ? (
              <div style={{ marginTop: 8 }}>
                <button className="btn sm danger" disabled={busy} onClick={() => act({ action: "swap.cancel", id: p.swap!.id }, () => `Cancelled. We keep working on ${p.swap!.from}.`)}>Cancel the swap</button>
              </div>
            ) : null}
          </div>
        ) : !p.managed.length ? (
          <p className="faint" style={{ marginTop: 10 }}>There is no cluster on your plan to swap yet.</p>
        ) : can ? (
          <SwapForm {...p} busy={busy} act={act} />
        ) : (
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{p.readOnly ? "Not available in a read-only view." : "The account owner can book a swap."}</p>
        )}
      </div>
      <div className="dash-card" id="plan-add">
        <h2>Add a cluster to your plan</h2>
        <p className="intro" style={{ maxWidth: 720 }}>
          {p.price ? <>Each cluster we work on adds <b>{p.price} a month</b> to your <TierName tier={p.plan} /> plan.</> : <>We agree the price of another cluster with you first.</>} Ask here and we confirm it with you, then add it from your next billing date. Nothing is charged until you have agreed it.
        </p>
        {p.upgrades.length ? (
          <div style={{ marginTop: 12 }}>
            {p.upgrades.map((u) => (
              <div key={u.id} className="plan-box">
                <b>{u.what}</b> <span className="pill warn">Waiting for us</span>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Asked {u.on}{u.price ? ` · ${u.price} a month` : " · price to agree"}</div>
                {can ? <button className="btn sm danger" style={{ marginTop: 8 }} disabled={busy} onClick={() => act({ action: "upgrade.cancel", id: u.id }, () => "Request cancelled.")}>Cancel the request</button> : null}
              </div>
            ))}
          </div>
        ) : null}
        {can ? <AddForm {...p} busy={busy} act={act} /> : <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{p.readOnly ? "Not available in a read-only view." : "The account owner can add a cluster to the plan."}</p>}
      </div>
    </>
  );
}

type Act = (body: Record<string, unknown>, done: (a: Extract<Answer, { ok: true }>) => string) => Promise<void>;

function SwapForm(p: PlanControlsProps & { busy: boolean; act: Act }) {
  const startTo = p.start.swap && p.trackingOnly.some((c) => c.id === p.start.swap) ? p.start.swap : p.start.swapKeyword ? "new" : (p.trackingOnly[0]?.id ?? "new");
  const [from, setFrom] = useState(p.managed[0]!.id);
  const [to, setTo] = useState(startTo);
  const [kw, setKw] = useState(p.start.swapKeyword ?? "");
  const fromName = p.managed.find((c) => c.id === from)?.name ?? "";
  const toName = to === "new" ? kw.trim() : (p.trackingOnly.find((c) => c.id === to)?.name ?? "");
  const ready = !!from && (to !== "new" || kw.trim().length >= 2);
  return (
    <form
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void p.act(to === "new" ? { action: "swap", from, keyword: kw.trim() } : { action: "swap", from, to }, () => `Booked. From ${p.effective} we work on ${toName} in place of ${fromName}. We have let your account manager know.`);
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, alignItems: "end" }}>
        <label>
          <span className="dash-micro" style={{ marginBottom: 4 }}>Swap out</span>
          <select className="field" style={{ width: "100%" }} value={from} onChange={(e) => setFrom(e.target.value)}>
            {p.managed.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          <span className="dash-micro" style={{ marginBottom: 4 }}>Bring in</span>
          <select className="field" style={{ width: "100%" }} value={to} onChange={(e) => setTo(e.target.value)}>
            {p.trackingOnly.map((c) => <option key={c.id} value={c.id}>{c.name} (tracked now)</option>)}
            <option value="new">A new keyword…</option>
          </select>
        </label>
        {to === "new" ? (
          <label>
            <span className="dash-micro" style={{ marginBottom: 4 }}>Keyword</span>
            <input className="field" style={{ width: "100%" }} value={kw} maxLength={KEYWORD_MAX} onChange={(e) => setKw(e.target.value)} placeholder="the search to win" />
          </label>
        ) : null}
      </div>
      {ready ? <p style={{ fontSize: 13, margin: "10px 0 0" }}>From <b>{p.effective}</b> we work on <b>{toName}</b> instead of <b>{fromName}</b>. {fromName} stays tracked, free.{to === "new" ? " The new keyword starts being tracked tomorrow." : ""}</p> : null}
      <button type="submit" className="btn primary" style={{ marginTop: 10 }} disabled={!ready || p.busy}>Book the swap for {p.effective}</button>
    </form>
  );
}

function AddForm(p: PlanControlsProps & { busy: boolean; act: Act }) {
  const startPick = p.start.add && p.trackingOnly.some((c) => c.id === p.start.add) ? p.start.add : p.start.addKeyword ? "new" : (p.trackingOnly[0]?.id ?? "new");
  const [pick, setPick] = useState(startPick);
  const [kw, setKw] = useState(p.start.addKeyword ?? "");
  const what = pick === "new" ? kw.trim() : (p.trackingOnly.find((c) => c.id === pick)?.name ?? "");
  const ready = pick !== "new" || kw.trim().length >= 2;
  return (
    <form
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void p.act(pick === "new" ? { action: "upgrade", keyword: kw.trim() } : { action: "upgrade", clusterId: pick }, (a) =>
          a.onPlan ? `${what} is on your plan already: your plan had a cluster not yet set up. Nothing changes on your bill.` : `Sent. Your account manager will confirm ${what} with you before anything is charged.`,
        );
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, alignItems: "end" }}>
        <label>
          <span className="dash-micro" style={{ marginBottom: 4 }}>Cluster</span>
          <select className="field" style={{ width: "100%" }} value={pick} onChange={(e) => setPick(e.target.value)}>
            {p.trackingOnly.map((c) => <option key={c.id} value={c.id}>{c.name} (tracked now)</option>)}
            <option value="new">A new keyword…</option>
          </select>
        </label>
        {pick === "new" ? (
          <label>
            <span className="dash-micro" style={{ marginBottom: 4 }}>Keyword</span>
            <input className="field" style={{ width: "100%" }} value={kw} maxLength={KEYWORD_MAX} onChange={(e) => setKw(e.target.value)} placeholder="the search to win" />
          </label>
        ) : null}
      </div>
      {ready ? <p style={{ fontSize: 13, margin: "10px 0 0" }}>We work on <b>{what}</b> every month as well as your plan&rsquo;s clusters{p.price ? <>, for <b>{p.price} a month more</b></> : ""}, once you have agreed it with us.</p> : null}
      <button type="submit" className="btn primary" style={{ marginTop: 10 }} disabled={!ready || p.busy}>Ask to add it to my plan</button>
    </form>
  );
}
