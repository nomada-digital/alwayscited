/**
 * Who is copied on every customer update email (Danny, 10 Nov 2026: copied on every alwayscited email that goes out to a
 * customer, for visibility, initially). One setting, the AC_VISIBILITY_CC
 * environment variable: a comma-separated list of addresses, unset or empty for nobody. The agency hub reads a variable
 * of the same name for the updates it sends (nomada-dashboards supabase/functions/client-comms-send).
 *
 * Customer updates only: the lifecycle emails (welcome, trials, first reading, setup, This week, plan ended). Never
 * the transactional ones - sign-in links, invites, scan verification, payment received - and never an internal alert.
 *
 * Plain module, no imports: node --test runs it.
 */
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i;

/** The addresses to copy, lower case and once each, leaving out the recipient (no one is copied on their own email). */
export function visibilityCc(to: string | readonly string[], raw: string | undefined = process.env.AC_VISIBILITY_CC): string[] {
  const own = new Set((Array.isArray(to) ? to : [to]).map((t) => String(t).trim().toLowerCase()));
  const out: string[] = [];
  for (const a of String(raw ?? "").split(",")) {
    const e = a.trim().toLowerCase();
    if (EMAIL.test(e) && !own.has(e) && !out.includes(e)) out.push(e);
  }
  return out;
}
