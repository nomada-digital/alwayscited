"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { SCAN_LIMITS, WALKTHROUGH_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { track } from "@/lib/analytics";
import { isPlausibleEmail, normalizeEmail } from "@/lib/email-address";
import {
  readWalkthroughCategory,
  readWalkthroughMarket,
  readWalkthroughName,
  WALKTHROUGH_CATEGORIES,
  WALKTHROUGH_ERROR_FIELD,
  WALKTHROUGH_MARKETS,
  WALKTHROUGH_REFUSAL,
  type WalkthroughField,
} from "@/lib/scan/walkthrough-fields";
import type { WalkthroughOutcome } from "@/lib/scan/walkthrough-outcome";
import { isWorkEmail, WORK_EMAIL_REFUSAL } from "@/lib/work-email";

import { btn, field, label } from "./screens";

/**
 * The walkthrough ask, in its own file because two surfaces make it.
 *
 * It was declared inside `ResultView` and used once, which was right while the
 * scan report was the only page with a call to action. The campaign benchmark
 * is the second: a PR agency that has just read which of its placements the
 * engines cited is being asked the same question - do you want to see the
 * dashboards - and copying the form there would have been two forms posting to
 * one endpoint, drifting apart a field at a time.
 *
 * `token` is a **scans** token, not a campaign one. `/api/scan/[token]/walkthrough`
 * looks the row up by `scans.public_token`, and a campaign's own public token
 * will 404 against it. The benchmark reading passes its reading's scan token
 * for that reason - see `readCampaign`, which selects it.
 *
 * The ask itself, since 24 September 2026. Danny: the result should lead into
 * alwaystracked, and the CTA is purely a walkthrough - a Loom of the platform
 * or a demo call with him. alwaystracked is set up per client rather than
 * self-serve today, so "see it" means somebody shows you.
 *
 * What this must keep straight: alwaystracked reports, it does not place. The
 * placements are alwaysmentioned, which is a service.
 *
 * The third surface, 28 September 2026 (pricing spec section 6, Danny,
 * danny.md line 55): every tier page, where there is no scan. Pass `from` (the
 * tier page's path) instead of `token` and it posts to `/api/walkthrough`,
 * which stores the ask with no scan. Without JS that version renders nothing -
 * the page's own "Book a call" link stands in, since a form that cannot post
 * would only lose the address.
 *
 * Two options, not three (R176, Danny, 1 Oct 2026, danny.md lines 190-208):
 * R54's "Book a call" link to /contact is gone from the toggle (every other
 * Book a call on the site stays). The two name who does it - "Loom with Luke",
 * "Demo with Danny" - each with a 24px round photo before its label.
 *
 * Name, category and market, all required (Danny, 13 Oct 2026). The options
 * and the refusals come from lib/scan/walkthrough-fields.ts, which both routes
 * read the post through, so the two ends cannot disagree. Each field's error
 * sits under it and is tied to it by aria-describedby; on a refused submit the
 * first wrong field takes focus. Without script the scan version posts as it
 * did, and the route's outcome word names the field it refused. `market`
 * preselects the scan's own market, which the visitor chose when they ran it;
 * the tier pages have no such choice to go on, so nothing is preselected there.
 *
 * Three things from the 13 Oct 2026 review. Each field error is role="alert",
 * as wt-error was before it, because focus only announces a field when it
 * moves: Enter pressed in the field that is wrong left it where it was and the
 * refusal was silent. A refusal remounts the errors (keyed on its count) so a
 * second one is heard too. Focus moves in an effect after the render, as
 * ContactForm does, so aria-invalid and aria-describedby are on the field when
 * it lands. And noValidate goes on only once script runs: without it the
 * browser's own `required` stops an empty field before the post, rather than
 * the route sending back one field per round trip with everything typed lost.
 */
type Errors = Partial<Record<WalkthroughField, string>>;

const OUTCOME_ERRORS: Partial<Record<WalkthroughOutcome, Errors>> = {
  bad: { email: "That email does not look right." },
  personal: { email: WORK_EMAIL_REFUSAL },
  name: { name: WALKTHROUGH_REFUSAL.name },
  category: { category: WALKTHROUGH_REFUSAL.category },
  market: { market: WALKTHROUGH_REFUSAL.market },
};

const FIELD_ORDER: WalkthroughField[] = ["name", "email", "category", "market"];

/** The element a field's error sends focus to; the market's is its first radio. */
const focusId = (f: WalkthroughField) => (f === "market" ? `wt-market-${WALKTHROUGH_MARKETS[0]}` : `wt-${f}`);

/** False while the server renders and while it hydrates, true once script runs. */
const noSubscribe = () => () => {};

const fieldError: React.CSSProperties = { fontSize: "13px", lineHeight: 1.5, color: T.badFg, margin: "6px 0 0" };

export default function WalkthroughForm(p: { token: string; back?: string; outcome?: WalkthroughOutcome | null; market?: string | null } | { from: string }) {
  const token = "token" in p ? p.token : null;
  // R151 (3 Oct 2026): the scan version posts without script as well, and the
  // route's 303 brings back only `outcome`, which the page passes in.
  const outcome = "token" in p ? (p.outcome ?? null) : null;
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [kind, setKind] = useState<"video" | "demo">(outcome === "demo" ? "demo" : "video");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [market, setMarket] = useState(() => {
    const scanMarket = "token" in p ? p.market : null;
    return scanMarket && readWalkthroughMarket(scanMarket).ok ? scanMarket : "";
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>((outcome && OUTCOME_ERRORS[outcome]) ?? {});
  /** The latest refusal: `n` counts them, so the same field refused twice still moves focus and is announced. */
  const [refusal, setRefusal] = useState<{ n: number; first: WalkthroughField } | null>(null);
  useEffect(() => {
    if (refusal) document.getElementById(focusId(refusal.first))?.focus();
  }, [refusal]);
  const [err, setErr] = useState(outcome === "failed" ? "That did not go through. Please try again." : "");
  const [done, setDone] = useState(outcome === "video" ? "Thanks. Luke will send your Loom." : outcome === "demo" ? "Thanks. Danny will be in touch." : "");

  /** Every field's refusal, read the way the routes read it. */
  function check(): Errors {
    const out: Errors = {};
    const n = readWalkthroughName(name);
    if (!n.ok) out.name = n.message;
    const address = normalizeEmail(email);
    if (!address) out.email = "Enter your work email.";
    else if (address.length > SCAN_LIMITS.email || !isPlausibleEmail(address)) out.email = "That email does not look right.";
    else if (!isWorkEmail(address)) out.email = WORK_EMAIL_REFUSAL;
    const c = readWalkthroughCategory(category);
    if (!c.ok) out.category = c.message;
    const m = readWalkthroughMarket(market);
    if (!m.ok) out.market = m.message;
    return out;
  }

  function refuse(next: Errors) {
    setErrors(next);
    const first = FIELD_ORDER.find((f) => next[f]);
    if (first) setRefusal((r) => ({ n: (r?.n ?? 0) + 1, first }));
  }

  /** A field's error, under it; announced when it appears, and again on each refusal. */
  const errorLine = (f: WalkthroughField) =>
    errors[f] ? (
      <p key={`${f}-${refusal?.n ?? 0}`} id={`wt-${f}-error`} role="alert" style={fieldError}>
        {errors[f]}
      </p>
    ) : null;

  /** A field's error clears as soon as it is changed. */
  function edited(f: WalkthroughField) {
    if (!errors[f]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[f];
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = check();
    if (Object.keys(found).length) {
      setErr("");
      refuse(found);
      return;
    }
    setErrors({});
    setErr("");
    setBusy(true);
    try {
      const headers = new Headers();
      headers.set("content-type", "application/json");
      // Two literal calls, not one with a computed path: route-callers reads
      // each fetch's own first argument to join it to the route that answers.
      const res = token
        ? await fetch("/api/scan/" + token + "/walkthrough", {
            method: "POST",
            headers,
            body: JSON.stringify({ name, email, category, market, kind }),
          })
        : await fetch("/api/walkthrough", {
            method: "POST",
            headers,
            body: JSON.stringify({ name, email, category, market, kind, from: "from" in p ? p.from : "" }),
          });
      const data = await res.json();
      if (!res.ok && res.status !== 429) {
        const field = typeof data.error === "string" && Object.hasOwn(WALKTHROUGH_ERROR_FIELD, data.error) ? WALKTHROUGH_ERROR_FIELD[data.error] : null;
        if (field && data.message) refuse({ [field]: data.message });
        else setErr(data.message ?? "That did not go through. Please try again.");
        return;
      }
      setDone(data.message ?? (kind === "video" ? "Thanks. Luke will send your Loom." : "Thanks. Danny will be in touch."));
      track("walkthrough_requested", { kind });
    } catch {
      setErr("We could not reach the checker. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // The scan version renders on the server so it can post without script; the
  // tier pages' version needs script to post at all, so it waits for it.
  if (!token && !hydrated) return null;

  if (done) {
    return (
      <p id="walkthrough" aria-live="polite" style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.ink }}>
        {done}
      </p>
    );
  }

  // ScanResult.dc.html's switch: short labels on a grey track, and the chosen
  // one's note under it rather than inside each option.
  const options: { key: "video" | "demo"; title: string; photo: string; note: string }[] = [
    {
      key: "video",
      title: "Loom with Luke",
      photo: "/team/luke.webp",
      note: token ? "Luke records a Loom of the platform against this report." : "Luke records a Loom of the platform for you.",
    },
    { key: "demo", title: "Demo with Danny", photo: "/team/danny.webp", note: "Danny takes you through it on a call." },
  ];
  const chosen = options.find((o) => o.key === kind) ?? options[0];

  // R151 (1 Oct 2026): the WAI-ARIA APG radio group - one tab stop, the
  // checked option, and the arrows (Home, End) move the choice and focus with
  // it. Separate tab stops read as separate buttons, not one choice.
  function onToggleKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    const at = options.findIndex((o) => o.key === kind);
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % options.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at - 1 + options.length) % options.length
      : e.key === "Home" ? 0
      : e.key === "End" ? options.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    setKind(options[to].key);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  }

  return (
    <form id="walkthrough" action={token ? "/api/scan/" + token + "/walkthrough" : undefined} method="post" onSubmit={submit} noValidate={hydrated}>
      <input type="hidden" id="wt-kind" name="kind" value={kind} />
      {"token" in p && p.back ? <input type="hidden" id="wt-back" name="back" value={p.back} /> : null}
      <div role="radiogroup" aria-label="How would you like to see it" className="wt-toggle">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={kind === o.key}
            tabIndex={kind === o.key ? 0 : -1}
            onKeyDown={onToggleKey}
            onClick={() => setKind(o.key)}
            className={"wt-option" + (kind === o.key ? " wt-option--on" : "")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 24px, sized in the tag, no layout shift */}
            <img src={o.photo} width={24} height={24} alt="" />
            {o.title}
          </button>
        ))}
      </div>
      <p aria-live="polite" style={{ margin: "14px 0 0", fontSize: "13.5px", lineHeight: 1.5, color: T.soft, minHeight: "42px" }}>
        {chosen.note}
      </p>
      <label htmlFor="wt-name" style={{ ...label, marginTop: "14px", display: "block" }}>
        Your name
      </label>
      <input
        id="wt-name"
        type="text"
        name="name"
        autoComplete="name"
        maxLength={WALKTHROUGH_LIMITS.name}
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          edited("name");
        }}
        style={field}
        aria-invalid={Boolean(errors.name)}
        aria-describedby={errors.name ? "wt-name-error" : undefined}
      />
      {errorLine("name")}
      <label htmlFor="wt-email" style={{ ...label, marginTop: "14px", display: "block" }}>
        Work email
      </label>
      <input
        id="wt-email"
        type="email"
        name="email"
        autoComplete="email"
        maxLength={SCAN_LIMITS.email}
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          edited("email");
        }}
        style={field}
        aria-invalid={Boolean(errors.email)}
        aria-describedby={errors.email ? "wt-email-error" : undefined}
      />
      {errorLine("email")}
      <label htmlFor="wt-category" style={{ ...label, marginTop: "14px", display: "block" }}>
        Category
      </label>
      <select
        id="wt-category"
        name="category"
        required
        value={category}
        onChange={(e) => {
          setCategory(e.target.value);
          edited("category");
        }}
        style={{ ...field, color: category ? T.ink : T.soft }}
        aria-invalid={Boolean(errors.category)}
        aria-describedby={errors.category ? "wt-category-error" : undefined}
      >
        <option value="">Pick your category</option>
        {WALKTHROUGH_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id} style={{ color: T.ink }}>
            {c.label}
          </option>
        ))}
      </select>
      {errorLine("category")}
      <fieldset
        role="radiogroup"
        aria-labelledby="wt-market-label"
        aria-required="true"
        aria-invalid={Boolean(errors.market)}
        aria-describedby={errors.market ? "wt-market-error" : undefined}
        style={{ border: 0, padding: 0, margin: "14px 0 0", minWidth: 0 }}
      >
        <legend id="wt-market-label" style={{ ...label, padding: 0 }}>
          Market
        </legend>
        <div style={{ display: "flex", gap: "8px" }}>
          {WALKTHROUGH_MARKETS.map((m) => (
            <label
              key={m}
              htmlFor={`wt-market-${m}`}
              style={{
                flex: "1 1 0",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                minHeight: "48px",
                padding: "0 16px",
                fontSize: "1rem",
                fontWeight: 600,
                color: T.ink,
                background: T.surface,
                border: `1.5px solid ${market === m ? T.accent : T.line}`,
                borderRadius: "12px",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                id={`wt-market-${m}`}
                name="market"
                value={m}
                required
                checked={market === m}
                onChange={() => {
                  setMarket(m);
                  edited("market");
                }}
                aria-describedby={errors.market ? "wt-market-error" : undefined}
                style={{ width: "18px", height: "18px", margin: 0, accentColor: T.accent, flexShrink: 0 }}
              />
              {m}
            </label>
          ))}
        </div>
      </fieldset>
      {errorLine("market")}
      {err ? (
        <p id="wt-error" role="alert" style={{ fontSize: "13px", color: T.badFg, marginTop: "8px" }}>
          {err}
        </p>
      ) : null}
      <button type="submit" className="btn-primary" style={{ ...btn, width: "100%", marginTop: "12px" }} disabled={busy}>
        {busy ? "Sending" : kind === "video" ? "Send me the walkthrough" : "Request a demo"}
      </button>
      <p style={{ fontSize: "12px", color: T.soft, marginTop: "10px", lineHeight: 1.5 }}>
        We use these to send you the walkthrough or arrange the call, and nothing else. <a href="/legal">What we collect</a>.
      </p>
    </form>
  );
}
