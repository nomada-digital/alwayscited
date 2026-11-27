import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { placeholderTerms } from "@/lib/scan/anthropic";
import { readKeywordVolumes } from "@/lib/scan/dataforseo";
import type { Market } from "@/lib/scan/domain";
import { type Candidate, type PH, type Placeholders, brandTermsOf, derivePlaceholders, isHead, missingAudiences, pickHead, readPlaceholders } from "./placeholder";

/**
 * Find keywords' example text, per client (27 Nov 2026, Danny). Cached in client_domains.keyword_placeholders so it never flickers: a term
 * is worked out from the client's own keywords the first time it is wanted, kept, and only added to afterwards. A toggle state the client's own
 * keywords cannot fill (Common has no consumer-phrased keyword) is generated ONCE after the page has been sent: a cheap model proposes a few
 * searches from the site, DataForSEO's volume must be above zero, and the best is stored. If that fails the generic example stays, and the
 * next page view tries again. A database without the column behaves as before.
 */
type Ctx = { id: string; domain: string; brand: string | null; aliases: string[]; market: Market; topic: string | null; clusters: string[]; keywords: string[] };

const missingColumn = (e: { message?: string; code?: string } | null) => !!e && (/keyword_placeholders/.test(e.message ?? "") || e.code === "42703");

/** The stored object as it is, with the days a generation was last tried and found nothing (`_tried`), so a niche with no consumer searches is not asked about at every page view. */
async function readRaw(db: SupabaseClient, clientId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from("client_domains").select("keyword_placeholders").eq("id", clientId).maybeSingle();
  if (error) { if (!missingColumn(error)) console.warn(`[placeholder] could not read the cache: ${error.message}`); return null; }
  return (data?.keyword_placeholders && typeof data.keyword_placeholders === "object" ? data.keyword_placeholders : {}) as Record<string, unknown>;
}
export async function readCache(db: SupabaseClient, clientId: string): Promise<Placeholders | null> {
  const raw = await readRaw(db, clientId);
  return raw === null ? null : readPlaceholders(raw);
}
const RETRY_DAYS = 30;
const triedRecently = (raw: Record<string, unknown> | null, a: string, today: string) => {
  const d = ((raw?._tried ?? {}) as Record<string, string>)[a];
  return !!d && Date.parse(today) - Date.parse(d) < RETRY_DAYS * 86_400_000;
};

/** Merge new terms into what is stored, never replacing one already there. */
async function store(db: SupabaseClient, clientId: string, add: Placeholders, tried: string[] = []): Promise<Placeholders> {
  const raw = (await readRaw(db, clientId)) ?? {};
  const have = readPlaceholders(raw);
  const today = new Date().toISOString().slice(0, 10);
  const next = { ...add, ...have, ...(Object.keys(raw._tried ?? {}).length || tried.length ? { _tried: { ...((raw._tried ?? {}) as Record<string, string>), ...Object.fromEntries(tried.map((a) => [a, today])) } } : {}) };
  if (JSON.stringify(next) === JSON.stringify(raw)) return have;
  const { error } = await db.from("client_domains").update({ keyword_placeholders: next }).eq("id", clientId);
  if (error && !missingColumn(error)) console.warn(`[placeholder] could not store: ${error.message}`);
  return readPlaceholders(next);
}

/** What the page passes to the box: the cache, filled from the client's own keywords, with generation of the rest started afterwards. */
export async function placeholdersFor(db: SupabaseClient, ctx: Ctx, candidates: Candidate[]): Promise<Placeholders> {
  const cached = (await readCache(db, ctx.id)) ?? {};
  const brandTerms = brandTermsOf(ctx.brand, ctx.domain, ctx.aliases);
  let have = cached;
  if (missingAudiences(cached).length) {
    const derived = derivePlaceholders(candidates, { brandTerms, market: ctx.market });
    const add: Placeholders = {};
    for (const a of ["all", "b2b", "b2c"] as const) if (!cached[a] && derived[a]) add[a] = derived[a];
    if (Object.keys(add).length) have = await store(db, ctx.id, add);
    else have = cached;
  }
  const raw = await readRaw(db, ctx.id);
  const today = new Date().toISOString().slice(0, 10);
  const still = missingAudiences(have).filter((a) => !triedRecently(raw, a, today));
  if (still.length) after(() => generateMissing(db, ctx, still, brandTerms).catch((e: unknown) => console.warn(`[placeholder] generation failed for ${ctx.domain}: ${e instanceof Error ? e.message : e}`)));
  return have;
}

async function siteFacts(ctx: Ctx): Promise<string> {
  let head = "";
  try {
    const res = await fetch(`https://www.${ctx.domain.replace(/^www\./, "")}/`, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "alwayscited-example/1.0", accept: "text/html" }, cache: "no-store" });
    if (res.ok) {
      const html = (await res.text()).slice(0, 200_000);
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
      const desc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1] ?? "";
      head = `Title: ${title.replace(/\s+/g, " ").trim().slice(0, 160)}\nDescription: ${desc.replace(/\s+/g, " ").trim().slice(0, 300)}`;
    }
  } catch { /* the site is not needed to propose an example */ }
  return [head, ctx.topic ? `Topic: ${ctx.topic}` : "", ctx.clusters.length ? `Keyword groups: ${ctx.clusters.slice(0, 6).join(", ")}` : "", ctx.keywords.length ? `Tracked keywords: ${ctx.keywords.slice(0, 8).join(", ")}` : ""].filter(Boolean).join("\n");
}

async function generateMissing(db: SupabaseClient, ctx: Ctx, audiences: readonly ("all" | "b2b" | "b2c")[], brandTerms: readonly string[]): Promise<void> {
  const facts = await siteFacts(ctx);
  const add: Placeholders = {};
  for (const audience of audiences) {
    const proposed = (await placeholderTerms({ audience, domain: ctx.domain, market: ctx.market, facts }).catch(() => [])).filter(isHead);
    if (!proposed.length) continue;
    const vols = await readKeywordVolumes(proposed, ctx.market === "JM" ? "UK" : ctx.market).catch(() => null);
    if (!vols) continue;
    const cands: Candidate[] = proposed.map((k) => ({ keyword: k, volume: vols.volumes.get(k) ?? vols.volumes.get(k.toLowerCase()) ?? null }));
    // For a side, the term must read as that side (audienceFit); All just takes the best volume. Brand names and places are dropped by pickHead.
    const p = pickHead(cands, { audience, brandTerms, market: ctx.market });
    if (p) add[audience] = { ...p, source: "generated" } satisfies PH;
  }
  // What found nothing is not asked again for a month.
  await store(db, ctx.id, add, audiences.filter((a) => !add[a]));
}
