import type { CSSProperties } from "react";

import { T } from "@/config/tokens";
import type { ItemSeverity } from "@/lib/diy/plan/types";

/**
 * The Actions page's shared styles (13 Oct 2026, DIY P3), in the tokens only
 * (palette.test.mts): the Clusters page's shell, Settings' buttons and fields,
 * and one chip per severity from the existing good, warn, bad and wash pairs.
 */

export const BUTTON: CSSProperties = { minHeight: "40px", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "13px", fontWeight: 600, cursor: "pointer" };
export const DARK: CSSProperties = { ...BUTTON, border: 0, background: T.ink, color: T.surface };
export const FIELD: CSSProperties = { minHeight: "40px", padding: "0 10px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "14px", boxSizing: "border-box", maxWidth: "100%" };
export const LABEL: CSSProperties = { fontSize: "12px", fontWeight: 600, color: T.soft };
export const SMALL: CSSProperties = { margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft };
export const LINK: CSSProperties = { color: T.accent, fontWeight: 600, textDecoration: "none" };
export const CHIP: CSSProperties = { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", lineHeight: 1.5 };
export const SECTION: CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 };
export const H2: CSSProperties = { margin: 0, fontSize: "16px", fontWeight: 700, color: T.ink, letterSpacing: "-0.01em" };

/** Ground and words per severity, from pairs the app already draws (and contrast.test.mts measures). */
export const SEVERITY_CHIP: Record<ItemSeverity, CSSProperties> = {
  blocking: { ...CHIP, background: T.badBg, color: T.badFg },
  slipping: { ...CHIP, background: T.warnBg, color: T.warnFg },
  closest: { ...CHIP, background: T.goodBg, color: T.goodFg },
  gap: { ...CHIP, background: T.wash, color: T.accentHover },
  tidy: { ...CHIP, background: T.chip, color: T.soft },
  own: { ...CHIP, background: T.chip, color: T.ink },
};

/** The disabled look, for a viewer's controls. */
export const OFF: CSSProperties = { opacity: 0.55, cursor: "not-allowed" };
