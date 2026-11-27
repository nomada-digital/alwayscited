import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";
import { MARKETS, type Market } from "@/lib/scan/domain";
import { UK_PLACES, placeFrom, placeLabel, whereFor } from "@/lib/scan/locations";

/**
 * Where each keyword is read from, the agency side (27 Nov 2026, Danny). A client may have a default place (client_domains.search_location_*,
 * for a client local to one town) and any keyword may have its own override (tracked_keywords.location_*); a keyword that names a place
 * is read for it without either (scan/locations.ts). Every change is an agency_edits line. The next daily run reads with the new setting.
 */
const WAITING = "Keyword places switch on once 20261127040000_keyword_locations.sql is applied.";
const absent = (e: { code?: string; message?: string } | null) => !!e && (/search_location|location_code|location_name/.test(e.message ?? "") || e.code === "42703");
const UUID = /^[0-9a-f-]{36}$/;

const PLACES = [...new Map(Object.values(UK_PLACES).map((p) => [p.code, p])).values()].map((p) => ({ code: p.code, name: p.name, label: placeLabel(p.name) }));

export async function locationsRead(db: SupabaseClient, client: Client): Promise<Done> {
  const [{ data: c, error: cErr }, { data: ks, error: kErr }] = await Promise.all([
    db.from("client_domains").select("search_location_code, search_location_name").eq("id", client.id).maybeSingle(),
    db.from("tracked_keywords").select("id, keyword, location_code, location_name").eq("client_domain_id", client.id).is("stopped_on", null).order("keyword"),
  ]);
  if (absent(cErr) || absent(kErr)) return { ok: true, message: WAITING, data: { ready: false, places: PLACES, keywords: [] } };
  if (cErr) return { ok: false, message: `Could not read the client's place: ${cErr.message}` };
  if (kErr) return { ok: false, message: `Could not read the keywords: ${kErr.message}` };
  const market = client.market as Market;
  const dflt = placeFrom({ code: c?.search_location_code, name: c?.search_location_name });
  return {
    ok: true, message: `${(ks ?? []).length} keywords.`,
    data: {
      ready: true, places: PLACES, default: dflt ? { code: dflt.code, label: placeLabel(dflt.name) } : null,
      keywords: (ks ?? []).map((k) => {
        const w = whereFor({ keyword: k.keyword as string, market, countryCode: MARKETS[market].location_code, override: placeFrom({ code: k.location_code, name: k.location_name }), clientDefault: dflt });
        return { id: k.id, keyword: k.keyword, override: placeLabel(k.location_name as string | null), reads: placeLabel(w.name) ?? "the whole country", source: w.source };
      }),
    },
  };
}

/** Set (or clear, with no place) the client's default place. */
export async function clientLocationSet(db: SupabaseClient, client: Client, by: string, place: string): Promise<Done> {
  const p = place.trim() ? placeFrom({ name: place }) : null;
  if (place.trim() && !p) return { ok: false, message: "That is not a place we can read from. Pick one from the list." };
  const { error } = await db.from("client_domains").update({ search_location_code: p?.code ?? null, search_location_name: p?.name ?? null }).eq("id", client.id);
  if (absent(error)) return { ok: false, message: WAITING };
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(db, client.id, by, "client_location", null, null, { place: p?.name ?? null });
  return { ok: true, message: p ? `Keywords are now read from ${placeLabel(p.name)} unless they name another place. The next daily check uses it.` : "Back to reading the whole country." };
}

/** Set (or clear) one keyword's own place. */
export async function keywordLocationSet(db: SupabaseClient, client: Client, by: string, keywordId: string, place: string): Promise<Done> {
  if (!UUID.test(keywordId)) return { ok: false, message: "Which keyword?" };
  const p = place.trim() ? placeFrom({ name: place }) : null;
  if (place.trim() && !p) return { ok: false, message: "That is not a place we can read from. Pick one from the list." };
  const { data, error } = await db.from("tracked_keywords").update({ location_code: p?.code ?? null, location_name: p?.name ?? null }).eq("id", keywordId).eq("client_domain_id", client.id).select("keyword").maybeSingle();
  if (absent(error)) return { ok: false, message: WAITING };
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  if (!data) return { ok: false, message: "That keyword is not this customer's." };
  await audit(db, client.id, by, "keyword_location", keywordId, null, { keyword: data.keyword, place: p?.name ?? null });
  return { ok: true, message: p ? `"${data.keyword}" is read from ${placeLabel(p.name)}.` : `"${data.keyword}" is read as its words say.` };
}
