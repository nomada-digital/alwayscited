import type { Market } from "./domain.ts";

/**
 * Where a keyword is read from (27 Nov 2026, Danny: Common's "craft cms agency york" must be read as a searcher in York, not UK-wide).
 *
 * Google answers a place-named search with that place's results, so a keyword that names a town or county is read for that place:
 * the DataForSEO city location, not the country. Everything else stays UK-wide on google.co.uk, desktop, English (Danny, 15 Nov 2026).
 * The order of precedence, first that applies:
 *   1. the keyword's own override (tracked_keywords.location_code, set by staff);
 *   2. a place the keyword names (york, leeds, ...);
 *   3. the client's default place (client_domains.search_location_code), for a client that is local to one;
 *   4. the market's country.
 * Pure module: no imports of server code, so node --test loads it. Codes are DataForSEO's own, from /v3/serp/google/locations/gb.
 */
export type Place = { code: number; name: string };
export type Where = { code: number; name: string | null; source: "keyword" | "place" | "client" | "market" };

const gb = (code: number, name: string): Place => ({ code, name: `${name},England,United Kingdom` });
const sc = (code: number, name: string): Place => ({ code, name: `${name},Scotland,United Kingdom` });

/** Place words a UK keyword may name, longest first so "north yorkshire" is read before "york". Yorkshire is read from York. */
export const UK_PLACES: Record<string, Place> = {
  "york": gb(1007266, "York"),
  "yorkshire": gb(1007266, "York"),
  "north yorkshire": gb(1007266, "York"),
  "west yorkshire": gb(1006864, "Leeds,West Yorkshire"),
  "south yorkshire": gb(1007064, "Sheffield,South Yorkshire"),
  "leeds": gb(1006864, "Leeds,West Yorkshire"),
  "sheffield": gb(1007064, "Sheffield,South Yorkshire"),
  "harrogate": gb(1006766, "Harrogate"),
  "bradford": gb(1006553, "Bradford,Bradford"),
  "wakefield": gb(1007188, "Wakefield,Wakefield"),
  "manchester": gb(1006912, "Manchester,Manchester"),
  "liverpool": gb(1006884, "Liverpool"),
  "london": gb(1006886, "London"),
  "birmingham": gb(1006524, "Birmingham,West Midlands"),
  "bristol": gb(1006567, "Bristol"),
  "brighton": gb(1006565, "Brighton"),
  "cambridge": gb(1006598, "Cambridge,Cambridge"),
  "oxford": gb(1006976, "Oxford,Oxford"),
  "norwich": gb(1006964, "Norwich,Norwich"),
  "nottingham": gb(1006965, "Nottingham,Nottingham"),
  "leicester": gb(1006867, "Leicester,Leicester"),
  "newcastle": gb(1006948, "Newcastle upon Tyne,Newcastle upon Tyne"),
  "edinburgh": sc(1007326, "Edinburgh"),
  "glasgow": sc(1007336, "Glasgow"),
  "cardiff": { code: 1007416, name: "Cardiff,Wales,United Kingdom" },
  "belfast": { code: 1007274, name: "Belfast,Northern Ireland,United Kingdom" },
};

const KEYS = Object.keys(UK_PLACES).sort((a, b) => b.length - a.length);

/** The place a UK keyword names, or null. "new york" is not York; a place must be a whole word. */
export function placeIn(keyword: string, market: Market): { word: string; place: Place } | null {
  if (market !== "UK") return null;
  const k = ` ${keyword.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const w of KEYS) {
    const i = k.indexOf(` ${w} `);
    if (i < 0) continue;
    if (w === "york" && k.slice(Math.max(0, i - 4), i + 1).trim().endsWith("new")) continue;
    return { word: w, place: UK_PLACES[w]! };
  }
  return null;
}

export type LocationInputs = { keyword: string; market: Market; countryCode: number; override?: Place | null; clientDefault?: Place | null };

/** Which DataForSEO location this keyword is read from, and why. */
export function whereFor(i: LocationInputs): Where {
  if (i.override) return { code: i.override.code, name: i.override.name, source: "keyword" };
  const named = placeIn(i.keyword, i.market);
  if (named) return { code: named.place.code, name: named.place.name, source: "place" };
  if (i.clientDefault) return { code: i.clientDefault.code, name: i.clientDefault.name, source: "client" };
  return { code: i.countryCode, name: null, source: "market" };
}

/** "York" for "York,England,United Kingdom": what the dashboard says a keyword was read for. Null for the country. */
export function placeLabel(name: string | null | undefined): string | null {
  const n = (name ?? "").split(",")[0]?.trim();
  return n || null;
}

export const KNOWN_PLACE_NAMES = [...new Set(Object.values(UK_PLACES).map((p) => p.name))];
/** A place from its stored name or code (agency setting), or null when it is not one we know. */
export function placeFrom(v: { code?: unknown; name?: unknown }): Place | null {
  const all = Object.values(UK_PLACES);
  const byCode = typeof v.code === "number" || /^\d+$/.test(String(v.code ?? "")) ? all.find((p) => p.code === Number(v.code)) : undefined;
  const byName = typeof v.name === "string" ? all.find((p) => p.name.toLowerCase() === v.name!.toString().toLowerCase() || p.name.split(",")[0]!.toLowerCase() === v.name!.toString().trim().toLowerCase()) : undefined;
  return byCode ?? byName ?? null;
}
