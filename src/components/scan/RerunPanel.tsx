"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { T } from "@/config/tokens";
import { track } from "@/lib/analytics";

/**
 * "Run a new check" under a finished report - 29 Oct 2026.
 *
 * Typing a domain again hands back its last reading for a month (the domain
 * cache in /api/scan/start), so a wrong category or a missing prompt had no way
 * round it. This starts a new scan of the same site at the confirm step, where
 * the category and every prompt can be changed; /api/scan/[token]/rerun has the
 * reasoning and the limits.
 */
export default function RerunPanel(p: { token: string; domain: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onRerun() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/scan/" + p.token + "/rerun", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.token !== "string") {
        setError(data.message ?? "We could not start a new check. Please try again.");
        setBusy(false);
        return;
      }
      track("scan_rerun", {});
      router.push("/scan/" + data.token);
    } catch {
      setError("We could not reach the checker. Please try again.");
      setBusy(false);
    }
  }

  return (
    <section style={{ margin: "40px 0 0", padding: "20px 22px", border: "1px solid " + T.line, borderRadius: "18px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: T.ink }}>Want to try a different category or other prompts?</h2>
      <p style={{ fontSize: "14px", color: T.soft, margin: "6px 0 14px", lineHeight: 1.6 }}>
        Start a new check of {p.domain}. You can change the category and edit, add or remove prompts before it runs. This
        report stays at its own link.
      </p>
      <button type="button" className="btn-primary" onClick={onRerun} disabled={busy}>
        {busy ? "Starting..." : "Run a new check"}
      </button>
      {error ? (
        <p role="alert" style={{ fontSize: "0.8125rem", color: T.badFg, margin: "10px 0 0" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
