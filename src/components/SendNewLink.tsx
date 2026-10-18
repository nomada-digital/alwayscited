"use client";

import { useState, type FormEvent } from "react";

import { T } from "@/config/tokens";

/**
 * R163: a spent or expired login link offers a new one in one click, to the
 * address the old one went to. Posts to /api/app/login as LoginForm does, so
 * the same hourly limit and the same one sentence back. /checkout/done uses it
 * too, as "Send it again" (R166). R151 (3 Oct 2026): a form posting the
 * address in its body, so without script it still sends - the route 303s to
 * /app/login with only the outcome, which says LOGIN_SENT there.
 * `secondary` draws it outlined, for a page whose next step is the inbox
 * rather than this button (/checkout/done, R151 3 Oct 2026).
 */
export default function SendNewLink({ email, label, secondary }: { email: string; label?: string; secondary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/app/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setMessage(body.message ?? "Something went wrong. Please try again.");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action="/api/app/login" method="post" onSubmit={send} style={{ display: "grid", gap: "12px" }}>
      <input type="hidden" id="send-new-link-email" name="email" value={email} />
      <button
        type="submit"
        aria-disabled={busy || undefined}
        style={{ padding: "12px 16px", borderRadius: "10px", border: secondary ? `1px solid ${T.line}` : "none", background: secondary ? T.surface : T.accent, color: secondary ? T.ink : "#ffffff", fontWeight: 600, fontSize: "15px", cursor: busy ? "progress" : "pointer", overflowWrap: "anywhere" }}
      >
        {busy ? (
          <>
            <span className="btn-spin" aria-hidden="true" />
            Sending...
          </>
        ) : (
          (label ?? `Send a new link to ${email}`)
        )}
      </button>
      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: "14px", color: T.soft, minHeight: "20px" }}>
        {message}
      </p>
    </form>
  );
}
