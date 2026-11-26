"use client";

import { useRef, useState } from "react";

/** Copy to the clipboard, falling back to selecting the text when the page may not use the clipboard API. */
async function copyText(text: string, fallback: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    const r = document.createRange();
    r.selectNodeContents(fallback);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/** One ready-to-paste prompt: its title, the text in a grey code-style box, and a prominent Copy button that says "Copied ✓". */
export function PromptBox({ title, body, n }: { title: string; body: string; n: number }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const pre = useRef<HTMLPreElement>(null);
  const copy = async () => {
    setState((await copyText(body, pre.current)) ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <section className="prompt-box" aria-label={title}>
      <div className="prompt-box__head">
        <h3><span className="prompt-box__n">{n}</span>{title}</h3>
        <button type="button" className={`btn primary prompt-box__copy${state === "copied" ? " is-copied" : ""}`} onClick={copy} aria-live="polite">
          {state === "copied" ? "Copied ✓" : state === "failed" ? "Press Ctrl/Cmd+C" : "Copy"}
        </button>
      </div>
      <pre ref={pre} className="prompt-box__code" tabIndex={0}>{body}</pre>
    </section>
  );
}

/** Download every prompt in a deliverable as one Markdown file, built in the browser from what is already on the page. */
export function DownloadMd({ markdown, fileName }: { markdown: string; fileName: string }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <button type="button" className="btn" onClick={download}>Download .md</button>;
}
