"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { SCAN_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { isPlausibleEmail, normalizeEmail } from "@/lib/email-address";
import { appPath } from "@/lib/app-host";
import LoginHoneypot from "@/components/LoginHoneypot";

/** The route's refusal, word for word, so the browser and the server say the same thing. */
const BAD_EMAIL = "That email does not look right.";

/**
 * The email box on /app/login. Posts to /api/app/login and shows its one sentence.
 *
 * R151: a refused address is said under the field, linked by aria-describedby,
 * with focus moved back to it and the typed value kept (as /contact). It is
 * checked with the route's own validator before posting, so an empty or
 * impossible address is answered at once instead of by the browser's bubble.
 * Without script it posts to the same route, which 303s back with the outcome
 * and never the address; `refused` is that outcome for a bad address.
 * `again` is the page after a link went out: the button is outlined and asks
 * for another (R151, 3 Oct 2026).
 */
export default function LoginForm({ next, refused, again }: { next?: string; refused?: boolean; again?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(refused ? BAD_EMAIL : null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function refuse(text: string) {
    setFieldError(text);
    inputRef.current?.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setFieldError(null);
    const address = normalizeEmail(email);
    if (!address) return refuse("Enter the email you signed up or were invited with.");
    if (address.length > SCAN_LIMITS.email || !isPlausibleEmail(address)) return refuse(BAD_EMAIL);
    setBusy(true);
    try {
      const res = await fetch("/api/app/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ...(next ? { next } : {}), ...(trapRef.current?.value ? { website: trapRef.current.value } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (body.error === "bad_email") refuse(body.message ?? BAD_EMAIL);
      // R151 (3 Oct 2026): a sent link moves to the page's sent state, as the
      // form does without script, and the address is never in the URL.
      else if (body.ok) router.replace(appPath(`/login?${new URLSearchParams(next ? { sent: "1", next } : { sent: "1" })}`));
      else setMessage(body.message ?? "Something went wrong. Please try again.");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action="/api/app/login" method="post" onSubmit={submit} noValidate style={{ display: "grid", gap: "12px" }}>
      {next ? <input type="hidden" id="app-login-next" name="next" value={next} /> : null}
      <label htmlFor="app-login-email" style={{ fontSize: "14px", fontWeight: 600 }}>
        Email
      </label>
      <div>
        <input
          ref={inputRef}
          id="app-login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          maxLength={SCAN_LIMITS.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "app-login-email-error" : undefined}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 14px",
            border: `1px solid ${fieldError ? T.badFg : T.line}`,
            borderRadius: "10px",
            fontSize: "15px",
            color: T.ink,
          }}
        />
        {fieldError ? (
          <p id="app-login-email-error" role="alert" style={{ margin: "6px 0 0", fontSize: "13px", color: T.badFg }}>
            {fieldError}
          </p>
        ) : null}
      </div>
      <LoginHoneypot id="app-login-website" inputRef={trapRef} />
      <button
        type="submit"
        disabled={busy}
        style={{ padding: "12px 16px", borderRadius: "10px", border: again ? `1px solid ${T.line}` : "none", background: again ? T.surface : T.accent, color: again ? T.ink : "#ffffff", fontWeight: 600, fontSize: "15px" }}
      >
        {busy ? "Sending..." : again ? "Email me another link" : "Email me a link"}
      </button>
      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: "14px", color: T.soft, minHeight: "20px" }}>
        {message}
      </p>
    </form>
  );
}
