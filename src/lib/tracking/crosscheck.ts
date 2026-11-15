import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { HUB_SUGGEST } from "@/lib/dash/suggest";

import { missingColumn } from "./decide.ts";
import { ahrefsRank, decideCheck, needsCheck } from "./crosscheck-decide.ts";

/**
 * The Ahrefs cross-check of a run's keyword reads (crosscheck-decide.ts has the rules). It runs after the runner
 * stores the day's positions, and from the agency action `crosscheck` to run it now. Only the reads that need it go
 * to Ahrefs, at most AHREFS_MAX a run (about 100 Ahrefs units a keyword), through the hub's ahrefs-serp edge function,
 * which holds the Ahrefs key and takes this project's service key as x-ac-key.
 *
 * A changed reading replaces tracking_serp's position and url, so every page and email that reads positions shows it;
 * DataForSEO's own reading stays in read_position, Ahrefs' in check_position (20261115000000's columns). Before that
 * migration nothing is written: a position is never replaced without a record of what it replaced. Never throws.
 */
const AHREFS_SERP = HUB_SUGGEST.replace(/ac-suggest$/, "ahrefs-serp");
const AHREFS_MAX = 25;
const COUNTRY: Record<string, string> = { UK: "gb", US: "us" };

type Row = { keyword_id: string; position: number | null; url: string | null; run_date: string };

export async function crossCheckRun(db: SupabaseClient, runId: string): Promise<string> {
  try {
    const { data: run, error } = await db.from("tracking_runs").select("client_domain_id, run_date").eq("id", runId).maybeSingle();
    if (error || !run) return `no run: ${error?.message ?? runId}`;
    const { data: client, error: cErr } = await db.from("client_domains").select("domain, market").eq("id", run.client_domain_id).maybeSingle();
    if (cErr || !client) return `no client: ${cErr?.message ?? ""}`;
    const country = COUNTRY[client.market as string];
    if (!country) return `no Ahrefs country for ${client.market}`;

    const { data: rows, error: rErr } = await db.from("tracking_serp").select("keyword_id, position, url, run_date, check_on").eq("run_id", runId);
    if (rErr) return missingColumn(rErr, "check_on") ? "tracking_serp has no check columns yet" : `could not read the run: ${rErr.message}`;
    const fresh = ((rows ?? []) as (Row & { check_on: string | null })[]).filter((r) => !r.check_on);
    if (!fresh.length) return "nothing to check";

    const { data: before, error: bErr } = await db
      .from("tracking_serp")
      .select("keyword_id, position, run_date")
      .eq("client_domain_id", run.client_domain_id)
      .in("keyword_id", fresh.map((r) => r.keyword_id))
      .lt("run_date", run.run_date)
      .gte("run_date", new Date(Date.parse(`${run.run_date}T12:00:00Z`) - 21 * 864e5).toISOString().slice(0, 10))
      .order("run_date", { ascending: false });
    if (bErr) return `could not read the earlier positions: ${bErr.message}`;
    const previous = new Map<string, number | null>();
    for (const b of before ?? []) if (!previous.has(b.keyword_id as string)) previous.set(b.keyword_id as string, b.position as number | null);

    const due = fresh.filter((r) => needsCheck(r.position, previous.get(r.keyword_id))).slice(0, AHREFS_MAX);
    if (!due.length) return "no keyword needs a second reading";
    const { data: ks, error: kErr } = await db.from("tracked_keywords").select("id, keyword").eq("client_domain_id", run.client_domain_id).in("id", due.map((r) => r.keyword_id));
    if (kErr) return `could not read the keywords: ${kErr.message}`;
    const text = new Map((ks ?? []).map((k) => [k.id as string, k.keyword as string]));

    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const res = await fetch(AHREFS_SERP, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ac-key": key },
      body: JSON.stringify({ keywords: due.map((r) => text.get(r.keyword_id)).filter(Boolean), country, top: 100 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return `ahrefs-serp answered ${res.status}`;
    const body = (await res.json()) as { results?: { keyword: string; ok: boolean; positions?: { position: number | null; url: string | null; type: unknown }[] }[]; units?: { total?: number } };
    const byKeyword = new Map((body.results ?? []).filter((r) => r.ok).map((r) => [r.keyword, r.positions ?? []]));

    const today = new Date().toISOString().slice(0, 10);
    let changed = 0;
    for (const r of due) {
      const positions = byKeyword.get(text.get(r.keyword_id) ?? "");
      if (!positions) continue;
      const ahrefs = ahrefsRank(positions, client.domain as string);
      const out = decideCheck(r, previous.get(r.keyword_id), ahrefs);
      const { error: uErr } = await db
        .from("tracking_serp")
        .update({ position: out.position, url: out.url, read_position: r.position, check_position: ahrefs?.rank ?? null, check_source: "ahrefs", check_on: today, check_varies: out.varies })
        .eq("run_id", runId)
        .eq("keyword_id", r.keyword_id);
      if (uErr) return `could not store the second reading: ${uErr.message}`;
      if (out.position !== r.position) changed++;
    }
    return `checked ${due.length} on Ahrefs (${body.units?.total ?? "?"} units), ${changed} reading${changed === 1 ? "" : "s"} replaced`;
  } catch (err) {
    return `cross-check failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
