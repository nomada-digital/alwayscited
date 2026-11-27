"use client";

import { createContext, useActionState, useContext, useState, type ReactNode } from "react";

import { LINK_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";

import { type AdminResult, type Fixed, linkForm } from "./actions";
import { hint, input, label } from "./styles";

const Acting = createContext("");

/** Who is acting, asked once at the top of the page and sent with every form: it is what the audit trail records. */
export function ActingProvider({ defaultValue, children }: { defaultValue: string; children: ReactNode }) {
  const [by, setBy] = useState(defaultValue);
  return (
    <Acting.Provider value={by}>
      <label style={{ ...label, maxWidth: "420px" }}>
        <span>Acting as <span style={hint}>(a Nomada email; written to the audit trail)</span></span>
        <input type="email" value={by} onChange={(e) => setBy(e.target.value)} style={input} autoComplete="email" maxLength={LINK_LIMITS.by} />
      </label>
      {children}
    </Acting.Provider>
  );
}

export function LinkForm({ fixed, submit, children, primary = true }: { fixed: Omit<Fixed, "by">; submit: string; children?: ReactNode; primary?: boolean }) {
  const by = useContext(Acting);
  const [state, formAction, pending] = useActionState(linkForm.bind(null, { ...fixed, by }), null as AdminResult | null);
  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {children}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" disabled={pending} style={{ padding: "8px 16px", border: `1px solid ${primary ? T.accent : T.line}`, borderRadius: "8px", background: primary ? T.accent : T.surface, color: primary ? T.surface : T.ink, font: "inherit", fontSize: "14px", fontWeight: 600, cursor: pending ? "wait" : "pointer" }}>
          {pending ? "Working..." : submit}
        </button>
        {state ? <span role="status" style={{ fontSize: "13px", color: state.ok ? T.goodFg : T.badFg }}>{state.message}</span> : null}
      </div>
    </form>
  );
}
