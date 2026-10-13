import Link from "@/components/app/AppLink";

import { T } from "@/config/tokens";

/**
 * The missing lens's switch (13 Oct 2026, DIY P4; spec 10 section 4.2 row 6):
 * a link to the same view with `?missing=1` on or off, so it works with JS
 * off, and says how many prompts the lens holds before it is opened.
 */
export default function MissingToggle({ on, count, href }: { on: boolean; count: number; href: string }) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      data-usage="ai_filter"
      style={{ display: "inline-flex", alignItems: "center", gap: "10px", minHeight: "36px", padding: "0 4px", color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none" }}
    >
      <span aria-hidden="true" style={{ position: "relative", flexShrink: 0, width: "34px", height: "20px", borderRadius: "999px", background: on ? T.accent : T.line }}>
        <span style={{ position: "absolute", top: "2px", left: on ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: T.surface, boxShadow: `0 1px 2px color-mix(in srgb, ${T.ink} 25%, transparent)` }} />
      </span>
      {`Only prompts that name others and never you (${count})`}
    </Link>
  );
}
