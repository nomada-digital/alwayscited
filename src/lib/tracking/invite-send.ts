import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { appUrl } from "@/lib/app-host";
import { invite as inviteEmail } from "@/lib/email/lifecycle";
import { lifecycleOn } from "@/lib/email/lifecycle-mail";
import { siteUrl } from "@/lib/scan/verify-email";
import { TIER_PLAIN, type TierKey } from "@/lib/tier-text";
import { type InviteRole, inviteMail } from "@/lib/tracking/team";

/**
 * The invite email's words once the member is written, for both doors that invite (10 Nov 2026): an owner on Settings
 * (the member route) and Nomada staff on the hub's customer page (agency/team.ts). One composition, so the two never
 * say different things; each caller sends it with invite-mail.ts sendInvite itself, so the spend census
 * (spenders.mts) still sees which files mail. `agency` is the account's upsell_mode read before the write: the branded invite (R159) names
 * alwayscited and the tier, so never in agency mode, and is off until its flag is on. `inviter` is who the mail says
 * added them.
 */
export async function inviteMessage(db: SupabaseClient, p: { inviter: string; role: InviteRole; tier: string; domain: string; agency: boolean; everyClient: number | null }): Promise<{ subject: string; text: string; html?: string }> {
  return !p.agency && (await lifecycleOn(db, "invite"))
    ? inviteEmail({ tier: (p.tier in TIER_PLAIN ? p.tier : "tracked") as TierKey, domain: p.domain, link: appUrl("/login", siteUrl()), inviter: p.inviter, role: p.role, everyClient: p.everyClient })
    : inviteMail({ inviter: p.inviter, domain: p.domain, role: p.role, agency: p.agency, everyClient: p.everyClient });
}
