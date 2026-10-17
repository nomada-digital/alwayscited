"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { applyOp, inverseOp, refuseOp, undoAdd, type Op } from "@/lib/dash/ops";
import type { PlanShape } from "@/lib/dash/allowance";
import type { Raw } from "@/lib/dash/types";

/**
 * Optimistic editing for the dashboards host (17 Oct 2026).
 *
 * `shown` is the server-confirmed rows with every op still in flight applied
 * on top, so a change is drawn the moment it is made. Ops go to the server one
 * at a time, in order; each answer maps the op's tempIds to real ids, which
 * are swapped into the ops still waiting. A refusal drops that op - the rows
 * fall back to what the server holds - and says why in a toast. A success
 * says what changed, with Undo where there is something to undo.
 *
 * When the queue empties the page is refreshed in the background, so the
 * sidebar's allowances and every server-drawn figure catch up; the new rows
 * replace the confirmed ones only while nothing is in flight.
 */

export type Toast = { id: number; text: string; tone: "ok" | "err"; undo?: Op[] };
type Pending = { key: number; op: Op };
type Answer = { ok: true; ids: Record<string, string>; replaced?: string } | { ok: false; message: string };

let seq = 0;
export const tempId = (p = "t") => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;

function remap(op: Op, ids: Record<string, string>): Op {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(op)) {
    out[k] = typeof v === "string" && k !== "tempId" && ids[v] ? ids[v] : Array.isArray(v) ? v.map((x) => (typeof x === "string" && ids[x] ? ids[x] : x)) : v;
  }
  return out as Op;
}

/**
 * `demo` (a shared demo link, 17 Oct 2026): every op is judged and drawn as usual, then kept in the browser -
 * nothing is sent, the page is not refreshed under it, and each toast says the change is not saved.
 */
export function useOps(slug: string, initial: Raw, plan: PlanShape, demo = false) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [ids, setIds] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idsRef = useRef<Record<string, string>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  const n = useRef(0);

  useEffect(() => {
    if (inFlight.current === 0) setConfirmed(initial);
  }, [initial]);

  const shown = useMemo(() => pending.reduce((r, p) => applyOp(r, remap(p.op, ids), { by: "" }), confirmed), [pending, confirmed, ids]);
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++n.current;
    setToasts((l) => [...l.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), t.tone === "err" ? 7000 : t.undo ? 9000 : 5000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((l) => l.filter((x) => x.id !== id)), []);

  const send = useCallback(
    async (p: Pending, label: string | null, undoOf: ((ids: Record<string, string>, replaced?: string) => Op[] | null) | null) => {
      const op = remap(p.op, idsRef.current);
      let answer: Answer;
      if (demo) {
        // Each new row gets a stable local id; nothing leaves the page.
        const local: Record<string, string> = {};
        const t = (op as { tempId?: string }).tempId;
        if (t) for (const k of [t, `${t}-k`]) local[k] = `demo-${k}`;
        answer = { ok: true, ids: local };
      } else try {
        const r = await fetch(`/api/dash/${slug}/ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) });
        answer = (await r.json().catch(() => ({ ok: false, message: `The server answered ${r.status}.` }))) as Answer;
        if (r.status === 401) answer = { ok: false, message: "Your session has ended. Sign in again to save changes." };
      } catch {
        answer = { ok: false, message: "No connection. That change was not saved." };
      }
      if (answer.ok) {
        const got = answer.ids;
        idsRef.current = { ...idsRef.current, ...got };
        setIds(idsRef.current);
        setConfirmed((c) => applyOp(c, op, { by: "", newId: (t) => got[t] ?? t }));
        setPending((l) => l.filter((x) => x.key !== p.key));
        if (label) {
          const undo = undoOf ? undoOf(got, answer.replaced) : null;
          toast({ text: demo ? `${label} (Demo: not saved.)` : label, tone: "ok", ...(undo && undo.length ? { undo } : {}) });
        }
      } else {
        setPending((l) => l.filter((x) => x.key !== p.key));
        toast({ text: answer.message, tone: "err" });
      }
      inFlight.current -= 1;
      if (inFlight.current === 0 && !demo) router.refresh();
    },
    [slug, toast, router, demo],
  );

  /** Judge, draw, then save one op. Returns the refusal, or null when it went ahead. */
  const run = useCallback(
    (op: Op, label: string | null = null, opts: { undoable?: boolean } = {}): string | null => {
      const before = shownRef.current;
      const refused = refuseOp(before, op, plan);
      if (refused) {
        toast({ text: refused, tone: "err" });
        return refused;
      }
      const p = { key: ++n.current, op };
      setPending((l) => [...l, p]);
      inFlight.current += 1;
      const undoOf = opts.undoable === false ? null : (got: Record<string, string>, replaced?: string): Op[] | null => {
        if (op.op === "prompt.edit") {
          if (replaced) return [{ op: "prompt.remove", id: got[op.tempId] ?? op.tempId }, { op: "prompt.restore", id: replaced }];
          const was = before.prompts.find((x) => x.id === op.id);
          return was ? [{ op: "prompt.edit", id: op.id, text: was.text, tempId: tempId() }] : null;
        }
        const add = undoAdd(op, (t) => got[t] ?? t);
        if (add) return [add];
        const inv = inverseOp(before, op);
        return inv ? [inv] : null;
      };
      queue.current = queue.current.then(() => send(p, label, undoOf));
      return null;
    },
    [plan, send, toast],
  );

  const undo = useCallback(
    (t: Toast) => {
      dismiss(t.id);
      for (const op of t.undo ?? []) run(op, null, { undoable: false });
      toast({ text: "Undone.", tone: "ok" });
    },
    [dismiss, run, toast],
  );

  return { shown, run, toasts, dismiss, undo, busy: pending.length > 0 };
}

export function Toasts({ toasts, dismiss, undo }: { toasts: Toast[]; dismiss: (id: number) => void; undo: (t: Toast) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === "err" ? " err" : ""}`}>
          <span>{t.text}</span>
          {t.undo ? <button onClick={() => undo(t)}>Undo</button> : null}
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
