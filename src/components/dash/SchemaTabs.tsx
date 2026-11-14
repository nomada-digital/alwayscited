"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** The three ways to add the schema, each with Copy, and Check again (Schema for your site, 14 Nov 2026). */
export default function SchemaTabs({ developer, ai, gtm, platform }: { developer: string; ai: string; gtm: string; platform: string | null }) {
  const [tab, setTab] = useState<"dev" | "ai" | "gtm">("dev");
  const [copied, setCopied] = useState(false);
  const body = tab === "dev" ? developer : tab === "ai" ? ai : gtm;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="dash-card" style={{ marginTop: 16 }}>
      <div role="tablist" aria-label="How to add it" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {([["dev", "For your developer"], ["ai", "Ask an AI to add it"], ["gtm", "Google Tag Manager"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn sm${tab === k ? " primary" : ""}`} onClick={() => { setTab(k); setCopied(false); }}>{l}</button>
        ))}
      </div>
      <p className="intro" style={{ margin: "10px 0 6px" }}>
        {tab === "dev" ? "Send this to whoever looks after your website. Each block says which page it goes on." : null}
        {tab === "ai" ? `Paste this into ChatGPT or Claude, or give it to an AI browser assistant such as Claude in Chrome while you're signed in to your website's admin${platform ? ` (your site looks like it runs on ${platform})` : ""}. It includes the code and asks the AI to check it with Google's Rich Results Test.` : null}
        {tab === "gtm" ? "Only if you already use Google Tag Manager: make one Custom HTML tag for each block, with the trigger shown. Google and Gemini read schema added through Tag Manager. Other AI crawlers are less consistent at running JavaScript, though ChatGPT's are reported to be improving. Adding it to the page directly is the most reliable option." : null}
      </p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, maxHeight: 420, overflow: "auto", background: "var(--chip)", borderRadius: 10, padding: 12, margin: 0 }}>{body}</pre>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button className="btn primary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

export function CheckAgain() {
  const router = useRouter();
  const [busy, start] = useTransition();
  return <button className="btn sm" disabled={busy} onClick={() => start(() => router.refresh())}>{busy ? "Checking..." : "Check again"}</button>;
}
