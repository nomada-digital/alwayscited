import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { dashFixturePath, fixtureRaw } from "./fixture";
import { isSampleClient } from "./host";
import { sampleAnswerText, sampleRaw, sampleTheme } from "./sample-world";
import { trackingDay } from "@/lib/tracking/decide";
import type { Citation, Day, Engine } from "./types";

/**
 * The click-through reads (17 Oct 2026): one prompt's every reading, one
 * day's answer words, one keyword's every Google reading with its top 20, and
 * the answers citing one site over a range. Each is scoped to the client, and
 * each is read only when its page is opened - the answer words are the
 * heaviest column in the database and no other page asks for them.
 */

const PAGE = 1000;

async function paged<T>(make: () => { range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw new Error(`could not read ${what}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export type Reading = { run_date: Day; engine: Engine; answered: boolean; named: boolean; brands: string[] | null; citations: Citation[] | null };
export type AnswerWords = Reading & { response_text: string | null };

/** Every reading of one prompt since tracking began, oldest first, without the words. */
export async function promptReadings(clientId: string, promptId: string, db: SupabaseClient | null = null): Promise<Reading[]> {
  if (isSampleClient(clientId)) return sampleRaw(trackingDay()).answers.filter((a) => a.question_id === promptId).map((a) => ({ ...a, brands: a.brands ?? null, citations: a.citations ?? null }));
  if (dashFixturePath()) return fixtureRaw().answers.filter((a) => a.question_id === promptId).map((a) => ({ ...a, brands: a.brands ?? null, citations: a.citations ?? null }));
  const d = db ?? supabaseAdmin();
  return paged<Reading>(() => d.from("tracking_answers").select("run_date, engine, answered, named, brands, citations").eq("client_domain_id", clientId).eq("question_id", promptId).order("run_date").order("engine"), "the prompt's readings");
}

/** One day's answers to one prompt, with their words. */
export async function answerWords(clientId: string, promptId: string, day: Day, db: SupabaseClient | null = null): Promise<AnswerWords[]> {
  if (isSampleClient(clientId)) {
    return sampleRaw(trackingDay()).answers
      .filter((a) => a.question_id === promptId && a.run_date === day)
      .map((a) => ({ ...a, brands: a.brands ?? null, citations: a.citations ?? null, response_text: a.answered ? sampleAnswerText(sampleTheme(promptId), a.brands ?? []) : null }));
  }
  if (dashFixturePath()) return fixtureRaw().answers.filter((a) => a.question_id === promptId && a.run_date === day).map((a) => ({ ...a, brands: a.brands ?? null, citations: a.citations ?? null, response_text: null }));
  const { data, error } = await (db ?? supabaseAdmin())
    .from("tracking_answers")
    .select("run_date, engine, answered, named, brands, citations, response_text")
    .eq("client_domain_id", clientId)
    .eq("question_id", promptId)
    .eq("run_date", day);
  if (error) throw new Error(`could not read the answers: ${error.message}`);
  return (data ?? []) as AnswerWords[];
}

export type SerpDay = { run_date: Day; position: number | null; url: string | null; top: { url: string; rank: number; domain: string }[] | null };

/** Every Google reading of one tracked keyword, oldest first, with the top 20 where it was stored (from 13 Oct 2026). */
export async function keywordReadings(clientId: string, keywordId: string, db: SupabaseClient | null = null): Promise<SerpDay[]> {
  if (isSampleClient(clientId)) return sampleRaw(trackingDay()).serp.filter((s) => s.keyword_id === keywordId).map((s) => ({ ...s, top: null }));
  if (dashFixturePath()) return fixtureRaw().serp.filter((s) => s.keyword_id === keywordId).map((s) => ({ ...s, top: (s as { top?: SerpDay["top"] }).top ?? null }));
  const d = db ?? supabaseAdmin();
  return paged<SerpDay>(() => d.from("tracking_serp").select("run_date, position, url, top").eq("client_domain_id", clientId).eq("keyword_id", keywordId).order("run_date"), "the keyword's positions");
}

export type CitingAnswer = { run_date: Day; question_id: string; engine: Engine; named: boolean; citations: Citation[] | null };

/** Answers from `from` on whose citations include anything, for a sources range; the caller filters by site. */
export async function citingAnswers(clientId: string, from: Day, db: SupabaseClient | null = null): Promise<CitingAnswer[]> {
  if (isSampleClient(clientId)) return sampleRaw(trackingDay()).answers.filter((a) => a.run_date >= from && (a.citations ?? []).length).map((a) => ({ run_date: a.run_date, question_id: a.question_id, engine: a.engine, named: a.named, citations: a.citations ?? null }));
  if (dashFixturePath()) return fixtureRaw().answers.filter((a) => a.run_date >= from && (a.citations ?? []).length).map((a) => ({ run_date: a.run_date, question_id: a.question_id, engine: a.engine, named: a.named, citations: a.citations ?? null }));
  const d = db ?? supabaseAdmin();
  return paged<CitingAnswer>(() => d.from("tracking_answers").select("run_date, question_id, engine, named, citations").eq("client_domain_id", clientId).gte("run_date", from).neq("citations", "[]").order("run_date").order("id"), "the cited answers");
}
