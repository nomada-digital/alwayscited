"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";

import { CONTACT_FORM_ID } from "@/components/ContactTier";
import { CONTACT_LIMITS } from "@/config/contact";
import { submitContactForm, type ContactField, type ContactFormState } from "@/app/contact/actions";
import { T } from "@/config/tokens";
import { track } from "@/lib/analytics";

/**
 * The contact form, from Contact.dc.html: name, work email, agency, and what
 * you need. Four fields, because every extra one costs replies and the scan
 * already answers most of what a longer form would ask.
 */

const initialState: ContactFormState = { status: "idle" };

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: "14px",
  color: T.ink,
  background: T.surface,
  border: "1px solid " + T.line,
  borderRadius: "10px",
  padding: "11px 13px",
  // The board's controls sit at the browser's own line height. Inheriting the
  // body's 1.6 made each field 6px taller and the textarea 22px (Q21, 26 Sep).
  lineHeight: "normal",
};

/**
 * Off-screen rather than display:none, because a bot that skips hidden inputs
 * is exactly the one worth catching. tabIndex and aria-hidden keep it away
 * from the keyboard and from a screen reader, and autoComplete plus the two
 * password-manager hints keep a browser from filling it on a real visitor.
 * submitContactForm logs it if it ever fires, so a false positive is
 * discoverable instead of a silently eaten enquiry.
 */
const honeypotStyle: React.CSSProperties = {
  position: "absolute",
  left: "-9999px",
  width: "1px",
  height: "1px",
  overflow: "hidden",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: T.ink,
  marginBottom: "6px",
};

export default function ContactForm() {
  const [state, formAction, pending] = useActionState(submitContactForm, initialState);

  /**
   * What the visitor typed, put back as the fields' defaults.
   *
   * Not decoration. React resets a form with a function `action` on every
   * submission whatever the action returns - see the note on ContactValues -
   * so before this, an enquiry that failed the email regex came back as four
   * empty boxes and the sender had to write it again. The reset restores each
   * field to its `defaultValue` and runs after the new props are on the node,
   * so feeding the defaults from state is what survives it.
   *
   * These stay uncontrolled. Making them controlled would fix the same thing
   * and cost a re-render per keystroke on a form whose whole job is to be
   * typed into.
   */
  const typed = state.status === "error" ? state.values : undefined;

  /**
   * A refusal about one field is drawn under that field, marks it invalid and
   * takes focus there, so the reader of the sentence is standing on the box it
   * is about. The effect keys on the state object, which is new on every
   * submission, so a second refusal of the same field still moves focus.
   */
  const bad = state.status === "error" ? state.field : undefined;
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * generate_lead on a sent enquiry (15 Oct 2026) - but submitContactForm
   * answers "success" to a filled honeypot too, so a bot is told it worked.
   * Whether the hidden `website` field had anything in it is read at submit,
   * the one moment this side can see it, and a filled one is never counted.
   */
  const honeypotFilled = useRef(false);
  useEffect(() => {
    if (state.status === "success" && !honeypotFilled.current) track("generate_lead", { lead_type: "contact" });
  }, [state]);
  useEffect(() => {
    if (!bad) return;
    formRef.current?.querySelector<HTMLElement>(`[name="${bad}"]`)?.focus();
  }, [state, bad]);

  const fieldProps = (field: ContactField) =>
    bad === field
      ? {
          "aria-invalid": true as const,
          "aria-describedby": `c-${field}-error`,
          style: { ...inputStyle, borderColor: T.badFg },
        }
      : { style: inputStyle };

  const fieldError = (field: ContactField) =>
    bad === field && state.status === "error" ? (
      <p id={`c-${field}-error`} style={{ margin: "6px 0 0", fontSize: "13px", color: T.badFg }}>
        {state.message}
      </p>
    ) : null;

  if (state.status === "success") {
    /**
     * role="status" because this panel replaces the whole form. The error
     * paragraph below is role="alert" and announces; this said nothing at all,
     * so somebody using a screen reader pressed Send, heard the button label
     * change to "Sending", and then had the form vanish from under them with
     * no confirmation that anything had been received.
     */
    return (
      <div role="status" style={{ background: T.wash, border: "1px solid " + T.accent, borderRadius: "14px", padding: "20px 22px" }}>
        <p style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: T.ink }}>Message received.</p>
        <p style={{ margin: "6px 0 0", fontSize: "14px", lineHeight: 1.65, color: T.soft }}>
          It reaches the people doing the work.
        </p>
      </div>
    );
  }

  return (
    <form
      id={CONTACT_FORM_ID}
      ref={formRef}
      action={formAction}
      onSubmit={(e) => {
        const trap = e.currentTarget.elements.namedItem("website");
        honeypotFilled.current = trap instanceof HTMLInputElement && trap.value.trim() !== "";
      }}
      noValidate
    >
      <label htmlFor="c-name" style={labelStyle}>
        Name
      </label>
      <input
        id="c-name"
        name="name"
        type="text"
        required
        maxLength={CONTACT_LIMITS.name}
        autoComplete="name"
        defaultValue={typed?.name ?? ""}
        className="c-field"
        {...fieldProps("name")}
      />
      {fieldError("name")}

      <label htmlFor="c-email" style={{ ...labelStyle, marginTop: "16px" }}>
        Work email
      </label>
      <input
        id="c-email"
        name="email"
        type="email"
        required
        maxLength={CONTACT_LIMITS.email}
        autoComplete="email"
        placeholder="you@youragency.com"
        defaultValue={typed?.email ?? ""}
        className="c-field"
        {...fieldProps("email")}
      />
      {fieldError("email")}

      <label htmlFor="c-agency" style={{ ...labelStyle, marginTop: "16px" }}>
        Agency
      </label>
      <input
        id="c-agency"
        name="company"
        type="text"
        maxLength={CONTACT_LIMITS.company}
        autoComplete="organization"
        defaultValue={typed?.company ?? ""}
        className="c-field"
        {...fieldProps("company")}
      />
      {fieldError("company")}

      <label htmlFor="c-msg" style={{ ...labelStyle, marginTop: "16px" }}>
        What do you need
      </label>
      <textarea
        id="c-msg"
        name="message"
        rows={4}
        required
        maxLength={CONTACT_LIMITS.message}
        defaultValue={typed?.message ?? ""}
        {...fieldProps("message")}
        style={{ ...fieldProps("message").style, resize: "vertical" }}
      />
      {fieldError("message")}

      <div style={honeypotStyle} aria-hidden="true">
        <label htmlFor="c-website">Website</label>
        <input
          id="c-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
          data-1p-ignore
          data-lpignore="true"
        />
      </div>

      {state.status === "error" && !state.field ? (
        <p role="alert" style={{ margin: "12px 0 0", fontSize: "13px", color: T.badFg }}>
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn-primary"
        disabled={pending}
        style={{
          width: "100%",
          marginTop: "18px",
          fontFamily: "inherit",
          fontSize: "15px",
          fontWeight: 600,
          lineHeight: "normal",
          // Flat accent and no glow, as the board draws it; the class keeps
          // the hover.
          background: T.accent,
          color: T.surface,
          boxShadow: "none",
          border: 0,
          borderRadius: "10px",
          padding: "13px 20px",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Sending" : "Send"}
      </button>
      <p style={{ margin: "12px 0 0", fontSize: "12.5px", lineHeight: 1.55, color: T.soft }}>
        {/* No reply time: none is promised anywhere (Danny, 26 Sep 2026, R24). */}
        Goes to a person. We do not add you to anything - see the{" "}
        <Link href="/legal" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
