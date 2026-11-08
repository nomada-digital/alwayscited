import "server-only";

import { classifyBrands } from "@/lib/scan/anthropic";
import { brandKey, namesAsBrand } from "@/lib/scan/brand-name";
import { judgedTopic, notACompetitor } from "@/lib/scan/competitor-filter";
import { type Engine } from "@/lib/scan/engines";

/**
 * Which competitors each answer is credited with, from the names extracted per engine - moved out of runner.ts on
 * 8 Nov 2026 so the daily run and the Message Batch collector (brand-batches.ts) credit answers the same way.
 *
 * 5 Nov 2026 (Luke, COMMON): the names an answer is credited with are competitors it names AS brands. Three
 * filters, cheapest first: the keyword's own subject and, for a service, the platforms (competitor-filter.ts);
 * then one judgement over the day's names, as the free scan makes - could a buyer choose this INSTEAD of the
 * client? - which catches a platform's maker and the tools no list holds. A judgement that fails leaves the
 * first filter standing rather than every name. Then each answer is credited only with the names it uses as
 * brands (namesAsBrand), not every answer containing the word: one answer naming the agency Engage had put
 * "Engage" on every answer with the verb in it.
 */
export async function creditCompetitors(
  others: Map<Engine, string[]>,
  p: { terms: (string | null)[]; brand: string; runId: string; billed: { calls: number } },
): Promise<(a: { engine: Engine; response_text: string | null }) => string[]> {
  const candidates = [...new Set([...others.values()].flat())].filter((n) => !notACompetitor(n, p.terms));
  let suppliers: Set<string> | null = null;
  if (candidates.length) {
    try {
      const judged = await classifyBrands({ topic: judgedTopic(p.terms), brand: p.brand, positioning: null, names: candidates });
      p.billed.calls += judged.calls;
      if (!judged.failedBatches) suppliers = new Set(judged.brands.filter((b) => b.supplier).map((b) => brandKey(b.name)));
      else console.warn(`[track] ${p.runId} competitor judgement: ${judged.failedBatches} batch(es) failed, so only the lists filter today`);
    } catch (err) {
      console.warn(`[track] ${p.runId} competitor judgement failed, so only the lists filter today: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const kept = new Map<Engine, string[]>();
  for (const [engine, names] of others) {
    kept.set(engine, names.filter((n) => !notACompetitor(n, p.terms) && (!suppliers || suppliers.has(brandKey(n)))));
  }
  return (a) => (a.response_text ? (kept.get(a.engine) ?? []).filter((n) => namesAsBrand(a.response_text!, n)) : []);
}
