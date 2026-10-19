import type { Metadata } from "next";
import Link from "next/link";

import { PageHead } from "@/components/dash/Shell";
import TierName from "@/components/TierName";
import { pageData } from "@/lib/dash/page-data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";
import { TEAM_WHY, readTeam, teamWhy } from "@/lib/tracking/team";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

const EMAIL_DONE: Record<string, string> = { off: "The Monday summary is off.", on: "The Monday summary is on.", soon: "Email settings switch on shortly. Try again later today.", failed: "That did not save. Try again." };
const DONE: Record<string, string> = { invited: "Invited. They get an email with a sign-in link.", removed: "Removed. They can no longer sign in to this dashboard.", role: "Role changed." };

/**
 * Settings on the dashboards host (18 Oct 2026 brief 2d): who can see this
 * dashboard (#members), email (#email) and the plan (#plan, which is the Plan
 * page's: billing, packs, switching plan). The team forms post to the member
 * route /app's Settings used (team.ts holds every rule) with from=dash, which
 * brings them back here.
 */
export default async function Settings({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug } = await params;
  const sp = await searchParams;
  const { raw, base, demo, viewAs, email } = await pageData(slug);
  const readOnly = demo || !!viewAs;
  const owner = raw.role === "owner" && !readOnly;
  let team: { email: string; role: string }[] | null = null;
  if (!demo) {
    // The account is read here, server-side only, to read the team; it is never rendered (as the member route reads it).
    const { data: row, error: aErr } = await supabaseAdmin().from("client_domains").select("account_id").eq("id", raw.client.id).maybeSingle();
    const t = row && !aErr ? await readTeam(supabaseAdmin(), row.account_id as string) : null;
    team = t && typeof t !== "string" ? t.rows.filter((r) => r.removed_at === null && (!r.clients || r.clients.includes(raw.client.id))) : null;
  }
  const done = typeof sp.team === "string" ? (DONE[sp.team] ?? null) : null;
  const emailWord = typeof sp.email === "string" ? (EMAIL_DONE[sp.email] ?? null) : null;
  // 20261018040000: this member's own Monday-summary opt-out; read as on until the column exists.
  let weekOff = false;
  if (!demo) {
    const { data: me, error: meErr } = await supabaseAdmin().from("dashboard_members").select("this_week_opt_out").eq("email", email).is("removed_at", null).limit(1);
    weekOff = !meErr && !!(me?.[0] as { this_week_opt_out?: boolean } | undefined)?.this_week_opt_out;
  }
  const why = sp.team === "refused" ? teamWhy(sp.why) : null;
  return (
    <>
      <PageHead micro="Settings" title="Settings" intro="Who can see this dashboard, the emails it sends, and your plan." />
      <div className="dash-card" id="members">
        <h2>Team</h2>
        <p className="intro">Everyone here signs in with a link to their own email address. Owners change the team; editors change what is tracked; viewers read.</p>
        {done ? <div className="banner" role="status" style={{ marginTop: 10 }}>{done}</div> : null}
        {why ? <div className="field-err" role="alert">{TEAM_WHY[why]}</div> : null}
        {team === null ? <p className="faint">The team could not be read just now.</p> : (
          <div className="tbl-wrap" style={{ marginTop: 10 }}>
            <table className="tbl">
              <thead><tr><th>Email</th><th>Role</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {team.map((m) => (
                  <tr key={m.email}>
                    <td>{m.email}</td>
                    <td className="muted">{m.role}</td>
                    <td className="r">
                      {owner && m.role !== "owner" ? (
                        <form method="post" action={`/api/app/${slug}/member`} style={{ display: "inline", marginRight: 6 }}>
                          <input type="hidden" name="from" value="dash" maxLength={ADMIN_LIMITS.email} />
                          <input type="hidden" name="op" value="role" maxLength={ADMIN_LIMITS.email} />
                          <input type="hidden" name="email" value={m.email} maxLength={ADMIN_LIMITS.email} />
                          <input type="hidden" name="role" value={m.role === "editor" ? "viewer" : "editor"} maxLength={ADMIN_LIMITS.email} />
                          <button className="btn sm">{m.role === "editor" ? "Make viewer" : "Make editor"}</button>
                        </form>
                      ) : null}
                      {owner && m.role !== "owner" ? (
                        <form method="post" action={`/api/app/${slug}/member`} style={{ display: "inline" }}>
                          <input type="hidden" name="from" value="dash" maxLength={ADMIN_LIMITS.email} />
                          <input type="hidden" name="op" value="remove" maxLength={ADMIN_LIMITS.email} />
                          <input type="hidden" name="email" value={m.email} maxLength={ADMIN_LIMITS.email} />
                          <button className="btn sm" style={{ color: "var(--bad-fg)" }}>Remove</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {owner ? (
          <form method="post" action={`/api/app/${slug}/member`} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <input type="hidden" name="from" value="dash" maxLength={ADMIN_LIMITS.email} />
            <input type="hidden" name="op" value="invite" maxLength={ADMIN_LIMITS.email} />
            <input type="hidden" name="scope" value="client" maxLength={ADMIN_LIMITS.email} />
            <input className="field" type="email" name="email" required placeholder="name@company.com" aria-label="Email address to invite" maxLength={ADMIN_LIMITS.email} style={{ flex: "1 1 240px" }} autoFocus={!!why} />
            <select className="field" name="role" defaultValue="editor" aria-label="Role">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button className="btn primary">Invite</button>
          </form>
        ) : null}
      </div>
      <div className="dash-card" id="email">
        <h2>Email</h2>
        <p className="intro">We email the address you sign in with: a sign-in link when you ask for one, and service emails about this dashboard. The Monday summary, “This week”, is yours to switch off.</p>
        {emailWord ? <div className="banner" role="status" style={{ marginTop: 10 }}>{emailWord}</div> : null}
        {readOnly ? null : (
          <form method="post" action={`/api/dash/${slug}/email`} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
            <input type="hidden" name="this_week" value={weekOff ? "on" : "off"} maxLength={ADMIN_LIMITS.id} />
            <span>The Monday summary is <b>{weekOff ? "off" : "on"}</b> for {email}.</span>
            <button className="btn sm">{weekOff ? "Turn it on" : "Turn it off"}</button>
          </form>
        )}
      </div>
      <div className="dash-card" id="plan">
        <h2>Plan</h2>
        <p className="intro">This site is on <TierName tier={raw.client.tier} />. Billing, invoices, tracking packs and switching plan are on the Plan page.</p>
        <Link className="btn" href={`${base}/${slug}/plan`} style={{ marginTop: 10 }}>Open Plan</Link>
      </div>
    </>
  );
}
