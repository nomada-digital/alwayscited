import { NextResponse } from "next/server";


import { APP_LIMITS, SCAN_LIMITS } from "@/config/contact";
import { isPlausibleEmail, normalizeEmail } from "@/lib/email-address";
import { clientIp, hashIp } from "@/lib/scan/ip";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendLoginLink } from "@/lib/tracking/login-mail";
import { LOGIN_SENT, LOGIN_TTL_MS, LOGIN_PER_EMAIL_PER_HOUR, hashToken, mayRecordStranger, mayRequestLink, newToken } from "@/lib/tracking/session";
import { dashLinkOrigin, dashNext } from "@/lib/dash/host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send a dashboard login link (T3, 29 Sep 2026; BRIEF decision 2).
 *
 * Answers LOGIN_SENT whatever happened - member or not, capped or not - so
 * the response never discloses who has access. Mail goes only to an address
 * found in dashboard_members, and at most LOGIN_PER_EMAIL_PER_HOUR links an
 * hour per address and LOGIN_PER_IP_PER_HOUR per hashed IP, counted off
 * dashboard_login_tokens.
 *
 * R151 (2 Oct 2026): also takes the login form posted without script, and
 * answers that with a 303 back to /app/login carrying only the outcome - never
 * the address - and the safe next path, so the page can say it.
 */
export async function POST(req: Request) {
  const isForm = !(req.headers.get("content-type") ?? "").includes("application/json");
  let body: { email?: string; next?: unknown; website?: unknown };
  if (isForm) {
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "bad_request" }, { status: 400 });
    body = { email: String(form.get("email") ?? ""), next: form.get("next") ?? undefined, website: form.get("website") ?? undefined };
  } else {
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
  }
  const answer = (json: { ok?: true; error?: string; message?: string }, status = 200) => {
    if (!isForm) return Response.json(json, { status });
    const q = new URLSearchParams(json.ok ? { sent: "1" } : json.error === "bad_email" ? { email: "bad" } : { failed: "1" });
    const back = dashNext(body.next);
    if (back) q.set("next", back);
    // back to the dashboards host's sign-in, the only one there is since the cut-over (22 Oct 2026)
    return NextResponse.redirect(new URL(`/login?${q}`, dashLinkOrigin(req.headers.get("host"))), 303);
  };
  // The honeypot (18 Oct 2026), answered first and as a success, as the contact and waitlist actions do: a person never
  // fills an off-screen field, and an error would tell a bot which field gave it away. Clamped before it is logged.
  const website = String(body.website ?? "").slice(0, APP_LIMITS.website).trim();
  if (website) {
    console.warn("[app] login honeypot filled, nothing sent or stored", { website });
    return answer({ ok: true, message: LOGIN_SENT });
  }
  const email = normalizeEmail(body.email ?? "");
  if (email.length > SCAN_LIMITS.email || !isPlausibleEmail(email)) {
    return answer({ error: "bad_email", message: "That email does not look right." }, 400);
  }

  const db = supabaseAdmin();
  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const lastMinute = new Date(Date.now() - 60 * 1000).toISOString();

  const [{ count: byEmail, error: eErr }, { count: byIp, error: iErr }, { count: byIpMinute, error: mnErr }] = await Promise.all([
    db.from("dashboard_login_tokens").select("token_hash", { count: "exact", head: true }).eq("email", email).gte("created_at", since),
    db.from("dashboard_login_tokens").select("token_hash", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since),
    db.from("dashboard_login_tokens").select("token_hash", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", lastMinute),
  ]);
  if (eErr || iErr || mnErr) {
    console.warn(`[app] could not count login requests: ${(eErr ?? iErr ?? mnErr)!.message}`);
    return answer({ error: "read_failed", message: "Something went wrong. Please try again." }, 502);
  }
  if (!mayRequestLink(byEmail ?? 0, byIp ?? 0, byIpMinute ?? 0)) {
    console.warn(`[app] login link capped (${LOGIN_PER_EMAIL_PER_HOUR}/h per address)`);
    return answer({ ok: true, message: LOGIN_SENT });
  }

  const { data: member, error: mErr } = await db.from("dashboard_members").select("email").eq("email", email).is("removed_at", null).limit(1);
  if (mErr) {
    console.warn(`[app] could not read members: ${mErr.message}`);
    return answer({ error: "read_failed", message: "Something went wrong. Please try again." }, 502);
  }

  // A member's request is always recorded. A stranger's is recorded so the caps above count it too, but only up to
  // LOGIN_STRANGER_ROWS_PER_HOUR across everyone (18 Oct 2026); past that, or when that count cannot be read (the
  // `stranger` column's migration not applied yet), it is answered the same and nothing is written.
  const isMember = Boolean(member?.length);
  if (!isMember) {
    const { count: strangers, error: sErr } = await db.from("dashboard_login_tokens").select("token_hash", { count: "exact", head: true }).eq("stranger", true).gte("created_at", since);
    if (sErr || !mayRecordStranger(strangers ?? 0)) return answer({ ok: true, message: LOGIN_SENT });
  }
  const token = newToken();
  const { error: tErr } = await db.from("dashboard_login_tokens").insert({
    token_hash: hashToken(token),
    email,
    ip_hash: ipHash,
    expires_at: new Date(Date.now() + LOGIN_TTL_MS).toISOString(),
    // A non-member's row is born used, so it can never log anybody in.
    used_at: isMember ? null : new Date().toISOString(),
    ...(isMember ? {} : { stranger: true }),
  });
  if (tErr) {
    console.warn(`[app] could not store a login token: ${tErr.message}`);
    return answer({ error: "write_failed", message: "Something went wrong. Please try again." }, 502);
  }

  if (isMember) {
    // R164: the page a signed-out visitor was on rides the link, validated again on every hop.
    // Cut-over (22 Oct 2026): every sign-in link opens the dashboards host, where its session cookie lives,
    // wherever it was asked from; an old /app next is mapped to its dashboards page (dashNext).
    const next = dashNext(body.next);
    const link = `${dashLinkOrigin(req.headers.get("host"))}/auth?token=${token}` + (next ? `&next=${encodeURIComponent(next)}` : "");
    await sendLoginLink({ memberEmail: member[0]!.email as string, link });
  }
  return answer({ ok: true, message: LOGIN_SENT });
}
