"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CONTACT_EMAIL } from "@/config/contact";

/**
 * Buy an extra tracking pack (17 Oct 2026). Two steps, so nothing is bought
 * by one click: Add a pack shows the price and when it is charged, Confirm
 * buys it. A demo shows the same steps and buys nothing.
 */
export default function PackBuy({ slug, price, adds, trial, canBuy, demo }: { slug: string; price: string; adds: string; trial: boolean; canBuy: boolean; demo: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  if (!canBuy) return <p className="muted" style={{ fontSize: 13, margin: 0 }}>The account owner can add a pack.</p>;
  const buy = async () => {
    setStep("busy");
    if (demo) {
      setStep("done");
      setMsg("Demo: this is where the pack would be added. Nothing was bought.");
      return;
    }
    const r = await fetch(`/api/dash/${slug}/pack`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; message?: string; ask?: boolean } | null;
    setMsg(j?.message ?? "That did not go through. Nothing was charged.");
    setAsk(!!j?.ask);
    setStep(j?.ok ? "done" : "error");
    if (j?.ok) setTimeout(() => router.refresh(), 4000);
  };
  if (step === "done") return <div className="banner" role="status">{msg}</div>;
  if (step === "confirm" || step === "busy") {
    return (
      <div className="banner" style={{ display: "block" }}>
        <p style={{ margin: "0 0 10px" }}><b>{price} a month</b> for {adds}. {trial ? "Nothing is charged until your trial ends." : "This month is added to your next invoice, pro rata, then it is monthly with your plan."}</p>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={buy} disabled={step === "busy"}>{step === "busy" ? "Adding…" : `Confirm, ${price} a month`}</button>
          <button className="btn ghost" onClick={() => setStep("idle")} disabled={step === "busy"}>Cancel</button>
        </span>
      </div>
    );
  }
  return (
    <div>
      <button className="btn primary" onClick={() => setStep("confirm")}>Add a pack</button>
      {step === "error" && msg ? (
        <div className={ask ? "muted" : "field-err"} role="alert" style={{ marginTop: 8, fontSize: 13 }}>
          {msg} {ask ? <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Add a tracking pack")}`} style={{ color: "var(--accent)", fontWeight: 600 }}>Email us</a> : null}
        </div>
      ) : null}
    </div>
  );
}
