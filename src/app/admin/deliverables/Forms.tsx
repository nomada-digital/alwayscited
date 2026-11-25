"use client";

import { createContext, useActionState, useContext, useState, type ReactNode } from "react";

import { DELIVERABLE_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";

import { type AdminResult, type Fixed, deliverableForm } from "./actions";
import { hint, input, label } from "./styles";

/** One admin form posting to deliverableForm with a fixed action; the sentence it answers with shows under it. */
export function DeliverableForm({ fixed, submit, children, compact = false }: { fixed: Omit<Fixed, "by">; submit: string; children?: ReactNode; compact?: boolean }) {
  const by = useContext(Acting);
  const [state, formAction, pending] = useActionState(deliverableForm.bind(null, { ...fixed, by }), null as AdminResult | null);
  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: compact ? "8px" : "12px" }}>
      {children}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" disabled={pending} style={{ padding: "8px 16px", border: `1px solid ${T.accent}`, borderRadius: "8px", background: T.accent, color: T.surface, font: "inherit", fontSize: "14px", fontWeight: 600, cursor: pending ? "wait" : "pointer" }}>
          {pending ? "Working..." : submit}
        </button>
        {state ? (
          <span role="status" style={{ fontSize: "13px", color: state.ok ? T.goodFg : T.badFg }}>{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}

const Acting = createContext("");

/** Who is acting, asked once at the top of the page and sent with every form: it is what the trail records. */
export function ActingProvider({ defaultValue, children }: { defaultValue: string; children: ReactNode }) {
  const [by, setBy] = useState(defaultValue);
  return (
    <Acting.Provider value={by}>
      <label style={{ ...label, maxWidth: "420px" }}>
        <span>Acting as <span style={hint}>(a Nomada email; it is written to every trail entry)</span></span>
        <input
          type="email"
          value={by}
          onChange={(e) => setBy(e.target.value)}
          style={input}
          autoComplete="email"
          maxLength={DELIVERABLE_LIMITS.by}
        />
      </label>
      {children}
    </Acting.Provider>
  );
}
