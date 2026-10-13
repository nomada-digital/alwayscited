"use client";

import { useEffect, useState } from "react";

import { T } from "@/config/tokens";

/**
 * A block of text to copy (13 Oct 2026, DIY P8; spec 10 sections 2.1 item 9
 * and 4.9): the JSON-LD fix, the robots.txt lines, an example's element. The
 * text is in a plain `<pre>`, selectable with JS off; the Copy button is the
 * one progressive enhancement, drawn only once script runs, so nobody without
 * it meets a button that does nothing. The block scrolls inside its own box,
 * never the page. `usage` is the beacon's event (fix_copy, example_copy).
 */
export default function CopyBlock({ text, label, usage, id, code = true, button }: { text: string; label: string; usage: string; id: string; code?: boolean; button?: string }) {
  const [ready, setReady] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => setReady(true), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setSaid("Copied.");
    } catch {
      setSaid("Select the text and copy it.");
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
      {code ? (
        <pre id={id} className="yp-code" tabIndex={0} aria-label={label} style={{ background: T.chip, color: T.ink, border: `1px solid ${T.line}` }}>
          <code>{text}</code>
        </pre>
      ) : (
        <p id={id} style={{ margin: 0, padding: "10px 12px", borderRadius: "10px", background: T.chip, border: `1px solid ${T.line}`, fontSize: "14px", lineHeight: 1.5, color: T.ink, overflowWrap: "anywhere", whiteSpace: "pre-line" }}>
          {text}
        </p>
      )}
      {ready ? (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={copy} data-usage={usage} aria-describedby={id} style={{ minHeight: "44px", padding: "0 16px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
            {button ?? (code ? "Copy the block" : "Copy")}
          </button>
          <span role="status" style={{ fontSize: "13px", color: T.soft }}>
            {said ?? ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
