import "server-only";

import { hashToken } from "@/lib/tracking/session";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { isOfferToken, OFFER_COLUMNS, type ContractOffer } from "@/lib/checkout/contract-offer";

/** The offer a link's token names, by the hash of the token (contract-offer.ts). Null for a malformed or unknown token. */
export async function readContractOffer(token: string): Promise<ContractOffer | null> {
  if (!isOfferToken(token) || !supabaseConfigured()) return null;
  const { data, error } = await supabaseAdmin().from("contract_offers").select(OFFER_COLUMNS).eq("token_hash", hashToken(token)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ContractOffer | null) ?? null;
}
