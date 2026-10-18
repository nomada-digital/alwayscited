import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { enginesFor } from "@/config/pricing";
import { loadRaw } from "@/lib/dash/load";
import type { TierKey } from "@/lib/dash/types";
import { ENGINE_LABEL, type Forms, type KeywordForm, type MergeInput } from "@/lib/email/merge";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsellMode } from "@/lib/tracking/ask";
import { trackingDay } from "@/lib/tracking/decide";

/**
 * One client's merge data for the customer emails (brief item 2e, 18 Oct
 * 2026), read through the dashboards host's own loader (dash/load.ts
 * loadRaw), so every figure a mail shows is the one the dashboard shows.
 * merge.ts turns it into each email's figures; this only reads.
 *
 * Never throws: a mail whose merge read failed is sent without the blocks
 * that needed it (each is hidden when it has no data), and the failure is
 * logged. The keyword forms (tracked_keywords.form, pair_of) are read apart
 * and tolerated absent, before 20261018030000 is applied anywhere.
 */
export type ClientMail = MergeInput & {
  accountId: string;
  slug: string;
  domain: string;
  brand: string;
  tier: TierKey;
  market: string;
};

const TIERS: readonly TierKey[] = ["tracked", "mentioned", "cited", "everywhere"];

async function readForms(db: SupabaseClient, clientId: string): Promise<Forms> {
  const { data, error } = await db.from("tracked_keywords").select("id, form, pair_of").eq("client_domain_id", clientId);
  if (error) {
    // The column is not there before 20261018030000: every keyword reads as a primary with no pair.
    if (!/form|pair_of/.test(error.message)) console.warn(`[mail] keyword forms for ${clientId} not read: ${error.message}`);
    return new Map();
  }
  const out = new Map<string, { form: KeywordForm | null; pair_of: string | null }>();
  for (const r of data ?? []) {
    const f = r.form === "primary" || r.form === "plural" || r.form === "singular" ? (r.form as KeywordForm) : null;
    out.set(String(r.id), { form: f, pair_of: typeof r.pair_of === "string" ? r.pair_of : null });
  }
  return out;
}

export async function clientMail(clientId: string, db: SupabaseClient = supabaseAdmin()): Promise<ClientMail | null> {
  try {
    const { data: c, error } = await db
      .from("client_domains")
      .select("id, account_id, slug, domain, brand_name, market, tier, started_on, cluster_limit, trial_ends_at, status")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !c) throw new Error(error?.message ?? "no client");
    const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode, agency_name").eq("id", c.account_id).maybeSingle();
    if (aErr) throw new Error(`account: ${aErr.message}`);
    const tier = (TIERS.includes(c.tier as TierKey) ? c.tier : "tracked") as TierKey;
    const raw = await loadRaw(
      {
        id: c.id as string,
        slug: c.slug as string,
        domain: c.domain as string,
        brand: (c.brand_name as string | null) ?? null,
        market: (c.market as string | null) ?? "US",
        tier,
        started_on: (c.started_on as string | null) ?? null,
        cluster_limit: (c.cluster_limit as number | null) ?? 10,
        trial_ends_at: (c.trial_ends_at as string | null) ?? null,
        status: (c.status as string | null) ?? "active",
      },
      "owner",
      trackingDay(),
      db,
    );
    return {
      raw,
      forms: await readForms(db, clientId),
      mode: upsellMode(account?.upsell_mode),
      agency: typeof account?.agency_name === "string" && account.agency_name.trim() ? account.agency_name.trim() : null,
      accountId: c.account_id as string,
      slug: c.slug as string,
      domain: c.domain as string,
      brand: ((c.brand_name as string | null) ?? "").trim() || (c.domain as string),
      tier,
      market: (c.market as string | null) ?? "US",
      engines: enginesFor(tier).map((e) => ENGINE_LABEL[e]),
    };
  } catch (err) {
    console.warn(`[mail] merge data for ${clientId} not read: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The engines a tier reads, by name, for an email sent before any client row is read (the welcome). */
export function engineNames(tier: TierKey): string[] {
  return enginesFor(tier).map((e) => ENGINE_LABEL[e]);
}
