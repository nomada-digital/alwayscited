import "server-only";

import { hashToken } from "@/lib/tracking/session";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { missingColumn } from "@/lib/tracking/limits";
import { isOfferToken, OFFER_COLUMNS, type ContractOffer } from "@/lib/checkout/contract-offer";

/**
 * The offer a link's token names, by the hash of the token (contract-offer.ts). Null for a malformed or unknown token.
 * Before 20261102120000 there is no keyword_locked column, and before 20261102130000 no scope_note: the row is read
 * without the missing one, as an open keyword or no note.
 */
export async function readContractOffer(token: string): Promise<ContractOffer | null> {
  if (!isOfferToken(token) || !supabaseConfigured()) return null;
  const read = (cols: string) => supabaseAdmin().from("contract_offers").select(cols).eq("token_hash", hashToken(token)).maybeSingle();
  let { data, error } = await read(OFFER_COLUMNS);
  if (missingColumn(error)) ({ data, error } = await read(OFFER_COLUMNS.replace(", scope_note", "")));
  if (missingColumn(error)) ({ data, error } = await read(OFFER_COLUMNS.replace(", scope_note", "").replace(", keyword_locked", "")));
  if (error) throw new Error(error.message);
  return data ? ({ keyword_locked: false, scope_note: null, ...(data as object) } as ContractOffer) : null;
}
