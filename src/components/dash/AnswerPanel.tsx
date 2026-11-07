"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import EngineLogo from "@/components/EngineLogo";
import type { Citation, Engine } from "@/lib/dash/types";

import AnswerText from "./AnswerText";
import { engineLabel, fullDay } from "./Figures";

type Answer = { run_date: string; engine: Engine; answered: boolean; named: boolean; brands: string[] | null; citations: Citation[] | null; response_text: string | null };
type State = { kind: "loading" } | { kind: "ok"; a: Answer | null } | { kind: "err"; message: string };

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/**
 * One engine's latest answer to one prompt, beside the prompt list (Danny, 7 Nov 2026): a side panel on a desktop,
 * a bottom sheet on a phone (dash.css .panel). Read from api/dash/[client]/answer when it opens; Escape, the
 * scrim or Close shuts it and focus goes back to the logo that opened it. The full history stays one link away.
 */
export default function AnswerPanel({ slug, prompt, engine, you, domain, detail, onClose }: { slug: string; prompt: { id: string; text: string }; engine: Engine; you: string[]; domain: string; detail: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/dash/${slug}/answer?${new URLSearchParams({ prompt: prompt.id, engine })}`)
      .then(async (r) => {
        const b = (await r.json().catch(() => null)) as { ok?: boolean; answer?: Answer | null; message?: string } | null;
        if (!live) return;
        if (b?.ok) setState({ kind: "ok", a: b.answer ?? null });
        else setState({ kind: "err", message: r.status === 401 ? "Sign in to read the answer here." : (b?.message ?? `The server answered ${r.status}.`) });
      })
      .catch(() => live && setState({ kind: "err", message: "No connection. Try again." }));
    return () => {
      live = false;
    };
  }, [slug, prompt.id, engine]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      opener?.focus?.();
    };
  }, [onClose]);
  const a = state.kind === "ok" ? state.a : null;
  const site = domain.replace(/^www\./, "").toLowerCase();
  const own = (c: Citation) => { const h = hostOf(c.url); return !!h && (h === site || h.endsWith(`.${site}`)); };
  return (
    <>
      <div className="panel-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="panel" role="dialog" aria-modal="true" aria-label={`${engineLabel(engine)}'s answer`}>
        <div className="panel-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2><EngineLogo engine={engine} size={18} />{engineLabel(engine)}</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{prompt.text}</p>
          </div>
          <button ref={closeRef} className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="panel-body">
          {state.kind === "loading" ? <p className="muted">Reading the answer…</p> : null}
          {state.kind === "err" ? <p className="field-err" role="alert">{state.message}</p> : null}
          {state.kind === "ok" && !a ? <p className="muted">{engineLabel(engine)} has not answered this prompt yet. The first reading comes the morning after a prompt is added.</p> : null}
          {a ? (
            <>
              <div className="dash-micro" style={{ marginBottom: 8, flexWrap: "wrap" }}>
                Latest reading, {fullDay(a.run_date)}
                {a.answered ? <span className={`pill${a.named ? " accent" : ""}`}>{a.named ? "Names you" : "Does not name you"}</span> : <span className="pill">No answer</span>}
              </div>
              {a.response_text ? (
                <AnswerText text={a.response_text} you={you} rivals={(a.brands ?? []).filter((b) => !you.some((y) => y.toLowerCase() === b.toLowerCase()))} />
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>{a.answered ? "The words of this answer are no longer kept. Who it named and cited are below." : "The engine gave no answer to this prompt that morning."}</p>
              )}
              {a.brands?.length ? <p style={{ fontSize: 12.5, margin: "8px 0 0" }}><span className="muted">Named: </span>{a.brands.join(", ")}</p> : null}
              {a.citations?.length ? (
                <>
                  <div className="dash-micro" style={{ marginTop: 12 }}>Sources cited</div>
                  <ul className="cites-list">
                    {a.citations.map((c, i) => (
                      <li key={`${c.url}-${i}`}>
                        <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" style={own(c) ? { fontWeight: 700 } : undefined}>{c.title || hostOf(c.url) || c.url}</a> <span className="muted">{hostOf(c.url)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : null}
          <Link className="btn" href={detail} style={{ marginTop: 16 }}>Every answer, every day</Link>
        </div>
      </aside>
    </>
  );
}
