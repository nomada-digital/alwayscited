/**
 * The walkthrough form's invisible bot check (Danny, 26 Nov 2026), in front of the database's own walkthrough_spam_guard
 * trigger, which stays. Two things a person never does and a script posting straight at the route usually does:
 *
 * - fills a field that is hidden from sight (the honeypot, `company_site`); and
 * - submits within MIN_FILL_MS of the form appearing (`t`, the browser's clock when it mounted).
 *
 * A caught post is answered exactly as a real one is and stored nowhere, so the script learns nothing and nobody is
 * emailed. A script posting JSON with no `t` at all is asked to reload the page: a real browser with a stale copy of
 * the page sends no `t` either, and it can act on that sentence. A no-script form post carries no `t` and is held to
 * the honeypot alone. Pure, no imports, so the tests read it directly.
 */
export const HONEYPOT_FIELD = "company_site";
export const MIN_FILL_MS = 2_500;

export type BotVerdict = "ok" | "bot" | "reload";

export function botCheck(post: { honeypot?: unknown; t?: unknown }, opts: { json: boolean }, now = Date.now()): BotVerdict {
  if (typeof post.honeypot === "string" ? post.honeypot.trim() !== "" : post.honeypot != null && post.honeypot !== false) return "bot";
  const t = typeof post.t === "number" ? post.t : typeof post.t === "string" && post.t.trim() !== "" ? Number(post.t) : null;
  if (t === null) return opts.json ? "reload" : "ok";
  if (!Number.isFinite(t)) return "bot";
  // From the future, or inside the time a person needs to type a name and an address.
  if (t > now + 5_000 || now - t < MIN_FILL_MS) return "bot";
  return "ok";
}
