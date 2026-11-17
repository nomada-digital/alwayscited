/**
 * Google's "Sign in with Google" button (Danny, 17 Nov 2026: "use the google logo and improve"), as Google's branding
 * guidelines publish it (developers.google.com/identity/branding-guidelines): the standard four-colour G, the label
 * "Continue with Google", Roboto Medium 14px, a white fill with a #747775 one-pixel border and #1F1F1F text, 40px tall,
 * 12px side padding, 10px between logo and label, 4px corners. Never recoloured. The hub's google_button.py is the same
 * button for its pages. Full width under 520px, as the dashboard's other primary buttons are on a phone.
 *
 * The styles live here, not in dash.css: that stylesheet writes only the palette's tokens, and these colours are Google's
 * to fix, not ours (this file is one of palette.test.mts's MARKS, as EngineLogo.tsx is).
 */
const CSS = `.gsi-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:40px;padding:0 12px;box-sizing:border-box;border:1px solid #747775;border-radius:4px;background:#fff;color:#1f1f1f;font:500 14px/20px Roboto,"Helvetica Neue",Arial,sans-serif;letter-spacing:.25px;cursor:pointer;white-space:nowrap;transition:box-shadow .2s,background-color .2s}
.gsi-btn:hover{box-shadow:0 1px 2px 0 rgba(60,64,67,.3),0 1px 3px 1px rgba(60,64,67,.15)}
.gsi-btn:active,.gsi-btn:focus-visible{background:#f8f9fa;outline:none}
.gsi-btn:disabled{opacity:.6;cursor:default;box-shadow:none}
.gsi-btn .gsi-g{width:20px;height:20px;flex:none}
@media (max-width:520px){.gsi-btn{width:100%}}`;
export default function GoogleButton({ onClick, disabled = false, label = "Continue with Google" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <>
    <style>{CSS}</style>
    <button type="button" className="gsi-btn" onClick={onClick} disabled={disabled}>
      <svg className="gsi-g" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      <span>{label}</span>
    </button>
    </>
  );
}
