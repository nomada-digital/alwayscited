import { APP_LIMITS } from "@/config/contact";

/**
 * The sign-in forms' honeypot (18 Oct 2026), the contact form's pattern:
 * off-screen rather than display:none, because a bot that skips hidden inputs
 * is the one worth catching; kept from the keyboard, screen readers and
 * password managers so a person never fills it. /api/app/login answers a filled
 * one as sent, sends nothing, stores nothing and logs it.
 */
export default function LoginHoneypot({ id, inputRef }: { id: string; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <div style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }} aria-hidden="true">
      <label htmlFor={id}>Website</label>
      <input ref={inputRef} id={id} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" maxLength={APP_LIMITS.website} data-1p-ignore data-lpignore="true" />
    </div>
  );
}
