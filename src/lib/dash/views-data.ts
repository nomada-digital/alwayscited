import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";

import { dashFixturePath } from "./fixture";
import type { SovAnswer } from "./share";

/**
 * The reads behind the share-of-voice table and the Google rankings view (Danny, 15 Nov 2026). Both come from what
 * the daily run already stored: no model call, no paid read. Either failing draws its section empty, never a broken
 * page, and a fixture (the e2e build) reads nothing.
 */

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** 37 days of answers with their brands: the latest 7 days and the windows a week and a month before. */
export async function sovAnswers(clientId: string, today: string): Promise<SovAnswer[]> {
  if (dashFixturePath()) return [];
  const db = supabaseAdmin();
  try {
    return await selectAll<SovAnswer>((lo, hi) =>
      db.from("tracking_answers").select("run_date, question_id, engine, answered, named, brands").eq("client_domain_id", clientId).gte("run_date", addDays(today, -37)).lte("run_date", today).order("id").range(lo, hi),
    );
  } catch (err) {
    console.warn(`[dash] share of voice read failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export type RankRow = {
  keyword_id: string;
  run_date: string;
  position: number | null;
  url: string | null;
  top: { rank: number; domain: string; url: string | null }[] | null;
  aio_shown?: boolean | null;
  aio_sources?: string[] | null;
  bing_position?: number | null;
  bing_url?: string | null;
  bing_read?: boolean | null;
};

/** 14 days of keyword reads with their page of results, the AI Overview and Bing where 20261115010000 is applied. */
export async function rankRows(clientId: string, today: string): Promise<{ rows: RankRow[]; extras: boolean }> {
  if (dashFixturePath()) return { rows: [], extras: false };
  const db = supabaseAdmin();
  const read = (cols: string) =>
    selectAll<RankRow>((lo, hi) => db.from("tracking_serp").select(cols).eq("client_domain_id", clientId).gte("run_date", addDays(today, -14)).lte("run_date", today).order("id").range(lo, hi).returns<RankRow[]>());
  try {
    return { rows: await read("keyword_id, run_date, position, url, top, aio_shown, aio_sources, bing_position, bing_url, bing_read"), extras: true };
  } catch {
    try {
      return { rows: await read("keyword_id, run_date, position, url, top"), extras: false };
    } catch (err) {
      console.warn(`[dash] rankings read failed: ${err instanceof Error ? err.message : String(err)}`);
      return { rows: [], extras: false };
    }
  }
}
