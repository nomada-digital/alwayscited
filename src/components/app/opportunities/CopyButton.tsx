"use client";

import { useState, useSyncExternalStore } from "react";

import { BUTTON } from "@/components/app/plan/styles";

/**
 * Copy a block of text (13 Oct 2026, DIY P7; spec 10 section 2.1 item 9:
 * copy buttons are the only progressive enhancement, and the text is
 * selectable anyway). The server and a browser with JS off draw no button -
 * it appears only once the page is running - so nothing waits on it.
 */
const noop = () => () => {};

export default function CopyButton({ text, label = "Copy", usage }: { text: string; label?: string; usage?: string }) {
  const live = useSyncExternalStore(noop, () => true, () => false);
  const [done, setDone] = useState<"copied" | "failed" | null>(null);
  if (!live) return null;
  return (
    <button
      type="button"
      data-usage={usage}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setDone("copied"))
          .catch(() => setDone("failed"));
      }}
      style={BUTTON}
    >
      {done === "copied" ? "Copied" : done === "failed" ? "Select the text to copy it" : label}
    </button>
  );
}
