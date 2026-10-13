import type { CSSProperties, ReactNode } from "react";

import { T } from "@/config/tokens";
import type { GradeChip as Grade } from "@/lib/diy/core/evidence";
import type { Said } from "@/lib/diy/pages/words";
import type { Tone } from "@/lib/diy/pages/view";

/**
 * Your pages' small shared parts (13 Oct 2026, DIY P8), in the tokens only:
 * the section card, a state chip in the app's good, warn and bad pairs, the
 * grade chip with its source on hover, focus and phone, an advice line with
 * its chip, and the toast and notice bands the Actions page draws.
 */

export const SECTION: CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 };
export const H2: CSSProperties = { margin: 0, fontSize: "16px", fontWeight: 700, color: T.ink, letterSpacing: "-0.01em" };
export const H3: CSSProperties = { margin: 0, fontSize: "14px", fontWeight: 700, color: T.ink };
export const SMALL: CSSProperties = { margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft };
export const BODY: CSSProperties = { margin: 0, fontSize: "14px", lineHeight: 1.55, color: T.ink };
export const LINK: CSSProperties = { color: T.accent, fontWeight: 600, textDecoration: "none" };
export const BUTTON: CSSProperties = { minHeight: "44px", padding: "0 16px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" };
export const DARK: CSSProperties = { ...BUTTON, border: 0, background: T.ink, color: T.surface };
export const OFF: CSSProperties = { opacity: 0.55, cursor: "not-allowed" };
export const FIELD: CSSProperties = { minHeight: "44px", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "16px", boxSizing: "border-box", width: "100%", maxWidth: "520px" };
export const CODE: CSSProperties = { background: T.chip, color: T.ink, border: `1px solid ${T.line}` };

const CHIP: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", lineHeight: 1.6 };

export const TONE: Record<Tone, CSSProperties> = {
  good: { ...CHIP, background: T.goodBg, color: T.goodFg },
  warn: { ...CHIP, background: T.warnBg, color: T.warnFg },
  bad: { ...CHIP, background: T.badBg, color: T.badFg },
  none: { ...CHIP, background: T.chip, color: T.soft },
};

export function StateChip({ label, tone }: { label: string; tone: Tone }) {
  return <span style={TONE[tone]}>{label}</span>;
}

export function GradeChip({ chip, id }: { chip: Grade; id: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "2px", minWidth: 0, verticalAlign: "top" }}>
      <span className="yp-chip" tabIndex={chip.note ? 0 : undefined} title={chip.note ?? undefined} aria-describedby={chip.note ? id : undefined} style={{ ...CHIP, border: `1px solid ${T.line}`, background: T.surface, color: T.ink }}>
        {chip.label}
      </span>
      {chip.note ? (
        <span id={id} className="yp-chip-note" style={{ fontSize: "12px", lineHeight: 1.4, color: T.soft }}>
          {chip.note}
        </span>
      ) : null}
    </span>
  );
}

/** One advice line and its grade. Null draws nothing: a line that fails the register never renders (words.ts advice). */
export function Advice({ said, id, after }: { said: Said | null; id: string; after?: ReactNode }) {
  if (!said) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
      <p style={BODY} className="yp-break">
        {said.text}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-start" }}>
        <GradeChip chip={said.chip} id={`${id}-src`} />
        {after}
      </div>
    </div>
  );
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" style={{ margin: 0, padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, alignSelf: "flex-start", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "anywhere" }}>
      {text}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, padding: "12px 16px", borderRadius: "12px", background: T.wash, border: `1px solid ${T.washLine}`, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{children}</p>;
}

export const SECTION_ERROR = "We couldn't read this part just now. The rest of the page is up to date.";

export function SectionError({ label }: { label: string }) {
  return (
    <section aria-label={label} style={SECTION}>
      <p role="status" style={BODY}>
        {SECTION_ERROR}
      </p>
    </section>
  );
}

/** A disabled control's reason, read by a screen reader with the control. */
export function Reason({ id, text }: { id: string; text: string }) {
  return (
    <span id={id} style={{ ...SMALL, display: "block" }}>
      {text}
    </span>
  );
}
