import { NextResponse } from "next/server";

import { dashOrigin } from "@/lib/dash/host";
import { dashboardUrl, emailSettingsUrl, invite as inviteEmail } from "@/lib/email/lifecycle";
import { lifecycleOn } from "@/lib/email/lifecycle-mail";
import { engineNames } from "@/lib/email/merge-source";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TIER_PLAIN, type TierKey } from "@/lib/tier-text";
import { upsellMode } from "@/lib/tracking/ask";
import { trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureTeam } from "@/lib/tracking/fixture-writes";
import { sendInvite } from "@/lib/tracking/invite-mail";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";
import { writeFixture } from "@/lib/tracking/repo";
import { readKept } from "@/lib/tracking/stop";
import { type TeamDone, type TeamWhy, changeRole, invite, inviteMail, invitesToday, planTeam, readTeam, readTeamForm, refuseActor, removeMember, teamReturn, teamWhy } from "@/lib/tracking/team";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Invite, change a role, remove - R142 part 2 (1 Oct 2026; BRIEF-4 P2 Team).
 * Posted by plain HTML forms on Settings, so it works with JS off; the answer
 * is a 303 back to the page with the toast in the URL. Session and membership
 * as the stop route; owners only. The rules are team.ts; the invite mail is
 * invite-mail.ts. The fixture is read-only unless TRACKING_FIXTURE_WRITE=1
 * (R168), which holds the change in memory; on the fixture nothing is sent.
 *
 * AG-1 (9 Oct 2026): every rule runs on the members who see this client, and
 * the invite is to this client only or to every client on the account
 * (scope.ts). The rules are team.ts planTeam, which this route and the
 * fixture both call with the account's whole live team; the route reads and
 * writes, and decides nothing itself (team.test.mts pins it).
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const f = form ? readTeamForm((k) => form.get(k)) : null;
  // DS40: the form's action carries the page's stated range; only from, to and compare come back.
  const sp = new URL(req.url).searchParams;
  const kept = readKept((k) => sp.get(k), 0);
  const back = (done: TeamDone, why: TeamWhy | null = null) => NextResponse.redirect(dashUrl(req, teamReturn(slug, done, f?.email ?? null, kept, why)), 303);
  // R151 (3 Oct 2026): an invite whose address fails the shape check says so on its field.
  if (!f) return back("refused", form?.get("op") === "invite" ? "email" : null);
  if (fixtureMode()) {
    // R168: invite, role and remove held in memory on the writable fixture; sendInvite is never reached here.
    const r = writeFixture((fx) => fixtureTeam(fx, { op: f.op, email: f.email, role: f.role, scope: f.scope, slug, now: new Date().toISOString() }));
    if (r && !r.ok) console.warn(`[app] fixture team ${f.op} refused: ${r.message}`);
    return r?.ok ? back(f.op === "invite" ? "invited" : f.op === "role" ? "role" : "removed") : back("refused", r ? teamWhy(r.message) : null);
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const refused = (why: string) => {
    console.warn(`[app] team ${f.op} refused: ${why}`);
    // A rule's refusal carries its code; a failed read or write does not, and reads "Reload the page".
    return back("refused", teamWhy(why));
  };
  const actor = refuseActor(client.role);
  if (actor) return refused(actor);

  const db = supabaseAdmin();
  // The account is read here, server-side only; clientsFor keeps account_id out of what pages get.
  const { data: row, error: rowErr } = await db.from("client_domains").select("account_id, brand_name").eq("id", client.id).maybeSingle();
  if (rowErr || !row) return refused(`could not read the client's account: ${rowErr?.message ?? "none"}`);
  const accountId = row.account_id as string;
  const team = await readTeam(db, accountId);
  if (typeof team === "string") return refused(team);
  // AG-1: the clients /app can show on this account - how many decides whether the invite asks, and an invite to every client is counted on each.
  const { data: ids, error: nErr } = await db.from("client_domains").select("id").eq("account_id", accountId).not("slug", "is", null);
  if (nErr || !ids) return refused(`could not read the account's clients: ${nErr?.message ?? "none"}`);
  const clientIds = ids.map((c) => c.id as string);
  // The daily cap is counted for an invite only.
  const n = f.op === "invite" ? await invitesToday(db, { email, today: trackingDay() }) : 0;
  if (typeof n === "string") return refused(n);
  const plan = planTeam({ form: f, actor: email, rows: team.rows, scoping: team.scoping, clientId: client.id, clientIds, invitesToday: n });
  if (typeof plan === "string") return refused(plan);

  if (plan.op === "invite") {
    // Read before the write: agency mode must be known, or the mail could name a nomada tier.
    const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode, agency_name").eq("id", accountId).maybeSingle();
    if (aErr || !account) return refused(`could not read the account: ${aErr?.message ?? "none"}`);
    const r = await invite(db, { accountId, clientId: client.id, email: f.email, role: plan.role, by: email, scope: plan.scope, elsewhere: plan.elsewhere });
    if (!r.ok) return refused(r.message);
    const agency = upsellMode(account.upsell_mode) === "agency";
    // The mail says when they will see every client; an invite to one client names that client only.
    const everyClient = plan.scope === "account" && clientIds.length > 1 ? clientIds.length : null;
    // The designed invite (#8, brief 2e, 18 Oct 2026), off until its flag is on. Client-facing in every mode: no tier,
    // no upsell, no nomada digital line; in agency mode the agency's name (accounts.agency_name) under the wordmark.
    // Until 18 Oct 2026 the branded invite named the tier and so was never sent in agency mode.
    const tier = (client.tier in TIER_PLAIN ? client.tier : "tracked") as TierKey;
    const origin = dashOrigin();
    const agencyName = agency && typeof account.agency_name === "string" ? account.agency_name : null;
    const brand = typeof row.brand_name === "string" ? row.brand_name : null;
    const mail = (await lifecycleOn(db, "invite"))
      ? inviteEmail({ domain: client.domain, brand, link: dashboardUrl(slug, origin), inviter: email, role: f.role!, everyClient, agency: agencyName, engines: engineNames(tier), settings: emailSettingsUrl(slug, origin) })
      : inviteMail({ inviter: email, domain: client.domain, role: f.role!, agency, everyClient });
    if (!(await sendInvite({ to: f.email, replyTo: email, ...mail }))) console.warn("[app] invite saved but the mail was not sent");
    return back("invited");
  }

  const r =
    plan.op === "role"
      ? await changeRole(db, { accountId, email: f.email, role: plan.role })
      : await removeMember(db, { accountId, email: f.email, by: email, clientId: client.id, row: plan.row });
  if (!r.ok) return refused(r.message);
  return back(f.op === "role" ? "role" : "removed");
}
