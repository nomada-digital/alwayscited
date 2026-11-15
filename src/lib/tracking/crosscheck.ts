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
 * migration (Danny, 15 Nov 2026: Volunteero still showed "-") the two readings are recorded as an agency_edits line,
 * action CROSSCHECK_ACTION, target "<run date>|<keyword id>" - a position is never replaced without a record of what
 * it replaced - and the dashboard reads its note from there. Never throws.
 */
export const CROSSCHECK_ACTION = "rank_crosscheck";
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

    let columns = true;
    type Checked = Row & { check_on?: string | null; read_position?: number | null; check_position?: number | null };
    const read = (cols: string) => db.from("tracking_serp").select(cols).eq("run_id", runId).returns<Checked[]>();
    let { data: rows, error: rErr } = await read("keyword_id, position, url, run_date, check_on, read_position, check_position");
    if (rErr && missingColumn(rErr, "check_on")) {
      columns = false;
      ({ data: rows, error: rErr } = await read("keyword_id, position, url, run_date"));
    }
    if (rErr) return `could not read the run: ${rErr.message}`;
    const logged = new Map<string, number | null>();
    if (!columns) {
      const { data: lines, error: lErr } = await db.from("agency_edits").select("target, new_value").eq("client_domain_id", run.client_domain_id).eq("action", CROSSCHECK_ACTION).like("target", `${run.run_date}|%`).order("created_at");
      if (lErr) return `could not read the earlier cross-checks: ${lErr.message}`;
      for (const l of lines ?? []) logged.set(l.target as string, ((l.new_value as { position?: number | null } | null)?.position ?? null));
    }
    // Checked already, unless a re-run of the day has since written a new reading over the checked one.
    const stands = (r: Checked) => {
      const k = `${r.run_date}|${r.keyword_id}`;
      if (!columns) return logged.has(k) && logged.get(k) === r.position;
      return !!r.check_on && (r.position === r.read_position || r.position === r.check_position) && !(r.position === null && r.check_position != null);
    };
    const fresh = (rows ?? []).filter((r) => !stands(r));
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
      const check = { read_position: r.position, check_position: ahrefs?.rank ?? null, check_source: "ahrefs", check_on: today, check_varies: out.varies };
      const { error: uErr } = await db
        .from("tracking_serp")
        .update({ position: out.position, url: out.url, ...(columns ? check : {}) })
        .eq("run_id", runId)
        .eq("keyword_id", r.keyword_id);
      if (uErr) return `could not store the second reading: ${uErr.message}`;
      if (!columns) {
        const { error: aErr } = await db.from("agency_edits").insert({ client_domain_id: run.client_domain_id, actor_email: "crosscheck@alwayscited", action: CROSSCHECK_ACTION, target: `${r.run_date}|${r.keyword_id}`, old_value: { position: r.position, url: r.url, source: "dataforseo" }, new_value: { position: out.position, url: out.url, ...check } });
        if (aErr) console.error(`[crosscheck] ${runId} reading replaced but not recorded: ${aErr.message}`);
      }
      if (out.position !== r.position) changed++;
    }
    return `checked ${due.length} on Ahrefs (${body.units?.total ?? "?"} units), ${changed} reading${changed === 1 ? "" : "s"} replaced`;
  } catch (err) {
    return `cross-check failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
