import { T } from "@/config/tokens";
import { PROMPT_TIER_LABEL, WIN_ENGINES, WIN_READINGS, readBroaden } from "@/lib/tracking/prompt-tiers";
import type { SupabaseClient } from "@supabase/supabase-js";

const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);

/**
 * Ready to broaden (Danny, 18 Nov 2026; nomada-daily docs/handbook/prompt-expansion-playbook.md), under the plan
 * signals on /admin/tracking: each customer whose highest live prompt tier is won, with the evidence and the free
 * slots in its prompt pool. Read from prompt_broaden(), as the hub's customer view and Kev's My week are.
 */
export default async function BroadenSignals({ db }: { db: SupabaseClient }) {
  const all = await readBroaden(db, null);
  const ready = typeof all === "string" ? [] : all.filter((b) => b.ready);
  return (
    <section id="broaden" style={{ border: `1px solid ${T.line}`, borderRadius: "10px", padding: "16px", marginBottom: "24px" }}>
      <h2 style={{ fontSize: "16px", margin: "0 0 4px" }}>Ready to broaden</h2>
      <p style={{ color: T.soft, margin: "0 0 10px", fontSize: "13px" }}>
        A tier is won when the brand is named in at least half its answers, with at least {WIN_ENGINES} engines doing so, on its last {WIN_READINGS} readings. Keep the won prompts running and add the next tier from the free slots.
      </p>
      {typeof all === "string" ? (
        <p style={{ margin: 0, fontSize: "13px" }}>{all}</p>
      ) : ready.length ? (
        ready.map((b) => {
          const won = b.tiers.find((t) => t.tier === b.top_tier);
          return (
            <div key={b.slug} style={{ marginBottom: "12px", fontSize: "13px" }}>
              <b>{b.domain}</b>: tier {b.top_tier} ({b.top_tier ? PROMPT_TIER_LABEL[b.top_tier] : ""}) won; next is tier {b.next_tier} ({b.next_tier ? PROMPT_TIER_LABEL[b.next_tier] : ""}). {b.pool.free} of {b.pool.size} prompt slots free.
              {won ? (
                <div style={{ color: T.soft }}>
                  {won.by_reading.map((r) => `${r.run_date}: ${pct(r.share)} of ${r.answers} answers, ${r.engines.filter((e) => e.share >= 0.5).map((e) => `${e.engine} ${pct(e.share)}`).join(", ")}`).join(" · ")}
                </div>
              ) : null}
            </div>
          );
        })
      ) : (
        <p style={{ margin: 0, fontSize: "13px" }}>No customer is ready to broaden yet.</p>
      )}
    </section>
  );
}
