"use client";

import { useRef, useState } from "react";

import LoginHoneypot from "@/components/LoginHoneypot";
import { SCAN_LIMITS } from "@/config/contact";

/** Email in, link out: the same endpoint as /app's sign-in, which links back to the host it was asked from. */
export default function LoginForm({ next = null }: { next?: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const trapRef = useRef<HTMLInputElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setMsg(null);
    const r = await fetch("/api/app/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, ...(next ? { next } : {}), ...(trapRef.current?.value ? { website: trapRef.current.value } : {}) }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    if (r?.ok && j?.ok) {
      setState("sent");
      setMsg(j.message ?? "If that address has access, we've sent a link.");
    } else {
      setState("error");
      setMsg(j?.message ?? "Something went wrong. Please try again.");
    }
  }
  if (state === "sent") {
    return (
      <div role="status">
        <p style={{ margin: "0 0 6px", fontWeight: 700 }}>Check your inbox</p>
        <p className="muted" style={{ margin: 0 }}>{msg} It works once, for 15 minutes.</p>
        <button className="btn ghost" style={{ marginTop: 14, marginLeft: -8 }} onClick={() => setState("idle")}>Use a different address</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="email" className="dash-micro" style={{ marginBottom: 6 }}>Work email</label>
      <input id="email" type="email" autoComplete="email" required maxLength={SCAN_LIMITS.email} className={`field${state === "error" ? " err" : ""}`} style={{ width: "100%" }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      {state === "error" && msg ? <div className="field-err" role="alert">{msg}</div> : null}
      <LoginHoneypot id="dash-login-website" inputRef={trapRef} />
      <button type="submit" className="btn primary" style={{ width: "100%", marginTop: 12, padding: "10px 14px" }} disabled={state === "sending" || !email.trim()}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
