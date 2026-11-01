"use client";

import { useId, useState } from "react";

import { SCAN_LIMITS, WAITLIST_LIMITS } from "@/config/contact";
import { CARD, MICRO, T } from "@/config/tokens";
import { isPlausibleDomain, normalizeDomain } from "@/lib/scan/domain";

/**
 * The free scan, inline in the blog (Danny, 1 Nov 2026: "a domain input directly on the blog rather than a button
 * taking them to another page where they then need to put their domain in").
 *
 * A plain GET form to /scan with the domain, the page's ref (blog-<slug>, lib/scan/handoff.ts blogRef), market US
 * and the full slug in utm_content. /scan starts the scan by itself for a known ref arriving from our own pages
 * (handoffMayStart: ref "blog" and an alwayscited.com Referer), behind Turnstile, as the nomadadigital.co.uk hand-off
 * does; the start route keeps ref and utm on the scan, so the hub can count blog-driven scans per post. Without
 * JavaScript the form still posts and /scan checks the domain itself. No analytics here: nothing fires before the
 * consent banner's yes, and the scan's own events are the start route's.
 */
export default function BlogScanCta(p: { scanRef: string; slug?: string; heading?: string; lead?: string; market?: "US" | "UK" }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="blog-scan" style={{ ...CARD, margin: "28px 0 0", padding: "22px 24px", borderColor: T.accent }}>
      <div style={{ ...MICRO, color: T.accent }}>Free scan</div>
      <p style={{ margin: "8px 0 0", fontSize: "18px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
        {p.heading ?? "Check your AI visibility free"}
      </p>
      <p style={{ margin: "6px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
        {p.lead ?? "See which buying questions ChatGPT, Perplexity, Gemini and Google's AI answers name you for, and who they name instead. No call, no card."}
      </p>
      <form
        action="/scan"
        method="get"
        noValidate
        className="blog-scan-form"
        onSubmit={(e) => {
          const input = e.currentTarget.elements.namedItem("domain") as HTMLInputElement;
          const d = normalizeDomain(input.value);
          if (!d) { e.preventDefault(); setError("Enter your website, like yourcompany.com."); input.focus(); return; }
          if (!isPlausibleDomain(d)) { e.preventDefault(); setError("That doesn't look like a website address. Try yourcompany.com."); input.focus(); return; }
          setError(null);
          input.value = d;
        }}
        style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}
      >
        <label htmlFor={`${id}-d`} className="sr-only">Your website</label>
        <input
          id={`${id}-d`}
          name="domain"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={WAITLIST_LIMITS.domain}
          placeholder="yourcompany.com"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : undefined}
          onInput={() => error && setError(null)}
          style={{
            flex: "1 1 220px",
            minWidth: 0,
            boxSizing: "border-box",
            fontFamily: "inherit",
            fontSize: "16px",
            color: T.ink,
            background: T.surface,
            border: `1px solid ${error ? T.badFg : T.line}`,
            borderRadius: "10px",
            padding: "11px 14px",
          }}
        />
        <input type="hidden" name="ref" value={p.scanRef} maxLength={SCAN_LIMITS.ref} />
        <input type="hidden" name="market" value={p.market ?? "US"} maxLength={SCAN_LIMITS.ref} />
        <input type="hidden" name="utm_source" value="alwayscited" maxLength={SCAN_LIMITS.utm} />
        <input type="hidden" name="utm_medium" value="blog" maxLength={SCAN_LIMITS.utm} />
        {p.slug ? <input type="hidden" name="utm_content" value={p.slug} maxLength={SCAN_LIMITS.utm} /> : null}
        <button
          type="submit"
          className="btn-primary"
          style={{ flex: "0 0 auto", fontFamily: "inherit", fontSize: "15px", fontWeight: 600, border: 0, borderRadius: "10px", padding: "11px 20px", cursor: "pointer" }}
        >
          Check my visibility
        </button>
      </form>
      <p id={`${id}-e`} role="alert" aria-live="polite" style={{ margin: error ? "8px 0 0" : 0, fontSize: "13px", color: T.badFg, minHeight: 0 }}>
        {error}
      </p>
    </div>
  );
}
